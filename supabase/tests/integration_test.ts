// Integration tests: the deployed-shape Edge Functions (real index.ts, real HTTP) against real GoTrue + PostgREST + Postgres,
// X mocked, and READ-ONLY against the live DogeOS Chikyū RPC. Started by run-integration.sh, which brings up the stack.
// Nothing here sends a transaction: contract checks are eth_call (with state overrides where a balance is needed).
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@^1";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { ethers } from "../functions/_shared/eth.ts";
import { idHashOf } from "../functions/_shared/ids.ts";

const ROOT = Deno.env.get("IT_ROOT")!;
const keys = JSON.parse(Deno.readTextFileSync(Deno.env.get("IT_KEYS")!)) as { secret: string; anon: string; service: string };
const URL_ = "http://127.0.0.1:54321";
const RPC = "https://rpc.testnet.dogeos.com/";
const CB = "http://localhost:3999/cb";
const MOCK_X = "http://127.0.0.1:4010";
const FAKE_X_API = "http://127.0.0.1:4020";
const X_TOKEN = "test-token-not-a-secret";

const dep = JSON.parse(Deno.readTextFileSync(`${ROOT}/deployment.json`));
const e2e = JSON.parse(Deno.readTextFileSync(`${ROOT}/e2e-result.json`));
const LIVE: string = ethers.getAddress(dep.contract);
const THROWAWAY: string = ethers.getAddress(e2e.contract);
const envFile = (() => {
  try {
    return Object.fromEntries(Deno.readTextFileSync(`${ROOT}/.env`).split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2)));
  } catch {
    return {} as Record<string, string>;
  }
})();
const VERIFIER_KEY: string | undefined = envFile.VERIFIER_PRIVATE_KEY?.trim() || undefined;
const verifierMatchesLive = VERIFIER_KEY ? new ethers.Wallet(VERIFIER_KEY).address === ethers.getAddress(dep.verifier) : false;

// ------------------------------------------------------------------------------------------------ plumbing
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rpc = async (method: string, params: unknown[]) => {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return await res.json() as { result?: string; error?: { message: string; data?: string } };
};

function startGateway(): Deno.HttpServer {
  return Deno.serve({ port: 54321, hostname: "127.0.0.1", onListen() {} }, async (req) => {
    const u = new URL(req.url);
    let target: string;
    if (u.pathname.startsWith("/auth/v1/")) target = `http://127.0.0.1:9999${u.pathname.slice("/auth/v1".length)}${u.search}`;
    else if (u.pathname.startsWith("/rest/v1/")) target = `http://127.0.0.1:3000${u.pathname.slice("/rest/v1".length)}${u.search}`;
    else return new Response("not found", { status: 404 });
    const headers = new Headers(req.headers);
    headers.delete("host");
    const res = await fetch(target, { method: req.method, headers, body: req.body, redirect: "manual", // @ts-ignore: needed for streaming request bodies
      duplex: "half" });
    return new Response(res.body, { status: res.status, headers: res.headers });
  });
}

/** A stand-in for api.x.com's username lookup, with a call counter per handle. */
function startFakeXApi() {
  const hits = new Map<string, number>();
  const users: Record<string, { id: string; username: string; name: string }> = {
    xdevelopers: { id: "2244994945", username: "XDevelopers", name: "X Developers" },
    muchtipdemo: { id: "1850123456789012345", username: "MuchTipDemo", name: "MuchTip Demo" },
    doge_fan_42: { id: "710000042", username: "Doge_Fan_42", name: "Doge Fan" },
    dogexfany42: { id: "999000001", username: "DogeXFanY42", name: "Decoy" }, // would match the pattern Doge_Fan_42 if "_" were a wildcard
  };
  const server = Deno.serve({ port: 4020, hostname: "127.0.0.1", onListen() {} }, (req) => {
    const m = /^\/2\/users\/by\/username\/([^/]+)$/.exec(new URL(req.url).pathname);
    if (!m) return new Response("not found", { status: 404 });
    const handle = decodeURIComponent(m[1]).toLowerCase();
    hits.set(handle, (hits.get(handle) ?? 0) + 1);
    if (req.headers.get("authorization") !== `Bearer ${X_TOKEN}`) return Response.json({ title: "Unauthorized" }, { status: 401 });
    if (handle === "authfail") return Response.json({ title: "Forbidden" }, { status: 403 });
    if (handle === "ratelimited") return Response.json({ title: "Too Many Requests" }, { status: 429 });
    if (handle === "boom") return new Response("oops", { status: 500 });
    if (handle === "mismatch") return Response.json({ data: { id: "5", username: "SomeoneElse" } });
    const u = users[handle];
    return u ? Response.json({ data: { id: u.id, name: u.name, username: u.username } }) : Response.json({ errors: [{ title: "Not Found Error", detail: `Could not find user with username: [${handle}].`, type: "https://api.twitter.com/2/problems/resource-not-found" }] });
  });
  return { hits, server, users };
}

/** Forwards JSON-RPC to the real node but adds a state override to eth_calls aimed at `target`. */
function startOverrideRpc(port: number, target: string, override: Record<string, unknown>) {
  return Deno.serve({ port, hostname: "127.0.0.1", onListen() {} }, async (req) => {
    const body = await req.json();
    const patch = (r: { method: string; params: unknown[] }) => {
      if (r.method === "eth_call" && String((r.params[0] as { to?: string }).to).toLowerCase() === target.toLowerCase() && r.params.length === 2) {
        return { ...r, params: [...r.params, { [target]: override }] };
      }
      return r;
    };
    const out = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Array.isArray(body) ? body.map(patch) : patch(body)) });
    return new Response(await out.text(), { status: out.status, headers: { "content-type": "application/json" } });
  });
}

/** Forwards JSON-RPC to the real node and records every eth_getLogs range, to prove no range is fetched twice. */
function startRecordingRpc(port: number) {
  const ranges: Array<{ from: number; to: number }> = [];
  const server = Deno.serve({ port, hostname: "127.0.0.1", onListen() {} }, async (req) => {
    const text = await req.text();
    const body = JSON.parse(text);
    for (const r of Array.isArray(body) ? body : [body]) {
      if (r.method === "eth_getLogs") ranges.push({ from: parseInt(r.params[0].fromBlock, 16), to: parseInt(r.params[0].toBlock, 16) });
    }
    const out = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: text });
    return new Response(await out.text(), { status: out.status, headers: { "content-type": "application/json" } });
  });
  return { ranges, server };
}

/** Runs SQL inside the database container (for the cron schema, which PostgREST does not expose). */
async function psql(sql: string): Promise<string> {
  const out = await new Deno.Command("docker", { args: ["exec", "-e", "PGPASSWORD=postgres", "mt-db", "psql", "-h", "localhost", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql] }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout).trim();
}

