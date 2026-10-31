import { X_ID_RE } from "./ids.ts";

/** What a username lookup yields. `id` is X's numeric user id as a string; `name` is the display name (sanitised) or null. */
export interface XUser {
  id: string;
  username: string;
  name: string | null;
}

/** Resolves a handle; null means "no such account". Throws UpstreamError when X cannot answer. */
export type XLookup = (handle: string) => Promise<XUser | null>;

export class UpstreamError extends Error {
  constructor(
    readonly kind: "rate_limited" | "auth" | "unavailable" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export const DEFAULT_X_API_BASE = "https://api.x.com";

/**
 * A display name is shown in "You're tipping <name>", so it is untrusted text from a stranger. Control characters, zero-width
 * characters and bidirectional overrides (which can make text read in a different order than it is stored) are removed,
 * whitespace is collapsed, and it is cut to X's 50-character limit (by code point, so emoji are not split).
 */
export function cleanDisplayName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // deno-lint-ignore no-control-regex
  const stripped = v.replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, "");
  const s = stripped.replace(/\s+/g, " ").trim();
  return s ? Array.from(s).slice(0, 50).join("") : null;
}

/**
 * GET /2/users/by/username/{handle} with an app-only bearer token.
 *
 * Billing and the exact not-found body are UNVERIFIED against the live API (verified.md 3a): an unknown username is
 * assumed to be HTTP 200 with `errors` and no `data` (from X's OpenAPI spec), and HTTP 404 is also treated as not found.
 */
export function createXLookup(opts: { bearer: string; baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number }): XLookup {
  const base = (opts.baseUrl ?? DEFAULT_X_API_BASE).replace(/\/+$/, "");
  const fetchFn = opts.fetch ?? fetch;
  return async (handle) => {
    let res: Response;
    try {
      res = await fetchFn(`${base}/2/users/by/username/${encodeURIComponent(handle)}`, {
        headers: { authorization: `Bearer ${opts.bearer}`, accept: "application/json" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      });
    } catch (e) {
      throw new UpstreamError("unavailable", `X API request failed: ${e instanceof Error ? e.message : e}`);
    }
    if (res.status === 404) return null;
    if (res.status === 429) throw new UpstreamError("rate_limited", "X API rate limit reached");
    // 401/403: bad or missing token / app permissions; 402: out of API credits. All are our configuration, not the user's.
    if (res.status === 401 || res.status === 402 || res.status === 403) throw new UpstreamError("auth", `X API refused the request (HTTP ${res.status})`);
    if (res.status >= 500) throw new UpstreamError("unavailable", `X API error (HTTP ${res.status})`);
    if (!res.ok) throw new UpstreamError("invalid", `Unexpected X API status ${res.status}`);

    let body: { data?: { id?: unknown; username?: unknown; name?: unknown }; errors?: unknown[] };
    try {
      body = await res.json();
    } catch {
      throw new UpstreamError("invalid", "X API returned invalid JSON");
    }
    if (body.data) {
      const id = typeof body.data.id === "string" ? body.data.id : String(body.data.id ?? "");
      const username = body.data.username;
      if (!X_ID_RE.test(id) || typeof username !== "string") throw new UpstreamError("invalid", "X API returned an unexpected user object");
      return { id, username, name: cleanDisplayName(body.data.name) };
    }
    if (Array.isArray(body.errors) && body.errors.length > 0) return null; // not found / suspended: nothing to tip
    throw new UpstreamError("invalid", "X API returned neither data nor errors");
  };
}

/**
 * Fixtures for local development, used when X_BEARER_TOKEN is unset. Ids for @jack (12), @elonmusk (44196397) and
 * @XDevelopers (2244994945) are the well-known real ones; "MuchTipDemo" is made up (a 19-digit id above 2^53 for testing).
 * Never rely on this in production: set X_BEARER_TOKEN.
 */
export const MOCK_FIXTURES: Record<string, XUser> = {
  xdevelopers: { id: "2244994945", username: "XDevelopers", name: "X Developers" },
  jack: { id: "12", username: "jack", name: "jack" },
  elonmusk: { id: "44196397", username: "elonmusk", name: "Elon Musk" },
  muchtipdemo: { id: "1850123456789012345", username: "MuchTipDemo", name: "MuchTip Demo" },
  doge_fan_42: { id: "710000042", username: "Doge_Fan_42", name: "Doge Fan" },
};

export function createMockLookup(fixtures: Record<string, XUser> = MOCK_FIXTURES): XLookup {
  return (handle) => Promise.resolve(fixtures[handle.toLowerCase()] ?? null);
}
