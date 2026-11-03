# MuchTip wiring spec: v5 UI to TipEscrow and Supabase

Status: plan for implementation. The facts below were checked against this repo (`src/TipEscrow.sol`, `docs/backend.md`, `FEES.md`, `deployment.json`, `supabase/`) on 2026-11-02. Anything not checked is marked **UNVERIFIED** and must be checked before you rely on it.

The UI is done (v5). This pass replaces every TODO stub in `src/data/` with live data and makes every button work. Do not change the look. Do not touch the contract, `.env`, or the Supabase functions and migrations, unless a section below says so.

---

## 0. Fixed facts

| Thing | Value | Source |
|---|---|---|
| Chain | DogeOS Chikyū testnet, chain id `6281971`, RPC `https://rpc.testnet.dogeos.com/`, explorer `https://blockscout.testnet.dogeos.com` | deployment.json, .env.example |
| Native currency | DOGE, 18 decimals (minTip is `5000000000000000000` = 5 DOGE) | deployment.json |
| TipEscrow | `0x207652b0767F9f19d24B5300E2123D415167aCeF`, deploy block `9065839` | deployment.json |
| Fee oracle | `0x5300000000000000000000000000000000000002`, `getL1Fee(bytes signedRlpTx)` | FEES.md section 3 |
| Read from chain, never hard-code | `minTip()`, `refundDelay()` (testnet: 5 DOGE, 600 s) | README |
| Every uint256 and wei amount | a decimal **string** in JSON; parse with `BigInt`, never `Number` | backend.md |
| X ids | can exceed 2^53: always strings or `BigInt` | backend.md |

### Contract (what the UI uses)

- `tip(bytes32 idHash) payable returns (uint256 tipId)`. Reverts `ZeroValue`, `BelowMinTip`.
- `claim(uint256 xId, address recipient, uint256 nonce, uint256 expiry, bytes signature)`: pays **every pending tip** for that X id to `recipient`. Reverts `Expired`, `ZeroAddress`, `NonceUsed`, `BadSignature`, `NothingToClaim`, `TransferFailed`.
- `refund(uint256 tipId)`: tipper only, after `refundDelay`. Reverts `UnknownTip`, `NotTipper`, `AlreadyRefunded`, `AlreadyClaimed`, `TooEarly`, `TransferFailed`.
- Views: `balanceOf(bytes32)`, `tips(uint256)` → `(idHash, tipper, createdAt, refunded, amount)`, `tipStatus(uint256)` → `0 None, 1 Pending, 2 Claimed, 3 Refunded` (enum order checked in `TipEscrow.sol`), `refundableAt(uint256)`, `idHash(uint256)`, `minTip()`, `refundDelay()`, `sweptBefore(bytes32)`, `tipCount()`.
- Events: `Tipped(tipId, idHash, from, amount)`, `Claimed(idHash, recipient, amount, nonce, xId)`, `Refunded(tipId, idHash, tipper, amount)`.
- `idHash(xId) = keccak256(abi.encode(uint256 xId))`. Compute it in the browser with viem: `keccak256(encodeAbiParameters([{type:'uint256'}],[BigInt(xId)]))`. Write a unit test that it equals the contract's `idHash` for `2244994945` → `0x9459c13b…21914` (value in backend.md).

### Backend (already built, see docs/backend.md for the full contracts)

| Call | Auth | Use |
|---|---|---|
| `GET {FUNCTIONS_URL}/resolve?handle=…` | none | preview while typing (cached, up to 1 h old) |
| `GET {FUNCTIONS_URL}/resolve?handle=…&fresh=1` | none | **right before the user confirms a tip**. Always asks X. Rate limit 10/min per IP |
| `POST {FUNCTIONS_URL}/sign-claim` `{recipient}` | `Authorization: Bearer <supabase access_token>` | get the EIP-712 claim signature |
| `GET {FUNCTIONS_URL}/feed?limit=&type=` | none | activity, totals, `config.refundDelaySeconds`, `config.minTipWei`, `sync` |
| Supabase tables `chain_events`, `x_handles` | anon key, read only (RLS) | My tips, Claim lists, handle lookups |

