import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { encodeFunctionData, type Hex } from "viem";
import { escrowAbi } from "../../chain/abi";
import { tipPillOf, useEscrowConfig, useFeeQuote, useNow, useSentTips, useWallet } from "../../chain/hooks";
import { SetupRow } from "../../components/app/SetupStrip";
import { bigBtn, shareText, TipFlow, type Confirmed } from "../../components/app/TipFlow";
import { ReceiptTicket } from "../../components/ReceiptTicket";
import { CheckIcon, Spinner } from "../../components/ui/Icons";
import { Avatar } from "../../components/ui/Primitives";
import { useConnectWallet } from "../../components/ui/WalletButton";
import { HANDLE_RE, normalizeHandle } from "../../data/api";
import { useHandleLookup, useHandleNames, type LookupState } from "../../data/hooks";
import { PRESETS, parseDoge, sanitizeAmountInput } from "../../lib/amount";
import { formatCountdown, formatDoge, formatDogeFixed, formatDurationLong, formatFeeTo, initials } from "../../lib/format";
import { claimLink } from "../../lib/links";
import { pageTitle, useTitle } from "../../lib/title";
import { usePhone } from "../../lib/useMedia";
import { DEFAULT_AMOUNT, NOTE_PLACEHOLDER, QUOTE_SAMPLE } from "../../data/samples";

type Cta = { label: string; tone: "gold" | "ink" | "warning" | "disabled"; onClick?: () => void };
const CTA_TONE = { gold: "border-ink bg-gold text-ink", ink: "border-ink bg-ink text-white", warning: "border-warning bg-warning text-white", disabled: "" };

/**
 * /app, the Send tab. The form (A0, A1, A5, P1) leads to the send flow (S1) via ?step=review; ?tx= resumes a submitted
 * tip after a reload. The draft receipt beside the form becomes the real receipt once the tip is confirmed.
 */
export default function Send() {
  useTitle(pageTitle("Send a tip"));
  const phone = usePhone();
  const [params, setParams] = useSearchParams();
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const { refundDelaySeconds } = useEscrowConfig();
  const handle = normalizeHandle(params.get("to") ?? "");
  const amountText = params.get("amount") ?? "";
  const note = params.get("note") ?? "";
  const resumeHash = params.get("tx") as Hex | null;
  const inFlow = Boolean(resumeHash) || (params.get("step") === "review" && HANDLE_RE.test(handle) && parseDoge(amountText) !== null);

  const update = (patch: Record<string, string | null>) =>
    setParams((p) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") p.delete(k);
        else p.set(k, v);
      }
      return p;
    });

  if (!inFlow) return <SendForm phone={phone} onReview={(to, amount, n, xid) => update({ to, amount, note: n, xid, step: "review" })} />;

  const amountWei = parseDoge(amountText);
  const flow = (
    <TipFlow
      handle={handle}
      amountText={amountText}
      note={note}
      resumeHash={resumeHash}
      previewXId={params.get("xid")}
      onEdit={() => update({ step: null, tx: null })}
      onSubmitted={(hash) => update({ tx: hash, step: null })}
      onConfirmed={setConfirmed}
      onAmount={(a) => update({ amount: a })}
      onAnother={() => {
        setConfirmed(null);
        setParams({}, { replace: false });
      }}
    />
  );
  if (phone) return <div className="mx-auto max-w-[460px]">{flow}</div>;
  return (
    <>
      <h1 className="m-0 mb-1.5 text-[32px]">Send a tip</h1>
      <p className="m-0 mb-6 text-[15px] text-ink-3">Tip any X handle. They claim it when they're ready, or you get it back.</p>
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-[1.2_1_320px]">{flow}</div>
        <ReceiptColumn
          ticket={
            <ReceiptTicket
              status={confirmed ? "waiting" : "draft"}
              amount={amountWei}
              to={`@${handle}`}
              note={note}
              notePlaceholder={NOTE_PLACEHOLDER}
              notch="#F4F3EE"
              from={confirmed?.from}
              sentAt={confirmed?.time}
              refundAt={confirmed ? confirmed.refundAt ?? (refundDelaySeconds !== undefined ? confirmed.time + refundDelaySeconds : null) : null}
              txHash={confirmed?.hash}
              link={confirmed ? claimLink() : undefined}
              shareText={confirmed ? shareText(handle, amountWei, note) : undefined}
            />
          }
        />
      </div>
    </>
  );
}

