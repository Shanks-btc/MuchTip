// The only module that talks to Supabase (supabase-js): thin adapters from the stores' interfaces to PostgREST/RPC.
// Kept thin on purpose; they are exercised by the integration tests against a real PostgREST + Postgres.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import type { SupabaseConfig } from "./env.ts";
import type { EventRow } from "./indexer.ts";
import type { RateLimiter } from "./ratelimit.ts";
import type { AuthUserLike } from "./claim-gate.ts";
import type { FeedStore, FeedTotals, HandleRow, HandleStore } from "./stores.ts";

// No generated `Database` types in this repo, so table rows are loosely typed (the stores below type what they return).
// deno-lint-ignore no-explicit-any
export type Client = SupabaseClient<any, "public", any>;

/** A server-side client with the service key: bypasses RLS, so it must never be exposed to callers. */
export function createServiceClient(cfg: SupabaseConfig): Client {
  // deno-lint-ignore no-explicit-any
  return createClient<any, "public", any>(cfg.url, cfg.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export function rateLimiterFrom(client: Client): RateLimiter {
  return {
    async hit(bucket, windowSeconds, limit) {
      const { data, error } = await client.rpc("rate_limit_hit", { p_bucket: bucket, p_window_seconds: windowSeconds, p_limit: limit });
      check(error, "rate_limit_hit");
      return data === true;
    },
  };
}

export function handleStoreFrom(client: Client): HandleStore {
  return {
    async findByHandle(handle) {
      // exact equality on the lower-cased handle (the generated column behind the unique index); no pattern matching
      const { data, error } = await client
        .from("x_handles")
        .select("x_id,handle,name,id_hash,resolved_at")
        .eq("handle_lc", handle.toLowerCase())
        .limit(1);
      check(error, "x_handles select");
      return (data?.[0] as HandleRow | undefined) ?? null;
    },
    async upsert(row) {
      const { error } = await client.rpc("upsert_x_handle", {
        p_x_id: row.x_id, p_handle: row.handle, p_name: row.name, p_id_hash: row.id_hash, p_resolved_at: row.resolved_at,
      });
      check(error, "upsert_x_handle");
    },
  };
}

export function feedStoreFrom(client: Client): FeedStore {
  return {
    async getState(contract) {
      const { data, error } = await client.from("indexer_state").select("last_block,updated_at").eq("contract", contract).maybeSingle();
      check(error, "indexer_state select");
      return data ? { lastBlock: Number(data.last_block), updatedAt: Date.parse(data.updated_at) } : null;
    },
    async acquire(contract, owner, startBlock, leaseSeconds) {
      const { data, error } = await client.rpc("indexer_acquire", {
        p_contract: contract, p_owner: owner, p_start_block: startBlock, p_lease_seconds: leaseSeconds,
      });
      check(error, "indexer_acquire");
      return data ? { lastBlock: Number(data.lastBlock), updatedAt: Date.parse(data.updatedAt) } : null;
    },
    async apply(contract, owner, from, to, rows, leaseSeconds) {
      const { data, error } = await client.rpc("indexer_apply", {
        p_contract: contract, p_owner: owner, p_from: from, p_to: to, p_events: rows, p_lease_seconds: leaseSeconds,
      });
      check(error, "indexer_apply");
      return data === true;
    },
    async release(contract, owner) {
      const { error } = await client.rpc("indexer_release", { p_contract: contract, p_owner: owner });
      check(error, "indexer_release");
    },
    async totals(contract, toBlock) {
      const { data, error } = await client.rpc("feed_totals", { p_contract: contract, p_to_block: toBlock });
      check(error, "feed_totals");
      return data as FeedTotals;
    },
    async recent(contract, limit, type) {
      let q = client
        .from("chain_events")
        .select("contract,block_number,log_index,tx_hash,event,id_hash,tip_id,account,amount_wei:amount_wei::text,x_id,block_time")
        .eq("contract", contract);
      if (type) q = q.eq("event", type);
      const { data, error } = await q.order("block_number", { ascending: false }).order("log_index", { ascending: false }).limit(limit);
      check(error, "chain_events select");
      return (data ?? []) as unknown as EventRow[];
    },
    async handlesByIdHash(idHashes) {
      const out = new Map<string, { x_id: string; handle: string }>();
      if (idHashes.length === 0) return out;
      const { data, error } = await client.from("x_handles").select("x_id,handle,id_hash").in("id_hash", idHashes);
      check(error, "x_handles select");
      for (const r of data ?? []) out.set(r.id_hash, { x_id: r.x_id, handle: r.handle });
      return out;
    },
  };
}

export interface AuthPort {
  getUser(jwt: string): Promise<{ user: AuthUserLike | null; error: string | null }>;
}

/** `auth.getUser(jwt)` is a network call to Supabase Auth: it validates signature, expiry and that the user still exists. */
export function authFrom(client: Client): AuthPort {
  return {
    async getUser(jwt) {
      const { data, error } = await client.auth.getUser(jwt);
      if (error || !data?.user) return { user: null, error: error?.message ?? "no user" };
      return { user: data.user as unknown as AuthUserLike, error: null };
    },
  };
}
