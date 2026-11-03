import { useMemo, useState } from "react";
import type { Hex, PublicClient } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { escrowAbi } from "../../chain/abi";
import { CHAIN_ID, ESCROW_ADDRESS, FAUCET_URL, explorerTx } from "../../chain/config";
import { describeTxError, type TxError } from "../../chain/errors";
import { feePaid, revertReason } from "../../chain/tx";
import { useClaimSummary, useFeeQuote, useNow, useWallet } from "../../chain/hooks";
import { CopyButton } from "../../components/ui/Copy";
import { Spinner, XLogo } from "../../components/ui/Icons";
import { Avatar, Skeleton } from "../../components/ui/Primitives";
import { useConnectWallet, useSwitchToChikyu } from "../../components/ui/WalletButton";
import { ApiError, apiErrorMessage, authConfigured, idHashOf, signClaim } from "../../data/api";
import { useXSession, type XAccount } from "../../data/auth";
import { formatCountdown, formatDoge, formatDogeFixed, formatFeeRange, relativeTime, shortAddr, shortHash } from "../../lib/format";
import { tipLink, tipLinkText } from "../../lib/links";
import { pageTitle, useTitle } from "../../lib/title";
import { usePhone } from "../../lib/useMedia";

/** /app/claim (spec A2, P2). Signed out: the sign-in card. Signed in with X: what is waiting and one-transaction claim. */
export default function Claim() {
  useTitle(pageTitle("Claim tips"));
  const x = useXSession();
  if (!x.ready)
    return (
      <div className="mx-auto max-w-[520px] rounded-panel border border-line-2 bg-white p-9" aria-busy="true">
        <Skeleton className="mx-auto h-8 w-64" /><Skeleton className="mx-auto mt-4 h-4 w-80" />
      </div>
    );
  if (x.account && x.session) return <Dashboard account={x.account} accessToken={x.session.access_token} onSignIn={() => x.signIn()} onSignOut={() => x.signOut()} />;
  return <SignedOut unsupported={x.unsupportedIdentity} onSignIn={() => x.signIn()} onSignOut={() => x.signOut()} />;
}

function SignedOut({ unsupported, onSignIn, onSignOut }: { unsupported: boolean; onSignIn: () => void; onSignOut: () => void }) {
  return (
    <div className="mx-auto max-w-[520px] rounded-panel border border-ink bg-white p-6 text-center sm:p-9">
      <h1 className="m-0 text-[28px]">Were you tipped?</h1>
      <p className="m-0 mt-3 text-[15px] leading-[1.55] text-ink-3">
        {unsupported
          ? "This account is linked to something other than X. Sign out and sign in with X only."
          : "Sign in with the X account that was tipped. Connect any wallet and collect every waiting tip in one transaction."}
      </p>
      <button
        type="button"
        onClick={unsupported ? onSignOut : onSignIn}
        disabled={!unsupported && !authConfigured}
        className="mt-btn mt-6 flex h-[52px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-btn border-0 bg-ink text-[16px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-surface-chip disabled:text-muted-2"
      >
        {unsupported ? "Sign out" : <><XLogo />Sign in with X to claim</>}
      </button>
      <p className="m-0 mt-3.5 text-[13px] text-muted">We only read your X ID. We never post for you.</p>
      {!authConfigured && <p role="note" className="m-0 mt-2 font-mono text-[12px] text-muted">Sign-in needs the MuchTip backend, which isn't connected to this build yet.</p>}
    </div>
  );
}

type ClaimStep =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "wallet" }
  | { kind: "submitted"; hash: Hex }
  | { kind: "claimed"; hash: Hex; amountWei: bigint; tips: number; fee: bigint | null }
  | { kind: "failed"; error: TxError; reauth?: boolean };

const SESSION_CODES = new Set(["invalid_token", "missing_token"]);

/**
 * W3.4: ask sign-claim for a permission, simulate, sign, wait for the receipt. The permission expires about 300 s after
 * the chain's latest block; if the claim fails with Expired (the user waited too long in the wallet), a new permission
 * is fetched and the claim retried once, automatically.
 */
