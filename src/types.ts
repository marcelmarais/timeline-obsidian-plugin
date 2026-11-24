/**
 * What timeline.place answers, as `web/lib/history/structured.ts` defines it. Times are ISO 8601 with the person's
 * local offset ("2026-11-24T09:05:00+01:00"), so the local date and time can be read straight from the text.
 */

export type Travel =
  | "foot"
  | "cycle"
  | "vehicle"
  | "road"
  | "rail"
  | "car"
  | "bus"
  | "tram"
  | "underground"
  | "train"
  | "flight"
  | "boat";

/**
 * How sure the place is: `saved` (the person's own, certain), `named`, `guess` (probably that place), `address`
 * (only an address), `unnamed`.
 */
export type PlaceKind = "saved" | "named" | "guess" | "address" | "unnamed";

export interface Place {
  kind: PlaceKind;
  name: string | null;
  address: string | null;
  city: string | null;
  category: string | null;
  /** Who corrected the place: `you` or an agent's name. */
  chosenBy: string | null;
}

export interface Note {
  author: string;
  text: string;
  yours: boolean;
}

export interface Leg {
  travel: Travel;
  start: string;
  end: string;
  chosenBy: string | null;
}

export interface Stop {
  arrival: string | null;
  /** `null` while no departure has been reported, which does not mean the person is still there. */
  departure: string | null;
  /** When the phone's last position was still at this stop. */
  stillThereAt: string | null;
  place: Place;
  travelAfter: Leg[] | null;
  notes: Note[];
}

export interface PhotoPlace {
  firstPhoto: string;
  lastPhoto: string;
  place: { kind: "saved" | "address" | "area" | "unnamed"; name: string | null };
}

export interface Day {
  date: string;
  today: string;
  timeZone: string;
  status: "uploaded" | "notUploaded" | "beforeFirstUpload" | "future";
  recording: string | null;
  sharedFrom: string | null;
  lastSync: string | null;
  stops: Stop[];
  photoPlaces: PhotoPlace[];
}

export interface Current {
  timeZone: string;
  today: string;
  lastSeen: { at: string; label: string | null; approximateMeters: number | null; stale: boolean } | null;
  stop: { state: "there" | "left" | "noDeparture"; arrival: string | null; departure: string | null; place: Place } | null;
  travel: { travel: Travel; since: string } | null;
}
