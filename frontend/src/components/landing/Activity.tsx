import { useState } from "react";
import { explorerAddr, ESCROW_ADDRESS, explorerTx } from "../../chain/config";
import { useFeed, type FeedFilter, type FeedState } from "../../data/hooks";
import type { FeedEvent } from "../../data/types";
import { formatDoge, formatEventTime, relativeTime, shortAddr, shortHash } from "../../lib/format";
import { EventBadge, FeedChip } from "../ui/Badge";
import { Skeleton } from "../ui/Primitives";

const FILTERS: { label: string; value: FeedFilter }[] = [
  { label: "All", value: "All" },
  { label: "Tips", value: "Tipped" },
  { label: "Claims", value: "Claimed" },
  { label: "Refunds", value: "Refunded" },
];

/** "0x1BE5…19AE to @XDevelopers", "TipEscrow to @XDevelopers", "TipEscrow to 0x1BE5…19AE" */
export function parties(e: FeedEvent) {
  const account = e.handle ? `@${e.handle}` : e.xId ? `X ID ${e.xId}` : shortHash(e.idHash);
  if (e.type === "Tipped") return { from: shortAddr(e.from), to: account };
  if (e.type === "Claimed") return { from: "TipEscrow", to: account };
  return { from: "TipEscrow", to: shortAddr(e.tipper) };
}

export const rowKey = (e: FeedEvent) => `${e.txHash}:${e.logIndex}`;

/** The feed's footnote under the list (F1–F4). */
export function feedNote(s: FeedState) {
  if (s.kind === "loading") return "Reading the latest events from DogeOS.";
  if (s.kind === "error") return s.lastSync ? `Last successful update ${relativeTime(new Date(s.lastSync))}.` : "No successful update yet.";
  if (s.source === "demo") return "Real transactions from a test deployment, shown as an example.";
  if (s.syncing) return "Catching up with the latest blocks.";
  return "Updates every few seconds from contract events.";
}

/** F3 / F4 bodies, shared with the app's Activity tab. */
export function FeedEmpty() {
  return (
    <div className="px-2 py-12 text-center">
      <div className="text-[17px] font-semibold">No tips on this contract yet</div>
      <p className="m-0 mx-auto mt-1.5 max-w-[360px] text-[14px] text-muted">Yours could be the first. It appears here a few seconds after it's confirmed.</p>
    </div>
  );
}
export function FeedError({ retry }: { retry: () => void }) {
  return (
    <div role="alert" className="px-2 py-10 text-center">
      <div className="text-[17px] font-semibold">We can't reach DogeOS right now</div>
      <p className="m-0 mx-auto mt-1.5 max-w-[400px] text-[14px] text-muted">Your tips are safe on-chain. This only affects what we can show.</p>
      <button type="button" onClick={retry} className="mt-btn mt-4 h-10 cursor-pointer rounded-ctl border border-ink bg-white px-4 text-[14px] font-semibold text-ink">Try again</button>
    </div>
  );
}

/** Spec L0 "Happening on DogeOS right now" with its live, loading, empty and error states (F1–F4). Rows come from feed(). */
export function Activity() {
  const [filter, setFilter] = useState<FeedFilter>("All");
  // feed?limit=25 like every other feed reader (one shared request); the landing shows the newest five (spec F1)
  const s = useFeed(filter, 25);
  const events = (s.kind === "ready" ? s.data.events : s.kind === "error" ? s.data?.events ?? [] : []).slice(0, 5);

  return (
    <section id="activity" className="border-b border-line">
      <div data-reveal="group" className="mx-auto flex max-w-site flex-wrap items-start gap-14 px-8 py-[72px] max-[480px]:px-4">
        <div className="flex-[1_1_300px]">
          <h2 className="m-0 text-[34px]">Happening on DogeOS right now</h2>
          <p className="m-0 mt-3.5 max-w-[340px] text-[16px] leading-[1.55] text-ink-3">Every tip, claim and refund is a public contract event. Open any of them on the explorer.</p>
          <a className="mt-link mt-[18px] inline-block font-mono text-[13px] font-medium text-gold-ink" href={explorerAddr(ESCROW_ADDRESS)} target="_blank" rel="noreferrer">TipEscrow {shortAddr(ESCROW_ADDRESS)} ↗</a>
        </div>
        <div className="min-w-0 flex-[2_1_640px]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink pb-3.5">
            <div role="tablist" aria-label="Filter activity" className="flex gap-1">
              {FILTERS.map((f) => {
                const on = filter === f.value;
                return (
                  <button
                    key={f.value}
                    role="tab"
                    type="button"
                    aria-selected={on}
                    onClick={() => setFilter(f.value)}
                    className={`h-[34px] cursor-pointer rounded-[8px] border px-3.5 text-[13px] ${on ? "border-ink bg-ink font-semibold text-white" : "border-transparent bg-transparent font-medium text-ink-3"}`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
            <FeedChip s={s} />
          </div>

          {s.kind === "loading" ? (
            <ul className="m-0 list-none p-0" aria-busy="true">
              {Array.from({ length: 5 }, (_, i) => (
                <li key={i} className="flex items-center gap-4 border-b border-line-soft px-2 py-[18px]">
                  <Skeleton className="h-[22px] w-[84px]" />
                  <Skeleton className="h-3.5 flex-1 rounded-[4px]" />
                  <Skeleton className="h-3.5 w-[90px] rounded-[4px]" />
                </li>
              ))}
            </ul>
          ) : events.length > 0 ? (
            <ul className="m-0 list-none p-0">
              {events.map((e) => {
                const c = parties(e);
                return (
                  <li key={rowKey(e)} className="mt-in mt-row mt-arow border-b border-line-soft px-2 py-3.5 text-[14px]">
                    <span style={{ gridArea: "b" }}><EventBadge type={e.type} dot /></span>
                    <span className="min-w-0 truncate" style={{ gridArea: "p" }}>
                      <span className="font-mono text-[13px] text-ink-3">{c.from}</span>
                      <span className="text-muted-2"> to </span>
                      <strong className="font-semibold">{c.to}</strong>
                    </span>
                    <span className="text-right font-mono text-[13px] font-semibold" style={{ gridArea: "a" }}>{formatDoge(e.amountWei)} DOGE</span>
                    <time className="text-[13px] text-muted" style={{ gridArea: "t" }} dateTime={e.time}>{formatEventTime(e.time)}</time>
                    <a className="mt-link text-right font-mono text-[13px] font-medium text-gold-ink" style={{ gridArea: "x" }} href={explorerTx(e.txHash)} target="_blank" rel="noreferrer">{shortHash(e.txHash)} ↗</a>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {s.kind === "error" && events.length === 0 && <FeedError retry={s.retry} />}
          {s.kind === "ready" && events.length === 0 && <FeedEmpty />}
          <p className="m-0 mt-3 font-mono text-[12px] text-muted">{feedNote(s)}</p>
        </div>
      </div>
    </section>
  );
}
