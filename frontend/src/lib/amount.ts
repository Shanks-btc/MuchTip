import { parseEther } from "viem";

export const PRESETS = ["5", "25", "69", "420"] as const;

/** A user-typed DOGE amount -> wei, or null if it isn't a plain positive decimal with at most 18 decimals. */
export function parseDoge(input: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,18})?$|^\.\d{1,18}$/.test(s)) return null;
  const wei = parseEther(s.startsWith(".") ? `0${s}` : s);
  return wei > 0n ? wei : null;
}

/** Keep only what a DOGE amount field should accept while typing. */
export const sanitizeAmountInput = (s: string) => s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 24);
