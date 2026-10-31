import { ChainError, type Chain } from "../_shared/chain.ts";
import { type ClaimSigner, signClaim } from "../_shared/eip712.ts";
import { ethers } from "../_shared/eth.ts";
import { xIdFromUser } from "../_shared/claim-gate.ts";
import { clientIp, fail, HttpError, json, type Log, preflight, readJsonBody } from "../_shared/http.ts";
import { idHashOf } from "../_shared/ids.ts";
import { enforce, ipBucket, type RateLimiter } from "../_shared/ratelimit.ts";
import type { AuthPort } from "../_shared/supabase.ts";

export interface SignClaimDeps {
  auth: AuthPort;
  rateLimit: RateLimiter;
  chain: Pick<Chain, "escrow" | "chainId" | "claimContext">;
  signer: ClaimSigner;
  /** How long a signature stays valid, counted from the latest block's timestamp. */
  ttlSeconds: number;
  ipLimit: { windowSeconds: number; limit: number };
  userLimit: { windowSeconds: number; limit: number };
  randomNonce(): bigint;
  corsOrigin: string;
  log: Log;
}

/** A 256-bit nonce from the platform CSPRNG. The contract tracks used nonces per X account, so collisions are not a concern. */
export function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return BigInt("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
}

export function parseRecipient(input: unknown, escrow: string): string {
  const bad = (msg: string) => new HttpError(400, "invalid_recipient", msg);
  if (typeof input !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(input)) throw bad("recipient must be a 0x address");
  let addr: string;
  try {
    addr = ethers.getAddress(input); // throws on a bad EIP-55 checksum in a mixed-case address
  } catch {
    throw bad("recipient has an invalid checksum");
  }
  if (addr === ethers.ZeroAddress) throw bad("recipient cannot be the zero address");
  if (addr === escrow) throw bad("recipient cannot be the escrow contract");
  return addr;
}

function bearerToken(req: Request): string {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m || m[1].length > 4096) throw new HttpError(401, "missing_token", "Sign in with X first");
  return m[1];
}

/**
 * POST /sign-claim  {"recipient":"0x…"}  with  Authorization: Bearer <Supabase session JWT>
 *
 * Signs an EIP-712 Claim(xId, recipient, nonce, expiry) with the verifier key for the X account the caller logged in
 * as, and reports what the contract currently holds for it. The caller (or anyone) then submits it to
 * TipEscrow.claim(xId, recipient, nonce, expiry, signature).
 */
export function createSignClaimHandler(d: SignClaimDeps) {
  return async (req: Request): Promise<Response> => {
    try {
      if (req.method === "OPTIONS") return preflight(d.corsOrigin);
      if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST", { allow: "POST, OPTIONS" });

      const jwt = bearerToken(req);
      await enforce(d.rateLimit, await ipBucket("sign-claim", clientIp(req)), d.ipLimit.windowSeconds, d.ipLimit.limit);
      const recipient = parseRecipient((await readJsonBody(req)).recipient, d.chain.escrow);

      // Who is this? getUser(jwt) is a network call to Supabase Auth: signature, expiry and that the user still exists.
      const { user, error } = await d.auth.getUser(jwt);
      if (!user) {
        d.log({ fn: "sign-claim", event: "bad_token", message: error });
        throw new HttpError(401, "invalid_token", "Your session is invalid or has expired, sign in with X again");
      }
      const gate = xIdFromUser(user);
      if (!gate.ok) {
        d.log({ fn: "sign-claim", event: "identity_rejected", reason: gate.reason });
        throw new HttpError(403, "identity_not_allowed", `This account cannot claim tips (${gate.reason}). Sign in with X only.`);
      }
      await enforce(d.rateLimit, `sign-claim:x:${gate.xId}`, d.userLimit.windowSeconds, d.userLimit.limit);

      let ctx;
      try {
        ctx = await d.chain.claimContext(idHashOf(gate.xId));
      } catch (e) {
        if (!(e instanceof ChainError)) throw e;
        d.log({ fn: "sign-claim", event: "chain_error", message: e.message });
        throw new HttpError(503, "chain_unavailable", "Could not read the chain, try again shortly", { "retry-after": "10" });
      }
      if (ctx.chainId !== d.chain.chainId) {
        d.log({ fn: "sign-claim", event: "wrong_chain", expected: String(d.chain.chainId), got: String(ctx.chainId) });
        throw new HttpError(503, "wrong_chain", "The configured RPC is on a different chain");
      }
      if (ctx.verifier !== d.signer.address) {
        // A signature from a key the contract does not trust would only fail on-chain, after the user paid a fee.
        d.log({ fn: "sign-claim", event: "verifier_mismatch", contractVerifier: ctx.verifier, signer: d.signer.address });
        throw new HttpError(503, "verifier_mismatch", "Claims are temporarily unavailable");
      }

      const msg = { xId: gate.xId, recipient, nonce: d.randomNonce(), expiry: ctx.chainTime + BigInt(d.ttlSeconds) };
      const { signature, digest } = await signClaim(d.signer, d.chain.chainId, d.chain.escrow, msg);
      d.log({ fn: "sign-claim", event: "signed", xId: String(gate.xId), unclaimedWei: String(ctx.unclaimed) });
      return json(200, {
        xId: String(msg.xId),
        handle: gate.username,
        recipient,
        nonce: String(msg.nonce),
        expiry: String(msg.expiry),
        signature,
        digest,
        contract: d.chain.escrow,
        chainId: Number(d.chain.chainId),
        unclaimedWei: String(ctx.unclaimed),
        claimable: ctx.unclaimed > 0n,
      }, d.corsOrigin);
    } catch (e) {
      return fail(e, d.corsOrigin, d.log);
    }
  };
}
