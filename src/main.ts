import { type Editor, MarkdownView, Notice, Plugin, type TFile } from "obsidian";
import { TimelineApi, TimelineError } from "./api";
import { AuthError, protocolAction, TimelineAuth } from "./auth";
import { DailyNotes } from "./daily-notes";
import { DateModal } from "./date-modal";
import { addDays, localToday } from "./dates";
import { formatCurrent, formatDay } from "./format";
import { obsidianAuthStorage, obsidianHttp } from "./obsidian-http";
import { hasPlaces, minimalEdit, upsertBlock } from "./section";
import { defaultSettings, type TimelineSettings, TimelineSettingTab } from "./settings";

/** How often an open daily note for today is refreshed. */
const refreshEveryMs = 10 * 60 * 1000;
/** Opening the same note again within this long doesn't fetch again. */
const reopenQuietMs = 60 * 1000;
/** A note younger than this is left to the plugin that made it, such as Templater. */
const newNoteMs = 10 * 1000;

type SyncResult = "updated" | "unchanged";

function messageOf(error: unknown): string {
  if (error instanceof TimelineError || error instanceof AuthError) {
    return error.message;
  }
  return "Something went wrong. Try again.";
}

export default class TimelinePlugin extends Plugin {
  settings: TimelineSettings = { ...defaultSettings };
  auth!: TimelineAuth;
  api!: TimelineApi;
  dailyNotes!: DailyNotes;
  /** The last problem reaching Timeline, shown in the settings until a request works again. */
  problem: string | null = null;
  private settingTab!: TimelineSettingTab;
  private readonly lastSynced = new Map<string, number>();

