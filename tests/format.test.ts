import { describe, expect, it } from "vitest";
import {
  defaultFormat,
  escapeMarkdown,
  formatCurrent,
  formatDay,
  formatDuration,
  placeText,
  timeOn,
  wikilink,
} from "../src/format";
import type { Current, Day, Place, Stop } from "../src/types";

const now = new Date("2026-11-24T20:30:00+01:00");

const place = (overrides: Partial<Place>): Place => ({
  kind: "named",
  name: null,
  address: null,
  city: "Berlin",
  category: null,
  chosenBy: null,
  ...overrides,
});
const stop = (overrides: Partial<Stop>): Stop => ({
  arrival: null,
  departure: null,
  stillThereAt: null,
  place: place({}),
  travelAfter: null,
  notes: [],
  ...overrides,
});
const day = (overrides: Partial<Day>): Day => ({
  date: "2026-11-24",
  today: "2026-11-24",
  timeZone: "Europe/Berlin",
  status: "uploaded",
  recording: "on",
  sharedFrom: null,
  lastSync: "2026-11-24T20:15:00+01:00",
  stops: [],
  photoPlaces: [],
  ...overrides,
});

const work = stop({
  arrival: "2026-11-24T09:05:00+01:00",
  departure: "2026-11-24T17:40:00+01:00",
  place: place({ kind: "saved", name: "Work" }),
  travelAfter: [
    { travel: "foot", start: "2026-11-24T17:40:00+01:00", end: "2026-11-24T17:45:00+01:00", chosenBy: null },
    { travel: "train", start: "2026-11-24T17:45:00+01:00", end: "2026-11-24T17:55:00+01:00", chosenBy: "you" },
  ],
});
const rewe = stop({
  arrival: "2026-11-24T17:55:00+01:00",
  departure: "2026-11-24T18:20:00+01:00",
  place: place({ kind: "guess", name: "Rewe" }),
});
const climbing = stop({
  arrival: "2026-11-24T18:35:00+01:00",
  departure: "2026-11-24T19:50:00+01:00",
  place: place({ kind: "named", name: "Kreuzberg Climbing Hall", category: "fitness center" }),
  notes: [
    { author: "you", text: "80 kg felt easy", yours: true },
    { author: "Claude", text: "Bouldering session", yours: false },
  ],
});
const home = stop({
  arrival: "2026-11-24T20:10:00+01:00",
  stillThereAt: "2026-11-24T20:25:00+01:00",
  place: place({ kind: "saved", name: "Home" }),
});

