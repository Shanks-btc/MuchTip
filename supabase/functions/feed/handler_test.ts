import { assert, assertEquals } from "jsr:@std/assert@^1";
import { ethers } from "../_shared/eth.ts";
import { idHashOf } from "../_shared/ids.ts";
import { claimed, ESCROW, FakeFeedStore, FakeRateLimiter, fakeChain, refunded, T0, tipped } from "../_shared/testing.ts";
import { createFeedHandler, type FeedDeps, toFeedEvent } from "./handler.ts";

const ID_A = idHashOf(2244994945n);
const ID_B = idHashOf(1850123456789012345n);
const ID_C = idHashOf(777n);
const ALICE = ethers.getAddress("0x" + "a1".repeat(20));
const BOB = ethers.getAddress("0x" + "b2".repeat(20));
const WEI = 10n ** 18n;

function setup(logs: ReturnType<typeof fakeChain>["st"]["logs"] = [], over: Partial<FeedDeps> = {}) {
  const chain = fakeChain({ head: 2000, logs });
  const store = new FakeFeedStore();
  store.handles.set(ID_A, { x_id: "2244994945", handle: "XDevelopers" });
  store.handles.set(ID_B, { x_id: "1850123456789012345", handle: "MuchTipDemo" });
  const state = { now: 10_000_000 };
  const log: Record<string, unknown>[] = [];
  const deps: FeedDeps = {
    chain, store, rateLimit: new FakeRateLimiter(), startBlock: 100, confirmations: 0, minSyncIntervalMs: 5000, maxBlocksPerSync: 100_000,
    chunkBlocks: 9000, leaseSeconds: 30, settingsTtlMs: 60_000, ipLimitPerMinute: 120, now: () => state.now, corsOrigin: "*", log: (e) => log.push(e), ...over,
  };
  const handler = createFeedHandler(deps);
  const get = (qs = "") => handler(new Request(`http://f/feed${qs}`));
  return { chain, store, state, log, get, handler };
}

// A small history: 3 tips (A twice, B once), A claims the first two, B's tip is refunded.
const history = () => [
  tipped(1, ID_A, ALICE, 5n * WEI, 200),
  tipped(2, ID_B, ALICE, 7n * WEI, 210),
  tipped(3, ID_A, BOB, 6n * WEI, 220),
  claimed(ID_A, BOB, 11n * WEI, 123n, 2244994945n, 230),
  refunded(2, ID_B, ALICE, 7n * WEI, 240),
  tipped(4, ID_C, BOB, 9n * WEI, 250), // an account nobody has resolved
];

Deno.test("feed: totals are computed from the events (tipsCount, totalTippedWei, uniqueHandles, unclaimedWei)", async () => {
  const { get } = setup(history());
  const b = await (await get()).json();
  assertEquals(b.totals.tipsCount, 4);
  assertEquals(b.totals.totalTippedWei, String(27n * WEI)); // 5 + 7 + 6 + 9
  assertEquals(b.totals.uniqueHandles, 3); // A, B and C were tipped
  assertEquals(b.totals.claimedWei, String(11n * WEI));
  assertEquals(b.totals.refundedWei, String(7n * WEI));
  assertEquals(b.totals.unclaimedWei, String(9n * WEI)); // only C's tip is still owed
  assertEquals([b.totals.claimsCount, b.totals.refundsCount], [1, 1]);
});

Deno.test("feed: amounts are strings and stay exact above 2^53", async () => {
  const big = 123456789012345678901n; // > 2^64, > 2^53
  const { get } = setup([tipped(1, ID_A, ALICE, big, 200)]);
  const b = await (await get()).json();
  assertEquals(b.totals.totalTippedWei, "123456789012345678901");
  assertEquals(b.totals.unclaimedWei, "123456789012345678901");
  assertEquals(b.events[0].amountWei, "123456789012345678901");
  assertEquals(typeof b.totals.totalTippedWei, "string");
});

Deno.test("feed: events are newest first, typed, and joined with handles (null when unresolved)", async () => {
  const { get } = setup(history());
  const b = await (await get()).json();
  assertEquals(b.events.map((e: { type: string }) => e.type), ["Tipped", "Refunded", "Claimed", "Tipped", "Tipped", "Tipped"]);
  const [tipC, refund, claim, tipA2] = b.events;
  assertEquals([tipC.handle, tipC.xId, tipC.from, tipC.tipId], [null, null, BOB, "4"]);
  assertEquals([refund.handle, refund.tipper, refund.tipId], ["MuchTipDemo", ALICE, "2"]);
  assertEquals([claim.handle, claim.xId, claim.recipient, claim.amountWei], ["XDevelopers", "2244994945", BOB, String(11n * WEI)]);
  assertEquals([tipA2.handle, tipA2.xId, tipA2.from, tipA2.blockNumber], ["XDevelopers", "2244994945", BOB, 220]);
  assertEquals(tipA2.time, new Date((T0 + 220 * 3) * 1000).toISOString());
  assert(/^0x[0-9a-f]{64}$/.test(tipA2.txHash) && /^0x[0-9a-f]{64}$/.test(tipA2.idHash));
});

