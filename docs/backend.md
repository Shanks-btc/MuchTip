# Backend: Supabase Edge Functions and Postgres

Three Edge Functions and four tables turn the TipEscrow contract into something a web app can use. Nothing here holds funds:
money only ever moves inside the contract. The backend does three jobs the chain cannot do for a browser:

| Function | Job | Who calls it |
|---|---|---|
| [`resolve`](#resolve) | X handle → the numeric X id the contract is keyed by (cached 1 h) | the Tip page |
| [`sign-claim`](#sign-claim) | proves "this person is X account N" to the contract by signing an EIP-712 claim | the Claim page, signed in with X |
| [`feed`](#feed) | recent events with handles, plus the landing-page totals, read from the contract's own events | the landing page, a live table |

Contract: `0x207652b0767F9f19d24B5300E2123D415167aCeF` on DogeOS Chikyū (chain 6281971). `refundDelay()` and `minTip()` are
**read from the chain** (the `feed` response carries them); nothing in the backend hard-codes 600 s or 5 DOGE.

```
browser ── resolve(handle) ───────────▶ X API ─┐ (cached in x_handles)
   │                                           ▼
   ├─ tip(idHash) ───────────────────▶ TipEscrow ◀── eth_getLogs ── feed ── chain_events ── x_handles
   │                                      ▲
   └─ sign in with X ─▶ Supabase Auth     │ claim(xId, recipient, nonce, expiry, signature)
          │                               │
          └─ sign-claim(recipient) ─ getUser(jwt) ─ gate: exactly one 'x' identity ─ EIP-712 sign ─┘
```

## Endpoints

Base URL: `https://<project-ref>.supabase.co/functions/v1/<name>` (locally whatever the function is served on). All three send
CORS headers (`CORS_ALLOW_ORIGIN`, default `*`), answer `OPTIONS` with 204, and return JSON. **Every uint256 and every amount
is a decimal string** (X ids and wei exceed 2^53); parse them with `BigInt`, never `Number`.

Errors always look like this, with an HTTP status that matches:

```json
{ "error": { "code": "handle_not_found", "message": "No X account with the handle @nobody" } }
```

### resolve

`GET /resolve?handle=@XDevelopers[&fresh=1]` or `POST /resolve` with `{"handle": "@XDevelopers", "fresh": true}`. No auth.

The handle is trimmed, one leading `@` is dropped, and it must be 1 to 15 of `A-Za-z0-9_` (a pasted profile URL is rejected).
Matching is **exact and case-insensitive** (`lower(handle)` equality, never a pattern: `Doge_Fan_42` cannot match `DogeXFanY42`).

There are two modes, and they are for different jobs:

| Mode | Use it for | Behaviour |
|---|---|---|
| default | display: the feed, profile pages, autocomplete | a cached row younger than 1 h is returned without calling X; otherwise X is asked and the answer cached |
| **`fresh`** | **the tip flow, right before the user confirms** | **always asks X, never answers from the cache**; the answer refreshes the cache |

**Why the tip flow must use `fresh`:** X handles can be renamed and then taken by someone else. A cached answer can be up to an hour
old, so a tip sent from it could go to the handle's *previous* owner. `fresh` closes that window: the id comes from X at the moment the
user confirms, and the UI shows it as "You're tipping **<name>** (@handle, ID …)" so the person can check it. Only `fresh: true`, `"true"` or
`"1"` (`&fresh=1` / `&fresh=true` in a GET) turns it on. Each fresh call is a paid X API read, so it has its own per-IP limit (`RESOLVE_FRESH_PER_MINUTE`, 10) on top of
the normal one and counts against the shared X budget.

```json
{
  "xId": "2244994945",
  "handle": "XDevelopers",
  "name": "X Developers",
  "idHash": "0x9459c13b5c21e1f0cc54307300f50fe36658555fa2b2355575aa4d05c6f21914",
  "resolvedAt": "2026-10-31T16:20:11.000Z",
  "source": "x"
}
```

`idHash` is exactly `TipEscrow.idHash(xId)`: pass it to `tip(bytes32)`. `handle` has X's canonical casing. `name` is X's display name,
**sanitised** (control characters, zero-width characters and bidirectional overrides removed, so a name cannot make the confirmation read
differently from what is stored; whitespace collapsed; at most 50 characters) or `null` if X gave none. It is untrusted text: render it as
text, never as HTML. `source` is `"cache"`, `"x"` or `"mock"` (see [mock mode](#mock-mode)); a fresh answer is never `"cache"`.

When X has reassigned a handle, storing the new owner takes the handle away from the old owner's row in the same transaction
(`upsert_x_handle`): the old row keeps its id and name but its `handle` becomes `null`, and the feed shows that account without a handle.

| Status | `error.code` | Meaning |
|---|---|---|
| 400 | `invalid_handle`, `invalid_json` | bad input |
| 404 | `handle_not_found` | X has no such account (or it is suspended). Nothing is cached |
| 413 | `body_too_large` | |
| 429 | `rate_limited` | per-IP limit, or the per-IP fresh limit (`Retry-After` set) |
| 429 | `upstream_rate_limited` | X is rate limiting us (`Retry-After: 60`) |
| 502 | `upstream_unavailable` | X unreachable, refused our token, or returned something unexpected. Details are logged, never returned |
| 503 | `rate_limit_unavailable` | the limiter's database call failed; the function fails closed |

### sign-claim

`POST /sign-claim` with `Authorization: Bearer <the user's Supabase session access_token>` and `{"recipient": "0x…"}`.

What it does, in this order: checks the bearer token is present; counts the call against the IP limit; validates `recipient` (a
`0x` address, correct EIP-55 checksum if mixed case, not the zero address, not the escrow contract); asks Supabase Auth
`auth.getUser(jwt)` with the service key (signature, expiry, user still exists); applies the **claim gate**; counts the call
against the per-X-account limit; reads the chain; signs.

**The claim gate.** The caller must be a non-anonymous user with **exactly one identity, and that identity's provider is `x`**.
The X id is `identities[0].id`, a numeric string that must equal the identity's own `sub`. It is **never** read from
`user_metadata` or `app_metadata`, which users can edit. Why exactly one: an account that also holds an email, phone or
second identity can hold an X identity that belongs to someone else (pre-registration takeover; `verified.md` section 3d).
This is the TypeScript port of `spike/supabase/edge-check.cjs`.

**The chain read** (one JSON-RPC batch): `eth_chainId` (must equal `CHAIN_ID`), the latest block, `balanceOf(idHash)` and
`verifier()`. If `verifier()` is not the address of `VERIFIER_PRIVATE_KEY` the function refuses (a signature the contract
rejects would only fail after the user paid a network fee).

**The signature** is EIP-712 `Claim(uint256 xId, address recipient, uint256 nonce, uint256 expiry)` with domain
`{ name: "TipEscrow", version: "1", chainId: 6281971, verifyingContract: <escrow> }`, over a random 256-bit `nonce` and
`expiry = latest block timestamp + CLAIM_TTL_SECONDS` (default 300). Before returning it, the function checks the signature is
65 bytes, low-s (the contract rejects high-s) and recovers to the verifier address.

```json
{
  "xId": "2244994945",
  "handle": "DogeFan_42",
  "recipient": "0x5E5E…",
  "nonce": "8812…",
  "expiry": "1793456123",
  "signature": "0x…65 bytes",
  "digest": "0x…",
  "contract": "0x207652b0767F9f19d24B5300E2123D415167aCeF",
  "chainId": 6281971,
  "unclaimedWei": "10000000000000000",
  "claimable": true
}
```

`handle` comes from the identity data and is for display only. The client submits the transaction, from any wallet, to
`claim(xId, recipient, nonce, expiry, signature)`; the contract pays `recipient` every pending tip for that X account. If
`unclaimedWei` is `"0"` a signature is still returned (it is harmless: the claim would revert `NothingToClaim`), and
`claimable` is `false` so the UI can say so.

```js
const r = await fetch(`${FUNCTIONS_URL}/sign-claim`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
  body: JSON.stringify({ recipient: walletAddress }),
}).then((x) => x.json());
if (r.error) throw new Error(r.error.message);
await escrow.claim(BigInt(r.xId), r.recipient, BigInt(r.nonce), BigInt(r.expiry), r.signature);
```

| Status | `error.code` | Meaning |
|---|---|---|
| 400 | `invalid_recipient`, `invalid_json` | bad input |
| 401 | `missing_token` | no `Authorization: Bearer …` header |
| 401 | `invalid_token` | forged, expired, malformed or revoked session: sign in with X again |
| 403 | `identity_not_allowed` | not exactly one `x` identity (email, phone, anonymous, x + email, …). The message names the reason |
| 429 | `rate_limited` | per-IP (60 / 10 min) or per-X-account (10 / 10 min) |
| 503 | `chain_unavailable`, `wrong_chain` | RPC down, or pointed at a different chain |
| 503 | `verifier_mismatch` | our key is not the contract's `verifier()` (misconfiguration; logged for the operator) |
| 503 | `rate_limit_unavailable` | fails closed |

### feed

`GET /feed?limit=25&type=Tipped`. No auth. `limit` 1 to 100 (default 25); `type` optional: `Tipped`, `Claimed` or `Refunded`.
Cacheable for 3 s (`Cache-Control: public, max-age=3`).

```json
{
  "contract": "0x2076…ACeF",
  "chainId": 6281971,
  "config": { "refundDelaySeconds": 600, "minTipWei": "5000000000000000000" },
  "sync": { "headBlock": 9066800, "indexedToBlock": 9066799, "lagBlocks": 1, "complete": true },
  "totals": {
    "tipsCount": 3,
    "totalTippedWei": "30000000000000000",
    "uniqueHandles": 2,
    "unclaimedWei": "0",
    "claimedWei": "20000000000000000",
    "refundedWei": "10000000000000000",
    "claimsCount": 2,
    "refundsCount": 1
  },
  "onChain": { "balanceWei": "0", "matchesTotals": true },
  "events": [
    { "type": "Tipped", "blockNumber": 9065874, "logIndex": 0, "txHash": "0x…", "time": "2026-10-31T13:20:02.000Z",
      "idHash": "0x…", "handle": "XDevelopers", "xId": "2244994945", "amountWei": "10000000000000000", "tipId": "3", "from": "0x…" },
    { "type": "Claimed", "…": "…", "recipient": "0x…" },
    { "type": "Refunded", "…": "…", "tipId": "2", "tipper": "0x…" }
  ]
}
```

- **Totals are computed from the contract's events**, stored in `chain_events`: `tipsCount` = Tipped events; `totalTippedWei` =
  their sum; `uniqueHandles` = distinct X accounts (by `idHash`) that have been tipped; `unclaimedWei` = Tipped − Claimed −
  Refunded, i.e. what the contract still owes.
- **`onChain`** is an integrity check: the contract's native balance **at the indexed block** against `unclaimedWei`. They are equal
  by the contract's own invariant; `matchesTotals: false` means the index is wrong (and is logged). It is `null` if the RPC is down.
- **`handle` / `xId` are `null`** for accounts nobody has run through `resolve` (a tip made by calling the contract directly).
  `Claimed` events always carry `xId`.
- **`complete`** is true when the index is within 15 blocks of the chain head. If the RPC is down the feed still answers from what
  is stored, with `headBlock: null`, `complete: false`.
- **`config`** is `refundDelay()` / `minTip()` from the chain, cached 60 s (`null` if never readable).

Each request first syncs new blocks into the database (see [the indexer](#the-indexer)). Errors: 400 `invalid_limit` /
`invalid_type`, 429 `rate_limited` (120 / min per IP), 503 `rate_limit_unavailable`.

## Database

Migrations in `supabase/migrations/` (apply with `supabase db push`). Everything is in the `public` schema.

| Table | Purpose | Access |
|---|---|---|
| `x_handles(x_id text PK, handle, name, id_hash, resolved_at, handle_lc)` | handle cache; written only by `resolve` | public read; **service role writes** |
| `rate_limits(bucket, window_start, hits)` | fixed-window counters | service role only |
| `chain_events(contract, block_number, log_index, …, amount_wei numeric(78,0), …)` | copy of Tipped / Claimed / Refunded | public read; service role writes |
| `indexer_state(contract PK, last_block, updated_at, lease_owner, lease_until)` | how far the feed has indexed, and who is indexing | service role only |
| `app_config(key PK, value)` | deployment settings for database jobs (`functions_url`) | service role only |
| function `upsert_x_handle(x_id, handle, name, id_hash, resolved_at)` | store an account; take the handle from its previous owner | service role only |
| function `rate_limit_hit(bucket, window_s, limit) → boolean` | atomic counter | service role only |
| function `feed_totals(contract, to_block) → jsonb` | totals as strings | service role only |
| functions `indexer_acquire`, `indexer_apply`, `indexer_release` | single-writer indexing (below) | service role only |
| function `trigger_feed_sync()` + pg_cron job `muchtip-feed-sync` | the minute-by-minute sync (below) | service role / cron |

Notes that matter:

- **`x_id` is `text`, not a number.** PostgREST returns bigint as a JSON number, which JavaScript rounds above 2^53; X ids reach
  1.8e18. Amounts are `numeric(78,0)` and leave the database only as text (`amount_wei::text`, or inside `feed_totals`).
- **One account per handle.** `handle_lc` is a generated column `lower(handle)` with a **unique index**; the cache lookup is exact
  equality on it. (PostgREST cannot filter on an expression, so the expression is stored; the index is in effect a unique index on
  `lower(handle)`.) `handle` is nullable: `NULL` means the handle was reassigned to another account.
- **RLS is on for every table.** On Supabase, new tables and functions in `public` are granted to `anon` and `authenticated` by
  default; the migrations revoke that explicitly and grant back only `SELECT` on the two public tables. The integration tests check
  that `anon` and signed-in users cannot insert, update or delete, cannot read the service-only tables, and cannot call any of the
  service-only functions.
- `x_handles.id_hash` is unique, so the feed joins events to handles on it.

### The indexer

DogeOS's RPC refuses `eth_getLogs` over more than 10,000 blocks (about 7.5 hours), so the feed cannot rescan from the deploy block on
every request; it keeps a copy of the events in `chain_events` and remembers how far it got in `indexer_state.last_block`.

**What advances `indexer_state`.** Only `indexer_apply()`, and only the `feed` function calls it. The feed runs in two ways:

1. **On demand:** every `GET /feed` first catches up, then answers. Unless the last progress was within `FEED_MIN_SYNC_SECONDS` (5),
   it fetches logs from `last_block + 1` in chunks of `FEED_LOG_CHUNK_BLOCKS` (9,000), at most `FEED_MAX_BLOCKS_PER_SYNC` (100,000)
   blocks per request.
2. **Every minute:** the pg_cron job `muchtip-feed-sync` runs `trigger_feed_sync()`, which calls `GET <functions_url>/feed?limit=1`
   through pg_net. So the index stays current even when nobody is looking, and the first visitor after a quiet hour gets a
   `complete: true` answer.

(Before this change only the first of those existed, without the lease: two simultaneous requests could both fetch the same blocks and
write the same rows. The writes were idempotent upserts, so nothing was ever counted twice, but work was repeated and the saved progress
could briefly move backwards.)

**No double indexing.** The feed fetches over HTTP from the chain, which cannot happen inside one database transaction, and PostgREST
gives every call its own connection, so a session-level `pg_advisory_lock` would not survive between calls. Two mechanisms work together:

- **A lease** (`indexer_acquire` / `indexer_release`, `FEED_LEASE_SECONDS`, 30). The worker holding an unexpired lease is the only one
  fetching. A request that finds the lease taken does not wait or fetch: it answers from what is stored (consistent at its own block).
  A crashed worker's lease expires on its own; every stored chunk renews it.
- **An atomic, compare-and-set apply** (`indexer_apply`). Each chunk's events and the new `last_block` are stored in **one transaction**,
  under a transaction-level `pg_advisory_xact_lock` for the contract, and only if the caller still owns the lease **and** `last_block`
  is still exactly `from - 1`. So even a worker that stalled past its lease and wakes up later can neither store a range twice nor move
  the index backwards, and there is never a moment where events are stored without the progress (or the reverse).

Tests: unit tests run 8 simultaneous syncs (one fetches, seven are busy, every block range fetched and stored once), waves of concurrent
syncs while the chain grows, and a stalled worker whose lease expired (its late write is refused, progress is not moved back). The
integration test sends 8 concurrent `GET /feed` against real Postgres through an RPC proxy that records every `eth_getLogs` range: the
ranges are contiguous and never overlap, and each event is stored once. It also tests the SQL directly (exclusive lease; wrong owner,
wrong start and replayed range refused; 10 identical applies at once, exactly one wins), and lets the real pg_cron job fire and
index a feed instance that no test request touches.

**Setting up the minute job on a hosted project.** The migration enables `pg_cron` and `pg_net` (if the database has them; Supabase
projects do) and schedules the job, but the functions' URL is project-specific, so set it once after deploying:

```sql
insert into public.app_config (key, value)
values ('functions_url', 'https://<project-ref>.supabase.co/functions/v1')
on conflict (key) do update set value = excluded.value;
```

Until it is set the job does nothing and the feed still syncs on demand. Check it with
`select status, return_message from cron.job_run_details order by start_time desc limit 5;` and
`select status_code from net._http_response order by created desc limit 5;`.

Limit: it does not handle chain reorganisations (stored events are never deleted). `FEED_CONFIRMATIONS` can hold it a few blocks
behind the head if that ever matters.

## Environment variables

Set as function secrets. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase. Secrets cannot start with
`SUPABASE_`. Template: `supabase/functions/.env.example`. A missing or malformed value gives a JSON `500 misconfigured`, not a crash.

| Name | Used by | Required | Notes |
|---|---|---|---|
| `ESCROW_ADDRESS` | sign-claim, feed | **yes**, no default | the live address above. Deliberately has no default: signing for the wrong contract must be impossible |
| `ESCROW_DEPLOY_BLOCK` | feed | **yes** | `9065839`; where an empty index starts |
| `VERIFIER_PRIVATE_KEY` | sign-claim | **yes, SECRET** | its address must equal `TipEscrow.verifier()` |
| `X_BEARER_TOKEN` | resolve | production: **yes, SECRET** | unset = [mock mode](#mock-mode) |
| `RPC_URL` | sign-claim, feed | no | default `https://rpc.testnet.dogeos.com/` |
| `CHAIN_ID` | sign-claim, feed | no | default `6281971` |
| `CORS_ALLOW_ORIGIN` | all | no | default `*`; set your app's origin in production |
| `SERVICE_ROLE_KEY` | all | no | overrides `SUPABASE_SERVICE_ROLE_KEY` if the platform names it differently |
| `CLAIM_TTL_SECONDS` | sign-claim | no | 300 (30 to 3600) |
| `SIGN_CLAIM_USER_PER_10MIN` / `SIGN_CLAIM_IP_PER_10MIN` | sign-claim | no | 10 / 60 |
| `RESOLVE_CACHE_TTL_SECONDS` | resolve | no | 3600 |
| `RESOLVE_RATE_PER_MINUTE` | resolve | no | 30 per IP |
| `RESOLVE_FRESH_PER_MINUTE` | resolve | no | 10 per IP, for `fresh` lookups (each one is a paid X call) |
| `X_API_BUDGET_PER_15MIN` | resolve | no | 280, all callers together (X allows 300 per 15 min per app) |
| `FEED_RATE_PER_MINUTE`, `FEED_MIN_SYNC_SECONDS`, `FEED_MAX_BLOCKS_PER_SYNC`, `FEED_LOG_CHUNK_BLOCKS`, `FEED_CONFIRMATIONS`, `FEED_LEASE_SECONDS` | feed | no | 120, 5, 100000, 9000, 0, 30 |
| `X_API_BASE_URL` | resolve | **tests only** | points the lookup at a fake X API; leave unset |

### Mock mode

If `X_BEARER_TOKEN` is unset, `resolve` serves fixtures instead of calling X: `XDevelopers` (2244994945), `jack` (12),
`elonmusk` (44196397) and the made-up `MuchTipDemo` (1850123456789012345) and `Doge_Fan_42`. Responses say `"source": "mock"` and it logs
`mock_mode` at startup. Unknown handles are 404. **Never leave this on in production**: set the token. A mistaken tip to a
made-up id cannot be claimed.

## Security model

- **The service key never leaves the functions.** Browsers only ever hold the user's own session token and the public anon key.
- **The verifier key can authorise a claim for *any* X id.** It lives only in the function secret and is never logged or
  returned; a malformed value is reported without echoing it. The live contract's verifier today is the **test** key (in the
  local, gitignored `.env`). Before real use the owner should `setVerifier(<address of the production key>)` (about 0.02 DOGE).
  Until then, deploy `sign-claim` with that same test key or every request returns `verifier_mismatch`.
- **Rate limits** (Postgres counters, fail closed): resolve 30 / min / IP and a shared X budget; sign-claim 60 / 10 min / IP and
  10 / 10 min / X account; feed 120 / min / IP. IPs are stored hashed (SHA-256, 8 bytes). On a shared NAT or a proxy that hides
  client IPs, per-IP limits are shared too: tune them.
- **Logs** are one JSON line per event (`signed`, `resolved`, `identity_rejected`, `upstream_error`, …). The integration tests assert
  that no function log ever contains the verifier key, the X token, the service key or a user JWT.
- **Signatures are one-use and short-lived**: random 256-bit nonce, contract-enforced replay protection, expiry 5 minutes after the
  chain's latest block. Anyone may submit a signature, but it pays only the `recipient` baked into it.
- **Handle reassignment.** The cache can be up to an hour old, so a renamed-and-retaken handle may still map to its previous owner in
  *display* lookups for that long. Money never follows it: the tip flow resolves with `fresh` (always X, never the cache) and shows the
  name and id before the user confirms. The stale display row is corrected by that same fresh lookup.
- **A recipient needs DOGE for the claim fee** (FEES.md). No relayer is built; the signature can be submitted by anyone, so one can
  be added without touching the contract.

## Tests

```
cd supabase/functions && deno test --allow-env --allow-net --allow-read        # unit tests: 90, no Docker; fetches jsr/npm packages the first time
bash supabase/tests/run-integration.sh                                         # integration: needs Docker; reads the live RPC, sends nothing
```

(`deno` 2.x, `DENO=/path/to/deno` for the runner if it is not on PATH; `npm ci` once at the repo root so `npm:` imports resolve from
the pinned `node_modules`. The same two are `npm run test:functions` and `npm run test:integration`. The integration run reads
`VERIFIER_PRIVATE_KEY` from the repo's `.env` to sign against the live contract; without it those steps are skipped and say so.)

- **Unit** (`*_test.ts` beside the code): handle normalisation and `idHash`; the claim gate (20 rejected identity shapes, plus accepted ones);
  EIP-712 against an independent encoder; the X client; the JSON-RPC client; the indexer; each handler with in-memory fakes.
- **Integration** (`supabase/tests/`): real Postgres, GoTrue and PostgREST in Docker with the migrations applied, X mocked
  (`spike/supabase/mock-x.cjs` for the login, a fake X API for `resolve`), and the functions run as the actual `index.ts`
  files over HTTP. It exercises RLS, the SQL functions, `resolve` and its cache, every `sign-claim` rejection and acceptance case
  with real GoTrue sessions, signatures verified against the live contract by `eth_call`, and `feed` over the real events of the
  e2e contract. GoTrue runs in a deliberately permissive configuration (email, anonymous sign-in, manual linking on) so the test can
  create every kind of user the gate must refuse.

**Results (2026-10-31, Deno 2.9.8, Postgres `supabase/postgres:15.19.0.002`, GoTrue `supabase/auth:v2.197.0`, PostgREST v16.5):**
90 unit tests passed; 25 integration steps passed (about 7 minutes, most of it waiting for the public RPC and for pg_cron to fire); `deno check` and `deno lint` clean (the one rule left off,
`no-import-prefix`, objects to inline `npm:`/`jsr:` specifiers, which is deliberate here).

What the **live-contract check** proves (`sign-claim: the signature is verified by the LIVE contract`), all `eth_call`, no DOGE spent:
1. The live contract's `claimDigest(xId, recipient, nonce, expiry)` equals the `digest` the function returned, so chain id,
   contract address, type hash and every field agree.
2. `claim(…)` with that signature and **no** balance override reverts `NothingToClaim`. The contract checks the signature
   *before* the amount, so reaching `NothingToClaim` means the signature was accepted (a bad one reverts `BadSignature` first).
3. With 0.01 DOGE credited to that X account in the simulation only, the same `claim(…)` succeeds.
4. Changing the recipient, the X id, the nonce or the expiry, or presenting it to the e2e contract (different address, so different
   domain), reverts `BadSignature`.

The `feed` steps read the real events of the e2e contract (`0xC48A…3986`): 3 tips, 2 claims, 1 refund, 6 stored events whose
transaction hashes are the ones in `e2e-result.json`, totals `3 / 0.03 DOGE / 2 accounts / 0 unclaimed`, and the contract's balance at the
indexed block (0) matching what the events imply. Against the live contract it returns `refundDelaySeconds: 600` and
`minTipWei: 5000000000000000000` read from the chain.

**Test quality check.** I broke the code on purpose and required the suite to notice. Unit level: the claim gate (three ways),
the EIP-712 domain version, the signed struct, the `idHash` encoding, the cache TTL boundary, unknown-handle handling, the
verifier check, the expiry source and the indexer's per-request bound; every mutant was caught. Integration level: removing RLS and
the revokes, weakening the identity-count rule, and removing the LIKE escaping; each failed its own step and nothing else.
One mutant first **survived**: with LIKE-escaping removed, my underscore test still passed, because its decoy handle could not
match the pattern even with `_` as a wildcard. That was fixed, and the lookup has since been replaced altogether by exact equality on
`lower(handle)`, so there is no pattern left to escape; the `Doge_Fan_42` / `DogeXFanY42` test stays as a regression test (unit and
integration). For the single-writer indexer, two more mutants: ignoring a taken lease and fetching anyway (4 concurrency tests fail),
and ignoring a refused apply (the stalled-worker test fails).

The integration run also caught a real bug: for an address that returns empty data (`0x`), the decode error escaped as an unexpected
error and `feed` answered 500 instead of degrading. Undecodable RPC data is now a `ChainError` like any other RPC failure.

Not covered: the hosted Edge runtime, a real X account or X API call, and a real browser login (see the deploy section).

## Deploying to a hosted Supabase project

Not exercised here: I had no hosted project, the Supabase CLI was not installed, and the hosted Edge runtime was not used. The
code runs under plain Deno with the same `index.ts` entry points and only `npm:` imports, which the hosted runtime supports; the
steps below follow Supabase's documentation. **Treat the hosted deploy as UNVERIFIED until it has been smoke-tested.**

1. **Auth providers** (Dashboard → Authentication → Providers). Enable **X / Twitter (OAuth 2.0)** with the client id and secret from
   your X app (callback `https://<ref>.supabase.co/auth/v1/callback`). **Disable Email, Phone and Anonymous sign-ins** and leave manual
   identity linking off, so the only way in is X. If the dashboard offers it, allow X users without an email (otherwise accounts
   without a confirmed email cannot sign in; see README and `verified.md` 3d). Add your app's URLs to Redirect URLs.
2. **Link and migrate**: `supabase login`, `supabase link --project-ref <ref>`, `supabase db push`.
3. **Secrets**:
   ```
   supabase secrets set ESCROW_ADDRESS=0x207652b0767F9f19d24B5300E2123D415167aCeF ESCROW_DEPLOY_BLOCK=9065839 \
     VERIFIER_PRIVATE_KEY=0x… X_BEARER_TOKEN=… CORS_ALLOW_ORIGIN=https://your-app.example
   ```
   On Noah, add the same names in the Cloud tab → Secrets (never paste a key into chat).
4. **Deploy**: `supabase functions deploy resolve sign-claim feed --no-verify-jwt` (`supabase/config.toml` already sets
   `verify_jwt = false`, because `sign-claim` authenticates the caller itself and the platform check would reject the newer
   non-JWT API keys).
5. **Smoke test**:
   ```
   curl "$FN/resolve?handle=XDevelopers"          # 200 with xId 2244994945 (or "source":"mock" if no token set)
   curl "$FN/feed"                                # 200, config.refundDelaySeconds 600, minTipWei 5000000000000000000
   curl -X POST "$FN/sign-claim" -d '{}'          # 401 missing_token
   ```
   then sign in with X in the app and claim once (testnet DOGE only) to prove `sign-claim` end to end. Check the function logs for
   `mock_mode` (must not appear) and `verifier_mismatch` (must not appear).
6. **Turn on the minute sync**: run the `app_config` insert from [the indexer](#the-indexer) with your project's functions URL.
7. **Replace the verifier** with a production key as described under [Security model](#security-model), then update
   `VERIFIER_PRIVATE_KEY`.

**UNVERIFIED on hosted Supabase:** which environment variable carries the service key (the code accepts `SERVICE_ROLE_KEY` as a
fallback); whether `getUser(jwt)` behaves identically with newer project API keys (tested here against self-hosted GoTrue
v2.197.0); the X app's real billing and the exact body X returns for an unknown username (the client treats HTTP 200 with
`errors`, or 404, as "not found"; `verified.md` 3a).

## Why `feed` is server-side

I recommend keeping it on the server. The totals need every event since deployment, which a browser cannot fetch in one call (the
RPC allows 10,000 blocks per query), so a client-side version would rescan the chain on each visit or have to maintain its own index.
The server indexes once and everyone reads the result; it also joins handles, which live in the database, and gives the Noah port a
single JSON endpoint to render. The browser should still read **its own** facts straight from the chain with ethers:
`tipStatus(tipId)`, `refundableAt(tipId)`, `balanceOf(idHash)` and the user's wallet balance. If read traffic grows, the sync can move
from "on each request" to a scheduled job (`pg_cron` calling the function every few seconds) without changing the response.
