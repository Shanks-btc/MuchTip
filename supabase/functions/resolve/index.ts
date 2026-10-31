// resolve: X handle -> numeric X id (cached in x_handles for an hour). See docs/backend.md.
import { serveLazy } from "../_shared/boot.ts";
import { denoEnv, intEnv, supabaseConfig } from "../_shared/env.ts";
import { logJson } from "../_shared/http.ts";
import { createServiceClient, handleStoreFrom, rateLimiterFrom } from "../_shared/supabase.ts";
import { createMockLookup, createXLookup } from "../_shared/x-api.ts";
import { createResolveHandler } from "./handler.ts";

serveLazy(() => {
  const env = denoEnv;
  const client = createServiceClient(supabaseConfig(env));
  const bearer = env.get("X_BEARER_TOKEN");
  if (!bearer) logJson({ fn: "resolve", event: "mock_mode", message: "X_BEARER_TOKEN is unset: serving fixtures, not real X accounts" });
  return createResolveHandler({
    store: handleStoreFrom(client),
    rateLimit: rateLimiterFrom(client),
    // X_API_BASE_URL exists so tests can point the lookup at a local fake; leave it unset in production
    lookup: bearer ? createXLookup({ bearer, baseUrl: env.get("X_API_BASE_URL") }) : createMockLookup(),
    mode: bearer ? "x" : "mock",
    now: () => Date.now(),
    cacheTtlMs: intEnv(env, "RESOLVE_CACHE_TTL_SECONDS", 3600, 1, 86_400) * 1000,
    ipLimitPerMinute: intEnv(env, "RESOLVE_RATE_PER_MINUTE", 30, 1, 10_000),
    freshLimitPerMinute: intEnv(env, "RESOLVE_FRESH_PER_MINUTE", 10, 1, 10_000),
    xBudget: { windowSeconds: 900, limit: intEnv(env, "X_API_BUDGET_PER_15MIN", 280, 1, 100_000) },
    corsOrigin: env.get("CORS_ALLOW_ORIGIN") || "*",
    log: logJson,
  });
});
