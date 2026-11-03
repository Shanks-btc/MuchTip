import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Address, Hex, PublicClient } from "viem";
import { useAccount, useBalance, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { escrowAbi } from "./abi";
import { CHAIN_ID, ESCROW_ADDRESS, ESCROW_DEPLOY_BLOCK, LOG_RANGE_BLOCKS } from "./config";
import { backendConfigured, fetchFeed } from "../data/api";
import { claimsFor, eventsConfigured, handlesFor, tipsBy, tipsFor, type IndexedTip } from "../data/events";
import { formatDurationLong } from "../lib/format";
import { FEE_REFRESH_MS, quoteFee, type FeeAction } from "./fees";

const escrow = { address: ESCROW_ADDRESS, abi: escrowAbi, chainId: CHAIN_ID } as const;

/**
 * minTip() and refundDelay() (wiring-spec W1.7): read from the chain once and kept for the session (both are immutable
 * on the contract). If the RPC read fails, feed().config is used instead, which the backend also reads from the chain.
 * Everything that says "min N DOGE" or "after 10 minutes" reads it here.
 */
export function useEscrowConfig() {
  const q = useReadContracts({
    contracts: [{ ...escrow, functionName: "minTip" }, { ...escrow, functionName: "refundDelay" }],
    allowFailure: false,
    query: { staleTime: Infinity, gcTime: Infinity, retry: 2 },
  });
  const fallback = useQuery({
    queryKey: ["escrow-config-feed"],
    queryFn: ({ signal }) => fetchFeed({ limit: 1, signal }),
    enabled: q.isError && backendConfigured,
    staleTime: Infinity,
    retry: 1,
  });
  const cfg = fallback.data?.config ?? null;
  const minTipWei = q.data ? (q.data[0] as bigint) : cfg ? BigInt(cfg.minTipWei) : undefined;
  const refundDelaySeconds = q.data ? Number(q.data[1]) : cfg ? cfg.refundDelaySeconds : undefined;
  return {
    minTipWei,
    refundDelaySeconds,
    /** "10 minutes", "7 days"; undefined until known */
    refundDelayText: refundDelaySeconds === undefined ? undefined : formatDurationLong(refundDelaySeconds),
    source: q.data ? ("chain" as const) : cfg ? ("feed" as const) : null,
    isError: q.isError && (!backendConfigured || fallback.isError),
    refetch: q.refetch,
  };
}

export type WalletStatus = "disconnected" | "connecting" | "connected" | "wrong-network";

/** The connected wallet as the UI needs it. The balance is read on Chikyū even if the wallet is on another chain. */
export function useWallet() {
  const { address, status, chainId } = useAccount();
  const balance = useBalance({ address, chainId: CHAIN_ID, query: { enabled: Boolean(address), refetchInterval: 15_000 } });
  const s: WalletStatus =
    status === "connecting" || status === "reconnecting" ? "connecting" : status !== "connected" ? "disconnected" : chainId !== CHAIN_ID ? "wrong-network" : "connected";
  return { status: s, address, balanceWei: balance.data?.value, refetchBalance: balance.refetch };
}

/** A live fee quote for the connected wallet's real transaction, refreshed every 15 s while mounted (FEES.md 5.2, W2.4). */
export function useFeeQuote(action: FeeAction, call?: { data: Hex; value: bigint }, enabled = true) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { address } = useAccount();
  return useQuery({
    queryKey: ["fee", action, call?.data ?? null, call?.value?.toString() ?? null, address ?? null],
    queryFn: () => quoteFee(client as PublicClient, action, call, address),
    enabled: enabled && Boolean(client),
    refetchInterval: FEE_REFRESH_MS,
    staleTime: FEE_REFRESH_MS,
    // keep showing the last quote while a new one loads (the fee barely depends on the handle or amount)
    placeholderData: (previous) => previous,
  });
}

