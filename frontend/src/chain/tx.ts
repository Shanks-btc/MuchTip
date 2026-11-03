import { decodeFunctionData, parseEventLogs, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { escrowAbi } from "./abi";
import { ESCROW_ADDRESS } from "./config";
import { describeTxError, type ErrorContext, type TxError } from "./errors";

/**
 * Fee actually paid, from the RAW receipt: l1Fee + gasUsed x effectiveGasPrice (FEES.md 1 and 5.6). viem's receipt
 * object drops l1Fee, so the RPC method is called directly.
 */
export async function feePaid(client: PublicClient, hash: Hex): Promise<bigint | null> {
  try {
    const raw = (await client.request({ method: "eth_getTransactionReceipt", params: [hash] } as never)) as { l1Fee?: Hex; gasUsed: Hex; effectiveGasPrice: Hex } | null;
    if (!raw) return null;
    return BigInt(raw.l1Fee ?? "0x0") + BigInt(raw.gasUsed) * BigInt(raw.effectiveGasPrice);
  } catch {
    return null;
  }
}

/** The tipId of a mined tip, from its Tipped log. */
export function tipIdOf(receipt: TransactionReceipt): bigint | null {
  const logs = parseEventLogs({ abi: escrowAbi, eventName: "Tipped", logs: receipt.logs.filter((l) => l.address.toLowerCase() === ESCROW_ADDRESS.toLowerCase()) });
  return logs[0]?.args.tipId ?? null;
}

/**
 * Why a mined transaction reverted: replays the same call (same sender, calldata and value) at the block before it was
 * included, which gives the contract's custom error (e.g. TooEarly, NothingToClaim). Best effort: if the replay
 * succeeds (the state changed in that block) the error is generic.
 */
export async function revertReason(client: PublicClient, hash: Hex, blockNumber: bigint, ctx: ErrorContext = {}): Promise<TxError> {
  const generic: TxError = { kind: "revert", title: "The contract refused it", detail: "The transaction was mined but the contract reverted it. Only the network fee was spent." };
  try {
    const tx = await client.getTransaction({ hash });
    const { functionName, args } = decodeFunctionData({ abi: escrowAbi, data: tx.input });
    await client.simulateContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName, args, value: tx.value, account: tx.from, blockNumber: blockNumber - 1n } as never);
    return generic;
  } catch (e) {
    const d = describeTxError(e, ctx);
    return d.kind === "revert" ? d : generic;
  }
}