function useSendForm(onReview: (to: string, amount: string, note: string, xId: string) => void) {
  const [params] = useSearchParams();
  const [input, setInput] = useState(() => normalizeHandle(params.get("to") ?? ""));
  const initialAmount = params.get("amount") ?? DEFAULT_AMOUNT;
  const isPreset = (PRESETS as readonly string[]).includes(initialAmount);
  const [preset, setPreset] = useState<string>(isPreset ? initialAmount : parseDoge(initialAmount) ? "other" : DEFAULT_AMOUNT);
  const [custom, setCustom] = useState(isPreset ? "" : sanitizeAmountInput(initialAmount));
  const [note, setNote] = useState(params.get("note") ?? "");
  const lookup = useHandleLookup(input);
  const { minTipWei, refundDelaySeconds } = useEscrowConfig();
  const wallet = useWallet();
  const { connect, isConnecting } = useConnectWallet();

  const amountText = preset === "other" ? custom : preset;
  const amountWei = parseDoge(amountText);
  const idHash = lookup.kind === "found" ? (lookup.who.idHash as Hex) : QUOTE_SAMPLE.idHash;
  const fee = useFeeQuote("tip", { data: encodeFunctionData({ abi: escrowAbi, functionName: "tip", args: [idHash] }), value: amountWei ?? 0n });
  const belowMin = amountWei !== null && minTipWei !== undefined && amountWei < minTipWei;
  const minText = minTipWei === undefined ? "…" : `${formatDoge(minTipWei)} DOGE`;

  let cta: Cta;
  if (wallet.status === "disconnected") cta = { label: "Connect wallet to continue", tone: "ink", onClick: () => void connect() };
  else if (wallet.status === "connecting" || isConnecting) cta = { label: "Connecting…", tone: "disabled" };
  // on another network the form still goes to review (spec A1); the review step asks for the switch before signing
  else if (lookup.kind === "idle") cta = { label: "Enter an X handle", tone: "disabled" };
  else if (lookup.kind === "checking") cta = { label: "Checking recipient…", tone: "disabled" };
  else if (lookup.kind === "invalid" || lookup.kind === "missing") cta = { label: "Enter a valid X handle", tone: "disabled" };
  else if (lookup.kind === "error") cta = { label: "Recipient lookup unavailable", tone: "disabled" };
  else if (amountWei === null) cta = { label: "Enter an amount", tone: "disabled" };
  else if (belowMin) cta = { label: `Minimum tip is ${minText}`, tone: "disabled" };
  else {
    const { handle: to, xId } = lookup.who;
    cta = { label: "Review tip", tone: "gold", onClick: () => onReview(to, amountText.trim(), note.trim(), xId) };
  }

  const feeText = fee.data ? formatFeeTo(fee.data.aboutWei, fee.data.upToWei) : "…";
  const total = fee.data && amountWei !== null ? `${formatDogeFixed(amountWei + fee.data.upToWei, 2, "up")} DOGE` : "…";
  return { input, setInput, preset, setPreset, custom, setCustom, note, setNote, lookup, amountWei, belowMin, minText, refundDelaySeconds, cta, feeText, total };
}
type Form = ReturnType<typeof useSendForm>;

const fieldBorder = (l: LookupState) => (l.kind === "found" ? "border-success" : l.kind === "missing" || l.kind === "invalid" || l.kind === "error" ? "border-error" : "border-line-input");

