import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { escrowAbi } from "../../chain/abi";
import { CHAIN_ID, ESCROW_ADDRESS, FAUCET_URL, explorerTx } from "../../chain/config";
import { CANCELLED, describeTxError, type TxError } from "../../chain/errors";
import { coversTip } from "../../chain/fees";
import { feePaid, revertReason, tipIdOf } from "../../chain/tx";
import { apiErrorMessage, idHashOf } from "../../data/api";
import { useEscrowConfig, useFeeQuote, useWallet } from "../../chain/hooks";
import { useFreshResolve } from "../../data/hooks";
import type { ResolvedHandle } from "../../data/types";
import { parseDoge } from "../../lib/amount";
import { rememberHandle } from "../../lib/handleBook";
import { formatClock, formatDoge, formatDogeFixed, formatDurationLong, formatFeeRange, initials, shortAddr, shortHash } from "../../lib/format";
import { claimLink, xIntent } from "../../lib/links";
import { CloseIcon, CheckIcon, Spinner, XLogo } from "../ui/Icons";
import { Avatar } from "../ui/Primitives";
import { TxRow, TxSteps } from "../ui/TxStatus";
import { useConnectWallet, useSwitchToChikyu } from "../ui/WalletButton";
import { QUOTE_SAMPLE } from "../../data/samples";

// Spec S1: the six states of the send flow, in the order a user meets them. Success is only shown after the receipt is
// mined; until then the UI says "submitted", never "sent".

type Step = { kind: "review" } | { kind: "wallet" } | { kind: "submitted"; hash: Hex } | { kind: "failed"; error: TxError };
export interface Confirmed {
  hash: Hex;
  /** block time, unix seconds */
  time: number;
  /** from the Tipped log */
  tipId: bigint | null;
  /** refundableAt(tipId) read from the contract, unix seconds */
  refundAt: number | null;
  from: Address;
}

const card = "mt-in rounded-card border border-ink bg-white p-[22px]";
const title = "text-[17px] font-semibold";
const mono = "font-mono text-[13px]";
export const bigBtn = "mt-btn flex h-[52px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-btn border text-[16px] font-semibold no-underline disabled:cursor-not-allowed disabled:border-line-2 disabled:bg-surface-chip disabled:text-muted-2";
const gold = `${bigBtn} border-ink bg-gold text-ink`;

function Recipient({ who }: { who: ResolvedHandle }) {
  return (
    <div className="mt-[18px] flex items-center gap-3 rounded-ctl border border-line-soft p-3">
      <Avatar text={initials(who.name, who.handle)} size={40} />
      <div className="min-w-0">
        <div className="truncate font-semibold">{who.name ?? who.handle} <span className="font-normal text-muted">@{who.handle}</span></div>
        <div className="font-mono text-[12px] text-ink-2">X ID {who.xId}</div>
      </div>
    </div>
  );
}

/**
 * Wiring-spec W2.10: "I just tipped you {amount} DOGE on MuchTip. Claim it with your X account: {origin}/app/claim",
 * addressed to @handle so X notifies them, with the note (client-side only, never on chain) quoted when there is one.
 */
export function shareText(handle: string, amountWei: bigint | null, note?: string) {
  const n = note?.trim(); // only a note the user typed; never the field's placeholder, never blank quotes
  return `@${handle} I just tipped you ${amountWei === null ? "" : `${formatDoge(amountWei)} DOGE `}on MuchTip${n ? `: "${n}"` : ""}. Claim it with your X account: ${claimLink()}`;
}

interface FlowProps {
  handle: string;
  amountText: string;
  note: string;
  /** set when resuming a submitted tip from ?tx= */
  resumeHash: Hex | null;
  /** the X id the form's (cached) preview showed, if any: the fresh lookup must match it or be confirmed again (W2.7) */
  previewXId: string | null;
  onEdit: () => void;
  onSubmitted: (hash: Hex) => void;
  onConfirmed: (c: Confirmed | null) => void;
  onAmount: (amount: string) => void;
  onAnother: () => void;
}

