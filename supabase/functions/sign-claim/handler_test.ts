import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@^1";
import type { AuthUserLike } from "../_shared/claim-gate.ts";
import { claimDigest } from "../_shared/eip712.ts";
import { ethers } from "../_shared/eth.ts";
import { idHashOf } from "../_shared/ids.ts";
import type { AuthPort } from "../_shared/supabase.ts";
import { CHAIN_ID, ESCROW, FakeRateLimiter, fakeChain, T0 } from "../_shared/testing.ts";
import { createSignClaimHandler, parseRecipient, randomNonce, type SignClaimDeps } from "./handler.ts";

const wallet = new ethers.Wallet("0x" + "5a".repeat(32));
const RECIPIENT = ethers.getAddress("0x" + "ab".repeat(20));
const ident = (provider: string, id: string, extra: Record<string, unknown> = {}) => ({ provider, id, identity_data: { sub: id, ...extra } });
const X_USER: AuthUserLike = { identities: [ident("x", "2244994945", { user_name: "XDevelopers" })] };

/** `users` maps a token string to what Supabase Auth would return for it; anything else is "invalid". */
function setup(users: Record<string, AuthUserLike>, over: Partial<SignClaimDeps> = {}) {
  const chain = fakeChain({
    ctx: { chainId: CHAIN_ID, chainTime: BigInt(T0 + 5000), unclaimed: 3n * 10n ** 16n, verifier: wallet.address },
  });
  const rateLimit = new FakeRateLimiter();
  const logs: Record<string, unknown>[] = [];
  const authCalls: string[] = [];
  const auth: AuthPort = {
    getUser(jwt) {
      authCalls.push(jwt);
      return Promise.resolve(users[jwt] ? { user: users[jwt], error: null } : { user: null, error: "invalid JWT: token is expired" });
    },
  };
  const deps: SignClaimDeps = {
    auth, rateLimit, chain, signer: wallet, ttlSeconds: 300,
    ipLimit: { windowSeconds: 600, limit: 60 }, userLimit: { windowSeconds: 600, limit: 10 },
    randomNonce, corsOrigin: "*", log: (e) => logs.push(e), ...over,
  };
  const handler = createSignClaimHandler(deps);
  const call = (body: unknown, token: string | null = "good", method = "POST") =>
    handler(new Request("http://f/sign-claim", {
      method,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }));
  return { chain, rateLimit, logs, authCalls, call, handler };
}
const ok = (recipient = RECIPIENT) => ({ recipient });
const code = async (r: Response) => (await r.json()).error.code;

Deno.test("sign-claim: a pure X user gets a valid claim signature and the unclaimed amount", async () => {
  const { call, chain } = setup({ good: X_USER });
  const r = await call(ok());
  assertEquals(r.status, 200);
  const b = await r.json();
  assertEquals(b.xId, "2244994945");
  assertEquals(b.handle, "XDevelopers");
  assertEquals(b.recipient, RECIPIENT);
  assertEquals(b.contract, ESCROW);
  assertEquals(b.chainId, 6281971);
  assertEquals(b.unclaimedWei, "30000000000000000");
  assertEquals(b.claimable, true);
  assertEquals(b.expiry, String(T0 + 5000 + 300)); // latest block time + ttl
  assert(/^\d+$/.test(b.nonce));
  // the signature is over exactly Claim(xId, recipient, nonce, expiry) for this chain and contract, by the verifier
  const msg = { xId: 2244994945n, recipient: RECIPIENT, nonce: BigInt(b.nonce), expiry: BigInt(b.expiry) };
  const digest = claimDigest(CHAIN_ID, ESCROW, msg);
  assertEquals(b.digest, digest);
  assertEquals(ethers.recoverAddress(digest, b.signature), wallet.address);
  assertEquals(ethers.dataLength(b.signature), 65);
  assertEquals(chain.st.calls.claimContext, 1);
});

Deno.test("sign-claim: nothing unclaimed still signs but reports claimable=false", async () => {
  const s = setup({ good: X_USER });
  s.chain.st.ctx.unclaimed = 0n;
  const b = await (await s.call(ok())).json();
  assertEquals([b.unclaimedWei, b.claimable], ["0", false]);
  assert(b.signature.startsWith("0x"));
});

