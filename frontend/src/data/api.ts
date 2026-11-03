import { encodeAbiParameters, keccak256 } from "viem";
import { ENV } from "../env";
import { OFFLINE } from "../chain/errors";
import { DEMO_ACCOUNTS } from "./samples";
import type { ApiErrorBody, FeedResponse, ResolvedHandle, SignedClaim } from "./types";

// The Supabase Edge Functions of docs/backend.md, configured with Vite env vars (src/env.ts, frontend/.env.example).
// When they aren't set the backend isn't connected. In development the app then uses built-in fixtures, always labelled
// "Demo" / "Example data", so the UI can be worked on; production builds never show sample data (wiring-spec W4.2) and
// report the backend as unreachable instead. Sign-in and real tips are off either way.
export const SUPABASE_URL: string | undefined = ENV.supabaseUrl ?? undefined;
export const SUPABASE_ANON_KEY: string | undefined = ENV.supabaseAnonKey ?? undefined;
export const FUNCTIONS_URL: string | undefined = ENV.functionsUrl ?? undefined;
export const backendConfigured = Boolean(FUNCTIONS_URL);
/** Sign in with X needs the Supabase project itself (Auth), not only the functions. */
export const authConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
/** Labelled demo fixtures stand in for the backend: development builds only. */
export const demoMode = !backendConfigured && import.meta.env.DEV;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public path = "") {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!FUNCTIONS_URL) throw new ApiError(0, "backend_not_configured", OFFLINE);
  const headers = new Headers(init.headers);
  if (SUPABASE_ANON_KEY && !headers.has("apikey")) headers.set("apikey", SUPABASE_ANON_KEY);
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL}/${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "network", OFFLINE);
  }
  const body = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok || !body || (typeof body === "object" && "error" in body)) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? "bad_response", err?.message ?? `The backend answered ${res.status}`, path.split("?")[0]);
  }
  return body as T;
}

/** Same rule as the backend: trim, drop one leading @, 1 to 15 of A-Z a-z 0-9 _. */
export const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
/**
 * What the user typed or pasted -> a handle to validate: trims, drops one leading @, and turns a pasted profile URL
 * (x.com/<handle>, twitter.com/<handle>, with or without https:// and www., trailing path or query) into its handle
 * (wiring-spec W2.2). The backend still rejects URLs; this only happens in the UI.
 */
export function normalizeHandle(raw: string) {
  const s = raw.trim();
  const url = s.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/i);
  return url ? url[1] : s.replace(/^@/, "");
}

/**
 * Wiring-spec section 6: what to show for a backend error code. `handle` fills "No X account called @…".
 * Unknown codes fall back to the server's own message (they are written for people).
 */
export function apiErrorMessage(e: unknown, ctx: { handle?: string } = {}): string {
  if (!(e instanceof ApiError)) return OFFLINE;
  switch (e.code) {
    case "handle_not_found":
      return `No X account called @${ctx.handle ?? "that handle"}.`;
    case "invalid_handle":
      return "Handles are 1 to 15 letters, numbers or underscores.";
    case "upstream_rate_limited":
      return "Too many lookups. Try again in a minute.";
    case "rate_limited":
      return e.path === "sign-claim" ? "Too many claim attempts. Try again in a few minutes." : "Too many lookups. Try again in a minute.";
    case "upstream_unavailable":
      return "We can't reach X right now. Try again shortly.";
    case "invalid_token":
    case "missing_token":
      return "Your X sign-in expired. Sign in again.";
    case "identity_not_allowed":
      return "This account is linked to something other than X. Sign out and sign in with X only.";
    case "chain_unavailable":
    case "wrong_chain":
    case "verifier_mismatch":
      return "Claiming is unavailable right now. Your tips are safe in the contract.";
    case "network":
    case "backend_not_configured":
      return OFFLINE;
    default:
      return e.message || OFFLINE;
  }
}

/** TipEscrow.idHash(xId): keccak256 of the X id as one 32-byte word. */
export const idHashOf = (xId: string | bigint) => keccak256(encodeAbiParameters([{ type: "uint256" }], [BigInt(xId)]));


/** X handle -> numeric X id. `fresh` always asks X (the tip flow must use it right before confirming). null = not found. */
export async function resolveHandle(handle: string, opts: { fresh?: boolean; signal?: AbortSignal } = {}): Promise<ResolvedHandle | null> {
  const h = normalizeHandle(handle);
  if (demoMode) {
    await new Promise((r) => setTimeout(r, 300));
    const a = DEMO_ACCOUNTS[h.toLowerCase()];
    return a ? { ...a, idHash: idHashOf(a.xId), source: "demo" } : null;
  }
  const q = new URLSearchParams({ handle: h });
  if (opts.fresh) q.set("fresh", "1");
  try {
    return await call<ResolvedHandle>(`resolve?${q}`, { signal: opts.signal });
  } catch (e) {
    if (e instanceof ApiError && e.code === "handle_not_found") return null;
    throw e;
  }
}

export function fetchFeed(opts: { limit?: number; type?: "Tipped" | "Claimed" | "Refunded"; signal?: AbortSignal } = {}) {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 25) });
  if (opts.type) q.set("type", opts.type);
  return call<FeedResponse>(`feed?${q}`, { signal: opts.signal });
}

export function signClaim(accessToken: string, recipient: string) {
  return call<SignedClaim>("sign-claim", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ recipient }),
  });
}
