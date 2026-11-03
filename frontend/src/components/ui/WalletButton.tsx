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

const NO_WALLET = "No wallet found. Install MetaMask, or open MuchTip in MyDoge";
const rejected = (e: unknown) => /reject|denied/i.test((e as Error)?.message ?? "");

/** Connect for a call-to-action outside the header: the only wallet, or the browser's default (window.ethereum) one. */
export function useConnectWallet() {
  const { connectors, connectAsync, isPending } = useConnect();
  const wallets = useWallets();
  const toast = useToast();
  const connect = async (): Promise<boolean> => {
    const hasDefault = typeof window !== "undefined" && "ethereum" in window;
    const c = wallets.length === 1 || !hasDefault ? wallets[0] : connectors.find((x) => x.id === "injected");
    if (!c || !wallets.length) {
      toast(NO_WALLET, "error");
      return false;
    }
    try {
      await connectAsync({ connector: c });
      return true;
    } catch (e) {
      toast(rejected(e) ? "You cancelled in your wallet." : "Couldn't connect the wallet", "error");
      return false;
    }
  };
  return { connect, isConnecting: isPending };
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
  const { connectAsync, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchToChikyu, isSwitching } = useSwitchToChikyu();
  const wallets = useWallets();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const size = phone ? "h-9 px-2.5 text-[12px]" : "h-10 px-[18px] text-[14px]";

  const connect = async (c: Connector) => {
    setOpen(false);
    try {
      await connectAsync({ connector: c });
    } catch (e) {
      toast(rejected(e) ? "You cancelled in your wallet." : "Couldn't connect the wallet", "error");
    }
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
  const btnCls = `mt-btn inline-flex cursor-pointer items-center rounded-ctl border border-ink bg-ink font-semibold text-white ${size}`;
  if (wallets.length <= 1)
    return (
      <button type="button" className={btnCls} onClick={() => (wallets[0] ? connect(wallets[0]) : toast(NO_WALLET, "error"))}>
        {label}
      </button>
    );
  return (
    <div ref={ref} className="relative">
      <button type="button" className={btnCls} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{label}</button>
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
