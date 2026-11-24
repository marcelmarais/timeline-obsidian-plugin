import { type App, moment, normalizePath, TFile, TFolder } from "obsidian";
import {
  cleanFolder,
  type DailyNoteConfig,
  dailyNoteDate,
  dailyNotePath,
  dateOfNote,
  defaultDailyFormat,
  fillTemplate,
} from "./dates";

/**
 * Where daily notes live, read from the Periodic Notes plugin when it manages daily notes, else from Obsidian's own
 * Daily notes plugin. Neither has a public API for its settings, so every field is checked before use and a missing
 * one falls back to Obsidian's defaults.
 */

interface PluginHost {
  plugins?: { getPlugin?: (id: string) => unknown };
  internalPlugins?: { getPluginById?: (id: string) => unknown };
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function detectDailyNotes(app: App): DailyNoteConfig {
  const host = app as unknown as PluginHost;
  const periodic = record(record(host.plugins?.getPlugin?.("periodic-notes"))?.settings);
  const periodicDaily = record(periodic?.daily);
  if (periodicDaily?.enabled === true) {
    return {
      folder: cleanFolder(text(periodicDaily.folder)),
      format: text(periodicDaily.format) || defaultDailyFormat,
      template: text(periodicDaily.template),
    };
  }
  const core = record(host.internalPlugins?.getPluginById?.("daily-notes"));
  const options = record(record(core?.instance)?.options);
  return {
    folder: cleanFolder(text(options?.folder)),
    format: text(options?.format) || defaultDailyFormat,
    template: text(options?.template),
  };
}

export class DailyNotes {
  constructor(
    private readonly app: App,
    private readonly overrides: () => { folder: string; format: string },
  ) {}

  /** The detected settings with the plugin's own overrides on top. */
  config(): DailyNoteConfig {
    const detected = detectDailyNotes(this.app);
    const { folder, format } = this.overrides();
    return {
      folder: folder.trim() ? cleanFolder(folder) : detected.folder,
      format: format.trim() || detected.format,
      template: detected.template,
    };
  }

  pathFor(date: string): string {
    return normalizePath(dailyNotePath(date, this.config(), moment));
  }

  find(date: string): TFile | null {
    return this.app.vault.getFileByPath(this.pathFor(date));
  }

  /** The date `file` is the daily note for, or `null` when it isn't one. */
  dailyDateOf(file: TFile): string | null {
    return dailyNoteDate(file.path, this.config(), moment);
  }

  /** The date a note is about: its daily note date, else a YYYY-MM-DD in its title. */
  dateOf(file: TFile): string | null {
    return dateOfNote(file.path, this.config(), moment);
  }

  /** Creates the daily note for `date` from the daily notes template, as Obsidian would. Only on request. */
  async create(date: string): Promise<TFile> {
    const config = this.config();
    const path = this.pathFor(date);
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder && !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
      await this.app.vault.createFolder(folder);
    }
    let content = "";
    if (config.template) {
      const templatePath = normalizePath(config.template.endsWith(".md") ? config.template : `${config.template}.md`);
      const template = this.app.vault.getFileByPath(templatePath);
      if (template) content = fillTemplate(await this.app.vault.cachedRead(template), date, config.format, moment);
    }
    return this.app.vault.create(path, content);
  }
}
