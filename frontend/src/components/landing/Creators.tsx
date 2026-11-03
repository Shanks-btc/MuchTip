import { Link } from "react-router-dom";
import type { Hex } from "viem";
import { useClaimSummary, useNow } from "../../chain/hooks";
import { useFeed } from "../../data/hooks";
import { formatCountdown, formatDoge, initials } from "../../lib/format";
import { tipLink, tipLinkText } from "../../lib/links";
import { CopyButton } from "../ui/Copy";
import { XLogo } from "../ui/Icons";
import { Skeleton } from "../ui/Primitives";

/**
 * The example account in the dark card: the X account of the newest event in feed() that has a handle. Its numbers
 * are read from the contract for that account (balanceOf, tips, Claimed events), so the card is labelled "Example"
 * but never shows made-up figures.
 */
function useExampleAccount() {
  const s = useFeed("All", 25);
  const events = s.kind === "ready" ? s.data.events : s.kind === "error" ? s.data?.events ?? [] : [];
  const e = events.find((x) => x.handle);
  return { acct: e ? { handle: e.handle as string, xId: e.xId, idHash: e.idHash as Hex } : null, loading: s.kind === "loading" };
}

/** Spec L0 "Were you tipped?" */
export function Creators() {
  const { acct, loading } = useExampleAccount();
  const sum = useClaimSummary(acct?.idHash ?? null);
  const now = useNow();
  const next = sum.pending[0]?.refundableAt;
  // skeletons only while something is loading; with no tipped account yet (or no feed) the figures read "—", never a sample
  const empty = !acct && !loading;
  const v = (x: string | null | undefined, w = "w-16") => (empty ? "—" : x === null || x === undefined ? <Skeleton dark className={`inline-block h-5 ${w}`} /> : x);

  return (
    <section id="creators" className="bg-ink text-white">
      <div data-reveal="group" className="mx-auto flex max-w-site flex-wrap items-center gap-[72px] px-8 py-28 max-[480px]:px-4">
        <div className="flex-[1_1_380px]">
          <h2 className="m-0 text-[clamp(36px,4vw,56px)] leading-[1.02]">Were you tipped?<br /><span className="text-gold">It's waiting for you.</span></h2>
          <p className="m-0 mt-[22px] max-w-[440px] text-[17px] leading-[1.6] text-night-text">Sign in with the X account that was tipped. Connect any wallet and collect every waiting tip in one transaction. Then put your tip link in your bio.</p>
          <Link to="/app/claim" className="mt-btn mt-[30px] inline-flex h-[52px] items-center gap-2.5 rounded-btn bg-gold px-[22px] text-[16px] font-semibold text-ink no-underline">
            <XLogo />Sign in with X to claim
          </Link>
          <p className="m-0 mt-3.5 text-[13px] text-night-muted">We only read your X ID. We never post for you.</p>
        </div>

        <div className="flex-[1.2_1_500px] overflow-hidden rounded-panel border border-night-line bg-night-card max-[560px]:basis-full">
          <div className="flex items-center justify-between gap-3 border-b border-night-line px-[22px] py-[18px]">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-[13px] font-bold text-ink">{acct ? initials(null, acct.handle) : ""}</span>
              <div className="min-w-0">
                <div className="truncate font-semibold">{acct ? `@${acct.handle}` : empty ? "No tipped account yet" : <Skeleton dark className="h-4 w-32" />}</div>
                <div className="font-mono text-[12px] text-night-muted">{acct?.xId ? `X ID ${acct.xId}` : acct || empty ? "" : <Skeleton dark className="mt-1 h-3 w-24" />}</div>
              </div>
            </div>
            <span className="text-[11px] font-medium text-night-muted">Example</span>
          </div>
          <div className="px-[22px] py-6">
            <div className="text-[12px] font-medium text-night-muted">Ready to claim</div>
            <div className="mt-1.5 flex items-baseline gap-2.5">
              <span className="font-mono text-[48px] font-semibold tracking-[-0.04em] text-gold">{v(sum.readyWei === undefined ? null : formatDoge(sum.readyWei, 2), "w-20 !h-11")}</span>
              <span className="font-mono text-[16px] font-medium text-night-text">DOGE from {empty ? "—" : sum.loading ? "…" : sum.pending.length} {sum.pending.length === 1 ? "tip" : "tips"}</span>
            </div>
            <Link to="/app/claim" className="mt-btn mt-[18px] flex h-[52px] w-full items-center justify-center rounded-btn bg-gold text-[15px] font-semibold text-ink no-underline">Claim all, one transaction</Link>
            <div className="mt-[22px] grid grid-cols-2 gap-px overflow-hidden rounded-ctl bg-night-line">
              <div className="bg-night-card px-4 py-3.5">
                <div className="text-[11px] font-medium text-night-muted">Claimed so far</div>
                <div className="mt-1 font-mono text-[20px] font-semibold">{v(sum.claimedWei === undefined ? null : `${formatDoge(sum.claimedWei, 2)} DOGE`, "w-24")}</div>
              </div>
              <div className="bg-night-card px-4 py-3.5">
                <div className="text-[11px] font-medium text-night-muted">Next refund deadline</div>
                <div className="mt-1 font-mono text-[20px] font-semibold text-night-warm">{v(sum.loading ? null : next === undefined ? "none" : next <= now ? "now" : formatCountdown(next - now))}</div>
              </div>
            </div>
            <div className="mt-3.5 flex h-[46px] items-center gap-2 rounded-ctl border border-night-line bg-night-input pl-3.5 pr-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-night-text">{acct ? tipLinkText(acct.handle) : "…"}</span>
              {acct && (
                <CopyButton value={tipLink(acct.handle)} label="Copy tip link" className="h-[34px] cursor-pointer rounded-[7px] border-0 bg-night-line px-3 text-[12px] font-semibold text-white">Copy tip link</CopyButton>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
