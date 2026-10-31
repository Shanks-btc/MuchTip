import { ethers } from "./eth.ts";
import { HttpError } from "./http.ts";

/** Anything with `get(name)`: Deno.env in production, a Map in tests. */
export interface Env {
  get(name: string): string | undefined;
}

export const DEFAULT_RPC_URL = "https://rpc.testnet.dogeos.com/";
export const DEFAULT_CHAIN_ID = 6281971n;

export function required(env: Env, name: string): string {
  const v = env.get(name);
  if (!v) throw new HttpError(500, "misconfigured", `Server is missing ${name}`);
  return v;
}

export function intEnv(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env.get(name);
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(500, "misconfigured", `${name} must be an integer in [${min}, ${max}]`);
  }
  return n;
}

export interface ChainConfig {
  rpcUrl: string;
  chainId: bigint;
  /** EIP-55 checksummed. There is deliberately no default: signing for the wrong contract must be impossible. */
  escrow: string;
}

export function chainConfig(env: Env): ChainConfig {
  let escrow: string;
  try {
    escrow = ethers.getAddress(required(env, "ESCROW_ADDRESS"));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(500, "misconfigured", "ESCROW_ADDRESS is not a valid address");
  }
  return {
    rpcUrl: env.get("RPC_URL") || DEFAULT_RPC_URL,
    chainId: BigInt(env.get("CHAIN_ID") || DEFAULT_CHAIN_ID),
    escrow,
  };
}

export interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

/**
 * `SERVICE_ROLE_KEY` is a secret you set yourself; `SUPABASE_SERVICE_ROLE_KEY` is what hosted/local Supabase injects.
 * (Newer hosted projects may expose the key under a different name; see docs/backend.md, "UNVERIFIED".)
 */
export function supabaseConfig(env: Env): SupabaseConfig {
  return {
    url: required(env, "SUPABASE_URL"),
    serviceKey: env.get("SERVICE_ROLE_KEY") || required(env, "SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export const denoEnv: Env = { get: (name) => Deno.env.get(name) };