function useClaim(accessToken: string, sum: ReturnType<typeof useClaimSummary>) {
  const client = usePublicClient({ chainId: CHAIN_ID }) as PublicClient;
  const wallet = useWallet();
  const { writeContractAsync } = useWriteContract();
  const [step, setStep] = useState<ClaimStep>({ kind: "idle" });
  const claim = async () => {
    if (!wallet.address) return;
    const amountWei = sum.readyWei ?? 0n;
    const count = sum.pending.length;
    for (let attempt = 0; attempt < 2; attempt++) {
      const retry = (e: TxError) => e.revert === "Expired" && attempt === 0;
      setStep({ kind: "signing" });
      try {
        const sig = await signClaim(accessToken, wallet.address);
        if (!sig.claimable) {
          setStep({ kind: "failed", error: { kind: "revert", revert: "NothingToClaim", title: "Nothing to claim yet", detail: "There's nothing to claim right now." } });
          return;
        }
        const args = [BigInt(sig.xId), sig.recipient as Hex, BigInt(sig.nonce), BigInt(sig.expiry), sig.signature] as const;
        await client.simulateContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "claim", args, account: wallet.address });
        setStep({ kind: "wallet" });
        const hash = await writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "claim", args, chainId: CHAIN_ID });
        setStep({ kind: "submitted", hash });
        const r = await client.waitForTransactionReceipt({ hash, timeout: 10 * 60_000 });
        if (r.status !== "success") {
          const error = await revertReason(client, hash, r.blockNumber);
          if (retry(error)) continue;
          setStep({ kind: "failed", error });
          return;
        }
        const fee = await feePaid(client, hash);
        setStep({ kind: "claimed", hash, amountWei, tips: count, fee });
        await Promise.all([sum.refetch(), wallet.refetchBalance()]);
        return;
      } catch (e) {
        if (e instanceof ApiError) {
          const reauth = SESSION_CODES.has(e.code);
          setStep({ kind: "failed", reauth, error: { kind: "rpc", title: reauth ? "Your X sign-in expired" : "Claiming didn't start", detail: apiErrorMessage(e) } });
          return;
        }
        const error = describeTxError(e);
        if (retry(error)) continue;
        setStep({ kind: "failed", error });
        return;
      }
    }
  };
  return { step, claim };
}

