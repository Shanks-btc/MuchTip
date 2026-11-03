import { describe, expect, it } from "vitest";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, parseEther, UserRejectedRequestError } from "viem";
import deploymentRaw from "../../../deployment.json?raw";
import artifactRaw from "../../../out/TipEscrow.sol/TipEscrow.json?raw";
import { ApiError, apiErrorMessage, idHashOf, normalizeHandle } from "../data/api";
import { escrowAbi } from "./abi";
import { CHAIN_ID, ESCROW_ADDRESS, ESCROW_DEPLOY_BLOCK } from "./config";
import { tipStatusOf, withStatus } from "./hooks";
import { describeTxError, revertMessage } from "./errors";
import { affordableTip, buffered, coversTip, FALLBACK_CEILING, quoteFee } from "./fees";

describe("config is read from the repo, not guessed", () => {
  const deployment = JSON.parse(deploymentRaw) as { chainId: number; contract: string; deployBlock: number };
  it("matches deployment.json", () => {
    expect(CHAIN_ID).toBe(deployment.chainId);
    expect(ESCROW_ADDRESS).toBe(deployment.contract);
    expect(ESCROW_DEPLOY_BLOCK).toBe(BigInt(deployment.deployBlock));
  });
  it("the ABI is the forge artifact's", () => {
    const artifact = JSON.parse(artifactRaw) as { abi: { type: string }[] };
    expect(JSON.parse(JSON.stringify(escrowAbi))).toEqual(artifact.abi.filter((x) => x.type !== "constructor"));
  });
  it("idHash is keccak256(abi.encode(uint256 xId)), the backend's documented value", () => {
    expect(idHashOf("2244994945")).toBe("0x9459c13b5c21e1f0cc54307300f50fe36658555fa2b2355575aa4d05c6f21914");
  });
});

describe("fees (FEES.md 5)", () => {
  it("buffers the estimate by 1.5x", () => {
    expect(buffered(parseEther("0.02"))).toBe(parseEther("0.03"));
  });
  it("falls back to the fixed ceilings when the oracle can't be read", async () => {
    const broken = { estimateFeesPerGas: () => Promise.reject(new Error("rpc down")) } as never;
    expect(await quoteFee(broken, "tip")).toEqual({ aboutWei: null, upToWei: FALLBACK_CEILING.tip, source: "fallback" });
    expect(FALLBACK_CEILING).toEqual({ tip: parseEther("0.35"), claim: parseEther("0.85"), refund: parseEther("0.30") });
  });
});

describe("transaction errors", () => {
  it("maps a wallet rejection", () => {
    const e = new UserRejectedRequestError(new Error("User rejected the request."));
    expect(describeTxError(e).kind).toBe("rejected");
    expect(describeTxError(e).title).toBe("You cancelled in your wallet.");
    expect(describeTxError({ code: 4001 }).kind).toBe("rejected");
  });
  it("maps a BelowMinTip revert with the chain's minimum", () => {
    const data = encodeErrorResult({ abi: escrowAbi, errorName: "BelowMinTip" });
    const revert = new ContractFunctionRevertedError({ abi: escrowAbi, data, functionName: "tip" });
    const wrapped = new BaseError("call failed", { cause: revert });
    const d = describeTxError(wrapped, { min: "5 DOGE" });
    expect(d).toMatchObject({ kind: "revert", revert: "BelowMinTip" });
    expect(d.detail).toBe("The minimum tip is 5 DOGE.");
  });
  it("uses the spec's copy (section 6) for every custom error", () => {
    const copy = {
      ZeroValue: "Enter an amount.",
      NothingToClaim: "There's nothing to claim right now.",
      Expired: "That claim took too long. Try again.",
      NonceUsed: "This claim can't be used. Try again.",
      BadSignature: "This claim can't be used. Try again.",
      TooEarly: "You can refund this tip at 14:32.",
      AlreadyClaimed: "They already claimed this tip.",
      AlreadyRefunded: "You already got this tip back.",
      NotTipper: "Only the person who sent this tip can refund it.",
      UnknownTip: "Only the person who sent this tip can refund it.",
    };
    for (const [name, text] of Object.entries(copy)) expect(revertMessage(name, { when: "14:32" })).toBe(text);
  });
  it("maps insufficient funds", () => {
    expect(describeTxError(new BaseError("insufficient funds for gas * price + value")).detail).toBe("Not enough DOGE to cover the tip and the network fee.");
  });
});

