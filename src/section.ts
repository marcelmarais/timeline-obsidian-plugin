/**
 * The part of a note the plugin owns: the list of places directly under its heading (`## Places` by default). A sync
 * replaces only the lines there that are shaped like its own output, so the person's own writing anywhere else in the
 * note, the heading itself and anything they add under the list included, is never touched.
 */

/** The comments around the list in builds before 1.0.5. A sync replaces them, and what is between them, with the list. */
const legacyStarts = ["%% timeline:start %%", "<!-- timeline:start -->"];
const legacyEnds = ["%% timeline:end %%", "<!-- timeline:end -->"];

export type BlockUpdate = { kind: "replaced" | "insertedUnderHeading" | "appended"; content: string; changed: boolean };

/** "## Places" from "## Places", "Places" or "  ### Places  ". */
export function normalizeHeading(heading: string): string {
  const trimmed = heading.trim();
  if (!trimmed) return "## Places";
  return /^#{1,6}\s/.test(trimmed) ? trimmed.replace(/\s+/g, " ") : `## ${trimmed}`;
}

/** A heading line's level and text, without closing hashes. */
function headingOf(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
  if (!match?.[1]) return null;
  return { level: match[1].length, text: (match[2] ?? "").trim().toLowerCase() };
}

/**
 * Whether a line is one the plugin writes: a stop, a trip or a place from photos ("- 09:05–17:40 · …"), a stop
 * without times, a line in italics ("- *No stops recorded.*") or a note under a stop ("  - Note: …").
 */
export function isPlaceLine(line: string): boolean {
  return (
    /^- .+ · /.test(line) ||
    /^- \*.+\*$/.test(line) ||
    / \*\(time not reported\)\*$/.test(line) ||
    /^ {2}- Note( \(.+\))?: /.test(line)
  );
}

/** The first line of the note's `heading`, outside code blocks. */
function headingLine(lines: string[], heading: string): number | null {
  const wanted = headingOf(normalizeHeading(heading));
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const found = headingOf(line);
    if (found && wanted && found.level === wanted.level && found.text === wanted.text) return index;
  }
  return null;
}

/** Where the plugin's list starts and ends, as line indexes, after the blank lines below `heading`; empty when none. */
function listAfter(lines: string[], heading: number): { from: number; to: number } {
  let from = heading + 1;
  while (from < lines.length && (lines[from] ?? "").trim() === "") from += 1;
  let to = from;
  while (to < lines.length && isPlaceLine(lines[to] ?? "")) to += 1;
  return to > from ? { from, to } : { from: heading + 1, to: heading + 1 };
}

/** The first comment of an older build's list and the end comment after it, as line indexes. */
function legacyBlock(lines: string[]): { from: number; to: number } | null {
  const from = lines.findIndex((line) => legacyStarts.includes(line.trim()));
  if (from < 0) return null;
  const end = lines.findIndex((line, index) => index > from && legacyEnds.includes(line.trim()));
  return end < 0 ? null : { from, to: end + 1 };
}

/** Whether a note already has the plugin's places under `heading`, or an older build's list. */
export function hasPlaces(content: string, heading: string): boolean {
  const lines = content.split(/\r?\n/);
  if (legacyBlock(lines)) return true;
  const index = headingLine(lines, heading);
  if (index === null) return false;
  const list = listAfter(lines, index);
  return list.to > list.from;
}

/**
 * Puts `body` under the note's `heading`: it replaces the plugin's list there, or goes directly under the heading when
 * it has none yet. A note without the heading gets the heading and list at its end.
 */
export function upsertBlock(content: string, body: string, heading: string): BlockUpdate {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(newline);
  const bodyLines = body ? body.split(/\r?\n/) : [];
  const replace = (from: number, to: number): BlockUpdate => {
    const next = [...lines.slice(0, from), ...bodyLines, ...lines.slice(to)].join(newline);
    return { kind: "replaced", content: next, changed: next !== content };
  };

  const legacy = legacyBlock(lines);
  if (legacy) return replace(legacy.from, legacy.to);

  const index = headingLine(lines, heading);
  if (index !== null) {
    const list = listAfter(lines, index);
    if (list.to > list.from) return replace(list.from, list.to);
    const after = lines.slice(index + 1);
    // Directly under the heading; a blank line keeps it apart from what the person wrote there.
    const rest = after.some((value) => value.trim() !== "") && (after[0] ?? "").trim() !== "" ? ["", ...after] : after;
    const next = [...lines.slice(0, index + 1), ...bodyLines, ...rest].join(newline);
    return { kind: "insertedUnderHeading", content: next, changed: true };
  }

  // Added after a blank line; the note's own text, trailing blank lines included, stays as it was.
  const separator =
    content.trim() === ""
      ? ""
      : content.endsWith(`${newline}${newline}`)
        ? ""
        : content.endsWith(newline)
          ? newline
          : `${newline}${newline}`;
  const next = `${content}${separator}${[normalizeHeading(heading), ...bodyLines].join(newline)}${newline}`;
  return { kind: "appended", content: next, changed: true };
}

/**
 * The smallest edit that turns `before` into `after`, as offsets into `before`, so an open editor keeps the cursor,
 * selection and undo history outside the list.
 */
export function minimalEdit(before: string, after: string): { from: number; to: number; text: string } | null {
  if (before === after) return null;
  let prefix = 0;
  const shorter = Math.min(before.length, after.length);
  while (prefix < shorter && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return { from: prefix, to: before.length - suffix, text: after.slice(prefix, after.length - suffix) };
}