interface Fn {
  url: string;
  logs: () => string;
  stop: () => Promise<void>;
}
const functionLogs: Fn[] = [];
async function startFn(name: string, port: number, env: Record<string, string>): Promise<Fn> {
  const entry = new URL(`../functions/${name}/index.ts`, import.meta.url).href; // a file: URL; a pathname would be percent-encoded
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-env", "--allow-net", "--allow-read", entry],
    env: { DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}`, SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: keys.service, ...env },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  let buf = "";
  const drain = async (s: ReadableStream<Uint8Array>) => {
    const dec = new TextDecoder();
    for await (const chunk of s) buf += dec.decode(chunk);
  };
  drain(child.stdout);
  drain(child.stderr);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      await (await fetch(url, { method: "OPTIONS" })).body?.cancel();
      break;
    } catch {
      await sleep(500);
    }
    if (i === 119) throw new Error(`${name} did not start:\n${buf}`);
  }
  const fn: Fn = {
    url,
    logs: () => buf,
    async stop() {
      try {
        child.kill();
      } catch { /* already gone */ }
      await child.status.catch(() => {});
    },
  };
  functionLogs.push(fn);
  return fn;
}

const authOpts = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "implicit" as const } };
const newClient = (key: string): SupabaseClient => createClient(URL_, key, authOpts);

async function setMock(o: Record<string, string>) {
  await (await fetch(`${MOCK_X}/__set`, { method: "POST", body: JSON.stringify(o) })).text();
}
async function follow(start: string): Promise<{ access?: string; refresh?: string; error?: string }> {
  let url = start;
  for (let i = 0; i < 8; i++) {
    const r = await fetch(url.replace("host.docker.internal", "127.0.0.1"), { redirect: "manual" });
    const loc = r.headers.get("location");
    await r.body?.cancel();
    if (!loc) return { error: `no redirect (${r.status})` };
    if (loc.startsWith(CB)) {
      const p = new URLSearchParams(loc.split("#")[1] || loc.split("?")[1] || "");
      return p.get("error") ? { error: `${p.get("error")}: ${p.get("error_description")}` } : { access: p.get("access_token")!, refresh: p.get("refresh_token")! };
    }
    url = new URL(loc, url).toString();
  }
  return { error: "too many redirects" };
}
/** A real X login through GoTrue's X provider, with X (the OAuth endpoints) answered by mock-x.cjs. */
async function loginWithX(user: { id: string; username: string; email?: string }) {
  await setMock({ id: user.id, username: user.username, confirmed_email: user.email ?? "" });
  const client = newClient(keys.anon);
  const { data, error } = await client.auth.signInWithOAuth({ provider: "x", options: { skipBrowserRedirect: true, redirectTo: CB } });
  if (error) throw new Error(`oauth start: ${error.message}`);
  const res = await follow(data.url);
  if (res.error) throw new Error(`X login failed: ${res.error}`);
  await client.auth.setSession({ access_token: res.access!, refresh_token: res.refresh! });
  return { client, jwt: res.access! };
}

const b64u = (b: Uint8Array | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
async function craftJwt(secret: string, payload: Record<string, unknown>): Promise<string> {
  const data = `${b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64u(JSON.stringify(payload))}`;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${data}.${b64u(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data))))}`;
}
const jwtPayload = (jwt: string) => JSON.parse(atob(jwt.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")));

const post = (fn: Fn, body: unknown, token?: string, ip = "198.51.100.1") =>
  fetch(fn.url, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const resolve = (fn: Fn, handle: string, ip: string) => post(fn, { handle }, undefined, ip);

const errorInterface = new ethers.Interface(["error BadSignature()", "error NothingToClaim()", "error NonceUsed()", "error Expired()", "error ZeroAddress()"]);
const escrowRead = new ethers.Interface(["function claimDigest(uint256,address,uint256,uint256) view returns (bytes32)", "function claim(uint256,address,uint256,uint256,bytes)"]);
const revertName = (e?: { data?: string }) => (e?.data ? errorInterface.parseError(e.data)?.name : undefined);
const balanceSlot = (idHash: string) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256"], [idHash, 0])); // balanceOf is storage slot 0

// ------------------------------------------------------------------------------------------------ the tests
Deno.test({ name: "integration", sanitizeOps: false, sanitizeResources: false }, async (t) => {
  const gateway = startGateway();
  const xApi = startFakeXApi();
  const anon = newClient(keys.anon);
  const service = newClient(keys.service);
  const started: Fn[] = [];
  const overrideRpcs: Deno.HttpServer[] = [];
  const tokens: string[] = []; // every user JWT we obtain: none may ever show up in function logs

  try {
    // ---- bring the functions up (the same entry points that get deployed) -----------------------------------------
    const base = { RPC_URL: RPC, CHAIN_ID: "6281971" };
    const resolveFn = await startFn("resolve", 8791, { X_BEARER_TOKEN: X_TOKEN, X_API_BASE_URL: FAKE_X_API });
    const resolveLimited = await startFn("resolve", 8792, { X_BEARER_TOKEN: X_TOKEN, X_API_BASE_URL: FAKE_X_API, RESOLVE_RATE_PER_MINUTE: "3" });
    const resolveMock = await startFn("resolve", 8793, {});
    started.push(resolveFn, resolveLimited, resolveMock);
    let signLive: Fn | undefined, signLimited: Fn | undefined, signOverride: Fn | undefined, signBadKey: Fn | undefined;
    if (VERIFIER_KEY) {
      signLive = await startFn("sign-claim", 8794, { ...base, ESCROW_ADDRESS: LIVE, VERIFIER_PRIVATE_KEY: VERIFIER_KEY });
      signLimited = await startFn("sign-claim", 8795, { ...base, ESCROW_ADDRESS: LIVE, VERIFIER_PRIVATE_KEY: VERIFIER_KEY, SIGN_CLAIM_USER_PER_10MIN: "2" });
      // the live RPC, but balanceOf(idHash of X id 2244994945) reads as 0.01 DOGE, so the "unclaimed amount" path has something to show
      const idHashA = idHashOf(2244994945n);
      overrideRpcs.push(startOverrideRpc(4030, LIVE, { stateDiff: { [balanceSlot(idHashA)]: ethers.zeroPadValue(ethers.toBeHex(10n ** 16n), 32) } }));
      signOverride = await startFn("sign-claim", 8796, { RPC_URL: "http://127.0.0.1:4030", CHAIN_ID: "6281971", ESCROW_ADDRESS: LIVE, VERIFIER_PRIVATE_KEY: VERIFIER_KEY });
      signBadKey = await startFn("sign-claim", 8797, { ...base, ESCROW_ADDRESS: LIVE, VERIFIER_PRIVATE_KEY: "0x" + "11".repeat(32) });
    }
    // A feed instance that NO test calls: only the pg_cron job (through pg_net) can make it index. It watches an address
    // with no contract, starting a little behind the head, so whatever appears in indexer_state for it came from cron.
    const CRON_CONTRACT = ethers.getAddress("0x00000000000000000000000000000000000c0de1");
    const headNow = parseInt((await rpc("eth_blockNumber", [])).result!, 16);
    const cronFeed = await startFn("feed", 8789, { ...base, ESCROW_ADDRESS: CRON_CONTRACT, ESCROW_DEPLOY_BLOCK: String(headNow - 50), FEED_MIN_SYNC_SECONDS: "0" });
    started.push(cronFeed);
    assertEquals((await service.from("app_config").upsert({ key: "functions_url", value: "http://host.docker.internal:8789" })).error, null);
    const cronSetAt = Date.now();
    const deployReceipt = await rpc("eth_getTransactionReceipt", [e2e.deploy]) as unknown as { result: { blockNumber: string } };
    const throwawayDeployBlock = parseInt(deployReceipt.result.blockNumber, 16);

    // ================================================================================================ database & RLS
    await t.step("RLS: public read on x_handles and chain_events; anon and signed-in users cannot write; service-only tables and functions are closed", async () => {
      const row = { x_id: "424242", handle: "RlsProbe", id_hash: idHashOf(424242n), resolved_at: new Date().toISOString() };
      assertEquals((await service.from("x_handles").upsert(row)).error, null);
      const seen = await anon.from("x_handles").select("x_id,handle,id_hash");
      assertEquals(seen.error, null);
      assertEquals(seen.data, [{ x_id: "424242", handle: "RlsProbe", id_hash: row.id_hash }]);

      const emailUser = await newClient(keys.anon).auth.signUp({ email: `rls-${Date.now()}@example.com`, password: "Passw0rd!123456" });
      const userJwt = emailUser.data.session!.access_token;
      tokens.push(userJwt);
      const asUser = newClient(userJwt);
      for (const [who, c] of [["anon", anon], ["authenticated", asUser]] as const) {
        assertNotEquals((await c.from("x_handles").insert({ ...row, x_id: "5", id_hash: idHashOf(5n) })).error, null, `${who} insert`);
        assertNotEquals((await c.from("x_handles").update({ handle: "hacked" }).eq("x_id", row.x_id)).error, null, `${who} update`);
        assertNotEquals((await c.from("x_handles").delete().eq("x_id", row.x_id)).error, null, `${who} delete`);
        assertNotEquals((await c.from("chain_events").insert({ contract: "0x" + "0".repeat(40) })).error, null, `${who} chain_events insert`);
        assertNotEquals((await c.from("rate_limits").select()).error, null, `${who} rate_limits select`);
        assertNotEquals((await c.from("indexer_state").select()).error, null, `${who} indexer_state select`);
        assertNotEquals((await c.rpc("rate_limit_hit", { p_bucket: "x", p_window_seconds: 60, p_limit: 1 })).error, null, `${who} rate_limit_hit`);
        assertNotEquals((await c.rpc("feed_totals", { p_contract: "0x" + "0".repeat(40) })).error, null, `${who} feed_totals`);
        assertNotEquals((await c.rpc("upsert_x_handle", { p_x_id: "5", p_handle: "evil", p_name: null, p_id_hash: idHashOf(5n), p_resolved_at: new Date().toISOString() })).error, null, `${who} upsert_x_handle`);
        assertNotEquals((await c.rpc("indexer_acquire", { p_contract: "0x" + "0".repeat(40), p_owner: "x", p_start_block: 1, p_lease_seconds: 30 })).error, null, `${who} indexer_acquire`);
        assertNotEquals((await c.rpc("indexer_apply", { p_contract: "0x" + "0".repeat(40), p_owner: "x", p_from: 1, p_to: 2, p_events: [], p_lease_seconds: 30 })).error, null, `${who} indexer_apply`);
        assertNotEquals((await c.rpc("indexer_release", { p_contract: "0x" + "0".repeat(40), p_owner: "x" })).error, null, `${who} indexer_release`);
        assertNotEquals((await c.rpc("trigger_feed_sync", {})).error, null, `${who} trigger_feed_sync`);
        assertNotEquals((await c.from("app_config").select()).error, null, `${who} app_config select`);
      }
      assertEquals((await service.from("x_handles").select("handle").eq("x_id", row.x_id)).data, [{ handle: "RlsProbe" }]); // untouched
      assertEquals((await service.from("x_handles").delete().eq("x_id", row.x_id)).error, null);
    });

    await t.step("x_handles constraints: ids stay text, bad handles and hashes are refused, one row per hash", async () => {
      const ok = { x_id: "1850123456789012345", handle: "MuchTipDemo", id_hash: idHashOf(1850123456789012345n), resolved_at: new Date().toISOString() };
      assertEquals((await service.from("x_handles").upsert(ok)).error, null);
      assertEquals((await anon.from("x_handles").select("x_id").eq("x_id", ok.x_id)).data, [{ x_id: "1850123456789012345" }]); // no float rounding
      for (const bad of [{ x_id: "abc" }, { x_id: "1".repeat(21) }, { handle: "has space" }, { handle: "x".repeat(16) }, { id_hash: "0x1234" }, { id_hash: idHashOf(1850123456789012345n).toUpperCase().replace("0X", "0x") }]) {
        assertNotEquals((await service.from("x_handles").insert({ ...ok, x_id: "42", id_hash: idHashOf(42n), ...bad })).error, null, JSON.stringify(bad));
      }
      assertNotEquals((await service.from("x_handles").insert({ ...ok, x_id: "43" })).error, null, "a second account with the same id_hash");
      const clash = await service.from("x_handles").insert({ x_id: "44", handle: "MUCHTIPDEMO", id_hash: idHashOf(44n), resolved_at: new Date().toISOString() });
      assertNotEquals(clash.error, null, "a second account with the same handle in another case (unique lower(handle))");
      assertEquals((await anon.from("x_handles").select("handle_lc").eq("x_id", ok.x_id)).data, [{ handle_lc: "muchtipdemo" }]);
      assertEquals((await service.from("x_handles").delete().eq("x_id", ok.x_id)).error, null);
    });

    await t.step("rate_limit_hit: atomic fixed window, real SQL", async () => {
      const bucket = `it:${crypto.randomUUID()}`;
      const hits = [];
      for (let i = 0; i < 4; i++) hits.push((await service.rpc("rate_limit_hit", { p_bucket: bucket, p_window_seconds: 3600, p_limit: 2 })).data);
      assertEquals(hits, [true, true, false, false]);
      assertNotEquals((await service.rpc("rate_limit_hit", { p_bucket: bucket, p_window_seconds: 0, p_limit: 2 })).error, null);
      const parallel = await Promise.all(Array.from({ length: 20 }, () => service.rpc("rate_limit_hit", { p_bucket: `${bucket}:par`, p_window_seconds: 3600, p_limit: 5 })));
      assertEquals(parallel.filter((r) => r.data === true).length, 5); // exactly the limit gets through under concurrency
    });

    await t.step("feed_totals SQL: sums above 2^53 stay exact strings, distinct accounts, unclaimed, block cut-off", async () => {
      const c = "0x" + "0".repeat(39) + "1";
      const h1 = idHashOf(1n), h2 = idHashOf(2n);
      const mk = (block: number, event: string, id_hash: string, amount: string, extra: Record<string, unknown> = {}) => ({
        contract: c, block_number: block, log_index: 0, tx_hash: "0x" + block.toString(16).padStart(64, "0"), event, id_hash,
        account: "0x" + "a".repeat(40), amount_wei: amount, block_time: new Date().toISOString(), ...extra,
      });
      const big = "123456789012345678901234";
      const rows = [mk(10, "Tipped", h1, big, { tip_id: "1" }), mk(11, "Tipped", h1, "1", { tip_id: "2" }), mk(12, "Tipped", h2, "5", { tip_id: "3" }),
        mk(13, "Claimed", h1, big, { x_id: "1" }), mk(14, "Refunded", h2, "5", { tip_id: "3" })];
      assertEquals((await service.from("chain_events").upsert(rows, { onConflict: "contract,block_number,log_index" })).error, null);
      const all = (await service.rpc("feed_totals", { p_contract: c })).data;
      assertEquals(all, { tipsCount: 3, claimsCount: 1, refundsCount: 1, totalTippedWei: String(BigInt(big) + 6n), claimedWei: big, refundedWei: "5", uniqueHandles: 2, unclaimedWei: "1" });
      const upTo12 = (await service.rpc("feed_totals", { p_contract: c, p_to_block: 12 })).data;
      assertEquals([upTo12.tipsCount, upTo12.claimsCount, upTo12.unclaimedWei], [3, 0, String(BigInt(big) + 6n)]);
      assertEquals((await service.rpc("feed_totals", { p_contract: "0x" + "0".repeat(40) })).data.tipsCount, 0);
      const listed = await service.from("chain_events").select("block_number,amount_wei:amount_wei::text").eq("contract", c).order("block_number");
      assertEquals(listed.data![0], { block_number: 10, amount_wei: big }); // the ::text cast keeps 24 digits exact
      assertEquals((await service.from("chain_events").delete().eq("contract", c)).error, null);
    });

    // ================================================================================================ resolve
    await t.step("resolve: unknown -> X (1 call) -> row in x_handles -> cache hit (no X call) -> stale -> X again", async () => {
      const ip = "203.0.113.10";
      const first = await resolve(resolveFn, "@XDevelopers", ip);
      assertEquals(first.status, 200);
      const b1 = await first.json();
      assertEquals([b1.source, b1.xId, b1.handle, b1.idHash], ["x", "2244994945", "XDevelopers", idHashOf(2244994945n)]);
      assertEquals(xApi.hits.get("xdevelopers"), 1);
      const row = (await anon.from("x_handles").select("x_id,handle,id_hash,resolved_at").eq("x_id", "2244994945")).data![0];
      assertEquals([row.handle, row.id_hash], ["XDevelopers", b1.idHash]);

      const second = await (await resolve(resolveFn, "xdevelopers", ip)).json(); // different casing, still a hit
      assertEquals([second.source, second.xId], ["cache", "2244994945"]);
      assertEquals(xApi.hits.get("xdevelopers"), 1);

      const old = new Date(Date.now() - 2 * 3600_000).toISOString();
      assertEquals((await service.from("x_handles").update({ resolved_at: old }).eq("x_id", "2244994945")).error, null);
      const third = await (await resolve(resolveFn, "XDevelopers", ip)).json();
      assertEquals(third.source, "x");
      assertEquals(xApi.hits.get("xdevelopers"), 2);
      assert(Date.parse((await anon.from("x_handles").select("resolved_at").eq("x_id", "2244994945")).data![0].resolved_at) > Date.parse(old) + 3600_000); // refreshed
    });

    await t.step("resolve: ids above 2^53 survive Postgres and PostgREST; regression: Doge_Fan_42 never matches DogeXFanY42 (exact lookup, no pattern)", async () => {
      const ip = "203.0.113.11";
      const big = await (await resolve(resolveFn, "MuchTipDemo", ip)).json();
      assertEquals(big.xId, "1850123456789012345");
      assertEquals((await (await resolve(resolveFn, "muchtipdemo", ip)).json()).source, "cache");
      assertEquals((await (await resolve(resolveFn, "DogeXFanY42", ip)).json()).xId, "999000001"); // cached first...
      const underscore = await (await resolve(resolveFn, "Doge_Fan_42", ip)).json(); // ...must NOT be served for Doge_Fan_42 (an unescaped ILIKE "_" matches any one character, so it would match DogeXFanY42)
      assertEquals([underscore.source, underscore.xId], ["x", "710000042"]);
      assertEquals((await (await resolve(resolveFn, "doge_fan_42", ip)).json()).source, "cache");
    });

    await t.step("resolve: unknown handle -> 404 handle_not_found and no row; invalid input -> 400; X failures -> 429/502 without leaking", async () => {
      const ip = "203.0.113.12";
      const nf = await resolve(resolveFn, "nobody_here_1", ip);
      assertEquals([nf.status, (await nf.json()).error.code], [404, "handle_not_found"]);
      assertEquals((await anon.from("x_handles").select("x_id").eq("handle_lc", "nobody_here_1")).data, []);
      const bad = await resolve(resolveFn, "has space", ip);
      assertEquals([bad.status, (await bad.json()).error.code], [400, "invalid_handle"]);
      const rl = await resolve(resolveFn, "ratelimited", ip);
      assertEquals([rl.status, rl.headers.get("retry-after")], [429, "60"]);
      for (const h of ["authfail", "boom", "mismatch"]) {
        const r = await resolve(resolveFn, h, ip);
        const text = await r.text();
        assertEquals(r.status, 502, h);
        assert(!text.includes(X_TOKEN) && !text.includes("403") && !text.includes("Forbidden"), `${h} leaked: ${text}`);
      }
      assertEquals((await anon.from("x_handles").select("x_id").in("handle", ["authfail", "boom", "mismatch", "SomeoneElse"])).data, []);
    });

    await t.step("resolve: per-IP rate limit is enforced through the real rate_limits table", async () => {
      const ip = "203.0.113.13";
      const codes = [];
      for (let i = 0; i < 5; i++) codes.push((await resolve(resolveLimited, "XDevelopers", ip)).status);
      assertEquals(codes, [200, 200, 200, 429, 429]);
      assertEquals((await resolve(resolveLimited, "XDevelopers", "203.0.113.14")).status, 200); // another client is unaffected
      const buckets = (await service.from("rate_limits").select("bucket,hits").like("bucket", "resolve:ip:%")).data!;
      assert(buckets.length >= 2 && buckets.every((b) => /^resolve:ip:[0-9a-f]{16}$/.test(b.bucket)), "buckets hold hashes, not addresses");
      assert(!JSON.stringify(buckets).includes("203.0.113"));
    });

    await t.step("resolve: mock mode (no X_BEARER_TOKEN) serves fixtures and never calls the X API", async () => {
      const before = [...xApi.hits.values()].reduce((a, b) => a + b, 0);
      const b = await (await resolve(resolveMock, "@jack", "203.0.113.15")).json();
      assertEquals([b.source, b.xId, b.handle], ["mock", "12", "jack"]);
      assertEquals((await resolve(resolveMock, "not_a_fixture1", "203.0.113.15")).status, 404); // valid shape, not in the fixtures
      assertEquals([...xApi.hits.values()].reduce((a, c) => a + c, 0), before);
      assert(resolveMock.logs().includes("mock_mode"));
    });

    await t.step("resolve: CORS preflight", async () => {
      const r = await fetch(resolveFn.url, { method: "OPTIONS", headers: { origin: "https://app.example", "access-control-request-method": "POST" } });
      await r.body?.cancel();
      assertEquals([r.status, r.headers.get("access-control-allow-origin")], [204, "*"]);
    });

    // ================================================================================================ sign-claim
    const needsKey = !VERIFIER_KEY ? "no VERIFIER_PRIVATE_KEY in .env" : !verifierMatchesLive ? "the .env verifier key is not the live contract's verifier" : null;
    if (needsKey) console.warn(`\n!! sign-claim integration steps SKIPPED: ${needsKey}\n`);

    const recipient = ethers.getAddress("0x" + "5e".repeat(20));
    const X_A = { id: "2244994945", username: "DogeFan_42", email: "dogefan@example.com" };

    await t.step({
      name: "sign-claim: rejects no token, garbage, forged, wrong-secret and expired tokens (401)",
      ignore: !!needsKey,
      async fn() {
        const { jwt } = await loginWithX(X_A);
        tokens.push(jwt);
        const claims = jwtPayload(jwt);
        const [h, , s] = jwt.split(".");
        const forgedPayload = `${h}.${b64u(JSON.stringify({ ...claims, sub: "00000000-0000-0000-0000-000000000000" }))}.${s}`;
        const wrongSecret = await craftJwt("not-the-secret", { ...claims });
        const expired = await craftJwt(keys.secret, { ...claims, iat: claims.iat - 7200, exp: Math.floor(Date.now() / 1000) - 60 });
        assert(/expired/i.test((await service.auth.getUser(expired)).error?.message ?? ""), "GoTrue itself must call the crafted token expired (so the case is not vacuous)");
        const none = await post(signLive!, { recipient });
        assertEquals([none.status, (await none.json()).error.code], [401, "missing_token"]);
        for (const [name, tok] of [["garbage", "abc"], ["forged payload", forgedPayload], ["wrong secret", wrongSecret], ["expired", expired], ["anon key", keys.anon]] as const) {
          const r = await post(signLive!, { recipient }, tok);
          assertEquals([name, r.status, (await r.json()).error.code], [name, 401, "invalid_token"]);
        }
        const ok = await post(signLive!, { recipient }, jwt); // and the untampered token works
        assertEquals(ok.status, 200);
      },
    });

    await t.step({
      name: "sign-claim: rejects email, anonymous, x+email (pre-registration takeover) and spoofed-metadata email users (403)",
      ignore: !!needsKey,
      async fn() {
        const emailUser = await newClient(keys.anon).auth.signUp({ email: `plain-${Date.now()}@example.com`, password: "Passw0rd!123456" });
        const emailJwt = emailUser.data.session!.access_token;
        const anonUser = await newClient(keys.anon).auth.signInAnonymously();
        const anonJwt = anonUser.data.session!.access_token;
        // an email user who rewrites user_metadata to look exactly like the X account of 2244994945
        const spoofer = newClient(keys.anon);
        const su = await spoofer.auth.signUp({ email: `spoof-${Date.now()}@example.com`, password: "Passw0rd!123456" });
        await spoofer.auth.updateUser({ data: { sub: "2244994945", provider_id: "2244994945", user_name: "XDevelopers", provider: "x" } });
        const spoofJwt = su.data.session!.access_token;
        assertEquals((await service.auth.getUser(spoofJwt)).data.user?.user_metadata?.sub, "2244994945"); // precondition: the spoof is in place

        // attacker pre-registers the victim's X email, the victim then logs in with X, the attacker logs in with the password
        await setMock({ id: "555000111", username: "Victim_Real", confirmed_email: "victim@example.com" });
        await newClient(keys.anon).auth.signUp({ email: "victim@example.com", password: "Passw0rd!123456" });
        await loginWithX({ id: "555000111", username: "Victim_Real", email: "victim@example.com" });
        const atk = await newClient(keys.anon).auth.signInWithPassword({ email: "victim@example.com", password: "Passw0rd!123456" });
        const atkJwt = atk.data.session!.access_token;
        const atkIdentities = ((await service.auth.getUser(atkJwt)).data.user?.identities ?? []).map((i) => i.provider).sort();
        assertEquals(atkIdentities, ["email", "x"], "precondition: the takeover account really holds the victim's X identity next to an email one");
        tokens.push(emailJwt, anonJwt, spoofJwt, atkJwt);

        const cases: Array<[string, string, string]> = [
          ["email user", emailJwt, "non-x identity: email"],
          ["anonymous user", anonJwt, "anonymous"],
          ["x + email (takeover)", atkJwt, "exactly 1 identity, found 2"],
          ["email user with spoofed user_metadata", spoofJwt, "non-x identity: email"],
        ];
        for (const [name, jwt, why] of cases) {
          const r = await post(signLive!, { recipient }, jwt);
          const b = await r.json();
          assertEquals([name, r.status, b.error.code], [name, 403, "identity_not_allowed"]);
          assert(b.error.message.includes(why), `${name}: ${b.error.message}`);
          assertEquals(b.signature, undefined);
        }
      },
    });

    await t.step({
      name: "sign-claim: accepts a pure X user, signs for the IDENTITY's id even with spoofed user_metadata, keeps 19-digit ids exact",
      ignore: !!needsKey,
      async fn() {
        const { client, jwt } = await loginWithX(X_A);
        tokens.push(jwt);
        const plain = await (await post(signLive!, { recipient }, jwt)).json();
        assertEquals([plain.xId, plain.handle, plain.recipient, plain.contract, plain.chainId], ["2244994945", "DogeFan_42", recipient, LIVE, 6281971]);

        await client.auth.updateUser({ data: { sub: "999", provider_id: "999", user_name: "victim", id: "999" } });
        assertEquals((await service.auth.getUser(jwt)).data.user?.user_metadata?.sub, "999"); // precondition: metadata now lies
        const spoofed = await post(signLive!, { recipient }, jwt);
        assertEquals(spoofed.status, 200);
        const sb = await spoofed.json();
        assertEquals([sb.xId, sb.handle], ["2244994945", "DogeFan_42"]); // identity wins; the lie in user_metadata is ignored

        const big = await loginWithX({ id: "1850123456789012345", username: "MuchTipDemo", email: "demo@example.com" });
        tokens.push(big.jwt);
        const bb = await (await post(signLive!, { recipient }, big.jwt, "198.51.100.2")).json();
        assertEquals(bb.xId, "1850123456789012345");
        assertNotEquals(bb.nonce, sb.nonce);
      },
    });

    await t.step({
      name: "sign-claim: the signature is verified by the LIVE contract (eth_call, no DOGE spent)",
      ignore: !!needsKey,
      async fn() {
        const { jwt } = await loginWithX(X_A);
        tokens.push(jwt);
        const to = ethers.getAddress("0x" + "c0".repeat(20));
        const blockTs = async () => parseInt(((await rpc("eth_getBlockByNumber", ["latest", false])) as unknown as { result: { timestamp: string } }).result.timestamp, 16);
        const chainBefore = await blockTs();
        const r = await post(signLive!, { recipient: to }, jwt, "198.51.100.3");
        const chainAfter = await blockTs();
        assertEquals(r.status, 200);
        const b = await r.json();
        const [xId, nonce, expiry] = [BigInt(b.xId), BigInt(b.nonce), BigInt(b.expiry)];
        assertEquals(b.unclaimedWei, "0"); // the live contract holds nothing yet

        // 1. the contract computes the same EIP-712 digest from the same fields (domain = live chain id + live address)
        const dig = await rpc("eth_call", [{ to: LIVE, data: escrowRead.encodeFunctionData("claimDigest", [xId, to, nonce, expiry]) }, "latest"]);
        assertEquals(dig.result, b.digest);

        // 2. the expiry is a short window after the chain's latest block
        // expiry = the chain time the function saw when signing + 300 s, and that chain time lies between our two reads
        assert(Number(expiry) >= chainBefore + 300 && Number(expiry) <= chainAfter + 300, `expiry ${expiry} vs chain ${chainBefore}..${chainAfter}`);

        // 3. claim() on the live contract, no state override: signature check comes BEFORE the amount check, so reaching
        //    NothingToClaim proves the signature was accepted (a bad one would revert BadSignature first)
        const callData = escrowRead.encodeFunctionData("claim", [xId, to, nonce, expiry, b.signature]);
        const noFunds = await rpc("eth_call", [{ to: LIVE, data: callData }, "latest"]);
        assertEquals(revertName(noFunds.error), "NothingToClaim");

        // 4. with 0.01 DOGE credited to that X account (balanceOf slot) and to the contract, in the simulation only: it pays out
        const override = { [LIVE]: { balance: ethers.toQuantity(10n ** 18n), stateDiff: { [balanceSlot(idHashOf(xId))]: ethers.zeroPadValue(ethers.toBeHex(10n ** 16n), 32) } } };
        const funded = await rpc("eth_call", [{ to: LIVE, data: callData }, "latest", override]);
        assertEquals([funded.error, funded.result], [undefined, "0x"]);

        // 5. and every tampered variant is refused with BadSignature
        const variants: Record<string, string> = {
          "different recipient": escrowRead.encodeFunctionData("claim", [xId, ethers.getAddress("0x" + "c1".repeat(20)), nonce, expiry, b.signature]),
          "different X id": escrowRead.encodeFunctionData("claim", [xId + 1n, to, nonce, expiry, b.signature]),
          "different nonce": escrowRead.encodeFunctionData("claim", [xId, to, nonce + 1n, expiry, b.signature]),
          "later expiry": escrowRead.encodeFunctionData("claim", [xId, to, nonce, expiry + 1n, b.signature]),
        };
        for (const [name, data] of Object.entries(variants)) {
          const res = await rpc("eth_call", [{ to: LIVE, data }, "latest", override]);
          assertEquals([name, revertName(res.error)], [name, "BadSignature"]);
        }
        // 6. a signature for a different contract (the throwaway copy has another address, hence another domain) is refused too
        const otherContract = await rpc("eth_call", [{ to: THROWAWAY, data: callData }, "latest", { [THROWAWAY]: { balance: ethers.toQuantity(10n ** 18n), stateDiff: { [balanceSlot(idHashOf(xId))]: ethers.zeroPadValue(ethers.toBeHex(10n ** 16n), 32) } } }]);
        assertEquals(revertName(otherContract.error), "BadSignature");
      },
    });

    await t.step({
      name: "sign-claim: reports the unclaimed amount read from the chain (live RPC, balanceOf overridden to 0.01 DOGE)",
      ignore: !!needsKey,
      async fn() {
        const { jwt } = await loginWithX(X_A);
        tokens.push(jwt);
        const b = await (await post(signOverride!, { recipient }, jwt, "198.51.100.4")).json();
        assertEquals([b.unclaimedWei, b.claimable], ["10000000000000000", true]);
        const zero = await (await post(signLive!, { recipient }, jwt, "198.51.100.4")).json();
        assertEquals([zero.unclaimedWei, zero.claimable], ["0", false]);
      },
    });

    await t.step({
      name: "sign-claim: refuses when its key is not the contract's verifier; rate-limits per X account; validates the recipient",
      ignore: !!needsKey,
      async fn() {
        const { jwt } = await loginWithX({ id: "710000777", username: "Limited_One", email: "" });
        tokens.push(jwt);
        const wrongKey = await post(signBadKey!, { recipient }, jwt, "198.51.100.5");
        assertEquals([wrongKey.status, (await wrongKey.json()).error.code], [503, "verifier_mismatch"]);
        const lim = await loginWithX({ id: "710000778", username: "Limited_Two", email: "" }); // its own bucket: limits are per X account
        tokens.push(lim.jwt);
        const codes = [];
        for (let i = 0; i < 4; i++) codes.push((await post(signLimited!, { recipient }, lim.jwt, "198.51.100.6")).status);
        assertEquals(codes, [200, 200, 429, 429]);
        for (const bad of ["0x1234", ethers.ZeroAddress, LIVE, ""]) {
          const r = await post(signLive!, { recipient: bad }, jwt, "198.51.100.7");
          assertEquals([bad, r.status, (await r.json()).error.code], [bad, 400, "invalid_recipient"]);
        }
        const pre = await fetch(signLive!.url, { method: "OPTIONS", headers: { origin: "https://app.example", "access-control-request-headers": "authorization,content-type" } });
        await pre.body?.cancel();
        assertEquals([pre.status, pre.headers.get("access-control-allow-origin")], [204, "*"]);
      },
    });

    // ================================================================================================ feed
    const feedGet = async (fn: Fn, qs = "", ip = "198.51.100.20") => {
      const r = await fetch(`${fn.url}/${qs}`, { headers: { "x-forwarded-for": ip } });
      return { status: r.status, body: await r.json() };
    };
    const expectedThrowawayTotals = { tipsCount: 3, totalTippedWei: "30000000000000000", uniqueHandles: 2, unclaimedWei: "0", claimedWei: "20000000000000000", refundedWei: "10000000000000000", claimsCount: 2, refundsCount: 1 };

    await t.step("feed: a bounded backlog is worked off over several requests and the totals come out right (real events of the e2e contract)", async () => {
      // start the scan 'before' the contract existed, in small windows, so several requests are needed
      const small = await startFn("feed", 8799, { ...base, ESCROW_ADDRESS: THROWAWAY, ESCROW_DEPLOY_BLOCK: String(throwawayDeployBlock - 2500), FEED_MIN_SYNC_SECONDS: "0", FEED_MAX_BLOCKS_PER_SYNC: "1000", FEED_LOG_CHUNK_BLOCKS: "400" });
      started.push(small);
      let r = await feedGet(small);
      assertEquals(r.status, 200);
      assertEquals(r.body.sync.complete, false);
      assertEquals(r.body.totals.tipsCount, 0); // the first window ends before the contract's first event
      assertEquals(r.body.sync.indexedToBlock, throwawayDeployBlock - 2500 - 1 + 1000);
      for (let i = 0; i < 60 && !r.body.sync.complete; i++) r = await feedGet(small);
      assertEquals(r.body.sync.complete, true);
      assertEquals(r.body.totals, expectedThrowawayTotals);
      await small.stop();
      // start over for the next step
      await service.from("chain_events").delete().eq("contract", THROWAWAY.toLowerCase());
      await service.from("indexer_state").delete().eq("contract", THROWAWAY.toLowerCase());
    });

    await t.step("feed: totals and events from the real Tipped/Claimed/Refunded events of the e2e contract, joined with handles resolved by `resolve`", async () => {
      const feed = await startFn("feed", 8780, { ...base, ESCROW_ADDRESS: THROWAWAY, ESCROW_DEPLOY_BLOCK: String(throwawayDeployBlock), FEED_MIN_SYNC_SECONDS: "0" });
      started.push(feed);
      await resolve(resolveFn, "XDevelopers", "203.0.113.30"); // x_handles for both accounts that were tipped
      await resolve(resolveFn, "MuchTipDemo", "203.0.113.30");

      const { status, body } = await feedGet(feed);
      assertEquals(status, 200);
      assertEquals(body.contract, THROWAWAY);
      assertEquals(body.totals, expectedThrowawayTotals);
      assertEquals(body.sync.complete, true);
      assertEquals(body.onChain, { balanceWei: "0", matchesTotals: true }); // events say 0 owed; the contract holds 0 at the same block
      assertEquals(body.events.map((e: { type: string }) => e.type), ["Claimed", "Tipped", "Refunded", "Tipped", "Claimed", "Tipped"]); // newest first
      const byHash: Record<string, string> = { [e2e.tipA]: "Tipped", [e2e.claim]: "Claimed", [e2e.tipB]: "Tipped", [e2e.refund]: "Refunded", [e2e.tipC]: "Tipped", [e2e.claimC]: "Claimed" };
      for (const ev of body.events) assertEquals(byHash[ev.txHash], ev.type, `${ev.txHash}`); // every event is one of the transactions in e2e-result.json
      assertEquals(body.events.map((e: { txHash: string }) => e.txHash), [e2e.claimC, e2e.tipC, e2e.refund, e2e.tipB, e2e.claim, e2e.tipA]);
      const tipA = body.events[5], tipB = body.events[3], refund = body.events[2];
      assertEquals([tipA.handle, tipA.xId, tipA.amountWei, tipA.tipId], ["XDevelopers", "2244994945", "10000000000000000", "1"]);
      assertEquals([tipB.handle, tipB.xId, refund.handle, refund.type, refund.tipId], ["MuchTipDemo", "1850123456789012345", "MuchTipDemo", "Refunded", "2"]);
      assertEquals(body.events[4].xId, "2244994945"); // Claimed carries the numeric id in the event itself
      const receipt = await rpc("eth_getBlockByNumber", [ethers.toQuantity(tipA.blockNumber), false]) as unknown as { result: { timestamp: string } };
      assertEquals(Date.parse(tipA.time) / 1000, parseInt(receipt.result.timestamp, 16)); // block time from the chain

      // persisted: a second request adds nothing and duplicates nothing
      const again = await feedGet(feed);
      assertEquals(again.body.totals, expectedThrowawayTotals);
      assertEquals((await anon.from("chain_events").select("block_number", { count: "exact", head: true }).eq("contract", THROWAWAY.toLowerCase())).count, 6);
      assertEquals(typeof (await service.from("indexer_state").select("last_block").eq("contract", THROWAWAY.toLowerCase())).data![0].last_block, "number");

      assertEquals((await feedGet(feed, "?type=Claimed")).body.events.length, 2);
      assertEquals((await feedGet(feed, "?limit=1")).body.events.length, 1);
      assertEquals((await feedGet(feed, "?limit=0")).status, 400);
      await feed.stop();
    });

    await t.step("feed: the LIVE contract's refundDelay() and minTip() come from the chain; no events yet means zero totals", async () => {
      const live = await startFn("feed", 8781, { ...base, ESCROW_ADDRESS: LIVE, ESCROW_DEPLOY_BLOCK: String(dep.deployBlock), FEED_MIN_SYNC_SECONDS: "0" });
      started.push(live);
      const { status, body } = await feedGet(live, "", "198.51.100.21");
      assertEquals(status, 200);
      assertEquals(body.config, { refundDelaySeconds: dep.refundDelaySeconds, minTipWei: dep.minTipWei }); // 600 s and 5 DOGE, read from the contract
      assertEquals(body.contract, LIVE);
      assertEquals(body.totals, { tipsCount: 0, totalTippedWei: "0", uniqueHandles: 0, unclaimedWei: "0", claimedWei: "0", refundedWei: "0", claimsCount: 0, refundsCount: 0 });
      assertEquals(body.events, []);
      assertEquals(body.sync.complete, true);
      assertEquals(body.onChain, { balanceWei: "0", matchesTotals: true });
      await live.stop();
    });

    // ================================================================================================ new: handle ownership, fresh lookups
    await t.step("upsert_x_handle: one owner per handle even under 20 concurrent writers; the loser's row keeps its id but loses the handle", async () => {
      const writes = Array.from({ length: 20 }, (_, i) => {
        const id = i % 2 === 0 ? "800000001" : "800000002";
        return service.rpc("upsert_x_handle", { p_x_id: id, p_handle: i % 3 === 0 ? "RaceHandle" : "racehandle", p_name: `n${i}`, p_id_hash: idHashOf(BigInt(id)), p_resolved_at: new Date().toISOString() });
      });
      const results = await Promise.all(writes);
      assertEquals(results.filter((r) => r.error).map((r) => r.error!.message), []);
      const rows = (await anon.from("x_handles").select("x_id,handle").in("x_id", ["800000001", "800000002"]).order("x_id")).data!;
      assertEquals(rows.length, 2);
      assertEquals(rows.filter((r) => r.handle !== null).length, 1); // exactly one holds it
      await service.from("x_handles").delete().in("x_id", ["800000001", "800000002"]);
    });

    await t.step("resolve fresh: handle reassigned within the cache hour -> cached answer is the old owner, fresh is the new one with its name, cache follows", async () => {
      const ip = "203.0.113.40";
      const before = await (await resolve(resolveFn, "XDevelopers", ip)).json();
      assertEquals([before.xId, before.source], ["2244994945", "cache"]); // cached by earlier steps
      const original = { ...xApi.users.xdevelopers };
      xApi.users.xdevelopers = { id: "2244994946", username: "XDevelopers", name: "New Owner" }; // X reassigns the handle
      try {
        assertEquals((await (await resolve(resolveFn, "XDevelopers", ip)).json()).xId, "2244994945"); // stale: why the tip flow must not use it
        const hitsBefore = xApi.hits.get("xdevelopers") ?? 0;
        const fresh = await (await post(resolveFn, { handle: "@XDevelopers", fresh: true }, undefined, ip)).json();
        assertEquals([fresh.xId, fresh.handle, fresh.name, fresh.source, fresh.idHash], ["2244994946", "XDevelopers", "New Owner", "x", idHashOf(2244994946n)]);
        assertEquals(xApi.hits.get("xdevelopers"), hitsBefore + 1);
        assertEquals((await (await resolve(resolveFn, "XDevelopers", ip)).json()).xId, "2244994946"); // the cache now has the new owner
        const owners = (await anon.from("x_handles").select("x_id,handle,name").in("x_id", ["2244994945", "2244994946"]).order("x_id")).data!;
        assertEquals(owners, [{ x_id: "2244994945", handle: null, name: "X Developers" }, { x_id: "2244994946", handle: "XDevelopers", name: "New Owner" }]);
        const get = await (await fetch(`${resolveFn.url}/?handle=XDevelopers&fresh=1`, { headers: { "x-forwarded-for": ip } })).json();
        assertEquals(get.source, "x"); // GET form of fresh
      } finally {
        xApi.users.xdevelopers = original; // hand it back, so the feed steps join tips to @XDevelopers again
        const back = await (await post(resolveFn, { handle: "XDevelopers", fresh: true }, undefined, ip)).json();
        assertEquals(back.xId, "2244994945");
      }
    });

    // ================================================================================================ new: single-writer indexing
    await t.step("indexer SQL: lease is exclusive, apply is compare-and-set (wrong owner / wrong start / stale range all refused), events stay exact", async () => {
      const c = "0x" + "0".repeat(39) + "2";
      const acquire = (owner: string) => service.rpc("indexer_acquire", { p_contract: c, p_owner: owner, p_start_block: 100, p_lease_seconds: 30 });
      const apply = (owner: string, from: number, to: number, events: unknown[] = []) =>
        service.rpc("indexer_apply", { p_contract: c, p_owner: owner, p_from: from, p_to: to, p_events: events, p_lease_seconds: 30 });
      const ev = (block: number) => ({ contract: c, block_number: block, log_index: 0, tx_hash: "0x" + block.toString(16).padStart(64, "0"), event: "Tipped", id_hash: idHashOf(1n), tip_id: "1", account: "0x" + "a".repeat(40), amount_wei: "123456789012345678901234", x_id: null, block_time: new Date().toISOString() });
      const a = await acquire("A");
      assertEquals(a.data.lastBlock, 99);
      assertEquals((await acquire("B")).data, null); // A holds it
      assertEquals((await apply("B", 100, 199)).data, false); // not the owner
      assertEquals((await apply("A", 150, 199)).data, false); // does not start at last_block + 1
      assertEquals((await apply("A", 100, 199, [ev(120)])).data, true);
      assertEquals((await apply("A", 100, 199, [ev(120)])).data, false); // the same range again: refused, nothing stored twice
      assertNotEquals((await apply("A", 200, 299, [ev(350)])).error, null); // an event outside its range is an error, and nothing moves
      assertEquals((await service.from("indexer_state").select("last_block,lease_owner").eq("contract", c)).data, [{ last_block: 199, lease_owner: "A" }]);
      await service.rpc("indexer_release", { p_contract: c, p_owner: "A" });
      assertEquals((await acquire("B")).data.lastBlock, 199); // released: B may continue from where A stopped
      const parallel = await Promise.all(Array.from({ length: 10 }, () => apply("B", 200, 299, [ev(250)])));
      assertEquals(parallel.filter((r) => r.data === true).length, 1); // ten identical applies at once: exactly one wins
      const stored = (await service.from("chain_events").select("block_number,amount_wei:amount_wei::text").eq("contract", c).order("block_number")).data;
      assertEquals(stored, [{ block_number: 120, amount_wei: "123456789012345678901234" }, { block_number: 250, amount_wei: "123456789012345678901234" }]);
      await service.from("chain_events").delete().eq("contract", c);
      await service.from("indexer_state").delete().eq("contract", c);
    });

    await t.step("feed: 8 concurrent requests on an empty index -> every block range fetched from the chain once, every event stored once", async () => {
      await service.from("chain_events").delete().eq("contract", THROWAWAY.toLowerCase());
      await service.from("indexer_state").delete().eq("contract", THROWAWAY.toLowerCase());
      const rec = startRecordingRpc(4031);
      overrideRpcs.push(rec.server);
      const conc = await startFn("feed", 8782, { RPC_URL: "http://127.0.0.1:4031", CHAIN_ID: "6281971", ESCROW_ADDRESS: THROWAWAY, ESCROW_DEPLOY_BLOCK: String(throwawayDeployBlock - 20_000), FEED_MIN_SYNC_SECONDS: "0", FEED_LOG_CHUNK_BLOCKS: "2000" });
      started.push(conc);
      const answers = await Promise.all(Array.from({ length: 8 }, (_, i) => feedGet(conc, "", `198.51.100.${60 + i}`)));
      assert(answers.every((a) => a.status === 200));
      assert(answers.every((a) => a.body.onChain === null || a.body.onChain.matchesTotals === true), "every answer is consistent at its own block");
      const sorted = [...rec.ranges].sort((a, b) => a.from - b.from);
      for (let k = 1; k < sorted.length; k++) assertEquals(sorted[k].from, sorted[k - 1].to + 1, `overlapping or gapped eth_getLogs ${JSON.stringify(sorted.slice(k - 1, k + 1))}`);
      assertEquals(sorted[0].from, throwawayDeployBlock - 20_000);
      assert(sorted.length >= 10, `expected the 20k+ block backlog to need many 2,000-block requests, saw ${sorted.length}`);
      assertEquals((await anon.from("chain_events").select("block_number", { count: "exact", head: true }).eq("contract", THROWAWAY.toLowerCase())).count, 6);
      let after = await feedGet(conc, "", "198.51.100.70");
      for (let i = 0; i < 30 && !after.body.sync.complete; i++) after = await feedGet(conc, "", "198.51.100.70");
      assertEquals(after.body.totals, expectedThrowawayTotals);
      await conc.stop();
      await service.from("chain_events").delete().eq("contract", THROWAWAY.toLowerCase());
      await service.from("indexer_state").delete().eq("contract", THROWAWAY.toLowerCase());
    });

    await t.step("pg_cron: the minute job is scheduled, fires on its own, and its pg_net call makes the feed index (no test request involved)", async () => {
      assertEquals(await psql("select schedule || ' | ' || command from cron.job where jobname = 'muchtip-feed-sync'"), "* * * * * | select public.trigger_feed_sync()");
      const cronLc = CRON_CONTRACT.toLowerCase();
      let state: { last_block: number } | undefined;
      // the job fires at the top of each minute; it has usually fired long before this step runs, but wait if not
      const deadline = Math.max(cronSetAt + 130_000, Date.now() + 75_000);
      do {
        state = (await service.from("indexer_state").select("last_block").eq("contract", cronLc)).data?.[0];
        if (state) break;
        await sleep(2000);
      } while (Date.now() < deadline);
      assert(state, "pg_cron never caused the cron feed instance to index (waited ~2 minutes)");
      assert(state!.last_block >= headNow - 50, `indexed to ${state!.last_block}`);
      const runs = await psql("select status from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'muchtip-feed-sync' order by d.start_time desc limit 1");
      assertEquals(runs, "succeeded");
      const http = await psql("select status_code from net._http_response order by created desc limit 1");
      assertEquals(http, "200");
    });

    // ================================================================================================ hygiene
    await t.step("no secret ever appears in any function's logs (verifier key, X token, service key, user JWTs)", () => {
      const secrets = [X_TOKEN, keys.service, keys.anon, keys.secret, ...tokens.filter(Boolean)];
      if (VERIFIER_KEY) secrets.push(VERIFIER_KEY, VERIFIER_KEY.replace(/^0x/, ""));
      for (const fn of functionLogs) {
        const logs = fn.logs();
        for (const s of secrets) assert(!logs.includes(s), `a secret leaked into function logs (${s.slice(0, 6)}…)`);
      }
      assert(functionLogs.some((f) => f.logs().includes('"event":"signed"')) || !!needsKey, "sign-claim logged nothing");
    });
  } finally {
    for (const f of [...functionLogs]) await f.stop();
    for (const s of overrideRpcs) await s.shutdown();
    await xApi.server.shutdown();
    await gateway.shutdown();
  }
});
