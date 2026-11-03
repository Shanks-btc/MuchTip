import { useEffect, useRef, useState } from "react";
import { useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { explorerAddr, CHAIN_ID } from "../../chain/config";
import { useWallet } from "../../chain/hooks";
import { formatDoge, shortAddr } from "../../lib/format";
import { copyText } from "./Copy";
import { Spinner } from "./Icons";
import { useToast } from "./Toast";

/**
 * Wallets to offer: the EIP-6963 wallets the browser announced, or the generic injected provider when none did (an
 * older wallet that only sets window.ethereum), plus WalletConnect when it is configured.
 */
function useWallets() {
  const { connectors } = useConnect();
  const announced = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const generic = connectors.filter((c) => c.id === "injected" && typeof window !== "undefined" && "ethereum" in window);
  const remote = connectors.filter((c) => c.type === "walletConnect");
  return [...(announced.length ? announced : generic), ...remote];
}

export const NO_WALLET = "No wallet found. Install MetaMask (or another EVM wallet) in this browser, then try again.";
/** A connect request the wallet never answers (locked, popup closed) stops waiting after this long. */
export const CONNECT_TIMEOUT_MS = 30_000;

export class ConnectTimeout extends Error {
  constructor() {
    super("The wallet didn't answer");
  }
}

/**
 * What to tell the user when connecting fails. Every case ends in a message and a retry, never a spinner:
 * 4001 rejected, -32002 a request already open in the wallet, a wallet that never answered (locked or popup closed).
 */
export function connectErrorMessage(e: unknown): string {
  if (e instanceof ConnectTimeout) return "Your wallet didn't answer. It may be locked or waiting in its window: open the wallet extension, unlock it, then try again.";
  const err = e as { code?: number; cause?: { code?: number }; message?: string; shortMessage?: string } | null;
  const code = err?.code ?? err?.cause?.code;
  const text = `${err?.shortMessage ?? ""} ${err?.message ?? ""}`;
  if (code === -32002 || /already pending/i.test(text)) return "Your wallet already has a connection request open. Open the wallet extension, approve or close it, then try again.";
  if (code === 4001 || /reject|denied|cancel/i.test(text)) return "You cancelled in your wallet.";
  return "Couldn't connect the wallet. Try again.";
}

/** Rejects with ConnectTimeout if `p` hasn't settled after `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => (t = setTimeout(() => reject(new ConnectTimeout()), ms)))]).finally(() => clearTimeout(t));
}

type ConnectState = { kind: "idle" } | { kind: "waiting" } | { kind: "error"; message: string };

/**
 * One connect attempt with a time limit. The UI follows this state, not wagmi's isPending (which stays true forever
 * when a wallet never answers). If the wallet does answer late, wagmi still connects and the UI follows the account.
 */
function useConnectFlow() {
  const { connectAsync } = useConnect();
  const [state, setState] = useState<ConnectState>({ kind: "idle" });
  const attempt = useRef(0);
  const connect = async (c: Connector | undefined): Promise<{ ok: true } | { ok: false; message: string }> => {
    const id = ++attempt.current;
    if (!c) {
      setState({ kind: "error", message: NO_WALLET });
      return { ok: false, message: NO_WALLET };
    }
    setState({ kind: "waiting" });
    try {
      await withTimeout(connectAsync({ connector: c }), CONNECT_TIMEOUT_MS);
      if (id === attempt.current) setState({ kind: "idle" });
      return { ok: true };
    } catch (e) {
      const message = connectErrorMessage(e);
      if (id === attempt.current) setState({ kind: "error", message });
      return { ok: false, message };
    }
  };
  return { state, connect, dismiss: () => setState({ kind: "idle" }) };
}

/** Connect for a call-to-action outside the header: the only wallet, or the browser's default (window.ethereum) one. */
export function useConnectWallet() {
  const { connectors } = useConnect();
  const wallets = useWallets();
  const toast = useToast();
  const flow = useConnectFlow();
  const connect = async (): Promise<boolean> => {
    const hasDefault = typeof window !== "undefined" && "ethereum" in window;
    const c = wallets.length === 1 || !hasDefault ? wallets[0] : connectors.find((x) => x.id === "injected");
    const r = await flow.connect(wallets.length ? c : undefined);
    if (!r.ok) toast(r.message, "error", 8000);
    return r.ok;
  };
  return { connect, isConnecting: flow.state.kind === "waiting" };
}

/** Switches the wallet to Chikyū; wagmi's injected connector adds the network first when the wallet doesn't know it. */
export function useSwitchToChikyu() {
  const { switchChainAsync, isPending } = useSwitchChain();
  const toast = useToast();
  const run = async () => {
    try {
      await switchChainAsync({ chainId: CHAIN_ID });
    } catch {
      toast("The wallet didn't switch. Pick DogeOS Chikyū in your wallet and try again", "error");
    }
  };
  return { switchToChikyu: run, isSwitching: isPending };
}

/** "Add DogeOS Chikyū" in one click: connects a wallet first if there is none, then adds and selects the network. */
export function useAddNetwork() {
  const { status } = useWallet();
  const { connect, isConnecting } = useConnectWallet();
  const { switchToChikyu, isSwitching } = useSwitchToChikyu();
  const add = async () => {
    if (status === "disconnected" && !(await connect())) return;
    await switchToChikyu();
  };
  return { addNetwork: add, isAdding: isConnecting || isSwitching };
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

const menuCls = "mt-in absolute right-0 top-[calc(100%+6px)] z-40 min-w-[220px] overflow-hidden rounded-ctl border border-line-2 bg-white p-1 shadow-[0_8px_24px_rgba(14,15,20,0.08)]";
const itemCls = "flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-[7px] border-0 bg-transparent px-3 text-left text-[14px] font-medium text-ink no-underline hover:bg-surface-chip";

/**
 * The header wallet control (A0, A1) and its phone pill (P1–P4): Connect wallet / connecting / wrong network /
 * balance + address with a menu (copy, explorer, disconnect).
 */
export function WalletButton({ phone = false }: { phone?: boolean }) {
  const { status, address, balanceWei } = useWallet();
  const flow = useConnectFlow();
  const connecting = flow.state.kind === "waiting";
  const { disconnect } = useDisconnect();
  const { switchToChikyu, isSwitching } = useSwitchToChikyu();
  const wallets = useWallets();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const size = phone ? "h-9 px-2.5 text-[12px]" : "h-10 px-[18px] text-[14px]";

  const [lastTried, setLastTried] = useState<Connector | undefined>(undefined);
  const connect = async (c: Connector | undefined) => {
    setOpen(false);
    setLastTried(c);
    await flow.connect(c);
  };

  if (status === "connecting" || connecting)
    return (
      <button type="button" disabled className={`inline-flex items-center gap-2 rounded-ctl border border-ink bg-ink font-semibold text-white ${size}`}>
        <Spinner size={14} />Connecting…
      </button>
    );

  // A wallet on another chain still shows its chip (spec A1: the setup strip asks for the network); the dot turns amber
  // and the menu offers the switch.
  if ((status === "connected" || status === "wrong-network") && address) {
    const wrong = status === "wrong-network";
    const bal = balanceWei === undefined ? "…" : `${formatDoge(balanceWei, 2)} DOGE`;
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={`Wallet ${shortAddr(address)}, ${bal}${wrong ? ", on another network" : ""}`}
          className={`mt-btn inline-flex cursor-pointer items-center rounded-ctl border border-line-wallet bg-white font-mono font-medium text-ink ${phone ? "h-9 gap-2 px-2.5 text-[12px]" : "h-10 gap-2.5 pl-3 pr-[5px] text-[13px]"}`}
        >
          {isSwitching ? <Spinner size={12} /> : <span className={`inline-block h-[7px] w-[7px] rounded-full ${wrong ? "bg-tipped-dot" : `bg-success ${phone ? "" : "mt-pulse"}`}`} />}
          {phone ? bal : <><span className="max-[639px]:hidden">{bal}</span><span className="rounded-[7px] bg-surface-chip px-[9px] py-1.5">{shortAddr(address)}</span></>}
        </button>
        {open && (
          <div role="menu" className={menuCls}>
            <div className="px-3 py-2 font-mono text-[12px] text-muted">{shortAddr(address)} · {bal}</div>
            {wrong && <button role="menuitem" type="button" className={itemCls} onClick={() => { setOpen(false); void switchToChikyu(); }}>Switch to DogeOS Chikyū</button>}
            <button role="menuitem" type="button" className={itemCls} onClick={async () => { setOpen(false); toast((await copyText(address)) ? "Address copied" : "Couldn't copy", "info"); }}>Copy address</button>
            <a role="menuitem" className={itemCls} href={explorerAddr(address)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>View on explorer ↗</a>
            <button role="menuitem" type="button" className={itemCls} onClick={() => { setOpen(false); disconnect(); }}>Disconnect</button>
          </div>
        )}
      </div>
    );
  }

  const label = phone ? "Connect" : "Connect wallet";
  // A failed or unanswered attempt: the reason stays on screen with a retry until the user acts on it.
  const problem = flow.state.kind === "error" && (
    <div role="alert" className={`${menuCls} w-[min(320px,calc(100vw-32px))] p-3 text-[13px] leading-[1.45] text-ink`}>
      <div>{flow.state.message}</div>
      <div className="mt-2.5 flex gap-2">
        <button type="button" className="mt-btn h-8 cursor-pointer rounded-[8px] border-0 bg-ink px-3 text-[12px] font-semibold text-white" onClick={() => connect(lastTried ?? wallets[0])}>Try again</button>
        <button type="button" className="h-8 cursor-pointer rounded-[8px] border border-line-input bg-white px-3 text-[12px] font-semibold text-ink" onClick={flow.dismiss}>Dismiss</button>
      </div>
    </div>
  );
  const btnCls = `mt-btn inline-flex cursor-pointer items-center rounded-ctl border border-ink bg-ink font-semibold text-white ${size}`;
  if (wallets.length <= 1)
    return (
      <div className="relative">
        <button type="button" className={btnCls} onClick={() => connect(wallets[0])}>
          {label}
        </button>
        {problem}
      </div>
    );
  return (
    <div ref={ref} className="relative">
      <button type="button" className={btnCls} aria-haspopup="menu" aria-expanded={open} onClick={() => { flow.dismiss(); setOpen((o) => !o); }}>{label}</button>
      {!open && problem}
      {open && (
        <div role="menu" className={menuCls}>
          {wallets.map((c) => (
            <button key={c.uid} role="menuitem" type="button" className={itemCls} onClick={() => connect(c)}>
              {c.icon && <img src={c.icon} alt="" width={20} height={20} className="rounded-[4px]" />}
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