/** A ticking "now" in seconds, for countdowns. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export type TipStatus = "Pending" | "Claimed" | "Refunded";
export interface OnchainTip {
  id: bigint;
  idHash: Hex;
  tipper: Address;
  createdAt: number;
  amountWei: bigint;
  status: TipStatus;
  /** createdAt + refundDelay, the contract's refundableAt(). */
  refundableAt: number;
}

/** How far back the per-user scan reads `tips(i)`. Testnet volumes are tiny; this bounds the multicall. */
const TIP_SCAN_LIMIT = 500n;
/** tipStatus(): 0 None, 1 Pending, 2 Claimed, 3 Refunded (enum order checked in TipEscrow.sol). */
const STATUS: Record<number, TipStatus | undefined> = { 1: "Pending", 2: "Claimed", 3: "Refunded" };
export const tipStatusOf = (raw: number | bigint): TipStatus | null => STATUS[Number(raw)] ?? null;

/** tipStatus(i) and refundableAt(i) for a list of tips, in one batched read (W3.3, W4.1). */
export function useTipStatuses(ids: bigint[]) {
  return useReadContracts({
    contracts: ids.flatMap((id) => [
      { ...escrow, functionName: "tipStatus", args: [id] } as const,
      { ...escrow, functionName: "refundableAt", args: [id] } as const,
    ]),
    allowFailure: false,
    query: { enabled: ids.length > 0, refetchInterval: 15_000 },
  });
}

/** Indexed tips + their on-chain status -> the rows the UI shows. Tips the chain doesn't know (status None) are dropped. */
export function withStatus(rows: IndexedTip[], statuses: readonly unknown[] | undefined): OnchainTip[] | undefined {
  if (!rows.length) return [];
  if (!statuses) return undefined;
  const out: OnchainTip[] = [];
  rows.forEach((r, k) => {
    const status = tipStatusOf(statuses[2 * k] as number);
    if (!status) return;
    out.push({ id: r.tipId, idHash: r.idHash, tipper: r.tipper, createdAt: r.time, amountWei: r.amountWei, status, refundableAt: Number(statuses[2 * k + 1] as bigint) });
  });
  return out;
}

/**
 * Tips for one X account (by idHash) or from one tipper, straight from the contract's storage: tips(i) and tipStatus(i)
 * for the most recent TIP_SCAN_LIMIT tips, batched through Multicall3. This is the user's own fact, so it is read from the
 * chain rather than the indexer (docs/backend.md, "Why feed is server-side").
 */
export function useTips(filter: { idHash?: Hex; tipper?: Address }, refundDelaySeconds?: number) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const enabled = Boolean(client && (filter.idHash || filter.tipper) && refundDelaySeconds !== undefined);
  return useQuery({
    queryKey: ["tips", filter.idHash ?? null, filter.tipper?.toLowerCase() ?? null],
    enabled,
    refetchInterval: 15_000,
    queryFn: async (): Promise<OnchainTip[]> => {
      const c = client as PublicClient;
      const count = await c.readContract({ ...escrow, functionName: "tipCount" });
      if (count === 0n) return [];
      const from = count > TIP_SCAN_LIMIT ? count - TIP_SCAN_LIMIT + 1n : 1n;
      const ids: bigint[] = [];
      for (let i = count; i >= from; i--) ids.push(i);
      const res = await c.multicall({
        allowFailure: false,
        contracts: ids.flatMap((id) => [
          { ...escrow, functionName: "tips", args: [id] } as const,
          { ...escrow, functionName: "tipStatus", args: [id] } as const,
        ]),
      });
      const out: OnchainTip[] = [];
      ids.forEach((id, k) => {
        const [idHash, tipper, createdAt, , amount] = res[2 * k] as readonly [Hex, Address, bigint, boolean, bigint];
        const status = tipStatusOf(res[2 * k + 1] as number);
        if (!status) return;
        if (filter.idHash && idHash.toLowerCase() !== filter.idHash.toLowerCase()) return;
        if (filter.tipper && tipper.toLowerCase() !== filter.tipper.toLowerCase()) return;
        out.push({ id, idHash, tipper, createdAt: Number(createdAt), amountWei: amount, status, refundableAt: Number(createdAt) + (refundDelaySeconds ?? 0) });
      });
      return out;
    },
  });
}