Deno.test("feed: limit and type filters, with validation", async () => {
  const { get } = setup(history());
  assertEquals((await (await get("?limit=2")).json()).events.length, 2);
  const tips = (await (await get("?type=Tipped")).json()).events;
  assertEquals(tips.length, 4);
  assert(tips.every((e: { type: string }) => e.type === "Tipped"));
  assertEquals((await (await get("?type=Refunded&limit=1")).json()).events.length, 1);
  for (const qs of ["?limit=0", "?limit=101", "?limit=abc", "?limit=1.5", "?limit=-1"]) {
    const r = await get(qs);
    assertEquals([qs, r.status, (await r.json()).error.code], [qs, 400, "invalid_limit"]);
  }
  const t = await get("?type=Burned");
  assertEquals([t.status, (await t.json()).error.code], [400, "invalid_type"]);
});

Deno.test("feed: config comes from the chain (refundDelay/minTip), cached between requests", async () => {
  const { get, chain, state } = setup(history());
  const b = await (await get()).json();
  assertEquals(b.config, { refundDelaySeconds: 600, minTipWei: String(5n * WEI) });
  await get();
  assertEquals(chain.st.calls.settings, 1); // within the TTL
  state.now += 61_000;
  chain.st.settings = { ...chain.st.settings, refundDelay: 900n, minTip: 7n * WEI };
  const b2 = await (await get()).json();
  assertEquals(b2.config, { refundDelaySeconds: 900, minTipWei: String(7n * WEI) });
  assertEquals(chain.st.calls.settings, 2);
});

Deno.test("feed: contract metadata, sync status and the balance cross-check", async () => {
  const { get } = setup(history());
  const b = await (await get()).json();
  assertEquals([b.contract, b.chainId], [ESCROW, 6281971]);
  assertEquals(b.sync, { headBlock: 2000, indexedToBlock: 2000, lagBlocks: 0, complete: true });
  // the contract would hold exactly what the events say it owes, at the block the totals were computed for
  assertEquals(b.onChain, { balanceWei: String(9n * WEI), matchesTotals: true });
});

Deno.test("feed: a balance that disagrees with the events is flagged and logged", async () => {
  const s = setup(history());
  s.chain.st.balanceOverride = 8n * WEI;
  const b = await (await s.get()).json();
  assertEquals(b.onChain, { balanceWei: String(8n * WEI), matchesTotals: false });
  assert(s.log.some((l) => l.event === "balance_mismatch"));
});

Deno.test("feed: syncs only what is new, and not at all within the throttle interval", async () => {
  const s = setup(history());
  await s.get();
  const first = s.chain.st.calls.getLogs.length;
  assertEquals(first, 1);
  s.state.now += 1000;
  s.chain.st.head = 2100;
  s.chain.st.logs.push(tipped(5, ID_B, ALICE, WEI, 2050));
  await s.get(); // 1 s later: throttled, the new tip is not fetched yet
  assertEquals(s.chain.st.calls.getLogs.length, first);
  s.state.now += 6000;
  const b = await (await s.get()).json();
  assertEquals(s.chain.st.calls.getLogs.at(-1), [2001, 2100]);
  assertEquals(b.totals.tipsCount, 5);
  assertEquals(b.events[0].tipId, "5");
});

Deno.test("feed: when the RPC is down it still serves the stored events and says how stale they are", async () => {
  const s = setup(history());
  await s.get(); // populate
  s.state.now += 60_000;
  s.chain.st.failHead = true;
  s.chain.st.failBalance = true;
  s.chain.st.failSettings = true;
  s.chain.st.calls.settings = 0;
  const r = await s.get();
  assertEquals(r.status, 200);
  const b = await r.json();
  assertEquals(b.totals.tipsCount, 4);
  assertEquals(b.sync, { headBlock: null, indexedToBlock: 2000, lagBlocks: null, complete: false });
  assertEquals(b.onChain, null);
  assertEquals(b.config.minTipWei, String(5n * WEI)); // stale settings beat none
  assert(s.log.some((l) => l.event === "sync_failed"));
});

