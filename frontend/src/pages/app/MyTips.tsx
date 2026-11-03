import { useEffect, useRef, useState } from "react";
import { encodeFunctionData, type Hex, type PublicClient } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { escrowAbi } from "../../chain/abi";
import { CHAIN_ID, ESCROW_ADDRESS, FAUCET_URL, explorerTx } from "../../chain/config";
import { describeTxError } from "../../chain/errors";
import { quoteFee } from "../../chain/fees";
import { tipPillOf, useFeeQuote, useNow, useSentTips, useWallet, type OnchainTip } from "../../chain/hooks";
import { revertReason } from "../../chain/tx";
import { bigBtn } from "../../components/app/TipFlow";
import { ReceiptTicket } from "../../components/ReceiptTicket";
import { TIP_PILL, type TipPill } from "../../components/ui/Badge";
import { CloseIcon, Spinner } from "../../components/ui/Icons";
import { Skeleton } from "../../components/ui/Primitives";
import { useToast } from "../../components/ui/Toast";
import { useConnectWallet, useSwitchToChikyu } from "../../components/ui/WalletButton";
import { useHandleNames } from "../../data/hooks";
import { formatClock, formatCountdown, formatDayLabel, formatDoge, formatFeeRange, shortAddr, shortHash } from "../../lib/format";
import { claimLink } from "../../lib/links";
import { pageTitle, useTitle } from "../../lib/title";
import { usePhone } from "../../lib/useMedia";

type RowState = { kind: "idle" } | { kind: "wallet" } | { kind: "submitted" } | { kind: "done" } | { kind: "failed"; message: string };

/**
 * /app/tips (spec A3, P3, wiring-spec W4.1): tips sent from the connected wallet, 20 at a time, newest first, from
 * chain_events; the handle from x_handles (short idHash when unknown); each status read from the chain.
 */
export default function MyTips() {
  useTitle(pageTitle("My tips"));
  const phone = usePhone();
  const wallet = useWallet();
  const { connect } = useConnectWallet();
  const { switchToChikyu } = useSwitchToChikyu();
  const sent = useSentTips(wallet.address);
  const fallbackName = useHandleNames();
  const nameOf = (idHash: string) => {
    const h = sent.handles.get(idHash.toLowerCase());
    return h ? `@${h}` : fallbackName(idHash);
  };
  const now = useNow();
  const [receipt, setReceipt] = useState<OnchainTip | null>(null);
  const txOfTip = sent.txOfTip;
  const list = sent.tips ?? [];
  // the refund quote is built from a real refund(tipId) call (FEES.md 5, ceiling 0.30 if the oracle fails)
  const firstRefundable = list.find((t) => tipPillOf(t, now) === "refundable");
  const fee = useFeeQuote("refund", firstRefundable ? { data: encodeFunctionData({ abi: escrowAbi, functionName: "refund", args: [firstRefundable.id] }), value: 0n } : undefined, Boolean(wallet.address));

  const heading = !phone && (
    <>
      <h1 className="m-0 mb-1.5 text-[32px]">My tips</h1>
      <p className="m-0 mb-6 text-[15px] text-ink-3">
        {wallet.address ? `Tips sent from ${shortAddr(wallet.address)}. ` : ""}Unclaimed tips can be refunded once their window ends.
      </p>
    </>
  );

  if (wallet.status !== "connected")
    return (
      <>
        {heading}
        <div className="max-w-[520px] rounded-card border border-ink bg-white p-6">
          <div className="text-[17px] font-semibold">{wallet.status === "wrong-network" ? "Switch to DogeOS Chikyū" : "Connect the wallet you tipped from"}</div>
          <p className="m-0 mt-2 text-[14px] leading-[1.5] text-ink-3">Your tips are read from the contract by the address that sent them.</p>
          <button type="button" onClick={wallet.status === "wrong-network" ? switchToChikyu : () => void connect()} disabled={wallet.status === "connecting"} className={`${bigBtn} mt-5 ${wallet.status === "wrong-network" ? "border-warning bg-warning text-white" : "border-ink bg-ink text-white"}`}>
            {wallet.status === "wrong-network" ? "Switch network" : wallet.status === "connecting" ? "Connecting…" : "Connect wallet"}
          </button>
        </div>
      </>
    );

  const rows = list.map((t) => (
    <TipRow
      key={t.id.toString()}
      t={t}
      phone={phone}
      name={nameOf(t.idHash)}
      tx={txOfTip.get(t.id.toString())}
      now={now}
      feeUpTo={fee.data?.upToWei}
      balance={wallet.balanceWei}
      onReceipt={() => setReceipt(t)}
      onDone={() => { void sent.refetch(); wallet.refetchBalance(); }}
    />
  ));

  return (
    <>
      {heading}
      {sent.tips === undefined ? (
        <div className="rounded-card border border-line-2 bg-white p-5"><Skeleton className="h-4 w-full" /><Skeleton className="mt-3 h-4 w-2/3" /></div>
      ) : list.length === 0 ? (
        <div className="rounded-card border border-line-2 bg-white px-5 py-10 text-center">
          <div className="text-[17px] font-semibold">No tips from this wallet yet</div>
          <p className="m-0 mt-1.5 text-[14px] text-muted">Tips you send appear here, with a refund button once their window ends.</p>
        </div>
      ) : phone ? (
        <div className="flex flex-col gap-2.5">{rows}</div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line-2 bg-white">{rows}</div>
      )}
      {sent.hasMore && (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={sent.loadMore} disabled={sent.loadingMore} className="mt-btn inline-flex h-10 cursor-pointer items-center gap-2 rounded-ctl border border-line-input bg-white px-4 text-[13px] font-semibold text-ink">
            {sent.loadingMore ? <><Spinner size={14} />Loading…</> : "Show more"}
          </button>
        </div>
      )}
      {receipt && (
        <ReceiptDialog onClose={() => setReceipt(null)}>
          <ReceiptTicket
            status={receipt.status === "Claimed" ? "claimed" : receipt.status === "Refunded" ? "refunded" : "waiting"}
            amount={receipt.amountWei}
            from={receipt.tipper}
            to={nameOf(receipt.idHash)}
            sentAt={receipt.createdAt}
            refundAt={receipt.refundableAt}
            txHash={txOfTip.get(receipt.id.toString()) ?? null}
            notch="#F4F3EE"
            link={claimLink()}
            shareText={`I tipped ${nameOf(receipt.idHash)} ${formatDoge(receipt.amountWei)} DOGE on MuchTip. Claim it whenever you're ready: ${claimLink()}`}
          />
        </ReceiptDialog>
      )}
    </>
  );
}