export interface ChainLog {
  txHash: Hex;
  blockNumber: bigint;
  time: number;
  args: Record<string, unknown>;
}

/**
 * Contract events filtered by an indexed argument, read from the chain in 9,000-block chunks (DogeOS refuses ranges over
 * 10,000) from the deploy block to the head, newest first, with block times.
 */
async function readLogs(client: PublicClient, eventName: "Tipped" | "Claimed" | "Refunded", args: Record<string, unknown>): Promise<ChainLog[]> {
  const head = await client.getBlockNumber();
  const ranges: [bigint, bigint][] = [];
  for (let from = ESCROW_DEPLOY_BLOCK; from <= head; from += LOG_RANGE_BLOCKS) {
    const to = from + LOG_RANGE_BLOCKS - 1n;
    ranges.push([from, to > head ? head : to]);
  }
  const chunks = await Promise.all(
    ranges.map(([fromBlock, toBlock]) =>
      client.getContractEvents({ address: ESCROW_ADDRESS, abi: escrowAbi, eventName, args: args as never, fromBlock, toBlock, strict: true }),
    ),
  );
  const logs = chunks.flat();
  const blocks = [...new Set(logs.map((l) => l.blockNumber))];
  const times = new Map<bigint, number>();
  await Promise.all(blocks.map(async (b) => times.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp))));
  return logs
    .map((l) => ({ txHash: l.transactionHash, blockNumber: l.blockNumber, time: times.get(l.blockNumber) ?? 0, args: l.args as Record<string, unknown> }))
    .sort((a, b) => Number(b.blockNumber - a.blockNumber));
}

export function useEscrowLogs(eventName: "Tipped" | "Claimed" | "Refunded", args: Record<string, unknown> | null) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  return useQuery({
    queryKey: ["logs", eventName, args ? JSON.stringify(args, (_, v) => (typeof v === "bigint" ? v.toString() : v)) : null],
    enabled: Boolean(client && args),
    refetchInterval: 20_000,
    queryFn: () => readLogs(client as PublicClient, eventName, args ?? {}),
  });
}

export interface ClaimSummary {
  /** balanceOf(idHash): the source of truth for "Waiting for you" */
  readyWei: bigint | undefined;
  /** Pending tips, soonest refundable first */
  pending: OnchainTip[];
  loading: boolean;
  claimedWei: bigint | undefined;
  claimedCount: number;
  txOfTip: Map<string, Hex>;
  /** balanceOf is more than the listed pending tips: the index hasn't caught up, so the list would be wrong (W3.3) */
  syncing: boolean;
  refetch: () => Promise<unknown>;
}

const sumPending = (tips: OnchainTip[]) => tips.reduce((s, t) => s + t.amountWei, 0n);

/**
 * W3.3 with the backend: the tips from chain_events (event Tipped, this idHash), each one's tipStatus and refundableAt
 * read from the chain in one batch; "Claimed so far" from chain_events Claimed; the total from balanceOf.
 */
function useClaimSummaryIndexed(idHash: Hex | null): ClaimSummary {
  const ready = useReadContract({ ...escrow, functionName: "balanceOf", args: idHash ? [idHash] : undefined, query: { enabled: Boolean(idHash), refetchInterval: 15_000 } });
  const listed = useQuery({ queryKey: ["indexed-tips-for", idHash], queryFn: () => tipsFor(idHash as Hex), enabled: Boolean(idHash), refetchInterval: 15_000 });
  const claims = useQuery({ queryKey: ["indexed-claims-for", idHash], queryFn: () => claimsFor(idHash as Hex), enabled: Boolean(idHash), refetchInterval: 15_000 });
  const rows = listed.data ?? [];
  const statuses = useTipStatuses(rows.map((r) => r.tipId));
  const tips = withStatus(rows, statuses.data);
  const pending = (tips ?? []).filter((t) => t.status === "Pending").sort((a, b) => a.refundableAt - b.refundableAt);
  const readyWei = ready.data as bigint | undefined;
  return {
    readyWei,
    pending,
    loading: readyWei === undefined || listed.isPending || tips === undefined,
    claimedWei: claims.data ? claims.data.reduce((s, c) => s + c.amountWei, 0n) : undefined,
    claimedCount: (tips ?? []).filter((t) => t.status === "Claimed").length,
    txOfTip: new Map(rows.map((r) => [r.tipId.toString(), r.txHash])),
    syncing: readyWei !== undefined && tips !== undefined && readyWei > sumPending(pending),
    refetch: () => Promise.all([ready.refetch(), listed.refetch(), claims.refetch(), statuses.refetch()]),
  };
}

