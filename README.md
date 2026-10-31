# DOGE tips to X accounts, on DogeOS Chikyū testnet

Reference implementation for the *Vibe Code on DOGE* hackathon. It will later be ported into Noah AI. Not audited.
Testnet only.

**Live deployment (Chikyū testnet, chain 6281971):**
[`0x207652b0767F9f19d24B5300E2123D415167aCeF`](https://blockscout.testnet.dogeos.com/address/0x207652b0767F9f19d24B5300E2123D415167aCeF),
refund delay 600 s, minimum tip 5 DOGE. Details and every transaction hash: `deployment.json`, `verified.md` section 6a.
Its verifier is a **test key**, to be replaced with `setVerifier` before real use.

**Idea:** anyone can tip DOGE to an X account. The DOGE waits in a contract until the account's owner signs in with
X and claims it; the tipper can take it back after a delay if nobody claims.

## How it works

1. **Tip.** The tipper enters an X handle. The `resolve` Edge Function turns it into X's numeric user id
   (and refuses handles that don't exist, see `docs/resolve-plan.md`). The app calls
   `tip(idHash(xId))` with DOGE attached.
2. **Claim.** The recipient signs in with X through Supabase Auth. An Edge Function reads their X id from the
   verified Supabase user, checks they have exactly one `x` identity, and signs an EIP-712
   `Claim(xId, recipient, nonce, expiry)` with the verifier key (a Supabase secret). Anyone can submit the signature;
   the contract pays `recipient` every pending tip for that X id.
3. **Refund.** If a tip is still unclaimed `refundDelay` seconds after it was made, its tipper can call
   `refund(tipId)` to get it back.

Tips are keyed by the **numeric X id**, not the handle: handles can be renamed and reused, ids cannot.
`idHash(xId) = keccak256(abi.encode(uint256 xId))`. X ids can exceed 2^53, so treat them as strings/BigInt in JS.

## Contract: `src/TipEscrow.sol`

| Function | Who | What |
|---|---|---|
| `tip(bytes32 idHash) payable` | anyone | Escrow `msg.value` (at least `minTip`) for that X id. Returns the new `tipId`. |
| `claim(xId, recipient, nonce, expiry, signature)` | anyone with a valid verifier signature | Pays all pending tips for `xId` to `recipient`. One-time nonce per X id. |
| `refund(tipId)` | the original tipper only | Returns an unclaimed tip after `refundDelay`. |
| `setVerifier(address)` | owner only | Rotate the signing key. Old-key signatures stop working immediately. Emits `VerifierUpdated`. |
| `idHash(xId)`, `claimDigest(...)`, `tipStatus(tipId)`, `refundableAt(tipId)`, `balanceOf(idHash)` | view | Helpers for the UI. |

Events: `Tipped(tipId, idHash, from, amount)`, `Claimed(idHash, recipient, amount, nonce, xId)`,
`Refunded(tipId, idHash, tipper, amount)`, `VerifierUpdated(old, new)`.

The **owner** is fixed at deployment (no transfer function) and can only rotate the verifier; it cannot touch escrowed
funds. The **verifier** key can authorise a claim for *any* X id, so protect it like the owner key.

## Minimum tip: 5 DOGE on the hackathon deployment

- `minTip` is a **constructor parameter** (wei), immutable per deployment. A tip below it reverts with `BelowMinTip`; a zero tip always reverts with `ZeroValue`.
- `scripts/deploy.cjs` reads `MIN_TIP_WEI` from `.env`: the hackathon deployment sets **5000000000000000000** (5 DOGE); if unset the minimum is **0** (none). After deploying it reads `minTip()` back from the contract and aborts if it differs.
- Why: claiming costs the recipient a network fee (see FEES.md), so a dust tip could cost more to claim than it pays.
- The UI must read `minTip()` from the contract and show it ("minimum tip 5 DOGE") rather than hard-code it.

## Refund delay: 600 seconds on the hackathon deployment

- `refundDelay` is a **constructor parameter** (seconds), stored immutably per deployment.
- **Code default: 7 days.** `scripts/deploy.cjs` uses 604800 s unless `REFUND_DELAY_SECONDS` is set in `.env`.
- **The hackathon deployment uses 600 s (10 minutes)** (`REFUND_DELAY_SECONDS=600` in `.env`) so a judge can watch a refund happen.
- **What this means for users, and the UI must say so:** a tipper can take their tip back 10 minutes after tipping if the
  recipient has not claimed yet. Recipients should claim promptly. The UI must **read `refundDelay()` from the contract**
  (never hard-code 10 minutes) and show it on the Tip page ("refundable after 10 min if unclaimed") and wherever a
  tip's refund status is shown (`refundableAt(tipId)`).

## Fees

DogeOS charges an `l1Fee` on top of gas, and it is almost the entire fee. At the e2e run: **0.22 DOGE per tip, 0.35 per
claim, 0.24 per refund, 6.8 per deploy**, but the fee moves several-fold within hours. Wallets and `eth_estimateGas`
show only the tiny gas part. **See [FEES.md](FEES.md)** for the measurements and for how the UI must quote the fee
live from DogeOS's fee oracle and keep a balance buffer. Also see its open question: a new recipient needs DOGE in their
wallet to pay the claim fee unless a relayer submits the claim.

## Supabase project settings (auth hardening)

The claim Edge Function signs for whoever the caller's X login says they are, so the Supabase project must only ever
produce users with a single X identity. In the Supabase project:

1. **Disable the Email, Phone and Anonymous sign-in providers.** Leave only X (OAuth 2.0) enabled.
2. Keep **manual identity linking off** (it is off by default).
3. Turn on **"allow users without an email"** for the X provider, if the dashboard offers it (self-hosted GoTrue:
   `GOTRUE_EXTERNAL_X_EMAIL_OPTIONAL=true`). Without it, an X account with no confirmed email cannot sign in at all.
   Whether the hosted dashboard exposes this toggle is UNVERIFIED.

And in the Edge Function, **before signing**, apply this check (reference: `spike/supabase/edge-check.cjs`):

```js
const { data, error } = await auth.getUser(jwt);        // network call; validates signature, expiry, user exists
const user = data?.user;
if (error || !user || user.is_anonymous) reject();
const ids = user.identities ?? [];
if (ids.length !== 1 || ids[0].provider !== 'x') reject();   // any non-'x' identity, or more than one identity: reject
if (!/^\d{1,20}$/.test(ids[0].id)) reject();
const xId = BigInt(ids[0].id);                          // never read the X id or handle from user_metadata (user-writable)
```

Why: with email auto-confirm on, an attacker who signed up with a victim's X email first ended up holding the victim's X
identity next to their own email identity. The old "exactly one x identity" check accepted that account; this one
rejects it. Tests: `spike/supabase/run-hardening.sh` runs it against a real GoTrue (details in `verified.md`), and
`spike/supabase/test-edge-check.cjs` (no Docker) tables 22 user shapes through the same function, including a phone
identity, x + x and x + another provider, which the live harness cannot create. Not tested against GoTrue: the phone
provider itself (only that GoTrue refuses phone sign-up when it is disabled).

## Setup (clone and run)

Needs [Foundry](https://getfoundry.sh) (developed with 1.8.3), Node 20+ with npm, and `git`. Docker is only needed for
the auth-hardening tests. `lib/`, `node_modules/` and `out/` are gitignored, so a fresh clone fetches them:

```
git clone https://github.com/Shanks-btc/MuchTip.git && cd MuchTip
forge install foundry-rs/forge-std@v1.11.0 --no-git    # test library, pinned; --no-git keeps lib/ out of version control
npm ci                                                 # ethers 6.13.4 and supabase-js 2.117.3, pinned by package-lock.json
forge build                                            # solc 0.8.30 is downloaded on first use; the scripts read out/
forge test                                             # about a minute: 53 unit/fuzz tests + 3 invariants (128,000 calls)
npm run test:edge-check                                # claim-gate table test, no Docker
npm run simulate                                       # read-only check against the live testnet RPC (needs .env, below)
```

## Commands

```
forge test                                                   # unit/fuzz tests + 3 invariants (128,000 random calls, incl. sub-minimum tips)
node spike/supabase/test-edge-check.cjs                      # claim-gate table test (no Docker)
forge build                                                  # scripts read out/TipEscrow.sol/TipEscrow.json
node scripts/deploy.cjs                                      # deploy to Chikyū; writes deployment.json (needs funded PRIVATE_KEY)
node scripts/tipescrow-e2e.cjs simulate https://rpc.testnet.dogeos.com/   # read-only, no funds needed
node scripts/tipescrow-e2e.cjs live https://rpc.testnet.dogeos.com/        # throwaway 45 s-delay deploy: min-tip, tip/claim/refund/rotation + fee report
bash spike/supabase/run-hardening.sh                         # auth-hardening tests (needs Docker; see the script header)
```

`deploy.cjs` overwrites `deployment.json`, and `tipescrow-e2e.cjs live` overwrites `e2e-result.json`. Both files are the
committed record of the live run, so run those two only if you mean to redeploy or re-test, and with your own keys.

`.env` is gitignored and **not** in the repo; create it yourself (never commit it):

```
RPC_URL=https://rpc.testnet.dogeos.com/
CHAIN_ID=6281971
PRIVATE_KEY=0x…                 # funded deployer: deploy.cjs, fee-check.cjs, e2e live
VERIFIER_PRIVATE_KEY=0x…        # test verifier key: e2e simulate/live (the production key lives only in a Supabase secret)
VERIFIER_ADDRESS=0x…            # that key's address: deploy.cjs, fee-check.cjs
REFUND_DELAY_SECONDS=600        # optional, default 604800 (7 days)
MIN_TIP_WEI=5000000000000000000 # optional, default 0 (no minimum); 5 DOGE
# OWNER_ADDRESS=0x…             # optional, default: the deployer
```

## Network

DogeOS Chikyū testnet: chain ID **6281971**, RPC `https://rpc.testnet.dogeos.com/`, explorer
`https://blockscout.testnet.dogeos.com`, faucet `https://faucet.testnet.dogeos.com` (one claim per 24 h, 42.069 DOGE).
EVM target `prague`, Solidity 0.8.30.

## Where things are

- `verified.md`: what was checked live and what is still unverified.
- `FEES.md`: measured fees, why they move, and how the UI should show them.
- `docs/backend.md`: the Supabase backend (`resolve`, `sign-claim`, `feed` Edge Functions, migrations, tests, how to deploy).
- `supabase/`: migrations, Edge Functions and their tests.
- `docs/resolve-plan.md`: plan for the handle → X id Edge Function and its Supabase cache table.
- `spike/supabase/`: harness that tested Supabase's X login and identity handling against a real auth server.
- `verified-testnet-baseline.md`: earlier research on the DogeOS testnet (RPC, chain, faucet).
- `deployment.json`, `e2e-result.json`, `e2e-result.testnet-v1.json`: addresses and transaction hashes of the live runs.
