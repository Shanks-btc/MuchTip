# Feasibility spike: DOGE tips to X accounts on DogeOS Chikyū

Updated 2026-10-31. Spike only: no frontend yet.
`VERIFIED` = I saw it myself (source link, command output, tx hash). `UNVERIFIED` = not tested, or inferred; the reason is given.

## Verdict: PRIMARY PATH FEASIBLE, with 5 open risks

The contract logic is fully tested (54 tests) and a real deploy → tip → claim → refund run succeeded on Chikyū, with every transaction confirmed on the explorer. **The final contract (owner, `setVerifier`, 600 s delay, 5 DOGE minimum tip) is now live on Chikyū at [`0x207652b0…aCeF`](https://blockscout.testnet.dogeos.com/address/0x207652b0767F9f19d24B5300E2123D415167aCeF)** (deployed 2026-10-31, block 9065839; parameters read back from the chain and matching `.env`). Its full deploy → tip → claim → refund → rotation flow ran live on a throwaway copy with identical code (section 6a), and every transaction was read back from the explorer as `status=ok`. Supabase's real auth server (GoTrue) gives a safe way to learn a user's X id, as long as the Edge Function is written the way section 3c describes.

Open risks, most important first:

1. **Fees are far higher than gas suggests, and they move a lot.** DogeOS adds an `l1Fee` that is almost the whole fee: at the 2026-10-30 e2e run **0.22 DOGE per tip, 0.35 per claim, 0.24 per refund, 6.83 per deploy**; a day later (final run) the same actions cost **0.022 / 0.035 / 0.019 / 0.77**, about 10× less. A wallet that shows only gas under-quotes by a factor of about 100,000. The fee oracle's quote for the *same* transaction swung **7.4× over 3.3 hours**, so a fixed range is wrong; the UI must quote live from the oracle (a quote can be made before signing). Details and UI rules: [FEES.md](FEES.md).
2. **X login probably needs paid X API credits** (3a). Not tested, since I have no X developer account.
3. **Noah has no documented EVM deploy or X-login path** (item 1). Test this in Noah early.
4. **No real X, no real hosted Supabase project was used.** X was mocked against the real GoTrue server (3b to 3d). A hosted project may run a different version.
5. **X accounts without a confirmed email cannot sign in by default** (3d): GoTrue refuses them with "Error getting user email from external provider" unless the X provider is set to allow users without an email. Whether the hosted dashboard has that toggle is UNVERIFIED. Without it, those recipients cannot claim.

| # | Item | Status |
|---|---|---|
| 1 | Noah: Supabase Auth, Edge Functions, secrets | PARTIAL: secrets VERIFIED; X login and EVM deploy in Noah UNVERIFIED |
| 2 | Supabase X/Twitter provider and handle field | VERIFIED (docs, source, and a running GoTrue v2.197.0) |
| 3 | X developer account: OAuth, cost | OAuth VERIFIED; cost UNVERIFIED (see 3a) |
| 3a | X API cost of username → id lookup | UNVERIFIED: price table found, billing mapping inferred |
| 3b | Can a user modify `auth.identities` / `identity_data`? | VERIFIED against real GoTrue (X mocked) |
| 3c | Edge Function pattern: `auth.getUser(jwt)` → X id | VERIFIED against real GoTrue (X mocked) |
| 3d | Strict check (reject any non-`x` identity or more than one identity) + provider hardening | VERIFIED against real GoTrue (X mocked); 2 scenarios inconclusive, see 3d |
| 4 | DogeOS RPC, explorer, faucet | VERIFIED |
| 5 | TipEscrow keyed by X id + refund + owner/rotation + minTip, full test suite | VERIFIED (54/54 pass) |
| 6 | Live e2e on Chikyū: tip → claim, tip → refund, rotation, min-tip | VERIFIED for the final contract (section 6a: 9 txs `status=ok`) and for the previous revision (section 6b: 5 txs) |
| 7 | MyDoge and dapps | PARTIAL: docs VERIFIED; no hands-on test |

---

## Latest revision (your 7 decisions applied; not deployed)

1. **Refund delay:** constructor parameter, code default 7 days, hackathon deployment 600 s (`REFUND_DELAY_SECONDS=600`). Documented in [README.md](README.md). (Done last turn; checked, not redone.)
2. **Feed table:** `x_handles(x_id, handle, resolved_at)`, written only by the `resolve` Edge Function; no new event. Updated in [docs/resolve-plan.md](docs/resolve-plan.md). The plan no longer lets the claim function refresh it. The Feed hashes `x_id`s in the browser to match event hashes; an optional `id_hash` column is described there for when the table grows.
3. **Owner + `setVerifier` + `VerifierUpdated`** with the three tests you named. (Done last turn; unchanged.)
4. **Auth hardening:** the Edge Function check now rejects any non-`x` identity or more than one identity (`spike/supabase/edge-check.cjs`), with tests in `spike/supabase/test-hardening.cjs` run by `run-hardening.sh` (section 3d). Provider settings documented in README.
5. **`minTip` constructor param** (hackathon 5 DOGE via `MIN_TIP_WEI=5000000000000000000` in `.env`; unset = no minimum; a leftover `MIN_TIP_DOGE` now aborts `deploy.cjs` and `fee-check.cjs` instead of being ignored). 7 unit/fuzz tests plus the `invariant_NoTipBelowMin` invariant; mutation-checked with three mutants (see section 5). *Correction:* the first version of this item read `MIN_TIP_DOGE` (not the `MIN_TIP_WEI` you specified) and its invariants never tried a sub-minimum tip; both fixed in the follow-up pass.
6. `src/Probe.sol` and `scripts/deploy-and-verify.sh` deleted. (Done last turn; checked.)
7. **[FEES.md](FEES.md)** written, including new measurements that changed the advice (fees are volatile; the oracle can be queried before signing).
8. **Corrections to my earlier reports:** (a) I had said the fee oracle "does not match what was charged at the transaction's own block" and that its inputs were steady for an hour. Both came from a bug in my script: in ethers v6, `provider.call(tx, blockTag)` silently ignores the second argument, so I had been reading the *latest* block every time. Re-done correctly, the oracle matches the tip's charge exactly, quotes more than was charged for the other three, and its inputs move a lot (FEES.md section 3). (b) My note that the strict identity check was "not run" is superseded: it is now run (3d).

## Previous revision (4 decisions; kept for the record)

1. **Keyed by X numeric id** was already true of the contract (`idHash(uint256 xId)`; there is no `hashHandle` any more), so no contract change was needed. The `resolve(handle) → xId` Edge Function and its `x_handles` cache are planned in [docs/resolve-plan.md](docs/resolve-plan.md).
2. **Feed** reads handle names from that cache table; there is no `tip(string)`.
3. **Refund delay** is a constructor parameter; the code default is 7 days; the hackathon deployment uses **600 s** (`REFUND_DELAY_SECONDS=600` in `.env`). Noted in [README.md](README.md), which also says the UI must read `refundDelay()` from the contract.
4. **Owner + `setVerifier`** added: `constructor(owner, verifier, refundDelay)`, `setVerifier(address) onlyOwner`, event `VerifierUpdated(old, new)`. The owner is fixed (no transfer function) and cannot touch funds.
5. `src/Probe.sol` and `scripts/deploy-and-verify.sh` deleted.
6. **Because the contract changed, section 6's live run below is of the previous revision.** A live run of this revision is pending your funding (see "What is not verified yet").

## Changes before that

1. **Tips are keyed by X numeric id**, not handle. `idHash(xId) = keccak256(abi.encode(xId))`, and the signed claim is `Claim(uint256 xId, address recipient, uint256 nonce, uint256 expiry)`. Renaming or reselling a handle can no longer redirect tips.
2. **`refund(tipId)`** lets the tipper reclaim after `refundDelay` (a constructor parameter) if the tip is unclaimed.
3. The first line of your last message says the live e2e had passed with hashes `[PASTE]`, but no hashes were pasted and no `deployment.json` or `e2e-result.json` existed. I ran it myself, **after** these changes so one deploy covers the final contract. The hashes are in section 6.

## 1. Noah AI docs

Sources: [llms.txt](https://docs.trynoah.ai/llms.txt), [Supabase Auth](https://docs.trynoah.ai/integrations/supabase/supabase-auth.md), [Edge Functions](https://docs.trynoah.ai/integrations/supabase/edge-functions.md), [API Keys & Secrets](https://docs.trynoah.ai/security/api-keys-and-secrets.md), [Supabase overview](https://docs.trynoah.ai/integrations/supabase/overview.md), [Supported Chains](https://docs.trynoah.ai/supported-chains/overview.md).

| Question | Finding | Status |
|---|---|---|
| Can an Edge Function hold a private signing key as a secret? | Yes. Secrets are added in the Cloud tab → Secrets and read with `Deno.env.get('SECRET_NAME')`. The docs list "Private wallet keys" under "Store as Secret" and say secrets are "encrypted at rest and only accessible server-side through Edge Functions". Never paste a private key into Noah's chat; use the Secrets panel. Supabase also reserves the `SUPABASE_` prefix: a custom secret can't start with it ([Supabase secrets docs](https://supabase.com/docs/guides/functions/secrets)). | VERIFIED (docs) |
| Does Noah's Supabase Auth page cover social login? | No. It covers only **Web3 Wallet** login (`signInWithWeb3`, **Solana**). | VERIFIED (docs) |
| Which social providers does Noah list? | One example prompt: "Add Google and GitHub login options …". Email/password and password reset are also shown. **X/Twitter is not mentioned.** | VERIFIED (docs) |
| Will Noah build an X-login flow? | It is plain `signInWithOAuth({ provider: 'x' })`, so it should. I did not try it in Noah. The X client id/secret goes into the Supabase dashboard (you do that). | UNVERIFIED |
| Redirect URLs | Default `*.app.trynoah.ai` domains are configured automatically; a custom domain needs a manual entry. [Redirect URLs](https://docs.trynoah.ai/integrations/supabase/redirect-urls.md) | VERIFIED (docs) |
| EVM / DogeOS support in Noah? | Supported Chains lists **Solana only**; the full docs say "Solana and Irys (an EVM-compatible chain)". Smart-contract docs mention Solidity, but the Deploy flow is Solana devnet/mainnet. The hackathon API lists `chains: ["doge"]`. | Docs say no; hackathon API says yes. UNVERIFIED in the Noah app |
| Noah's frontend stack | Docs say "Noah-generated React application" and use `VITE_*` env vars, so probably Vite + React + TypeScript + Tailwind. | UNVERIFIED (your template paste is still missing) |

**Implication:** Plan to deploy the contract yourself and give the Noah app the address and ABI. Noah's deploy button probably won't reach Chikyū.

## 2. Supabase X / Twitter provider

Sources: [Supabase docs: Twitter/X](https://supabase.com/docs/guides/auth/social-login/auth-twitter), [`x.go`](https://github.com/supabase/auth/blob/master/internal/api/provider/x.go), plus a running GoTrue (3b/3c).

| Question | Finding | Status |
|---|---|---|
| Is X a supported provider? | Yes: **X / Twitter (OAuth 2.0)**, `signInWithOAuth({ provider: 'x' })`. The OAuth 1.0a provider is being deprecated. | VERIFIED |
| What does it need? | An X Project + App (user authentication settings, type **Web App**, **Request email** ON), Callback URL `https://<project-ref>.supabase.co/auth/v1/callback`, Website/Terms/Privacy URLs. Then paste the **Client ID and Secret** into Supabase → Authentication → Providers. | VERIFIED (docs) |
| Scopes and profile call | `users.email`, `tweet.read`, `users.read`, `offline.access`; profile from `GET api.x.com/2/users/me`. | VERIFIED (source) |
| Where is the X id? | **`user.identities[i].id`** (provider `x`) is the numeric X id, and so are `identity_data.sub` and `identity_data.provider_id`. The handle is `identity_data.user_name` / `preferred_username` (no `@`). `user.app_metadata` is `{"provider":"x","providers":["x"]}`. Real output: section 3c. | VERIFIED (running GoTrue) |

## 3. X developer account

Sources: [Getting Access](https://docs.x.com/x-api/getting-started/getting-access.md), [Pay-per-usage pricing](https://docs.x.com/x-api/getting-started/pricing.md), [Free credits](https://docs.x.com/x-api/getting-started/free-credits.md), [OAuth 2.0 authorization code flow](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code.md), [Rate limits](https://docs.x.com/x-api/fundamentals/rate-limits.md), [OpenAPI spec](https://docs.x.com/openapi.json).

| Question | Finding | Status |
|---|---|---|
| OAuth 2.0 user login? | Yes: authorization code flow with PKCE; Web App types are confidential clients with a client secret. | VERIFIED (docs) |
| Approval delay? | Documented onboarding: sign in at console.x.com, accept the Developer Agreement, short profile, create an app. No manual approval step is described. | VERIFIED (docs); not tried |
| Free tier? | None documented; the X API is "pay-per-usage ... No subscriptions", and requests are denied when credits run out. | VERIFIED (docs) |
| Login cost | Supabase calls `GET /2/users/me` on each login. The pricing table has no `/users/me` row. If it counts as "User: Read", it is $0.010 per resource, deduplicated per 24 h. | UNVERIFIED (inferred) |
| Free credits | $20 after the first card + first purchase, up to $50 more matching the first auto-recharge; they expire after 3 months. | VERIFIED (docs) |

### 3a. Cost of username → id lookup — UNVERIFIED

- **Endpoint exists:** `GET /2/users/by/username/{username}` ("Get User by Username", operationId `getUsersByUsername`), and the batch form `GET /2/users/by`. VERIFIED ([OpenAPI](https://docs.x.com/openapi.json), [endpoint page](https://docs.x.com/x-api/users/get-user-by-username.md)).
- **Auth:** it accepts an app-only **Bearer Token**, so the Edge Function can call it server-side without the user logging in. VERIFIED (OpenAPI security: `OAuth2UserToken`, `UserToken`, `BearerToken`).
- **Rate limit:** 300 requests / 15 min per app. VERIFIED ([rate limits](https://docs.x.com/x-api/fundamentals/rate-limits.md)).
- **Price:** the pricing page lists **"User: Read — $0.010 per resource"**, charged "per resource returned", with the same resource deduplicated for 24 h (UTC). It does not say which endpoints count as "User: Read". Looking up one handle most plausibly costs **$0.01**. I did not make a call, so the billing mapping, and whether a failed lookup (unknown handle) is free, are UNVERIFIED.
- **Re-checked for this revision:** the official [developer.x.com pricing page](https://developer.x.com/#pricing) shows the same table ("User: Read — charged per resource fetched, $0.010") and does not map endpoints to categories either. Status stays **UNVERIFIED** until one real call is made and the Developer Console usage is read.
- **From the OpenAPI spec:** a valid username matches `^[A-Za-z0-9_]{1,15}$`; `User.id` is a string; the 200 response has optional `data` and `errors` (including `ResourceNotFoundProblem`), so an unknown name most likely comes back as 200 with `errors` and no `data`. The exact body for a missing user was not observed (UNVERIFIED live). If billing is "per resource fetched", a miss would be free (inferred).
- **Practical impact:** each *new* tip recipient costs about a cent. Cache handle → id in Supabase so repeat tips don't re-pay after the 24 h window (whether X's policy allows caching ids is UNVERIFIED).

### 3b. Can a user modify `auth.identities`? — VERIFIED, with caveats

**Method:** the real Supabase Auth server ([`supabase/gotrue:v2.197.0`](https://hub.docker.com/r/supabase/gotrue), the latest stable) with the official [`supabase/postgres:15.19.0.002`](https://hub.docker.com/r/supabase/postgres), in Docker. Its X provider was pointed at a small mock of X's three OAuth endpoints (`GOTRUE_EXTERNAL_X_URL`), so GoTrue's real X code path ran. Ground truth was read straight from the `auth.identities` table in Postgres. Harness: [spike/supabase/](spike/supabase/) (commands in its README).

**Caveats:** (a) X was mocked, so this proves GoTrue's handling, not X's responses. (b) It is a self-hosted GoTrue, not a hosted Supabase project; I had no project credentials. (c) Email auto-confirm was ON for sections 3 to 5, which is not the hosted default (see "pre-registration" below).

| Attempt (signed-in X user) | Result | Status |
|---|---|---|
| `updateUser({ data: { user_name:'victim', sub:'999', provider_id:'999', id:'999' } })` | Accepted. **`user_metadata` now says `victim` / `sub 999`.** But `identities[0].id` is still `2244994945`, `identity_data.user_name` still `DogeFan_42`, and the `auth.identities` row is unchanged. | VERIFIED |
| `PUT /user` with an `identities: [...]` array | HTTP 200, field ignored; DB row unchanged. | VERIFIED |
| `PUT /user` with `app_metadata` | **403** `not_admin`: "Updating app_metadata requires admin privileges". | VERIFIED |
| `PUT/PATCH/POST/DELETE /user/identities/{id}` | **404** `manual_linking_disabled`. Manual linking is off by default in this build. | VERIFIED |
| `linkIdentity({ provider: 'x' })` | Error "Manual linking is disabled". | VERIFIED |
| Rename on X (same id, new handle) then log in again | Same `auth.users` row reused. `identity_data.user_name` refreshes to the new handle; **`identities[].id` unchanged**; the spoofed `user_metadata` is overwritten by the fresh login. | VERIFIED |

**Conclusion:** `user_metadata` is user-writable, so **never read the X id or handle from it.** `identities[].id` and `identity_data` are not writable through any client route I tried. This matches source: `internal/api/user.go` applies `params.Data` to `UpdateUserMetaData` and has no identity field. Manual linking was also tried while **enabled** (3d): the attempt to link a second X account errored ("Error sending confirmation email"), so it did not produce a two-identity account. The strict check below does not depend on that.

**Pre-registration (account takeover) check:** I signed up with the victim's X email first, then had the victim log in with X.

| Config | Outcome | Status |
|---|---|---|
| Email auto-confirm **ON** (not the hosted default) | GoTrue merged the X identity into my pre-made account; my password login then returned the **victim's X id**. This would let an attacker claim the victim's tips. | VERIFIED |
| Email confirmation **required** (hosted default) | Attacker's password login refused before and after ("Email not confirmed", then "Invalid login credentials"); the account ended with only the `x` identity. Matches [Supabase's docs](https://supabase.com/docs/guides/auth/auth-identity-linking): "Supabase Auth will remove any other unconfirmed identities". | VERIFIED |
| Email provider **disabled** | Sign-up refused: "Email signups are disabled"; X login unaffected. | VERIFIED |

**Recommendation:** disable the email, phone and anonymous providers in the Supabase project so X is the only way in. Also keep the Edge Function strict (below).

### 3c. Edge Function pattern: `auth.getUser(jwt)` → X id — VERIFIED

Evidence is the same running GoTrue. The Edge Function logic (now the **strict** version; the first draft only required exactly one `x` identity and ignored the others):

```js
// auth = createClient(SUPABASE_URL, <server key>).auth ; jwt = the Authorization bearer from the caller   (spike/supabase/edge-check.cjs)
const { data, error } = await auth.getUser(jwt);     // network call to GoTrue: signature + expiry + user still exists
const user = data?.user;
if (error || !user || user.is_anonymous) reject();
const ids = user.identities ?? [];
if (ids.length !== 1 || ids[0].provider !== 'x') reject();   // any non-x identity, or more than one identity
if (!/^\d{1,20}$/.test(ids[0].id)) reject();               // numeric id
const xId = BigInt(ids[0].id);                              // never Number: ids can exceed 2^53
```

| Test | Result | Status |
|---|---|---|
| Valid X-login JWT | `{ ok, xId: 2244994945, username: "DogeFan_42" }` | VERIFIED |
| Payload tampered (`sub` swapped) | rejected: "signature is invalid" | VERIFIED |
| Forged JWT, wrong secret | rejected: "signature is invalid" | VERIFIED |
| Expired JWT with the right secret | rejected: "token is expired" | VERIFIED |
| Anon key / garbage string | rejected: "missing sub claim" / "token is malformed" | VERIFIED |
| `getUser(jwt)` with an anon-key client | also works, so the Edge Function does not strictly need the service key to verify a user | VERIFIED |
| Email user (no X identity) | rejected ("non-x identity: email" with the strict check) | VERIFIED |
| Email user who spoofs `user_metadata` to look like X | still rejected | VERIFIED |
| Attacker in the auto-confirm pre-registration case | the **first-draft** check passed (account has `email` + `x` identities); the **strict** check rejects it (3d) | VERIFIED |

The last row is why the check now requires the caller's **only** identity to be `x`. That strict version is tested in 3d.

The Supabase docs describe `getUser(jwt)` as a network request whose result "is authentic and can be used to base authorization rules on" ([reference](https://supabase.com/docs/reference/javascript/auth-getuser)). **Not verified:** which environment variable holds the server key in a Noah/hosted function. Supabase's docs now name `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` and `SUPABASE_JWKS`; the old `SUPABASE_SERVICE_ROLE_KEY` is not mentioned there. Since an anon-key client verifies fine, use whatever key the runtime provides. **Also not tested:** running the signing code inside Deno (the Edge runtime); I tested with Node and ethers v6.

### 3d. Strict check and provider hardening — VERIFIED (X mocked), two scenarios inconclusive

Harness: [spike/supabase/](spike/supabase/) (`run-hardening.sh` starts real GoTrue v2.197.0 + Postgres in Docker, mocks X, runs `test-hardening.cjs` in three server configurations, and removes only what it created; last output in `spike/supabase/run-hardening.last.log`). Strict check: `spike/supabase/edge-check.cjs` (rule: non-anonymous user with **exactly one** identity, and it is `x`). Script exit code 0; **all checks passed in all three configurations.**

**Permissive server** (email + auto-confirm, anonymous sign-in, manual linking all ON; X email optional):

| Check | Result |
|---|---|
| Plain X user | accepted, `xId=2244994945` |
| Tampered JWT | rejected (signature invalid) |
| Email-only user | rejected: `non-x identity: email` |
| Anonymous user | rejected: `anonymous user` |
| **Pre-registration takeover** (attacker signs up with the victim's X email, victim logs in with X, attacker logs in with the password) | attacker's account had `[email, x:555000111]`. **The first-draft check accepted it** (`xId=555000111`, the victim's). **The strict check rejects it:** `expected exactly 1 identity, found 2 (email,x)` |
| X account with no confirmed email | can sign in (with X email optional); accepted |
| X user adds an email via `updateUser` | **inconclusive:** the call returned no error but the email change stayed pending, so no second identity was created; identities stayed `[x]` and the user was accepted |
| X user links a second X account (manual linking ON) | **inconclusive:** the link attempt failed ("Error sending confirmation email"), so no second identity was created |

So the "more than one identity" rejection is demonstrated by the pre-registration case (email + x); I could not get GoTrue to create an `x` + `x` account. To cover the shapes the live harness cannot produce, `spike/supabase/test-edge-check.cjs` (no Docker, synthetic GoTrue-shaped users, **not** run against GoTrue) passes 22 cases through `edge-check.cjs`: accepts one `x` identity (including a 19-digit id), rejects no identity, email, phone, other-OAuth, x + email, x + phone, x + github, x + x (different and same id), anonymous, non-numeric/negative/over-long ids, and an id/sub mismatch, and ignores `user_metadata`.

**Hardened server** (email, phone, anonymous, manual linking all OFF): plain X user accepted; tampered JWT rejected; `Email signups are disabled`; `Email logins are disabled`; `Anonymous sign-ins are disabled`; `Phone signups are disabled`; an X user cannot gain an email identity (identities stay `[x]`); `Manual linking is disabled`. The phone provider itself was not exercised (no SMS provider): only that sign-up is refused when it is off.

**New finding: X accounts without a confirmed email.** With GoTrue's default configuration, an X account that returns no `confirmed_email` **cannot sign in**: `server_error: Error getting user email from external provider` (third configuration, passes as a documented limitation). Cause: `external.go` returns that error when the provider gave no email and the provider is not marked email-optional; the X provider's own tests cover both settings. Fix: `GOTRUE_EXTERNAL_X_EMAIL_OPTIONAL=true` (self-hosted); the hosted equivalent is UNVERIFIED. All the other checks above ran with it on.

## 4. DogeOS RPC, explorer, faucet — VERIFIED

Official docs: [developer quickstart](https://docs.dogeos.com/en/developers/developer-quickstart), [faucet](https://docs.dogeos.com/en/getting-started/user-guide/faucet). Live at 2026-10-30 14:53 UTC against `https://rpc.testnet.dogeos.com/`:

```
eth_chainId        HTTP 200  1.10s  0x5fdaf3  = 6281971
eth_blockNumber    HTTP 200  1.00s  0x89eca9  = 9,039,017
  (7 s later)
eth_blockNumber    HTTP 200  1.06s  0x89ecab  = 9,039,019   (+2 blocks: chain advancing)
eth_gasPrice       HTTP 200  0.83s  0xef426c  = 15,680,108 wei (~0.0157 gwei)
```

The e2e run (section 6) also read `chainId 6281971` from the same RPC (chain time 1793373810, about 15:25 UTC). Explorers: `https://dogeos-testnet.l2scan.co` (docs) and `https://blockscout.testnet.dogeos.com` (works, has an API). Faucet: `https://faucet.testnet.dogeos.com`, one claim per 24 h; your claim arrived as **42.069 DOGE**. More in [verified-testnet-baseline.md](verified-testnet-baseline.md).

## 5. TipEscrow and tests — VERIFIED

[src/TipEscrow.sol](src/TipEscrow.sol), [test/TipEscrow.t.sol](test/TipEscrow.t.sol). Solc 0.8.30, EVM `prague`, Foundry 1.8.3.

```
$ forge test            (Foundry 1.8.3, Solc 0.8.30, EVM prague; final source, clean build)
Ran 53 tests for TipEscrowTest ... 53 passed, 0 failed     (unit + 4 fuzz at 256 runs; 7 are new this revision, all for minTip)
Ran 1 test for TipEscrowInvariantTest: invariant_BalanceEqualsLiabilities, invariant_Conservation, invariant_NoTipBelowMin
  (runs: 256, calls: 128000, reverts: 0; the random sequences also rotate the verifier key and keep attempting tips of 1 wei to minTip - 1, which must all revert)
54 tests passed, 0 failed
```

Your required cases, by test name:

| Required | Test |
|---|---|
| Tip | `test_Tip`, `test_TipsAccumulatePerAccount`, `test_TipZeroReverts` |
| Valid claim, signs `(xId, recipient, nonce, expiry)` | `test_ValidClaim`, `testFuzz_ClaimAnyIdAndAmount`, `test_DigestMatchesIndependentEncoding` |
| Replay fails / expired / wrong signer | `test_ReplayedClaimFails`, `test_ExpiredClaimFails`, `test_WrongSignerFails` |
| Early refund fails | `test_RefundBeforeDelayFails` |
| Late refund works | `test_RefundAfterDelay`, `test_RefundOfTipMadeAfterClaimWorks` |
| Claim-after-refund fails | `test_ClaimAfterRefundFails` (reverts `NothingToClaim`); `test_ClaimAfterPartialRefundPaysOnlyRemainder` |
| Refund-after-claim fails | `test_RefundAfterClaimFails` (reverts `AlreadyClaimed`) |
| Only the tipper can refund | `test_RefundByNonTipperFails` |
| Non-owner rotation fails | `test_SetVerifierNonOwnerFails` (a stranger, the current verifier itself, and a recipient all get `NotOwner`) |
| Claims signed by the old key fail after rotation | `test_ClaimSignedByOldKeyFailsAfterRotation` (funds stay escrowed, nonce not burned), `testFuzz_RotationInvalidatesOldKey` |
| Claims signed by the new key work | `test_ClaimSignedByNewKeyWorksAfterRotation`, `testFuzz_RotationInvalidatesOldKey`, `test_RotateBackToOldKeyWorks` |
| Minimum tip: below it reverts | `test_TipBelowMinReverts` (min − 1 wei; nothing recorded), `testFuzz_MinTipBoundary` (any min and amount) |
| Minimum tip: exactly the minimum works | `test_TipExactlyMinWorks`, `testFuzz_MinTipBoundary` |
| Minimum tip: edge cases | `test_ZeroTipRevertsAsZeroValueEvenWithMin`, `test_MinTipZeroAllowsOneWei` (no minimum), `test_MinTipDoesNotAffectClaimOrRefund`, `test_HackathonParameters` (600 s and 5 DOGE: 4.999… reverts, 5 works, refundable after exactly 600 s) |
| Rotation event and edge cases | `test_SetVerifierByOwner` (emits `VerifierUpdated`), `test_SetVerifierZeroAddressReverts`, `test_RotationKeepsNoncesTipsAndRefunds`, `test_ConstructorZeroAddressesRevert`, `test_RefundDelayIsConstructorParam` (600 s and 7 days) |

Also covered: a signature for one X id can't claim another (`test_SignatureForOneIdCannotClaimAnother`), a signature for another contract or chain fails, malleable high-s signatures fail, claims to a rejecting contract roll back, and attacker contracts re-entering `claim` and `refund` can't double-spend.

How the contract handles refunds: each tip is stored with its own id. A claim pays every pending tip for that X id and records a watermark (`sweptBefore`), so claim gas does not grow with tip count and a refund of an already-claimed tip is impossible. Refunded tips leave the claimable balance.

**Test quality check:** I broke the contract on purpose five times in total, and the tests caught every one. For `minTip` (re-run on the final suite, source restored to the same sha256 `d9ca08cc…73e6` afterwards): removing the check made 4 tests fail (the fuzz boundary test, `test_HackathonParameters`, `test_TipBelowMinReverts`, and `invariant_NoTipBelowMin`); changing `<` to `<=` made 5 unit/fuzz tests fail (the exact-minimum cases; the invariant correctly stays green, since exactly-minimum is a valid tip); comparing against `minTip - 1` made 5 fail (3 unit/fuzz, the invariant, and an underflow panic in the zero-minimum test). Before the invariant was added, the invariant suite could not have caught the first mutant: its handler only ever tipped at least `minTip`. For rotation: Removing the owner check made `test_SetVerifierNonOwnerFails` fail; making `setVerifier` emit the event but not store the key made 4 rotation tests fail. The original file was restored (same hash) and the tests pass again.

**Still true (spike limits):** one verifier key at a time (a leak means every escrowed tip can be claimed by whoever holds it, until the owner rotates it); the owner key is also high-value and cannot be transferred; claim pays the whole balance; the contract cannot tell a real X id from a made-up one, so the tip page must resolve handles correctly (docs/resolve-plan.md). `forge build` prints lint notes about `block.timestamp` comparisons, the `uint64` timestamp cast and the payout to a signed recipient; all are intentional.

## 6. Live e2e on Chikyū — VERIFIED for the final contract (6a) and for the previous revision (6b)

### 6a. Final contract — LIVE-VERIFIED, 2026-10-31 (~13:15 UTC)

**Real deployment:** [`0x207652b0767F9f19d24B5300E2123D415167aCeF`](https://blockscout.testnet.dogeos.com/address/0x207652b0767F9f19d24B5300E2123D415167aCeF), chain 6281971, deployed by `scripts/deploy.cjs` (record in `deployment.json`).

| Read-back from the chain (`eth_call`) | Value | Matches `.env` |
|---|---|---|
| `owner()` | `0x1BE5DB49a70d633c6e6AF7900598118Fb65419AE` (the deployer) | yes |
| `verifier()` | `0xB63301AF6f319f1B2B93D637B730AE9604D45b86` (`VERIFIER_ADDRESS`, the **test** verifier whose key is in `.env`) | yes |
| `refundDelay()` | 600 s | yes (`REFUND_DELAY_SECONDS=600`) |
| `minTip()` | 5.0 DOGE (5000000000000000000 wei) | yes (`MIN_TIP_WEI`) |
| `tipCount()`, balance | 0, 0 DOGE | untouched since deploy |

Deploy tx [`0x8a0dc51f…af23`](https://blockscout.testnet.dogeos.com/tx/0x8a0dc51f03ad67c2c945a83210d2605921e2b15d4d2ce69f5d553233d2d5af23), block 9065839, `status=ok`. Runtime code is 7,731 bytes.

**The flow ran on a throwaway copy, not on the real contract.** `tipescrow-e2e.cjs live` deploys its own instance with `refundDelay = 45 s` and `minTip = 0.01 DOGE` (so a test costs cents, not 5 DOGE per tip), at [`0xC48AAb30478bF9427428F62f04853b25Ca703986`](https://blockscout.testnet.dogeos.com/address/0xC48AAb30478bF9427428F62f04853b25Ca703986). Its runtime code and the real contract's are the same length and differ in **18 bytes, all inside the artifact's immutable slots** (`owner`, `refundDelay`, `minTip`); there is no other difference. The 5 DOGE minimum and 600 s delay of the real instance are therefore covered by the read-back above, `test_HackathonParameters`, and the local deploy, not by a live 5 DOGE tip.

All nine transactions were read back from the Blockscout API: `status=ok`, `result=success`.

| Step | Tx hash | Block | Gas used | Total fee (DOGE) |
|---|---|---|---|---|
| **Real deploy** | [`0x8a0dc51f03ad67c2c945a83210d2605921e2b15d4d2ce69f5d553233d2d5af23`](https://blockscout.testnet.dogeos.com/tx/0x8a0dc51f03ad67c2c945a83210d2605921e2b15d4d2ce69f5d553233d2d5af23) | 9065839 | 1,749,129 | 0.7682 |
| e2e deploy (throwaway) | [`0xcd7b167307150e391bec4b2067abeb8d759e4da76e722200a769e4ceb5c9182d`](https://blockscout.testnet.dogeos.com/tx/0xcd7b167307150e391bec4b2067abeb8d759e4da76e722200a769e4ceb5c9182d) | 9065845 | 1,749,105 | 0.7636 |
| Tip A (X id 2244994945, 0.01 DOGE = exactly the throwaway minimum) | [`0x62cab35312b3e66a8cf99a00fc5b1a45e88d48bf492490164957c60d08849899`](https://blockscout.testnet.dogeos.com/tx/0x62cab35312b3e66a8cf99a00fc5b1a45e88d48bf492490164957c60d08849899) | 9065848 | 136,466 | 0.0219 |
| Claim A (verifier-signed) | [`0xa0c9003fea4f70bc928ede08718e69d7e5950fb7dcdd0db7d927d74e6629d08a`](https://blockscout.testnet.dogeos.com/tx/0xa0c9003fea4f70bc928ede08718e69d7e5950fb7dcdd0db7d927d74e6629d08a) | 9065851 | 118,752 | 0.0351 |
| Tip B (X id 1850123456789012345, above 2^53) | [`0x1d681b4317d26576db25766c7ef2237251d180535fea4085dc43c1063ed05a77`](https://blockscout.testnet.dogeos.com/tx/0x1d681b4317d26576db25766c7ef2237251d180535fea4085dc43c1063ed05a77) | 9065853 | 119,366 | 0.0219 |
| Refund B (after the 45 s delay) | [`0xe011ef556d8556a0b9bd5ea1349771af0f64cf9b72806f8a229cee00df177ff8`](https://blockscout.testnet.dogeos.com/tx/0xe011ef556d8556a0b9bd5ea1349771af0f64cf9b72806f8a229cee00df177ff8) | 9065871 | 44,461 | 0.0188 |
| Tip C (X id 2244994945 again) | [`0x87dff1dbd89fe4d2bedf84795d7fdafe1fbf7832060acba91e01eaaf617dfb83`](https://blockscout.testnet.dogeos.com/tx/0x87dff1dbd89fe4d2bedf84795d7fdafe1fbf7832060acba91e01eaaf617dfb83) | 9065874 | 119,366 | 0.0227 |
| **`setVerifier`** (owner rotates the key) | [`0xbb41d012cda7bec8889c50c7b6698aabe80e113c76a4fb39758aa89d3fc3a91e`](https://blockscout.testnet.dogeos.com/tx/0xbb41d012cda7bec8889c50c7b6698aabe80e113c76a4fb39758aa89d3fc3a91e) | 9065877 | 28,762 | **0.0215** |
| Claim C (signed by the new key) | [`0x06fda845730bdc4246e004be5c31a4bcb5500dc7dfe4d6b1fe897bbc32624d34`](https://blockscout.testnet.dogeos.com/tx/0x06fda845730bdc4246e004be5c31a4bcb5500dc7dfe4d6b1fe897bbc32624d34) | 9065879 | 76,652 | 0.0365 |

Results checked (the reverts are simulated `eth_call`s, not mined transactions):

- **Minimum tip:** a tip of `minTip − 1` wei reverted `BelowMinTip`; a tip of exactly `minTip` (Tip A) succeeded.
- **Claims:** claim A paid the recipient exactly 0.01 DOGE; claim C paid another 0.01 (recipient balance 0.02). Replay of claim A → `NonceUsed`.
- **Refund:** early refund → `TooEarly`; after the delay refund B succeeded and `tipStatus` = 3 (Refunded); claim of the refunded tip → `NothingToClaim`; refund of the claimed tip A → `AlreadyClaimed`.
- **Rotation:** non-owner `setVerifier` → `NotOwner`; owner `setVerifier` succeeded (`VerifierUpdated`); a claim signed by the old key → `BadSignature`; a claim signed by the new key paid out.
- **Events** decoded from receipts: `Tipped` ×3, `Claimed` ×2 (the numeric `xId` 2244994945 in each), `Refunded` ×1.
- **Fees:** fee = `l1Fee` + gasUsed × effectiveGasPrice. The nine fees sum to **1.710134 DOGE**; with the 0.02 DOGE paid to the claim recipient that equals the deployer's balance change to the wei (34.202386 → 32.472252). Table, oracle ratios and the `setVerifier` fee: [FEES.md](FEES.md) section 2b. The claim recipient and the rotation's new verifier are fresh random wallets the script does not save, so the 0.02 DOGE paid to the recipient is unrecoverable (as on the previous run).
- **Not done:** source verification of the contracts on the explorer; a live tip of 5 DOGE; a tip to an account that already holds a balance.

### 6b. Previous revision — 2026-10-30

> **The contract below (`0x43eAa76d…`) is the revision before owner/`setVerifier` were added.** Its transactions are real and confirmed, but they say nothing about the new code. Hashes are also kept in `e2e-result.testnet-v1.json`.
>
> **For the final revision I ran everything that does not need testnet DOGE:**
> - Full e2e (`live` mode) on a local chain started with Chikyū's chain ID (6281971) and 1 s blocks: deploy, tip, claim, replay, tip, early refund, 45 s wait, refund, claim-after-refund, refund-after-claim, then **rotation**: non-owner `setVerifier` → `NotOwner`; owner rotates; old-key claim → `BadSignature`; new-key claim pays the recipient. All steps behaved as expected. (A local chain does not charge `l1Fee` or run DogeOS's EVM, so this proves the scripts and contract logic, not DogeOS behaviour.)
> - `scripts/deploy.cjs` on the same local chain: chain-ID guard passed, 600 s taken from `.env`, owner/verifier/delay read back and matched.
> - Read-only `simulate` against the **real Chikyū RPC**: the digest from ethers equals the contract's digest, a valid signature is accepted, a wrong signer gets `BadSignature`. (This first failed with `BadSignature` because the simulation had not seeded the verifier, which is now storage slot 5 instead of an immutable. It was a gap in the script, not the contract; fixed.)
> - Nothing was sent to the real testnet: the deployer is still at 34.2024 DOGE, nonce 5.

Command: `node scripts/tipescrow-e2e.cjs live https://rpc.testnet.dogeos.com/` (script: [scripts/tipescrow-e2e.cjs](scripts/tipescrow-e2e.cjs); output saved in `e2e-result.json`). Throwaway contract with `refundDelay = 45 s`. Claims are signed off-chain by ethers v6 with the test verifier key.

Contract: [`0x43eAa76d4Fa596fe077FEB85C451A30675DBfA5a`](https://blockscout.testnet.dogeos.com/address/0x43eAa76d4Fa596fe077FEB85C451A30675DBfA5a). I read every transaction back from the Blockscout API: all show `status=ok, result=success`.

| Step | Tx hash | Block | Gas used | Total fee (DOGE) |
|---|---|---|---|---|
| Deploy | [`0xe08ae3e7…4969`](https://blockscout.testnet.dogeos.com/tx/0xe08ae3e7c7a904e34c978f8faaf72b464513499787a61497f032ac96cc7e4969) | 9039602 | 1,554,309 | **6.8289** |
| Tip A (X id 2244994945, 0.01 DOGE) | [`0x2ad88147…b893`](https://blockscout.testnet.dogeos.com/tx/0x2ad88147f0ebba3eeb29948156ec62dfde37ef2effe17bd167259f125030b893) | 9039604 | 136,441 | **0.2181** |
| Claim A (signed by verifier) | [`0x6c10b02d…e204`](https://blockscout.testnet.dogeos.com/tx/0x6c10b02d9668ff20242e3f9dacb7634581b2e4b88b9d5059642a3450c512e204) | 9039607 | 116,625 | **0.3504** |
| Tip B (X id 1850123456789012345, 0.01 DOGE) | [`0xf6b6189b…2747`](https://blockscout.testnet.dogeos.com/tx/0xf6b6189b02f3e31b57347f14acc79a5c20145b396db93a07e215ccdcd3402747) | 9039610 | 119,341 | **0.2181** |
| Refund B (after the 45 s delay) | [`0x599c27f2…2947`](https://blockscout.testnet.dogeos.com/tx/0x599c27f294a6d8cbb262550bce59e9b9a45e4aa193cacb2ca9a2ae1573842947) | 9039628 | 44,439 | **0.2410** |

Results checked:

- **Claim A:** recipient `0x04c39c8f…d6ca` received exactly **0.01 DOGE** (checked with `eth_getBalance`). The contract's balance ended at **0**.
- **Events** (decoded from receipts): `Tipped(1, idHash, tipper, 0.01)`, `Claimed(idHash, recipient, 0.01, nonce 1, xId 2244994945)`, `Tipped(2, …, 0.01)`, `Refunded(2, …, 0.01)`. The `Claimed` event carries the numeric `xId`, which is what a feed would show for a claim.
- **Refund B:** `tipStatus` = 3 (Refunded) afterwards.
- **Negative checks**, run as read-only simulated calls (`eth_call`, not mined reverts): replaying claim A → `NonceUsed`; refund before the delay → `TooEarly`; claim of the refunded tip → `NothingToClaim`; refund of the claimed tip → `AlreadyClaimed`.
- Large id check: `1850123456789012345` (above 2^53) worked unchanged through hashing, signing and `Tipped`/`Refunded`.
- **Not done:** source verification of the contract on the explorer (events show as "undecoded" there), and a real deployment with the production `refundDelay`.

### Fees

Fee = **`l1Fee` + gasUsed × gasPrice**, confirmed to the wei for all five transactions against on-chain balance changes. `l1Fee` is almost everything: deploy 6.83, tip 0.218, claim 0.350, refund 0.241 DOGE (execution part at most 0.00003). The run spent **7.87 DOGE** in total (42.069 → 34.202), of which 0.01 went to the claim recipient.

Full analysis, UI rules and open questions are in **[FEES.md](FEES.md)**. The findings that matter:

- **Fees are volatile:** over 3.3 hours the oracle's quote for a fixed tip transaction ranged 0.038 to 0.278 DOGE (7.4×). Largest rise between readings 30 s apart: +33.6%.
- **The oracle is usable:** `getL1Fee(signed RLP tx)` at `0x5300…0002` (what DogeOS's docs recommend) matched the tip's charge exactly, and quoted *more* than was charged for the claim (1.70×), refund (1.15×) and deploy (2.76×). Four samples, so "upper bound" is a hypothesis; the final run records quote vs charge for every transaction.
- **A quote can be made before signing:** a copy signed with a throwaway key quotes within 0.3% of the real signed transaction.
- `eth_estimateGas` and wallet gas displays do not include `l1Fee` (how MetaMask/MyDoge show it is UNVERIFIED).
- **Open decision:** a brand-new recipient wallet has no DOGE to pay the claim fee. A relayer can submit the claim with no contract change (FEES.md section 4).

## 7. MyDoge and dapps

Sources: [DogeOS SDK docs](https://docs.dogeos.com/en/sdk), [Embedded wallets](https://docs.dogeos.com/en/sdk/embedded-wallets), [npm: @dogeos/dogeos-sdk](https://www.npmjs.com/package/@dogeos/dogeos-sdk) (latest 4.0.5).

- Inside MyDoge's dApp browser the SDK **selects the injected MyDoge wallet first** and skips the embedded wallet; the docs give a ready Chikyū chain object under `chains.evm`. VERIFIED (docs).
- Outside MyDoge: email/social login (embedded wallet), other injected wallets, and WalletConnect (needs your own `walletConnectProjectId`). Every app needs a `clientId` from the DogeOS developer console. VERIFIED (docs).
- This design only needs the user's wallet to send `tip` and `claim` transactions. The server signs the claim, so no typed-data signing by the wallet is needed.
- Not done: no hands-on test inside MyDoge; no phone test.

---

## What is not verified yet

- **Done, no longer open:** the live run of the final contract (section 6a). Cost 1.730 DOGE in total (1.710 in fees, 0.02 to the claim recipient); the deployer has 32.472 DOGE left. The `setVerifier` fee is measured (0.0215 DOGE, FEES.md section 2b).
- **The deployed contract's verifier is the test key from `.env`** (`VERIFIER_ADDRESS`), whose private key sits in a local file. Before real use, the owner should call `setVerifier` with the address of the production key held as a Supabase secret (about 0.02 DOGE at current prices).
- The real contract itself has had no tips or claims: its flow was exercised on an identical-code throwaway copy with a 45 s delay and 0.01 DOGE minimum (section 6a). A live 5 DOGE tip into the real instance has not been made.
- Everything under "Open items" in [docs/resolve-plan.md](docs/resolve-plan.md): a real X lookup, its billing, and the not-found response.
- Whether the hosted Supabase dashboard has an "allow users without an email" toggle for X; a real X login at all.
- Source verification of deployed contracts on the explorer; MyDoge hands-on; a phone test.

## Risks and fallbacks

| Risk | Impact | Fallback |
|---|---|---|
| `l1Fee` hidden by wallets, and it swings several-fold | Users see a tiny fee, then pay 0.04 to 0.8 DOGE; low-balance wallets fail | Quote live from the oracle with a dummy-signed copy, refresh before sending, keep a ×1.5 balance buffer, fixed ceilings as a fallback (FEES.md) |
| New recipients have no DOGE to pay the claim fee | They cannot claim | Relayer submits the claim and pays (no contract change); decision needed |
| X accounts with no confirmed email cannot sign in (3d) | Those recipients cannot claim | Enable the X provider's "allow users without an email" setting (hosted toggle UNVERIFIED) |
| X login needs paid credits (3a, item 3) | Login fails at zero balance | Buy a few dollars of credit (first purchase earns $20). Or accept another provider and have users prove their X account some other way (more work). |
| Noah can't deploy to Chikyū or wire X login (item 1) | Noah's generated code fails | Deploy with Foundry; set up the X provider in Supabase yourself; ask Noah only for the UI. Test early. |
| Email auto-confirm / extra providers enabled | Pre-registration account takeover (3b, 3d) | Disable email/phone/anonymous providers **and** keep the strict identity check (both tested) |
| Verifier or owner key theft | Whoever holds the verifier key can claim every escrowed tip; the owner key can swap the verifier | Owner rotates the verifier with `setVerifier` (tested); keep both keys out of the repo; note it in the submission |
| Feed shows hashes for tips | A global Feed can't show who was tipped | Decided: `x_handles(x_id, handle, resolved_at)` written only by `resolve`; the Feed hashes ids in the browser (docs/resolve-plan.md) |

## Files (nothing committed in this pass)

- **Final deployment pass (2026-10-31):** `deployment.json` and `e2e-result.json` (new; hashes, addresses and amounts only, no keys), `FEES.md` (section 2b and updates), this file.
- **Earlier pass:** `spike/supabase/test-edge-check.cjs` (new), `scripts/deploy.cjs` and `scripts/fee-check.cjs` (now read `MIN_TIP_WEI`), `test/TipEscrow.t.sol` (`invariant_NoTipBelowMin`).
- **Older notes below describe earlier passes.**

- **Changed this turn:** `src/TipEscrow.sol` (minTip), `test/TipEscrow.t.sol`, `scripts/deploy.cjs`, `scripts/tipescrow-e2e.cjs` (min-tip check, fee report), `README.md`, `docs/resolve-plan.md`, `.env` (adds `MIN_TIP_WEI=5000000000000000000`), `.gitignore`
- **Deleted (last turn):** `src/Probe.sol`, `scripts/deploy-and-verify.sh`
- **New this turn:** `FEES.md`, `scripts/fee-check.cjs`, `spike/supabase/{edge-check,make-keys,test-hardening}.cjs`, `spike/supabase/run-hardening.sh`
- **New last turn:** `README.md`, `docs/resolve-plan.md`, `e2e-result.testnet-v1.json` (hashes of the earlier real run; the e2e script writes a fresh `e2e-result.json` next time)
- **New (earlier):** `spike/supabase/` mock X, SMTP sink, `test.cjs`, `test6.cjs` (these two use the first-draft lax check on purpose, as the evidence for 3b/3c), README
- **Earlier, still present:** `verified-testnet-baseline.md`, `hackathon.md`, `dogeos_ecosystem.md`; `.env` holds the throwaway keys (gitignored)
- **Gitignored / generated:** `lib/`, `out/`, `cache/`, `node_modules/`
- **Outside the project:** Foundry binaries and docs downloads in my scratch folder. Docker Desktop is **still running**: I started it. Images `supabase/gotrue:v2.197.0` and `supabase/postgres:15.19.0.002` stay cached; my containers and network are removed. Your own containers (`datahub-*`, `trench-dispatcher`) were not touched.