export function TipFlow(p: FlowProps) {
  if (p.resumeHash) return <Outcome hash={p.resumeHash} {...p} amountWei={parseDoge(p.amountText)} onRetry={null} />;
  return <Review {...p} />;
}

function Review({ handle, amountText, note, previewXId, onEdit, onSubmitted, onConfirmed, onAmount, onAnother }: FlowProps) {
  const client = usePublicClient({ chainId: CHAIN_ID }) as PublicClient;
  const amountWei = parseDoge(amountText) as bigint;
  const fresh = useFreshResolve(handle);
  const { minTipWei, refundDelaySeconds } = useEscrowConfig();
  const wallet = useWallet();
  const { connect, isConnecting } = useConnectWallet();
  const { switchToChikyu, isSwitching } = useSwitchToChikyu();
  const { writeContractAsync } = useWriteContract();
  const [step, setStep] = useState<Step>({ kind: "review" });
  const [notice, setNotice] = useState<string | null>(null);
  const [acceptedXId, setAcceptedXId] = useState(previewXId);
  const dismissed = useRef(false);

  const who = fresh.data ?? null;
  const idHash = (who?.idHash ?? QUOTE_SAMPLE.idHash) as Hex;
  const fee = useFeeQuote("tip", { data: encodeFunctionData({ abi: escrowAbi, functionName: "tip", args: [idHash] }), value: amountWei }, step.kind === "review");
  const minText = minTipWei === undefined ? "the minimum" : `${formatDoge(minTipWei)} DOGE`;

  if (fresh.isPending)
    return (
      <div key="checking" className={card} aria-busy="true">
        <div className={title}>Review your tip</div>
        <div className="mt-6 flex items-center gap-3 text-[14px] text-ink-3"><Spinner size={18} />Checking @{handle} on X…</div>
      </div>
    );
  if (fresh.isError || !who)
    return (
      <div key="lookup" className={card}>
        <div className={title}>{fresh.isError ? "We couldn't check this handle" : `No X account called @${handle}.`}</div>
        <p className="m-0 mt-2 text-[14px] leading-[1.5] text-ink-3">{fresh.isError ? `${apiErrorMessage(fresh.error, { handle })} Nothing was sent.` : "Check the spelling and try again. Nothing was sent."}</p>
        <div className="mt-4 flex gap-2">
          {fresh.isError && <button type="button" onClick={() => fresh.refetch()} className={`${gold} !h-12 !w-auto px-5 !text-[15px]`}>Try again</button>}
          <button type="button" onClick={onEdit} className={`${bigBtn} !h-12 !w-auto border-line-input bg-white px-5 !text-[15px] text-ink`}>Edit</button>
        </div>
      </div>
    );

  const live = who.source === "x"; // fresh answers come from X; "demo"/"mock" are fixtures and must never receive real DOGE
  const total = fee.data ? amountWei + fee.data.upToWei : null;
  const blocked = wallet.status === "connected" && wallet.balanceWei !== undefined && fee.data !== undefined && !coversTip(wallet.balanceWei, amountWei, fee.data.upToWei);
  // the handle now resolves to a different X account than the preview showed: show it and ask again (W2.7)
  const changed = acceptedXId !== null && who.xId !== acceptedXId;
  const belowMin = minTipWei !== undefined && amountWei < minTipWei;

  const confirm = async () => {
    dismissed.current = false;
    setNotice(null);
    // the id hash we send must be the one this browser computes from the fresh X id (W2.8)
    if (idHashOf(who.xId).toLowerCase() !== who.idHash.toLowerCase()) {
      setStep({ kind: "failed", error: { kind: "unknown", title: "The lookup didn't check out", detail: "The X account's id and id hash don't match, so nothing was sent. Try again in a moment." } });
      return;
    }
    // one more fee quote right before sending (FEES.md 5.2); if the balance no longer covers it, the blocked state shows
    const latest = (await fee.refetch()).data;
    if (!latest || wallet.balanceWei === undefined || !coversTip(wallet.balanceWei, amountWei, latest.upToWei)) return;
    setStep({ kind: "wallet" });
    try {
      // Simulate first: a revert (e.g. BelowMinTip) is caught before the wallet opens and before any fee is paid.
      await client.simulateContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "tip", args: [who.idHash as Hex], value: amountWei, account: wallet.address });
      const hash = await writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "tip", args: [who.idHash as Hex], value: amountWei, chainId: CHAIN_ID });
      rememberHandle(who.idHash, who.handle);
      onSubmitted(hash);
      setStep({ kind: "submitted", hash });
    } catch (e) {
      if (dismissed.current) return;
      const error = describeTxError(e, { min: minText });
      if (error.kind === "rejected") {
        setNotice(CANCELLED);
        setStep({ kind: "review" });
      } else setStep({ kind: "failed", error });
    }
  };

  // 2 · waiting for wallet
  if (step.kind === "wallet")
    return (
      <div key="wallet" className={card}>
        <div className={title}>Confirm in your wallet</div>
        <div className="mx-auto mt-9 flex h-[72px] w-[72px] items-center justify-center rounded-[20px] bg-surface-chip"><Spinner size={30} strokeWidth={2.6} /></div>
        <p className="m-0 mx-auto mt-5 max-w-[300px] text-center text-[15px] leading-[1.5]">Open MyDoge or MetaMask and approve the transaction.</p>
        <div className={`mt-[22px] flex flex-col gap-2 rounded-ctl bg-surface-well p-3.5 ${mono}`}>
          <div className="flex justify-between gap-3"><span className="text-muted">Contract</span><span>TipEscrow {shortAddr(ESCROW_ADDRESS)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted">Function</span><span>tip(idHash)</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted">Value</span><span>{formatDoge(amountWei)} DOGE</span></div>
        </div>
        <p className="m-0 mt-4 text-center text-[13px] text-muted">Your wallet's fee may look lower than ours. It leaves out DogeOS's data fee.</p>
        <button type="button" onClick={() => { dismissed.current = true; setStep({ kind: "review" }); }} className={`${bigBtn} mt-4 !h-12 border-line-input bg-white !text-[15px] text-ink`}>Cancel</button>
      </div>
    );

  // 3 and 4 · submitted, confirmed
  if (step.kind === "submitted")
    return <Outcome hash={step.hash} handle={who.handle} amountWei={amountWei} note={note} onRetry={() => setStep({ kind: "review" })} onConfirmed={onConfirmed} onAnother={onAnother} />;

  // 5 · failed / rejected
  if (step.kind === "failed")
    return <Failed error={step.error} onBack={() => setStep({ kind: "review" })} />;

  // 6 · blocked before signing: the balance can't cover the tip plus the fee buffer
  if (blocked && wallet.balanceWei !== undefined && fee.data) {
    const affordable = wallet.balanceWei > fee.data.upToWei ? (wallet.balanceWei - fee.data.upToWei) / 10n ** 18n : 0n;
    const canAfford = minTipWei !== undefined && affordable * 10n ** 18n >= minTipWei;
    return (
      <div key="short" className={card}>
        <div className={title}>Send a tip</div>
        <div className="mt-4 flex justify-between rounded-ctl border border-line-soft p-3 font-mono text-[14px] font-medium"><span>@{who.handle}</span><span>{formatDoge(amountWei)} DOGE</span></div>
        <div role="alert" className="mt-3.5 rounded-ctl border border-warning-line bg-warning-bg p-3.5 text-[14px] leading-[1.5]">
          <div className="font-semibold text-warning">Not enough DOGE</div>
          <div className="mt-1 text-ink-3">You have {formatDoge(wallet.balanceWei, 2)} DOGE. This tip needs up to {formatDogeFixed(amountWei + fee.data.upToWei, 2, "up")} DOGE including the fee buffer.</div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="font-semibold text-warning">Get test DOGE ↗</a>
            {canAfford && <><span className="text-warning-sep" aria-hidden="true">·</span><button type="button" onClick={() => onAmount(affordable.toString())} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-warning underline">Tip {affordable.toString()} DOGE instead</button></>}
          </div>
        </div>
        <div className="mt-3.5 rounded-ctl bg-surface-well p-3.5 text-[13px] leading-[1.5] text-ink-3">We keep a small buffer above our fee estimate, because the DogeOS data fee can change between your review and the block.</div>
        <button type="button" disabled className={`${gold} mt-4`}>Not enough DOGE</button>
      </div>
    );
  }

  // 1 · review
  let action: { label: string; onClick?: () => void; tone: "gold" | "ink" | "warning" | "disabled" };
  if (!live) action = { label: "Real tips need the live X lookup", tone: "disabled" };
  else if (wallet.status === "disconnected") action = { label: "Connect wallet to continue", tone: "ink", onClick: () => void connect() };
  else if (wallet.status === "connecting" || isConnecting) action = { label: "Connecting…", tone: "disabled" };
  else if (wallet.status === "wrong-network") action = { label: isSwitching ? "Switching…" : "Switch to DogeOS Chikyū", tone: "warning", onClick: switchToChikyu };
  else if (belowMin) action = { label: `Minimum tip is ${minText}`, tone: "disabled" };
  else if (changed) action = { label: "Confirm the account above first", tone: "disabled" };
  else if (!fee.data || wallet.balanceWei === undefined) action = { label: "Checking the network fee…", tone: "disabled" };
  else action = { label: "Confirm in wallet", tone: "gold", onClick: confirm };

  const balanceAfter = wallet.balanceWei !== undefined && total !== null && wallet.balanceWei >= total ? wallet.balanceWei - total : null;
  const tone = { gold: "border-ink bg-gold text-ink", ink: "border-ink bg-ink text-white", warning: "border-warning bg-warning text-white", disabled: "border-ink bg-gold text-ink" }[action.tone];
  return (
    <div key="review" className={card}>
      <div className="flex items-center justify-between">
        <div className={title}>Review your tip</div>
        <button type="button" onClick={onEdit} className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-ink-3 underline">Edit</button>
      </div>
      <Recipient who={who} />
      {changed && (
        <div role="alert" className="mt-3 rounded-ctl border border-warning-line bg-warning-bg p-3 text-[13px] leading-[1.5]">
          <div className="font-semibold text-warning">@{who.handle} is now a different X account</div>
          <div className="mt-1 text-ink-3">When you checked, @{who.handle} was X ID {acceptedXId}. X now says it is X ID {who.xId}. Make sure this is who you mean to tip.</div>
          <button type="button" onClick={() => setAcceptedXId(who.xId)} className="mt-2 cursor-pointer border-0 bg-transparent p-0 font-semibold text-warning underline">Tip this account</button>
        </div>
      )}
      {!live && (
        <div role="note" className="mt-3 rounded-ctl border border-dashed border-line-dash p-3 text-[13px] leading-[1.5] text-ink-3">
          Demo lookup: the MuchTip backend isn't connected, so this X ID wasn't checked with X just now. Sending is switched off until it is.
        </div>
      )}
      <dl className="m-0 mt-4 flex flex-col gap-2.5 text-[14px]">
        <div className="flex justify-between"><dt className="text-muted">Tip</dt><dd className="m-0 font-mono font-medium">{formatDogeFixed(amountWei, 2)} DOGE</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Network fee (est.)</dt><dd className="m-0 font-mono font-medium">{fee.data ? formatFeeRange(fee.data.aboutWei, fee.data.upToWei) : "…"}</dd></div>
        <div className="flex justify-between border-t border-dashed border-line-input pt-2.5"><dt className="font-semibold">Total, at most</dt><dd className="m-0 font-mono text-[15px] font-semibold">{total === null ? "…" : `${formatDogeFixed(total, 2, "up")} DOGE`}</dd></div>
        {wallet.status === "connected" && (
          <div className="flex justify-between"><dt className="text-muted">Your balance after</dt><dd className="m-0 font-mono font-medium">{balanceAfter === null ? "…" : `≥ ${formatDogeFixed(balanceAfter, 2)} DOGE`}</dd></div>
        )}
      </dl>
      <div className="mt-4 rounded-ctl border border-gold-line bg-gold-wash p-3 text-[13px] leading-[1.5]">
        If @{who.handle} hasn't claimed it after <strong>{refundDelaySeconds === undefined ? "the refund window" : formatDurationLong(refundDelaySeconds)}</strong>, you can refund it from <Link to="/app/tips" className="underline">My tips</Link>.
      </div>
      {notice && <p role="status" className="m-0 mt-3 text-center text-[13px] font-medium text-error">{notice}</p>}
      <button type="button" disabled={action.tone === "disabled"} onClick={action.onClick} className={`${bigBtn} mt-4 ${tone}`}>
        {action.label}
      </button>
    </div>
  );
}

function Failed({ error, onBack }: { error: TxError; onBack: () => void }) {
  return (
    <div className={card}>
      <div className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-error-bg"><CloseIcon size={24} strokeWidth={2.6} className="text-error" /></div>
      <div className="mt-4 text-[24px] font-bold tracking-[-0.02em]">The tip didn't go through</div>
      <p className="m-0 mt-2 text-[14px] leading-[1.5] text-ink-3">No DOGE left your wallet except the network fee, if the transaction reached the chain.</p>
      <div role="alert" className="mt-[18px] rounded-ctl border border-error-line bg-error-wash p-3.5 text-[14px] leading-[1.5]">
        <div className="font-semibold text-error">{error.title}</div>
        <div className="mt-1 text-ink-3">{error.detail}</div>
      </div>
      <button type="button" onClick={onBack} className={`${gold} mt-4`}>Back to review</button>
    </div>
  );
}

/** Submitted -> confirmed, driven only by the receipt. Used right after signing and when resuming from ?tx=. */
function Outcome({ hash, handle, amountWei, note, onRetry, onConfirmed, onAnother }: { hash: Hex; handle: string; amountWei: bigint | null; note: string; onRetry: (() => void) | null; onConfirmed: (c: Confirmed | null) => void; onAnother: () => void }) {
  const client = usePublicClient({ chainId: CHAIN_ID }) as PublicClient;
  const { refundDelaySeconds } = useEscrowConfig();
  const wallet = useWallet();
  const [state, setState] = useState<{ kind: "waiting" } | { kind: "done"; block: bigint; time: number; fee: bigint | null; refundAt: number | null } | { kind: "reverted"; error: TxError } | { kind: "lost" }>({ kind: "waiting" });

  useEffect(() => {
    let live = true;
    client
      .waitForTransactionReceipt({ hash, timeout: 10 * 60_000 })
      .then(async (r) => {
        if (!live) return;
        if (r.status !== "success") {
          const error = await revertReason(client, hash, r.blockNumber);
          if (live) setState({ kind: "reverted", error });
          return;
        }
        const tipId = tipIdOf(r);
        const [block, fee, refundableAt] = await Promise.all([
          client.getBlock({ blockNumber: r.blockNumber }),
          feePaid(client, hash),
          tipId === null ? null : client.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "refundableAt", args: [tipId] }).catch(() => null),
        ]);
        if (!live) return;
        const time = Number(block.timestamp);
        const refundAt = refundableAt === null ? null : Number(refundableAt);
        setState({ kind: "done", block: r.blockNumber, time, fee, refundAt });
        onConfirmed({ hash, time, tipId, refundAt, from: r.from });
        wallet.refetchBalance();
      })
      .catch(() => live && setState({ kind: "lost" }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, client]);

  if (state.kind === "reverted" || state.kind === "lost")
    return (
      <div key="failed" className={card}>
        <div className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-error-bg"><CloseIcon size={24} strokeWidth={2.6} className="text-error" /></div>
        <div className="mt-4 text-[24px] font-bold tracking-[-0.02em]">{state.kind === "reverted" ? "The tip didn't go through" : "We lost track of this transaction"}</div>
        <p className="m-0 mt-2 text-[14px] leading-[1.5] text-ink-3">
          {state.kind === "reverted" ? "The transaction was mined but the contract reverted it. Only the network fee was spent." : "No receipt after 10 minutes. Check it on the explorer before trying again, so you don't tip twice."}
        </p>
        {state.kind === "reverted" && (
          <div role="alert" className="mt-[18px] rounded-ctl border border-error-line bg-error-wash p-3.5 text-[14px] leading-[1.5]">
            <div className="font-semibold text-error">{state.error.title}</div>
            <div className="mt-1 text-ink-3">{state.error.detail}</div>
          </div>
        )}
        <TxRow hash={hash} />
        {onRetry && <button type="button" onClick={onRetry} className={`${gold} mt-4`}>Back to review</button>}
      </div>
    );

  if (state.kind === "waiting")
    return (
      <div key="waiting" className={card} aria-live="polite">
        <div className="flex items-center gap-2.5"><Spinner size={18} className="text-gold-spin" /><span className="text-[17px] font-semibold">Waiting for DogeOS</span></div>
        <p className="m-0 mt-2.5 text-[14px] leading-[1.5] text-ink-3">Your transaction is on its way. Blocks come every ~3 seconds. You can close this page; the tip will still go through.</p>
        <TxSteps included={false} />
        <TxRow hash={hash} />
      </div>
    );

  const amount = amountWei === null ? "Your tip" : `${formatDoge(amountWei)} DOGE`;
  const refundAtSec = state.refundAt ?? (refundDelaySeconds === undefined ? null : state.time + refundDelaySeconds);
  const refundAt = refundAtSec === null ? null : new Date(refundAtSec * 1000);
  return (
    <div key="done" className={card} aria-live="polite">
      <div className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-success-bg"><CheckIcon size={26} strokeWidth={2.6} className="text-success" /></div>
      <div className="mt-4 text-[24px] font-bold tracking-[-0.02em]">{amount} is waiting for @{handle}</div>
      <p className="m-0 mt-2 text-[14px] leading-[1.5] text-ink-3">Confirmed in block {state.block.toLocaleString("en-US")}. Let them know so they can claim it.</p>
      <div className={`mt-[18px] flex flex-col gap-2 rounded-ctl border border-line-soft p-3.5 ${mono}`}>
        <div className="flex justify-between"><span className="text-muted">Fee paid</span><span>{state.fee === null ? "unknown" : `${formatDoge(state.fee, 4)} DOGE`}</span></div>
        <div className="flex justify-between"><span className="text-muted">Refundable from</span><span>{refundAt ? formatClock(refundAt) : "…"}</span></div>
        <div className="flex justify-between"><span className="text-muted">Tx</span><a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="mt-link text-gold-ink">{shortHash(hash)} ↗</a></div>
      </div>
      <a href={xIntent(shareText(handle, amountWei, note))} target="_blank" rel="noreferrer" className={`${bigBtn} mt-4 border-ink bg-ink text-white`}><XLogo />Tell them on X</a>
      <button type="button" onClick={onAnother} className="mt-btn mt-2 h-11 w-full cursor-pointer border-0 bg-transparent text-[14px] font-semibold text-ink">Send another tip</button>
    </div>
  );
}