Deno.test("sign-claim: every signature has a fresh random 256-bit nonce", async () => {
  const { call } = setup({ good: X_USER });
  const nonces = new Set<string>();
  for (let i = 0; i < 8; i++) nonces.add((await (await call(ok())).json()).nonce);
  assertEquals(nonces.size, 8);
  for (let i = 0; i < 50; i++) assert(randomNonce() < 1n << 256n);
  assertNotEquals(randomNonce(), randomNonce());
});

Deno.test("sign-claim: the id signed for comes from the identity, never from spoofed user_metadata", async () => {
  const spoofed = { ...X_USER, user_metadata: { sub: "999", provider_id: "999", user_name: "victim", id: "999" } } as AuthUserLike;
  const { call } = setup({ good: spoofed });
  const b = await (await call(ok())).json();
  assertEquals([b.xId, b.handle], ["2244994945", "XDevelopers"]);
});

Deno.test("sign-claim: no token -> 401 before anything else happens", async () => {
  const s = setup({ good: X_USER });
  const noAuth: Array<Record<string, string>> = [{}, { authorization: "" }, { authorization: "Basic abc" }, { authorization: "Bearer" }, { authorization: "Bearer " }];
  for (const headers of noAuth) {
    const r = await s.handler(new Request("http://f/sign-claim", { method: "POST", headers, body: JSON.stringify(ok()) }));
    assertEquals([r.status, await code(r)], [401, "missing_token"]);
  }
  assertEquals(s.authCalls.length, 0);
  assertEquals(s.rateLimit.counts.size, 0);
  assertEquals(s.chain.st.calls.claimContext, 0);
});

Deno.test("sign-claim: forged / expired / garbage token -> 401 and no signature, chain read or user rate-limit hit", async () => {
  const s = setup({ good: X_USER });
  for (const token of ["forged.jwt.value", "tok-abc123-stale", "x".repeat(40)]) {
    const r = await s.call(ok(), token);
    const text = JSON.stringify(await r.json());
    assertEquals(r.status, 401, token);
    assert(text.includes("invalid_token"));
    assert(!text.includes(token), "the response must not echo the token");
  }
  assertEquals((await s.call(ok(), "y".repeat(5000))).status, 401);
  assertEquals(s.chain.st.calls.claimContext, 0);
  assertEquals([...s.rateLimit.counts.keys()].filter((k) => k.startsWith("sign-claim:x:")), []);
});

Deno.test("sign-claim: identities that are not exactly one 'x' identity -> 403", async () => {
  const users: Record<string, AuthUserLike> = {
    email: { identities: [ident("email", "u1")] },
    phone: { identities: [ident("phone", "u2")] },
    xEmail: { identities: [ident("x", "2244994945"), ident("email", "u3")] },
    emailX: { identities: [ident("email", "u3"), ident("x", "2244994945")] },
    xGithub: { identities: [ident("x", "2244994945"), ident("github", "5")] },
    xx: { identities: [ident("x", "2244994945"), ident("x", "1850123456789012345")] },
    anon: { is_anonymous: true, identities: [] },
    none: { identities: [] },
    spoofOnEmail: { identities: [ident("email", "u1")], user_metadata: { sub: "2244994945", provider_id: "2244994945", user_name: "XDevelopers" } } as AuthUserLike,
  };
  const s = setup(users);
  for (const name of Object.keys(users)) {
    const r = await s.call(ok(), name);
    assertEquals([name, r.status, await code(r)], [name, 403, "identity_not_allowed"]);
  }
  assertEquals(s.chain.st.calls.claimContext, 0);
  assert(s.logs.some((l) => l.event === "identity_rejected" && String(l.reason).includes("exactly 1 identity")));
});

Deno.test("sign-claim: recipient validation", async () => {
  const s = setup({ good: X_USER });
  const lower = RECIPIENT.toLowerCase();
  const badChecksum = RECIPIENT.slice(0, 5) + (RECIPIENT[5] === RECIPIENT[5].toUpperCase() ? RECIPIENT[5].toLowerCase() : RECIPIENT[5].toUpperCase()) + RECIPIENT.slice(6);
  const bad: unknown[] = [undefined, null, 42, "", "0x", "0x1234", lower + "00", "ab".repeat(20), ethers.ZeroAddress, ESCROW, ESCROW.toLowerCase(), badChecksum];
  for (const recipient of bad) {
    const r = await s.call({ recipient });
    assertEquals([String(recipient).slice(0, 12), r.status, await code(r)], [String(recipient).slice(0, 12), 400, "invalid_recipient"]);
  }
  assertEquals(s.authCalls.length, 0); // validated before spending a network call on auth
  // all-lowercase and correctly checksummed forms are both fine and come back checksummed
  assertEquals((await (await s.call({ recipient: lower })).json()).recipient, RECIPIENT);
  assertEquals((await (await s.call({ recipient: RECIPIENT })).json()).recipient, RECIPIENT);
  assertEquals(parseRecipient(lower, ESCROW), RECIPIENT);
});

