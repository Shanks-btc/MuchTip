// @vitest-environment jsdom
// The Send form's handle lookup (useHandleLookup, rendered by HandleInput): only the backend's handle_not_found may
// become "No X account called @…". Every other failure (network or CORS, X unavailable, rate limits, a missing backend
// config, a demo miss) must show its own message (wiring-spec section 6).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const base = { chainId: 6281971, rpcUrl: "https://rpc.testnet.dogeos.com/", explorerUrl: "https://blockscout.testnet.dogeos.com", escrowAddress: "0x207652b0767F9f19d24B5300E2123D415167aCeF", escrowDeployBlock: 9065839n, reownProjectId: null, appOrigin: null };
const configured = { ...base, supabaseUrl: "https://t.supabase.co", supabaseAnonKey: "anon", functionsUrl: "https://t.supabase.co/functions/v1" };
const unconfigured = { ...base, supabaseUrl: null, supabaseAnonKey: null, functionsUrl: null };

const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

async function lookup(env: object, handle: string, dev = false) {
  vi.resetModules();
  vi.doMock("../env", () => ({ ENV_ERRORS: [], ENV: env }));
  vi.stubEnv("DEV", dev);
  const { useHandleLookup } = await import("./hooks");
  const { result } = renderHook(() => useHandleLookup(handle, 0), { wrapper });
  await waitFor(() => expect(["found", "missing", "error"]).toContain(result.current.kind), { timeout: 5000 });
  return result.current;
}
const respond = (status: number, body: object) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
const text = (s: Awaited<ReturnType<typeof lookup>>) => (s.kind === "missing" ? `No X account called @${s.handle}.` : s.kind === "error" ? s.message : "found");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock("../env");
});

describe("Send form lookup: 'No X account' only for handle_not_found", () => {
  it("handle_not_found is 'No X account called @…'", async () => {
    respond(404, { error: { code: "handle_not_found", message: "No X account with the handle @nobody" } });
    const s = await lookup(configured, "nobody");
    expect(s.kind).toBe("missing");
    expect(text(s)).toBe("No X account called @nobody.");
  }, 15_000);

  it.each([
    ["X unavailable", 502, "upstream_unavailable", "We can't reach X right now. Try again shortly."],
    ["our rate limit", 429, "rate_limited", "Too many lookups. Try again in a minute."],
    ["X's rate limit", 429, "upstream_rate_limited", "Too many lookups. Try again in a minute."],
  ])("%s has its own message", async (_name, status, code, message) => {
    respond(status, { error: { code, message: "server text" } });
    const s = await lookup(configured, "kirahszn");
    expect(s.kind).toBe("error");
    expect(text(s)).toBe(message);
    expect(text(s)).not.toMatch(/No X account/);
  }, 15_000);

  it("a network or CORS failure (fetch rejects) says the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const s = await lookup(configured, "kirahszn");
    expect(text(s)).toBe("Can't reach the server. Check your connection.");
  }, 15_000);

  it("a production build without the backend config says so, without calling anything", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const s = await lookup(unconfigured, "kirahszn", false);
    expect(text(s)).toBe("Handle lookups aren't available on this site yet: its backend isn't configured.");
    expect(f).not.toHaveBeenCalled();
  }, 15_000);

  it("a dev build's demo list miss is not reported as a missing X account", async () => {
    const s = await lookup(unconfigured, "kirahszn", true);
    expect(text(s)).toMatch(/isn't one of the demo accounts/);
    expect(text(s)).not.toMatch(/No X account/);
  }, 15_000);
});
