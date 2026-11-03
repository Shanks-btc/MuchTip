import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { ENV } from "../env";
import { chikyu, RPC_URL } from "./config";

// One chain. Injected wallets: wagmi discovers every EIP-6963 wallet the browser announces (MetaMask, MyDoge if it
// exposes an EVM provider, anything else installed) plus window.ethereum as a fallback. No wallet is special-cased.
// WalletConnect only when a Reown project id is configured. Reads go through the public RPC with JSON-RPC batching
// (and Multicall3 for contract reads); writes go through the user's wallet.
export const wagmiConfig = createConfig({
  chains: [chikyu],
  connectors: [
    injected(),
    ...(ENV.reownProjectId
      ? [walletConnect({ projectId: ENV.reownProjectId, showQrModal: true, metadata: { name: "MuchTip", description: "Trustless DOGE tips for any X handle", url: ENV.appOrigin ?? window.location.origin, icons: [] } })]
      : []),
  ],
  multiInjectedProviderDiscovery: true,
  transports: { [chikyu.id]: http(RPC_URL, { batch: true }) },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
