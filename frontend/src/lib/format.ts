// Display helpers. Amounts are wei (bigint or decimal string) and are formatted with BigInt only, never floats.

const WEI = 10n ** 18n;
const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Wei -> DOGE with at most `maxDecimals` decimals (truncated), trailing zeros dropped, thousands grouped. */
export function formatDoge(wei: string | bigint, maxDecimals = 4): string {
  const v = typeof wei === "bigint" ? wei : BigInt(wei);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const frac = (abs % WEI).toString().padStart(18, "0").slice(0, maxDecimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${group((abs / WEI).toString())}${frac ? "." + frac : ""}`;
}

/** Wei -> DOGE with exactly `decimals` decimals, rounded up or down. "At most" figures round up so they stay true. */
export function formatDogeFixed(wei: bigint, decimals: number, round: "up" | "down" = "down"): string {
  const unit = 10n ** BigInt(18 - decimals);
  const scaled = round === "up" ? (wei + unit - 1n) / unit : wei / unit;
  const s = scaled.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  return decimals ? `${group(whole)}.${s.slice(-decimals)}` : group(whole);
}

/**
 * "0.02 – 0.03" from an estimate and its upper bound, the bound rounded up. Two decimals as in the spec, more only when
 * the estimate would otherwise read "0.00" (fees on Chikyū can drop below a cent).
 */
export function formatFeeRange(aboutWei: bigint | null, upToWei: bigint): string {
  if (aboutWei === null) return `up to ${formatDogeFixed(upToWei, 2, "up")}`;
  let d = 2;
  while (d < 6 && formatDogeFixed(aboutWei, d, "down").replace(/[0.]/g, "") === "") d++;
  const lo = formatDogeFixed(aboutWei, d, "down");
  const hi = formatDogeFixed(upToWei, d, "up");
  return lo === hi ? `≈ ${hi}` : `${lo} – ${hi}`;
}

/** The app's fee wording: "0.01 to 0.02" (spec A1), "up to 0.35" for the fallback ceiling. */
export const formatFeeTo = (aboutWei: bigint | null, upToWei: bigint) => formatFeeRange(aboutWei, upToWei).replace(" – ", " to ");

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "Oct 31, 13:24" in the viewer's time zone (activity rows). */
export function formatEventTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${formatDay(d)}, ${clock(d)}`;
}

/** "Today 13:24", "Yesterday", "Oct 31" (My tips rows). */
export function formatDayLabel(d: Date, now = new Date()): string {
  if (d.toDateString() === now.toDateString()) return `Today ${clock(d)}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  return d.toDateString() === y.toDateString() ? "Yesterday" : formatDay(d);
}

/** "13:24" */
export const formatClockTime = (d: Date) => clock(d);

/** "Oct 30" */
export const formatDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "13:34 today" / "Oct 31 · 13:34" */
export function formatClock(d: Date, now = new Date()): string {
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? `${time} today` : `${formatDay(d)} · ${time}`;
}

export function relativeTime(iso: string | Date, now = Date.now()): string {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 30) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** 600 -> "10 min", 90 -> "90 s", 7200 -> "2 h", 604800 -> "7 days". */
export function formatDuration(seconds: number): string {
  if (seconds < 120) return `${seconds} s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} days`;
}

/** 600 -> "10 minutes", 60 -> "1 minute", 7200 -> "2 hours", 604800 -> "7 days" (sentence copy). */
export function formatDurationLong(seconds: number): string {
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (seconds < 120 && seconds % 60 !== 0) return unit(seconds, "second");
  if (seconds < 7200) return unit(Math.round(seconds / 60), "minute");
  if (seconds < 172800) return unit(Math.round(seconds / 3600), "hour");
  return unit(Math.round(seconds / 86400), "day");
}

/** Seconds left -> "6:02" under an hour, "2:05:09" under two days, else "3 days". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 172800) return `${Math.floor(s / 86400)} days`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Initials for an avatar: "X Developers" -> "XD", "jack" -> "JA". */
export function initials(name: string | null | undefined, handle: string): string {
  const words = (name || "").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] || handle).slice(0, 2).toUpperCase();
}