Deno.test("feed: with no data and the RPC down, it answers an empty feed rather than failing", async () => {
  const s = setup([]);
  s.chain.st.failHead = true;
  s.chain.st.failSettings = true;
  const b = await (await s.get()).json();
  assertEquals(b.totals.tipsCount, 0);
  assertEquals([b.totals.totalTippedWei, b.totals.unclaimedWei, b.events, b.config, b.onChain], ["0", "0", [], null, null]);
});

Deno.test("feed: empty contract -> zero totals", async () => {
  const b = await (await setup([]).get()).json();
  assertEquals(b.totals, { tipsCount: 0, totalTippedWei: "0", uniqueHandles: 0, unclaimedWei: "0", claimedWei: "0", refundedWei: "0", claimsCount: 0, refundsCount: 0 });
  assertEquals(b.onChain, { balanceWei: "0", matchesTotals: true });
});

Deno.test("feed: a long backlog is bounded per request and flagged incomplete until caught up", async () => {
  const s = setup(history(), { maxBlocksPerSync: 150, chunkBlocks: 100, minSyncIntervalMs: 0 });
  const b1 = await (await s.get()).json();
  assertEquals([b1.sync.indexedToBlock, b1.sync.complete], [249, false]); // blocks 100..249 scanned (150), head is 2000
  assertEquals(b1.totals.tipsCount, 3); // the tips at 200, 210, 220 are in; the one at 250 is not yet
  for (let i = 0; i < 20; i++) await s.get();
  const done = await (await s.get()).json();
  assertEquals([done.sync.indexedToBlock, done.sync.complete], [2000, true]);
});

Deno.test("feed: totals only count events up to the indexed block", async () => {
  const s = setup(history(), { maxBlocksPerSync: 121, chunkBlocks: 121 }); // indexes blocks 100..220 only
  const b = await (await s.get()).json();
  assertEquals(b.sync.indexedToBlock, 220);
  assertEquals(b.totals.tipsCount, 3); // tips at 200, 210, 220; the claim, refund and 4th tip are beyond
  assertEquals(b.totals.unclaimedWei, String(18n * WEI));
  assertEquals(b.onChain.matchesTotals, true); // balance read at block 220, matching
});

Deno.test("feed: rate limit, method and CORS", async () => {
  const s = setup(history(), { ipLimitPerMinute: 2 });
  assertEquals((await s.get()).status, 200);
  assertEquals((await s.get()).status, 200);
  const r = await s.get();
  assertEquals([r.status, r.headers.get("retry-after")], [429, "60"]);
  const post = await s.handler(new Request("http://f/feed", { method: "POST" }));
  assertEquals([post.status, post.headers.get("allow")], [405, "GET, OPTIONS"]);
  const pre = await s.handler(new Request("http://f/feed", { method: "OPTIONS" }));
  assertEquals([pre.status, pre.headers.get("access-control-allow-origin")], [204, "*"]);
  const ok = await setup(history()).get();
  assertEquals(ok.headers.get("cache-control"), "public, max-age=3");
});

Deno.test("toFeedEvent: addresses come back checksummed", () => {
  const e = toFeedEvent({
    contract: ESCROW.toLowerCase(), block_number: 1, log_index: 0, tx_hash: "0x" + "01".repeat(32), event: "Tipped", id_hash: ID_A, tip_id: "9",
    account: ALICE.toLowerCase(), amount_wei: "5", x_id: null, block_time: "2026-10-31T13:00:00+00:00",
  }, undefined);
  assertEquals([e.type, (e as { from: string }).from, e.time, e.handle, e.xId], ["Tipped", ALICE, "2026-10-31T13:00:00.000Z", null, null]);
});

Deno.test("feed: 6 concurrent requests -> each block range fetched and stored once; every answer is internally consistent", async () => {
  const s = setup(history(), { minSyncIntervalMs: 0 });
  s.chain.st.logsDelayMs = 5;
  const bodies = await Promise.all(Array.from({ length: 6 }, (_, i) => s.get(`?limit=10`).then((r) => r.json()).then((b) => ({ i, b }))));
  const ranges = s.chain.st.calls.getLogs.map(([from, to]) => ({ from, to })).sort((a, b) => a.from - b.from);
  for (let k = 1; k < ranges.length; k++) assertEquals(ranges[k].from, ranges[k - 1].to + 1, "overlapping or gapped fetch");
  assertEquals(s.store.events.size, 6); // all six events, none twice
  assertEquals(new Set(s.store.applied.map((a) => a.owner)).size, 1);
  for (const { b } of bodies) {
    // a request that found the lease taken answers from what was stored when it looked; either way totals match the chain at that block
    assertEquals(b.onChain === null || b.onChain.matchesTotals === true, true);
  }
  const final = await (await s.get()).json();
  assertEquals([final.totals.tipsCount, final.sync.indexedToBlock], [4, 2000]);
});
