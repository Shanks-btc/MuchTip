# Plan: `resolve(handle)` Edge Function and the `x_handles` cache

Status: **plan only, nothing built.** Facts are marked VERIFIED (with source) or UNVERIFIED.

## What it must do

1. Turn an X handle typed on the Tip page into the account's **numeric X id** (the key the contract uses).
2. **Block tips to handles that don't exist**, so nobody tips a hash that no one can ever claim.
3. Remember handle ↔ id in a Supabase table so repeat lookups are free and the **Feed** can show `@handle`.
   **Only this function writes to that table.** No other function, and no client, can.

## Facts this rests on

| Fact | Status | Source |
|---|---|---|
| Endpoint `GET https://api.x.com/2/users/by/username/{username}` exists; accepts an app-only Bearer Token | VERIFIED | [OpenAPI](https://docs.x.com/openapi.json) `getUsersByUsername`; security `BearerToken` |
| A valid handle matches `^[A-Za-z0-9_]{1,15}$` | VERIFIED | same spec, `username` path parameter |
| Success returns `data.id` as a **string** (ids can exceed 2^53, so never parse to a JS Number) | VERIFIED | spec `User.id` is `string`; X docs example `"id":"2244994945"` |
| A name that doesn't exist: HTTP 200 whose body has `errors` (a `ResourceNotFoundProblem`) and no `data` | UNVERIFIED live | derived from the spec (200 body has optional `data`, `errors`); I have no X credentials to call it |
| Rate limit 300 requests / 15 min per app | VERIFIED | [rate limits](https://docs.x.com/x-api/fundamentals/rate-limits.md) |
| Price: "User: Read $0.010 per resource fetched", same resource deduplicated for 24 h (UTC) | VERIFIED as a price table; **UNVERIFIED that this endpoint is billed as "User: Read"** | [pricing](https://docs.x.com/x-api/getting-started/pricing.md) and [developer.x.com pricing](https://developer.x.com/#pricing): neither maps endpoints to categories |
| A lookup that finds nothing is free (no resource returned) | UNVERIFIED | inferred from "charged per resource fetched" |
| X lets you set a spending limit per billing cycle (hard cost backstop) | VERIFIED | pricing page, "Spending limits" |

**Cost estimate:** about **$0.01 per handle looked up for the first time**; cache hits cost nothing. Treat as an
estimate until one real call is made and the Developer Console usage is checked.

## Table `public.x_handles` (exactly the three columns you specified)

```sql
create table public.x_handles (
  x_id         numeric(20,0) primary key,                         -- numeric X id; a rename updates this row's handle
  handle       text not null check (handle ~ '^[A-Za-z0-9_]{1,15}$'),
  resolved_at  timestamptz not null default now()
);
create index x_handles_handle_idx on public.x_handles (lower(handle), resolved_at desc);
alter table public.x_handles enable row level security;
create policy "handles are public" on public.x_handles for select using (true);
-- No insert/update/delete policy: only the resolve Edge Function (server key) writes.
```

**Feed lookups without an `id_hash` column.** Events carry `keccak256(abi.encode(x_id))`, which cannot be reversed, and
Postgres has no keccak. So the Feed does `select x_id, handle from x_handles`, hashes each `x_id` in the browser
(ethers), and builds a hash → handle map. That is fine for a hackathon-sized table (hundreds of rows). **If the table
grows large,** add an `id_hash text unique` column that `resolve` fills in when it writes the row (still written only
by `resolve`) and query by it. I left it out because you specified three columns; say if you want it now.

Primary key is `x_id` (not the handle): handles get renamed and reused, so two rows can briefly carry the same handle
(old owner and new owner). Lookups take the **newest** `resolved_at`.

## Edge Function `resolve`

Input `{ handle }` (a leading `@` is stripped). Output `{ exists, xId, idHash, handle, cached }` (`idHash` is computed on the fly; it is not stored).

1. **Validate** against `^[A-Za-z0-9_]{1,15}$`. Reject anything else with 400 and never call X.
2. **Cache hit:** select the newest row with `lower(handle) = lower($1)`. If `resolved_at` is younger than the TTL
   (**1 hour** for the hackathon), return it with `cached: true`.
3. **Cache miss or stale:** call X with the Bearer Token (Supabase secret `X_BEARER_TOKEN`), 5 s timeout.
   - **Found** (`data.id` present): upsert `(x_id, handle, resolved_at)` by `x_id` (this also records a rename), return it.
   - **Not found** (200 with `errors`, no `data`): return `{ exists: false }`. The UI blocks the tip.
   - **Anything else** (401/402/429/5xx, timeout): return 503 `lookup_unavailable`. This is *not* "doesn't exist".
     **Fail closed:** the UI blocks the tip with "couldn't verify this handle, try again".
4. **Abuse control**, because each new handle costs money and the function must be callable without a login:
   per-IP and global limits on *uncached* lookups (kept in a small table, since Edge isolates don't share memory),
   X's own spending limit as the hard backstop, and the 300/15 min X limit as an upper bound.
5. CORS limited to the app's origin; the platform JWT check stays on (the anon/publishable key is enough).

Why a TTL at all: if a handle changes hands inside the TTL, a cached entry would send tips to the *previous* owner.
So the Tip page shows `@handle` with its numeric id and a link to the profile (`https://x.com/<handle>`) for the user to
confirm before sending.

## Tip page rules ("block tips to non-existent handles")

- The **Tip button stays disabled** until `resolve` returned `exists: true` for the exact handle in the field.
- The page recomputes `idHash(xId)` locally (ethers) and compares it with the server's `idHash` before sending.
- **Limit:** the contract cannot tell a real X account from a made-up id, so a direct contract call can still tip any
  hash. Such tips are not lost: the tipper can refund them after `refundDelay`.

## Feed and Profile (`/@handle`)

- No new event (your decision 2). Events carry hashes: `Tipped(tipId, idHash, from, amount)`, `Refunded(…idHash…)`,
  and `Claimed(idHash, …, xId)`.
- The Feed reads logs from the RPC and maps hashes to handles through `x_handles` as described above. A hash with no row (a
  tip made outside our UI) is shown shortened.
- Profile `/@handle`: resolve the handle (cache-first), then filter logs by that `idHash` topic.
- Handle names can lag after a rename until `resolve` looks that account up again. The claim function does **not**
  refresh the table, because only `resolve` may write to it.

## Open items (all UNVERIFIED until a real X call is made)

1. Exact "not found" response body and whether such a call is billed.
2. That `users/by/username` is billed as "User: Read" and by how much in practice (check Developer Console usage after a handful of calls).
3. Whether X's developer policy allows keeping this id↔handle mapping for the TTL and for the Feed.
4. Whether a Noah-generated project lets this function be created and given the `X_BEARER_TOKEN` secret as described.
