import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@^1";
import { ethers } from "../_shared/eth.ts";
import { idHashOf } from "../_shared/ids.ts";
import { FakeHandleStore, FakeRateLimiter } from "../_shared/testing.ts";
import { createMockLookup, createXLookup, UpstreamError, type XLookup, type XUser } from "../_shared/x-api.ts";
import { createResolveHandler, type ResolveDeps } from "./handler.ts";

const T = Date.parse("2026-10-31T12:00:00Z");

function setup(over: Partial<ResolveDeps> = {}, fixtures: Record<string, XUser> = {
  xdevelopers: { id: "2244994945", username: "XDevelopers", name: "X Developers" },
  doge_fan_42: { id: "710000042", username: "Doge_Fan_42", name: "Doge Fan" },
  dogexfany42: { id: "999", username: "DogeXFanY42", name: null },
  muchtipdemo: { id: "1850123456789012345", username: "MuchTipDemo", name: "MuchTip Demo" },
}) {
  const store = new FakeHandleStore();
  const rateLimit = new FakeRateLimiter();
  const logs: Record<string, unknown>[] = [];
  const state = { now: T, lookups: [] as string[] };
  const lookup: XLookup = (h) => {
    state.lookups.push(h);
    return Promise.resolve(fixtures[h.toLowerCase()] ?? null);
  };
  const deps: ResolveDeps = {
    store, rateLimit, lookup, mode: "x", now: () => state.now, cacheTtlMs: 3_600_000, ipLimitPerMinute: 30, freshLimitPerMinute: 10,
    xBudget: { windowSeconds: 900, limit: 280 }, corsOrigin: "*", log: (e) => logs.push(e), ...over,
  };
  const handler = createResolveHandler(deps);
  const call = (handle: unknown, method: "GET" | "POST" = "POST", headers: Record<string, string> = {}, fresh?: boolean) =>
    method === "GET"
      ? handler(new Request(`http://f/resolve?handle=${encodeURIComponent(String(handle))}${fresh ? "&fresh=1" : ""}`, { headers }))
      : handler(new Request("http://f/resolve", { method: "POST", body: JSON.stringify(fresh ? { handle, fresh: true } : { handle }), headers }));
  return { store, rateLimit, logs, state, call, handler };
}
const errCode = async (r: Response) => (await r.json()).error.code;

Deno.test("resolve: strips @, queries X once, returns the id and the contract's idHash", async () => {
  const { call, state, store } = setup();
  const r = await call("@XDevelopers");
  assertEquals(r.status, 200);
  const b = await r.json();
  assertEquals(b.xId, "2244994945");
  assertEquals(b.handle, "XDevelopers");
  assertEquals(b.idHash, "0x9459c13b5c21e1f0cc54307300f50fe36658555fa2b2355575aa4d05c6f21914");
  assertEquals(b.source, "x");
  assertEquals(b.resolvedAt, new Date(T).toISOString());
  assertEquals(state.lookups, ["XDevelopers"]);
  assertEquals(store.rows.get("2244994945")?.id_hash, b.idHash);
});

Deno.test("resolve: ids above 2^53 stay exact end to end", async () => {
  const { call } = setup();
  const b = await (await call("MuchTipDemo")).json();
  assertEquals(b.xId, "1850123456789012345");
  assertEquals(b.idHash, idHashOf(1850123456789012345n));
});

Deno.test("resolve: second call is served from the cache without calling X (any casing, GET or POST)", async () => {
  const { call, state } = setup();
  await call("XDevelopers");
  for (const [h, m] of [["xdevelopers", "POST"], ["@XDEVELOPERS", "GET"]] as const) {
    const b = await (await call(h, m)).json();
    assertEquals([b.source, b.xId, b.handle], ["cache", "2244994945", "XDevelopers"]);
  }
  assertEquals(state.lookups.length, 1);
});

Deno.test("resolve: a cache entry older than the TTL is refreshed from X", async () => {
  const { call, state, store } = setup();
  await call("XDevelopers");
  state.now = T + 3_600_000 - 1;
  assertEquals((await (await call("XDevelopers")).json()).source, "cache"); // just inside
  state.now = T + 3_600_000;
  assertEquals((await (await call("XDevelopers")).json()).source, "x"); // at the TTL
  assertEquals(state.lookups.length, 2);
  assertEquals(store.rows.get("2244994945")?.resolved_at, new Date(T + 3_600_000).toISOString());
});

