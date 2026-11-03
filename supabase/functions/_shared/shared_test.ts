import { assert, assertEquals, assertNotEquals, assertRejects, assertThrows } from "jsr:@std/assert@^1";
import { escrowIface, FEED_TOPICS } from "./abi.ts";
import { type AuthUserLike, xIdFromUser } from "./claim-gate.ts";
import { createChain, ChainError } from "./chain.ts";
import { claimDigest, CLAIM_TYPES, signClaim } from "./eip712.ts";
import { chainConfig, intEnv } from "./env.ts";
import { ethers } from "./eth.ts";
import { allowedOrigin, HttpError } from "./http.ts";
import { idHashOf, normaliseHandle } from "./ids.ts";
import { decodeLogs, syncEvents } from "./indexer.ts";
import { enforce, ipBucket } from "./ratelimit.ts";
import { type Client, handleStoreFrom } from "./supabase.ts";
import { cleanDisplayName, createMockLookup, createXLookup, MOCK_FIXTURES, UpstreamError } from "./x-api.ts";
import { CHAIN_ID, claimed, ESCROW, FakeFeedStore, FakeRateLimiter, fakeChain, refunded, T0, tipped } from "./testing.ts";

const env = (o: Record<string, string>) => ({ get: (k: string) => o[k] });

// ---------------------------------------------------------------- ids / handles
Deno.test("idHashOf matches TipEscrow.idHash (value pinned from the live contract: 0x9459c13b… for 2244994945)", () => {
  assertEquals(idHashOf(2244994945n), "0x9459c13b5c21e1f0cc54307300f50fe36658555fa2b2355575aa4d05c6f21914");
  assertEquals(idHashOf("1850123456789012345"), "0x0a7661b5bdf38e473300c54a5c4bf450a80dc3ae946e9f62944c5cbec744d8fa");
  assertEquals(idHashOf(0n), ethers.keccak256(new Uint8Array(32)));
  assertThrows(() => idHashOf(-1n), RangeError);
  assertThrows(() => idHashOf(1n << 256n), RangeError);
});