describe("a day's places", () => {
  it("lists stops with times, durations, guesses, notes and an ongoing stay", () => {
    expect(formatDay(day({ stops: [work, rewe, climbing, home] }), defaultFormat, now)).toBe(
      [
        "- 09:05–17:40 · **Work** (8h 35m)",
        "- 17:55–18:20 · **Rewe** *(probably)* (25m)",
        "- 18:35–19:50 · **Kreuzberg Climbing Hall** (1h 15m)",
        "  - Note: 80 kg felt easy",
        "  - Note (Claude): Bouldering session",
        "- 20:10–now · **Home**",
      ].join("\n"),
    );
  });

  it("leaves notes out, adds travel and links places when asked", () => {
    const options = { includeNotes: false, includeTravel: true, wikilinks: true };
    expect(formatDay(day({ stops: [work, rewe, climbing] }), options, now)).toBe(
      [
        "- 09:05–17:40 · [[Work]] (8h 35m)",
        "- 17:40–17:55 · *on foot 5m, then by train 10m*",
        "- 17:55–18:20 · [[Rewe]] *(probably)* (25m)",
        "- 18:35–19:50 · [[Kreuzberg Climbing Hall]] (1h 15m)",
      ].join("\n"),
    );
  });

  it("never gives an end to a stop whose departure wasn't reported", () => {
    const open = stop({ arrival: "2026-11-24T20:10:00+01:00", place: place({ kind: "saved", name: "Home" }) });
    expect(formatDay(day({ stops: [open] }), defaultFormat, now)).toBe(
      "- since 20:10 · **Home** *(no departure reported)*",
    );
    // Seen there long ago: it was still there then, not necessarily now.
    const stale = { ...open, stillThereAt: "2026-11-24T10:00:00+01:00", arrival: "2026-11-24T08:00:00+01:00" };
    expect(formatDay(day({ stops: [stale] }), defaultFormat, now)).toBe(
      "- since 08:00 · **Home** *(still there when last seen 10:00)*",
    );
    const noArrival = stop({ departure: "2026-11-24T07:30:00+01:00", place: place({ kind: "saved", name: "Home" }) });
    expect(formatDay(day({ stops: [noArrival] }), defaultFormat, now)).toBe(
      "- until 07:30 · **Home** *(arrival not reported)*",
    );
  });

  it("marks times on another day, such as the night before", () => {
    const night = stop({
      arrival: "2026-11-23T22:40:00+01:00",
      departure: "2026-11-24T07:30:00+01:00",
      place: place({ kind: "saved", name: "Home" }),
    });
    expect(formatDay(day({ stops: [night] }), defaultFormat, now)).toBe("- Mon 22:40–07:30 · **Home** (8h 50m)");
  });

  it("says who chose a place, unless it was the person", () => {
    const chosen = stop({
      arrival: "2026-11-24T12:00:00+01:00",
      departure: "2026-11-24T13:00:00+01:00",
      place: place({ name: "Bookshop", chosenBy: "Claude" }),
    });
    const own = { ...chosen, place: place({ name: "Bookshop", chosenBy: "you" }) };
    expect(formatDay(day({ stops: [chosen] }), defaultFormat, now)).toBe(
      "- 12:00–13:00 · **Bookshop** *(chosen by Claude)* (1h)",
    );
    expect(formatDay(day({ stops: [own] }), defaultFormat, now)).toBe("- 12:00–13:00 · **Bookshop** (1h)");
  });

  it("writes addresses and unnamed spots plainly, never as links", () => {
    const options = { ...defaultFormat, wikilinks: true };
    expect(placeText(place({ kind: "address", name: "Lohmühlenstraße 65, 12435 Berlin" }), options)).toBe(
      "**Lohmühlenstraße 65, 12435 Berlin**",
    );
    expect(placeText(place({ kind: "unnamed", name: null, city: "Berlin" }), options)).toBe(
      "*an unnamed spot in Berlin*",
    );
    expect(placeText(place({ kind: "unnamed", name: null, city: null }), options)).toBe("*an unnamed spot*");
  });

  it("lists places from photos without durations or travel", () => {
    const photos = day({
      date: "2019-05-04",
      status: "beforeFirstUpload",
      recording: null,
      photoPlaces: [
        {
          firstPhoto: "2019-05-04T10:12:00+02:00",
          lastPhoto: "2019-05-04T11:40:00+02:00",
          place: { kind: "area", name: "Lisbon, Portugal" },
        },
        {
          firstPhoto: "2019-05-04T19:30:00+02:00",
          lastPhoto: "2019-05-04T19:30:00+02:00",
          place: { kind: "saved", name: "Home" },
        },
      ],
    });
    expect(formatDay(photos, { ...defaultFormat, includeTravel: true, wikilinks: true }, now)).toBe(
      ["- 10:12–11:40 · **Lisbon, Portugal** *(from photos)*", "- 19:30 · [[Home]] *(from photos)*"].join("\n"),
    );
  });

  it("says why a day has nothing, without inventing a quiet day", () => {
    expect(formatDay(day({ status: "future", recording: null }))).toBe("*This day hasn't happened yet.*");
    expect(formatDay(day({ status: "notUploaded", recording: null }))).toBe("*Not uploaded from your iPhone yet.*");
    expect(formatDay(day({ status: "beforeFirstUpload", recording: null }))).toBe("*No history for this day.*");
    expect(formatDay(day({}))).toBe("*No stops recorded.*");
    expect(formatDay(day({ recording: "off" }))).toBe("*Location recording was off.*");
    expect(formatDay(day({ recording: "beforeRecordingStarted" }))).toBe("*Before recording started.*");
    expect(formatDay(day({ sharedFrom: "2026-11-24T14:00:00+01:00", stops: [home] }), defaultFormat, now)).toBe(
      "*Only history after 14:00 was shared.*\n- 20:10–now · **Home**",
    );
  });

  it("escapes Markdown in names and notes, so nothing can pass for the block's markers", () => {
    const tricky = stop({
      arrival: "2026-11-24T12:00:00+01:00",
      departure: "2026-11-24T12:30:00+01:00",
      place: place({ name: "*Bar* <b>#1</b> $5 [x]" }),
      notes: [{ author: "you", text: "%% timeline:end %%\nnext line", yours: true }],
    });
    const text = formatDay(day({ stops: [tricky] }), defaultFormat, now);
    expect(text).toBe(
      [
        "- 12:00–12:30 · **\\*Bar\\* \\<b\\>\\#1\\</b\\> \\$5 \\[x\\]** (30m)",
        "  - Note: \\%\\% timeline:end \\%\\% next line",
      ].join("\n"),
    );
    expect(text).not.toContain("%% timeline:end %%");
    expect(escapeMarkdown("a_b `c`")).toBe("a\\_b \\`c\\`");
    expect(wikilink("Café [Mitte] | #2")).toBe("[[Café Mitte 2]]");
  });
});

