import { allowedOrigin, clientIp, fail, HttpError, json, type Log, preflight, readJsonBody } from "../_shared/http.ts";
import { idHashOf, normaliseHandle } from "../_shared/ids.ts";
import { enforce, ipBucket, type RateLimiter } from "../_shared/ratelimit.ts";
import type { HandleRow, HandleStore } from "../_shared/stores.ts";
import { UpstreamError, type XLookup } from "../_shared/x-api.ts";

export interface ResolveDeps {
  store: HandleStore;
  rateLimit: RateLimiter;
  lookup: XLookup;
  /** "mock" when X_BEARER_TOKEN is unset: fixtures, no X API budget. */
  mode: "x" | "mock";
  now(): number;
  cacheTtlMs: number;
  ipLimitPerMinute: number;
  /** Extra, tighter per-IP limit for fresh lookups: each one is a paid X API call. */
  freshLimitPerMinute: number;
  /** Cap on calls to the (paid, rate-limited) X API across all callers. */
  xBudget: { windowSeconds: number; limit: number };
  corsOrigin: string;
  log: Log;
}

export interface ResolveBody {
  xId: string;
  handle: string;
  name: string | null;
  idHash: string;
  resolvedAt: string;
  source: "cache" | "x" | "mock";
}

function body(row: HandleRow, handle: string, source: ResolveBody["source"]): ResolveBody {
  // idHash is recomputed rather than trusted from the database
  return { xId: row.x_id, handle, name: row.name, idHash: idHashOf(row.x_id), resolvedAt: new Date(row.resolved_at).toISOString(), source };
}

const isFresh = (v: unknown) => v === true || v === "1" || v === "true";

/**
 * GET /resolve?handle=@name[&fresh=1]  or  POST /resolve {"handle":"@name","fresh":true}  ->  the X account behind a handle.
 *
 * Default (display, feed): answered from the 1-hour cache when possible.
 * fresh (the tip flow, before money moves): ALWAYS asks X, never the cache, so a handle renamed or reassigned within the
 * hour cannot send a tip to its previous owner. The answer refreshes the cache.
 */
export function createResolveHandler(d: ResolveDeps) {
  return async (req: Request): Promise<Response> => {
    const origin = allowedOrigin(req, d.corsOrigin);
    try {
      if (req.method === "OPTIONS") return preflight(origin);
      if (req.method !== "GET" && req.method !== "POST") {
        throw new HttpError(405, "method_not_allowed", "Use GET or POST", { allow: "GET, POST, OPTIONS" });
      }
      const q = new URL(req.url).searchParams;
      const input = req.method === "GET" ? { handle: q.get("handle"), fresh: q.get("fresh") } : await readJsonBody(req);
      const handle = normaliseHandle(input.handle);
      if (!handle) throw new HttpError(400, "invalid_handle", "Enter an X handle: 1 to 15 letters, numbers or underscores");
      const fresh = isFresh(input.fresh);

      const ip = clientIp(req);
      await enforce(d.rateLimit, await ipBucket("resolve", ip), 60, d.ipLimitPerMinute);
      if (fresh) await enforce(d.rateLimit, await ipBucket("resolve-fresh", ip), 60, d.freshLimitPerMinute);

      if (!fresh) {
        const cached = await d.store.findByHandle(handle);
        if (cached?.handle && d.now() - Date.parse(cached.resolved_at) < d.cacheTtlMs) {
          return json(200, body(cached, cached.handle, "cache"), origin);
        }
      }

      if (d.mode === "x") await enforce(d.rateLimit, "xapi:global", d.xBudget.windowSeconds, d.xBudget.limit);
      let user;
      try {
        user = await d.lookup(handle);
      } catch (e) {
        if (!(e instanceof UpstreamError)) throw e;
        d.log({ fn: "resolve", event: "upstream_error", kind: e.kind, message: e.message });
        if (e.kind === "rate_limited") {
          throw new HttpError(429, "upstream_rate_limited", "X is rate limiting lookups right now, try again in a minute", { "retry-after": "60" });
        }
        throw new HttpError(502, "upstream_unavailable", "Could not reach X to look up that handle, try again shortly");
      }
      if (!user) throw new HttpError(404, "handle_not_found", `No X account with the handle @${handle}`);
      if (user.username.toLowerCase() !== handle.toLowerCase()) {
        d.log({ fn: "resolve", event: "username_mismatch", asked: handle, got: user.username });
        throw new HttpError(502, "upstream_unavailable", "X returned an unexpected account for that handle");
      }

      const row = {
        x_id: user.id,
        handle: user.username,
        name: user.name,
        id_hash: idHashOf(user.id),
        resolved_at: new Date(d.now()).toISOString(),
      };
      await d.store.upsert(row);
      d.log({ fn: "resolve", event: "resolved", source: d.mode, fresh, handle: row.handle });
      return json(200, body(row, row.handle, d.mode), origin);
    } catch (e) {
      return fail(e, origin, d.log);
    }
  };
}
