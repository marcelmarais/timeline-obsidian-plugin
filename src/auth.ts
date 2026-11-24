/**
 * Signing in to Timeline with OAuth 2.1 and PKCE, the way agents connect to Timeline's MCP server. The browser does
 * the sign-in (Apple or Google) and sends the code back through Obsidian's own URL handler, so it works the same on
 * desktop and mobile. Tokens are for Timeline's history only (`timeline:read`), never for the person's Apple or
 * Google account.
 */

export const timelineOrigin = "https://timeline.place";
/** Obsidian hands `obsidian://timeline-location-history/?code=…` to the plugin's protocol handler. */
export const protocolAction = "timeline-location-history";
export const redirectUri = `obsidian://${protocolAction}/`;
/** Tokens are issued for Timeline's agent resource, which the JSON endpoints accept too. */
export const resource = `${timelineOrigin}/mcp`;
export const scope = "offline_access timeline:read";

const endpoints = {
  register: `${timelineOrigin}/api/auth/oauth2/register`,
  authorize: `${timelineOrigin}/api/auth/oauth2/authorize`,
  token: `${timelineOrigin}/api/auth/oauth2/token`,
  revoke: `${timelineOrigin}/api/auth/oauth2/revoke`,
};

/** How long a sign-in started in the browser stays valid. */
const pendingLifetimeMs = 15 * 60 * 1000;
/** Refresh this long before the access token expires. */
const refreshMarginMs = 60 * 1000;

export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  /** Sent as `application/x-www-form-urlencoded` or JSON. */
  form?: Record<string, string>;
  json?: unknown;
}

export interface HttpResponse {
  status: number;
  text: string;
}

/** One HTTP request; Obsidian's `requestUrl` in the plugin, a fake in tests. Throws only when there is no answer. */
export type Http = (request: HttpRequest) => Promise<HttpResponse>;

export interface Tokens {
  clientId: string;
  accessToken: string;
  refreshToken: string | null;
  /** Milliseconds since 1970. */
  expiresAt: number;
}

/** A sign-in waiting for the browser to come back. */
export interface PendingSignIn {
  clientId: string;
  state: string;
  verifier: string;
  startedAt: number;
}

/** Where tokens and the pending sign-in live: on this device only, never in the vault. */
export interface AuthStorage {
  loadTokens(): Tokens | null;
  saveTokens(tokens: Tokens | null): void;
  loadPending(): PendingSignIn | null;
  savePending(pending: PendingSignIn | null): void;
  /** The client this vault registered, reused for every sign-in. */
  loadClientId(): string | null;
  saveClientId(clientId: string | null): Promise<void>;
}

