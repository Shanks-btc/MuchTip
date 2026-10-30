# DogeOS Chikyū Testnet: verification log

Checked 2026-10-30 (~13:00–13:30 UTC) from Windows, using curl, headless Chromium, ethers 6 and solc-js 0.8.30.
I confirmed every item with a live call. Docs were used only to find candidate values.

**Bottom line:** The testnet is usable for a hackathon build. The RPC, explorer, faucet page and EVM compatibility (Prague target, PUSH0, Cancun opcodes) all respond correctly. The on-chain deploy (item 5) is **still pending**: the wallet needs funding, and Foundry still needs installing.

| # | Item | Status |
|---|------|--------|
| 1a | RPC URL | VERIFIED |
| 1b | Chain ID 6281971 | VERIFIED |
| 1c | Block explorer | VERIFIED (two explorers; docs list only one) |
| 1d | Faucet | PARTIALLY VERIFIED (page is live; no claim made yet) |
| 1e | Native gas token = DOGE | VERIFIED |
| 2 | RPC liveness / blocks / gas / latency | VERIFIED |
| 3 | EVM / Solidity compatibility | VERIFIED (with caveats) |
| 4 | Throwaway wallet | VERIFIED (created, balance 0); funding is your step |
| 5 | Foundry deploy / call / event / explorer | **UNVERIFIED**: not funded, Foundry not installed |
| 6a | MyDoge wallet support | PARTIALLY VERIFIED (docs + npm only, not live-tested) |
| 6b | RedStone oracle on testnet | **UNVERIFIED** |
| 6c | Other infra | VERIFIED (see list) |

---

## 1. Official network details

Source: https://docs.dogeos.com/en/developers/developer-quickstart and `/en/getting-started/user-guide/setup`

