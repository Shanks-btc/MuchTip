// feed: recent Tipped / Claimed / Refunded events with handles, plus totals, from the contract's own events.
import { serveLazy } from "../_shared/boot.ts";
import { createChain } from "../_shared/chain.ts";
import { chainConfig, denoEnv, intEnv, required, supabaseConfig } from "../_shared/env.ts";
import { logJson } from "../_shared/http.ts";
import { createServiceClient, feedStoreFrom, rateLimiterFrom } from "../_shared/supabase.ts";
import { createFeedHandler } from "./handler.ts";

serveLazy(() => {
  const env = denoEnv;
  const client = createServiceClient(supabaseConfig(env));
  return createFeedHandler({
    chain: createChain(chainConfig(env)),
    store: feedStoreFrom(client),
    rateLimit: rateLimiterFrom(client),
    startBlock: intEnv({ get: (n) => (n === "ESCROW_DEPLOY_BLOCK" ? required(env, n) : env.get(n)) }, "ESCROW_DEPLOY_BLOCK", 0, 0, 2 ** 31),
    confirmations: intEnv(env, "FEED_CONFIRMATIONS", 0, 0, 100),
    minSyncIntervalMs: intEnv(env, "FEED_MIN_SYNC_SECONDS", 5, 0, 3600) * 1000,
    maxBlocksPerSync: intEnv(env, "FEED_MAX_BLOCKS_PER_SYNC", 100_000, 1000, 10_000_000),
    chunkBlocks: intEnv(env, "FEED_LOG_CHUNK_BLOCKS", 9000, 100, 10_000),
    leaseSeconds: intEnv(env, "FEED_LEASE_SECONDS", 30, 5, 600),
    settingsTtlMs: 60_000,
    ipLimitPerMinute: intEnv(env, "FEED_RATE_PER_MINUTE", 120, 1, 100_000),
    now: () => Date.now(),
    corsOrigin: env.get("CORS_ALLOW_ORIGIN") || "*",
    log: logJson,
  });
});
