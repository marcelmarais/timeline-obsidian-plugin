import { type App, requestUrl } from "obsidian";
import { AuthError, type AuthStorage, type Http, type PendingSignIn, type Tokens } from "./auth";

/** Every request goes through Obsidian's `requestUrl`, which works on desktop and mobile without CORS. */
export const obsidianHttp: Http = async (request) => {
  const form = request.form ? new URLSearchParams(request.form).toString() : undefined;
  const response = await requestUrl({
    url: request.url,
    method: request.method,
    headers: request.headers,
    contentType: form ? "application/x-www-form-urlencoded" : request.json === undefined ? undefined : "application/json",
    body: form ?? (request.json === undefined ? undefined : JSON.stringify(request.json)),
    throw: false,
  });
  return { status: response.status, text: response.text };
};

const tokensSecret = "timeline-location-history-tokens";
const pendingKey = "timeline-location-history-pending-sign-in";

/**
 * Tokens live in Obsidian's secret storage and the pending sign-in in the vault's local storage: both stay on this
 * device and out of the vault's files, so they never travel with Sync, iCloud or git. The registered client ID is
 * not a secret and is kept with the plugin's settings.
 */
export function obsidianAuthStorage(
  app: App,
  clientId: { load: () => string | null; save: (value: string | null) => Promise<void> },
): AuthStorage {
  return {
    loadTokens() {
      const raw = app.secretStorage.getSecret(tokensSecret);
      if (!raw) return null;
      try {
        const value = JSON.parse(raw) as Partial<Tokens>;
        if (typeof value.accessToken !== "string" || typeof value.clientId !== "string") return null;
        return {
          clientId: value.clientId,
          accessToken: value.accessToken,
          refreshToken: typeof value.refreshToken === "string" ? value.refreshToken : null,
          expiresAt: typeof value.expiresAt === "number" ? value.expiresAt : 0,
        };
      } catch {
        return null;
      }
    },
    saveTokens(tokens) {
      try {
        app.secretStorage.setSecret(tokensSecret, tokens ? JSON.stringify(tokens) : "");
      } catch {
        // Obsidian throws when the system keychain isn't available (some Linux desktops). Nothing was stored.
        if (tokens) {
          throw new AuthError(
            "signInFailed",
            "Obsidian's secure storage isn't available on this device, so Timeline can't stay signed in here.",
          );
        }
      }
    },
    loadPending() {
      const value = app.loadLocalStorage(pendingKey) as Partial<PendingSignIn> | null;
      if (!value || typeof value.state !== "string" || typeof value.verifier !== "string") return null;
      if (typeof value.clientId !== "string" || typeof value.startedAt !== "number") return null;
      return { clientId: value.clientId, state: value.state, verifier: value.verifier, startedAt: value.startedAt };
    },
    savePending(pending) {
      app.saveLocalStorage(pendingKey, pending);
    },
    loadClientId: clientId.load,
    saveClientId: clientId.save,
  };
}