/** Without the backend: the same facts straight from the contract (tips(i) scan and Claimed logs). */
function useClaimSummaryFromChain(idHash: Hex | null): ClaimSummary {
  const { refundDelaySeconds } = useEscrowConfig();
  const ready = useReadContract({ ...escrow, functionName: "balanceOf", args: idHash ? [idHash] : undefined, query: { enabled: Boolean(idHash), refetchInterval: 15_000 } });
  const tips = useTips({ idHash: idHash ?? undefined }, refundDelaySeconds);
  const claims = useEscrowLogs("Claimed", idHash ? { idHash } : null);
  const tipped = useEscrowLogs("Tipped", idHash ? { idHash } : null);
  const list = tips.data ?? [];
  const pending = list.filter((t) => t.status === "Pending").sort((a, b) => a.refundableAt - b.refundableAt);
  const readyWei = ready.data as bigint | undefined;
  return {
    readyWei,
    pending,
    loading: readyWei === undefined || tips.isPending,
    claimedWei: claims.data ? claims.data.reduce((s, c) => s + (c.args.amount as bigint), 0n) : undefined,
    claimedCount: list.filter((t) => t.status === "Claimed").length,
    txOfTip: new Map((tipped.data ?? []).map((l) => [(l.args.tipId as bigint).toString(), l.txHash])),
    syncing: readyWei !== undefined && !tips.isPending && readyWei > sumPending(pending),
    refetch: () => Promise.all([ready.refetch(), tips.refetch(), claims.refetch()]),
  };
}

/** Everything the Claim tab shows for one X account (W3.3). Indexed when the backend is configured, else from the chain. */
export const useClaimSummary = eventsConfigured ? useClaimSummaryIndexed : useClaimSummaryFromChain;

/** The four rows of My tips (W4.1), from the chain's status and the refund time. */
export type TipPillKind = "waiting" | "refundable" | "claimed" | "refunded";
export function tipPillOf(t: Pick<OnchainTip, "status" | "refundableAt">, now: number): TipPillKind {
  if (t.status === "Refunded") return "refunded";
  if (t.status === "Claimed") return "claimed";
  return now >= t.refundableAt ? "refundable" : "waiting";
}

export interface SentTips {
  /** undefined while loading (or with no wallet) */
  tips: OnchainTip[] | undefined;
  /** idHash (lowercase) -> handle, from x_handles */
  handles: Map<string, string>;
  txOfTip: Map<string, Hex>;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  refetch: () => Promise<unknown>;
}

/** W4.1: chain_events (Tipped, account = this wallet), 20 per page, newest first; handles from x_handles; status from the chain. */
function useSentTipsIndexed(address: Address | undefined): SentTips {
  const q = useInfiniteQuery({
    queryKey: ["indexed-tips-by", address?.toLowerCase() ?? null],
    queryFn: ({ pageParam }) => tipsBy(address as Address, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length : undefined),
    enabled: Boolean(address),
    refetchInterval: 15_000,
  });
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  const statuses = useTipStatuses(rows.map((r) => r.tipId));
  const ids = [...new Set(rows.map((r) => r.idHash.toLowerCase()))].sort();
  const names = useQuery({ queryKey: ["x-handles", ids.join(",")], queryFn: () => handlesFor(ids), enabled: ids.length > 0, staleTime: 60_000 });
  return {
    tips: address && q.data ? withStatus(rows, statuses.data) : undefined,
    handles: names.data ?? new Map(),
    txOfTip: new Map(rows.map((r) => [r.tipId.toString(), r.txHash])),
    hasMore: Boolean(q.hasNextPage),
    loadMore: () => void q.fetchNextPage(),
    loadingMore: q.isFetchingNextPage,
    refetch: () => Promise.all([q.refetch(), statuses.refetch()]),
  };
}

