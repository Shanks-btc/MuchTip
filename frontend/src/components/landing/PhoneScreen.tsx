import { ArrowIcon, CheckIcon, ClaimIcon, ClockIcon, PeopleIcon, PulseIcon, RefundIcon, SendIcon, TipsIcon, WalletIcon } from "../ui/Icons";
import { PERSONAS } from "../../data/samples";

// Spec K1: renders one of the sample personas in src/data/samples.ts. No wallet, no fetches.

const TILE_ICON = {
  clock: <ClockIcon />,
  refund: <RefundIcon />,
  check: <CheckIcon size={12} strokeWidth={2.4} />,
  people: <PeopleIcon />,
};
const NAV = [SendIcon, ClaimIcon, TipsIcon, PulseIcon];
const tiny = "font-mono text-[9.5px] font-medium tracking-[0.1em] text-muted";

/** The screen inside a hero phone. `banner` shows the "Demo accounts · testnet" strip (the centre phone). */
export function PhoneScreen({ persona, banner }: { persona: number; banner: boolean }) {
  const p = PERSONAS[persona];
  return (
    <div className="absolute inset-0 overflow-hidden bg-paper-stage text-left tracking-[-0.01em] text-ink">
      {banner && (
        <div className="flex items-center justify-between gap-2 bg-gold-banner px-3.5 py-[9px] text-[11px] text-gold-on">
          <span>Demo accounts · testnet</span>
          <span className="font-semibold underline underline-offset-2">Open app</span>
        </div>
      )}

      <div className="flex items-center gap-2.5 px-3.5 pb-3 pt-4">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold ${p.avatar}`}>{p.initial}</span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-2">{p.role}</div>
          <div className="text-[16px] font-semibold tracking-[-0.02em]">{p.name}</div>
        </div>
        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-line-icon bg-white"><WalletIcon /></span>
      </div>

      <div className="mx-2.5 rounded-[22px] bg-[linear-gradient(160deg,#2A2B33_0%,#0E0F14_55%,#0B0B0F_100%)] px-4 pb-4 pt-[18px] text-white shadow-[0_10px_24px_-12px_rgba(14,15,20,.5)]">
        <div className="flex items-center justify-between">
          <span className={`${tiny} !text-night-soft`}>{p.card.label}</span>
          <span className={`inline-flex h-[22px] items-center rounded-full px-2 font-mono text-[9px] font-semibold tracking-[0.08em] ${p.card.chipGold ? "bg-gold text-ink" : "bg-night-edge text-night-mist"}`}>{p.card.chip}</span>
        </div>
        <div className="mt-3.5 flex items-baseline gap-0.5">
          <span className="text-[40px] font-medium leading-none tracking-heading">{p.card.whole}</span>
          <span className="text-[20px] font-medium tracking-[-0.03em] text-muted-3">{p.card.cents}</span>
          <span className="ml-1.5 font-mono text-[11px] font-semibold text-gold">DOGE</span>
        </div>
        <div className="mt-1.5 text-[11.5px] text-night-soft">{p.card.caption}</div>
        <div className="mt-4 grid grid-cols-3 gap-1.5">
          {p.card.actions.map((a, i) => (
            <span key={a} className={`flex h-[38px] items-center justify-center rounded-full text-[12px] ${i === 0 ? "bg-white font-semibold text-ink" : "border border-night-edge bg-night-chip font-medium"}`}>{a}</span>
          ))}
        </div>
      </div>

      <div className="mx-2.5 mt-2 grid grid-cols-3 gap-1.5">
        {p.tiles.map((t) => (
          <div key={t.label} className={`relative flex min-h-[86px] flex-col justify-end rounded-[16px] px-2.5 pb-2.5 pt-3 ${t.tone}`}>
            <span className="absolute right-[9px] top-[9px] flex h-6 w-6 items-center justify-center rounded-full bg-white/75">{TILE_ICON[t.icon]}</span>
            <div className="text-[22px] font-medium leading-none tracking-[-0.04em]">{t.value}</div>
            <div className="mt-1 text-[10.5px] text-ink-3">{t.label}</div>
          </div>
        ))}
      </div>

      <div className={`mx-2.5 mt-2 rounded-[20px] p-3.5 ${p.feature.tone}`}>
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <div className={tiny}>{p.feature.label}</div>
            <div className="mt-1.5 text-[16.5px] font-medium leading-[1.2] tracking-[-0.025em]">{p.feature.title}</div>
          </div>
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-ink text-white"><ArrowIcon size={15} /></span>
        </div>
        <div className="mt-3 flex flex-wrap gap-[5px]">
          {p.feature.chips.map((c) => <span key={c} className="inline-flex h-[22px] items-center rounded-full bg-white px-2 font-mono text-[9px] font-semibold tracking-[0.06em]">{c}</span>)}
        </div>
      </div>

      <div className="mx-2.5 mt-2 rounded-[18px] bg-white px-3.5 py-3">
        <div className="text-[13px] font-semibold">{p.list.title}</div>
        {p.list.rows.map(([l, r]) => (
          <div key={l} className="flex items-center justify-between pt-[9px] text-[11.5px]">
            <span className="text-ink-2">{l}</span>
            <span className="font-mono text-[11px] font-medium">{r}</span>
          </div>
        ))}
      </div>

      <div className="absolute bottom-3.5 left-1/2 flex h-[50px] -translate-x-1/2 items-center gap-1 rounded-full bg-white px-1.5 shadow-[0_8px_24px_-8px_rgba(14,15,20,.25)]">
        {NAV.map((Icon, i) => (
          <span key={i} className={`flex h-10 w-10 items-center justify-center rounded-full ${i === p.nav ? "bg-gold" : ""}`}><Icon /></span>
        ))}
      </div>
    </div>
  );
}