Errors are always `{ "error": { "code", "message" } }`. Map the codes to UI copy (section 6).

`name` from resolve is untrusted text: render it as text, never as HTML.

---

## 1. Environment (frontend)

`frontend/.env.local` (gitignored; add `frontend/.env.example` with empty values and comments):

```
VITE_CHAIN_ID=6281971
VITE_RPC_URL=https://rpc.testnet.dogeos.com/
VITE_EXPLORER_URL=https://blockscout.testnet.dogeos.com
VITE_ESCROW_ADDRESS=0x207652b0767F9f19d24B5300E2123D415167aCeF
VITE_ESCROW_DEPLOY_BLOCK=9065839
VITE_SUPABASE_URL=            # https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=       # anon / publishable key ONLY
VITE_FUNCTIONS_URL=           # https://<ref>.supabase.co/functions/v1  (or the local serve URL)
VITE_REOWN_PROJECT_ID=        # WalletConnect; optional, hide the WalletConnect option if empty
VITE_APP_ORIGIN=              # e.g. https://muchtip.vercel.app ; used in share links. Fallback: window.location.origin
```

Hard rules: the service-role key, `VERIFIER_PRIVATE_KEY`, `X_BEARER_TOKEN` and the deployer key **never** appear anywhere under `frontend/`. Add a check script (or test) that fails the build if any of those names or a 64-hex private key string appear in `frontend/src` or `frontend/dist`.

Validate the env at startup (zod or hand-written). If something required is missing, show one clear error screen in dev, not a blank page.

---

## W1. Foundation

1. **Chain**: `defineChain` for DogeOS Chikyū (id, name "DogeOS Chikyū", native DOGE/18, RPC, explorer).
2. **Clients**: wagmi + viem + TanStack Query. Public client transport `http(RPC, { batch: true })` so parallel reads go in one JSON-RPC batch. **Do not depend on Multicall3**: whether it is deployed on Chikyū is **UNVERIFIED**. (You may check with `eth_getCode` on `0xcA11bde05977b3631167028862bE2a173976CA11`; if it exists you may enable it, otherwise keep batching.)
3. **Wallets**: injected wallets discovered via EIP-6963 (MetaMask, MyDoge or anything else installed) plus WalletConnect when `VITE_REOWN_PROJECT_ID` is set. Whether MyDoge exposes an EVM provider for DogeOS is **UNVERIFIED**: do not special-case it, let discovery show what exists.
4. **Network**: if the wallet is on another chain, "Add DogeOS Chikyū" calls `switchChain`; on error 4902 (unknown chain) call `wallet_addEthereumChain` with the chain params, then switch.
5. **ABIs**: one `escrowAbi` const typed `as const` (functions, events, custom errors) and `oracleAbi` (`getL1Fee(bytes) view returns (uint256)`). Use typed errors to decode reverts.
6. **Supabase client** (anon key) with `persistSession: true`, `detectSessionInUrl: true`.
7. **Contract config hook** `useEscrowConfig()`: reads `minTip()` and `refundDelay()` from the chain once, cached for the session. Fallback to `feed().config` if the RPC fails. Everything that shows "min 5 DOGE" or "10 minutes" uses this, and formats the delay ("10 minutes", "7 days").
8. **Setup strip and landing "Get started"** become live:
   - Step 1 done: a wallet is connected.
   - Step 2 done: the wallet's chain id is 6281971.
   - Step 3 done: balance ≥ `minTip + tipFeeHigh` (section 2.4). "Get test DOGE" opens `https://faucet.testnet.dogeos.com` in a new tab.
   - The X button dismisses the strip (remember in localStorage, in try/catch).
