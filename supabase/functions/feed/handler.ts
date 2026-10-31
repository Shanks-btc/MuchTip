import { ChainError, type Chain, type ChainSettings } from "../_shared/chain.ts";
import { ethers } from "../_shared/eth.ts";
import { clientIp, fail, HttpError, json, type Log, preflight } from "../_shared/http.ts";
import { type EventRow, syncEvents } from "../_shared/indexer.ts";
import { enforce, ipBucket, type RateLimiter } from "../_shared/ratelimit.ts";
import type { FeedStore } from "../_shared/stores.ts";

export interface FeedDeps {
  chain: Chain;
  store: FeedStore;
  rateLimit: RateLimiter;
  /** The escrow's deployment block: where an empty index starts scanning. */
  startBlock: number;
  confirmations: number;
  minSyncIntervalMs: number;
  maxBlocksPerSync: number;
  chunkBlocks: number;
  /** Lease length for the single syncing worker; renewed on every stored chunk. */
  leaseSeconds: number;
  /** How long refundDelay()/minTip() are reused before being read from the chain again. */
  settingsTtlMs: number;
  ipLimitPerMinute: number;
  now(): number;
  corsOrigin: string;
  log: Log;
}

const TYPES = ["Tipped", "Claimed", "Refunded"] as const;
type EventType = (typeof TYPES)[number];

/** A stored event shaped for the UI. Amounts are decimal strings; `handle`/`xId` are null until `resolve` has seen the account. */
export function toFeedEvent(row: EventRow, handle: { x_id: string; handle: string | null } | undefined) {
  const base = {
    type: row.event,
    blockNumber: row.block_number,
    logIndex: row.log_index,
    txHash: row.tx_hash,
    time: new Date(row.block_time).toISOString(),
    idHash: row.id_hash,
    handle: handle?.handle ?? null,
    xId: row.x_id ?? handle?.x_id ?? null,
    amountWei: row.amount_wei,
  };
  const account = ethers.getAddress(row.account);
  if (row.event === "Tipped") return { ...base, tipId: row.tip_id, from: account };
  if (row.event === "Claimed") return { ...base, recipient: account };
  return { ...base, tipId: row.tip_id, tipper: account };
}

/**
 * GET /feed?limit=25&type=Tipped  ->  recent events plus totals, all derived from TipEscrow's own events.
 *
 * Each request first syncs new blocks into chain_events (bounded, throttled, idempotent), then answers from the
 * database. If the RPC is down it still answers from what is stored and says how far behind it is.
 */
export function createFeedHandler(d: FeedDeps) {
  let settingsCache: { at: number; value: ChainSettings } | undefined;

  async function settings(): Promise<ChainSettings | undefined> {
    if (settingsCache && d.now() - settingsCache.at < d.settingsTtlMs) return settingsCache.value;
    try {
      settingsCache = { at: d.now(), value: await d.chain.settings() };
    } catch (e) {
      if (!(e instanceof ChainError)) throw e;
      d.log({ fn: "feed", event: "settings_unavailable", message: e.message });
    }
    return settingsCache?.value; // stale beats nothing
  }

  return async (req: Request): Promise<Response> => {
    try {
      if (req.method === "OPTIONS") return preflight(d.corsOrigin);
      if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET", { allow: "GET, OPTIONS" });

      const q = new URL(req.url).searchParams;
      const limitRaw = q.get("limit");
      const limit = limitRaw === null ? 25 : Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "invalid_limit", "limit must be an integer from 1 to 100");
      const type = q.get("type");
      if (type !== null && !TYPES.includes(type as EventType)) throw new HttpError(400, "invalid_type", `type must be one of ${TYPES.join(", ")}`);

      await enforce(d.rateLimit, await ipBucket("feed", clientIp(req)), 60, d.ipLimitPerMinute);

      const contract = d.chain.escrow.toLowerCase();
      let indexedTo: number;
      let head: number | null = null;
      try {
        const s = await syncEvents({
          chain: d.chain,
          store: d.store,
          startBlock: d.startBlock,
          nowMs: d.now(),
          minIntervalMs: d.minSyncIntervalMs,
          maxBlocksPerSync: d.maxBlocksPerSync,
          chunkBlocks: d.chunkBlocks,
          confirmations: d.confirmations,
          owner: crypto.randomUUID(),
          leaseSeconds: d.leaseSeconds,
        });
        if (s.lost) d.log({ fn: "feed", event: "lease_lost", indexedTo: s.indexedTo });
        indexedTo = s.indexedTo;
        head = s.head;
      } catch (e) {
        if (!(e instanceof ChainError)) throw e;
        d.log({ fn: "feed", event: "sync_failed", message: e.message });
        indexedTo = (await d.store.getState(contract))?.lastBlock ?? d.startBlock - 1; // serve what is stored
      }

      const [totals, rows, cfg] = await Promise.all([d.store.totals(contract, indexedTo), d.store.recent(contract, limit, type as EventType | undefined), settings()]);
      const handles = await d.store.handlesByIdHash([...new Set(rows.map((r) => r.id_hash))]);

      // Integrity check: what the stored events say the contract owes must equal its balance at the same block.
      let onChain: { balanceWei: string; matchesTotals: boolean } | null = null;
      if (indexedTo >= d.startBlock) {
        try {
          const balance = await d.chain.balanceWei(indexedTo);
          onChain = { balanceWei: String(balance), matchesTotals: String(balance) === totals.unclaimedWei };
          if (!onChain.matchesTotals) d.log({ fn: "feed", event: "balance_mismatch", indexedTo, balance: String(balance), unclaimedWei: totals.unclaimedWei });
        } catch (e) {
          if (!(e instanceof ChainError)) throw e;
        }
      }

      const lag = head === null ? null : Math.max(0, head - indexedTo);
      return json(200, {
        contract: d.chain.escrow,
        chainId: Number(d.chain.chainId),
        config: cfg ? { refundDelaySeconds: Number(cfg.refundDelay), minTipWei: String(cfg.minTip) } : null,
        sync: { headBlock: head, indexedToBlock: indexedTo, lagBlocks: lag, complete: lag !== null && lag <= 15 },
        totals: {
          tipsCount: totals.tipsCount,
          totalTippedWei: totals.totalTippedWei,
          uniqueHandles: totals.uniqueHandles,
          unclaimedWei: totals.unclaimedWei,
          claimedWei: totals.claimedWei,
          refundedWei: totals.refundedWei,
          claimsCount: totals.claimsCount,
          refundsCount: totals.refundsCount,
        },
        onChain,
        events: rows.map((r) => toFeedEvent(r, handles.get(r.id_hash))),
      }, d.corsOrigin, { "cache-control": "public, max-age=3" });
    } catch (e) {
      return fail(e, d.corsOrigin, d.log);
    }
  };
}
