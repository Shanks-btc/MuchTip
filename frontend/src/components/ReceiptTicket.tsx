import { explorerTx } from "../chain/config";
import { formatClockTime, formatDogeFixed, shortHash } from "../lib/format";
import { xIntent } from "../lib/links";
import { CopyButton } from "./ui/Copy";
import { CheckIcon, ArrowIcon, Logo, XLogo } from "./ui/Icons";
import { Skeleton } from "./ui/Primitives";

export type ReceiptStatus = "draft" | "waiting" | "claimed" | "refunded";

export interface ReceiptTicketProps {
  /** Wei. undefined = still loading (skeletons); null in a draft = no valid amount yet. */
  amount: bigint | null | undefined;
  /** "@handle" (or an X ID) */
  to: string | null;
  /** The tipper's address, shortened by the ticket. */
  from?: string | null;
  status: ReceiptStatus;
  /** Unix seconds. */
  sentAt?: number | null;
  refundAt?: number | null;
  txHash?: string | null;
  note?: string;
  /** The colour behind the card, so the perforation notches read as cut-outs (#FFFFFF landing, #F4F3EE app). */
  notch: string;
  /** "Tell them on X" posts this text; "Copy link" copies `link`. Without them the buttons are hidden. */
  shareText?: string;
  link?: string;
}

const label = "font-mono text-[11px] font-medium tracking-[0.1em] text-muted-2";

/** "25.00" -> ["25", ".00"], "1,240.50" -> ["1,240", ".50"] */
function splitAmount(wei: bigint): [string, string] {
  const s = formatDogeFixed(wei, 2);
  const i = s.lastIndexOf(".");
  return [s.slice(0, i), s.slice(i)];
}

function Perforation({ notch, size }: { notch: string; size: 20 | 24 }) {
  const half = size / 2;
  return (
    <div aria-hidden="true" className="relative" style={{ height: size }}>
      <span className="absolute top-0 rounded-full" style={{ left: -half, width: size, height: size, background: notch }} />
      <span className="absolute top-0 rounded-full" style={{ right: -half, width: size, height: size, background: notch }} />
      <span className="absolute border-t-2 border-dashed border-night-dash" style={{ left: size === 24 ? 22 : 18, right: size === 24 ? 22 : 18, top: half - 1 }} />
    </div>
  );
}

const STATUS_PILL: Record<Exclude<ReceiptStatus, "draft">, { cls: string; dot: string; text: string }> = {
  waiting: { cls: "bg-gold/[0.14] text-gold", dot: "mt-pulse-gold bg-gold", text: "Waiting to claim" },
  claimed: { cls: "bg-success/[0.16] text-success", dot: "bg-success", text: "Claimed" },
  refunded: { cls: "bg-night-chip text-night-pale", dot: "bg-night-pale", text: "Refunded" },
};

/**
 * The shared tip receipt (spec H1): ink card radius 28, notches + dashed perforation, Sent → Held → Claimed timeline,
 * network + tx, "Tell them on X" + "Copy link". Status "draft" is the compact preview on Send (spec A1).
 */
