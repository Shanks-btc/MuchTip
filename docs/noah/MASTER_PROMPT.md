# Master prompt for Noah AI (Agent mode)

Paste everything between the two lines below into Noah's chat in **Agent mode**, as the first message of a new
**DogeOS · Website** project. It is written for Noah's generated code; the exact, tested source for every file is in
[FILES.md](FILES.md) if a part needs to be replaced verbatim afterwards.

---

Build **MuchTip**, a web app for tipping any X (Twitter) handle in DOGE on the **DogeOS Chikyū testnet**. The smart
contract and the backend already exist and are live. Your job is the frontend only.

## Hard rules (do not break these)

1. **Do NOT deploy a new smart contract, and do not generate one.** Use the existing TipEscrow contract at
   `0x207652b0767F9f19d24B5300E2123D415167aCeF` on chain 6281971, exactly as described below.
2. **Do NOT connect, create or modify any Supabase project**, and do not enable Noah Cloud. Do not generate Supabase
   migrations, tables, Edge Functions or Auth settings. The backend is already deployed; the app only calls it over HTTPS
   with the public values from the environment variables below.
3. **Do NOT use Privy, Dynamic, Web3Auth, RainbowKit, ConnectKit, Reown AppKit, thirdweb or any other wallet SDK.** Use
   **wagmi 2 + viem 2** only, with wagmi's `injected()` connector (EIP-6963 discovery is built into wagmi; any installed
   EVM wallet appears). No embedded wallets, no social-login wallets.
4. Never put a private key, service-role key or API secret in the frontend. Only the two public Supabase values below.
5. Every on-chain amount and every X id is a **bigint** (or a decimal string from the API). Never use JavaScript
   `number` for wei or X ids (X ids exceed 2^53).

## Stack

React 19 + TypeScript + Vite + Tailwind CSS 3, `wagmi` 2, `viem` 2, `@tanstack/react-query` 5, `react-router-dom` 7,
`@supabase/supabase-js` 2 (only for Sign in with X and two read-only tables). Exact versions are in FILES.md.

## Environment variables

Noah prefixes variables with `VITE_REACT_APP_`. Read these (all public):

- `VITE_REACT_APP_SUPABASE_URL` = `https://pztyjrxfdieleucryskj.supabase.co`
- `VITE_REACT_APP_SUPABASE_ANON_KEY` = the project's publishable (anon) key
- `VITE_REACT_APP_APP_ORIGIN` = the published site origin (used in share links)

Derive the functions base URL as `${SUPABASE_URL}/functions/v1`. If the Supabase values are missing, show "Handle lookups
aren't available on this site yet: its backend isn't configured." instead of failing.

## Chain

Define the chain with viem `defineChain`:

- id `6281971`, name `DogeOS Chikyū`, native currency DOGE (18 decimals)
- RPC `https://rpc.testnet.dogeos.com/` with `http(RPC, { batch: true })`
- explorer `https://blockscout.testnet.dogeos.com` (tx links `/tx/<hash>`, address links `/address/<addr>`)
- Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11` (deployed and working on Chikyū)
- testnet faucet: `https://faucet.testnet.dogeos.com`

If the wallet is on another chain, offer "Switch to DogeOS Chikyū" (`switchChain`; wagmi adds the chain on error 4902).

## Contract: TipEscrow `0x207652b0767F9f19d24B5300E2123D415167aCeF` (deploy block 9065839)

How it works: a tip is held by the contract for an X account, identified by
`idHash = keccak256(abi.encode(uint256 xId))` (in viem: `keccak256(encodeAbiParameters([{type:"uint256"}],[BigInt(xId)]))`;
`idHash(2244994945)` must equal `0x9459c13b5c21e1f0cc54307300f50fe36658555fa2b2355575aa4d05c6f21914`). The recipient claims
every pending tip with one `claim(...)` call, using a signature from our backend. If not claimed, the tipper can
`refund(tipId)` after `refundDelay()` seconds. Read `minTip()` and `refundDelay()` from the chain; never hard-code 5 DOGE
or 10 minutes. `tipStatus`: 0 None, 1 Pending, 2 Claimed, 3 Refunded.

ABI (human-readable, use with viem `parseAbi`):

