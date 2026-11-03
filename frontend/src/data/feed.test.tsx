// @vitest-environment jsdom
// Wiring-spec W4.2: production builds never show the demo feed. Without a backend the feed is simply unreachable (F4).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({
  ENV_ERRORS: [],
  ENV: { chainId: 6281971, rpcUrl: "https://rpc.testnet.dogeos.com/", explorerUrl: "https://blockscout.testnet.dogeos.com", escrowAddress: "0x207652b0767F9f19d24B5300E2123D415167aCeF", escrowDeployBlock: 9065839n, supabaseUrl: null, supabaseAnonKey: null, functionsUrl: null, reownProjectId: null, appOrigin: null },
}));

describe("useFeed without a backend", () => {
  it("is the labelled demo feed in development, and an error (no rows) in a production build", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

    vi.stubEnv("DEV", true);
    vi.resetModules();
    const dev = await import("./hooks");
    const d = renderHook(() => dev.useFeed("All", 25), { wrapper }).result.current;
    expect(d.kind === "ready" && d.source).toBe("demo");

    vi.stubEnv("DEV", false);
    vi.resetModules();
    const prod = await import("./hooks");
    const p = renderHook(() => prod.useFeed("All", 25), { wrapper }).result.current;
    expect(p).toMatchObject({ kind: "error", data: null });
    vi.unstubAllEnvs();
  });
});
