import { explorerAddr, ESCROW_ADDRESS, explorerTx } from "../../chain/config";
import { feedNote, FeedEmpty, FeedError, parties, rowKey } from "../../components/landing/Activity";
import { EventBadge, FeedChip } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Primitives";
import { useFeed } from "../../data/hooks";
import { formatDoge, formatEventTime, shortHash } from "../../lib/format";
import { pageTitle, useTitle } from "../../lib/title";
import { usePhone } from "../../lib/useMedia";

/** /app/activity (spec A4, P4): every TipEscrow event from feed(), newest first. */
export default function Activity() {
  useTitle(pageTitle("Activity"));
  const phone = usePhone();
  const s = useFeed("All", 25);
  const events = s.kind === "ready" ? s.data.events : s.kind === "error" ? s.data?.events ?? [] : [];
  // A4/P4 show live rows bare; example, stale or loading rows carry the feed chip and footnote so they aren't read as live
  const live = s.kind === "ready" && s.source === "live" && !s.syncing;
  const note = !live && <p className="m-0 mt-3 font-mono text-[12px] text-muted">{feedNote(s)}</p>;

  const body =
    s.kind === "loading" ? (
      <div aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-line-faint px-5 py-[18px] last:border-b-0">
            <Skeleton className="h-[22px] w-[84px]" /><Skeleton className="h-3.5 flex-1 rounded-[4px]" /><Skeleton className="h-3.5 w-[90px] rounded-[4px]" />
          </div>
        ))}
      </div>
    ) : events.length === 0 ? (
      s.kind === "error" ? <FeedError retry={s.retry} /> : <FeedEmpty />
    ) : null;

  if (phone)
    return (
      <div>
        {!live && <div className="mb-3"><FeedChip s={s} /></div>}
        {body && <div className="rounded-[14px] border border-line-2 bg-white">{body}</div>}
        <div className="flex flex-col gap-2">
          {events.map((e) => {
            const c = parties(e);
            return (
              <div key={rowKey(e)} className="rounded-[14px] border border-line-2 bg-white px-3.5 py-3">
                <div className="flex items-center justify-between"><EventBadge type={e.type} compact /><span className="font-mono text-[13px] font-semibold">{formatDoge(e.amountWei)} DOGE</span></div>
                <div className="mt-2 truncate text-[13px]"><span className="font-mono text-ink-3">{c.from}</span> to <strong>{c.to}</strong></div>
                <div className="mt-1.5 flex justify-between font-mono text-[11px] text-muted">
                  <time dateTime={e.time}>{formatEventTime(e.time)}</time>
                  <a className="mt-link text-gold-ink" href={explorerTx(e.txHash)} target="_blank" rel="noreferrer">{shortHash(e.txHash)} ↗</a>
                </div>
              </div>
            );
          })}
        </div>
        {note}
      </div>
    );

  return (
    <>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[32px]">Activity</h1>
        {!live && <FeedChip s={s} />}
      </div>
      <p className="m-0 mb-6 text-[15px] text-ink-3">
        Every tip, claim and refund on the TipEscrow contract. <a className="text-gold-ink" href={explorerAddr(ESCROW_ADDRESS)} target="_blank" rel="noreferrer">Open the contract ↗</a>
      </p>
      <div className="overflow-hidden rounded-card border border-line-2 bg-white">
        {body}
        {events.map((e) => {
          const c = parties(e);
          return (
            <div key={rowKey(e)} className="mt-in mt-row grid grid-cols-[110px_minmax(0,1fr)_110px_120px_110px] items-center gap-3 border-b border-line-faint px-5 py-3.5 text-[14px] last:border-b-0">
              <span><EventBadge type={e.type} /></span>
              <span className="min-w-0 truncate"><span className="font-mono text-[13px] text-ink-3">{c.from}</span> to <strong>{c.to}</strong></span>
              <span className="text-right font-mono text-[13px] font-semibold">{formatDoge(e.amountWei)} DOGE</span>
              <time className="text-[13px] text-muted" dateTime={e.time}>{formatEventTime(e.time)}</time>
              <a className="mt-link text-right font-mono text-[13px] font-medium text-gold-ink" href={explorerTx(e.txHash)} target="_blank" rel="noreferrer">{shortHash(e.txHash)} ↗</a>
            </div>
          );
        })}
      </div>
      {note}
    </>
  );
}
