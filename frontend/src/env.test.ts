import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("env (wiring-spec section 1)", () => {
  it("defaults to the live deployment when nothing is set", () => {
    const { env, errors } = parseEnv({});
    expect(errors).toEqual([]);
    expect(env).toMatchObject({ chainId: 6281971, escrowAddress: "0x207652b0767F9f19d24B5300E2123D415167aCeF", escrowDeployBlock: 9065839n, supabaseUrl: null, functionsUrl: null });
  });
  it("derives the functions URL from the Supabase URL and trims slashes", () => {
    const { env } = parseEnv({ VITE_SUPABASE_URL: "https://abc.supabase.co/", VITE_SUPABASE_ANON_KEY: "anon", VITE_APP_ORIGIN: "https://muchtip.vercel.app/" });
    expect(env?.functionsUrl).toBe("https://abc.supabase.co/functions/v1");
    expect(env?.appOrigin).toBe("https://muchtip.vercel.app");
  });
  it("names every malformed value, without echoing it", () => {
    const { env, errors } = parseEnv({ VITE_CHAIN_ID: "abc", VITE_ESCROW_ADDRESS: "0x123", VITE_SUPABASE_URL: "https://abc.supabase.co", VITE_RPC_URL: "ftp://x" });
    expect(env).toBeNull();
    expect(errors).toEqual([
      "VITE_CHAIN_ID must be a positive integer",
      "VITE_RPC_URL must be an http(s) URL",
      "VITE_ESCROW_ADDRESS must be a 0x address",
      "VITE_SUPABASE_ANON_KEY is required when VITE_SUPABASE_URL is set",
    ]);
    expect(errors.join(" ")).not.toContain("ftp://x");
  });
});
