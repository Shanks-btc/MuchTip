// sign-claim: signs an EIP-712 Claim for the X account the caller is logged in as. See docs/backend.md.
import { serveLazy } from "../_shared/boot.ts";
import { createChain } from "../_shared/chain.ts";
import { chainConfig, denoEnv, intEnv, required, supabaseConfig } from "../_shared/env.ts";
import { ethers } from "../_shared/eth.ts";
import { HttpError, logJson } from "../_shared/http.ts";
import { authFrom, createServiceClient, rateLimiterFrom } from "../_shared/supabase.ts";
import { createSignClaimHandler, randomNonce } from "./handler.ts";

serveLazy(() => {
  const env = denoEnv;
  const cfg = chainConfig(env);
  let signer: ethers.Wallet;
  try {
    signer = new ethers.Wallet(required(env, "VERIFIER_PRIVATE_KEY"));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(500, "misconfigured", "VERIFIER_PRIVATE_KEY is not a valid private key"); // never echo the value
  }
  const client = createServiceClient(supabaseConfig(env));
  return createSignClaimHandler({
    auth: authFrom(client),
    rateLimit: rateLimiterFrom(client),
    chain: createChain(cfg),
    signer,
    ttlSeconds: intEnv(env, "CLAIM_TTL_SECONDS", 300, 30, 3600),
    ipLimit: { windowSeconds: 600, limit: intEnv(env, "SIGN_CLAIM_IP_PER_10MIN", 60, 1, 10_000) },
    userLimit: { windowSeconds: 600, limit: intEnv(env, "SIGN_CLAIM_USER_PER_10MIN", 10, 1, 1_000) },
    randomNonce,
    corsOrigin: env.get("CORS_ALLOW_ORIGIN") || "*",
    log: logJson,
  });
});