Deno.test("sign-claim: malformed bodies and methods", async () => {
  const s = setup({ good: X_USER });
  assertEquals(await code(await s.call("{nope")), "invalid_json");
  assertEquals(await code(await s.call("[]")), "invalid_json");
  assertEquals(await code(await s.call({})), "invalid_recipient");
  const get = await s.call(null, "good", "GET");
  assertEquals([get.status, get.headers.get("allow")], [405, "POST, OPTIONS"]);
  const pre = await s.handler(new Request("http://f/sign-claim", { method: "OPTIONS" }));
  assertEquals([pre.status, pre.headers.get("access-control-allow-origin")], [204, "*"]);
});

Deno.test("sign-claim: refuses when the contract's verifier is not our key (misconfiguration), without leaking addresses", async () => {
  const s = setup({ good: X_USER });
  s.chain.st.ctx.verifier = ethers.getAddress("0x" + "99".repeat(20));
  const r = await s.call(ok());
  const text = JSON.stringify(await r.json());
  assertEquals([r.status, text.includes("verifier_mismatch")], [503, true]);
  assert(!text.includes(wallet.address) && !text.includes("9999"));
  assert(s.logs.some((l) => l.event === "verifier_mismatch" && l.signer === wallet.address));
});

Deno.test("sign-claim: wrong chain and chain outages are 503 and issue no signature", async () => {
  const wrong = setup({ good: X_USER });
  wrong.chain.st.ctx.chainId = 1n;
  const r1 = await wrong.call(ok());
  assertEquals([r1.status, await code(r1)], [503, "wrong_chain"]);
  const down = setup({ good: X_USER });
  down.chain.st.failClaim = true;
  const r2 = await down.call(ok());
  assertEquals([r2.status, await code(r2), r2.headers.get("retry-after")], [503, "chain_unavailable", "10"]);
});

Deno.test("sign-claim: per-user and per-IP rate limits", async () => {
  const perUser = setup({ good: X_USER }, { userLimit: { windowSeconds: 600, limit: 2 } });
  assertEquals((await perUser.call(ok())).status, 200);
  assertEquals((await perUser.call(ok())).status, 200);
  const r = await perUser.call(ok());
  assertEquals([r.status, await code(r), r.headers.get("retry-after")], [429, "rate_limited", "600"]);
  assert(perUser.rateLimit.counts.has("sign-claim:x:2244994945"));

  const perIp = setup({ good: X_USER }, { ipLimit: { windowSeconds: 600, limit: 1 } });
  assertEquals((await perIp.call(ok())).status, 200);
  assertEquals((await perIp.call(ok())).status, 429);

  const broken = setup({ good: X_USER });
  broken.rateLimit.fail = true;
  const rb = await broken.call(ok());
  assertEquals([rb.status, await code(rb)], [503, "rate_limit_unavailable"]);
  assertEquals(broken.chain.st.calls.claimContext, 0);
});

Deno.test("sign-claim: ttl is configurable and counted from chain time, not the server clock", async () => {
  const s = setup({ good: X_USER }, { ttlSeconds: 60 });
  s.chain.st.ctx.chainTime = 1_000n;
  assertEquals((await (await s.call(ok())).json()).expiry, "1060");
});

Deno.test("sign-claim: unexpected failures are an opaque 500", async () => {
  const s = setup({ good: X_USER }, { randomNonce: () => { throw new Error("rng exploded with secret info"); } });
  const r = await s.call(ok());
  const text = JSON.stringify(await r.json());
  assertEquals([r.status, text.includes("rng exploded")], [500, false]);
  assert(s.logs.some((l) => l.event === "unhandled_error"));
  assertEquals(idHashOf(2244994945n).length, 66);
});