```
function CLAIM_TYPEHASH() view returns (bytes32)
function DOMAIN_TYPEHASH() view returns (bytes32)
function balanceOf(bytes32 idHash) view returns (uint256)
function claim(uint256 xId, address recipient, uint256 nonce, uint256 expiry, bytes signature)
function claimDigest(uint256 xId, address recipient, uint256 nonce, uint256 expiry) view returns (bytes32)
function domainSeparator() view returns (bytes32)
function idHash(uint256 xId) pure returns (bytes32)
function minTip() view returns (uint256)
function nonceUsed(bytes32 idHash, uint256 nonce) view returns (bool)
function owner() view returns (address)
function refund(uint256 tipId)
function refundDelay() view returns (uint256)
function refundableAt(uint256 tipId) view returns (uint256)
function setVerifier(address newVerifier)
function sweptBefore(bytes32 idHash) view returns (uint256)
function tip(bytes32 idHash_) payable returns (uint256 tipId)
function tipCount() view returns (uint256)
function tipStatus(uint256 tipId) view returns (uint8)
function tips(uint256 tipId) view returns (bytes32 idHash, address tipper, uint64 createdAt, bool refunded, uint256 amount)
function verifier() view returns (address)
event Claimed(bytes32 indexed idHash, address indexed recipient, uint256 amount, uint256 nonce, uint256 xId)
event Refunded(uint256 indexed tipId, bytes32 indexed idHash, address indexed tipper, uint256 amount)
event Tipped(uint256 indexed tipId, bytes32 indexed idHash, address indexed from, uint256 amount)
event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier)
error AlreadyClaimed()
error AlreadyRefunded()
error BadSignature()
error BelowMinTip()
error Expired()
error NonceUsed()
error NotOwner()
error NotTipper()
error NothingToClaim()
error TooEarly()
error TransferFailed()
error UnknownTip()
error ZeroAddress()
error ZeroValue()
```

Never call `setVerifier` (owner only). Simulate every write (`simulateContract`) before opening the wallet, so a revert
shows a clear message instead of a failed transaction.

## Network fees (DogeOS has an L1 data fee wallets don't show)

Fee = `l1Fee + gasUsed × effectiveGasPrice`. Before signing, estimate it: build the real transaction, sign a copy with a
throwaway key (`privateKeyToAccount(generatePrivateKey())`, never stored or funded), call
`getL1Fee(bytes) view returns (uint256)` on the oracle `0x5300000000000000000000000000000000000002` with the signed copy,
add `gas × maxFeePerGas`. Show "Network fee about X to Y DOGE" with `Y = estimate × 1.5`, refresh every 15 s and once more
right before sending. If the oracle call fails, use the ceilings tip 0.35, claim 0.85, refund 0.30 DOGE and say "up to".
Enable a send only if `balance ≥ amount + Y`. After it is mined, show the real fee from the raw `eth_getTransactionReceipt`
(`l1Fee + gasUsed × effectiveGasPrice`; viem drops `l1Fee`, so call the RPC method directly). Tell users their wallet may
show a smaller fee.

## Backend (already deployed; call it, don't build it)

Base `${SUPABASE_URL}/functions/v1`. Send the anon key as the `apikey` header. Every uint256 is a decimal **string**.
Errors are always `{ "error": { "code", "message" } }`.

- `GET /resolve?handle=<h>` (display lookup, cached) and `GET /resolve?handle=<h>&fresh=1` (**always use fresh=1 right
  before the user confirms a tip**) → `{ xId, handle, name, idHash, resolvedAt, source }`. `name` is untrusted: render as
  text only. Only `source: "x"` may receive a real tip. 404 `handle_not_found` means no such account.
- `POST /sign-claim` with `Authorization: Bearer <supabase session access_token>` and `{ "recipient": "0x…" }` →
  `{ xId, recipient, nonce, expiry, signature, unclaimedWei, claimable }`. Then call
  `claim(BigInt(xId), recipient, BigInt(nonce), BigInt(expiry), signature)`. If it fails with `Expired`, fetch a new
  signature and retry **once** automatically. If `claimable` is false, say "Nothing to claim yet".
- `GET /feed?limit=25[&type=Tipped|Claimed|Refunded]` → `{ config, sync: { complete }, totals, events[] }`. Poll every 5 s
  while the tab is visible. States: loading skeleton, empty ("No tips on this contract yet"), error that keeps the last
  rows and shows "Last successful update …", live (chip "Live"; "Syncing" while `sync.complete` is false).
- Read-only tables with the anon key (supabase-js, select only): `chain_events` (columns `contract`, `block_number`,
  `log_index`, `tx_hash`, `event`, `id_hash`, `tip_id`, `account`, `amount_wei` (select it as `amount_wei::text`),
  `block_time`; addresses and hashes are lowercase) and `x_handles` (`id_hash`, `handle`).

Sign in with X: `supabase.auth.signInWithOAuth({ provider: "x", options: { redirectTo: origin + "/app/claim" } })`.
Accept a session only if `user.identities` has exactly one identity and its `provider === "x"`; the X id is
`identities[0].id`, never `user_metadata`. A failed sign-in returns with `?error=…&error_description=…` (query or hash) on
any page: send the user to `/app/claim` with those params, show "Sign-in with X didn't complete. Please try again." with the
reason in small text and a Try again button, then remove the params from the URL.

## Routes and screens