describe("balance gate (W2.6)", () => {
  const e = parseEther;
  it("needs amount + high", () => {
    expect(coversTip(e("25.03"), e("25"), e("0.03"))).toBe(true);
    expect(coversTip(e("25.029"), e("25"), e("0.03"))).toBe(false);
  });
  it("offers 'Tip N DOGE instead' rounded down, only at or above the minimum", () => {
    expect(affordableTip(e("20"), e("0.03"), e("5"))).toBe(19n);
    expect(affordableTip(e("5.04"), e("0.03"), e("5"))).toBe(5n);
    expect(affordableTip(e("5.02"), e("0.03"), e("5"))).toBeNull();
    expect(affordableTip(e("0.01"), e("0.03"), e("5"))).toBeNull();
  });
});

describe("backend errors and handles (section 6, W2.2)", () => {
  it("maps every documented code", () => {
    const m = (code: string, path = "resolve") => apiErrorMessage(new ApiError(400, code, "server text", path), { handle: "nobody" });
    expect(m("handle_not_found")).toBe("No X account called @nobody.");
    expect(m("invalid_handle")).toBe("Handles are 1 to 15 letters, numbers or underscores.");
    expect(m("rate_limited")).toBe("Too many lookups. Try again in a minute.");
    expect(m("upstream_rate_limited")).toBe("Too many lookups. Try again in a minute.");
    expect(m("upstream_unavailable")).toBe("We can't reach X right now. Try again shortly.");
    expect(m("invalid_token", "sign-claim")).toBe("Your X sign-in expired. Sign in again.");
    expect(m("missing_token", "sign-claim")).toBe("Your X sign-in expired. Sign in again.");
    expect(m("identity_not_allowed", "sign-claim")).toBe("This account is linked to something other than X. Sign out and sign in with X only.");
    expect(m("rate_limited", "sign-claim")).toBe("Too many claim attempts. Try again in a few minutes.");
    for (const c of ["chain_unavailable", "wrong_chain", "verifier_mismatch"]) expect(m(c, "sign-claim")).toBe("Claiming is unavailable right now. Your tips are safe in the contract.");
    expect(apiErrorMessage(new TypeError("Failed to fetch"))).toBe("Can't reach the server. Check your connection.");
  });
  it("turns a pasted profile URL into its handle, and nothing else", () => {
    expect(normalizeHandle("@XDevelopers")).toBe("XDevelopers");
    expect(normalizeHandle("https://x.com/XDevelopers")).toBe("XDevelopers");
    expect(normalizeHandle("x.com/jack?s=20")).toBe("jack");
    expect(normalizeHandle("https://twitter.com/Doge_Fan_42/status/1")).toBe("Doge_Fan_42");
    expect(normalizeHandle("https://evil.com/x.com/jack")).toBe("https://evil.com/x.com/jack");
  });
});

describe("indexed tips + on-chain status (W3.3, W4.1)", () => {
  const row = (tipId: bigint) => ({ tipId, idHash: "0x9459c13b5c21e1f0cc54307300f50fe36658555fa2b2355575aa4d05c6f21914" as const, tipper: "0x1BE5DB49a70d633c6e6AF7900598118Fb65419AE" as const, amountWei: parseEther("5"), txHash: "0x01" as const, time: 1000, blockNumber: 1 });
  it("maps tipStatus 1/2/3 and drops None", () => {
    expect([0, 1, 2, 3].map((n) => tipStatusOf(n))).toEqual([null, "Pending", "Claimed", "Refunded"]);
    const out = withStatus([row(1n), row(2n), row(3n)], [1, 1600n, 0, 0n, 2, 1700n]);
    expect(out?.map((t) => [t.id, t.status, t.refundableAt])).toEqual([[1n, "Pending", 1600], [3n, "Claimed", 1700]]);
  });
  it("is undefined while statuses load, and empty for no rows", () => {
    expect(withStatus([row(1n)], undefined)).toBeUndefined();
    expect(withStatus([], undefined)).toEqual([]);
  });
});