Deno.test("resolve: an unknown handle is a 404, and nothing is cached", async () => {
  const { call, store, state } = setup();
  const r = await call("nobody_here");
  assertEquals(r.status, 404);
  const e = (await r.json()).error;
  assertEquals(e.code, "handle_not_found");
  assert(e.message.includes("@nobody_here"));
  assertEquals(store.rows.size, 0);
  await call("nobody_here");
  assertEquals(state.lookups.length, 2); // a miss is not cached, so each attempt is a lookup (rate limits bound the cost)
});

Deno.test("resolve: underscores in handles do not act as wildcards in the cache lookup", async () => {
  // Regression test from the LIKE era: Doge_Fan_42 must never be served DogeXFanY42 (which an unescaped "_" wildcard would
  // match). The real store now uses exact equality on lower(handle); see the handleStoreFrom test and the integration test.
  const { call, state } = setup();
  await call("DogeXFanY42");
  const b = await (await call("Doge_Fan_42")).json();
  assertEquals([b.source, b.xId], ["x", "710000042"]);
  assertEquals(state.lookups, ["DogeXFanY42", "Doge_Fan_42"]);
});

Deno.test("resolve: invalid handles are 400 and never reach the limiter, store or X", async () => {
  const { call, state, rateLimit } = setup();
  for (const bad of ["", "   ", "@", "a".repeat(16), "no spaces", "https://x.com/jack", "dot.name", 42, null]) {
    const r = await call(bad);
    assertEquals(r.status, 400, JSON.stringify(bad));
    assertEquals(await errCode(r), "invalid_handle");
  }
  assertEquals(state.lookups.length, 0);
  assertEquals(rateLimit.counts.size, 0);
});

Deno.test("resolve: request-shape errors: bad JSON, non-object, wrong method, oversized body", async () => {
  const { handler } = setup();
  const post = (body: string) => handler(new Request("http://f/resolve", { method: "POST", body }));
  assertEquals(await errCode(await post("{not json")), "invalid_json");
  assertEquals(await errCode(await post("[1]")), "invalid_json");
  assertEquals(await errCode(await post("{}")), "invalid_handle");
  assertEquals((await post(JSON.stringify({ handle: "x".repeat(5000) }))).status, 413);
  const del = await handler(new Request("http://f/resolve", { method: "DELETE" }));
  assertEquals([del.status, del.headers.get("allow")], [405, "GET, POST, OPTIONS"]);
});

Deno.test("resolve: CORS preflight and headers on every response", async () => {
  const { handler, call } = setup({ corsOrigin: "https://muchtip.example" });
  const pre = await handler(new Request("http://f/resolve", { method: "OPTIONS" }));
  assertEquals(pre.status, 204);
  assertEquals(pre.headers.get("access-control-allow-origin"), "https://muchtip.example");
  assert(pre.headers.get("access-control-allow-headers")!.includes("authorization"));
  for (const r of [await call("XDevelopers"), await call("nobody_here"), await call("")]) {
    assertEquals(r.headers.get("access-control-allow-origin"), "https://muchtip.example");
    assertEquals(r.headers.get("cache-control"), "no-store");
  }
});

Deno.test("resolve: per-IP rate limit returns 429 with Retry-After; different IPs are separate", async () => {
  const { call, state } = setup({ ipLimitPerMinute: 2 });
  const ip = (n: string) => ({ "x-forwarded-for": `${n}, 10.0.0.1` });
  assertEquals((await call("XDevelopers", "POST", ip("203.0.113.1"))).status, 200);
  assertEquals((await call("XDevelopers", "POST", ip("203.0.113.1"))).status, 200);
  const r = await call("XDevelopers", "POST", ip("203.0.113.1"));
  assertEquals([r.status, r.headers.get("retry-after"), await errCode(r)], [429, "60", "rate_limited"]);
  assertEquals((await call("XDevelopers", "POST", ip("203.0.113.2"))).status, 200);
  assertEquals(state.lookups.length, 1);
});

Deno.test("resolve: fails closed (503) when the rate limiter is unavailable", async () => {
  const { call, rateLimit, state } = setup();
  rateLimit.fail = true;
  const r = await call("XDevelopers");
  assertEquals([r.status, await errCode(r)], [503, "rate_limit_unavailable"]);
  assertEquals(state.lookups.length, 0);
});

