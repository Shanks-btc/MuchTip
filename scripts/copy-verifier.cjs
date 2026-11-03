// Finds the test verifier key in your .env files (whatever the variable is called) and copies it into
// supabase/functions/.env as VERIFIER_PRIVATE_KEY. It never prints the key, only names and the address.
// Run from the repo root:  node scripts/copy-verifier.cjs
const fs = require("fs");
const { Wallet } = require("ethers");
const TARGET = "0xB63301AF6f319f1B2B93D637B730AE9604D45b86"; // TipEscrow.verifier() on Chikyu
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").replace(/^﻿/, "") : "");

const files = fs.readdirSync(".").filter((n) => n.startsWith(".env") && n !== ".env.example");
let key = null, name = null, src = null;
for (const file of files) {
  for (const line of read(file).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*['"]?(0x)?([0-9a-fA-F]{64})/);
    if (!m) continue;
    try {
      if (new Wallet("0x" + m[3]).address.toLowerCase() === TARGET.toLowerCase()) { key = "0x" + m[3]; name = m[1]; src = file; }
    } catch {}
  }
}
console.log("Checked: " + (files.join(", ") || "no .env files in this folder"));
if (!key) { console.log("NOT FOUND: none of these files holds the key for " + TARGET); process.exit(1); }

const out = "supabase/functions/.env";
// Only ever write the key into a file git ignores, so it can't be committed by accident.
try {
  require("child_process").execFileSync("git", ["check-ignore", "-q", out]);
} catch {
  console.log("REFUSED: " + out + " is not gitignored, so the key was not written. Fix .gitignore first.");
  process.exit(1);
}
const keep = read(out).split(/\r?\n/).filter((l) => l.trim() && !/^\s*VERIFIER_PRIVATE_KEY\s*=/.test(l));
keep.push("VERIFIER_PRIVATE_KEY=" + key);
fs.writeFileSync(out, keep.join("\n") + "\n");
console.log("OK: copied " + name + " from " + src + " into " + out + " as VERIFIER_PRIVATE_KEY");
console.log("Address: " + new Wallet(key).address);
console.log("Lines now in " + out + ": " + keep.map((l) => l.split("=")[0].trim()).join(", "));