function HandleInput({ f, id, phone }: { f: Form; id: string; phone: boolean }) {
  const l = f.lookup;
  return (
    <>
      <div className={`mt-input mt-2 flex h-[52px] items-center gap-1.5 rounded-btn border bg-white px-3.5 ${fieldBorder(l)}`}>
        <span className={`font-mono font-medium text-muted-2 ${phone ? "text-[16px]" : "text-[17px]"}`} aria-hidden="true">@</span>
        <input
          id={id}
          value={f.input}
          onChange={(e) => f.setInput(normalizeHandle(e.target.value.replace(/\s/g, "")).slice(0, 16))}
          placeholder="handle"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-describedby={`${id}-msg`}
          aria-invalid={l.kind === "missing" || l.kind === "invalid" || undefined}
          className={`min-w-0 flex-1 border-0 bg-transparent font-medium text-ink outline-none placeholder:text-muted-2 ${phone ? "text-[16px]" : "text-[17px]"}`}
        />
        {l.kind === "checking" && <Spinner size={16} />}
        {l.kind === "found" && <CheckIcon className="text-success" />}
      </div>
      <div id={`${id}-msg`} aria-live="polite">
        {l.kind === "checking" && <p className="m-0 mt-2 text-[13px] text-muted">Looking up @{l.handle} on X…</p>}
        {l.kind === "invalid" && <p role="alert" className="m-0 mt-2 text-[13px] text-error">Handles are 1 to 15 letters, numbers or underscores.</p>}
        {l.kind === "missing" && <p role="alert" className="m-0 mt-2 text-[13px] text-error">No X account called @{l.handle}.</p>}
        {l.kind === "error" && <p role="alert" className="m-0 mt-2 text-[13px] text-error">{l.message}</p>}
        {l.kind === "found" &&
          (phone ? (
            <div className="mt-2 rounded-btn border border-success-line bg-success-wash px-3 py-2.5 text-[13px]">
              <strong>{l.who.name ?? l.who.handle}</strong> <span className="text-muted">@{l.who.handle}</span>
              <div className="font-mono text-[11px] text-ink-2">X ID {l.who.xId} · {l.who.source === "demo" ? "demo lookup" : "verified on X"}</div>
            </div>
          ) : (
            <div className="mt-in mt-2.5 flex items-center gap-3 rounded-btn border border-success-line bg-success-wash p-3">
              <Avatar text={initials(l.who.name, l.who.handle)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">{l.who.name ?? l.who.handle} <span className="font-normal text-muted">@{l.who.handle}</span></div>
                <div className="font-mono text-[12px] text-ink-2">X ID {l.who.xId}</div>
              </div>
              <span className="text-[12px] font-medium text-success-ink">{l.who.source === "demo" ? "Demo lookup" : "Verified on X"}</span>
            </div>
          ))}
      </div>
    </>
  );
}

function Presets({ f, other }: { f: Form; other: boolean }) {
  const btn = (on: boolean, mono = true) =>
    `h-[46px] cursor-pointer rounded-ctl border text-[15px] ${mono ? "font-mono" : "font-sans"} ${on ? "border-ink bg-ink font-semibold text-white" : "border-line-input bg-white font-medium text-ink"}`;
  return (
    <div className={`mt-2 grid gap-2 ${other ? "grid-cols-5" : "grid-cols-4"}`} role="group" aria-label="Amount in DOGE">
      {PRESETS.map((p) => (
        <button key={p} type="button" aria-pressed={f.preset === p} onClick={() => f.setPreset(p)} className={btn(f.preset === p)}>{p}</button>
      ))}
      {other && <button type="button" aria-pressed={f.preset === "other"} onClick={() => f.setPreset("other")} className={btn(f.preset === "other", false)}>Other</button>}
    </div>
  );
}

function CustomAmount({ f }: { f: Form }) {
  if (f.preset !== "other") return null;
  return (
    <div className={`mt-input mt-2 flex h-12 items-center gap-2 rounded-btn border bg-white px-3.5 ${f.belowMin ? "border-error" : "border-ink"}`}>
      <label htmlFor="ap-custom" className="sr-only">Custom amount in DOGE</label>
      <input id="ap-custom" inputMode="decimal" autoFocus value={f.custom} onChange={(e) => f.setCustom(sanitizeAmountInput(e.target.value))} placeholder="0" className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[17px] font-semibold text-ink outline-none placeholder:text-muted-2" />
      <span className="font-mono text-[13px] font-medium text-muted">DOGE</span>
    </div>
  );
}

function SendForm({ phone, onReview }: { phone: boolean; onReview: (to: string, amount: string, note: string, xId: string) => void }) {
  const f = useSendForm(onReview);
  const windowText = f.refundDelaySeconds === undefined ? "the refund window" : formatDurationLong(f.refundDelaySeconds);
  const ctaCls = `${bigBtn} ${CTA_TONE[f.cta.tone]}`;

  if (phone)
    return (
      <div>
        <SetupRow />
        <label htmlFor="m-h" className="block text-[13px] font-semibold">Who are you tipping?</label>
        <HandleInput f={f} id="m-h" phone />
        <div className="mt-[18px] text-[13px] font-semibold">Amount</div>
        <Presets f={f} other={false} />
        <CustomAmount f={f} />
        <div className="mt-4 flex flex-col gap-2 rounded-btn border border-line-soft bg-white p-3 text-[13px]">
          <div className="flex justify-between"><span className="text-muted">Network fee</span><span className="font-mono">{f.feeText}</span></div>
          <div className="flex justify-between"><span className="font-semibold">You pay at most</span><span className="font-mono font-semibold">{f.amountWei === null ? "…" : f.total}</span></div>
        </div>
        <button type="button" disabled={f.cta.tone === "disabled"} onClick={f.cta.onClick} className={`${ctaCls} mt-4 !h-[54px] !rounded-[14px]`}>
          {f.cta.label === "Review tip" && f.amountWei !== null ? `Review tip · ${formatDoge(f.amountWei)} DOGE` : f.cta.label}
        </button>
        <p className="m-0 mt-2.5 text-center text-[12px] text-muted">Refundable after {windowText} if unclaimed.</p>
      </div>
    );

  return (
    <>
      <h1 className="m-0 mb-1.5 text-[32px]">Send a tip</h1>
      <p className="m-0 mb-6 text-[15px] text-ink-3">Tip any X handle. They claim it when they're ready, or you get it back.</p>
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-[1.2_1_320px] rounded-panel border border-ink bg-white p-5">
          <label htmlFor="ap-handle" className="text-[13px] font-semibold">Who are you tipping?</label>
          <HandleInput f={f} id="ap-handle" phone={false} />
          <div className="mt-[22px] flex justify-between">
            <span className="text-[13px] font-semibold">Amount</span>
            <span className="font-mono text-[12px] text-muted">min {f.minText}</span>
          </div>
          <Presets f={f} other />
          <CustomAmount f={f} />
          <label htmlFor="ap-note" className="mt-5 block text-[13px] font-semibold">Note <span className="font-normal text-muted">optional, shown on the receipt</span></label>
          <div className="mt-input mt-2 rounded-btn">
            <input id="ap-note" value={f.note} maxLength={120} onChange={(e) => f.setNote(e.target.value)} placeholder={NOTE_PLACEHOLDER} className="h-12 w-full rounded-btn border border-line-input px-3.5 text-[15px] outline-none placeholder:text-muted-2" />
          </div>
          <dl className="m-0 mt-5 flex flex-col gap-[9px] rounded-btn bg-surface-well p-3.5 text-[14px]">
            <div className="flex justify-between"><dt className="text-muted">Tip</dt><dd className="m-0 font-mono font-medium">{f.amountWei === null ? "…" : `${formatDoge(f.amountWei)} DOGE`}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Network fee, estimated</dt><dd className="m-0 font-mono font-medium">{f.feeText} DOGE</dd></div>
            <div className="flex justify-between border-t border-dashed border-line-input pt-[9px]"><dt className="font-semibold">You pay at most</dt><dd className="m-0 font-mono text-[15px] font-semibold">{f.amountWei === null ? "…" : f.total}</dd></div>
          </dl>
          <button type="button" disabled={f.cta.tone === "disabled"} onClick={f.cta.onClick} className={`${ctaCls} mt-[18px] !h-14`}>{f.cta.label}</button>
          <p className="m-0 mt-2.5 text-center text-[12px] text-muted">Not claimed within {windowText}? You can take it back from My tips.</p>
        </div>
        <ReceiptColumn
          ticket={<ReceiptTicket status="draft" amount={f.amountWei} to={f.lookup.kind === "found" ? `@${f.lookup.who.handle}` : f.input ? `@${f.input}` : null} note={f.note.trim()} notePlaceholder={NOTE_PLACEHOLDER} notch="#F4F3EE" />}
        />
      </div>
    </>
  );
}

/** The right column of A1: the receipt preview and "Recently sent" from the connected wallet. */
function ReceiptColumn({ ticket }: { ticket: React.ReactNode }) {
  const wallet = useWallet();
  const sent = useSentTips(wallet.address);
  const fallbackName = useHandleNames();
  const nameOf = (idHash: string) => {
    const h = sent.handles.get(idHash.toLowerCase());
    return h ? `@${h}` : fallbackName(idHash);
  };
  const now = useNow();
  // W2.11: the latest 3 rows of My tips (same source)
  const recent = (sent.tips ?? []).slice(0, 3);
  const status = (t: (typeof recent)[number]) => {
    const pill = tipPillOf(t, now);
    if (pill === "claimed") return <span className="text-success-ink">claimed</span>;
    if (pill === "refunded") return <span className="text-muted">refunded</span>;
    if (pill === "refundable") return <span className="text-warning">refundable</span>;
    return <span className="text-warning">refund in {formatCountdown(t.refundableAt - now)}</span>;
  };
  return (
    <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
      <div className="text-[12px] font-medium text-muted">Receipt preview</div>
      {ticket}
      <div className="overflow-hidden rounded-card border border-line-2 bg-white">
        <div className="flex justify-between border-b border-line-soft px-4 py-3.5">
          <span className="text-[14px] font-semibold">Recently sent</span>
          <Link to="/app/tips" className="mt-link text-[13px] font-medium text-gold-ink">My tips →</Link>
        </div>
        {!wallet.address ? (
          <div className="px-4 py-3 text-[13px] text-muted">Connect a wallet to see the tips you sent.</div>
        ) : sent.tips === undefined ? (
          <div className="px-4 py-3 text-[13px] text-muted">Reading the contract…</div>
        ) : recent.length === 0 ? (
          <div className="px-4 py-3 text-[13px] text-muted">No tips from this wallet yet.</div>
        ) : (
          recent.map((t) => (
            <div key={t.id.toString()} className="mt-row flex justify-between gap-3 border-b border-line-faint px-4 py-3 text-[13px] last:border-b-0">
              <span className="min-w-0 truncate">{nameOf(t.idHash)}</span>
              <span className="font-mono">{formatDoge(t.amountWei, 2)} DOGE</span>
              <span>{status(t)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
