-- Scheduled sync: every minute, pg_cron asks the `feed` Edge Function (through pg_net) to catch the index up, so the feed
-- stays current even when nobody is looking at the site. The function does the work under the lease from the previous
-- migration, so a cron tick and a visitor's request never index the same blocks twice.
--
-- The functions' public URL is project-specific, so it is NOT in this file. After deploying, set it once:
--
--   insert into public.app_config (key, value)
--   values ('functions_url', 'https://<project-ref>.supabase.co/functions/v1')
--   on conflict (key) do update set value = excluded.value;
--
-- Until it is set the job does nothing (and the feed still syncs on demand).

create table public.app_config (
  key   text primary key,
  value text not null
);

comment on table public.app_config is 'Deployment settings read by database jobs. Service role / postgres only.';

alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

-- Returns the pg_net request id, or NULL if functions_url is not configured.
create function public.trigger_feed_sync()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base text;
begin
  select value into base from public.app_config where key = 'functions_url';
  if base is null or base = '' then
    return null;
  end if;
  return net.http_get(url := rtrim(base, '/') || '/feed?limit=1');
end;
$$;

revoke all on function public.trigger_feed_sync() from public, anon, authenticated;
grant execute on function public.trigger_feed_sync() to service_role;

-- Schedule it, if this database has the extensions (Supabase projects do; a plain Postgres does not).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron;
    perform cron.schedule('muchtip-feed-sync', '* * * * *', 'select public.trigger_feed_sync()');
  else
    raise notice 'pg_cron / pg_net are not available: no scheduled feed sync (the feed still syncs on demand)';
  end if;
end
$$;
