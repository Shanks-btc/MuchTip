// Secret scan (wiring-spec section 1): fails if a backend secret could reach the browser.
//
//   node scripts/secret-scan.mjs          scan src/, index.html, public/, .env.example, the env files' keys, dist/ if built
//
// Three checks, all printing names and file:line only, never a value:
//  1. Forbidden names: the service-role key, the verifier key, the X bearer token or any *private key* name, in source,
//     in the built bundle, or as a key in any frontend env file.
//  2. 64-hex strings (a private key is one): every 0x + 64 hex (or bare 64 hex) in src/ and dist/ must be listed in
//     scripts/secret-scan-allow.txt with the reason it is public (tx hashes, id hashes, library curve constants).
//  3. Env values: no VITE_* value in the env files for development or production may look like a private key, since
//     Vite would put it in the bundle.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Built from parts so this file doesn't trip its own check.
const FORBIDDEN = new RegExp(["SERVICE" + "_ROLE", "VERIFIER" + "_PRIVATE", "X_BEARER" + "_TOKEN", "PRIVATE" + "_KEY", "DEPLOYER" + "_KEY"].join("|"), "i");
const HEX64 = /(?<![0-9a-fA-Fx])(?:0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])/g;

const allow = new Set(
  fs
    .readFileSync(path.join(ROOT, "scripts/secret-scan-allow.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((v) => /^0x[0-9a-f]{64}$/i.test(v ?? ""))
    .map((v) => v.slice(2).toLowerCase()),
);

function* files(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(tsx?|jsx?|mjs|cjs|html|css|json|txt|svg|map|example)$/.test(e.name) || e.name.startsWith(".env.example")) yield p;
  }
}

const problems = [];
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

const targets = [
  ...files(path.join(ROOT, "src")),
  ...files(path.join(ROOT, "public")),
  ...files(path.join(ROOT, "dist")),
  path.join(ROOT, "index.html"),
  path.join(ROOT, ".env.example"),
].filter((p) => fs.existsSync(p));

for (const file of targets) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const where = `${rel(file)}:${i + 1}`;
    const name = line.match(FORBIDDEN);
    if (name) problems.push(`${where}: forbidden name ${name[0]}`);
    for (const m of line.matchAll(HEX64)) {
      if (!allow.has(m[1].toLowerCase())) problems.push(`${where}: 64-hex string ${m[1].slice(0, 6)}… is not in scripts/secret-scan-allow.txt`);
    }
  });
}

// Env files: keys for every mode (loadEnv with an empty prefix returns all keys), values for VITE_* only.
for (const mode of ["development", "production"]) {
  const env = loadEnv(mode, ROOT, "");
  const fromFiles = Object.keys(env).filter((k) => !(k in process.env) || k.startsWith("VITE_"));
  for (const k of fromFiles) {
    if (FORBIDDEN.test(k)) problems.push(`env (${mode}): forbidden variable name ${k} in a frontend env file`);
    if (k.startsWith("VITE_") && /^(0x)?[0-9a-fA-F]{64}$/.test(String(env[k]).trim())) problems.push(`env (${mode}): ${k} looks like a private key`);
  }
}

if (problems.length) {
  console.error(`secret-scan: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`secret-scan: ok (${targets.length} files${fs.existsSync(path.join(ROOT, "dist")) ? ", dist included" : ", no dist yet"})`);
