// Auth-hardening tests against a real supabase/auth (GoTrue) server, with X mocked (mock-x.cjs).
//   node test-hardening.cjs permissive   server config: email+auto-confirm, anonymous, manual linking all ON
//   node test-hardening.cjs hardened     server config: email, phone, anonymous, manual linking all OFF
//   node test-hardening.cjs default-email  GoTrue defaults for X without GOTRUE_EXTERNAL_X_EMAIL_OPTIONAL (documents the limitation)
// The first two run with GOTRUE_EXTERNAL_X_EMAIL_OPTIONAL=true, because X accounts without a confirmed email must be able to sign in.
// Use run-hardening.sh to start the stack for each mode. Exit code is non-zero if any check fails.
const { AuthClient } = require("@supabase/supabase-js");
const keys = require("./keys.json");
const { xIdFromJwt } = require("./edge-check.cjs");

const MODE = process.argv[2];
if (!["permissive", "hardened", "default-email"].includes(MODE)) { console.error("usage: node test-hardening.cjs <permissive|hardened|default-email>"); process.exit(2); }
const URL_ = "http://localhost:9999";
const CB = "http://localhost:3000/cb";
const nc = (key) => new AuthClient({ url: URL_, headers: { apikey: key, Authorization: `Bearer ${key}` }, autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "implicit" });
const admin = nc(keys.service);
const setMock = (o) => fetch("http://localhost:4010/__set", { method: "POST", body: JSON.stringify(o) });

