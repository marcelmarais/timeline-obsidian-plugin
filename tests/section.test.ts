import { describe, expect, it } from "vitest";
import { hasPlaces, isPlaceLine, minimalEdit, normalizeHeading, upsertBlock } from "../src/section";

const morning = "- 09:05–17:40 · **Work** (8h 35m)";
const evening = `${morning}\n- 20:10–now · **Home**`;

describe("the places under the heading", () => {
  it("adds a heading and list at the end of a note without one, leaving the note as it was", () => {
    const note = "# Tuesday\n\nSlept badly.\nTrain was late.";
    const update = upsertBlock(note, morning, "## Places");
    expect(update.kind).toBe("appended");
    expect(update.content).toBe(`${note}\n\n## Places\n${morning}\n`);
    expect(upsertBlock("", morning, "## Places").content).toBe(`## Places\n${morning}\n`);
    // A note that ends in a newline gets just one more.
    expect(upsertBlock("Notes\n", morning, "## Places").content).toBe(`Notes\n\n## Places\n${morning}\n`);
  });

  it("puts the list under the heading when the note already has it", () => {
    const note = "# Tuesday\n\n## Places\nWent climbing after work.\n\n## Tasks\n- [ ] Call Jonas";
    const update = upsertBlock(note, morning, "## Places");
    expect(update.kind).toBe("insertedUnderHeading");
    expect(update.content).toBe(
      `# Tuesday\n\n## Places\n${morning}\n\nWent climbing after work.\n\n## Tasks\n- [ ] Call Jonas`,
    );
    // Matching ignores case and closing hashes, but not the level.
    expect(upsertBlock("## places ##\n", morning, "Places").kind).toBe("insertedUnderHeading");
    expect(upsertBlock("### Places\n", morning, "## Places").kind).toBe("appended");
    // A heading inside a code block isn't one.
    expect(upsertBlock("```\n## Places\n```\n", morning, "## Places").kind).toBe("appended");
  });

  it("updates the stops in place as the day goes on, keeping what the person wrote", () => {
    const first = upsertBlock("# Tuesday\n\nMorning notes.", morning, "## Places").content;
    // The person adds a line of their own straight after the list, and more below.
    const edited = first.replace(morning, `${morning}\n- Forgot my keys at work`).concat("Evening notes.\n");
    const second = upsertBlock(edited, evening, "## Places");
    expect(second.kind).toBe("replaced");
    expect(second.content).toBe(edited.replace(morning, evening));
    // Syncing the same stops again changes nothing.
    const third = upsertBlock(second.content, evening, "## Places");
    expect(third).toMatchObject({ kind: "replaced", changed: false });
    expect(third.content).toBe(second.content);
  });

  it("finds the list after blank lines under the heading, and leaves the person's own list alone", () => {
    expect(upsertBlock(`## Places\n\n${morning}\n\nAfter.`, evening, "## Places").content).toBe(
      `## Places\n\n${evening}\n\nAfter.`,
    );
    const own = "## Places\n- Bakery\n- Park";
    expect(upsertBlock(own, morning, "## Places").content).toBe(`## Places\n${morning}\n\n- Bakery\n- Park`);
  });

  it("knows its own lines", () => {
    for (const line of [
      morning,
      "- 17:40–17:55 · *on foot 5m, then by train 10m*",
      "- 10:12–11:40 · **Lisbon, Portugal** *(from photos)*",
      "  - Note: 80 kg felt easy",
      "  - Note (Claude): Booked for Friday",
      "- *No stops recorded.*",
      "- **Home** *(time not reported)*",
    ]) {
      expect(isPlaceLine(line), line).toBe(true);
    }
    for (const line of ["- Bakery", "Went climbing.", "", "## Tasks", "- [ ] Call Jonas"]) {
      expect(isPlaceLine(line), line).toBe(false);
    }
  });

  it("replaces an older build's comments, and the list between them, with the plain list", () => {
    for (const [start, end] of [
      ["%% timeline:start %%", "%% timeline:end %%"],
      ["<!-- timeline:start -->", "<!-- timeline:end -->"],
    ]) {
      const old = `# Tuesday\n\n## Places\n${start}\n${morning}\n${end}\n\nAfterwards.`;
      expect(hasPlaces(old, "## Places")).toBe(true);
      expect(upsertBlock(old, evening, "## Places").content).toBe(`# Tuesday\n\n## Places\n${evening}\n\nAfterwards.`);
    }
  });

  it("says whether a note already has places", () => {
    expect(hasPlaces(`## Places\n${morning}\n`, "## Places")).toBe(true);
    expect(hasPlaces("## Places\nWent climbing.\n", "## Places")).toBe(false);
    expect(hasPlaces(`${morning}\n`, "## Places")).toBe(false);
  });

  it("keeps Windows line endings", () => {
    const note = "Line one\r\nLine two\r\n";
    expect(upsertBlock(note, evening, "## Places").content).toBe(
      `Line one\r\nLine two\r\n\r\n## Places\r\n${morning}\r\n- 20:10–now · **Home**\r\n`,
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
    const before = `Intro\n## Places\n${morning}\n\nOutro`;
    const after = upsertBlock(before, evening, "## Places").content;
    const edit = minimalEdit(before, after);
    expect(edit).not.toBeNull();
    if (!edit) return;
    expect(before.slice(0, edit.from) + edit.text + before.slice(edit.to)).toBe(after);
    expect(edit.from).toBeGreaterThan("Intro\n## Places\n".length);
    expect(edit.text.trim()).toBe("- 20:10–now · **Home**");
    expect(minimalEdit(before, before)).toBeNull();
  });
});
