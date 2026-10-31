// Test doubles shared by the unit tests (not deployed with the functions' entry points).
import { escrowIface } from "./abi.ts";
import { type Chain, ChainError, type ChainSettings, type ClaimContext, type RawLog } from "./chain.ts";
import { ethers } from "./eth.ts";
import { type EventRow, decodeLogs, type IndexerState } from "./indexer.ts";
import type { RateLimiter } from "./ratelimit.ts";
import type { FeedStore, FeedTotals, HandleRow, HandleStore } from "./stores.ts";

export const ESCROW = ethers.getAddress("0x207652b0767f9f19d24b5300e2123d415167acef");
export const CHAIN_ID = 6281971n;
export const T0 = 1_793_000_000; // fake chain time of block 0; block n is at T0 + 3n

export class FakeRateLimiter implements RateLimiter {
  counts = new Map<string, number>();
  fail = false;
  hit(bucket: string, _windowSeconds: number, limit: number): Promise<boolean> {
    if (this.fail) return Promise.reject(new Error("db down"));
    const n = (this.counts.get(bucket) ?? 0) + 1;
    this.counts.set(bucket, n);
    return Promise.resolve(n <= limit);
  }
}

/** Mirrors x_handles + upsert_x_handle(): exact case-insensitive lookup; a handle belongs to one account at a time. */
export class FakeHandleStore implements HandleStore {
  rows = new Map<string, HandleRow>(); // by x_id
  findByHandle(handle: string): Promise<HandleRow | null> {
    const hit = [...this.rows.values()].find((r) => r.handle !== null && r.handle.toLowerCase() === handle.toLowerCase());
    return Promise.resolve(hit ? { ...hit } : null);
  }
  upsert(row: HandleRow & { handle: string }): Promise<void> {
    for (const r of this.rows.values()) {
      if (r.x_id !== row.x_id && r.handle?.toLowerCase() === row.handle.toLowerCase()) r.handle = null; // reassigned
    }
    this.rows.set(row.x_id, { ...row });
    return Promise.resolve();
  }
}

/** In-memory FeedStore whose totals mirror feed_totals() in the SQL migration. */
export class FakeFeedStore implements FeedStore {
  events = new Map<string, EventRow>();
  state = new Map<string, IndexerState & { leaseOwner: string | null; leaseUntil: number }>();
  handles = new Map<string, { x_id: string; handle: string | null }>(); // by id_hash
  /** The database clock (ms). Tests move it to expire leases. */
  clock = 10_000_000;
  /** The clock the fake database uses; tests can bind it to their own. */
  now = (): number => this.clock;
  applied: Array<{ owner: string; from: number; to: number }> = [];
  /** Each call yields to the event loop first, like a network round trip, so concurrent callers really interleave. */
  private tick = () => new Promise((r) => setTimeout(r, 0));
  async getState(c: string) {
    await this.tick();
    const s = this.state.get(c);
    return s ? { lastBlock: s.lastBlock, updatedAt: s.updatedAt } : null;
  }
  async acquire(c: string, owner: string, startBlock: number, leaseSeconds: number) {
    await this.tick();
    // from here to the return is synchronous: atomic, like the SQL statement
    const s = this.state.get(c);
    if (!s) {
      this.state.set(c, { lastBlock: startBlock - 1, updatedAt: this.now(), leaseOwner: owner, leaseUntil: this.now() + leaseSeconds * 1000 });
      return { lastBlock: startBlock - 1, updatedAt: this.now() };
    }
    if (s.leaseOwner !== null && s.leaseOwner !== owner && s.leaseUntil >= this.now()) return null;
    s.leaseOwner = owner;
    s.leaseUntil = this.now() + leaseSeconds * 1000;
    return { lastBlock: s.lastBlock, updatedAt: s.updatedAt };
  }
  async apply(c: string, owner: string, from: number, to: number, rows: EventRow[], leaseSeconds: number) {
    await this.tick();
    const s = this.state.get(c);
    if (!s || s.leaseOwner !== owner || s.lastBlock !== from - 1) return false;
    if (rows.some((r) => r.contract !== c || r.block_number < from || r.block_number > to)) throw new Error("event outside range");
    s.lastBlock = to;
    s.updatedAt = this.now();
    s.leaseUntil = this.now() + leaseSeconds * 1000;
    for (const r of rows) {
      const k = `${r.contract}:${r.block_number}:${r.log_index}`;
      if (!this.events.has(k)) this.events.set(k, r); // on conflict do nothing
    }
    this.applied.push({ owner, from, to });
    return true;
  }
  async release(c: string, owner: string) {
    await this.tick();
    const s = this.state.get(c);
    if (s && s.leaseOwner === owner) {
      s.leaseOwner = null;
      s.leaseUntil = 0;
    }
  }
  /** Test helper: put the index at a block as if it had been synced there. */
  seedState(c: string, lastBlock: number, updatedAt = 0) {
    this.state.set(c, { lastBlock, updatedAt, leaseOwner: null, leaseUntil: 0 });
  }
  totals(contract: string, toBlock: number): Promise<FeedTotals> {
    const rows = [...this.events.values()].filter((e) => e.contract === contract && e.block_number <= toBlock);
    const sum = (ev: string) => rows.filter((e) => e.event === ev).reduce((a, e) => a + BigInt(e.amount_wei), 0n);
    const tipped = sum("Tipped"), claimed = sum("Claimed"), refunded = sum("Refunded");
    return Promise.resolve({
      tipsCount: rows.filter((e) => e.event === "Tipped").length,
      claimsCount: rows.filter((e) => e.event === "Claimed").length,
      refundsCount: rows.filter((e) => e.event === "Refunded").length,
      totalTippedWei: String(tipped),
      claimedWei: String(claimed),
      refundedWei: String(refunded),
      uniqueHandles: new Set(rows.filter((e) => e.event === "Tipped").map((e) => e.id_hash)).size,
      unclaimedWei: String(tipped - claimed - refunded),
    });
  }
  recent(contract: string, limit: number, type?: EventRow["event"]) {
    const rows = [...this.events.values()]
      .filter((e) => e.contract === contract && (!type || e.event === type))
      .sort((a, b) => b.block_number - a.block_number || b.log_index - a.log_index);
    return Promise.resolve(rows.slice(0, limit));
  }
  handlesByIdHash(idHashes: string[]) {
    return Promise.resolve(new Map(idHashes.flatMap((h) => (this.handles.has(h) ? [[h, this.handles.get(h)!] as const] : []))));
  }
}