9. **Header**: live network pill (red "Wrong network" with a Switch button when off-chain), live balance (`formatEther`, 2 decimals, Plex Mono), short address, disconnect.
10. **Formatting helpers** with unit tests: `formatDoge(wei, {decimals})`, `parseDoge(input)` (rejects more than 18 decimals and negatives), `shortAddr`, `shortHash`, `explorerTx(hash)`, `explorerAddr(addr)`, relative time and countdown.

## W2. Send a tip (`/app`, frames A0–A5 and S1)

1. **Prefill**: `/app?to=<handle>&amount=<n>` fills the form (this is what share links use). Validate both.
2. **Handle field**: strip a leading `@`, validate `^[A-Za-z0-9_]{1,15}$` as you type. A pasted `x.com/<handle>` URL may be converted to the handle in the UI before validation.
3. **Preview** (debounced 400 ms): `resolve` without `fresh`. Show the found card (avatar initials from `name`, `name`, `@handle`, `X ID …`, "Verified on X"). 404 → "No X account called @…". Never block typing on the request; cancel stale requests.
4. **Fees** (FEES.md section 5, follow it exactly):
   - Build the `tip(idHash)` transaction with the real `value`, nonce, gas and fee fields; sign a copy with a throwaway `privateKeyToAccount(generatePrivateKey())` (never stored, never funded); call `oracle.getL1Fee(signedCopy)`; add `gasLimit × maxFeePerGas`. That is the **estimate**. `high = estimate × 1.5`.
   - Refresh every 15 s while the form is open, and once more on Review.
   - If the oracle call fails, use the ceilings: tip `0.35`, claim `0.85`, refund `0.30` DOGE, and say "up to".
   - Show "Network fee about X, up to Y DOGE" and "You pay at most amount + high".
   - Tell the user the wallet may show a much smaller fee (one short line, as in the design).
5. **Amount**: presets from the design. The "min N DOGE" label comes from `useEscrowConfig`. Block below `minTip` with the design's message before the wallet opens.
6. **Balance gate**: enable Review only if `balance ≥ amount + high`. Otherwise use the "blocked" state from frame S1 with the real numbers and the "Get test DOGE" and "Tip N DOGE instead" actions (`N = balance − high`, rounded down, and only if ≥ minTip).
7. **Review** (S1 review): call `resolve` with **`fresh=1`**. If the fresh `xId` differs from the preview, show the new account and require confirmation again. Show "You're tipping **name** (@handle, ID …)", amount, fee range, total at most, balance after, and the refund line using the real `refundDelay`.
8. **Send**: `writeContract({ functionName: 'tip', args: [idHash], value })` where `idHash` is the **fresh** resolve result (also check it equals the locally computed `idHash(xId)`; abort if not).
   - Waiting for wallet: S1 state 2. User rejects (4001) → back to review with "You cancelled in your wallet".
   - Submitted: S1 state 3 with the tx hash, Copy and Explorer. "You can close this page."
   - Confirmed (`waitForTransactionReceipt`, status success): S1 state 4. Read the **raw** receipt with `eth_getTransactionReceipt` and show the real fee = `l1Fee + gasUsed × effectiveGasPrice` (viem drops `l1Fee`, so call the RPC method directly). Get `tipId` from the `Tipped` log.
   - Reverted or failed: S1 state 5 with the decoded custom error (section 6).
9. **Receipt**: the `ReceiptTicket` now uses live data (amount, to, from, status, sent time, refund time from `refundableAt(tipId)`, tx hash, note). The note is client-side only (not on chain): keep it in the receipt and share text, and say so nowhere else.
10. **Share**: "Tell them on X" opens `https://x.com/intent/tweet?text=…` (**UNVERIFIED** whether `x.com/intent/post` is now preferred; test both and use the one that works) with: `I just tipped you {amount} DOGE on MuchTip. Claim it with your X account: {origin}/app/claim`. "Copy link" copies `{origin}/app/claim`.
11. **Recently sent** on the Send tab = the latest 3 rows of My tips (W4).

