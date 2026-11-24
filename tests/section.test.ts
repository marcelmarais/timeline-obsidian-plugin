import { describe, expect, it } from "vitest";
import { blockText, endMarker, minimalEdit, normalizeHeading, startMarker, upsertBlock } from "../src/section";

const morning = "- 09:05–17:40 · **Work** (8h 35m)";
const evening = `${morning}\n- 20:10–now · **Home**`;

function content(update: ReturnType<typeof upsertBlock>): string {
  if (update.kind === "brokenMarkers") throw new Error("Expected an update");
  return update.content;
}

describe("the managed block", () => {
  it("adds a heading and block at the end of a note without one, leaving the note as it was", () => {
    const note = "# Tuesday\n\nSlept badly.\nTrain was late.";
    const update = upsertBlock(note, morning, "## Places");
    expect(update.kind).toBe("appended");
    expect(content(update)).toBe(`${note}\n\n## Places\n${startMarker}\n${morning}\n${endMarker}\n`);
    expect(content(upsertBlock("", morning, "## Places"))).toBe(`## Places\n${startMarker}\n${morning}\n${endMarker}\n`);
    // A note that ends in a newline gets just one more.
    expect(content(upsertBlock("Notes\n", morning, "## Places"))).toBe(
      `Notes\n\n## Places\n${startMarker}\n${morning}\n${endMarker}\n`,
    );
  });

  it("puts the block under the heading when the note already has it", () => {
    const note = "# Tuesday\n\n## Places\nWent climbing after work.\n\n## Tasks\n- [ ] Call Jonas";
    const update = upsertBlock(note, morning, "## Places");
    expect(update.kind).toBe("insertedUnderHeading");
    expect(content(update)).toBe(
      `# Tuesday\n\n## Places\n${startMarker}\n${morning}\n${endMarker}\n\nWent climbing after work.\n\n## Tasks\n- [ ] Call Jonas`,
    );
    // Matching ignores case and closing hashes, but not the level.
    expect(upsertBlock("## places ##\n", morning, "Places").kind).toBe("insertedUnderHeading");
    expect(upsertBlock("### Places\n", morning, "## Places").kind).toBe("appended");
    // A heading inside a code block isn't one.
    expect(upsertBlock("```\n## Places\n```\n", morning, "## Places").kind).toBe("appended");
  });

  it("updates the stops in place as the day goes on, touching nothing outside the markers", () => {
    const first = content(upsertBlock("# Tuesday\n\nMorning notes.", morning, "## Places"));
    // The person writes below the block and renames the heading; the next sync only changes the stops.
    const edited = `${first.replace("## Places", "## Where I went")}\nEvening notes, written later.\n`;
    const second = upsertBlock(edited, evening, "## Places");
    expect(second.kind).toBe("replaced");
    expect(content(second)).toBe(edited.replace(blockText(morning), blockText(evening)));
    // Syncing the same stops again changes nothing.
    const third = upsertBlock(content(second), evening, "## Places");
    expect(third).toMatchObject({ kind: "replaced", changed: false });
    expect(content(third)).toBe(content(second));
  });

  it("leaves a note alone when its markers were edited by hand", () => {
    expect(upsertBlock(`${startMarker}\n${morning}\n`, evening, "## Places").kind).toBe("brokenMarkers");
    expect(upsertBlock(`${morning}\n${endMarker}\n`, evening, "## Places").kind).toBe("brokenMarkers");
    expect(upsertBlock(`${endMarker}\n${startMarker}\n`, evening, "## Places").kind).toBe("brokenMarkers");
    const twice = `${blockText(morning)}\n${blockText(morning)}`;
    expect(upsertBlock(twice, evening, "## Places").kind).toBe("brokenMarkers");
  });

  it("swaps the first builds' HTML comments for Obsidian comments on the next sync", () => {
    const old = `# Tuesday\n\n## Places\n<!-- timeline:start -->\n${morning}\n<!-- timeline:end -->\n\nAfterwards.`;
    expect(content(upsertBlock(old, evening, "## Places"))).toBe(
      `# Tuesday\n\n## Places\n${blockText(evening)}\n\nAfterwards.`,
    );
    expect(startMarker).toBe("%% timeline:start %%");
    expect(upsertBlock(`<!-- timeline:start -->\n${morning}\n`, evening, "## Places").kind).toBe("brokenMarkers");
    expect(upsertBlock(`${blockText(morning)}\n<!-- timeline:start -->`, evening, "## Places").kind).toBe(
      "brokenMarkers",
    );
  });

  it("keeps Windows line endings", () => {
    const note = "Line one\r\nLine two\r\n";
    expect(content(upsertBlock(note, evening, "## Places"))).toBe(
      `Line one\r\nLine two\r\n\r\n## Places\r\n${startMarker}\r\n${morning}\r\n- 20:10–now · **Home**\r\n${endMarker}\r\n`,
    );
  });

  it("reads the heading setting with or without hashes", () => {
    expect(normalizeHeading("## Places")).toBe("## Places");
    expect(normalizeHeading("Places")).toBe("## Places");
    expect(normalizeHeading("  ###   Where I went ")).toBe("### Where I went");
    expect(normalizeHeading("")).toBe("## Places");
  });
});

describe("the smallest edit", () => {
  it("changes only what differs, so an open editor keeps its cursor", () => {
    const before = `Intro\n${blockText(morning)}\nOutro`;
    const after = `Intro\n${blockText(evening)}\nOutro`;
    const edit = minimalEdit(before, after);
    expect(edit).not.toBeNull();
    if (!edit) return;
    expect(before.slice(0, edit.from) + edit.text + before.slice(edit.to)).toBe(after);
    expect(edit.from).toBeGreaterThan("Intro\n".length);
    expect(edit.text.trim()).toBe("- 20:10–now · **Home**");
    expect(minimalEdit(before, before)).toBeNull();
  });
});
