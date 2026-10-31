-- chain_events / indexer_state: an incremental copy of TipEscrow's Tipped / Claimed / Refunded events, kept by the `feed`
-- Edge Function. DogeOS's RPC caps eth_getLogs at 10,000 blocks per query, so the feed cannot rescan from the deploy block
-- on every request; it syncs forward from `indexer_state.last_block` and stores what it finds.
--
-- Amounts are numeric(78,0) (a uint256) and are only ever returned as text (see feed_totals and the `amount_wei::text`
-- cast in the function): wei values exceed 2^53 and would be rounded by JSON/JavaScript numbers.

create table public.chain_events (
  contract     text          not null check (contract ~ '^0x[0-9a-f]{40}$'),
  block_number bigint        not null,
  log_index    integer       not null,
  tx_hash      text          not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  event        text          not null check (event in ('Tipped', 'Claimed', 'Refunded')),
  id_hash      text          not null check (id_hash ~ '^0x[0-9a-f]{64}$'),
  tip_id       text          check (tip_id ~ '^[0-9]{1,78}$'),            -- Tipped, Refunded
  account      text          not null check (account ~ '^0x[0-9a-f]{40}$'), -- Tipped: from; Refunded: tipper; Claimed: recipient
  amount_wei   numeric(78,0) not null check (amount_wei >= 0),
  x_id         text          check (x_id ~ '^[0-9]{1,78}$'),              -- Claimed only (the event carries the numeric id)
  block_time   timestamptz   not null,
  primary key (contract, block_number, log_index)
);

create index chain_events_newest_idx on public.chain_events (contract, block_number desc, log_index desc);
create index chain_events_id_hash_idx on public.chain_events (contract, id_hash);

comment on table public.chain_events is 'Public chain data, copied by the feed Edge Function. Public read; service-role write.';

-- How far each contract has been indexed. Advanced ONLY by indexer_apply() (below), which is called by the `feed` Edge
-- Function: on demand when someone requests the feed, and every minute by the pg_cron job in the next migration.
-- lease_owner / lease_until make one worker the only one syncing at a time (see indexer_acquire).
create table public.indexer_state (
  contract    text        primary key check (contract ~ '^0x[0-9a-f]{40}$'),
  last_block  bigint      not null,
  updated_at  timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz
);

alter table public.chain_events enable row level security;
alter table public.indexer_state enable row level security;

create policy "chain_events are public" on public.chain_events
  for select to anon, authenticated using (true);

revoke all on public.chain_events, public.indexer_state from anon, authenticated;
grant select on public.chain_events to anon, authenticated;

