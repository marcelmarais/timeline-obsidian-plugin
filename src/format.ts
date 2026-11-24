import type { Current, Day, Leg, Place, Stop, Travel } from "./types";

/**
 * Timeline's history as quiet Markdown bullets. It says only what the phone recorded: a guess reads as one, a stop
 * without a departure is never given an end, places from photos get no durations, and a day without history says
 * why instead of looking empty.
 */

export interface FormatOptions {
  includeNotes: boolean;
  includeTravel: boolean;
  wikilinks: boolean;
}

export const defaultFormat: FormatOptions = { includeNotes: true, includeTravel: false, wikilinks: false };

/** A stay counts as continuing "now" only while the phone saw the person there this recently. */
const nowWindowMs = 6 * 60 * 60 * 1000;

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The local date of an ISO time with offset, as written: "2026-11-24". */
const dateOf = (iso: string) => iso.slice(0, 10);
/** The local time of an ISO time with offset, as written: "09:05". */
const clockOf = (iso: string) => iso.slice(11, 16);

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "Mon" for a date in the same week as `reference`, else "3 Nov", with the year when it differs. */
function dayLabel(date: string, reference: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  if (Math.abs(daysBetween(date, reference)) < 7) return weekdays[day.getUTCDay()] ?? date;
  const label = `${day.getUTCDate()} ${months[day.getUTCMonth()] ?? ""}`;
  return date.slice(0, 4) === reference.slice(0, 4) ? label : `${label} ${date.slice(0, 4)}`;
}

/** "09:05" on `date`, or "Mon 22:40" when the time falls on another day. */
export function timeOn(iso: string, date: string): string {
  return dateOf(iso) === date ? clockOf(iso) : `${dayLabel(dateOf(iso), date)} ${clockOf(iso)}`;
}

