import { useId, useState } from "react";
import { SOURCE_URL } from "../../chain/config";
import { useEscrowConfig } from "../../chain/hooks";
import { formatDoge, formatDurationLong } from "../../lib/format";
import { PlusIcon } from "../ui/Icons";

/** Spec L0 "Much ask. Such answer." The first answer is open by default. Values are read from the contract. */
export function Faq() {
  const [open, setOpen] = useState(0);
  const base = useId();
  const { minTipWei, refundDelaySeconds } = useEscrowConfig();
  const windowText = refundDelaySeconds === undefined ? "the refund window" : formatDurationLong(refundDelaySeconds);
  const minText = minTipWei === undefined ? "the contract's minimum" : `${formatDoge(minTipWei)} DOGE`;
  const faq = [
    { q: "Does the person I tip need a wallet right away?", a: "No. The tip waits in the contract, tied to their X account. They only need a wallet when they decide to claim." },
    { q: "What happens if they never claim?", a: `After ${windowText} you can take the tip back yourself from My tips. The window is set in the contract, short on this testnet so you can try it.` },
    { q: "Could someone else claim my tip?", a: "Only the X account you tipped. Tips are tied to the account's permanent numeric X ID, and claiming requires signing in with that account." },
    { q: "What does a tip cost?", a: `Your tip, at least ${minText}, plus a small DogeOS network fee. We show an estimate and an upper limit before you sign, because the fee moves with network load.` },
    { q: "Does MuchTip ever hold my DOGE?", a: "No. Tips go straight into the TipEscrow contract, never to a MuchTip wallet. Our server only looks up X IDs and approves claims after an X sign-in." },
    { q: "Is this real DOGE?", a: "Not yet. MuchTip runs on the DogeOS Chikyū testnet, so every tip uses free test DOGE from the faucet." },
  ];

  return (
    <section id="faq" className="border-b border-line">
      <div data-reveal="group" className="mx-auto flex max-w-site flex-wrap gap-16 px-8 py-[104px] max-[480px]:px-4">
        <div className="flex-[1_1_300px]">
          <h2 className="m-0 text-[clamp(34px,3.6vw,48px)] leading-[1.04]">Much ask.<br />Such answer.</h2>
          <p className="m-0 mt-4 max-w-[280px] text-[15px] text-ink-3">
            Anything else? The contract is public on <a className="mt-link text-gold-ink underline underline-offset-[3px]" href={SOURCE_URL} target="_blank" rel="noreferrer">GitHub</a>.
          </p>
        </div>
        <div data-reveal="group" className="flex-[2_1_560px] border-t border-ink">
          {faq.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q} className="border-b border-line">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  aria-expanded={isOpen}
                  aria-controls={`${base}-${i}`}
                  className="flex min-h-16 w-full cursor-pointer items-center justify-between gap-4 border-0 bg-transparent py-[18px] text-left text-[17px] font-semibold text-ink"
                >
                  <span>{f.q}</span>
                  <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] transition-[transform,background-color] duration-200 ease-out ${isOpen ? "rotate-45 bg-ink text-gold" : "bg-surface-chip text-ink"}`} aria-hidden="true">
                    <PlusIcon />
                  </span>
                </button>
                <div id={`${base}-${i}`} className="mt-collapse" data-open={isOpen} inert={!isOpen}>
                  <div>
                    <p className="m-0 pb-[22px] pr-12 text-[15px] leading-[1.6] text-ink-3">{f.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
