import { describe, expect, it } from "vitest";
import {
  addDays,
  dailyNoteDate,
  dailyNotePath,
  dateFromTitle,
  dateOfNote,
  fillTemplate,
  isDate,
  localToday,
} from "../src/dates";
import { moment } from "./moment";

const plain = { folder: "", format: "YYYY-MM-DD", template: "" };
const nested = { folder: "Journal/", format: "YYYY/MM/YYYY-MM-DD ddd", template: "" };

describe("dates in titles", () => {
  it("finds the first real YYYY-MM-DD date", () => {
    expect(dateFromTitle("2026-11-24")).toBe("2026-11-24");
    expect(dateFromTitle("Standup 2026-11-24 notes")).toBe("2026-11-24");
    expect(dateFromTitle("2026-02-30 then 2026-03-01")).toBe("2026-03-01");
    expect(dateFromTitle("Invoice 12026-11-245")).toBeNull();
    expect(dateFromTitle("Groceries")).toBeNull();
  });

  it("checks calendar dates and counts days", () => {
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("24.11.2026")).toBe(false);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(localToday(new Date(2026, 10, 24, 23, 59))).toBe("2026-11-24");
  });
});

describe("daily notes", () => {
  it("knows where a date's daily note lives", () => {
    expect(dailyNotePath("2026-11-24", plain, moment)).toBe("2026-11-24.md");
    expect(dailyNotePath("2026-11-24", nested, moment)).toBe("Journal/2026/11/2026-11-24 Tue.md");
    expect(dailyNotePath("2026-11-24", { ...plain, folder: "/Daily//" }, moment)).toBe("Daily/2026-11-24.md");
  });

  it("reads a note's date from its daily notes path, then from its title", () => {
    expect(dateOfNote("Journal/2026/11/2026-11-24 Tue.md", nested, moment)).toBe("2026-11-24");
    expect(dateOfNote("24 November 2026.md", { ...plain, format: "D MMMM YYYY" }, moment)).toBe("2026-11-24");
    // Outside the daily notes folder, a date in the title still counts for "Sync this note's date".
    expect(dateOfNote("Meetings/2026-11-20 Planning.md", nested, moment)).toBe("2026-11-20");
    expect(dateOfNote("Meetings/Planning.md", nested, moment)).toBeNull();
  });

  it("tells a daily note from a note that only mentions a date", () => {
    expect(dailyNoteDate("2026-11-24.md", plain, moment)).toBe("2026-11-24");
    expect(dailyNoteDate("Journal/2026/11/2026-11-24 Tue.md", nested, moment)).toBe("2026-11-24");
    expect(dailyNoteDate("2026-11-24 Standup.md", plain, moment)).toBeNull();
    expect(dailyNoteDate("Archive/2026-11-24.md", plain, moment)).toBeNull();
  });

  it("fills a daily note template as Obsidian does", () => {
    const template = "# {{title}}\nCreated {{date}} at {{time}}\n{{date:dddd, D MMMM}} · {{ time:HH }}h";
    expect(fillTemplate(template, "2026-11-24", "YYYY-MM-DD", moment, new Date(2026, 10, 24, 7, 5))).toBe(
      "# 2026-11-24\nCreated 2026-11-24 at 07:05\nTuesday, 24 November · 07h",
    );
  });
});