/** "25m", "8h 35m", "8h", "3d". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Text from Timeline, escaped so Markdown shows it as written: no accidental emphasis, links, tags, maths or HTML,
 * and never a line that could pass for the managed block's markers.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_[\]<>#|~$=^%{}]/g, (character) => `\\${character}`);
}

/** A wikilink to a place's note. Characters a link can't hold are left out. */
export function wikilink(name: string): string {
  const target = name
    .replace(/[[\]|#^\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return target ? `[[${target}]]` : escapeMarkdown(name);
}

const travelWords: Record<Travel, string> = {
  foot: "on foot",
  cycle: "cycling",
  vehicle: "in a vehicle",
  road: "by road",
  rail: "by rail",
  car: "by car",
  bus: "by bus",
  tram: "by tram",
  underground: "by underground",
  train: "by train",
  flight: "by plane",
  boat: "by boat",
};

/** A correction someone made, named unless it was the person's own. */
const chosenByText = (chosenBy: string | null) =>
  chosenBy && chosenBy !== "you" ? ` *(chosen by ${escapeMarkdown(chosenBy)})*` : "";

/** "**Home**", "[[Kreuzberg Climbing Hall]] *(probably)*", "**Lohmühlenstraße 65**", "*an unnamed spot in Berlin*". */
export function placeText(place: Place, options: Pick<FormatOptions, "wikilinks">): string {
  if (place.kind === "unnamed" || !place.name) {
    return place.city ? `*an unnamed spot in ${escapeMarkdown(place.city)}*` : "*an unnamed spot*";
  }
  const linked = options.wikilinks && place.kind !== "address";
  const name = linked ? wikilink(place.name) : `**${escapeMarkdown(place.name)}**`;
  const guess = place.kind === "guess" ? " *(probably)*" : "";
  return `${name}${guess}${chosenByText(place.chosenBy)}`;
}

/** The times of a stop on `date`, and what to say about a stop that hasn't ended. */
function stopTimes(stop: Stop, date: string, now: Date): { times: string; after: string } {
  const { arrival, departure, stillThereAt } = stop;
  if (arrival && departure) {
    return {
      times: `${timeOn(arrival, date)}–${timeOn(departure, date)}`,
      after: ` (${formatDuration(Date.parse(departure) - Date.parse(arrival))})`,
    };
  }
  if (arrival && stillThereAt) {
    if (now.getTime() - Date.parse(stillThereAt) < nowWindowMs) return { times: `${timeOn(arrival, date)}–now`, after: "" };
    return { times: `since ${timeOn(arrival, date)}`, after: ` *(still there when last seen ${timeOn(stillThereAt, date)})*` };
  }
  if (arrival) return { times: `since ${timeOn(arrival, date)}`, after: " *(no departure reported)*" };
  if (departure) return { times: `until ${timeOn(departure, date)}`, after: " *(arrival not reported)*" };
  return { times: "", after: " *(time not reported)*" };
}

/** "- 09:05–17:40 · **Work** (8h 35m)" and its notes. */
function stopLines(stop: Stop, date: string, now: Date, options: FormatOptions): string[] {
  const { times, after } = stopTimes(stop, date, now);
  const lines = [`- ${times ? `${times} · ` : ""}${placeText(stop.place, options)}${after}`];
  if (options.includeNotes) {
    for (const note of stop.notes) {
      const text = escapeMarkdown(note.text);
      if (!text) continue;
      lines.push(note.yours ? `  - Note: ${text}` : `  - Note (${escapeMarkdown(note.author)}): ${text}`);
    }
  }
  return lines;
}

/** "- 17:40–17:55 · *on foot 5m, then by train 10m*", when the phone said how the person travelled. */
function travelLine(legs: Leg[] | null, date: string): string | null {
  const first = legs?.[0];
  const last = legs?.[legs.length - 1];
  if (!legs || !first || !last) return null;
  const parts = legs.map((leg) => {
    const length = formatDuration(Date.parse(leg.end) - Date.parse(leg.start));
    return `${travelWords[leg.travel]} ${length}${leg.chosenBy && leg.chosenBy !== "you" ? ` (chosen by ${escapeMarkdown(leg.chosenBy)})` : ""}`;
  });
  return `- ${timeOn(first.start, date)}–${timeOn(last.end, date)} · *${parts.join(", then ")}*`;
}

/** Why a day lists nothing, in one quiet line. */
function emptyLine(day: Day): string | null {
  if (day.status === "future") return "*This day hasn't happened yet.*";
  if (day.status === "notUploaded") return "*Not uploaded from your iPhone yet.*";
  if (day.status === "beforeFirstUpload") return "*No history for this day.*";
  if (day.recording === "off") return null;
  if (day.recording === "beforeRecordingStarted") return "*Before recording started.*";
  return "*No stops recorded.*";
}

const placeFields: Place = { kind: "named", name: null, address: null, city: null, category: null, chosenBy: null };

/** A day's places as Markdown lines, without a trailing newline. */
export function formatDay(day: Day, options: FormatOptions = defaultFormat, now = new Date()): string {
  const lines: string[] = [];
  if (day.sharedFrom) lines.push(`*Only history after ${timeOn(day.sharedFrom, day.date)} was shared.*`);
  if (day.recording === "off") lines.push("*Location recording was off.*");
  // Places from photos: when the first and last photo there were taken. Nothing says when the person came or went.
  for (const photo of day.photoPlaces) {
    const first = timeOn(photo.firstPhoto, day.date);
    const last = timeOn(photo.lastPhoto, day.date);
    const name =
      photo.place.name && photo.place.kind === "saved"
        ? placeText({ ...placeFields, kind: "saved", name: photo.place.name }, options)
        : photo.place.name
          ? `**${escapeMarkdown(photo.place.name)}**`
          : "*an unnamed spot*";
    lines.push(`- ${first === last ? first : `${first}–${last}`} · ${name} *(from photos)*`);
  }
  day.stops.forEach((stop) => {
    lines.push(...stopLines(stop, day.date, now, options));
    if (options.includeTravel) {
      const travel = travelLine(stop.travelAfter, day.date);
      if (travel) lines.push(travel);
    }
  });
  if (day.stops.length === 0 && day.photoPlaces.length === 0) {
    const empty = emptyLine(day);
    if (empty) lines.push(empty);
  }
  return lines.join("\n");
}

/**
 * Where the person was last seen, in one line: "At **Home** since 19:55 (last seen 19:58)". It is the last position
 * the phone uploaded, never a live fix.
 */
export function formatCurrent(current: Current, options: Pick<FormatOptions, "wikilinks"> = defaultFormat): string {
  const { today, lastSeen, stop, travel } = current;
  const seen = lastSeen ? `last seen ${timeOn(lastSeen.at, today)}` : null;
  const approximate = lastSeen?.approximateMeters ? `, within about ${lastSeen.approximateMeters} m` : "";
  const aside = seen ? ` (${seen}${approximate})` : "";
  if (stop?.state === "there" && stop.arrival) {
    return `At ${placeText(stop.place, options)} since ${timeOn(stop.arrival, today)}${aside}`;
  }
  if (stop?.state === "left" && stop.departure) {
    const moving = travel ? ` · ${travelWords[travel.travel]} since ${timeOn(travel.since, today)}` : "";
    return `Left ${placeText(stop.place, options)} at ${timeOn(stop.departure, today)}${moving}${aside}`;
  }
  if (stop) {
    const since = stop.arrival ? `, arrived ${timeOn(stop.arrival, today)}` : "";
    return `Last stop: ${placeText(stop.place, options)}${since}, no departure reported${aside}`;
  }
  if (lastSeen) {
    const near = lastSeen.label ? ` near ${escapeMarkdown(lastSeen.label)}` : "";
    return `Last seen ${timeOn(lastSeen.at, today)}${near}${approximate ? ` (${approximate.slice(2)})` : ""}`;
  }
  return "*Nothing uploaded from your iPhone yet.*";
}