| Field | Docs value | Live result |
|---|---|---|
| RPC | `https://rpc.testnet.dogeos.com/` | **VERIFIED**: answers JSON-RPC (see item 2) |
| Chain ID | `6281971` | **VERIFIED**: `eth_chainId` → `0x5fdaf3` = 6281971 |
| Currency | `DOGE` | **VERIFIED**: native-token ERC-20 at `0x530000000000000000000000000000000000d09e`, `symbol()` → `"DOGE"` |
| Explorer | `https://dogeos-testnet.l2scan.co` | **VERIFIED**: HTTP 200. Its Etherscan-style API (`/api?module=block...`) returned `NOTOK`, so use the Blockscout explorer below for API calls |
| Explorer (not in docs) | `https://blockscout.testnet.dogeos.com` | **VERIFIED**: `/api/v2/stats` → `total_blocks: 9036267`, `average_block_time: 3061ms`, `transactions_today: 427008`, which matches the RPC height. This explorer appears in BitGoJS ([PR 7661](https://github.com/BitGo/BitGoJS/pull/7661/files)) but not in DogeOS docs |
| Faucet | `https://faucet.testnet.dogeos.com` | **PARTIALLY VERIFIED**: page renders: "allows you to claim once every 24 hours". Docs say 42.069 DOGE per day. No claim made yet |
| Alt RPC (3rd party) | `https://dogeos-testnet.drpc.org` | **VERIFIED**: `eth_chainId` → `0x5fdaf3` (1.10s) |

Other official docs: verification `/en/developers/verifying-smart-contracts`, EVM differences `/en/developers/ethereum-and-dogeos-differences`, SDK `/en/sdk`. Bridge / Dogecoin-L1 faucet: `https://faucet.dogetest.doge.xyz` (advanced; needs OP_RETURN txs; not checked).

## 2. RPC live check — VERIFIED

```
eth_chainId        200  2.26s  {"result":"0x5fdaf3"}            # first call, includes TLS handshake
eth_blockNumber    200  0.94s  {"result":"0x89e4c0"}            # 9036992
  (6s later)
eth_blockNumber    200  0.88s  {"result":"0x89e4c3"}            # 9036995, +3 blocks: chain is advancing
eth_gasPrice       200  0.88s  {"result":"0xef426c"}            # 15,680,108 wei ≈ 0.0157 gwei
web3_clientVersion 200  0.84s  {"result":"reth/v2.0.0-972366a/x86_64-unknown-linux-gnu"}
latest block: baseFeePerGas 0xef4208, gasLimit 0x989680 (10,000,000)
```

- **Latency:** about 0.85–0.95 s per call when warm (from this machine; each curl opens a new connection, so a keep-alive client will be faster). Cold first call: 2.26 s.
- **Block time:** about 3 s (explorer reports 3061 ms on average).
- **Block gas limit:** 10M, much lower than Ethereum's. Very large deploys or batch calls may hit it.

## 3. EVM compatibility — VERIFIED (with caveats)

Docs say: *"Fully compatible with the Ethereum Prague upgrade. Use `prague` as your EVM target and avoid Solidity < 0.8.30."*

I tested this with live `eth_call` runs of hand-assembled bytecode against `latest`:

| Probe | Result | Verdict |
|---|---|---|
| `PUSH0` (Shanghai) `5f5ff3` | `0x` (success) | ✅ supported |
| `TSTORE`/`TLOAD` (Cancun) | returns `…0001` | ✅ supported |
| `MCOPY` (Cancun) | returns `…002a` | ✅ supported |
| `BASEFEE` | returns 0 inside eth_call | ✅ opcode works |
| `PREVRANDAO` | returns 0 | ✅ matches docs ("returns 0"); **don't use it for randomness** |
| `BLOBHASH` (EIP-4844) | `EVM error: NotActivated` | ❌ matches docs (not supported) |
| `0xfe` control | `InvalidFEOpcode` | (control: proves errors surface properly) |
| EIP-2935 history contract `0x0000F908…2935` | has code | ✅ Prague system contract is deployed |
| BLS12-381 precompiles `0x0b`, `0x0f` (Prague, EIP-2537) | empty input → `0x` success (a real BLS precompile would reject empty input) | ⚠️ **appear NOT active**, though docs say Prague-compatible. Don't build on BLS |
| P256VERIFY `0x100` | `0x` | ⚠️ not active (no passkey/secp256r1 precompile) |
| RIPEMD-160 `0x03` | returns the correct hash of empty input (`9c1185a5…8d31`) | ⚠️ **docs are out of date**: they say it's unsupported, but it works |
| sha256 `0x02` | correct empty-input hash | ✅ |

**End-to-end compile + simulated deploy:** `src/Probe.sol` compiled with solc **0.8.30, evmVersion `prague`**, no warnings. The bytecode contains PUSH0. Running it as a creation tx via `eth_call` returned the runtime bytecode, and `eth_estimateGas` → `0x327cd` (206,797 gas). Execution cost at current gas price is about 0.0000032 DOGE, plus DogeOS's L1 data fee.

Other differences from the docs (not tested live): `SELFDESTRUCT` reverts, `COINBASE` returns the fee vault address, max reorg depth is 17 blocks, and the modexp precompile only accepts inputs of 32 bytes or less.

## 4. Throwaway wallet — VERIFIED (unfunded)

- Address: **`0x1BE5DB49a70d633c6e6AF7900598118Fb65419AE`**
- The private key is in `.env` (`PRIVATE_KEY`, plus `RPC_URL`, `CHAIN_ID`, `DEPLOYER_ADDRESS`). `.env` is listed in `.gitignore`.
- `eth_getBalance` → `0x0` (confirmed empty).

**Faucet steps (manual):**
1. Open https://faucet.testnet.dogeos.com
2. Use the **"Wallet address"** field (don't use "Connect or Create New Wallet") and paste `0x1BE5DB49a70d633c6e6AF7900598118Fb65419AE`.
3. Under "Select Token", pick **DOGE**, then claim. You'll probably get a captcha or a social login prompt.
4. Limit: one claim per 24 h (about 42 DOGE per the docs). That's plenty: the Probe deploy plus two calls costs well under 0.01 DOGE.
5. Check with: `curl -s -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0x1BE5DB49a70d633c6e6AF7900598118Fb65419AE","latest"]}' https://rpc.testnet.dogeos.com`, or view the address on https://blockscout.testnet.dogeos.com.

## 5. Foundry deploy — UNVERIFIED (blocked)

Why: (a) the wallet isn't funded yet, and (b) Foundry isn't installed on this machine. My `curl … | bash` foundryup install was blocked by the permission policy, so I did not run it.

Ready to run once both are done:
- `foundry.toml`: solc 0.8.30, `evm_version = "prague"`
- `src/Probe.sol`: `store(uint256)` / `retrieve()` / `event Stored` / payable `tip()` + `event Tipped`
- `scripts/deploy-and-verify.sh` deploys the contract and calls `store(42)`, then `retrieve()` and `tip()` with 0.001 DOGE. It then reads the logs with `cast logs` and checks both txs on the Blockscout API.

```bash
# install Foundry yourself (https://getfoundry.sh), then:
bash scripts/deploy-and-verify.sh
```

Optional source verification: `forge verify-contract <addr> src/Probe.sol:Probe --chain-id 6281971 --verifier blockscout --verifier-url https://blockscout.testnet.dogeos.com/api/` (docs give the l2scan URL. Its Etherscan-style API returned `NOTOK` to my probe, so Blockscout is the safer choice).

| Step | Tx hash |
|---|---|
| Deploy | _pending_ |
| store(42) | _pending_ |
| tip() | _pending_ |

## 6. Wallets & infra

**MyDoge — PARTIALLY VERIFIED (docs + npm, not live-tested)**
- The official DogeOS SDK `@dogeos/dogeos-sdk` exists on npm (latest **4.0.5**, published 2026-10-29). Its docs (`/en/sdk`, `/en/sdk/embedded-wallets`) say: *"Inside MyDoge, the SDK selects the injected native wallet before embedded initialization"* (native-first connection). So MyDoge connects as an **injected provider when your dApp runs in MyDoge's in-app browser**.
- **WalletConnect:** supported, but only with your own `walletConnectProjectId` ("omitted or blank IDs disable WalletConnect; the SDK no longer supplies a fallback"). The SDK also needs a `clientId` from the DogeOS developer console (Sandbox and Live IDs; localhost works automatically in Sandbox).
- The SDK also offers email/social **embedded wallets**, which helps non-crypto users in a hackathon demo.
- The bridge/setup docs explicitly list MetaMask, Coinbase Wallet and WalletConnect wallets. Manual MetaMask setup works with the network table above.
- Not done: I didn't connect MyDoge to the chain myself. That requires the mobile app or extension.

**RedStone oracle — UNVERIFIED**
- RedStone has publicly announced a live DogeOS testnet integration ([crypto-economy](https://crypto-economy.com/?p=339871), [Unchained](https://unchainedcrypto.com/dogecoin-gets-an-evm-app-layer-for-defi-and-games-as-dogeos-opens-its-public-testnet/)).
- But I found **no price-feed contract address** in DogeOS docs, in RedStone docs search results, or on the explorer. Blockscout searches for `PriceFeed`, `PriceFeedsAdapter`, `MultiFeed`, `Aggregator` and `redstone` turned up only a verified **`RedstoneMulticall3`** at `0xaD6CC5a465E5c8284a49eC9eD10EFE275460678c`. That's a helper contract, not a feed. RedStone's *pull* model (data appended to calldata by `@redstone-finance/evm-connector`) may need no deployed feed, but that's untested here.
- Next step: ask in the DogeOS Discord or RedStone's Push Feeds UI for the testnet feed address, then `cast call <feed> "latestRoundData()"` to confirm.

**Other infra on testnet — VERIFIED (live)**
- Third-party RPC: dRPC `https://dogeos-testnet.drpc.org` responds with the correct chain ID.
- Native DOGE has an ERC-20 interface at `0x530000000000000000000000000000000000d09e` (`symbol()` = "DOGE"), so there's no need for WETH-style wrapping. The docs warn that gas and plain transfers emit no `Transfer` event.
- The chain is busy: about 427k txs today and 403k addresses (Blockscout stats).
- Test stablecoins exist, per explorer search (unverified source code, use with care): "DogeOS Test USD" `0xf8c3C3e4a5DB150A7ecf0B12b4854a20c8F5528A`, "DogeOS Stable Coin" `0xAF9FAcb82Fa06Ac48fa0bAb57f6496a8f376fe5C`.
- Indexing: Allium lists DogeOS testnet as a supported chain (docs only, not checked).

## Files created (nothing committed; this folder is not a git repo)

- `.env`: throwaway key (gitignored)
- `.gitignore`: `.env*`, `out/`, `cache/`, `broadcast/`, `node_modules/`
- `foundry.toml`, `src/Probe.sol`, `scripts/deploy-and-verify.sh`
- `verified.md`: this file