Deno.test("resolve: the global X budget caps paid lookups but not cache hits, and mock mode does not spend it", async () => {
  const x = setup({ xBudget: { windowSeconds: 900, limit: 2 }, ipLimitPerMinute: 1000 });
  assertEquals((await x.call("XDevelopers")).status, 200); // budget 1 (miss)
  assertEquals((await x.call("MuchTipDemo")).status, 200); // budget 2 (miss)
  assertEquals((await x.call("XDevelopers")).status, 200); // cache hit: no budget
  const over = await x.call("Doge_Fan_42"); // budget 3: over
  assertEquals([over.status, await errCode(over)], [429, "rate_limited"]);

  const mock = setup({ mode: "mock", xBudget: { windowSeconds: 900, limit: 1 }, ipLimitPerMinute: 1000 });
  for (const h of ["XDevelopers", "MuchTipDemo", "Doge_Fan_42"]) assertEquals((await mock.call(h)).status, 200);
  assertEquals(mock.rateLimit.counts.get("xapi:global"), undefined);
});

Deno.test("resolve: X failures map to 429 / 502 and never leak details", async () => {
  const failing = (kind: UpstreamError["kind"]) => setup({ lookup: () => Promise.reject(new UpstreamError(kind, `secret detail with token tok_123 (${kind})`)) });
  const rl = await failing("rate_limited").call("jack");
  assertEquals([rl.status, rl.headers.get("retry-after"), await errCode(rl)], [429, "60", "upstream_rate_limited"]);
  for (const kind of ["auth", "unavailable", "invalid"] as const) {
    const s = failing(kind);
    const r = await s.call("jack");
    const text = JSON.stringify(await r.json());
    assertEquals(r.status, 502, kind);
    assert(!text.includes("tok_123") && !text.includes("secret"), `${kind} response leaked: ${text}`);
    assert(s.logs.some((l) => l.event === "upstream_error" && l.kind === kind)); // but it is logged for the operator
    assertEquals(s.store.rows.size, 0);
  }
});

Deno.test("resolve: X answering with a different username than asked is refused (502), not cached", async () => {
  const { call, store, logs } = setup({ lookup: () => Promise.resolve({ id: "5", username: "SomeoneElse", name: null }) });
  const r = await call("jack");
  assertEquals([r.status, await errCode(r)], [502, "upstream_unavailable"]);
  assertEquals(store.rows.size, 0);
  assert(logs.some((l) => l.event === "username_mismatch"));
});

Deno.test("resolve: canonical casing from X is stored and returned", async () => {
  const { call, store } = setup();
  const b = await (await call("xdevelopers")).json();
  assertEquals(b.handle, "XDevelopers");
  assertEquals(store.rows.get("2244994945")?.handle, "XDevelopers");
});

Deno.test("resolve: a recently reassigned handle resolves to the newest row", async () => {
  const { call, store, state } = setup();
  store.rows.set("111", { x_id: "111", handle: "XDevelopers", name: "Old Owner", id_hash: idHashOf(111n), resolved_at: new Date(T - 7_200_000).toISOString() }); // stale old owner
  const b = await (await call("XDevelopers")).json(); // stale (>1h): refresh finds the current owner
  assertEquals([b.source, b.xId], ["x", "2244994945"]);
  assertEquals(state.lookups.length, 1);
  assertEquals((await (await call("XDevelopers")).json()).xId, "2244994945"); // the cache now answers with the current owner
  assertEquals(store.rows.get("111")?.handle, null); // the previous owner lost the handle
});

Deno.test("resolve: idHash in the response is recomputed, not trusted from the database", async () => {
  const { call, store } = setup();
  store.rows.set("2244994945", { x_id: "2244994945", handle: "XDevelopers", name: null, id_hash: "0x" + "00".repeat(32), resolved_at: new Date(T).toISOString() });
  assertEquals((await (await call("XDevelopers")).json()).idHash, idHashOf(2244994945n));
});

Deno.test("resolve + real X client against a fake fetch: end to end through createXLookup", async () => {
  let calls = 0;
  const lookup = createXLookup({
    bearer: "tok",
    fetch: ((_u: string) => {
      calls++;
      return Promise.resolve(new Response(JSON.stringify({ data: { id: "2244994945", name: "X Developers", username: "XDevelopers" } })));
    }) as unknown as typeof fetch,
  });
  const { call } = setup({ lookup });
  assertEquals((await (await call("XDevelopers")).json()).source, "x");
  assertEquals((await (await call("XDevelopers")).json()).source, "cache");
  assertEquals(calls, 1);
});

