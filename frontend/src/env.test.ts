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

  it("accepts Noah's VITE_REACT_APP_ names for every variable, and VITE_ wins when both are set", () => {
    const names = ["CHAIN_ID", "RPC_URL", "EXPLORER_URL", "ESCROW_ADDRESS", "ESCROW_DEPLOY_BLOCK", "SUPABASE_URL", "SUPABASE_ANON_KEY", "FUNCTIONS_URL", "REOWN_PROJECT_ID", "APP_ORIGIN"];
    const values: Record<string, string> = {
      CHAIN_ID: "6281971",
      RPC_URL: "https://rpc.example/",
      EXPLORER_URL: "https://explorer.example/",
      ESCROW_ADDRESS: "0x207652b0767f9f19d24b5300e2123d415167acef",
      ESCROW_DEPLOY_BLOCK: "9065839",
      SUPABASE_URL: "https://noah.supabase.co",
      SUPABASE_ANON_KEY: "sb_publishable_test",
      FUNCTIONS_URL: "https://noah.supabase.co/functions/v1",
      REOWN_PROJECT_ID: "reown-test",
      APP_ORIGIN: "https://muchtip.netlify.app",
    };
    const noah = Object.fromEntries(names.map((n) => [`VITE_REACT_APP_${n}`, values[n]]));
    const { env, errors } = parseEnv(noah);
    expect(errors).toEqual([]);
    expect(env).toEqual({
      chainId: 6281971,
      rpcUrl: "https://rpc.example/",
      explorerUrl: "https://explorer.example",
      escrowAddress: "0x207652b0767F9f19d24B5300E2123D415167aCeF",
      escrowDeployBlock: 9065839n,
      supabaseUrl: "https://noah.supabase.co",
      supabaseAnonKey: "sb_publishable_test",
      functionsUrl: "https://noah.supabase.co/functions/v1",
      reownProjectId: "reown-test",
      appOrigin: "https://muchtip.netlify.app",
    });
    // the VITE_ name (Vercel, .env.local) takes precedence over the Noah name
    expect(parseEnv({ ...noah, VITE_APP_ORIGIN: "https://muchtip.vercel.app" }).env?.appOrigin).toBe("https://muchtip.vercel.app");
    // a blank VITE_ value falls through to the Noah name
    expect(parseEnv({ VITE_SUPABASE_URL: " ", VITE_REACT_APP_SUPABASE_URL: "https://noah.supabase.co", VITE_REACT_APP_SUPABASE_ANON_KEY: "k" }).env?.supabaseUrl).toBe("https://noah.supabase.co");
    // a malformed Noah value is reported under the canonical name
    expect(parseEnv({ VITE_REACT_APP_CHAIN_ID: "abc" }).errors).toEqual(["VITE_CHAIN_ID must be a positive integer"]);
  });
});
