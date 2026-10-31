-- x_handles: cache of X handle -> numeric X user id, written ONLY by the `resolve` Edge Function (service role).
--
-- x_id is text, not bigint/numeric: X ids can exceed 2^53 and PostgREST returns numbers as JSON numbers, which JavaScript
-- would silently round. id_hash = keccak256(abi.encode(uint256 xId)) as 0x-hex, exactly TipEscrow.idHash(xId); the feed
-- joins chain events to handles on it.
--
-- A handle belongs to at most one account at a time (unique index on its lower-case form). When X reassigns a handle to a
-- different account, upsert_x_handle() clears it from the previous owner's row: that row keeps its id and name but its
-- handle becomes NULL ("we no longer know it"), and the feed shows such accounts without a handle.

create table public.x_handles (
  x_id        text        primary key check (x_id ~ '^[0-9]{1,20}$'),
  handle      text        check (handle is null or handle ~ '^[A-Za-z0-9_]{1,15}$'),
  name        text        check (name is null or char_length(name) <= 100),
  id_hash     text        not null check (id_hash ~ '^0x[0-9a-f]{64}$'),
  resolved_at timestamptz not null default now(),
  -- lookups are exact equality on this column. PostgREST cannot filter on an expression such as lower(handle),
  -- so the expression is materialised; the unique index below is, in effect, a unique index on lower(handle).
  handle_lc   text        generated always as (lower(handle)) stored
);

comment on table public.x_handles is 'X handle cache. Public read; written only by the resolve Edge Function via the service role.';
comment on column public.x_handles.handle is 'Canonical casing as returned by X. NULL once the handle was reassigned to another account.';
comment on column public.x_handles.name is 'Display name as returned by X (sanitised by the function). Display only.';

create unique index x_handles_handle_lc_key on public.x_handles (handle_lc);
-- one row per account, and the feed looks accounts up by hash
create unique index x_handles_id_hash_key on public.x_handles (id_hash);

alter table public.x_handles enable row level security;

create policy "x_handles are public" on public.x_handles
  for select to anon, authenticated using (true);

-- New tables in `public` are granted to anon/authenticated by default on Supabase; take everything back, give back SELECT.
-- service_role bypasses RLS and keeps its default grants, so it is the only role that can write.
revoke all on public.x_handles from anon, authenticated;
grant select on public.x_handles to anon, authenticated;

-- Stores what X just told us about an account, in one transaction: whoever held the handle before loses it, then the row
-- for p_x_id is inserted or refreshed. The advisory lock serialises concurrent writers for the same handle, so the
-- unique index is never violated by a race.
create function public.upsert_x_handle(
  p_x_id text, p_handle text, p_name text, p_id_hash text, p_resolved_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('muchtip:handle:' || lower(p_handle), 0));

  update public.x_handles set handle = null
   where handle_lc = lower(p_handle) and x_id <> p_x_id;

  insert into public.x_handles as h (x_id, handle, name, id_hash, resolved_at)
  values (p_x_id, p_handle, p_name, p_id_hash, p_resolved_at)
  on conflict (x_id) do update
    set handle = excluded.handle, name = excluded.name, id_hash = excluded.id_hash, resolved_at = excluded.resolved_at;
end;
$$;

revoke all on function public.upsert_x_handle(text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.upsert_x_handle(text, text, text, text, timestamptz) to service_role;