- `/` landing: hero ("Tip any X handle in DOGE." / "They claim it, or you get it back." both lines ink), live activity
  feed (filters All, Tips, Claims, Refunds; newest 5), how it works (a static sample receipt labelled "Sample receipt"),
  get started (wallet, add network, faucet), why trustless, "Were you tipped?", FAQ, footer.
- `/app` Send: handle field (strip `@`, accept a pasted `x.com/<handle>` URL, 1–15 of `A-Za-z0-9_`), preview lookup
  (debounced 400 ms) with name, `@handle`, X ID and "Verified on X"; presets 5/25/69/420/Other; optional note (client-side
  only, shown on the receipt and share text only when typed); fee lines; Review → fresh lookup (if the X id changed since
  the preview, ask again) → wallet → submitted (tx hash, explorer) → confirmed (real fee, refund time from
  `refundableAt(tipId)` using `tipId` from the `Tipped` log) → "Tell them on X"
  (`https://x.com/intent/tweet?text=@<handle> I just tipped you <amount> DOGE on MuchTip. Claim it with your X account:
  <origin>/app/claim`). A wallet rejection returns to review with "You cancelled in your wallet."
- `/app/claim`: Sign in with X; waiting total from `balanceOf(idHash)`; pending tips from `chain_events` + batched
  `tipStatus`/`refundableAt`; "Some tips are still syncing" if `balanceOf` exceeds the listed tips; claim all in one
  transaction; the claimant pays the fee.
- `/app/tips`: the connected wallet's tips (newest first, 20 per page): "Waiting to be claimed" + "Refund in mm:ss",
  "Unclaimed, refundable" + Refund, "Claimed" + Receipt, "Refunded to you".
- `/app/activity`: the full feed.
- Old links: `/@<handle>` → `/app?to=<handle>`; `/tip`, `/claim`, `/me`, `/feed` → the matching `/app` route, keeping query
  and hash.

Wallet connect must never spin forever: give up after 30 s, and for a pending request (-32002), a locked wallet, a closed
popup, a cancel (4001) or no wallet, show a clear message with Try again.

Error copy (show exactly): BelowMinTip "The minimum tip is {min} DOGE." · ZeroValue "Enter an amount." · NothingToClaim
"There's nothing to claim right now." · Expired "That claim took too long. Try again." · NonceUsed/BadSignature "This claim
can't be used. Try again." · TooEarly "You can refund this tip at {time}." · AlreadyClaimed "They already claimed this
tip." · AlreadyRefunded "You already got this tip back." · NotTipper/UnknownTip "Only the person who sent this tip can
refund it." · handle_not_found "No X account called @{handle}." (only for this code) · invalid_handle "Handles are 1 to
15 letters, numbers or underscores." · rate_limited/upstream_rate_limited "Too many lookups. Try again in a minute." ·
upstream_unavailable "We can't reach X right now. Try again shortly." · invalid_token/missing_token "Your X sign-in
expired. Sign in again." · identity_not_allowed "This account is linked to something other than X. Sign out and sign in
with X only." · chain_unavailable/wrong_chain/verifier_mismatch "Claiming is unavailable right now. Your tips are safe in
the contract." · network or CORS failure "Can't reach the server. Check your connection."

## Design (v5, final)

- Fonts: **Inter** (400, 500, 600, 700) for all text and **IBM Plex Mono** (400, 500, 600) for numbers, hashes, addresses
  and small labels, from Google Fonts. No other fonts. No em dashes in copy.
- Colours: Dogecoin gold `#BA9F33` (hero and footer background, gold buttons, accents, active tab, logo mark, "DOGE"
  labels; hover and pressed `#988430`; focus ring `rgba(186,159,51,0.45)`), ink `#0E0F14` (text, dark cards, receipt),
  gold-ink links `#7A6620`, amber badges text `#5E4F17` on `#F5EEC0`, pastel waiting tiles `#F1E7C2`, demo banner `#EDE2B4`,
  paper `#FAFAF7` (site) and `#F4F3EE` (app), success `#16A34A`, error `#B42318`. Every text colour must have at least
  4.5:1 contrast; on gold backgrounds links hover to ink, not gold-ink.
- Type: hero h1 Inter 600, `clamp(36px, 4.6vw, 66px)`, line-height 1.04, letter-spacing −0.05em, max-width 1000px,
  centred, balanced; lead paragraph Inter 400 18px (17px under 640px), line-height 1.7, max-width 640px; h2 Inter 700,
  h3 Inter 600, headings −0.045em; eyebrows IBM Plex Mono 500 13px, 0.1em, uppercase.
- Layout: under 640px the app uses a phone layout with a bottom tab bar (Send, Claim, My tips, Activity). No horizontal
  scroll at 390px. Visible keyboard focus everywhere. Animations short and functional, and off under
  `prefers-reduced-motion`.

When I paste files from my repository later, keep them exactly as pasted.

---
