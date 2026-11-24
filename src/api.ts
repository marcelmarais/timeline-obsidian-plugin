import { AuthError, type AuthErrorCode, type Http, type HttpResponse, type TimelineAuth, timelineOrigin } from "./auth";
import type { Current, Day } from "./types";

/**
 * Timeline's read-only history endpoints. Each request carries the access token; a refused token is refreshed once
 * and the request tried again.
 */

export type TimelineErrorCode =
  | AuthErrorCode
  | "subscriptionNeeded"
  | "subscriptionEnded"
  | "nothingShared"
  | "invalidDate"
  | "server";

/** What the person can do about each problem, in words for a notice or the settings. */
export const problemText: Record<TimelineErrorCode, string> = {
  notConnected: "Connect Timeline in the plugin settings first.",
  reconnect: "Timeline was disconnected. Connect again in the plugin settings.",
  signInFailed: "Timeline couldn't finish signing in. Connect again in the plugin settings.",
  network: "Couldn't reach Timeline. Check your connection and try again.",
  subscriptionNeeded:
    "Timeline Pro is required. Start it in the Timeline iPhone app under Settings › Timeline Pro, then sign in with the same account.",
  subscriptionEnded:
    "Timeline Pro has ended for this account. Renew it in the Timeline iPhone app under Settings › Timeline Pro to sync again.",
  nothingShared:
    "Your iPhone isn't sharing any history yet. In the Timeline iPhone app, open Settings › Agents › Other agent, sign in with the same account, and choose what to share.",
  invalidDate: "Use a date written as YYYY-MM-DD.",
  server: "Timeline isn't responding right now. Try again in a moment.",
};

export class TimelineError extends Error {
  constructor(readonly code: TimelineErrorCode) {
    super(problemText[code]);
    this.name = "TimelineError";
  }
}

const refusals = new Set<string>(["subscriptionNeeded", "subscriptionEnded", "nothingShared"]);

function errorOf(response: HttpResponse): string | null {
  try {
    const body = JSON.parse(response.text) as { error?: unknown };
    return typeof body.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

export class TimelineApi {
  constructor(
    private readonly http: Http,
    private readonly auth: TimelineAuth,
  ) {}

  /** One local day of history; `date` is YYYY-MM-DD. */
  day(date: string): Promise<Day> {
    return this.get<Day>(`/api/obsidian/day?date=${encodeURIComponent(date)}`);
  }

  /** Where the person was last seen. */
  current(): Promise<Current> {
    return this.get<Current>("/api/obsidian/current");
  }

  private async get<T>(path: string): Promise<T> {
    try {
      let response = await this.send(path, await this.auth.accessToken());
      if (response.status === 401) response = await this.send(path, (await this.auth.refresh()).accessToken);
      if (response.status === 401) {
        await this.auth.signOut();
        throw new TimelineError("reconnect");
      }
      if (response.status === 200) return JSON.parse(response.text) as T;
      const error = errorOf(response);
      if (response.status === 403 && error && refusals.has(error)) throw new TimelineError(error as TimelineErrorCode);
      if (response.status === 400 && error === "invalidDate") throw new TimelineError("invalidDate");
      throw new TimelineError("server");
    } catch (error) {
      if (error instanceof AuthError) throw new TimelineError(error.code);
      if (error instanceof SyntaxError) throw new TimelineError("server");
      throw error;
    }
  }

  private async send(path: string, token: string): Promise<HttpResponse> {
    try {
      return await this.http({
        url: `${timelineOrigin}${path}`,
        method: "GET",
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
    } catch {
      throw new TimelineError("network");
    }
  }
}
