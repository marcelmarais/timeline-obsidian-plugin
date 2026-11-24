/**
 * The block of a note the plugin owns: everything between two HTML comments, which Obsidian doesn't show in
 * reading view. Syncing replaces only what is between them, so the person's own writing anywhere else in the note,
 * the heading above the block included, is never touched.
 */

export const startMarker = "<!-- timeline:start -->";
export const endMarker = "<!-- timeline:end -->";

export type BlockUpdate =
  | { kind: "replaced" | "insertedUnderHeading" | "appended"; content: string; changed: boolean }
  /** The markers are missing one half, repeated or out of order: the note is left alone. */
  | { kind: "brokenMarkers" };

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

function occurrences(content: string, marker: string): number[] {
  const found: number[] = [];
  for (let index = content.indexOf(marker); index >= 0; index = content.indexOf(marker, index + marker.length)) {
    found.push(index);
  }
  return found;
}

/** The managed block's text: markers on their own lines around the body. */
export function blockText(body: string, newline = "\n"): string {
  const lines = body ? body.split(/\r?\n/) : [];
  return [startMarker, ...lines, endMarker].join(newline);
}

/**
 * Puts `body` inside the note's managed block. A note with markers gets the text between them replaced; one without
 * gets the block under its `heading` if it has that heading, else the heading and block at its end.
 */
export function upsertBlock(content: string, body: string, heading: string): BlockUpdate {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const block = blockText(body, newline);
  const starts = occurrences(content, startMarker);
  const ends = occurrences(content, endMarker);
  if (starts.length > 1 || ends.length > 1 || starts.length !== ends.length) return { kind: "brokenMarkers" };

  const start = starts[0];
  const end = ends[0];
  if (start !== undefined && end !== undefined) {
    if (end < start) return { kind: "brokenMarkers" };
    const next = content.slice(0, start) + block + content.slice(end + endMarker.length);
    return { kind: "replaced", content: next, changed: next !== content };
  }

  const wanted = headingOf(normalizeHeading(heading));
  const lines = content.split(newline);
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const found = headingOf(line);
    if (found && wanted && found.level === wanted.level && found.text === wanted.text) {
      const after = lines.slice(index + 1);
      // Directly under the heading; a blank line keeps it apart from what the person wrote there.
      const rest = after.some((value) => value.trim() !== "") && (after[0] ?? "").trim() !== "" ? ["", ...after] : after;
      const next = [...lines.slice(0, index + 1), ...block.split(newline), ...rest].join(newline);
      return { kind: "insertedUnderHeading", content: next, changed: true };
    }
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
  const next = `${content}${separator}${normalizeHeading(heading)}${newline}${block}${newline}`;
  return { kind: "appended", content: next, changed: true };
}

/**
 * The smallest edit that turns `before` into `after`, as offsets into `before`, so an open editor keeps the cursor,
 * selection and undo history outside the block.
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
