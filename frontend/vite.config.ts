import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * "Public source, N tests" on the landing page (wiring-spec W4.3: no figure without a live source): N is counted from the
 * contract's Foundry test files at build time (functions named test* or invariant*). null if they aren't there, and the
 * page then leaves the number out.
 */
function contractTestCount(): number | null {
  const dir = fileURLToPath(new URL("../test", import.meta.url));
  try {
    const n = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".t.sol"))
      .reduce((sum, f) => sum + (fs.readFileSync(path.join(dir, f), "utf8").match(/^\s*function (test|invariant)\w*\s*\(/gm)?.length ?? 0), 0);
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __CONTRACT_TEST_COUNT__: JSON.stringify(contractTestCount()) },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
