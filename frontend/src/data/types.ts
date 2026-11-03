// Shapes of the backend's responses (docs/backend.md). Every uint256 / amount is a decimal string: parse with BigInt.

export type EventType = "Tipped" | "Claimed" | "Refunded";

interface FeedEventBase {
  type: EventType;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  time: string; // ISO
  idHash: string;
  handle: string | null;
  xId: string | null;
  amountWei: string;
}
export type FeedEvent =
  | (FeedEventBase & { type: "Tipped"; tipId: string; from: string })
  | (FeedEventBase & { type: "Claimed"; recipient: string })
  | (FeedEventBase & { type: "Refunded"; tipId: string; tipper: string });

export interface FeedTotals {
  tipsCount: number;
  totalTippedWei: string;
  uniqueHandles: number;
  unclaimedWei: string;
  claimedWei: string;
  refundedWei: string;
  claimsCount: number;
  refundsCount: number;
}

export interface FeedResponse {
  contract: string;
  chainId: number;
  config: { refundDelaySeconds: number; minTipWei: string } | null;
  sync: { headBlock: number | null; indexedToBlock: number; lagBlocks: number | null; complete: boolean };
  totals: FeedTotals;
  onChain: { balanceWei: string; matchesTotals: boolean } | null;
  events: FeedEvent[];
}

export interface ResolvedHandle {
  xId: string;
  handle: string;
  name: string | null;
  idHash: string;
  resolvedAt?: string;
  /** "x" or "cache" from the live backend, "mock" from its mock mode, "demo" from this app's built-in fixtures. */
  source: "x" | "cache" | "mock" | "demo";
}

export interface SignedClaim {
  xId: string;
  handle: string | null;
  recipient: string;
  nonce: string;
  expiry: string;
  signature: `0x${string}`;
  digest: string;
  contract: string;
  chainId: number;
  unclaimedWei: string;
  claimable: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
