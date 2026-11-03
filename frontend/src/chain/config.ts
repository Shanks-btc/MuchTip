import { defineChain, type Address } from "viem";
import { ENV } from "../env";

// Network and deployment facts. They come from the env (src/env.ts), whose defaults are the live deployment:
// - chain id, contract, deploy block: deployment.json (src/chain/chain.test.ts fails if the defaults drift)
// - RPC and explorer: scripts/deploy.cjs and scripts/fee-check.cjs defaults
// - native DOGE, 18 decimals: verified-testnet-baseline.md 1e and "Currency"
// - Multicall3 at the canonical address: eth_getCode on Chikyū shows code, and aggregate3 / getChainId() answer
//   (checked 2026-11-02: minTip 5e18, refundDelay 600, chain id 6281971 through it)
// - fee oracle: FEES.md section 3
export const CHAIN_ID = ENV.chainId;
export const ESCROW_ADDRESS: Address = ENV.escrowAddress;
export const ESCROW_DEPLOY_BLOCK = ENV.escrowDeployBlock;
export const RPC_URL = ENV.rpcUrl;
export const EXPLORER_URL = ENV.explorerUrl;
export const L1_GAS_ORACLE: Address = "0x5300000000000000000000000000000000000002";
/** README.md: one claim per 24 h. */
export const FAUCET_URL = "https://faucet.testnet.dogeos.com";
export const SOURCE_URL = "https://github.com/Shanks-btc/MuchTip";
export const CONTRACT_SOURCE_URL = `${SOURCE_URL}/blob/main/src/TipEscrow.sol`;
/** DogeOS's RPC refuses eth_getLogs over more than 10,000 blocks (docs/backend.md, "The indexer"). */
export const LOG_RANGE_BLOCKS = 9000n;

export const chikyu = defineChain({
  id: CHAIN_ID,
  name: "DogeOS Chikyū",
  nativeCurrency: { name: "Dogecoin", symbol: "DOGE", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER_URL } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export const explorerTx = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddr = (address: string) => `${EXPLORER_URL}/address/${address}`;
