// Drives a real supabase/auth (GoTrue v2.197.0) server through a full "Sign in with X" flow (X itself is mocked
// by mock-x.cjs) and checks: (b) what a signed-in user can/can't change about auth.identities, and
// (c) the Edge Function pattern: auth.getUser(jwt) with the service key -> identities[provider 'x'].id.
const { AuthClient } = require("@supabase/supabase-js");
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const keys = require("./keys.json");

const URL_ = "http://localhost:9999";
const out = (s = "") => console.log(s);
const hr = (t) => out(`\n=== ${t}`);
const newClient = (key) =>
  new AuthClient({ url: URL_, headers: { apikey: key, Authorization: `Bearer ${key}` }, autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "implicit" });
const admin = newClient(keys.service); // what the Edge Function would hold (SUPABASE_SERVICE_ROLE_KEY)
const psql = (sql) =>
  execFileSync("docker", ["exec", "sb-db", "psql", "-U", "supabase_admin", "-h", "localhost", "-d", "postgres", "-tA", "-F", " | ", "-c", sql], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
const setMock = (o) => fetch("http://localhost:4010/__set", { method: "POST", body: JSON.stringify(o) });
const idRows = () => psql("select provider, provider_id, identity_data->>'user_name' as user_name, identity_data->>'sub' as sub, identity_data->>'preferred_username' as pu, updated_at from auth.identities order by created_at");

async function loginWithX() {
  const c = newClient(keys.anon);
  const { data, error } = await c.signInWithOAuth({ provider: "x", options: { skipBrowserRedirect: true, redirectTo: "http://localhost:3000/cb" } });
  if (error) throw new Error("signInWithOAuth: " + error.message);
  let url = data.url;
  for (let i = 0; i < 8; i++) {
    url = url.replace("host.docker.internal", "localhost");
    const r = await fetch(url, { redirect: "manual" });
    const loc = r.headers.get("location");
    if (!loc) throw new Error(`no redirect from ${url}: ${r.status} ${await r.text()}`);
    if (loc.startsWith("http://localhost:3000/cb")) {
      const p = new URLSearchParams(loc.split("#")[1] || loc.split("?")[1] || "");
      if (p.get("error")) throw new Error(`oauth error: ${p.get("error_description")}`);
      const { error: e2 } = await c.setSession({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token") });
      if (e2) throw e2;
      return { c, jwt: p.get("access_token") };
    }
    url = new URL(loc, url).toString();
  }
  throw new Error("too many redirects");
}

// The Edge Function pattern under test.
async function xIdFromJwt(jwt) {
  const { data, error } = await admin.getUser(jwt);
  if (error || !data?.user) return { ok: false, reason: error?.message || "no user" };
  const xs = (data.user.identities || []).filter((i) => i.provider === "x");
  if (xs.length !== 1) return { ok: false, reason: `expected exactly 1 'x' identity, found ${xs.length} (providers: ${(data.user.identities || []).map((i) => i.provider).join(",") || "none"})` };
  if (!/^\d{1,20}$/.test(xs[0].id)) return { ok: false, reason: `non-numeric identity id ${xs[0].id}` };
  return { ok: true, xId: BigInt(xs[0].id), username: xs[0].identity_data?.user_name, userId: data.user.id };
}
const show = (label, v) => out(`${label.padEnd(46)} ${typeof v === "string" ? v : JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x.toString() : x))}`);

(async () => {
  hr("0. clean slate");
  show("identities before", psql("select count(*) from auth.identities"));

  hr("1. Sign in with X (full OAuth flow vs real GoTrue, mock X)");
  const { c: user, jwt } = await loginWithX();
  const { data: me } = await user.getUser();
  show("user.app_metadata", me.user.app_metadata);
  show("user.user_metadata keys", Object.keys(me.user.user_metadata));
  show("user_metadata.user_name / preferred_username", `${me.user.user_metadata.user_name} / ${me.user.user_metadata.preferred_username}`);
  show("user_metadata.sub / provider_id", `${me.user.user_metadata.sub} / ${me.user.user_metadata.provider_id}`);
  const ident = me.user.identities[0];
  show("identities[0] keys", Object.keys(ident));
  show("identities[0].provider / .id", `${ident.provider} / ${ident.id}   (identity_id=${ident.identity_id})`);
  show("identities[0].identity_data", ident.identity_data);
  show("DB auth.identities", idRows());

  hr("2. Edge Function pattern: admin.getUser(jwt) -> identities[x].id");
  show("valid JWT", await xIdFromJwt(jwt));
  const [h, p, s] = jwt.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  const tamper = Buffer.from(JSON.stringify({ ...payload, sub: crypto.randomUUID() })).toString("base64url");
  show("tampered payload (sub swapped)", await xIdFromJwt(`${h}.${tamper}.${s}`));
  const sign = (pl, secret) => { const hh = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), pp = Buffer.from(JSON.stringify(pl)).toString("base64url"); return `${hh}.${pp}.${crypto.createHmac("sha256", secret).update(`${hh}.${pp}`).digest("base64url")}`; };
  show("forged JWT, wrong secret", await xIdFromJwt(sign(payload, "not-the-secret")));
  show("expired JWT, right secret", await xIdFromJwt(sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 60 }, keys.secret)));
  show("anon key (no user)", await xIdFromJwt(keys.anon));
  show("garbage string", await xIdFromJwt("not.a.jwt"));
  const viaAnon = await newClient(keys.anon).getUser(jwt);
  show("getUser(jwt) with anon-key client also works", String(!!viaAnon.data?.user));
  const before = idRows();

  hr("3. Can the signed-in user alter their identity? (ground truth = DB rows)");
  const spoof = { user_name: "victim", preferred_username: "victim", sub: "999", provider_id: "999", id: "999" };
  const r1 = await user.updateUser({ data: spoof });
  show("updateUser({data: spoof}) error", r1.error?.message ?? "none");
  show("  -> user_metadata afterwards", { user_name: r1.data?.user?.user_metadata.user_name, sub: r1.data?.user?.user_metadata.sub });
  show("  -> identities[0].id / identity_data.user_name", `${r1.data?.user?.identities[0].id} / ${r1.data?.user?.identities[0].identity_data.user_name}`);
  show("  -> Edge pattern now says", await xIdFromJwt(jwt));
  show("  -> DB identities unchanged?", String(idRows() === before));

  const put = (body, tok = jwt) => fetch(`${URL_}/user`, { method: "PUT", headers: { "content-type": "application/json", apikey: keys.anon, Authorization: `Bearer ${tok}` }, body: JSON.stringify(body) });
  let r = await put({ identities: [{ provider: "x", id: "999", identity_data: { user_name: "victim", sub: "999" } }] });
  show("PUT /user {identities:[…]} ", `${r.status} ${(await r.text()).slice(0, 110)}`);
  show("  -> DB identities unchanged?", String(idRows() === before));
  r = await put({ app_metadata: { provider: "x", providers: ["x"] } });
  show("PUT /user {app_metadata:…} (non-admin)", `${r.status} ${(await r.text()).slice(0, 110)}`);
  show("  -> DB identities unchanged?", String(idRows() === before));

  const iid = ident.identity_id;
  for (const m of ["PUT", "PATCH", "POST"]) {
    r = await fetch(`${URL_}/user/identities/${iid}`, { method: m, headers: { "content-type": "application/json", apikey: keys.anon, Authorization: `Bearer ${jwt}` }, body: JSON.stringify({ identity_data: { user_name: "victim" } }) });
    show(`${m} /user/identities/{id}`, `${r.status} ${(await r.text()).slice(0, 70)}`);
  }
  r = await fetch(`${URL_}/user/identities/${iid}`, { method: "DELETE", headers: { apikey: keys.anon, Authorization: `Bearer ${jwt}` } });
  show("DELETE /user/identities/{id} (only identity)", `${r.status} ${(await r.text()).slice(0, 110)}`);
  show("  -> DB identities unchanged?", String(idRows() === before));

  const lr = await user.linkIdentity({ provider: "x", options: { skipBrowserRedirect: true } });
  show("linkIdentity({provider:'x'}) (manual linking, default cfg)", lr.error ? `error: ${lr.error.message}` : `allowed -> ${lr.data.url.slice(0, 60)}…`);

  hr("4. Rename on X (same numeric id, new handle) then log in again");
  await setMock({ username: "NewHandle_99" });
  const { c: user2, jwt: jwt2 } = await loginWithX();
  show("Edge pattern after rename", await xIdFromJwt(jwt2));
  show("DB auth.identities", idRows());
  show("auth.users count (same account reused?)", psql("select count(*) from auth.users"));
  const { data: me2 } = await user2.getUser();
  show("user_metadata.user_name after re-login (spoof gone?)", me2.user.user_metadata.user_name);

  hr("5. Non-X users must not pass the Edge check");
  const email = `attacker-${Date.now()}@example.com`;
  const su = await newClient(keys.anon).signUp({ email, password: "Passw0rd!123456" });
  show("email signUp (autoconfirm on in this test stack)", su.error?.message ?? `ok user ${su.data.user?.id}`);
  if (su.data?.session) {
    show("Edge pattern for email user", await xIdFromJwt(su.data.session.access_token));
    const spoofed = await newClient(keys.anon);
    await spoofed.setSession({ access_token: su.data.session.access_token, refresh_token: su.data.session.refresh_token });
    await spoofed.updateUser({ data: { ...spoof, provider: "x" } });
    show("email user spoofs user_metadata to look like X", (await xIdFromJwt(su.data.session.access_token)));
  }

  hr("6. Pre-registration: attacker signs up with the victim's X email first, victim then logs in with X");
  await setMock({ id: "555000111", username: "Victim_Real", confirmed_email: "victim@example.com" });
  const pre = await newClient(keys.anon).signUp({ email: "victim@example.com", password: "Passw0rd!123456" });
  show("attacker signUp victim@example.com", pre.error?.message ?? "ok");
  await loginWithX();
  show("auth.users with that email", psql("select count(*) from auth.users where email='victim@example.com'"));
  const atk = await newClient(keys.anon).signInWithPassword({ email: "victim@example.com", password: "Passw0rd!123456" });
  show("attacker signs in with password", atk.error?.message ?? "ok");
  if (atk.data?.session) show("Edge pattern for attacker's JWT", await xIdFromJwt(atk.data.session.access_token));
  show("identities for that user", psql("select i.provider, i.provider_id from auth.identities i join auth.users u on u.id=i.user_id where u.email='victim@example.com' order by i.created_at"));
  show("final auth.identities", idRows());
})().catch((e) => { console.error("TEST ERROR:", e); process.exit(1); });
