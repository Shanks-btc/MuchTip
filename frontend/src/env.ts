// Frontend environment (docs/design/wiring-spec.md section 1), validated once at startup.
//
// Every value here is public: Vite only exposes VITE_* variables, and they end up in the bundle. Supabase's service key,
// the claim verifier's key, the X API token and any wallet key must never be set here (scripts/secret-scan.mjs fails
// the build if one is).
//
// The chain values default to the live deployment (deployment.json; src/chain/config.test.ts fails if they drift), so a
// build without a .env.local still talks to the right contract. A value that is set but malformed is an error, shown on
// one screen instead of a blank page. The Supabase values are optional: without them the app says the backend isn't
// connected.
import { getAddress, isAddress } from "viem";

const raw = import.meta.env;

export interface Env {
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  escrowAddress: `0x${string}`;
  escrowDeployBlock: bigint;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  functionsUrl: string | null;
  reownProjectId: string | null;
  appOrigin: string | null;
}

const DEFAULTS = {
  VITE_CHAIN_ID: "6281971",
  VITE_RPC_URL: "https://rpc.testnet.dogeos.com/",
  VITE_EXPLORER_URL: "https://blockscout.testnet.dogeos.com",
  VITE_ESCROW_ADDRESS: "0x207652b0767F9f19d24B5300E2123D415167aCeF",
  VITE_ESCROW_DEPLOY_BLOCK: "9065839",
} as const;

const trimSlash = (s: string) => s.replace(/\/+$/, "");
const isHttpUrl = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

/** Pure, so it can be unit-tested with any input. Returns the parsed env or the list of problems (names only, never values). */
export function parseEnv(src: Record<string, string | boolean | undefined>): { env: Env; errors: [] } | { env: null; errors: string[] } {
  const get = (k: string) => {
    const v = src[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const errors: string[] = [];
  const req = (k: keyof typeof DEFAULTS) => get(k) ?? DEFAULTS[k];

  const chainId = Number(req("VITE_CHAIN_ID"));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) errors.push("VITE_CHAIN_ID must be a positive integer");
  const rpcUrl = req("VITE_RPC_URL");
  if (!isHttpUrl(rpcUrl)) errors.push("VITE_RPC_URL must be an http(s) URL");
  const explorerUrl = trimSlash(req("VITE_EXPLORER_URL"));
  if (!isHttpUrl(explorerUrl)) errors.push("VITE_EXPLORER_URL must be an http(s) URL");
  const escrow = req("VITE_ESCROW_ADDRESS");
  if (!isAddress(escrow, { strict: false })) errors.push("VITE_ESCROW_ADDRESS must be a 0x address");
  const block = req("VITE_ESCROW_DEPLOY_BLOCK");
  if (!/^\d{1,12}$/.test(block)) errors.push("VITE_ESCROW_DEPLOY_BLOCK must be a block number");

  const supabaseUrl = get("VITE_SUPABASE_URL");
  if (supabaseUrl && !isHttpUrl(supabaseUrl)) errors.push("VITE_SUPABASE_URL must be an http(s) URL");
  const supabaseAnonKey = get("VITE_SUPABASE_ANON_KEY");
  if (supabaseUrl && !supabaseAnonKey) errors.push("VITE_SUPABASE_ANON_KEY is required when VITE_SUPABASE_URL is set");
  const functionsUrl = get("VITE_FUNCTIONS_URL") ?? (supabaseUrl ? `${trimSlash(supabaseUrl)}/functions/v1` : null);
  if (functionsUrl && !isHttpUrl(functionsUrl)) errors.push("VITE_FUNCTIONS_URL must be an http(s) URL");
  const appOrigin = get("VITE_APP_ORIGIN");
  if (appOrigin && !isHttpUrl(appOrigin)) errors.push("VITE_APP_ORIGIN must be an http(s) origin, e.g. https://muchtip.vercel.app");

  if (errors.length) return { env: null, errors };
  return {
    env: {
      chainId,
      rpcUrl,
      explorerUrl,
      escrowAddress: getAddress(escrow),
      escrowDeployBlock: BigInt(block),
      supabaseUrl: supabaseUrl ? trimSlash(supabaseUrl) : null,
      supabaseAnonKey,
      functionsUrl: functionsUrl ? trimSlash(functionsUrl) : null,
      reownProjectId: get("VITE_REOWN_PROJECT_ID"),
      appOrigin: appOrigin ? trimSlash(appOrigin) : null,
    },
    errors: [],
  };
}

const parsed = parseEnv(raw as unknown as Record<string, string | undefined>);
/** Problems found at startup; main.tsx shows them instead of the app. */
export const ENV_ERRORS: string[] = parsed.errors;
/** The validated env. When ENV_ERRORS is non-empty this holds the defaults only so modules can load; the app never renders. */
export const ENV: Env = parsed.env ?? (parseEnv({}).env as Env);
