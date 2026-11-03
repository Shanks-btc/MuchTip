import { FAUCET_URL } from "../../chain/config";
import { useSetupSteps, type SetupStepState } from "../../chain/hooks";
import { useAddNetwork } from "../ui/WalletButton";

const MYDOGE_URL = "https://www.mydoge.com";

const CARD: Record<SetupStepState, string> = {
  done: "bg-paper border-line-2",
  next: "bg-white border-ink",
  todo: "bg-paper border-line-2",
};
const BTN: Record<SetupStepState, string> = {
  done: "border-line-input bg-white text-muted",
  next: "border-ink bg-ink text-white",
  todo: "border-line-input bg-white text-ink",
};

/** Spec G0 / L0 / G3: three setup cards whose state comes from the wallet, its chain and its balance. */
export function GetStarted() {
  const { states } = useSetupSteps();
  const { addNetwork, isAdding } = useAddNetwork();
  const btn = (s: SetupStepState) => `mt-btn mt-[22px] inline-flex h-[42px] cursor-pointer items-center self-start rounded-ctl border px-4 text-[14px] font-semibold no-underline ${BTN[s]}`;
  const steps = [
    { title: "Get a wallet", body: "MyDoge or MetaMask both work. If you already have one, you can skip this.", action: <a className={btn(states[0])} href={MYDOGE_URL} target="_blank" rel="noreferrer">Get MyDoge ↗</a> },
    {
      title: "Add DogeOS Chikyū",
      body: "One click adds the network to your wallet. No settings to copy by hand.",
      action: <button type="button" className={btn(states[1])} onClick={addNetwork} disabled={isAdding}>Add network</button>,
    },
    { title: "Get free test DOGE", body: "The faucet gives you free test DOGE every day. That is plenty for a handful of tips.", action: <a className={btn(states[2])} href={FAUCET_URL} target="_blank" rel="noreferrer">Open faucet ↗</a> },
  ];

  return (
    <section id="start" className="border-b border-line">
      <div className="mx-auto max-w-site px-8 py-24 max-[480px]:px-4">
        <div data-reveal className="flex flex-wrap items-end justify-between gap-5">
          <h2 className="m-0 max-w-[620px] text-[clamp(32px,3.4vw,46px)] leading-[1.05]">New to DogeOS? You're two minutes from your first tip.</h2>
          <p className="m-0 max-w-[340px] text-[15px] text-ink-3">Everything here runs on the testnet, so the DOGE is free and nothing is at risk.</p>
        </div>
        <div data-reveal="group" className="mt-11 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
          {steps.map((s, i) => (
            <div key={s.title} className={`mt-step flex min-h-[260px] flex-col rounded-card border p-6 ${CARD[states[i]]}`}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[12px] font-medium text-muted">Step {i + 1}</span>
                {states[i] === "done" && <span className="rounded-[6px] bg-success-bg px-[9px] py-1 text-[12px] font-semibold text-success-ink">Done</span>}
                {states[i] === "next" && <span className="rounded-[6px] bg-tipped-bg px-[9px] py-1 text-[12px] font-semibold text-tipped-ink">Next</span>}
              </div>
              <h3 className="m-0 mb-2 mt-[22px] text-[21px]">{s.title}</h3>
              <p className="m-0 text-[15px] leading-[1.55] text-ink-3">{s.body}</p>
              <div className="flex-1" />
              {s.action}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