export type AuthErrorCode = "notConnected" | "reconnect" | "signInFailed" | "network";

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function randomToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** The S256 PKCE challenge for a verifier. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function parse(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class TimelineAuth {
  private refreshing: Promise<Tokens> | null = null;

  constructor(
    private readonly http: Http,
    private readonly storage: AuthStorage,
    private readonly clock: () => number = Date.now,
  ) {}

  get connected(): boolean {
    return this.storage.loadTokens() !== null;
  }

  /** The client this vault registered with Timeline, registering one the first time. */
  private async clientId(): Promise<string> {
    const saved = this.storage.loadClientId();
    if (saved) return saved;
    const response = await this.send({
      url: endpoints.register,
      method: "POST",
      json: {
        client_name: "Obsidian",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        application_type: "native",
        scope,
      },
    });
    const body = parse(response.text);
    if (response.status !== 201 && response.status !== 200) {
      throw new AuthError("signInFailed", "Timeline couldn't start the sign-in. Try again in a moment.");
    }
    const clientId = body.client_id;
    if (typeof clientId !== "string") {
      throw new AuthError("signInFailed", "Timeline couldn't start the sign-in. Try again in a moment.");
    }
    await this.storage.saveClientId(clientId);
    return clientId;
  }

  /** The address to open in the browser to sign in. */
  async startSignIn(): Promise<string> {
    const clientId = await this.clientId();
    const pending: PendingSignIn = { clientId, state: randomToken(), verifier: randomToken(48), startedAt: this.clock() };
    this.storage.savePending(pending);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope,
      resource,
      state: pending.state,
      code_challenge_method: "S256",
      code_challenge: await codeChallenge(pending.verifier),
    });
    return `${endpoints.authorize}?${params.toString()}`;
  }

  /** Finishes the sign-in with what the browser sent back to `obsidian://timeline-location-history/`. */
  async finishSignIn(params: Record<string, string>): Promise<void> {
    const pending = this.storage.loadPending();
    if (!pending || !params.state || params.state !== pending.state) {
      throw new AuthError("signInFailed", "This sign-in link has expired. Connect again from the plugin settings.");
    }
    this.storage.savePending(null);
    if (this.clock() - pending.startedAt > pendingLifetimeMs) {
      throw new AuthError("signInFailed", "This sign-in link has expired. Connect again from the plugin settings.");
    }
    if (params.iss && originOf(params.iss) !== timelineOrigin) {
      throw new AuthError("signInFailed", "That sign-in didn't come from Timeline.");
    }
    if (params.error) {
      throw new AuthError(
        "signInFailed",
        params.error === "access_denied" ? "Sign-in was cancelled." : "Timeline couldn't finish the sign-in.",
      );
    }
    if (!params.code) throw new AuthError("signInFailed", "Timeline couldn't finish the sign-in.");
    const tokens = await this.tokenRequest(pending.clientId, {
      grant_type: "authorization_code",
      code: params.code,
      code_verifier: pending.verifier,
      redirect_uri: redirectUri,
    });
    if (!tokens) throw new AuthError("signInFailed", "Timeline couldn't finish the sign-in. Connect again.");
    this.storage.saveTokens(tokens);
  }

  /** A valid access token, refreshed first when it is about to expire. */
  async accessToken(): Promise<string> {
    const tokens = this.storage.loadTokens();
    if (!tokens) throw new AuthError("notConnected", "Connect Timeline in the plugin settings first.");
    if (tokens.expiresAt - refreshMarginMs > this.clock()) return tokens.accessToken;
    return (await this.refresh()).accessToken;
  }

  /** Exchanges the refresh token for new tokens; one refresh at a time. Forgets the tokens when Timeline refuses. */
  refresh(): Promise<Tokens> {
    this.refreshing ??= this.refreshOnce().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refreshOnce(): Promise<Tokens> {
    const tokens = this.storage.loadTokens();
    if (!tokens) throw new AuthError("notConnected", "Connect Timeline in the plugin settings first.");
    if (!tokens.refreshToken) return this.disconnected();
    const next = await this.tokenRequest(tokens.clientId, {
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    });
    if (!next) return this.disconnected();
    const merged = { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken };
    this.storage.saveTokens(merged);
    return merged;
  }

  private disconnected(): never {
    this.storage.saveTokens(null);
    throw new AuthError("reconnect", "Timeline was disconnected. Connect again in the plugin settings.");
  }

  /** Revokes the refresh token at Timeline (best effort) and forgets the tokens on this device. */
  async signOut(): Promise<void> {
    const tokens = this.storage.loadTokens();
    this.storage.saveTokens(null);
    this.storage.savePending(null);
    if (!tokens?.refreshToken) return;
    try {
      await this.http({
        url: endpoints.revoke,
        method: "POST",
        form: { client_id: tokens.clientId, token: tokens.refreshToken, token_type_hint: "refresh_token" },
      });
    } catch {
      // Offline: the tokens are gone from this device, and the connection can be removed in Timeline's Settings.
    }
  }

  /** `null` when Timeline refuses the grant; throws when Timeline can't be reached. */
  private async tokenRequest(clientId: string, form: Record<string, string>): Promise<Tokens | null> {
    const response = await this.send({
      url: endpoints.token,
      method: "POST",
      form: { ...form, client_id: clientId, resource },
    });
    if (response.status >= 500) throw new AuthError("network", "Timeline couldn't answer right now. Try again soon.");
    if (response.status !== 200) return null;
    const body = parse(response.text);
    if (typeof body.access_token !== "string") return null;
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
    return {
      clientId,
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
      expiresAt: this.clock() + expiresIn * 1000,
    };
  }

  private async send(request: HttpRequest): Promise<HttpResponse> {
    try {
      return await this.http(request);
    } catch {
      throw new AuthError("network", "Couldn't reach Timeline. Check your connection and try again.");
    }
  }
}
