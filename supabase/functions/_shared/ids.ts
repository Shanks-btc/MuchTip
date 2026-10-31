import { ethers } from "./eth.ts";

/** X user ids are decimal strings of up to 20 digits (they exceed 2^53, so never a JS Number). */
export const X_ID_RE = /^\d{1,20}$/;

/** TipEscrow.idHash(xId) = keccak256(abi.encode(uint256 xId)): the id as a 32-byte big-endian word, hashed. */
export function idHashOf(xId: bigint | string): string {
  const id = BigInt(xId);
  if (id < 0n || id >= 1n << 256n) throw new RangeError("xId out of uint256 range");
  return ethers.keccak256(ethers.toBeHex(id, 32));
}

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * Trims, drops one leading "@", and validates X's handle alphabet and length. Case is preserved (lookups are
 * case-insensitive, canonical casing comes from X). Returns null for anything else, including profile URLs.
 */
export function normaliseHandle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const h = input.trim().replace(/^@/, "");
  return HANDLE_RE.test(h) ? h : null;
}
