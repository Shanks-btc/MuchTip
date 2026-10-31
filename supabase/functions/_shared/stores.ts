import type { EventRow, IndexerStore } from "./indexer.ts";

export interface HandleRow {
  x_id: string;
  /** NULL once X reassigned the handle to another account; such a row is never returned by a handle lookup. */
  handle: string | null;
  /** Display name as returned by X (already sanitised), or null if never learned. */
  name: string | null;
  id_hash: string;
  resolved_at: string;
}

export interface HandleStore {
  /** The row whose handle equals `handle` case-insensitively (exact match on lower(handle)), or null. */
  findByHandle(handle: string): Promise<HandleRow | null>;
  /** Stores an account, taking the handle away from whichever other account held it (atomic, see upsert_x_handle). */
  upsert(row: HandleRow & { handle: string }): Promise<void>;
}

/** Aggregates over the stored events; every amount is a decimal string. */
export interface FeedTotals {
  tipsCount: number;
  claimsCount: number;
  refundsCount: number;
  totalTippedWei: string;
  claimedWei: string;
  refundedWei: string;
  uniqueHandles: number;
  unclaimedWei: string;
}

export interface FeedStore extends IndexerStore {
  /** Totals over events up to and including `toBlock`. */
  totals(contract: string, toBlock: number): Promise<FeedTotals>;
  /** Newest first. */
  recent(contract: string, limit: number, type?: EventRow["event"]): Promise<EventRow[]>;
  handlesByIdHash(idHashes: string[]): Promise<Map<string, { x_id: string; handle: string | null }>>;
}
