import { encodeFunctionData, parseEther, type Address, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { escrowAbi, oracleAbi } from "./abi";
import { CHAIN_ID, ESCROW_ADDRESS, L1_GAS_ORACLE } from "./config";
import { QUOTE_SAMPLE } from "../data/samples";

// Network fee quotes, exactly as FEES.md section 5 prescribes:
//  1. build the transaction, sign a copy with a throwaway key and ask the DogeOS oracle for getL1Fee (a dummy-signed copy
//     quotes within 0.3% of the real one), add gasLimit x maxFeePerGas (negligible): that is the estimate;
//  2. show a range: "about <estimate>, up to <high>" with high = estimate x 1.5 (covers the largest 30 s rise seen, +33.6%);
//  3. if the oracle call fails, fall back to the generous fixed ceilings of section 5.5.
export type FeeAction = "tip" | "claim" | "refund";

/** Gas limits used only to build the quote (gasUsed measured in FEES.md 2b: tip 136,466, claim 118,752, refund 44,461). */
const QUOTE_GAS: Record<FeeAction, bigint> = { tip: 140_000n, claim: 125_000n, refund: 50_000n };
/** FEES.md 5.5: used when the oracle cannot be read. Shown as "up to". */
export const FALLBACK_CEILING: Record<FeeAction, bigint> = { tip: parseEther("0.35"), claim: parseEther("0.85"), refund: parseEther("0.30") };

export interface FeeQuote {
  /** The oracle estimate in wei, or null when the fallback ceiling is used. */
  aboutWei: bigint | null;
  /** The buffered upper bound: estimate x 1.5, or the fallback ceiling. Balance checks use this. */
  upToWei: bigint;
  source: "oracle" | "fallback";
}

export const buffered = (estimate: bigint) => (estimate * 3n) / 2n;

/** Representative calldata for each action (the L1 fee depends on the transaction's size, not on the exact values). */
function sampleCall(action: FeeAction): { data: Hex; value: bigint } {
  if (action === "tip") return { data: encodeFunctionData({ abi: escrowAbi, functionName: "tip", args: [QUOTE_SAMPLE.idHash] }), value: parseEther(QUOTE_SAMPLE.tipDoge) };
  if (action === "refund") return { data: encodeFunctionData({ abi: escrowAbi, functionName: "refund", args: [1n] }), value: 0n };
  return {
    data: encodeFunctionData({
      abi: escrowAbi,
      functionName: "claim",
      args: [QUOTE_SAMPLE.claim.xId, QUOTE_SAMPLE.claim.recipient, QUOTE_SAMPLE.claim.nonce, QUOTE_SAMPLE.claim.expiry, QUOTE_SAMPLE.claim.signature],
    }),
    value: 0n,
  };
}

/**
 * Quote the network fee for a call. With `from` (the connected wallet) the quoted transaction is the real one: its
 * nonce and an estimateGas for that sender (falling back to the measured gas when estimation fails, e.g. the wallet
 * can't afford the value yet). Without `from`, nonce 0 and the measured gas: the L1 fee depends on the transaction's
 * size, which those barely change.
 */
export async function quoteFee(client: PublicClient, action: FeeAction, call?: { data: Hex; value: bigint }, from?: Address): Promise<FeeQuote> {
  try {
    const { data, value } = call ?? sampleCall(action);
    const [fees, nonce, gas] = await Promise.all([
      client.estimateFeesPerGas(),
      from ? client.getTransactionCount({ address: from, blockTag: "pending" }) : Promise.resolve(0),
      from ? client.estimateGas({ account: from, to: ESCROW_ADDRESS, data, value }).catch(() => QUOTE_GAS[action]) : Promise.resolve(QUOTE_GAS[action]),
    ]);
    const throwaway = privateKeyToAccount(generatePrivateKey()); // never stored, never funded
    const signed = await throwaway.signTransaction({
      chainId: CHAIN_ID,
      type: "eip1559",
      to: ESCROW_ADDRESS,
      data,
      value,
      gas,
      nonce,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    const l1 = await client.readContract({ address: L1_GAS_ORACLE, abi: oracleAbi, functionName: "getL1Fee", args: [signed] });
    const estimate = l1 + gas * fees.maxFeePerGas;
    return { aboutWei: estimate, upToWei: buffered(estimate), source: "oracle" };
  } catch {
    return { aboutWei: null, upToWei: FALLBACK_CEILING[action], source: "fallback" };
  }
}

/** Wiring-spec W2.6: the tip may go ahead only if the balance covers the amount plus the buffered fee. */
export const coversTip = (balanceWei: bigint, amountWei: bigint, feeHighWei: bigint) => balanceWei >= amountWei + feeHighWei;

/**
 * "Tip N DOGE instead": N = balance - feeHigh, rounded down to whole DOGE, offered only if it is at least the minimum
 * tip. Returns N in whole DOGE, or null.
 */
export function affordableTip(balanceWei: bigint, feeHighWei: bigint, minTipWei: bigint): bigint | null {
  if (balanceWei <= feeHighWei) return null;
  const whole = (balanceWei - feeHighWei) / 10n ** 18n;
  return whole * 10n ** 18n >= minTipWei && whole > 0n ? whole : null;
}

/** How often to refresh a quote while a form is open (FEES.md 5.2, wiring-spec W2.4: every 15 s). */
export const FEE_REFRESH_MS = 15_000;