/** Without the backend: the wallet's tips straight from the contract (tips(i) scan, Tipped logs for the tx hashes). */
function useSentTipsFromChain(address: Address | undefined): SentTips {
  const { refundDelaySeconds } = useEscrowConfig();
  const tips = useTips({ tipper: address }, refundDelaySeconds);
  const sent = useEscrowLogs("Tipped", address ? { from: address } : null);
  return {
    tips: address ? tips.data : undefined,
    handles: new Map(),
    txOfTip: new Map((sent.data ?? []).map((l) => [(l.args.tipId as bigint).toString(), l.txHash])),
    hasMore: false,
    loadMore: () => undefined,
    loadingMore: false,
    refetch: () => tips.refetch(),
  };
}

/** The tips a wallet sent (My tips, "Recently sent"). Indexed when the backend is configured, else from the chain. */
export const useSentTips = eventsConfigured ? useSentTipsIndexed : useSentTipsFromChain;

/** W4.5: the My tips badge, refundable tips across ALL of the wallet's tips (not only the first page). */
function useRefundableCountIndexed(address: Address | undefined, now: number): number {
  const all = useQuery({ queryKey: ["indexed-tips-by-all", address?.toLowerCase() ?? null], queryFn: () => tipsBy(address as Address, 0, 1000), enabled: Boolean(address), refetchInterval: 15_000 });
  const rows = all.data?.rows ?? [];
  const statuses = useTipStatuses(rows.map((r) => r.tipId));
  return (withStatus(rows, statuses.data) ?? []).filter((t) => tipPillOf(t, now) === "refundable").length;
}
function useRefundableCountFromChain(address: Address | undefined, now: number): number {
  const { refundDelaySeconds } = useEscrowConfig();
  const tips = useTips({ tipper: address }, refundDelaySeconds);
  return (tips.data ?? []).filter((t) => tipPillOf(t, now) === "refundable").length;
}
export const useRefundableCount = eventsConfigured ? useRefundableCountIndexed : useRefundableCountFromChain;

export type SetupStepState = "done" | "next" | "todo";

/**
 * The three setup steps (wiring-spec W1.8): 1 a wallet is connected, 2 it is on Chikyū, 3 its balance covers the minimum
 * tip plus the tip's buffered network fee (minTip + tipFeeHigh), i.e. it can actually send a tip.
 * `known` is false until the numbers have loaded, so the setup strip doesn't flash for a funded wallet.
 */
export function useSetupSteps() {
  const wallet = useWallet();
  const { minTipWei } = useEscrowConfig();
  const hasWallet = wallet.status === "connected" || wallet.status === "wrong-network";
  const fee = useFeeQuote("tip", undefined, hasWallet);
  const needWei = minTipWei !== undefined && fee.data ? minTipWei + fee.data.upToWei : undefined;
  const funded = hasWallet && wallet.balanceWei !== undefined && needWei !== undefined && wallet.balanceWei >= needWei;
  const done = [hasWallet, wallet.status === "connected", funded];
  const next = done.indexOf(false);
  const states: SetupStepState[] = done.map((d, i) => (d ? "done" : i === next ? "next" : "todo"));
  return {
    states,
    doneCount: done.filter(Boolean).length,
    allDone: next === -1,
    needWei,
    known: wallet.status === "disconnected" || (hasWallet && wallet.balanceWei !== undefined && needWei !== undefined),
  };
}
