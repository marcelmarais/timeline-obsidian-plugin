import { describe, expect, it } from "vitest";
import { TimelineApi, TimelineError } from "../src/api";
import {
  type AuthStorage,
  base64Url,
  codeChallenge,
  type Http,
  type HttpRequest,
  type HttpResponse,
  type PendingSignIn,
  redirectUri,
  resource,
  TimelineAuth,
  type Tokens,
} from "../src/auth";

function memoryStorage(initial: { tokens?: Tokens; clientId?: string } = {}) {
  const state: { tokens: Tokens | null; pending: PendingSignIn | null; clientId: string | null } = {
    tokens: initial.tokens ?? null,
    pending: null,
    clientId: initial.clientId ?? null,
  };
  const storage: AuthStorage = {
    loadTokens: () => state.tokens,
    saveTokens: (tokens) => {
      state.tokens = tokens;
    },
    loadPending: () => state.pending,
    savePending: (pending) => {
      state.pending = pending;
    },
    loadClientId: () => state.clientId,
    saveClientId: (clientId) => {
      state.clientId = clientId;
      return Promise.resolve();
    },
  };
  return { state, storage };
}

/** A fake Timeline: answers by URL, and records every request. */
function fakeHttp(answer: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>) {
  const requests: HttpRequest[] = [];
  const http: Http = async (request) => {
    requests.push(request);
    return answer(request);
  };
  return { http, requests };
}

const json = (status: number, body: unknown): HttpResponse => ({ status, text: JSON.stringify(body) });
const tokens = (overrides: Partial<Tokens> = {}): Tokens => ({
  clientId: "client-1",
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: Date.now() + 3_600_000,
  ...overrides,
});
const emptyDay = { date: "2026-11-24", stops: [], photoPlaces: [] };

describe("signing in", () => {
  it("registers once, sends PKCE and the resource, and keeps the tokens on finishing", async () => {
    const { http, requests } = fakeHttp((request) => {
      if (request.url.endsWith("/oauth2/register")) return json(201, { client_id: "client-1" });
      if (request.url.endsWith("/oauth2/token")) {
        return json(200, { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 });
      }
      return json(404, {});
    });
    const { state, storage } = memoryStorage();
    const auth = new TimelineAuth(http, storage);
    const url = new URL(await auth.startSignIn());
    expect(url.origin + url.pathname).toBe("https://timeline.place/api/auth/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "client-1",
      redirect_uri: "obsidian://timeline-location-history/",
      response_type: "code",
      scope: "offline_access timeline:read",
      resource: "https://timeline.place/mcp",
      code_challenge_method: "S256",
    });
    const pending = state.pending;
    if (!pending) throw new Error("Missing pending sign-in");
    expect(url.searchParams.get("state")).toBe(pending.state);
    expect(url.searchParams.get("code_challenge")).toBe(await codeChallenge(pending.verifier));
    expect(requests[0]?.json).toMatchObject({ client_name: "Obsidian", redirect_uris: [redirectUri] });

    await auth.finishSignIn({ action: "timeline-location-history", code: "code-1", state: pending.state });
    expect(requests[1]?.form).toMatchObject({
      grant_type: "authorization_code",
      code: "code-1",
      code_verifier: pending.verifier,
      redirect_uri: redirectUri,
      client_id: "client-1",
      resource,
    });
    expect(state.tokens).toMatchObject({ clientId: "client-1", accessToken: "access-1", refreshToken: "refresh-1" });
    expect(state.pending).toBeNull();

    // The next sign-in reuses the registered client.
    await auth.startSignIn();
    expect(requests.filter((request) => request.url.endsWith("/oauth2/register"))).toHaveLength(1);
  });

  it("refuses a callback with the wrong state, an error, or one that came too late", async () => {
    const { http, requests } = fakeHttp(() => json(201, { client_id: "client-1" }));
    const { state, storage } = memoryStorage();
    let time = 1_000_000;
    const auth = new TimelineAuth(http, storage, () => time);
    await auth.startSignIn();
    await expect(auth.finishSignIn({ action: "x", code: "c", state: "forged" })).rejects.toThrow(/expired/);

    await auth.startSignIn();
    await expect(
      auth.finishSignIn({ action: "x", error: "access_denied", state: state.pending?.state ?? "" }),
    ).rejects.toThrow("Sign-in was cancelled.");

    await auth.startSignIn();
    time += 20 * 60 * 1000;
    await expect(auth.finishSignIn({ action: "x", code: "c", state: state.pending?.state ?? "" })).rejects.toThrow(
      /expired/,
    );
    expect(requests.some((request) => request.url.endsWith("/oauth2/token"))).toBe(false);
    expect(state.tokens).toBeNull();
  });

  it("revokes the refresh token on disconnect and forgets the tokens even offline", async () => {
    const { http, requests } = fakeHttp(() => {
      throw new Error("offline");
    });
    const { state, storage } = memoryStorage({ tokens: tokens() });
    await new TimelineAuth(http, storage).signOut();
    expect(requests[0]).toMatchObject({
      url: "https://timeline.place/api/auth/oauth2/revoke",
      form: { client_id: "client-1", token: "refresh-1", token_type_hint: "refresh_token" },
    });
    expect(state.tokens).toBeNull();
  });
});

