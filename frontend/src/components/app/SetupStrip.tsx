import { useState } from "react";
import { FAUCET_URL } from "../../chain/config";
import { useSetupSteps, type SetupStepState } from "../../chain/hooks";
import { CloseIcon } from "../ui/Icons";
import { useAddNetwork, useConnectWallet } from "../ui/WalletButton";

const KEY = "muchtip.setup.hidden.v1";
const readHidden = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

const LABELS = ["Connect a wallet", "Add DogeOS Chikyū", "Get test DOGE"];

function useSetupActions() {
  const { connect, isConnecting } = useConnectWallet();
  const { addNetwork, isAdding } = useAddNetwork();
  const act = "mt-btn inline-flex h-[30px] shrink-0 cursor-pointer items-center rounded-[8px] border-0 bg-ink px-3 text-[12px] font-semibold text-white no-underline";
  return [
    <button key="c" type="button" className={act} onClick={() => void connect()} disabled={isConnecting}>Connect</button>,
    <button key="a" type="button" className={act} onClick={addNetwork} disabled={isAdding}>Add</button>,
    <a key="f" className={act} href={FAUCET_URL} target="_blank" rel="noreferrer">Faucet ↗</a>,
  ];
}

const ITEM: Record<SetupStepState, string> = {
  done: "border-line-soft bg-success-wash font-medium text-success-ink",
  next: "border-ink bg-white font-semibold text-ink",
  todo: "border-line-soft bg-white font-medium text-ink",
};
const DOT: Record<SetupStepState, string> = {
  done: "bg-success text-white",
  next: "bg-gold text-ink",
  todo: "bg-surface-chip text-muted",
};

/** Spec A0 / A1: "Finish setting up" until all three steps are done (A5: gone). The ✕ hides it for this browser. */
export function SetupStrip() {
  const { states, doneCount, allDone, known } = useSetupSteps();
  const actions = useSetupActions();
  const [hidden, setHidden] = useState(readHidden);
  if (allDone || hidden || !known) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* storage unavailable: hidden for this visit only */
    }
  };
  return (
    <section aria-label="Get set up" className="mb-7 flex flex-wrap items-center gap-5 rounded-card border border-line-2 bg-white px-5 py-[18px]">
      <div className="flex-[1_1_200px]">
        <div className="text-[16px] font-bold">Finish setting up</div>
        <div className="mt-0.5 text-[13px] text-muted">{doneCount} of 3 done. Everything is on the testnet, so it's free.</div>
      </div>
      <ol className="m-0 flex flex-[3_1_560px] list-none flex-wrap gap-2 p-0">
        {states.map((s, i) => (
          <li key={LABELS[i]} className={`flex min-h-11 flex-[1_1_200px] items-center gap-2.5 rounded-btn border py-1.5 pl-2.5 pr-1.5 text-[13px] ${ITEM[s]}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${DOT[s]}`}>{s === "done" ? "✓" : i + 1}</span>
            <span className="min-w-0 flex-1">{LABELS[i]}</span>
            {s === "next" && actions[i]}
          </li>
        ))}
      </ol>
      <button type="button" aria-label="Hide setup" onClick={hide} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-surface-chip text-ink">
        <CloseIcon size={14} strokeWidth={2.4} />
      </button>
    </section>
  );
}

/** Spec P1: the phone shows only the next step, in one row. */
export function SetupRow() {
  const { states, doneCount, allDone, known } = useSetupSteps();
  const actions = useSetupActions();
  if (allDone || !known) return null;
  const i = states.indexOf("next");
  return (
    <div className="mb-[18px] flex items-center gap-2.5 rounded-[14px] border border-line-2 bg-white p-3 text-[13px]">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold text-[12px] font-semibold">{i + 1}</span>
      <span className="flex-1"><strong>{LABELS[i]}</strong> · {doneCount} of 3 done</span>
      {actions[i]}
    </div>
  );
}