Deno.test("normaliseHandle", () => {
  assertEquals(normaliseHandle("@XDevelopers"), "XDevelopers");
  assertEquals(normaliseHandle("  jack "), "jack");
  assertEquals(normaliseHandle("Doge_Fan_42"), "Doge_Fan_42");
  assertEquals(normaliseHandle("a".repeat(15)), "a".repeat(15));
  for (const bad of ["", "@", "@@jack", "a".repeat(16), "has space", "dot.name", "https://x.com/jack", "jack/", "emoji🐕", "ja-ck", null, undefined, 12, {}]) {
    assertEquals(normaliseHandle(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

Deno.test("handleStoreFrom: exact lookup on handle_lc (lower-cased), and writes go through upsert_x_handle", async () => {
  const calls: unknown[] = [];
  // deno-lint-ignore no-explicit-any
  const q: any = {
    select: (cols: string) => (calls.push(["select", cols]), q),
    eq: (col: string, v: string) => (calls.push(["eq", col, v]), q),
    ilike: () => {
      throw new Error("no pattern matching");
    },
    limit: () => Promise.resolve({ data: [], error: null }),
  };
  const client = {
    from: (t: string) => (calls.push(["from", t]), q),
    rpc: (fn: string, args: unknown) => (calls.push(["rpc", fn, args]), Promise.resolve({ data: null, error: null })),
  };
  const store = handleStoreFrom(client as unknown as Client);
  assertEquals(await store.findByHandle("Doge_Fan_42"), null);
  assertEquals(calls.slice(0, 3), [["from", "x_handles"], ["select", "x_id,handle,name,id_hash,resolved_at"], ["eq", "handle_lc", "doge_fan_42"]]);
  await store.upsert({ x_id: "1", handle: "Ab", name: "N", id_hash: idHashOf(1n), resolved_at: "2026-10-31T00:00:00.000Z" });
  assertEquals(calls.at(-1), ["rpc", "upsert_x_handle", { p_x_id: "1", p_handle: "Ab", p_name: "N", p_id_hash: idHashOf(1n), p_resolved_at: "2026-10-31T00:00:00.000Z" }]);
});

// ---------------------------------------------------------------- claim gate (TypeScript port of spike/supabase/edge-check.cjs)
const ident = (provider: string, id: string, extra: Record<string, unknown> = {}) => ({ provider, id, identity_data: { sub: id, ...extra } });
const X = ident("x", "2244994945", { user_name: "XDevelopers" });

Deno.test("claim gate: accepts exactly one x identity, keeps ids above 2^53 exact", () => {
  assertEquals(xIdFromUser({ identities: [X] }), { ok: true, xId: 2244994945n, username: "XDevelopers" });
  const big = xIdFromUser({ identities: [ident("x", "1850123456789012345")] });
  assert(big.ok && big.xId === 1850123456789012345n);
});

Deno.test("claim gate: rejects everything that is not exactly one x identity", () => {
  const cases: Array<[string, AuthUserLike | null]> = [
    ["no user", null],
    ["no identities", { identities: [] }],
    ["identities missing", {}],
    ["identities null", { identities: null }],
    ["email only", { identities: [ident("email", "u1")] }],
    ["phone only", { identities: [ident("phone", "u1")] }],
    ["github only", { identities: [ident("github", "2244994945")] }],
    ["x + email", { identities: [X, ident("email", "u1")] }],
    ["email + x", { identities: [ident("email", "u1"), X] }],
    ["x + phone", { identities: [X, ident("phone", "u1")] }],
    ["x + github", { identities: [X, ident("github", "9")] }],
    ["x + x (different)", { identities: [X, ident("x", "1850123456789012345")] }],
    ["x + x (same)", { identities: [X, X] }],
    ["anonymous", { is_anonymous: true, identities: [] }],
    ["anonymous flag on an x identity", { is_anonymous: true, identities: [X] }],
    ["non-numeric id", { identities: [ident("x", "abc")] }],
    ["negative id", { identities: [ident("x", "-5")] }],
    ["21-digit id", { identities: [ident("x", "1".repeat(21))] }],
    ["id and sub disagree", { identities: [{ provider: "x", id: "2244994945", identity_data: { sub: "999" } }] }],
    ["missing id", { identities: [{ provider: "x" }] }],
  ];
  for (const [label, user] of cases) assertEquals(xIdFromUser(user).ok, false, label);
});

Deno.test("claim gate ignores user_metadata and app_metadata entirely", () => {
  const spoof = { identities: [X], user_metadata: { sub: "1", provider_id: "1", user_name: "evil" }, app_metadata: { provider: "x", providers: ["x"] } };
  assertEquals(xIdFromUser(spoof as AuthUserLike), { ok: true, xId: 2244994945n, username: "XDevelopers" });
  const emailPretendingX = { identities: [ident("email", "u1")], user_metadata: { sub: "2244994945", provider_id: "2244994945" } };
  assertEquals(xIdFromUser(emailPretendingX as AuthUserLike).ok, false);
});

// ---------------------------------------------------------------- EIP-712
const wallet = new ethers.Wallet("0x" + "11".repeat(32));
const MSG = { xId: 2244994945n, recipient: ethers.getAddress("0x00000000000000000000000000000000000000aa"), nonce: 12345n, expiry: 1793003600n };

// Independent encoding, written the way test/TipEscrow.t.sol's _digest does it (abi.encode + keccak), not via TypedDataEncoder.
function manualDigest(chainId: bigint, escrow: string, m: typeof MSG): string {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const domain = ethers.keccak256(abi.encode(
    ["bytes32", "bytes32", "bytes32", "uint256", "address"],
    [ethers.id("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), ethers.id("TipEscrow"), ethers.id("1"), chainId, escrow],
  ));
  const struct = ethers.keccak256(abi.encode(
    ["bytes32", "uint256", "address", "uint256", "uint256"],
    [ethers.id("Claim(uint256 xId,address recipient,uint256 nonce,uint256 expiry)"), m.xId, m.recipient, m.nonce, m.expiry],
  ));
  return ethers.keccak256(ethers.concat(["0x1901", domain, struct]));
}

Deno.test("claim digest equals an independent abi.encode/keccak construction", () => {
  assertEquals(claimDigest(CHAIN_ID, ESCROW, MSG), manualDigest(CHAIN_ID, ESCROW, MSG));
  assertEquals(ethers.TypedDataEncoder.from(CLAIM_TYPES).encodeType("Claim"), "Claim(uint256 xId,address recipient,uint256 nonce,uint256 expiry)");
});

Deno.test("digest binds chain id, contract, and every field", () => {
  const base = claimDigest(CHAIN_ID, ESCROW, MSG);
  assertNotEquals(claimDigest(CHAIN_ID + 1n, ESCROW, MSG), base);
  assertNotEquals(claimDigest(CHAIN_ID, ethers.getAddress("0x" + "22".repeat(20)), MSG), base);
  assertNotEquals(claimDigest(CHAIN_ID, ESCROW, { ...MSG, xId: MSG.xId + 1n }), base);
  assertNotEquals(claimDigest(CHAIN_ID, ESCROW, { ...MSG, recipient: ethers.getAddress("0x" + "33".repeat(20)) }), base);
  assertNotEquals(claimDigest(CHAIN_ID, ESCROW, { ...MSG, nonce: 1n }), base);
  assertNotEquals(claimDigest(CHAIN_ID, ESCROW, { ...MSG, expiry: 1n }), base);
});

Deno.test("signClaim: 65 bytes, low-s, recovers to the signer, over many random messages", async () => {
  for (let i = 0; i < 200; i++) {
    const m = { ...MSG, xId: BigInt(i) * 7919n + 1n, nonce: BigInt(ethers.hexlify(ethers.randomBytes(32))) };
    const { signature, digest } = await signClaim(wallet, CHAIN_ID, ESCROW, m);
    assertEquals(ethers.dataLength(signature), 65);
    assertEquals(ethers.recoverAddress(digest, signature), wallet.address);
    assertEquals(digest, manualDigest(CHAIN_ID, ESCROW, m));
  }
});

Deno.test("signClaim refuses a signer whose signature does not recover to its own address", async () => {
  const liar = { address: ethers.getAddress("0x" + "44".repeat(20)), signTypedData: wallet.signTypedData.bind(wallet) };
  await assertRejects(() => signClaim(liar, CHAIN_ID, ESCROW, MSG), Error, "does not recover");
});

// ---------------------------------------------------------------- env
Deno.test("chainConfig: ESCROW_ADDRESS is required, validated and checksummed; defaults for rpc and chain", () => {
  assertThrows(() => chainConfig(env({})), HttpError, "ESCROW_ADDRESS");
  assertThrows(() => chainConfig(env({ ESCROW_ADDRESS: "0x123" })), HttpError, "not a valid address");
  const c = chainConfig(env({ ESCROW_ADDRESS: ESCROW.toLowerCase() }));
  assertEquals(c.escrow, ESCROW);
  assertEquals(c.chainId, 6281971n);
  assertEquals(c.rpcUrl, "https://rpc.testnet.dogeos.com/");
});

Deno.test("intEnv: default, override and bounds", () => {
  assertEquals(intEnv(env({}), "N", 5, 1, 10), 5);
  assertEquals(intEnv(env({ N: "7" }), "N", 5, 1, 10), 7);
  for (const bad of ["0", "11", "1.5", "abc"]) assertThrows(() => intEnv(env({ N: bad }), "N", 5, 1, 10), HttpError);
});

// ---------------------------------------------------------------- rate limit
Deno.test("enforce: allows within the limit, 429 over it, 503 (fail closed) when the limiter breaks", async () => {
  const rl = new FakeRateLimiter();
  await enforce(rl, "b", 60, 2);
  await enforce(rl, "b", 60, 2);
  const over = await assertRejects(() => enforce(rl, "b", 60, 2), HttpError);
  assertEquals([over.status, over.code, over.headers["retry-after"]], [429, "rate_limited", "60"]);
  rl.fail = true;
  const down = await assertRejects(() => enforce(rl, "c", 60, 2), HttpError);
  assertEquals([down.status, down.code], [503, "rate_limit_unavailable"]);
});

Deno.test("ipBucket stores a hash, never the address", async () => {
  const b = await ipBucket("resolve", "203.0.113.7");
  assert(/^resolve:ip:[0-9a-f]{16}$/.test(b));
  assert(!b.includes("203"));
  assertEquals(b, await ipBucket("resolve", "203.0.113.7"));
  assertNotEquals(b, await ipBucket("resolve", "203.0.113.8"));
});

// ---------------------------------------------------------------- X API client
const xResponse = (status: number, body?: unknown) => (() => Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }))) as unknown as typeof fetch;

Deno.test("createXLookup: success, request shape and encoding", async () => {
  let seen: { url: string; auth: string | null } | undefined;
  const lookup = createXLookup({
    bearer: "tok",
    baseUrl: "https://x.test/",
    fetch: ((url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization") };
      return Promise.resolve(new Response(JSON.stringify({ data: { id: "2244994945", name: "X Dev", username: "XDevelopers" } })));
    }) as unknown as typeof fetch,
  });
  assertEquals(await lookup("XDevelopers"), { id: "2244994945", username: "XDevelopers", name: "X Dev" });
  assertEquals(seen, { url: "https://x.test/2/users/by/username/XDevelopers", auth: "Bearer tok" });
});

Deno.test("createXLookup: a numeric id in JSON is rejected only if malformed; big ids stay strings", async () => {
  const big = createXLookup({ bearer: "t", fetch: xResponse(200, { data: { id: "1850123456789012345", username: "MuchTipDemo" } }) });
  assertEquals((await big("MuchTipDemo"))?.id, "1850123456789012345");
  const bad = createXLookup({ bearer: "t", fetch: xResponse(200, { data: { id: "abc", username: "x" } }) });
  await assertRejects(() => bad("x"), UpstreamError);
});

Deno.test("createXLookup: not found (200 with errors, or 404) is null; failures are typed", async () => {
  assertEquals(await createXLookup({ bearer: "t", fetch: xResponse(200, { errors: [{ title: "Not Found Error", detail: "Could not find user" }] }) })("nobody"), null);
  assertEquals(await createXLookup({ bearer: "t", fetch: xResponse(404) })("nobody"), null);
  const kind = async (status: number) => (await assertRejects(() => createXLookup({ bearer: "t", fetch: xResponse(status, {}) })("x"), UpstreamError)).kind;
  assertEquals(await kind(429), "rate_limited");
  assertEquals(await kind(401), "auth");
  assertEquals(await kind(402), "auth");
  assertEquals(await kind(403), "auth");
  assertEquals(await kind(500), "unavailable");
  assertEquals(await kind(418), "invalid");
  const neither = createXLookup({ bearer: "t", fetch: xResponse(200, {}) });
  assertEquals((await assertRejects(() => neither("x"), UpstreamError)).kind, "invalid");
  const network = createXLookup({ bearer: "t", fetch: (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch });
  assertEquals((await assertRejects(() => network("x"), UpstreamError)).kind, "unavailable");
});

Deno.test("cleanDisplayName strips control, zero-width and bidi-override characters; keeps emoji; caps at 50", () => {
  assertEquals(cleanDisplayName("Doge Fan"), "Doge Fan");
  assertEquals(cleanDisplayName("  Doge \n\t Fan  "), "Doge Fan");
  assertEquals(cleanDisplayName("Evil‮naf egoD"), "Evilnaf egoD"); // RIGHT-TO-LEFT OVERRIDE removed: text reads as stored
  assertEquals(cleanDisplayName("a​b⁦c﻿d\u0007e"), "abcde");
  assertEquals(cleanDisplayName("\u{1F415} Doge \u{1F680}"), "\u{1F415} Doge \u{1F680}");
  assertEquals(Array.from(cleanDisplayName("\u{1F415}".repeat(80))!).length, 50); // by code point, so no half emoji
  for (const v of [null, undefined, 42, {}, "", "   ", "‮"]) assertEquals(cleanDisplayName(v), null);
});

Deno.test("mock lookup: case-insensitive fixtures, unknown is null, 19-digit id exact", async () => {
  const m = createMockLookup();
  assertEquals((await m("XDEVELOPERS"))?.id, "2244994945");
  assertEquals((await m("jack"))?.id, "12");
  assertEquals(await m("definitely_not_a_fixture"), null);
  assertEquals((await m("muchtipdemo"))?.id, "1850123456789012345");
  for (const f of Object.values(MOCK_FIXTURES)) assert(/^\d{1,20}$/.test(f.id));
});

// ---------------------------------------------------------------- chain client (fake fetch)
function rpcServer(handlers: Record<string, (params: unknown[]) => unknown>) {
  const requests: unknown[] = [];
  const f = ((_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push(body);
    const one = (r: { id: number; method: string; params: unknown[] }) => {
      const h = handlers[r.method];
      if (!h) return { jsonrpc: "2.0", id: r.id, error: { code: -32601, message: `no ${r.method}` } };
      try {
        return { jsonrpc: "2.0", id: r.id, result: h(r.params) };
      } catch (e) {
        return { jsonrpc: "2.0", id: r.id, error: { code: -1, message: String(e instanceof Error ? e.message : e) } };
      }
    };
    const out = Array.isArray(body) ? body.map(one).reverse() : one(body); // batch answers deliberately out of order
    return Promise.resolve(new Response(JSON.stringify(out)));
  }) as unknown as typeof fetch;
  return { f, requests };
}
const cfg = { rpcUrl: "http://rpc.test/", chainId: CHAIN_ID, escrow: ESCROW };
const word = (v: bigint | string) => ethers.zeroPadValue(typeof v === "bigint" ? ethers.toBeHex(v) : v, 32);

Deno.test("chain.claimContext: one batch, matched by id even when answered out of order", async () => {
  const idHash = idHashOf(2244994945n);
  const { f, requests } = rpcServer({
    eth_chainId: () => "0x5fdaf3",
    eth_getBlockByNumber: () => ({ timestamp: ethers.toQuantity(T0 + 5) }),
    eth_call: (p) => {
      const data = String((p[0] as { data: string }).data);
      if (data.startsWith(escrowIface.getFunction("balanceOf")!.selector)) {
        assertEquals(data, escrowIface.encodeFunctionData("balanceOf", [idHash]));
        return word(10n ** 16n);
      }
      if (data.startsWith(escrowIface.getFunction("verifier")!.selector)) return word(wallet.address);
      throw new Error("unexpected call");
    },
  });
  const ctx = await createChain(cfg, f).claimContext(idHash);
  assertEquals(ctx, { chainId: CHAIN_ID, chainTime: BigInt(T0 + 5), unclaimed: 10n ** 16n, verifier: wallet.address });
  assertEquals(requests.length, 1);
  assertEquals((requests[0] as unknown[]).length, 4);
});

Deno.test("chain.settings reads refundDelay, minTip, verifier and owner", async () => {
  const { f } = rpcServer({
    eth_call: (p) => {
      const data = String((p[0] as { data: string }).data);
      const sel = (n: string) => escrowIface.getFunction(n)!.selector;
      if (data.startsWith(sel("refundDelay"))) return word(600n);
      if (data.startsWith(sel("minTip"))) return word(5n * 10n ** 18n);
      if (data.startsWith(sel("verifier"))) return word(wallet.address);
      if (data.startsWith(sel("owner"))) return word(ESCROW);
      throw new Error("unexpected call");
    },
  });
  const s = await createChain(cfg, f).settings();
  assertEquals([s.refundDelay, s.minTip, s.verifier, s.owner], [600n, 5n * 10n ** 18n, wallet.address, ESCROW]);
});

Deno.test("chain: an address with no contract (eth_call -> 0x) is a ChainError, not an unexpected crash", async () => {
  const { f } = rpcServer({
    eth_call: () => "0x",
    eth_chainId: () => "0x5fdaf3",
    eth_getBlockByNumber: () => ({ timestamp: "0x1" }),
  });
  await assertRejects(() => createChain(cfg, f).settings(), ChainError, "unexpected result");
  await assertRejects(() => createChain(cfg, f).claimContext(idHashOf(1n)), ChainError, "unexpected result");
});

Deno.test("chain.getLogs asks for the three feed topics on the escrow, within the range", async () => {
  const { f, requests } = rpcServer({ eth_getLogs: () => [] });
  await createChain(cfg, f).getLogs(100, 200);
  const p = (requests[0] as { params: Array<{ address: string; fromBlock: string; toBlock: string; topics: string[][] }> }).params[0];
  assertEquals([p.address, p.fromBlock, p.toBlock], [ESCROW, "0x64", "0xc8"]);
  assertEquals(p.topics, [FEED_TOPICS]);
  assertEquals(FEED_TOPICS.length, 3);
});

Deno.test("chain: RPC errors, HTTP errors and bad JSON all surface as ChainError", async () => {
  await assertRejects(() => createChain(cfg, rpcServer({}).f).headBlock(), ChainError, "no eth_blockNumber");
  await assertRejects(() => createChain(cfg, (() => Promise.resolve(new Response("x", { status: 502 }))) as unknown as typeof fetch).headBlock(), ChainError, "HTTP 502");
  await assertRejects(() => createChain(cfg, (() => Promise.resolve(new Response("not json"))) as unknown as typeof fetch).headBlock(), ChainError, "invalid JSON");
  await assertRejects(() => createChain(cfg, (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch).headBlock(), ChainError, "offline");
});

Deno.test("chain.blockTimes batches in groups of 50 and de-duplicates", async () => {
  const { f, requests } = rpcServer({ eth_getBlockByNumber: (p) => ({ timestamp: ethers.toQuantity(Number(BigInt(String(p[0]))) * 3) }) });
  const blocks = Array.from({ length: 120 }, (_, i) => 1000 + i);
  const times = await createChain(cfg, f).blockTimes([...blocks, ...blocks]);
  assertEquals(times.size, 120);
  assertEquals(times.get(1005), 3015);
  assertEquals(requests.length, 3);
});

// ---------------------------------------------------------------- indexer
const ID_A = idHashOf(2244994945n);
const ID_B = idHashOf(1850123456789012345n);
const TIPPER = ethers.getAddress("0x" + "aa".repeat(20));
const RECIP = ethers.getAddress("0x" + "bb".repeat(20));
const C = ESCROW.toLowerCase();
let ownerSeq = 0;
const opts = (chain: ReturnType<typeof fakeChain>, store: FakeFeedStore, o: Record<string, number | string> = {}) => ({
  chain, store, startBlock: 100, nowMs: store.now(), minIntervalMs: 0, maxBlocksPerSync: 100_000, chunkBlocks: 9000, confirmations: 0,
  owner: `w${++ownerSeq}`, leaseSeconds: 30, ...o,
} as Parameters<typeof syncEvents>[0]);
/** No two ranges overlap, and together they cover [start, end] without gaps. */
function assertContiguous(ranges: Array<{ from: number; to: number }>, start: number, end: number) {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  let next = start;
  for (const r of sorted) {
    assertEquals(r.from, next, `range ${r.from}-${r.to} should start at ${next} (overlap or gap)`);
    next = r.to + 1;
  }
  assertEquals(next - 1, end);
}

Deno.test("decodeLogs: Tipped, Claimed, Refunded become rows; VerifierUpdated and removed logs are skipped", () => {
  const logs = [
    tipped(1, ID_A, TIPPER, 5n * 10n ** 18n, 120, 0),
    claimed(ID_A, RECIP, 5n * 10n ** 18n, 99n, 2244994945n, 121, 3),
    refunded(2, ID_B, TIPPER, 7n, 122, 1),
    { ...tipped(3, ID_B, TIPPER, 1n, 123), removed: true },
  ];
  const times = new Map([[120, T0], [121, T0 + 3], [122, T0 + 6], [123, T0 + 9]]);
  const rows = decodeLogs(C, logs, times);
  assertEquals(rows.length, 3);
  assertEquals(rows[0], {
    contract: C, block_number: 120, log_index: 0, tx_hash: logs[0].transactionHash, event: "Tipped", id_hash: ID_A,
    tip_id: "1", account: TIPPER.toLowerCase(), amount_wei: "5000000000000000000", x_id: null, block_time: new Date(T0 * 1000).toISOString(),
  });
  assertEquals([rows[1].event, rows[1].x_id, rows[1].account, rows[1].tip_id], ["Claimed", "2244994945", RECIP.toLowerCase(), null]);
  assertEquals([rows[2].event, rows[2].tip_id, rows[2].amount_wei], ["Refunded", "2", "7"]);
});

Deno.test("syncEvents: scans in chunks within the RPC's 10k cap, stores each chunk with its progress, and resumes", async () => {
  const chain = fakeChain({ head: 30_100, logs: [tipped(1, ID_A, TIPPER, 10n, 150), tipped(2, ID_A, TIPPER, 20n, 25_000)] });
  const store = new FakeFeedStore();
  const r = await syncEvents(opts(chain, store));
  assertEquals([r.indexedTo, r.head, r.lagBlocks, r.fetched, r.throttled, r.busy, r.lost], [30_100, 30_100, 0, 2, false, false, false]);
  assertEquals(chain.st.calls.getLogs[0], [100, 9099]);
  for (const [a, b] of chain.st.calls.getLogs) assert(b - a + 1 <= 9000);
  assertContiguous(store.applied, 100, 30_100);
  assertEquals(store.events.size, 2);
  assertEquals(store.state.get(C)?.leaseOwner, null); // released
  chain.st.head = 30_200;
  chain.st.logs.push(tipped(3, ID_B, TIPPER, 30n, 30_150));
  chain.st.calls.getLogs.length = 0;
  store.clock += 10_000;
  const r2 = await syncEvents(opts(chain, store));
  assertEquals(chain.st.calls.getLogs, [[30_101, 30_200]]);
  assertEquals([r2.indexedTo, r2.fetched], [30_200, 1]);
  assertEquals(store.events.size, 3);
});

Deno.test("syncEvents: nothing new means no lease and no fetch; head below the start block does nothing", async () => {
  const chain = fakeChain({ head: 500, logs: [tipped(1, ID_A, TIPPER, 10n, 150)] });
  const store = new FakeFeedStore();
  await syncEvents(opts(chain, store));
  const calls = chain.st.calls.getLogs.length;
  store.clock += 10_000;
  const again = await syncEvents(opts(chain, store));
  assertEquals([again.indexedTo, again.busy, chain.st.calls.getLogs.length], [500, false, calls]);
  const early = await syncEvents(opts(fakeChain({ head: 50 }), new FakeFeedStore()));
  assertEquals([early.indexedTo, early.fetched], [99, 0]);
});

Deno.test("syncEvents: throttled within minInterval; a clock-skewed (future) updatedAt does not starve syncing", async () => {
  const chain = fakeChain({ head: 5000, logs: [tipped(1, ID_A, TIPPER, 10n, 4500)] });
  const store = new FakeFeedStore();
  await syncEvents(opts(chain, store, { maxBlocksPerSync: 1000, chunkBlocks: 1000 }));
  const calls = chain.st.calls.getLogs.length;
  const t = await syncEvents(opts(chain, store, { minIntervalMs: 5000, nowMs: store.now() + 1000 }));
  assertEquals([t.throttled, chain.st.calls.getLogs.length], [true, calls]);
  const skewed = await syncEvents(opts(chain, store, { minIntervalMs: 5000, nowMs: store.now() - 60_000 })); // our clock is behind the DB's
  assertEquals(skewed.throttled, false);
  const later = await syncEvents(opts(chain, store, { minIntervalMs: 5000, nowMs: store.now() + 6000 }));
  assertEquals([later.indexedTo, later.throttled], [5000, false]);
  assertEquals(store.events.size, 1);
});

Deno.test("syncEvents: maxBlocksPerSync bounds one call; the next call continues where it stopped", async () => {
  const chain = fakeChain({ head: 5000 });
  const store = new FakeFeedStore();
  const first = await syncEvents(opts(chain, store, { maxBlocksPerSync: 1000, chunkBlocks: 1000 }));
  assertEquals([first.indexedTo, first.lagBlocks], [1099, 3901]);
  const second = await syncEvents(opts(chain, store, { maxBlocksPerSync: 1000, chunkBlocks: 1000 }));
  assertEquals(second.indexedTo, 2099);
  assertContiguous(store.applied, 100, 2099);
  assertEquals((await syncEvents(opts(chain, store, { confirmations: 5 }))).indexedTo, 4995);
});

Deno.test("concurrency: 8 simultaneous syncs -> one worker fetches, the others are busy; no range fetched or stored twice", async () => {
  const logs = [tipped(1, ID_A, TIPPER, 10n, 150), claimed(ID_A, RECIP, 10n, 1n, 2244994945n, 9_500), tipped(2, ID_B, TIPPER, 7n, 20_000)];
  const chain = fakeChain({ head: 25_000, logs, logsDelayMs: 5 });
  const store = new FakeFeedStore();
  const results = await Promise.all(Array.from({ length: 8 }, () => syncEvents(opts(chain, store))));
  assertEquals(results.filter((r) => !r.busy).length, 1);
  assertEquals(results.filter((r) => r.busy).length, 7);
  // every block range was requested from the chain exactly once, and stored exactly once
  assertContiguous(chain.st.calls.getLogs.map(([from, to]) => ({ from, to })), 100, 25_000);
  assertContiguous(store.applied, 100, 25_000);
  assertEquals(new Set(store.applied.map((a) => a.owner)).size, 1);
  assertEquals(store.events.size, 3);
  assertEquals(store.state.get(C)?.lastBlock, 25_000);
});

Deno.test("concurrency: repeated waves of simultaneous syncs as the chain grows stay contiguous and duplicate-free", async () => {
  const chain = fakeChain({ head: 1000, logsDelayMs: 2 });
  const store = new FakeFeedStore();
  for (let wave = 0; wave < 6; wave++) {
    chain.st.head += 3000;
    chain.st.logs.push(tipped(wave + 1, ID_A, TIPPER, BigInt(wave + 1), chain.st.head - 7));
    store.clock += 10_000;
    await Promise.all(Array.from({ length: 5 }, () => syncEvents(opts(chain, store, { chunkBlocks: 1000 }))));
  }
  assertContiguous(store.applied, 100, chain.st.head);
  assertContiguous(chain.st.calls.getLogs.map(([from, to]) => ({ from, to })), 100, chain.st.head);
  assertEquals(store.events.size, 6);
});

Deno.test("concurrency: a stalled worker whose lease expired can neither store its range nor move the index backwards", async () => {
  const chain = fakeChain({ head: 3000, logs: [tipped(1, ID_A, TIPPER, 10n, 500), tipped(2, ID_A, TIPPER, 20n, 2500)] });
  const store = new FakeFeedStore();
  let openGate!: () => void;
  chain.st.logsGate = new Promise<void>((r) => (openGate = r));
  const stalled = syncEvents(opts(chain, store, { owner: "A", chunkBlocks: 1000, leaseSeconds: 30 })); // takes the lease, then hangs fetching
  while (chain.st.calls.getLogs.length === 0) await new Promise((r) => setTimeout(r, 0));
  chain.st.logsGate = undefined;
  store.clock += 31_000; // A's lease expires while it is stuck
  const b = await syncEvents(opts(chain, store, { owner: "B", chunkBlocks: 1000 }));
  assertEquals([b.busy, b.indexedTo], [false, 3000]);
  openGate(); // A wakes up and tries to store blocks 100..1099
  const a = await stalled;
  assertEquals(a.lost, true);
  assertEquals(store.state.get(C)?.lastBlock, 3000); // not moved back
  assertEquals(store.applied.every((x) => x.owner === "B"), true);
  assertContiguous(store.applied, 100, 3000);
  assertEquals(store.events.size, 2);
});

Deno.test("concurrency: while another worker holds a live lease, a caller is busy and changes nothing", async () => {
  const chain = fakeChain({ head: 2000 });
  const store = new FakeFeedStore();
  assert(await store.acquire(C, "other", 100, 30));
  const r = await syncEvents(opts(chain, store));
  assertEquals([r.busy, r.indexedTo, chain.st.calls.getLogs.length, store.applied.length], [true, 99, 0, 0]);
  store.clock += 31_000; // the other worker vanished: its lease expires and the next caller takes over
  const r2 = await syncEvents(opts(chain, store));
  assertEquals([r2.busy, r2.indexedTo], [false, 2000]);
});

Deno.test("syncEvents: an RPC failure mid-sync keeps the chunks already stored and releases the lease", async () => {
  const chain = fakeChain({ head: 3000, logs: [tipped(1, ID_A, TIPPER, 10n, 500)] });
  const store = new FakeFeedStore();
  let n = 0;
  const realGetLogs = chain.getLogs.bind(chain);
  chain.getLogs = (from, to) => (++n === 2 ? Promise.reject(new ChainError("rpc down")) : realGetLogs(from, to));
  await assertRejects(() => syncEvents(opts(chain, store, { chunkBlocks: 1000 })), ChainError);
  assertEquals(store.state.get(C)?.lastBlock, 1099);
  assertEquals(store.state.get(C)?.leaseOwner, null);
  assertEquals(store.events.size, 1);
});

Deno.test("allowedOrigin: one value and * are unchanged; a list echoes only listed origins", () => {
  const req = (origin?: string) => new Request("http://f/x", { headers: origin ? { origin } : {} });
  assertEquals(allowedOrigin(req("https://a.example"), "*"), "*");
  assertEquals(allowedOrigin(req("https://a.example"), "https://site.example"), "https://site.example");
  assertEquals(allowedOrigin(req(), ""), "*");
  const list = "https://site.example,http://localhost:5173";
  assertEquals(allowedOrigin(req("http://localhost:5173"), list), "http://localhost:5173");
  assertEquals(allowedOrigin(req("https://site.example"), list), "https://site.example");
  assertEquals(allowedOrigin(req("https://other.example"), list), "https://site.example");
  assertEquals(allowedOrigin(req("http://localhost:5174"), list), "https://site.example");
  assertEquals(allowedOrigin(req(), list), "https://site.example");
});
