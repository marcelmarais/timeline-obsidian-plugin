import { type App, SuggestModal } from "obsidian";
import { addDays, isDate, localToday } from "./dates";

interface DateChoice {
  date: string;
  label: string;
}

const formatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const longDate = (date: string) => formatter.format(new Date(`${date}T00:00:00Z`));

/** Today, yesterday and the open note's date, or any date typed as YYYY-MM-DD. */
export class DateModal extends SuggestModal<DateChoice> {
  constructor(
    app: App,
    private readonly noteDate: string | null,
    private readonly onChoose: (date: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Type a date as YYYY-MM-DD, or pick one");
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to insert that day's places" },
      { command: "esc", purpose: "to dismiss" },
    ]);
  }

  getSuggestions(query: string): DateChoice[] {
    const today = localToday();
    const quick: DateChoice[] = [
      ...(this.noteDate ? [{ date: this.noteDate, label: `This note · ${longDate(this.noteDate)}` }] : []),
      { date: today, label: `Today · ${longDate(today)}` },
      { date: addDays(today, -1), label: `Yesterday · ${longDate(addDays(today, -1))}` },
    ];
    const unique = quick.filter((choice, index) => quick.findIndex((other) => other.date === choice.date) === index);
    const typed = query.trim();
    if (isDate(typed)) return [{ date: typed, label: longDate(typed) }];
    if (!typed) return unique;
    const lower = typed.toLowerCase();
    return unique.filter((choice) => choice.label.toLowerCase().includes(lower) || choice.date.startsWith(typed));
  }

  renderSuggestion(choice: DateChoice, el: HTMLElement): void {
    el.createDiv({ text: choice.label });
    el.createEl("small", { text: choice.date, cls: "timeline-location-history-date" });
  }

  onChooseSuggestion(choice: DateChoice): void {
    this.onChoose(choice.date);
  }
}