/** A modal on the app background, so the ticket's notches match what is behind it. */
function ReceiptDialog({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-label="Tip receipt" className="w-[min(470px,calc(100vw-32px))] rounded-panel border-0 bg-paper-app p-5 backdrop:bg-ink/50">
      <div className="mb-3 flex justify-end">
        <button type="button" onClick={onClose} aria-label="Close receipt" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-surface-chip text-ink"><CloseIcon size={14} strokeWidth={2.4} /></button>
      </div>
      {children}
    </dialog>
  );
}

function TipRow({ t, phone, name, tx, now, feeUpTo, balance, onReceipt, onDone }: { t: OnchainTip; phone: boolean; name: string; tx?: Hex; now: number; feeUpTo?: bigint; balance?: bigint; onReceipt: () => void; onDone: () => void }) {
  const client = usePublicClient({ chainId: CHAIN_ID }) as PublicClient;
  const { writeContractAsync } = useWriteContract();
  const toast = useToast();
  const [s, setS] = useState<RowState>({ kind: "idle" });
  const left = t.refundableAt - now;
  const cantPayFee = feeUpTo !== undefined && balance !== undefined && balance < feeUpTo;

  const ctx = { when: formatClock(new Date(t.refundableAt * 1000)) };
  const refund = async () => {
    setS({ kind: "wallet" });
    try {
      // a fresh quote for this exact refund(tipId) right before sending (FEES.md 5.2); the balance must cover it
      const data = encodeFunctionData({ abi: escrowAbi, functionName: "refund", args: [t.id] });
      const q = await quoteFee(client, "refund", { data, value: 0n }, t.tipper);
      if (balance !== undefined && balance < q.upToWei) {
        setS({ kind: "failed", message: `You need about ${formatFeeRange(null, q.upToWei).replace("up to ", "")} DOGE for the network fee.` });
        return;
      }
      await client.simulateContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "refund", args: [t.id], account: t.tipper });
      const hash = await writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "refund", args: [t.id], chainId: CHAIN_ID });
      setS({ kind: "submitted" });
      const r = await client.waitForTransactionReceipt({ hash, timeout: 10 * 60_000 });
      if (r.status !== "success") {
        setS({ kind: "failed", message: (await revertReason(client, hash, r.blockNumber, ctx)).detail });
        return;
      }
      setS({ kind: "done" });
      toast(`Refunded ${formatDoge(t.amountWei, 2)} DOGE`, "success");
      onDone();
    } catch (e) {
      const error = describeTxError(e, ctx);
      setS({ kind: "failed", message: error.kind === "rejected" ? error.title : error.detail });
    }
  };

  const pill: TipPill = s.kind === "done" ? "refunded" : tipPillOf(t, now);
  const busy = s.kind === "wallet" || s.kind === "submitted";
  const amount = `${formatDoge(t.amountWei, 2)} DOGE`;
  const refundBtn = (
    <button type="button" onClick={refund} disabled={busy || cantPayFee} className={`mt-btn inline-flex cursor-pointer items-center gap-2 rounded-ctl border border-ink bg-gold font-semibold text-ink disabled:cursor-not-allowed disabled:border-line-2 disabled:bg-surface-chip disabled:text-muted-2 ${phone ? "h-[38px] px-3.5 text-[13px]" : "h-10 px-4 text-[14px]"}`}>
      {s.kind === "wallet" ? <><Spinner size={14} />Confirm in wallet</> : s.kind === "submitted" ? <><Spinner size={14} />Waiting for a block</> : "Refund"}
    </button>
  );
  const notes = (
    <>
      {s.kind === "failed" && <p role="alert" className="m-0 mt-2 basis-full text-[13px] text-error">{s.message}</p>}
      {pill === "refundable" && cantPayFee && s.kind === "idle" && feeUpTo !== undefined && (
        <p className="m-0 mt-2 basis-full text-[13px] text-warning">You need up to {formatFeeRange(null, feeUpTo).replace("up to ", "")} DOGE for the refund fee. <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="font-semibold text-warning">Get test DOGE ↗</a></p>
      )}
    </>
  );
  const pillEl = (w: string) => <span className={`inline-flex h-7 items-center justify-center rounded-[8px] px-2.5 text-[12px] font-medium ${w} ${TIP_PILL[pill].cls}`}>{TIP_PILL[pill].label}</span>;

  if (phone)
    return (
      <div className="rounded-[14px] border border-line-2 bg-white p-3.5">
        <div className="flex items-center justify-between gap-3"><strong className="truncate">{name}</strong><span className="font-mono text-[14px] font-semibold">{amount}</span></div>
        <div className="mt-2.5 flex items-center justify-between gap-2.5">
          {pillEl("!h-[26px] !rounded-badge !px-[9px]")}
          {pill === "waiting" && <span className="font-mono text-[12px] font-medium text-muted">refund in {formatCountdown(left)}</span>}
          {pill === "refundable" && refundBtn}
        </div>
        {notes}
      </div>
    );

  return (
    <div className="mt-row flex flex-wrap items-center gap-4 border-b border-line-faint px-5 py-[18px] last:border-b-0">
      <div className="min-w-0 flex-[1_1_220px]">
        <div className="truncate font-semibold">{name}</div>
        <div className="font-mono text-[12px] text-muted">
          {formatDayLabel(new Date(t.createdAt * 1000))}
          {tx && <> · <a className="mt-link text-muted" href={explorerTx(tx)} target="_blank" rel="noreferrer">{shortHash(tx)} ↗</a></>}
        </div>
      </div>
      <span className="min-w-[90px] font-mono text-[15px] font-semibold">{amount}</span>
      {pillEl("w-[150px]")}
      <div className="flex w-[150px] justify-end">
        {pill === "waiting" && <button type="button" disabled className="h-10 rounded-ctl border border-line-2 bg-surface-chip px-3.5 text-[13px] font-semibold text-muted-2">Refund in {formatCountdown(left)}</button>}
        {pill === "refundable" && refundBtn}
        {pill === "claimed" && <button type="button" onClick={onReceipt} className="mt-btn h-10 cursor-pointer rounded-ctl border border-line-input bg-white px-3.5 text-[13px] font-semibold text-ink">Receipt</button>}
      </div>
      {notes}
    </div>
  );
}
