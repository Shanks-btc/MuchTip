import { escrowIface } from "./abi.ts";
import type { Chain, RawLog } from "./chain.ts";

/** One stored contract event. Amounts are decimal strings (wei exceeds 2^53); addresses are lower-case. */
export interface EventRow {
  contract: string;
  block_number: number;
  log_index: number;
  tx_hash: string;
  event: "Tipped" | "Claimed" | "Refunded";
  id_hash: string;
  tip_id: string | null;
  /** Tipped: the tipper; Refunded: the tipper; Claimed: the recipient. */
  account: string;
  amount_wei: string;
  /** Claimed only. */
  x_id: string | null;
  block_time: string;
}

export interface IndexerState {
  lastBlock: number;
  /** Epoch ms of the last progress made. */
  updatedAt: number;
}

export interface IndexerStore {
  getState(contract: string): Promise<IndexerState | null>;
  /**
   * Becomes the only worker syncing this contract (a lease). Resolves to the state to continue from, or null when another
   * worker holds a live lease. Creates the state at startBlock - 1 the first time.
   */
  acquire(contract: string, owner: string, startBlock: number, leaseSeconds: number): Promise<IndexerState | null>;
  /**
   * Stores the events of blocks [from, to] and moves lastBlock from from - 1 to to, in one atomic step. False, with nothing
   * changed, if the caller lost its lease or lastBlock is no longer from - 1.
   */
  apply(contract: string, owner: string, from: number, to: number, rows: EventRow[], leaseSeconds: number): Promise<boolean>;
  release(contract: string, owner: string): Promise<void>;
}

/** Decodes Tipped / Claimed / Refunded logs; anything else (or a removed log) is skipped. */
export function decodeLogs(contract: string, logs: RawLog[], blockTimes: Map<number, number>): EventRow[] {
  const rows: EventRow[] = [];
  for (const log of logs) {
    if (log.removed) continue;
    const parsed = escrowIface.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) continue;
    const a = parsed.args;
    const blockNumber = Number(BigInt(log.blockNumber));
    const time = blockTimes.get(blockNumber);
    if (time === undefined) throw new Error(`no timestamp for block ${blockNumber}`);
    const base = {
      contract,
      block_number: blockNumber,
      log_index: Number(BigInt(log.logIndex)),
      tx_hash: log.transactionHash.toLowerCase(),
      block_time: new Date(time * 1000).toISOString(),
    };
    if (parsed.name === "Tipped") {
      rows.push({ ...base, event: "Tipped", id_hash: a.idHash, tip_id: a.tipId.toString(), account: String(a.from).toLowerCase(), amount_wei: a.amount.toString(), x_id: null });
    } else if (parsed.name === "Claimed") {
      rows.push({ ...base, event: "Claimed", id_hash: a.idHash, tip_id: null, account: String(a.recipient).toLowerCase(), amount_wei: a.amount.toString(), x_id: a.xId.toString() });
    } else if (parsed.name === "Refunded") {
      rows.push({ ...base, event: "Refunded", id_hash: a.idHash, tip_id: a.tipId.toString(), account: String(a.tipper).toLowerCase(), amount_wei: a.amount.toString(), x_id: null });
    }
  }
  return rows;
}

export interface SyncOptions {
  chain: Chain;
  store: IndexerStore;
  /** First block to scan on an empty index: the contract's deployment block. */
  startBlock: number;
  nowMs: number;
  /** Do not fetch logs again within this long of the last stored progress. */
  minIntervalMs: number;
  /** Upper bound of blocks scanned per call, so one request cannot run unbounded after a long idle period. */
  maxBlocksPerSync: number;
  /** Blocks per eth_getLogs call (DogeOS caps a query at 10,000). */
  chunkBlocks: number;
  /** Stay this many blocks behind the head. */
  confirmations: number;
  /** Identifies this call as a worker; must be unique per call (a random UUID). */
  owner: string;
  /** How long the lease lasts without progress; every stored chunk renews it. */
  leaseSeconds: number;
}

export interface SyncResult {
  head: number;
  indexedTo: number;
  lagBlocks: number;
  fetched: number;
  /** Skipped because the last progress was very recent. */
  throttled: boolean;
  /** Skipped because another worker holds the lease: it is doing the work. */
  busy: boolean;
  /** Stopped early because the lease was lost to another worker while fetching. */
  lost: boolean;
}

/**
 * Brings the stored events forward from the last indexed block, as the only worker doing so.
 *
 * What advances indexer_state: this function, and nothing else, through the store's apply(). It runs inside every feed
 * request and from the minute-by-minute pg_cron job (which simply calls the feed). Concurrent callers are safe: one takes
 * the lease and fetches; the others see busy and serve what is stored. Each chunk is stored together with the progress in
 * one atomic step that only succeeds if the progress is still exactly where this worker left it, so even a worker whose lease
 * expired mid-fetch can neither store a range twice nor move the index backwards. Does not handle chain reorganisations:
 * stored events are never deleted.
 */
export async function syncEvents(o: SyncOptions): Promise<SyncResult> {
  const contract = o.chain.escrow.toLowerCase();
  const head = await o.chain.headBlock();
  const target = head - o.confirmations;
  const state = await o.store.getState(contract);
  let indexedTo = state ? state.lastBlock : o.startBlock - 1;
  let fetched = 0;
  const result = (extra: Partial<SyncResult> = {}): SyncResult => ({
    head, indexedTo, lagBlocks: Math.max(0, head - indexedTo), fetched, throttled: false, busy: false, lost: false, ...extra,
  });

  const age = state ? o.nowMs - state.updatedAt : Infinity; // a negative age (clock skew) is not "recent"
  if (age >= 0 && age < o.minIntervalMs) return result({ throttled: true });
  if (indexedTo >= target) return result();

  const claimed = await o.store.acquire(contract, o.owner, o.startBlock, o.leaseSeconds);
  if (!claimed) return result({ busy: true });
  let lost = false;
  try {
    indexedTo = claimed.lastBlock; // authoritative once we hold the lease
    const stop = Math.min(target, indexedTo + o.maxBlocksPerSync);
    for (let from = indexedTo + 1; from <= stop;) {
      const to = Math.min(from + o.chunkBlocks - 1, stop);
      const logs = await o.chain.getLogs(from, to);
      const times = logs.length > 0 ? await o.chain.blockTimes(logs.map((l) => Number(BigInt(l.blockNumber)))) : new Map<number, number>();
      const rows = logs.length > 0 ? decodeLogs(contract, logs, times) : [];
      if (!(await o.store.apply(contract, o.owner, from, to, rows, o.leaseSeconds))) {
        lost = true;
        break;
      }
      fetched += rows.length;
      indexedTo = to;
      from = to + 1;
    }
  } finally {
    await o.store.release(contract, o.owner).catch(() => {}); // an expired lease clears itself
  }
  return result({ lost });
}
