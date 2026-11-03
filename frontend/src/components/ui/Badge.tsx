import type { EventType } from "../../data/types";
import type { FeedState } from "../../data/hooks";

// Event badges: 26 px, radius 7, Inter 500 12 px. The landing feed has a dot; the app's tables and phone cards don't.
const EVENT = {
  Tipped: { box: "bg-tipped-bg text-tipped-ink", dot: "bg-tipped-dot" },
  Claimed: { box: "bg-success-bg text-success-ink", dot: "bg-success" },
  Refunded: { box: "bg-refunded-bg text-refunded-ink", dot: "bg-refunded-dot" },
} as const;

export function EventBadge({ type, dot = false, compact = false }: { type: EventType; dot?: boolean; compact?: boolean }) {
  const t = EVENT[type];
  return (
    <span className={`inline-flex h-[26px] items-center rounded-badge text-[12px] font-medium ${compact ? "px-[9px]" : "px-2.5"} ${dot ? "gap-[7px]" : ""} ${t.box}`}>
      {dot && <span className={`inline-block h-1.5 w-1.5 rounded-full ${t.dot}`} />}
      {type}
    </span>
  );
}

/** The feed status chip (F1–F4): Example data (dashed, development only), Syncing, Live, Offline. */
export function FeedChip({ s }: { s: FeedState }) {
  const base = "inline-flex h-[26px] items-center gap-1.5 rounded-badge px-2.5 text-[12px] font-medium";
  if (s.kind === "loading" || (s.kind === "ready" && s.syncing)) return <span className={`${base} bg-surface-chip text-ink-3`}>Syncing</span>;
  if (s.kind === "error") return <span className={`${base} bg-error-bg text-error`}>Offline</span>;
  if (s.source === "demo") return <span className={`${base} border border-dashed border-line-dash text-ink-3`}>Example data</span>;
  return <span className={`${base} bg-success-bg text-success-ink`}>Live</span>;
}

/** Tip status pills in My tips (A3, P3). */
export const TIP_PILL = {
  waiting: { cls: "bg-tipped-bg text-tipped-ink", label: "Waiting to be claimed" },
  refundable: { cls: "bg-warning-bg text-warning", label: "Unclaimed, refundable" },
  claimed: { cls: "bg-success-bg text-success-ink", label: "Claimed" },
  refunded: { cls: "bg-refunded-bg text-refunded-ink", label: "Refunded to you" },
} as const;
export type TipPill = keyof typeof TIP_PILL;