Deno.test("resolve: mock mode serves fixtures and labels them", async () => {
  const { call, logs } = setup({ mode: "mock", lookup: createMockLookup() });
  const b = await (await call("jack")).json();
  assertEquals([b.source, b.xId, b.handle], ["mock", "12", "jack"]);
  assertEquals((await call("not_a_fixture")).status, 404);
  assert(logs.some((l) => l.event === "resolved" && l.source === "mock"));
  assertNotEquals(b.idHash, ethers.ZeroHash);
});

// ---------------------------------------------------------------- fresh mode (the tip flow)
Deno.test("fresh: always asks X even with a fresh cache entry, returns the display name, and refreshes the cache", async () => {
  const { call, state, store } = setup();
  await call("XDevelopers"); // cached
  state.now += 60_000;
  for (const [m, h] of [["POST", "XDevelopers"], ["GET", "@xdevelopers"]] as const) {
    const b = await (await call(h, m, {}, true)).json();
    assertEquals([b.source, b.xId, b.handle, b.name], ["x", "2244994945", "XDevelopers", "X Developers"]);
  }
  assertEquals(state.lookups.length, 3);
  assertEquals(store.rows.get("2244994945")?.resolved_at, new Date(state.now).toISOString());
  assertEquals((await (await call("XDevelopers")).json()).source, "cache"); // display lookups still use the cache
});

Deno.test("fresh: a handle reassigned within the cache hour -> cached lookup is stale, fresh is right, and then the cache is right", async () => {
  const fx: Record<string, XUser> = { xdevelopers: { id: "111", username: "XDevelopers", name: "Old Owner" } };
  const s = setup({}, fx);
  assertEquals((await (await s.call("XDevelopers")).json()).xId, "111");
  fx.xdevelopers = { id: "222", username: "XDevelopers", name: "New Owner" }; // X reassigns the handle
  s.state.now += 10 * 60_000; // ten minutes later: still inside the cache hour
  assertEquals((await (await s.call("XDevelopers")).json()).xId, "111"); // the stale answer the tip flow must never use
  const fresh = await (await s.call("XDevelopers", "POST", {}, true)).json();
  assertEquals([fresh.xId, fresh.name, fresh.source], ["222", "New Owner", "x"]);
  assertEquals(fresh.idHash, idHashOf(222n));
  assertEquals((await (await s.call("XDevelopers")).json()).xId, "222");
  assertEquals(s.store.rows.get("111")?.handle, null);
});

Deno.test("fresh: unknown -> 404; only an explicit true / 1 / 'true' turns it on", async () => {
  const s = setup();
  assertEquals((await s.call("nobody_here", "POST", {}, true)).status, 404);
  await s.call("XDevelopers");
  for (const fresh of [false, 0, "0", "yes", null]) {
    const r = await s.handler(new Request("http://f/resolve", { method: "POST", body: JSON.stringify({ handle: "XDevelopers", fresh }) }));
    assertEquals((await r.json()).source, "cache", JSON.stringify(fresh));
  }
  const r = await s.handler(new Request("http://f/resolve", { method: "POST", body: JSON.stringify({ handle: "XDevelopers", fresh: "true" }) }));
  assertEquals((await r.json()).source, "x");
});

Deno.test("fresh: has its own tighter per-IP limit, and spends the global X budget", async () => {
  const s = setup({ freshLimitPerMinute: 2, ipLimitPerMinute: 100, xBudget: { windowSeconds: 900, limit: 100 } });
  const ip = { "x-forwarded-for": "203.0.113.9" };
  assertEquals((await s.call("XDevelopers", "POST", ip, true)).status, 200);
  assertEquals((await s.call("XDevelopers", "POST", ip, true)).status, 200);
  const over = await s.call("XDevelopers", "POST", ip, true);
  assertEquals([over.status, (await over.json()).error.code], [429, "rate_limited"]);
  assertEquals((await s.call("XDevelopers", "POST", ip)).status, 200); // a cached lookup from the same IP is still fine
  assertEquals(s.rateLimit.counts.get("xapi:global"), 2);
});

Deno.test("fresh: works in mock mode and returns the fixture's name", async () => {
  const { call } = setup({ mode: "mock", lookup: createMockLookup() });
  const b = await (await call("jack", "POST", {}, true)).json();
  assertEquals([b.source, b.xId, b.name], ["mock", "12", "jack"]);
});

Deno.test("name: a missing display name is null, not an error", async () => {
  const b = await (await setup().call("DogeXFanY42", "POST", {}, true)).json();
  assertEquals([b.xId, b.name], ["999", null]);
});