-- Totals over the stored events, as one jsonb with every amount as a string.
--   tipsCount      number of Tipped events
--   totalTippedWei sum of Tipped amounts
--   uniqueHandles  distinct X accounts (idHash) that have been tipped
--   unclaimedWei   Tipped - Claimed - Refunded: what the contract still owes (equals its balance at p_to_block)
-- p_to_block limits the totals to events up to and including that block, so the caller can compare them with the
-- contract's balance at exactly that block even while another request is syncing further.
create function public.feed_totals(p_contract text, p_to_block bigint default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with t as (
    select
      count(*) filter (where event = 'Tipped')                          as tips,
      count(*) filter (where event = 'Claimed')                         as claims,
      count(*) filter (where event = 'Refunded')                        as refunds,
      coalesce(sum(amount_wei) filter (where event = 'Tipped'), 0)      as tipped,
      coalesce(sum(amount_wei) filter (where event = 'Claimed'), 0)     as claimed,
      coalesce(sum(amount_wei) filter (where event = 'Refunded'), 0)    as refunded,
      count(distinct id_hash) filter (where event = 'Tipped')           as accounts
    from public.chain_events
    where contract = p_contract
      and (p_to_block is null or block_number <= p_to_block)
  )
  select jsonb_build_object(
    'tipsCount',      tips,
    'claimsCount',    claims,
    'refundsCount',   refunds,
    'totalTippedWei', tipped::text,
    'claimedWei',     claimed::text,
    'refundedWei',    refunded::text,
    'uniqueHandles',  accounts,
    'unclaimedWei',   (tipped - claimed - refunded)::text
  ) from t;
$$;

revoke all on function public.feed_totals(text, bigint) from public, anon, authenticated;
grant execute on function public.feed_totals(text, bigint) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Single-writer indexing.
--
-- The feed fetches logs from the chain over HTTP, which cannot happen inside one database transaction, and PostgREST gives
-- every call its own connection, so a session-level pg_advisory_lock would not survive between calls. Two mechanisms
-- together give "no double-indexing":
--   1. a LEASE (indexer_acquire / indexer_release): the worker that holds an unexpired lease is the only one fetching. A
--      second caller gets NULL and simply serves what is stored. A crashed worker's lease expires on its own.
--   2. indexer_apply, which stores a batch of events AND moves last_block in ONE transaction, under a transaction-level
--      advisory lock, and only if last_block is still exactly p_from - 1 and the caller still owns the lease. Even a
--      stalled worker whose lease expired cannot overwrite newer progress or store a range twice.
-- ---------------------------------------------------------------------------------------------------------------------

-- Becomes the syncing worker for a contract. Returns {"lastBlock", "updatedAt"} to continue from, or NULL when another
-- worker holds a live lease. Creates the state (at p_start_block - 1) the first time.
create function public.indexer_acquire(p_contract text, p_owner text, p_start_block bigint, p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.indexer_state;
begin
  if p_lease_seconds < 1 then
    raise exception 'invalid lease';
  end if;
  insert into public.indexer_state as s (contract, last_block, updated_at, lease_owner, lease_until)
  values (p_contract, p_start_block - 1, now(), p_owner, now() + make_interval(secs => p_lease_seconds))
  on conflict (contract) do update
    set lease_owner = p_owner, lease_until = now() + make_interval(secs => p_lease_seconds)
    where s.lease_until is null or s.lease_until < now() or s.lease_owner = p_owner
  returning * into r;
  if r.contract is null then
    return null; -- someone else holds the lease
  end if;
  return jsonb_build_object('lastBlock', r.last_block, 'updatedAt', r.updated_at);
end;
$$;

-- Stores the events of blocks [p_from, p_to] and advances last_block from p_from - 1 to p_to, atomically. Returns false
-- (and changes nothing) if the caller no longer owns the lease or last_block is not p_from - 1.
create function public.indexer_apply(
  p_contract text, p_owner text, p_from bigint, p_to bigint, p_events jsonb, p_lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  moved integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('muchtip:indexer:' || p_contract, 0));

  if p_to < p_from then
    raise exception 'empty block range';
  end if;
  if exists (
    select 1 from jsonb_populate_recordset(null::public.chain_events, p_events) e
    where e.contract <> p_contract or e.block_number < p_from or e.block_number > p_to
  ) then
    raise exception 'event outside the contract or block range being applied';
  end if;

  update public.indexer_state
     set last_block = p_to, updated_at = now(), lease_until = now() + make_interval(secs => p_lease_seconds)
   where contract = p_contract and lease_owner = p_owner and last_block = p_from - 1;
  get diagnostics moved = row_count;
  if moved = 0 then
    return false;
  end if;

  insert into public.chain_events
  select * from jsonb_populate_recordset(null::public.chain_events, p_events)
  on conflict do nothing;
  return true;
end;
$$;

create function public.indexer_release(p_contract text, p_owner text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.indexer_state set lease_owner = null, lease_until = null
   where contract = p_contract and lease_owner = p_owner;
$$;

revoke all on function public.indexer_acquire(text, text, bigint, integer) from public, anon, authenticated;
revoke all on function public.indexer_apply(text, text, bigint, bigint, jsonb, integer) from public, anon, authenticated;
revoke all on function public.indexer_release(text, text) from public, anon, authenticated;
grant execute on function public.indexer_acquire(text, text, bigint, integer) to service_role;
grant execute on function public.indexer_apply(text, text, bigint, bigint, jsonb, integer) to service_role;
grant execute on function public.indexer_release(text, text) to service_role;
