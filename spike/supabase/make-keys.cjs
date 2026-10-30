// Writes keys.json: a random JWT secret plus HS256 JWTs for the anon and service_role roles, signed with it.
// Test-only; keys.json is gitignored.
const c = require("crypto");
const fs = require("fs");
const secret = c.randomBytes(32).toString("hex");
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role) => {
  const h = b({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const p = b({ role, iss: "supabase-test", iat: now, exp: now + 86400 });
  return `${h}.${p}.${c.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};
fs.writeFileSync(__dirname + "/keys.json", JSON.stringify({ secret, anon: jwt("anon"), service: jwt("service_role") }, null, 1));
console.log("keys.json written");