let failures = 0;
const check = (label, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "\n        " + detail : ""}`); if (!cond) failures++; };
const verdict = (r) => (r.ok ? `accepted, xId=${r.xId}` : `rejected: ${r.reason}`);
const providersOf = async (jwt) => { const { data } = await admin.getUser(jwt); return (data?.user?.identities ?? []).map((i) => `${i.provider}:${i.id.length > 12 ? i.id.slice(0, 8) + "…" : i.id}`); };

// Returns true when the login worked; otherwise records a failed check that carries GoTrue's error message.
const loggedIn = (label, res) => { if (res.error) { check(label, false, `X login failed: ${res.error}`); return false; } return true; };

// The check this spike replaces (last turn's pattern): "exactly one 'x' identity", other identities ignored.
async function laxXIdFromJwt(jwt) {
  const { data, error } = await admin.getUser(jwt);
  if (error || !data?.user) return { ok: false, reason: error?.message };
  const xs = (data.user.identities ?? []).filter((i) => i.provider === "x");
  return xs.length === 1 ? { ok: true, xId: BigInt(xs[0].id) } : { ok: false, reason: `found ${xs.length} x identities` };
}

// Follow GoTrue's redirects by hand until the app's callback URL; returns tokens or the error GoTrue reported.
async function follow(url) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(url.replace("host.docker.internal", "localhost"), { redirect: "manual" });
    const loc = r.headers.get("location");
    if (!loc) return { error: `no redirect (${r.status}) ${(await r.text()).slice(0, 120)}` };
    if (loc.startsWith(CB)) {
      const p = new URLSearchParams(loc.split("#")[1] || loc.split("?")[1] || "");
      return p.get("error") ? { error: `${p.get("error")}: ${p.get("error_description")}` } : { access: p.get("access_token"), refresh: p.get("refresh_token") };
    }
    url = new URL(loc, url).toString();
  }
  return { error: "too many redirects" };
}
async function loginWithX() {
  const c = nc(keys.anon);
  const { data, error } = await c.signInWithOAuth({ provider: "x", options: { skipBrowserRedirect: true, redirectTo: CB } });
  if (error) return { error: error.message };
  const res = await follow(data.url);
  if (res.error) return res;
  await c.setSession({ access_token: res.access, refresh_token: res.refresh });
  return { client: c, jwt: res.access };
}

(async () => {
  console.log(`=== auth hardening, mode: ${MODE}\n`);

  if (MODE === "default-email") {
    setMock({ id: "710000009", username: "NoEmailUser", confirmed_email: "" });
    const x = await loginWithX();
    check("GoTrue default: an X account WITHOUT a confirmed email is refused at sign-in (fix: GOTRUE_EXTERNAL_X_EMAIL_OPTIONAL=true)",
      !!x.error && /user email/.test(x.error), x.error ? `refused as expected: ${x.error}` : "login unexpectedly succeeded");
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"} (${MODE})`);
    process.exit(failures === 0 ? 0 : 1);
  }

  // ---------------------------------------------------------------- both modes
  setMock({ id: "2244994945", username: "DogeFan_42", confirmed_email: "dogefan@example.com" });
  const good = await loginWithX();
  check("a plain X user (one 'x' identity) is accepted", !good.error && (await xIdFromJwt(admin, good.jwt)).ok, good.error ? `login failed: ${good.error}` : verdict(await xIdFromJwt(admin, good.jwt)));
  if (!good.error) {
    const [h, p, s] = good.jwt.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: "00000000-0000-0000-0000-000000000000" })).toString("base64url")}.${s}`;
    check("a tampered JWT is rejected", !(await xIdFromJwt(admin, forged)).ok, verdict(await xIdFromJwt(admin, forged)));
  }

  if (MODE === "permissive") {
    // 1. email-only user
    const em = await nc(keys.anon).signUp({ email: `plain-${Date.now()}@example.com`, password: "Passw0rd!123456" });
    const emR = em.data?.session ? await xIdFromJwt(admin, em.data.session.access_token) : { ok: false, reason: "no session" };
    check("an email-only user is rejected", !emR.ok, verdict(emR));

    // 2. anonymous user
    const an = await nc(keys.anon).signInAnonymously();
    const anR = an.data?.session ? await xIdFromJwt(admin, an.data.session.access_token) : { ok: false, reason: `no session (${an.error?.message})` };
    check("an anonymous user is rejected", !anR.ok && !!an.data?.session, verdict(anR));

    // 3. THE attack: attacker pre-registers the victim's X email, victim then signs in with X, attacker logs in with the password
    setMock({ id: "555000111", username: "Victim_Real", confirmed_email: "victim@example.com" });
    const pre = await nc(keys.anon).signUp({ email: "victim@example.com", password: "Passw0rd!123456" });
    const vic = await loginWithX();
    const atk = await nc(keys.anon).signInWithPassword({ email: "victim@example.com", password: "Passw0rd!123456" });
    const atkJwt = atk.data?.session?.access_token;
    const ids = atkJwt ? await providersOf(atkJwt) : [];
    const lax = atkJwt ? await laxXIdFromJwt(atkJwt) : { ok: false, reason: "attacker could not log in" };
    const strict = atkJwt ? await xIdFromJwt(admin, atkJwt) : { ok: false, reason: "attacker could not log in" };
    check("pre-registration takeover: the OLD check was fooled (this is the bug being fixed)", lax.ok === true, `attacker identities=[${ids}] ; old check: ${verdict(lax)}`);
    check("pre-registration takeover: the STRICT check rejects it", strict.ok === false && !!atkJwt, `strict check: ${verdict(strict)}`);
    if (pre.error || vic.error) console.log(`        (setup note: signUp error=${pre.error?.message ?? "none"}, victim login error=${vic.error ?? "none"})`);

    // 4. X user adds an email identity themselves
    setMock({ id: "710000001", username: "AddsEmail", confirmed_email: "" });
    const addE = await loginWithX();
    if (loggedIn("an X user WITHOUT a confirmed email can sign in", addE)) {
      check("an X user WITHOUT a confirmed email can sign in", true, `accepted: ${verdict(await xIdFromJwt(admin, addE.jwt))}`);
      const upd = await addE.client.updateUser({ email: `added-${Date.now()}@example.com` });
      const addIds = await providersOf(addE.jwt);
      const addR = await xIdFromJwt(admin, addE.jwt);
      check("an X user who adds an email: the rule is applied to whatever identities exist", addR.ok === (addIds.length === 1 && addIds[0].startsWith("x:")), `updateUser error=${upd.error?.message ?? "none"}; identities=[${addIds}]; ${verdict(addR)}`);
    }

    // 5. X user links a second X account (manual linking ON)
    setMock({ id: "710000002", username: "LinkerOne", confirmed_email: "" });
    const lk1 = await loginWithX();
    if (loggedIn("an X user (no email) can start linking a second X account", lk1)) {
      setMock({ id: "710000003", username: "LinkerTwo", confirmed_email: "" });
      const lk = await lk1.client.linkIdentity({ provider: "x", options: { skipBrowserRedirect: true, redirectTo: CB } });
      const lkRes = lk.error ? { error: lk.error.message } : await follow(lk.data.url);
      const lkIds = await providersOf(lk1.jwt);
      const lkR = await xIdFromJwt(admin, lk1.jwt);
      check("an X user linking a second X account: the rule is applied", lkR.ok === (lkIds.length === 1 && lkIds[0].startsWith("x:")), `link outcome=${lkRes.error ?? "linked"}; identities=[${lkIds}]; ${verdict(lkR)}`);
    }
  } else {
    // hardened: the ways to acquire a non-x identity are closed at the source
    const em = await nc(keys.anon).signUp({ email: `plain-${Date.now()}@example.com`, password: "Passw0rd!123456" });
    check("email sign-up is refused", !!em.error && !em.data?.session, em.error?.message);
    const em2 = await nc(keys.anon).signInWithPassword({ email: "nobody@example.com", password: "Passw0rd!123456" });
    check("email sign-in is refused", !!em2.error && /disabled/i.test(em2.error.message), em2.error?.message);
    const an = await nc(keys.anon).signInAnonymously();
    check("anonymous sign-in is refused", !!an.error && !an.data?.session, an.error?.message);
    const ph = await nc(keys.anon).signUp({ phone: "+15555550100", password: "Passw0rd!123456" });
    check("phone sign-up is refused", !!ph.error && !ph.data?.session, ph.error?.message);

    setMock({ id: "710000001", username: "AddsEmail", confirmed_email: "" });
    const x = await loginWithX();
    if (loggedIn("an X user WITHOUT a confirmed email can sign in", x)) {
      check("an X user WITHOUT a confirmed email can sign in", true, `accepted: ${verdict(await xIdFromJwt(admin, x.jwt))}`);
      const upd = await x.client.updateUser({ email: `added-${Date.now()}@example.com` });
      const ids = await providersOf(x.jwt);
      const r = await xIdFromJwt(admin, x.jwt);
      check("an X user cannot gain an email identity (and stays accepted)", ids.length === 1 && ids[0].startsWith("x:") && r.ok, `updateUser error=${upd.error?.message ?? "none"}; identities=[${ids}]; ${verdict(r)}`);
      const lk = await x.client.linkIdentity({ provider: "x", options: { skipBrowserRedirect: true, redirectTo: CB } });
      check("manual identity linking is refused", !!lk.error, lk.error?.message);
    }
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"} (${MODE})`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("TEST ERROR:", e); process.exit(2); });
