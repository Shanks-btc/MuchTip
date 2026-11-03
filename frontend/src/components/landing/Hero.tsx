import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowIcon } from "../ui/Icons";
import { PERSONAS } from "../../data/samples";
import { PhoneScreen } from "./PhoneScreen";

// Spec "Build notes · Hero persona switcher": three phones always mounted, absolutely positioned from the centre.
// slot = (i - persona + 3) % 3: 0 centre, 1 right (+372px), 2 left (-372px).
const SLOT = [
  { transform: "translateX(-50%)", zIndex: 3, boxShadow: "0 50px 90px -30px rgba(14,15,20,.5), 0 16px 30px -18px rgba(14,15,20,.3)" },
  { transform: "translateX(calc(-50% + 372px)) translateY(52px) scale(.9)", zIndex: 2, boxShadow: "0 24px 50px -30px rgba(14,15,20,.35)" },
  { transform: "translateX(calc(-50% - 372px)) translateY(52px) scale(.9)", zIndex: 2, boxShadow: "0 24px 50px -30px rgba(14,15,20,.35)" },
];

/** L0 / L1 / L2 / L1m: gold hero, headline, CTAs and the persona phones. Leo (1) is selected by default. */
export function Hero() {
  const [persona, setPersona] = useState(1);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + 3) % 3;
    setPersona(n);
    tabs.current[n]?.focus();
  };

  return (
    <>
      <section id="top" className="overflow-hidden bg-gold">
        <div data-reveal="group" className="mx-auto max-w-site px-8 pt-16 text-center max-[480px]:px-4">
          <p className="mt-eyebrow m-0 inline-flex h-[34px] items-center gap-2.5 rounded-full border border-ink/[0.12] bg-white/50 px-4 text-gold-on">
            <span className="mt-pulse inline-block h-[7px] w-[7px] rounded-full bg-success" />Live on the DogeOS testnet
          </p>
          <h1 className="mt-h1 mx-auto mb-0 mt-6 max-w-[1000px] text-[clamp(36px,4.6vw,66px)]">
            Tip any X handle in{" "}DOGE.<br />
            They claim it, or you get it{" "}back.
          </h1>
          <p className="mt-lead mx-auto mb-0 mt-6 max-w-[640px] text-gold-text">
            Send DOGE to any X handle. It’s held in a smart contract, locked to their X account, until they sign in and claim it. If they never do, it comes back to you.
          </p>
          <div className="mt-[34px] flex flex-wrap justify-center gap-2.5">
            <Link to="/app" className="mt-btn mt-btn-text inline-flex h-[54px] items-center gap-2.5 rounded-full bg-ink px-7 text-white no-underline">
              Open app<ArrowIcon />
            </Link>
            <a href="#how" className="mt-btn mt-btn-text inline-flex h-[54px] items-center rounded-full border border-ink/[0.18] bg-white/55 px-[26px] text-ink no-underline">How it works</a>
          </div>

          <div className="relative mx-auto mt-[52px] max-w-[1180px] rounded-t-[36px] bg-paper-stage pt-7 max-[639px]:rounded-t-[28px]">
            <div className="px-4">
              <div role="tablist" aria-label="See MuchTip as" className="ph-switch inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-line p-[5px]">
                {PERSONAS.map((p, i) => {
                  const on = persona === i;
                  return (
                    <button
                      key={p.name}
                      ref={(el) => { tabs.current[i] = el; }}
                      role="tab"
                      type="button"
                      aria-selected={on}
                      tabIndex={on ? 0 : -1}
                      onClick={() => setPersona(i)}
                      onKeyDown={(e) => onKey(e, i)}
                      className={`mt-btn inline-flex h-11 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border-0 py-0 pl-1.5 pr-[18px] text-[14px] ${on ? "bg-white shadow-persona" : "bg-transparent"}`}
                    >
                      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold ${p.avatar}`}>{p.initial}</span>
                      <span className="font-semibold text-ink">{p.name}</span>
                      <span className="font-normal text-muted-3 max-[639px]:hidden">{p.tabRole}</span>
                    </button>
                  );
                })}
              </div>
              <p key={persona} className="mt-in mx-auto mb-0 mt-3.5 min-h-[46px] max-w-[560px] text-[15px] leading-[1.5] text-ink-3" aria-live="polite">{PERSONAS[persona].blurb}</p>
            </div>

            <div className="relative mt-5 h-[560px] overflow-hidden max-[860px]:h-[600px]">
              {PERSONAS.map((p, i) => {
                const slot = (i - persona + 3) % 3;
                return (
                  <button
                    key={p.name}
                    type="button"
                    aria-label={p.aria}
                    tabIndex={slot === 0 ? -1 : 0}
                    onClick={() => setPersona(i)}
                    className={`ph mt-btn absolute left-1/2 top-0 h-[690px] w-[330px] cursor-pointer rounded-[54px] border border-line-bezel bg-[linear-gradient(150deg,#FFFFFF_0%,#EDEBE5_100%)] p-[9px] font-sans text-ink ${slot ? "ph-side" : ""}`}
                    style={SLOT[slot]}
                  >
                    <span className="flex h-full w-full flex-col overflow-hidden rounded-[45px] bg-paper-stage text-left shadow-[inset_0_0_0_1px_rgba(14,15,20,.07)]">
                      <span className="relative flex h-[42px] shrink-0 items-center justify-between pb-0 pl-8 pr-[26px] pt-1 text-[13px] font-semibold tracking-[-0.01em]">
                        <span>9:41</span>
                        <span className="absolute left-1/2 top-[11px] h-[27px] w-[94px] -translate-x-1/2 rounded-full bg-ink" />
                        <span className="ph-icons flex items-end gap-0.5"><i /><i /><i /></span>
                      </span>
                      <span className="relative block flex-1">
                        <PhoneScreen persona={i} banner={slot === 0} />
                      </span>
                    </span>
                  </button>
                );
              })}
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-[90px] bg-gradient-to-b from-paper-stage/0 to-paper-stage" />
            </div>
          </div>
        </div>
      </section>
      <p className="m-0 px-8 pt-[18px] text-center text-[13px] text-muted-3 max-[480px]:px-4">Sample accounts shown for illustration. Every tip in the app is real, on the DogeOS testnet.</p>
    </>
  );
}