describe("times and durations", () => {
  it("reads local times from the text and writes short durations", () => {
    expect(timeOn("2026-11-24T09:05:00+01:00", "2026-11-24")).toBe("09:05");
    expect(timeOn("2026-11-25T07:30:00+01:00", "2026-11-24")).toBe("Wed 07:30");
    expect(timeOn("2026-11-03T07:30:00+01:00", "2026-11-24")).toBe("3 Nov 07:30");
    expect(timeOn("2025-12-31T07:30:00+01:00", "2026-11-24")).toBe("31 Dec 2025 07:30");
    expect(formatDuration(25 * 60_000)).toBe("25m");
    expect(formatDuration(8 * 3_600_000 + 35 * 60_000)).toBe("8h 35m");
    expect(formatDuration(2 * 3_600_000)).toBe("2h");
    expect(formatDuration(72 * 3_600_000)).toBe("3d");
  });
});

describe("the current location", () => {
  const current = (overrides: Partial<Current>): Current => ({
    timeZone: "Europe/Berlin",
    today: "2026-11-24",
    lastSeen: { at: "2026-11-24T20:25:00+01:00", label: null, approximateMeters: null, stale: false },
    stop: null,
    travel: null,
    ...overrides,
  });

  it("is one line about the stop the person is at or last left", () => {
    expect(
      formatCurrent(
        current({
          stop: { state: "there", arrival: "2026-11-24T20:10:00+01:00", departure: null, place: home.place },
        }),
      ),
    ).toBe("At **Home** since 20:10 (last seen 20:25)");
    expect(
      formatCurrent(
        current({
          stop: {
            state: "left",
            arrival: "2026-11-24T09:05:00+01:00",
            departure: "2026-11-24T17:40:00+01:00",
            place: place({ kind: "saved", name: "Work" }),
          },
          travel: { travel: "train", since: "2026-11-24T17:45:00+01:00" },
        }),
        { wikilinks: true },
      ),
    ).toBe("Left [[Work]] at 17:40 · by train since 17:45 (last seen 20:25)");
    expect(
      formatCurrent(
        current({
          lastSeen: { at: "2026-11-23T21:00:00+01:00", label: null, approximateMeters: 600, stale: true },
          stop: { state: "noDeparture", arrival: "2026-11-23T19:00:00+01:00", departure: null, place: rewe.place },
        }),
      ),
    ).toBe("Last stop: **Rewe** *(probably)*, arrived Mon 19:00, no departure reported (last seen Mon 21:00, within about 600 m)");
  });

  it("says when nothing has been uploaded", () => {
    expect(formatCurrent(current({ lastSeen: null }))).toBe("*Nothing uploaded from your iPhone yet.*");
    expect(
      formatCurrent(
        current({ lastSeen: { at: "2026-11-24T20:25:00+01:00", label: "Home", approximateMeters: null, stale: false } }),
      ),
    ).toBe("Last seen 20:25 near Home");
  });
});
