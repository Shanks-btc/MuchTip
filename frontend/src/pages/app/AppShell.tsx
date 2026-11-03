import { useMemo } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useClaimSummary, useNow, useRefundableCount, useWallet } from "../../chain/hooks";
import { SetupStrip } from "../../components/app/SetupStrip";
import { ClaimIcon, Logo, PulseIcon, SendIcon, TipsIcon } from "../../components/ui/Icons";
import { WalletButton } from "../../components/ui/WalletButton";
import { idHashOf } from "../../data/api";
import { useXSession } from "../../data/auth";
import { usePhone } from "../../lib/useMedia";

const TABS = [
  { to: "/app", end: true, label: "Send", title: "Send a tip", Icon: SendIcon, count: "none" },
  { to: "/app/claim", end: false, label: "Claim", title: "Claim", Icon: ClaimIcon, count: "claim" },
  { to: "/app/tips", end: false, label: "My tips", title: "My tips", Icon: TipsIcon, count: "tips" },
  { to: "/app/activity", end: false, label: "Activity", title: "Activity", Icon: PulseIcon, count: "none" },
] as const;

/**
 * Tab badges (W4.4, W4.5): Pending tips for the signed-in X account (hidden when signed out) and refundable tips for
 * the connected wallet. Same sources as the Claim and My tips pages.
 */
function useTabCounts() {
  const wallet = useWallet();
  const x = useXSession();
  const idHash = useMemo(() => (x.account ? idHashOf(x.account.xId) : null), [x.account]);
  const waiting = useClaimSummary(idHash);
  const now = useNow(5000);
  const refundable = useRefundableCount(wallet.address, now);
  return { claim: idHash ? waiting.pending.length : 0, tips: wallet.address ? refundable : 0, none: 0 };
}

/** The product app at /app (spec A0–A5): header with tabs, the setup strip, and under 640px the phone layout (P1–P4). */
export default function AppShell() {
  const phone = usePhone();
  const counts = useTabCounts();
  const { pathname } = useLocation();
  const current = [...TABS].reverse().find((t) => (t.end ? pathname === t.to : pathname.startsWith(t.to))) ?? TABS[0];

  return (
    <div className="min-h-screen w-full bg-paper-app font-sans text-ink antialiased">
      {phone ? (
        <header className="sticky top-0 z-20 flex h-[60px] items-center justify-between border-b border-line bg-paper px-4">
          <Link to="/" aria-label="MuchTip home" className="flex items-center gap-2 text-ink no-underline">
            <Logo size={26} />
            <span className="text-[17px] font-bold">{current.title}</span>
          </Link>
          <WalletButton phone />
        </header>
      ) : (
        <header className="sticky top-0 z-20 border-b border-line bg-paper">
          <div className="mx-auto flex h-[68px] max-w-app items-center justify-between gap-5 px-7">
            <Link to="/" className="flex items-center gap-2.5 text-ink no-underline">
              <Logo size={28} />
              <span className="text-[18px] font-bold">MuchTip</span>
            </Link>
            <nav aria-label="App" className="flex gap-1 rounded-btn bg-surface-track p-1 max-[900px]:hidden">
              {TABS.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) =>
                    `inline-flex h-[38px] items-center gap-2 rounded-[9px] px-4 text-[14px] no-underline ${isActive ? "bg-white font-semibold text-ink shadow-tab" : "font-medium text-ink-3 hover:text-ink"}`
                  }
                >
                  {t.label}
                  {counts[t.count] > 0 && (
                    <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-ink ${t.count === "claim" ? "bg-gold" : "bg-line-badge"}`}>{counts[t.count]}</span>
                  )}
                </NavLink>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line-2 bg-white px-3 text-[12px] font-medium max-[900px]:hidden">
                <span className="h-[7px] w-[7px] rounded-full bg-gold" />DogeOS Chikyū
              </span>
              <WalletButton />
            </div>
          </div>
        </header>
      )}

      <main className="mx-auto max-w-app px-7 pb-20 pt-8 max-[639px]:px-4 max-[639px]:pt-4 max-[900px]:pb-[120px]">
        {!phone && <SetupStrip />}
        {/* each tab rises in when you switch to it */}
        <div key={pathname} className="mt-in">
          <Outlet />
        </div>
      </main>

      {/* bottom tab bar on phones (P1–P4); the desktop tabs hide under 900px, so it shows there too */}
      <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-20 grid h-[84px] grid-cols-4 gap-1 border-t border-line bg-paper px-3 pb-5 pt-2 min-[901px]:hidden">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `flex flex-col items-center justify-center gap-1 text-[11px] no-underline ${isActive ? "font-semibold text-ink" : "font-medium text-muted-2"}`}>
            {({ isActive }) => (
              <>
                <span className={`relative flex h-[30px] w-12 items-center justify-center rounded-ctl ${isActive ? "bg-gold" : ""}`}>
                  <t.Icon size={20} />
                  {counts[t.count] > 0 && (
                    <span className="absolute -right-2 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-[1.5px] border-paper bg-gold px-1 text-[10px] font-bold text-ink">{counts[t.count]}</span>
                  )}
                </span>
                <span>{t.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