export function ReceiptTicket(p: ReceiptTicketProps) {
  if (p.status === "draft") return <DraftTicket {...p} />;
  const loading = p.amount === undefined;
  const [whole, cents] = p.amount ? splitAmount(p.amount) : ["", ""];
  const pill = STATUS_PILL[p.status];
  const settled = p.status === "claimed";
  const clock = (t?: number | null) => (t ? formatClockTime(new Date(t * 1000)) : "");

  return (
    <div className="relative rounded-ticket bg-ink text-white shadow-ticket">
      <div className="flex items-center justify-between gap-3 px-6 pt-[22px]">
        <span className="flex items-center gap-[9px] text-[15px] font-semibold"><Logo size={24} outline={false} />Tip receipt</span>
        <span className={`inline-flex h-7 items-center gap-[7px] rounded-full px-[11px] text-[12px] font-medium ${pill.cls}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${pill.dot}`} />
          {pill.text}
        </span>
      </div>

      <div className="px-6 pt-[30px]">
        <div className={label}>AMOUNT</div>
        <div className="mt-2 flex items-baseline gap-0.5">
          {loading ? (
            <Skeleton dark className="h-[60px] w-40" />
          ) : (
            <>
              <span className="text-[72px] font-medium leading-[0.9] tracking-hero">{whole}</span>
              <span className="text-[32px] font-medium tracking-[-0.03em] text-night-cents">{cents}</span>
              <span className="ml-2.5 font-mono text-[14px] font-semibold text-gold">DOGE</span>
            </>
          )}
        </div>
      </div>

      <div className="mx-6 mt-[26px] grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-center gap-2">
        <div className="min-w-0">
          <div className={label}>FROM</div>
          <div className="mt-1.5 truncate font-mono text-[15px] font-medium">{loading ? <Skeleton dark className="h-4 w-28" /> : p.from ? shortHash(p.from) : "You"}</div>
        </div>
        <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-night-arrow text-gold"><ArrowIcon size={13} strokeWidth={2.4} /></span>
        <div className="min-w-0 text-right">
          <div className={label}>TO</div>
          <div className="mt-1.5 truncate text-[16px] font-semibold">{loading ? <Skeleton dark className="ml-auto h-4 w-28" /> : p.to}</div>
        </div>
      </div>

      <div className="mt-7"><Perforation notch={p.notch} size={24} /></div>
      {p.note && <div className="px-6 pt-3.5 text-[14px] leading-[1.5] text-night-mist">“{p.note}”</div>}

      <ol className="relative m-0 grid list-none grid-cols-3 px-6 pt-[18px]">
        <span aria-hidden="true" className="absolute top-[29px] h-0.5 bg-gold" style={{ left: "calc(24px + 11px)", width: "calc((100% - 48px) / 3)" }} />
        <span
          aria-hidden="true"
          className={`absolute ${settled ? "top-[29px] h-0.5 bg-gold" : "top-[28px] border-t-2 border-dashed border-ink-3"}`}
          style={{ left: "calc(24px + 11px + (100% - 48px) / 3)", width: "calc((100% - 48px) / 3)" }}
        />
        <Stop done label="Sent" sub={clock(p.sentAt)} />
        <Stop done label="Held" sub="TipEscrow" />
        {p.status === "claimed" ? (
          <Stop done label="Claimed" sub="by the X account" />
        ) : p.status === "refunded" ? (
          <Stop done grey label="Refunded" sub="back to the tipper" />
        ) : (
          <li className="relative">
            <span className="block h-6 w-6 rounded-full border-2 border-dashed border-muted-2 bg-ink" />
            <div className="mt-2.5 text-[14px] font-semibold text-night-pale">Claimed</div>
            <div className="mt-0.5 font-mono text-[12px] text-muted-2">{p.refundAt ? `or refund ${clock(p.refundAt)}` : "or refund later"}</div>
          </li>
        )}
      </ol>

      <dl className="mx-6 mb-0 mt-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 rounded-card bg-night-well px-4 py-3.5 text-[13px]">
        <dt className="text-muted-2">Network</dt>
        <dd className="m-0 text-right">DogeOS Chikyū</dd>
        <dt className="text-muted-2">Transaction</dt>
        <dd className="m-0 text-right">
          {p.txHash ? (
            <a className="mt-link font-mono text-gold hover:!text-gold" href={explorerTx(p.txHash)} target="_blank" rel="noreferrer">{shortHash(p.txHash)} ↗</a>
          ) : loading ? (
            <Skeleton dark className="ml-auto h-3.5 w-24" />
          ) : (
            <span className="font-mono text-muted-2">pending</span>
          )}
        </dd>
      </dl>

      {p.shareText && p.link ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-6 pb-6 pt-[18px]">
          <a href={xIntent(p.shareText)} target="_blank" rel="noreferrer" className="mt-btn mt-btn-text flex h-[50px] items-center justify-center gap-2.5 rounded-full bg-gold text-ink no-underline">
            <XLogo size={14} />Tell them on X
          </a>
          <CopyButton value={p.link} label="Copy the claim link" className="mt-btn h-[50px] cursor-pointer rounded-full border border-night-edge bg-transparent px-5 text-[15px] font-medium text-white">
            Copy link
          </CopyButton>
        </div>
      ) : (
        <div className="h-6" />
      )}
    </div>
  );
}

function Stop({ label: text, sub, done, grey = false }: { label: string; sub: string; done: boolean; grey?: boolean }) {
  return (
    <li className="relative">
      <span className={`flex h-6 w-6 items-center justify-center rounded-full ${grey ? "bg-night-pale" : "bg-gold"} text-ink`}>{done && <CheckIcon size={12} strokeWidth={3} />}</span>
      <div className="mt-2.5 text-[14px] font-semibold">{text}</div>
      <div className="mt-0.5 font-mono text-[12px] text-muted-2">{sub}</div>
    </li>
  );
}

/** Spec A1 "Receipt preview": radius 22, amount 52 px, To, then the perforation and the note only once one is typed. */
function DraftTicket({ amount, to, note, notch }: ReceiptTicketProps) {
  const [whole, cents] = amount ? splitAmount(amount) : ["0", ".00"];
  return (
    <div className="relative rounded-[22px] bg-ink text-white shadow-draft">
      <div className="flex items-center justify-between px-[18px] pt-4">
        <span className="flex items-center gap-2 text-[14px] font-semibold"><Logo size={20} outline={false} />Tip receipt</span>
        <span className="inline-flex h-6 items-center rounded-full bg-night-chip px-2.5 text-[11px] font-medium text-night-pale">Draft</span>
      </div>
      <div className="flex items-baseline gap-0.5 px-[18px] pt-5">
        <span className={`text-[52px] font-medium leading-[0.9] tracking-hero ${amount ? "" : "text-night-cents"}`}>{whole}</span>
        <span className="text-[24px] font-medium text-night-cents">{cents}</span>
        <span className="ml-2 font-mono text-[12px] font-semibold text-gold">DOGE</span>
      </div>
      <div className={`flex justify-between gap-2.5 px-[18px] pt-3.5 text-[13px] ${note ? "" : "pb-[18px]"}`}>
        <span className="text-muted-2">To</span>
        <span className="truncate font-semibold">{to ?? "…"}</span>
      </div>
      {note && (
        <>
          <div className="mt-4"><Perforation notch={notch} size={20} /></div>
          <div className="px-[18px] pb-[18px] pt-3 text-[14px] leading-[1.5] text-night-mist">“{note}”</div>
        </>
      )}
    </div>
  );
}
