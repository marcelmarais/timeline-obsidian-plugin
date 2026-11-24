/**
 * Dates and daily note paths. Moment is passed in: Obsidian ships it (and daily note formats are Moment formats),
 * so the plugin uses Obsidian's copy and the tests their own.
 */

/** The few Moment methods used here, so the types never depend on how Moment's own typings resolve. */
export interface MomentValue {
  format(format?: string): string;
  isValid(): boolean;
  clone(): MomentValue;
  set(values: { hour: number; minute: number; second: number }): MomentValue;
  hour(): number;
  minute(): number;
  second(): number;
}

/** Moment's factory: `moment("2026-11-24", "YYYY-MM-DD", true)` or `moment(new Date())`. */
export type Moment = (input?: string | Date, format?: string, strict?: boolean) => MomentValue;

export interface DailyNoteConfig {
  /** The folder, relative to the vault, without leading or trailing slashes; "" for the vault root. */
  folder: string;
  /** A Moment format, which may contain slashes for nested folders: "YYYY/MM/YYYY-MM-DD". */
  format: string;
  /** The template file's path, when the daily notes settings name one. */
  template: string;
}

export const defaultDailyFormat = "YYYY-MM-DD";

/** Whether `value` is a real calendar date written as YYYY-MM-DD. */
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** The first real YYYY-MM-DD date in a title: "2026-11-24 Berlin trip" → "2026-11-24". */
export function dateFromTitle(title: string): string | null {
  for (const match of title.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
    // Not part of a longer number, such as 12026-11-245.
    const before = match.index > 0 ? title[match.index - 1] : "";
    const after = title[match.index + match[0].length] ?? "";
    if (/\d/.test(before ?? "") || /\d/.test(after)) continue;
    if (isDate(match[0])) return match[0];
  }
  return null;
}

/** The days before or after a date: addDays("2026-11-24", -1) is "2026-11-23". */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

/** Today on this device, as YYYY-MM-DD. Daily notes follow the device's clock, so syncing does too. */
export function localToday(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A folder setting as a vault path: no leading, trailing or doubled slashes. */
export function cleanFolder(folder: string): string {
  return folder
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

/** Where the daily note for `date` lives: "Daily/2026-11-24.md". */
export function dailyNotePath(date: string, config: DailyNoteConfig, moment: Moment): string {
  const name = moment(date, "YYYY-MM-DD", true).format(config.format || defaultDailyFormat);
  const folder = cleanFolder(config.folder);
  return `${folder ? `${folder}/` : ""}${name}.md`;
}

/**
 * The date a note is for: its daily note date when its path matches the daily notes format, else the first
 * YYYY-MM-DD in its title.
 */
export function dateOfNote(path: string, config: DailyNoteConfig, moment: Moment): string | null {
  const format = config.format || defaultDailyFormat;
  const withoutExtension = path.replace(/\.md$/i, "");
  const folder = cleanFolder(config.folder);
  const inFolder = !folder || withoutExtension.startsWith(`${folder}/`);
  const relative = folder && inFolder ? withoutExtension.slice(folder.length + 1) : withoutExtension;
  if (inFolder) {
    const parsed = moment(relative, format, true);
    if (parsed.isValid()) return parsed.format("YYYY-MM-DD");
  }
  const title = withoutExtension.split("/").pop() ?? withoutExtension;
  const lastPart = format.split("/").pop() ?? format;
  const parsed = moment(title, lastPart, true);
  if (parsed.isValid() && lastPart.includes("D")) return parsed.format("YYYY-MM-DD");
  return dateFromTitle(title);
}

/** Whether `path` is exactly the daily note for some date, and which. */
export function dailyNoteDate(path: string, config: DailyNoteConfig, moment: Moment): string | null {
  const date = dateOfNote(path, config, moment);
  return date && dailyNotePath(date, config, moment) === path ? date : null;
}

/**
 * A daily note template filled in as Obsidian's own daily notes do: `{{date}}`, `{{time}}` and `{{title}}`, with
 * an optional Moment format after a colon, such as `{{date:dddd D MMMM}}`.
 */
export function fillTemplate(template: string, date: string, format: string, moment: Moment, now = new Date()): string {
  const day = moment(date, "YYYY-MM-DD", true);
  const clock = moment(now);
  const title = day.format(format || defaultDailyFormat).split("/").pop() ?? date;
  return template.replace(/\{\{\s*(date|time|title)\s*(?::([^}]*))?\}\}/gi, (_whole, key: string, custom?: string) => {
    const name = key.toLowerCase();
    if (name === "title") return title;
    const at = day.clone().set({ hour: clock.hour(), minute: clock.minute(), second: clock.second() });
    if (custom?.trim()) return at.format(custom.trim());
    return name === "date" ? day.format(format || defaultDailyFormat) : clock.format("HH:mm");
  });
}