// ---- event logs -------------------------------------------------------------------------------------------------

let logCounter = 0;
export function makeLog(name: "Tipped" | "Claimed" | "Refunded" | "VerifierUpdated", values: unknown[], block: number, logIndex = 0): RawLog {
  const { topics, data } = escrowIface.encodeEventLog(escrowIface.getEvent(name)!, values);
  return {
    blockNumber: ethers.toQuantity(block),
    logIndex: ethers.toQuantity(logIndex),
    transactionHash: ethers.zeroPadValue(ethers.toBeHex(++logCounter), 32),
    topics,
    data,
    address: ESCROW.toLowerCase(),
  };
}
export const tipped = (tipId: number, idHash: string, from: string, amount: bigint, block: number, i = 0) =>
  makeLog("Tipped", [tipId, idHash, from, amount], block, i);
export const claimed = (idHash: string, recipient: string, amount: bigint, nonce: bigint, xId: bigint, block: number, i = 0) =>
  makeLog("Claimed", [idHash, recipient, amount, nonce, xId], block, i);
export const refunded = (tipId: number, idHash: string, tipper: string, amount: bigint, block: number, i = 0) =>
  makeLog("Refunded", [tipId, idHash, tipper, amount], block, i);

// ---- chain ------------------------------------------------------------------------------------------------------

export interface FakeChainState {
  head: number;
  logs: RawLog[];
  settings: ChainSettings;
  ctx: ClaimContext;
  balanceOverride?: bigint;
  failHead: boolean;
  failLogs: boolean;
  failClaim: boolean;
  failSettings: boolean;
  failBalance: boolean;
  /** Delay for each eth_getLogs, so concurrent syncs overlap. */
  logsDelayMs: number;
  /** If set, eth_getLogs waits for this promise (lets a test stall one worker). */
  logsGate?: Promise<void>;
  calls: { getLogs: Array<[number, number]>; settings: number; claimContext: number; headBlock: number };
}

export function fakeChain(over: Partial<FakeChainState> = {}): Chain & { st: FakeChainState } {
  const st: FakeChainState = {
    head: 1000,
    logs: [],
    settings: { refundDelay: 600n, minTip: 5n * 10n ** 18n, verifier: ethers.ZeroAddress, owner: ethers.ZeroAddress },
    ctx: { chainId: CHAIN_ID, chainTime: BigInt(T0 + 3000), unclaimed: 0n, verifier: ethers.ZeroAddress },
    failHead: false,
    failLogs: false,
    failClaim: false,
    failSettings: false,
    failBalance: false,
    logsDelayMs: 0,
    calls: { getLogs: [], settings: 0, claimContext: 0, headBlock: 0 },
    ...over,
  };
  const bn = (l: RawLog) => Number(BigInt(l.blockNumber));
  return {
    st,
    escrow: ESCROW,
    chainId: CHAIN_ID,
    claimContext(_idHash) {
      st.calls.claimContext++;
      return st.failClaim ? Promise.reject(new ChainError("rpc down")) : Promise.resolve({ ...st.ctx });
    },
    settings() {
      st.calls.settings++;
      return st.failSettings ? Promise.reject(new ChainError("rpc down")) : Promise.resolve(st.settings);
    },
    headBlock() {
      st.calls.headBlock++;
      return st.failHead ? Promise.reject(new ChainError("rpc down")) : Promise.resolve(st.head);
    },
    async getLogs(from, to) {
      st.calls.getLogs.push([from, to]);
      if (st.logsGate) await st.logsGate;
      if (st.logsDelayMs) await new Promise((r) => setTimeout(r, st.logsDelayMs));
      if (st.failLogs) throw new ChainError("rpc down");
      if (to - from + 1 > 10_000) throw new ChainError("query exceeds max block range 10000");
      return st.logs.filter((l) => bn(l) >= from && bn(l) <= to);
    },
    blockTimes(blocks) {
      return Promise.resolve(new Map(blocks.map((b) => [b, T0 + b * 3])));
    },
    balanceWei(at) {
      if (st.failBalance) return Promise.reject(new ChainError("rpc down"));
      if (st.balanceOverride !== undefined) return Promise.resolve(st.balanceOverride);
      // what the contract would hold at `at`: tipped - claimed - refunded over the logs up to that block
      const rows = decodeLogs(ESCROW.toLowerCase(), st.logs.filter((l) => at === undefined || bn(l) <= at), new Map(st.logs.map((l) => [bn(l), T0 + bn(l) * 3])));
      const net = rows.reduce((a, r) => a + (r.event === "Tipped" ? BigInt(r.amount_wei) : -BigInt(r.amount_wei)), 0n);
      return Promise.resolve(net);
    },
  };
}

export const silent = () => {};
