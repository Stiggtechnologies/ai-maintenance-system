-- Anonymous public-demo abuse throttling. This table never stores prompts,
-- customer data, IP addresses, or user-agent strings.
create table if not exists public.public_demo_rate_limits (
  fingerprint_hash text not null,
  window_start timestamptz not null,
  run_count integer not null default 1 check (run_count > 0),
  last_run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (fingerprint_hash, window_start)
);

alter table public.public_demo_rate_limits enable row level security;

create or replace function public.consume_public_demo_allowance(
  p_fingerprint_hash text,
  p_window_start timestamptz,
  p_limit integer default 1
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
begin
  if length(p_fingerprint_hash) <> 64 or p_limit < 1 or p_limit > 10 then
    return false;
  end if;

  select run_count into current_count
  from public.public_demo_rate_limits
  where fingerprint_hash = p_fingerprint_hash and window_start = p_window_start
  for update;

  if not found then
    insert into public.public_demo_rate_limits (fingerprint_hash, window_start)
    values (p_fingerprint_hash, p_window_start);
    return true;
  end if;

  if current_count >= p_limit then return false; end if;

  update public.public_demo_rate_limits
  set run_count = run_count + 1, last_run_at = now()
  where fingerprint_hash = p_fingerprint_hash and window_start = p_window_start;
  return true;
end;
$$;

revoke all on public.public_demo_rate_limits from public, anon, authenticated;
revoke all on function public.consume_public_demo_allowance(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.consume_public_demo_allowance(text, timestamptz, integer) to service_role;
