import type { Address, Hex } from "viem";
import { ESCROW_ADDRESS } from "../chain/config";
import { authConfigured } from "./api";
import { supabase } from "./auth";

// Reads of the indexer's tables with the public anon key (RLS: select only), wiring-spec W3.3 and W4.1.
// chain_events stores addresses and hashes lowercase; amount_wei is numeric(78,0), so it is cast to text in the select
// and parsed with BigInt here: it never passes through a JS number (docs/backend.md, "Database").

/** The indexed tables are readable when the Supabase project is configured. */
export const eventsConfigured = authConfigured;

const CONTRACT = ESCROW_ADDRESS.toLowerCase();
const TIP_COLUMNS = "block_number, log_index, tx_hash, id_hash, tip_id, account, amount_wei::text, block_time";

interface Row {
  block_number: number;
  log_index: number;
  tx_hash: string;
  id_hash: string;
  tip_id: string | null;
  account: string;
  amount_wei: string;
  block_time: string;
}

export interface IndexedTip {
  tipId: bigint;
  idHash: Hex;
  tipper: Address;
  amountWei: bigint;
  txHash: Hex;
  /** block time, unix seconds */
  time: number;
  blockNumber: number;
}
export interface IndexedClaim {
  amountWei: bigint;
  recipient: Address;
  txHash: Hex;
  time: number;
}

function db() {
  const sb = supabase();
  if (!sb) throw new Error("The MuchTip backend isn't configured");
  return sb.from("chain_events");
}

const toTip = (r: Row): IndexedTip => ({
  tipId: BigInt(r.tip_id ?? "0"),
  idHash: r.id_hash as Hex,
  tipper: r.account as Address,
  amountWei: BigInt(r.amount_wei),
  txHash: r.tx_hash as Hex,
  time: Math.floor(Date.parse(r.block_time) / 1000),
  blockNumber: r.block_number,
});

/** Every Tipped event for one X account, newest first. */
export async function tipsFor(idHash: string): Promise<IndexedTip[]> {
  const { data, error } = await db().select(TIP_COLUMNS).eq("contract", CONTRACT).eq("event", "Tipped").eq("id_hash", idHash.toLowerCase()).order("block_number", { ascending: false }).order("log_index", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return (data as unknown as Row[]).map(toTip);
}

/** Every Claimed event for one X account, newest first. */
export async function claimsFor(idHash: string): Promise<IndexedClaim[]> {
  const { data, error } = await db().select(TIP_COLUMNS).eq("contract", CONTRACT).eq("event", "Claimed").eq("id_hash", idHash.toLowerCase()).order("block_number", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return (data as unknown as Row[]).map((r) => ({ amountWei: BigInt(r.amount_wei), recipient: r.account as Address, txHash: r.tx_hash as Hex, time: Math.floor(Date.parse(r.block_time) / 1000) }));
}

export const PAGE_SIZE = 20;

/** One page (20 by default) of the Tipped events sent from an address, newest first (W4.1). */
export async function tipsBy(address: string, page: number, size = PAGE_SIZE): Promise<{ rows: IndexedTip[]; hasMore: boolean }> {
  const from = page * size;
  // one extra row tells us whether there is a next page
  const { data, error } = await db().select(TIP_COLUMNS).eq("contract", CONTRACT).eq("event", "Tipped").eq("account", address.toLowerCase()).order("block_number", { ascending: false }).order("log_index", { ascending: false }).range(from, from + size);
  if (error) throw new Error(error.message);
  const rows = (data as unknown as Row[]).map(toTip);
  return { rows: rows.slice(0, size), hasMore: rows.length > size };
}

/** idHash -> handle from x_handles (only accounts someone resolved; a reassigned handle is null). */
export async function handlesFor(idHashes: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(idHashes.map((h) => h.toLowerCase()))];
  if (!ids.length) return new Map();
  const sb = supabase();
  if (!sb) return new Map();
  const { data, error } = await sb.from("x_handles").select("id_hash, handle").in("id_hash", ids);
  if (error) throw new Error(error.message);
  return new Map((data as { id_hash: string; handle: string | null }[]).filter((r) => r.handle).map((r) => [r.id_hash.toLowerCase(), r.handle as string]));
}