  async onload(): Promise<void> {
    await this.loadSettings();
    const storage = obsidianAuthStorage(this.app, {
      load: () => this.settings.clientId,
      save: async (clientId) => {
        this.settings.clientId = clientId;
        await this.saveSettings();
      },
    });
    this.auth = new TimelineAuth(obsidianHttp, storage);
    this.api = new TimelineApi(obsidianHttp, this.auth);
    this.dailyNotes = new DailyNotes(this.app, () => ({
      folder: this.settings.dailyFolder,
      format: this.settings.dailyFormat,
    }));
    this.settingTab = new TimelineSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    this.registerObsidianProtocolHandler(protocolAction, (params) => {
      void this.finishSignIn(params);
    });

    this.addCommand({
      id: "insert-today",
      name: "Insert today's places",
      editorCallback: (editor) => {
        void this.insertDay(editor, localToday());
      },
    });
    this.addCommand({
      id: "insert-date",
      name: "Insert places for a date…",
      editorCallback: (editor, context) => {
        const noteDate = context.file ? this.dailyNotes.dateOf(context.file) : null;
        new DateModal(this.app, noteDate, (date) => {
          void this.insertDay(editor, date);
        }).open();
      },
    });
    this.addCommand({
      id: "insert-current-location",
      name: "Insert current location",
      editorCallback: (editor) => {
        void this.insertCurrent(editor);
      },
    });
    this.addCommand({
      id: "sync-today",
      name: "Sync today's daily note",
      callback: () => {
        void this.syncToday();
      },
    });
    this.addCommand({
      id: "sync-note-date",
      name: "Sync this note's date",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const date = file?.extension === "md" ? this.dailyNotes.dateOf(file) : null;
        if (!file || !date) return false;
        if (!checking) void this.syncNote(file, date);
        return true;
      },
    });

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.workspace.on("file-open", (file) => {
          if (file) void this.autoSyncFile(file);
        }),
      );
      this.registerInterval(
        window.setInterval(() => {
          void this.autoSync();
        }, refreshEveryMs),
      );
      void this.autoSync();
    });
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<TimelineSettings> | null;
    this.settings = { ...defaultSettings, ...saved };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Opens Timeline's sign-in in the browser; it comes back through the protocol handler. */
  async connect(): Promise<void> {
    try {
      const url = await this.auth.startSignIn();
      window.open(url);
      new Notice("Sign in to Timeline in your browser, then come back to Obsidian.");
    } catch (error) {
      new Notice(messageOf(error));
    }
  }

  private async finishSignIn(params: Record<string, string>): Promise<void> {
    try {
      await this.auth.finishSignIn(params);
      this.setProblem(null);
      new Notice("Connected to Timeline.");
      await this.checkAccess(false);
    } catch (error) {
      this.setProblem(messageOf(error));
      new Notice(messageOf(error));
    }
    this.refreshSettings();
  }

  async disconnect(): Promise<void> {
    await this.auth.signOut();
    this.setProblem(null);
    new Notice("Disconnected from Timeline on this device.");
  }

  /** Whether history can be read, remembered for the settings. */
  async checkAccess(announce: boolean): Promise<void> {
    try {
      await this.api.current();
      this.setProblem(null);
      if (announce) new Notice("Timeline is connected and your history is shared.");
    } catch (error) {
      this.setProblem(messageOf(error));
      new Notice(messageOf(error));
    }
  }

  private refreshSettings(): void {
    this.settingTab.refresh();
  }

  /** Remembers the last problem for the settings, and redraws them when it changes. */
  private setProblem(problem: string | null): void {
    if (problem === this.problem) return;
    this.problem = problem;
    this.refreshSettings();
  }

  private report(error: unknown): void {
    this.setProblem(messageOf(error));
    new Notice(messageOf(error));
  }

  private async insertDay(editor: Editor, date: string): Promise<void> {
    try {
      const text = formatDay(await this.api.day(date), this.settings);
      this.setProblem(null);
      const cursor = editor.getCursor("from");
      const before = editor.getLine(cursor.line).slice(0, cursor.ch);
      editor.replaceSelection(`${before.trim() ? "\n" : ""}${text}\n`);
    } catch (error) {
      this.report(error);
    }
  }

  private async insertCurrent(editor: Editor): Promise<void> {
    try {
      const text = formatCurrent(await this.api.current(), this.settings);
      this.setProblem(null);
      editor.replaceSelection(text);
    } catch (error) {
      this.report(error);
    }
  }

  /** Syncs today's daily note, creating it once the places have arrived: the person asked for it. */
  private async syncToday(): Promise<void> {
    const date = localToday();
    try {
      const body = await this.placesFor(date);
      const file = this.dailyNotes.find(date) ?? (await this.dailyNotes.create(date));
      const result = await this.writeBlock(file, body);
      new Notice(result === "updated" ? `Updated places in ${file.basename}.` : `${file.basename} is up to date.`);
    } catch (error) {
      this.report(error);
    }
  }

  private async syncNote(file: TFile, date: string): Promise<void> {
    try {
      const result = await this.syncFile(file, date);
      new Notice(result === "updated" ? `Updated places in ${file.basename}.` : `${file.basename} is up to date.`);
    } catch (error) {
      this.report(error);
    }
  }

  /** Refreshes today's daily note wherever it is open. Never creates a note. */
  async autoSync(): Promise<void> {
    if (!this.settings.autoSync || !this.auth.connected) return;
    const today = localToday();
    const open = new Set<TFile>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.file) open.add(leaf.view.file);
    }
    for (const file of open) {
      if (this.dailyNotes.dailyDateOf(file) === today) await this.quietSync(file, today);
    }
  }

  /** On opening today's daily note, or yesterday's when it already has places, brings it up to date. */
  private async autoSyncFile(file: TFile): Promise<void> {
    if (!this.settings.autoSync || !this.auth.connected || file.extension !== "md") return;
    const date = this.dailyNotes.dailyDateOf(file);
    if (!date) return;
    // A note made a moment ago may still be getting its template from another plugin; the next refresh fills it.
    if (Date.now() - file.stat.ctime < newNoteMs) return;
    const last = this.lastSynced.get(file.path);
    if (last && Date.now() - last < reopenQuietMs) return;
    const today = localToday();
    if (date === today) {
      await this.quietSync(file, date);
    } else if (date === addDays(today, -1)) {
      const content = await this.app.vault.cachedRead(file);
      if (hasPlaces(content, this.settings.heading)) await this.quietSync(file, date);
    }
  }

  /** A sync nobody asked for right now: problems go to the settings, not to notices. */
  private async quietSync(file: TFile, date: string): Promise<void> {
    try {
      await this.syncFile(file, date);
      this.setProblem(null);
    } catch (error) {
      this.setProblem(messageOf(error));
    }
  }

  private async placesFor(date: string): Promise<string> {
    const body = formatDay(await this.api.day(date), this.settings);
    this.setProblem(null);
    return body;
  }

  private async syncFile(file: TFile, date: string): Promise<SyncResult> {
    const body = await this.placesFor(date);
    return this.writeBlock(file, body);
  }

  /** The editor showing `file`, in any pane. */
  private editorFor(file: TFile): Editor | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) return leaf.view.editor;
    }
    return null;
  }

  /**
   * Writes the places under the note's heading. A note open in an editor is changed through the editor, only
   * where the list changed, so the cursor and undo history stay as they were.
   */
  private async writeBlock(file: TFile, body: string): Promise<SyncResult> {
    this.lastSynced.set(file.path, Date.now());
    const heading = this.settings.heading;
    const editor = this.editorFor(file);
    if (editor) {
      const before = editor.getValue();
      const edit = minimalEdit(before, upsertBlock(before, body, heading).content);
      if (!edit) return "unchanged";
      editor.replaceRange(edit.text, editor.offsetToPos(edit.from), editor.offsetToPos(edit.to));
      return "updated";
    }

    if (!upsertBlock(await this.app.vault.read(file), body, heading).changed) return "unchanged";
    await this.app.vault.process(file, (content) => upsertBlock(content, body, heading).content);
    return "updated";
  }
}
