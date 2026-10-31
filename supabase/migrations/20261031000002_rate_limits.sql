-- rate_limits: fixed-window counters used by the Edge Functions. Service role only (RLS on, no policies, grants revoked).

create table public.rate_limits (
  bucket       text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (bucket, window_start)
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Atomically counts one hit in the current window of `p_window_seconds` and says whether the caller is still within
-- `p_limit`. Hits over the limit are counted too, so a flood does not reset itself.
create function public.rate_limit_hit(p_bucket text, p_window_seconds integer, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w timestamptz;
  n integer;
begin
  if p_window_seconds < 1 or p_limit < 1 then
    raise exception 'invalid rate limit parameters';
  end if;
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (bucket, window_start, hits)
  values (p_bucket, w, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into n;

  -- housekeeping on ~1% of calls
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;

  return n <= p_limit;
end;
$$;

-- Functions in `public` are executable by anon/authenticated by default on Supabase: restrict to the service role.
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