function Dashboard({ account, accessToken, onSignIn, onSignOut }: { account: XAccount; accessToken: string; onSignIn: () => void; onSignOut: () => void }) {
  const phone = usePhone();
  const idHash = useMemo(() => idHashOf(account.xId), [account.xId]);
  const sum = useClaimSummary(idHash);
  const wallet = useWallet();
  const { connect } = useConnectWallet();
  const { switchToChikyu, isSwitching } = useSwitchToChikyu();
  const fee = useFeeQuote("claim");
  const now = useNow();
  const { step, claim } = useClaim(accessToken, sum);
  const name = account.handle ? `@${account.handle}` : `X ID ${account.xId}`;
  const next = sum.pending[0]?.refundableAt;
  const deadline = sum.loading ? null : next === undefined ? "none" : next <= now ? "now" : formatCountdown(next - now);
  const feeAbout = fee.data ? (fee.data.aboutWei !== null ? `about ${formatDogeFixed(fee.data.aboutWei, 2, "up")}` : `up to ${formatDogeFixed(fee.data.upToWei, 2, "up")}`) : "about …";
  const tipsWord = (n: number) => (n === 1 ? "tip" : "tips");

  // the claim call to action, on the dark card
  const busy = step.kind === "signing" || step.kind === "wallet" || step.kind === "submitted";
  const feeShort = fee.data && wallet.balanceWei !== undefined && wallet.balanceWei < fee.data.upToWei;
  const btn = `mt-btn flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-btn border-0 font-semibold ${phone ? "mt-[18px] h-[52px] text-[15px]" : "mt-3.5 h-14 text-[16px]"}`;
  let cta: React.ReactNode;
  if (step.kind === "claimed")
    cta = (
      <div role="status" className="mt-in mt-3.5 rounded-btn border border-success/40 bg-success/10 p-3.5 text-[14px] text-white">
        <strong>{formatDoge(step.amountWei, 2)} DOGE claimed.</strong> {step.tips} {tipsWord(step.tips)} settled in tx{" "}
        <a className="mt-link font-mono text-gold" href={explorerTx(step.hash)} target="_blank" rel="noreferrer">{shortHash(step.hash)} ↗</a>
        {step.fee !== null && <span className="font-mono text-night-text"> · fee {formatDoge(step.fee, 4)} DOGE</span>}
      </div>
    );
  else if (busy)
    cta = (
      <button type="button" disabled className={`${btn} !cursor-default bg-night-chip text-night-pale`}>
        <Spinner size={16} />
        {step.kind === "signing" ? "Getting a claim permission…" : step.kind === "wallet" ? "Confirm in your wallet…" : "Claim submitted · waiting for a block"}
      </button>
    );
  else if (!sum.loading && sum.readyWei === 0n)
    cta = <div className="mt-3.5 rounded-btn bg-night-well p-3.5 text-[14px] text-night-text">Nothing waiting right now. Share your tip link and tips will show up here.</div>;
  else if (wallet.status === "disconnected" || wallet.status === "connecting")
    cta = <button type="button" onClick={() => void connect()} className={`${btn} bg-gold text-ink`}>Connect a wallet to receive the DOGE</button>;
  else if (wallet.status === "wrong-network")
    cta = <button type="button" onClick={switchToChikyu} disabled={isSwitching} className={`${btn} bg-warning text-white`}>Switch to DogeOS Chikyū</button>;
  else if (feeShort && fee.data)
    cta = (
      <div role="alert" className="mt-3.5 rounded-btn border border-warning-line bg-warning-bg p-3.5 text-[14px] leading-[1.5] text-ink">
        <div className="font-semibold text-warning">You need about {formatFeeRange(null, fee.data.upToWei).replace("up to ", "")} DOGE for the network fee</div>
        <div className="mt-1 text-ink-3">The fee is paid from the receiving wallet. <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="font-semibold text-warning">Get test DOGE ↗</a></div>
      </div>
    );
  else
    cta = <button type="button" onClick={claim} disabled={sum.loading || !sum.readyWei} className={`${btn} bg-gold text-ink disabled:cursor-not-allowed`}>{sum.loading ? "Reading the contract…" : "Claim all, one transaction"}</button>;

  const failure = step.kind === "failed" && (
    <div role="alert" className="mt-3 rounded-btn border border-error-line bg-error-wash p-3.5 text-[14px] leading-[1.5] text-ink">
      <div className="font-semibold text-error">{step.error.title}</div>
      <div className="mt-1 text-ink-3">{step.error.detail}</div>
      {step.reauth && <button type="button" onClick={onSignIn} className="mt-2 cursor-pointer border-0 bg-transparent p-0 font-semibold text-error underline">Sign in again</button>}
    </div>
  );
  const amount = sum.readyWei === undefined ? <Skeleton dark className={phone ? "h-12 w-24" : "h-14 w-28"} /> : formatDoge(sum.readyWei, 2);
  // W3.5: "Copy" copies {origin}/app?to={handle}, the link that opens Send with this handle filled in
  const link = account.handle ? tipLink(account.handle) : null;
  const linkText = account.handle ? tipLinkText(account.handle) : null;

  if (phone)
    return (
      <div>
        <div className="rounded-[20px] bg-ink p-5 text-white">
          <div className="text-[12px] text-night-text">Waiting for {name}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-[56px] font-semibold leading-none tracking-[-0.05em] text-gold">{amount}</span>
            <span className="font-mono text-[15px] font-medium text-night-text">DOGE · {sum.pending.length} {tipsWord(sum.pending.length)}</span>
          </div>
          {cta}
          {failure}
          <div className="mt-2.5 text-center text-[12px] text-night-muted">{wallet.address ? `to ${shortAddr(wallet.address)} · ` : ""}fee {feeAbout} DOGE</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-[14px] border border-line-2 bg-white p-3.5"><div className="text-[11px] text-muted">Claimed so far</div><div className="font-mono text-[22px] font-semibold">{sum.claimedWei === undefined ? "…" : formatDoge(sum.claimedWei, 2)}</div></div>
          <div className="rounded-[14px] border border-line-2 bg-white p-3.5"><div className="text-[11px] text-muted">Next deadline</div><div className="font-mono text-[22px] font-semibold text-warning-strong">{deadline ?? "…"}</div></div>
        </div>
        <div className="mt-4 overflow-hidden rounded-[14px] border border-line-2 bg-white text-[13px]">
          <div className="border-b border-line-faint px-3.5 py-3 font-semibold">Tips for you</div>
          {sum.syncing && <div className="px-3.5 py-3 text-muted">Some tips are still syncing. The total above comes straight from the contract.</div>}
          {!sum.syncing && sum.pending.length === 0 && <div className="px-3.5 py-3 text-muted">{sum.loading ? "Reading the contract…" : "No tips waiting."}</div>}
          {!sum.syncing && sum.pending.map((t) => (
            <div key={t.id.toString()} className="flex justify-between border-b border-line-faint px-3.5 py-3 last:border-b-0">
              <span className="font-mono">{shortAddr(t.tipper)}</span>
              <strong className="font-mono">{formatDoge(t.amountWei, 2)}</strong>
            </div>
          ))}
        </div>
        {link && (
          <div className="mt-3 flex h-[46px] items-center gap-2 rounded-btn border border-line-wallet bg-white pl-3 pr-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium">{linkText}</span>
            <CopyButton value={link} label="Copy your tip link" className="h-[34px] cursor-pointer rounded-[8px] border-0 bg-ink px-3 text-[12px] font-semibold text-white">Copy</CopyButton>
          </div>
        )}
        <button type="button" onClick={onSignOut} className="mt-4 w-full cursor-pointer border-0 bg-transparent font-mono text-[12px] text-muted underline">Sign out of X</button>
      </div>
    );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <Avatar text={(account.handle ?? "X").slice(0, 2).toUpperCase()} size={52} />
          <div className="min-w-0">
            <h1 className="m-0 truncate text-[28px]">{name}</h1>
            <div className="font-mono text-[13px] text-muted">
              X ID {account.xId} · signed in with X · <button type="button" onClick={onSignOut} className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[13px] text-muted underline">Sign out</button>
            </div>
          </div>
        </div>
        {link && (
          <div className="flex h-[46px] max-w-full items-center gap-2 rounded-btn border border-line-wallet bg-white pl-3.5 pr-1.5">
            <span className="shrink-0 text-[12px] text-muted">Your tip link</span>
            <span className="min-w-0 truncate font-mono text-[13px] font-medium">{linkText}</span>
            <CopyButton value={link} label="Copy your tip link" className="h-[34px] shrink-0 cursor-pointer rounded-[8px] border-0 bg-ink px-3 text-[13px] font-semibold text-white">Copy</CopyButton>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-5">
        <div className="min-w-0 flex-[1_1_300px] rounded-panel bg-ink p-6 text-white">
          <div className="text-[13px] text-night-text">Waiting for you</div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="font-mono text-[64px] font-semibold leading-none tracking-[-0.05em] text-gold">{amount}</span>
            <span className="font-mono text-[18px] font-medium text-night-text">DOGE from {sum.pending.length} {tipsWord(sum.pending.length)}</span>
          </div>
          <div className="mt-[22px] flex h-[46px] items-center gap-2 rounded-btn border border-night-line px-3.5 font-mono text-[13px] font-medium text-night-text">
            <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${wallet.address ? "bg-success" : "bg-muted-2"}`} />
            {wallet.address ? `to ${shortAddr(wallet.address)}` : "No wallet connected"}
            <span className="ml-auto font-sans text-[12px] font-normal">{wallet.status === "connected" ? "connected wallet" : wallet.status === "wrong-network" ? "wrong network" : ""}</span>
          </div>
          {cta}
          {failure}
          <div className="mt-2.5 text-center text-[12px] text-night-muted">Network fee {feeAbout} DOGE, however many tips</div>
        </div>
        <div className="grid min-w-0 flex-[1_1_300px] grid-cols-2 gap-px overflow-hidden rounded-panel border border-line-2 bg-line-2">
          <div className="bg-white p-[22px]">
            <div className="text-[12px] text-muted">Claimed so far</div>
            <div className="mt-1.5 font-mono text-[28px] font-semibold">{sum.claimedWei === undefined ? <Skeleton className="h-8 w-16" /> : formatDoge(sum.claimedWei, 2)}</div>
            <div className="text-[12px] text-muted">DOGE from {sum.claimedCount} {tipsWord(sum.claimedCount)}</div>
          </div>
          <div className="bg-white p-[22px]">
            <div className="text-[12px] text-muted">Next refund deadline</div>
            <div className="mt-1.5 font-mono text-[28px] font-semibold text-warning-strong">{deadline ?? <Skeleton className="h-8 w-16" />}</div>
            <div className="text-[12px] text-muted">claim before a tipper can take it back</div>
          </div>
          <div className="col-span-2 bg-white p-[22px]">
            <div className="text-[12px] text-muted">How claiming works</div>
            <p className="m-0 mt-1.5 text-[14px] leading-[1.5] text-ink-2">We confirm you own {name}, then the contract pays every waiting tip to your wallet at once. We never post for you.</p>
          </div>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-card border border-line-2 bg-white">
        <div className="border-b border-line-soft px-[18px] py-3.5 font-semibold">Tips waiting for you</div>
        {sum.syncing && <div className="px-[18px] py-6 text-center text-[14px] text-muted">Some tips are still syncing. The total above comes straight from the contract.</div>}
        {!sum.syncing && sum.pending.length === 0 && <div className="px-[18px] py-6 text-center text-[14px] text-muted">{sum.loading ? "Reading the contract…" : `No tips waiting. Tips sent to ${name} appear here as soon as they confirm.`}</div>}
        {!sum.syncing && sum.pending.map((t, i) => {
          const left = t.refundableAt - now;
          return (
            <div key={t.id.toString()} className="mt-row grid grid-cols-[minmax(0,1.4fr)_1fr_1fr_1fr] items-center gap-3 border-t border-line-faint px-[18px] py-3.5 text-[14px] first-of-type:border-t-0">
              <span className="font-mono text-[13px]">{shortAddr(t.tipper)}</span>
              <span className="font-mono text-[13px] font-semibold">{formatDoge(t.amountWei, 2)} DOGE</span>
              <span className="text-muted">{relativeTime(new Date(t.createdAt * 1000))}</span>
              <span className={`font-mono text-[12px] font-medium ${i === 0 || left <= 0 ? "text-warning" : "text-ink-3"}`}>{left <= 0 ? "refundable now" : `refundable in ${formatCountdown(left)}`}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