## W3. Claim (`/app/claim`, frames A2, P2)

1. **Sign in with X**: `supabase.auth.signInWithOAuth({ provider: 'x', options: { redirectTo: origin + '/app/claim' } })`. The backend gate requires the identity provider to be exactly `x` (checked in `supabase/functions/_shared/claim-gate.ts`), so do **not** use the legacy `twitter` provider. Sign out button.
2. **Who am I**: from `session.user.identities`, require exactly one identity with `provider === 'x'`; `xId = identity.id` (string); handle and name from `identity_data` for display only. Never read the X id from `user_metadata`. If the user has another identity, show the `identity_not_allowed` message and a Sign out button.
3. **What is waiting** (all live):
   - Total: `balanceOf(idHash(xId))` from the chain. This is the source of truth for "Waiting for you".
   - The list: `chain_events` where `event = 'Tipped'` and `id_hash = idHash` (lowercase hex), then read `tipStatus(tipId)` and `refundableAt(tipId)` for each (batched). Show only Pending tips: from (short address), amount, sent time, "refundable in mm:ss" countdown.
   - "Next refund deadline" = the smallest `refundableAt` among Pending tips (a live countdown; "—" when none).
   - "Claimed so far" and claim history: `chain_events` where `event = 'Claimed'` and `id_hash = idHash`.
   - The index can lag by a few blocks: if `balanceOf` > sum of listed Pending tips, show "Some tips are still syncing" instead of a wrong list.
4. **Claim all**:
   - Needs a connected wallet on Chikyū (the recipient is the connected address, shown as "to 0x… connected wallet").
   - Fee: estimate the claim the same way as tips (oracle, ×1.5, ceiling 0.85). The **claimant pays this fee**. If balance < high, disable Claim and show "You need about Y DOGE for the network fee" with the faucet link. (Decision for the hackathon: no relayer. See section 7.)
   - Call `sign-claim` with `{ recipient: address }` and the session token. If `claimable` is false, show "Nothing to claim yet".
   - Submit `claim(BigInt(xId), recipient, BigInt(nonce), BigInt(expiry), signature)`. The signature expires about 300 s after the latest block: if the user waits too long and gets `Expired`, fetch a new signature automatically once.
   - Same transaction states as Send (waiting, submitted, confirmed with the real fee, failed with a decoded error).
5. **Your tip page** card: "Copy" copies `{origin}/app?to={handle}`.

## W4. My tips, Activity and the landing feed

1. **My tips** (`/app/tips`, A3, P3): needs a connected wallet.
   - Rows: `chain_events` where `event = 'Tipped'` and `account = lower(address)`, newest first, paged 20 at a time.
   - Handle: join on `x_handles.id_hash` (show the short idHash when unknown).
   - Status for each tip from the chain, batched: `tipStatus`, `refundableAt`.
     - Pending and `now < refundableAt` → "Waiting to be claimed" + disabled "Refund in mm:ss".
     - Pending and `now ≥ refundableAt` → "Unclaimed, refundable" + **Refund**.
     - Claimed → "Claimed" + "Receipt".
     - Refunded → "Refunded to you".
   - **Refund**: fee estimate (ceiling 0.30), balance gate, `refund(tipId)`, the same transaction states, then refresh the row. Decode `TooEarly`, `AlreadyClaimed`, `AlreadyRefunded`, `NotTipper`.
   - "Receipt" opens the ReceiptTicket for that tip.
