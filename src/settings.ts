import { type App, PluginSettingTab, requireApiVersion, Setting } from "obsidian";
import { detectDailyNotes } from "./daily-notes";
import type { FormatOptions } from "./format";
import type TimelinePlugin from "./main";

export interface TimelineSettings extends FormatOptions {
  /** The OAuth client this vault registered with Timeline. Not a secret. */
  clientId: string | null;
  autoSync: boolean;
  /** "" to use the daily notes settings. */
  dailyFolder: string;
  /** "" to use the daily notes settings. */
  dailyFormat: string;
  heading: string;
}

export const defaultSettings: TimelineSettings = {
  clientId: null,
  autoSync: false,
  dailyFolder: "",
  dailyFormat: "",
  heading: "## Places",
  includeNotes: true,
  includeTravel: false,
  wikilinks: false,
};

/** One row: its name and description are what Obsidian's settings search finds. */
interface Row {
  name: string;
  desc?: string;
  aliases?: string[];
  render: (setting: Setting) => void;
}

interface Group {
  type: "group";
  heading: string;
  items: Row[];
}

type BooleanKey = "autoSync" | "includeNotes" | "includeTravel" | "wikilinks";
type TextKey = "dailyFolder" | "dailyFormat" | "heading";

/**
 * The settings, defined once. Obsidian 1.13 and later draw them from `getSettingDefinitions()` and list them in
 * settings search; earlier versions call `display()`, which draws the same rows.
 */
export class TimelineSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: TimelinePlugin,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): Group[] {
    return [this.account(), this.dailyNotes(), this.formatting()];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const group of this.getSettingDefinitions()) {
      new Setting(containerEl).setName(group.heading).setHeading();
      for (const row of group.items) {
        const setting = new Setting(containerEl).setName(row.name);
        if (row.desc) setting.setDesc(row.desc);
        row.render(setting);
      }
    }
  }

  /** Draws the tab again, for a change of connection or a problem to show. */
  refresh(): void {
    if (requireApiVersion("1.13.0")) this.update();
    else if (this.containerEl.isConnected) this.display();
  }

  private account(): Group {
    const { plugin } = this;
    const connected = plugin.auth.connected;
    const desc =
      plugin.problem ??
      (connected
        ? "Connected. Places come from the history your iPhone shares with Timeline Pro."
        : "Not connected. Sign in with Apple or Google in your browser using the same account as the Timeline iPhone app. Requires Timeline Pro with history sharing turned on.");
    return {
      type: "group",
      heading: "Account",
      items: [
        {
          name: "Timeline account",
          desc,
          aliases: ["Connect", "Sign in", "Disconnect", "Timeline Pro"],
          render: (setting) => {
            if (plugin.problem) setting.descEl.addClass("timeline-location-history-status-problem");
            if (!connected) {
              setting.addButton((button) =>
                button
                  .setButtonText("Connect")
                  .setCta()
                  .onClick(async () => {
                    button.setDisabled(true);
                    await plugin.connect();
                    button.setDisabled(false);
                  }),
              );
              return;
            }
            setting.addButton((button) =>
              button.setButtonText("Check").onClick(async () => {
                button.setDisabled(true);
                await plugin.checkAccess(true);
                this.refresh();
              }),
            );
            setting.addButton((button) =>
              button.setButtonText("Disconnect").onClick(async () => {
                button.setDisabled(true);
                await plugin.disconnect();
                this.refresh();
              }),
            );
          },
        },
      ],
    };
  }

  private dailyNotes(): Group {
    const detected = detectDailyNotes(this.app);
    return {
      type: "group",
      heading: "Daily notes",
      items: [
        {
          name: "Keep daily notes up to date",
          desc: "Refresh today's daily note while it's open, and yesterday's when you open it if it already has places. It never creates a note.",
          aliases: ["Automatic sync", "Auto sync"],
          render: (setting) =>
            this.toggle(setting, "autoSync", (value) => {
              if (value) void this.plugin.autoSync();
            }),
        },
        {
          name: "Daily notes folder",
          desc: `Leave empty to use your daily notes settings (${detected.folder || "the vault root"}).`,
          render: (setting) => this.text(setting, "dailyFolder", detected.folder || "/"),
        },
        {
          name: "Date format",
          desc: `Leave empty to use your daily notes settings (${detected.format}).`,
          render: (setting) => this.text(setting, "dailyFormat", detected.format),
        },
        {
          name: "Heading",
          desc: "Places go under this heading. Syncing only replaces the text between the plugin's markers.",
          render: (setting) => this.text(setting, "heading", defaultSettings.heading),
        },
      ],
    };
  }

  private formatting(): Group {
    return {
      type: "group",
      heading: "Formatting",
      items: [
        {
          name: "Include notes",
          desc: "List notes written on a stop underneath it.",
          render: (setting) => this.toggle(setting, "includeNotes"),
        },
        {
          name: "Include travel",
          desc: "Add how you travelled between stops when your iPhone recorded it.",
          render: (setting) => this.toggle(setting, "includeTravel"),
        },
        {
          name: "Link places",
          desc: "Write saved and named places as [[wikilinks]] instead of bold text.",
          aliases: ["Wikilinks"],
          render: (setting) => this.toggle(setting, "wikilinks"),
        },
      ],
    };
  }

  private toggle(setting: Setting, key: BooleanKey, changed?: (value: boolean) => void): void {
    setting.addToggle((toggle) =>
      toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
        this.plugin.settings[key] = value;
        await this.plugin.saveSettings();
        changed?.(value);
      }),
    );
  }

  private text(setting: Setting, key: TextKey, placeholder: string): void {
    setting.addText((text) =>
      text
        .setPlaceholder(placeholder)
        .setValue(this.plugin.settings[key])
        .onChange(async (value) => {
          this.plugin.settings[key] = value;
          await this.plugin.saveSettings();
        }),
    );
  }
}
