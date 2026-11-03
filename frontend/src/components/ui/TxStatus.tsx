import { explorerTx } from "../../chain/config";
import { shortHash } from "../../lib/format";
import { CopyButton } from "./Copy";

// "Submitted, not yet confirmed" (spec S1 state 3): the three steps and the transaction row. Never says "sent".
export function TxSteps({ included }: { included: boolean }) {
  const steps = [
    { label: "Signed in wallet", done: true },
    { label: "Broadcast to DogeOS", done: true },
    { label: "Included in a block", done: included },
  ];
  return (
    <ol className="m-0 mt-5 flex list-none flex-col gap-3.5 p-0 text-[14px]">
      {steps.map((s) => (
        <li key={s.label} className="flex items-center gap-3">
          {s.done ? (
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-success text-[12px] text-white" aria-hidden="true">✓</span>
          ) : (
            <span className="inline-block h-[22px] w-[22px] rounded-full border-2 border-gold-spin" aria-hidden="true" />
          )}
          {s.done ? s.label : <strong>{s.label}</strong>}
          <span className="sr-only">{s.done ? "done" : "waiting"}</span>
        </li>
      ))}
    </ol>
  );
}

export function TxRow({ hash }: { hash: string }) {
  const btn = "mt-btn inline-flex h-8 cursor-pointer items-center rounded-[8px] border border-line-input bg-white px-2.5 text-[12px] font-semibold text-ink no-underline";
  return (
    <div className="mt-5 flex items-center justify-between gap-3 rounded-ctl border border-line-soft p-3">
      <div className="min-w-0">
        <div className="font-mono text-[11px] font-medium text-muted">TRANSACTION</div>
        <div className="mt-1 truncate font-mono text-[13px] font-medium text-gold-ink">{shortHash(hash)}</div>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <CopyButton value={hash} label="Copy transaction hash" className={btn} />
        <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className={btn}>Explorer ↗</a>
      </div>
    </div>
  );
}
