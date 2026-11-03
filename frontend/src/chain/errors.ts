import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError } from "viem";

export type TxErrorKind = "rejected" | "revert" | "funds" | "rpc" | "unknown";
export interface TxError {
  kind: TxErrorKind;
  /** The contract's custom error name for a revert, e.g. "BelowMinTip". */
  revert?: string;
  title: string;
  detail: string;
}

/** Values the copy fills in: the chain's minimum ("5 DOGE") and, for TooEarly, when the refund opens ("14:32"). */
export interface ErrorContext {
  min?: string;
  when?: string;
}

// Wiring-spec section 6: the exact copy for every TipEscrow custom error (src/TipEscrow.sol).
const REVERTS: Record<string, (ctx: ErrorContext) => string> = {
  BelowMinTip: ({ min }) => (min ? `The minimum tip is ${min}.` : "This amount is below the contract's minimum tip."),
  ZeroValue: () => "Enter an amount.",
  NothingToClaim: () => "There's nothing to claim right now.",
  Expired: () => "That claim took too long. Try again.",
  NonceUsed: () => "This claim can't be used. Try again.",
  BadSignature: () => "This claim can't be used. Try again.",
  TooEarly: ({ when }) => (when ? `You can refund this tip at ${when}.` : "This tip can't be refunded yet."),
  AlreadyClaimed: () => "They already claimed this tip.",
  AlreadyRefunded: () => "You already got this tip back.",
  NotTipper: () => "Only the person who sent this tip can refund it.",
  UnknownTip: () => "Only the person who sent this tip can refund it.",
  ZeroAddress: () => "The wallet address is missing.",
  TransferFailed: () => "The contract couldn't send DOGE to that wallet.",
};

export const CANCELLED = "You cancelled in your wallet.";
export const NOT_ENOUGH = "Not enough DOGE to cover the tip and the network fee.";
export const OFFLINE = "Can't reach the server. Check your connection.";

/** The copy for a contract revert by its custom error name, or null for an unknown name. */
export const revertMessage = (name: string, ctx: ErrorContext = {}) => REVERTS[name]?.(ctx) ?? null;

/** Turns any wagmi/viem error into what the UI shows. Never leaks raw RPC text as the headline. */
export function describeTxError(err: unknown, ctx: ErrorContext = {}): TxError {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError) || /rejected|denied/i.test(err.shortMessage) || (err.walk() as { code?: number }).code === 4001)
      return { kind: "rejected", title: CANCELLED, detail: "Nothing was sent." };
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name) return { kind: "revert", revert: name, title: "The contract refused it", detail: revertMessage(name, ctx) ?? "The contract refused the transaction." };
      return { kind: "revert", title: "The contract refused it", detail: revert.shortMessage };
    }
    if (err.walk((e) => e instanceof InsufficientFundsError) || /insufficient funds/i.test(err.message))
      return { kind: "funds", title: "Not enough DOGE", detail: NOT_ENOUGH };
    if (/fetch|network|timeout|HTTP request failed|could not be found|rpc/i.test(err.message))
      return { kind: "rpc", title: "The network didn't respond", detail: OFFLINE };
    return { kind: "unknown", title: "Something went wrong", detail: err.shortMessage };
  }
  if ((err as { code?: number } | null)?.code === 4001) return { kind: "rejected", title: CANCELLED, detail: "Nothing was sent." };
  return { kind: "unknown", title: "Something went wrong", detail: err instanceof Error ? err.message : String(err) };
}