describe("reading history", () => {
  it("sends the access token and reads the day", async () => {
    const { http, requests } = fakeHttp(() => json(200, emptyDay));
    const api = new TimelineApi(http, new TimelineAuth(http, memoryStorage({ tokens: tokens() }).storage));
    expect(await api.day("2026-11-24")).toEqual(emptyDay);
    expect(requests[0]).toMatchObject({
      url: "https://timeline.place/api/obsidian/day?date=2026-11-24",
      method: "GET",
      headers: { authorization: "Bearer access-1" },
    });
  });

  it("refreshes an expired token before asking, and a refused one after", async () => {
    let issued = 1;
    const { http, requests } = fakeHttp((request) => {
      if (request.url.endsWith("/oauth2/token")) {
        issued += 1;
        return json(200, { access_token: `access-${issued}`, refresh_token: `refresh-${issued}`, expires_in: 3600 });
      }
      const token = request.headers?.authorization;
      return token === "Bearer access-3" ? json(200, emptyDay) : json(401, { error: "reconnect" });
    });
    const { state, storage } = memoryStorage({ tokens: tokens({ expiresAt: Date.now() - 1000 }) });
    const api = new TimelineApi(http, new TimelineAuth(http, storage));
    expect(await api.day("2026-11-24")).toEqual(emptyDay);
    // Expired → refreshed to access-2, refused → refreshed again to access-3, which works.
    expect(requests.map((request) => request.form?.grant_type ?? request.headers?.authorization)).toEqual([
      "refresh_token",
      "Bearer access-2",
      "refresh_token",
      "Bearer access-3",
    ]);
    expect(requests[0]?.form).toMatchObject({ refresh_token: "refresh-1", resource });
    expect(state.tokens).toMatchObject({ accessToken: "access-3", refreshToken: "refresh-3" });
  });

  it("asks to connect again when the refresh token is refused, and forgets the tokens", async () => {
    const { http } = fakeHttp((request) =>
      request.url.endsWith("/oauth2/token") ? json(400, { error: "invalid_grant" }) : json(401, { error: "reconnect" }),
    );
    const { state, storage } = memoryStorage({ tokens: tokens() });
    const api = new TimelineApi(http, new TimelineAuth(http, storage));
    await expect(api.current()).rejects.toMatchObject({ code: "reconnect" });
    expect(state.tokens).toBeNull();
    await expect(api.current()).rejects.toMatchObject({ code: "notConnected" });
  });

  it("says what to do when Timeline Pro is missing or ended, or nothing is shared", async () => {
    for (const code of ["subscriptionNeeded", "subscriptionEnded", "nothingShared"] as const) {
      const { http } = fakeHttp(() => json(403, { error: code }));
      const api = new TimelineApi(http, new TimelineAuth(http, memoryStorage({ tokens: tokens() }).storage));
      const error = await api.day("2026-11-24").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(TimelineError);
      expect(error).toMatchObject({ code });
    }
    const { http } = fakeHttp(() => json(403, { error: "nothingShared" }));
    const api = new TimelineApi(http, new TimelineAuth(http, memoryStorage({ tokens: tokens() }).storage));
    await expect(api.day("2026-11-24")).rejects.toThrow(/Settings › Agents/);
  });

  it("tells a network failure from a server error", async () => {
    const offline = fakeHttp(() => {
      throw new Error("offline");
    }).http;
    const api = new TimelineApi(offline, new TimelineAuth(offline, memoryStorage({ tokens: tokens() }).storage));
    await expect(api.day("2026-11-24")).rejects.toMatchObject({ code: "network" });
    const broken = fakeHttp(() => ({ status: 500, text: "<html>" })).http;
    const failing = new TimelineApi(broken, new TimelineAuth(broken, memoryStorage({ tokens: tokens() }).storage));
    await expect(failing.day("2026-11-24")).rejects.toMatchObject({ code: "server" });
  });

  it("is not connected without tokens", async () => {
    const { http, requests } = fakeHttp(() => json(200, emptyDay));
    const api = new TimelineApi(http, new TimelineAuth(http, memoryStorage().storage));
    await expect(api.day("2026-11-24")).rejects.toMatchObject({ code: "notConnected" });
    expect(requests).toHaveLength(0);
  });
});

describe("PKCE encoding", () => {
  it("writes base64url without padding for every length", () => {
    for (let length = 0; length <= 40; length++) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 97 + length * 13) % 256);
      expect(base64Url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    }
    expect(base64Url(Uint8Array.from([0xfb, 0xff, 0xbf]))).toBe("-_-_");
  });

  it("makes RFC 7636's example code challenge", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});