2. **Activity** (`/app/activity`, A4, P4) and the **landing activity section** (F1–F4):
   - `feed?limit=25&type=…` with the All, Tips, Claims and Refunds filters. Poll every 5 s while the tab is visible (pause when hidden).
   - States: loading → skeleton (F2); `events.length === 0` → empty (F3); error → error state (F4) that keeps the last good data and shows "Last successful update …"; otherwise live (F1), with the chip saying "Live". When `sync.complete` is false, show "Syncing" in the chip.
   - Row: type badge, from → to (handle when known, else short address; "TipEscrow" for Claimed/Refunded senders), amount, time, tx link to the explorer.
   - Remove the "Example data" chip from production builds.
3. **Landing numbers**: anything the landing shows as a statistic must come from `feed().totals`. If a figure has no live source, remove it rather than show a sample.
4. **Claim badge** in the app tabs ("Claim 3"): number of Pending tips for the signed-in X account; hidden when signed out.
5. **My tips badge**: number of refundable tips for the connected wallet.

## 5. Things that must stay static

- `PhoneScreen` (hero phones) and its three personas: static illustration, labelled sample.
- The How it works receipt on the landing: sample, labelled "Sample receipt".

## 6. Error copy

| Source | Code or error | Show |
|---|---|---|
| wallet | user rejected (4001) | "You cancelled in your wallet." |
| wallet | insufficient funds | "Not enough DOGE to cover the tip and the network fee." |
| contract | `BelowMinTip` | "The minimum tip is {minTip} DOGE." |
| contract | `ZeroValue` | "Enter an amount." |
| contract | `NothingToClaim` | "There's nothing to claim right now." |
| contract | `Expired` | "That claim took too long. Try again." (auto-retry once) |
| contract | `NonceUsed`, `BadSignature` | "This claim can't be used. Try again." |
| contract | `TooEarly` | "You can refund this tip at {time}." |
| contract | `AlreadyClaimed` | "They already claimed this tip." |
| contract | `AlreadyRefunded` | "You already got this tip back." |
| contract | `NotTipper`, `UnknownTip` | "Only the person who sent this tip can refund it." |
| resolve | `handle_not_found` | "No X account called @{handle}." |
| resolve | `invalid_handle` | "Handles are 1 to 15 letters, numbers or underscores." |
| resolve | `rate_limited`, `upstream_rate_limited` | "Too many lookups. Try again in a minute." |
| resolve | `upstream_unavailable` | "We can't reach X right now. Try again shortly." |
| sign-claim | `invalid_token`, `missing_token` | "Your X sign-in expired. Sign in again." (+ button) |
| sign-claim | `identity_not_allowed` | "This account is linked to something other than X. Sign out and sign in with X only." |
| sign-claim | `rate_limited` | "Too many claim attempts. Try again in a few minutes." |
| sign-claim | `chain_unavailable`, `wrong_chain`, `verifier_mismatch` | "Claiming is unavailable right now. Your tips are safe in the contract." |
| any | network error | "Can't reach the server. Check your connection." |

## 7. Decisions already made

- **No relayer for the hackathon.** The claimant pays their own claim fee (about 0.04 to 0.76 DOGE on testnet, FEES.md section 4). The setup strip's "Get test DOGE" covers it. A relayer can be added later without a contract change (FEES.md section 4).
- **Verifier**: the deployed verifier is a test key. Rotating it with `setVerifier` is an owner transaction and costs DOGE: **do not run it**. Kelvin will do it separately.

## 8. Tests and checks

1. Unit tests: idHash, formatting/parsing, the fee buffer and gate maths, error decoding, the My tips status mapping, the countdown.
2. Component tests with mocked wagmi and fetch for each S1 state.
3. Against the hosted or local Supabase: resolve (mock mode is fine locally), feed, and sign-claim with a test X session if one is available.
4. **Never send a transaction (tip, claim, refund, setVerifier) without asking Kelvin first**, with the action, the amount and the fee estimate. Testnet DOGE is still his.
5. `npm run build`, lint and typecheck pass. The secret-scan check from section 1 passes.
6. Playwright: every app page at 1440 and 390 px with a mocked wallet, compared with the spec frames; there must be no visual regressions from v5.
