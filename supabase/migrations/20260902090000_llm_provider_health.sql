-- ============================================================================
-- LLM provider health events: ending the month of silence.
--
-- WHAT HAPPENED.
--
-- The enrichment loop pointed at the Stigg gateway. The gateway stopped
-- resolving (NXDOMAIN), and the loop failed for OVER A MONTH — last successful
-- enrichment 2026-07-08, zero in 30 days — with every failure going to
-- console.error, which nobody reads. A background loop has no user to show a
-- banner to, so its failures were invisible. The copilot's blip was noticed
-- within minutes because a person was watching; the enrich loop's outage was
-- noticed by accident, a month later, while diagnosing the copilot.
--
-- This table is where provider trails land. The rule in both edge functions:
-- any call that was not a clean first-attempt success writes its full event
-- trail here. Queryable beats printable.
--
-- NOT organization-scoped: provider health is platform infrastructure, the
-- same for every tenant, and contains no tenant data — provider names, HTTP
-- statuses and retry outcomes only.
-- ============================================================================

create table if not exists llm_provider_events (
  id bigserial primary key,
  function_name text not null,
  provider text not null,
  outcome text not null check (outcome in ('ok','retried','failed_over','exhausted')),
  status int,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists idx_lpe_recent
  on llm_provider_events(created_at desc);

alter table llm_provider_events enable row level security;
drop policy if exists lpe_read on llm_provider_events;
-- Readable by any authenticated user; written only by the service role (the
-- edge functions), which bypasses RLS. No tenant data inside.
create policy lpe_read on llm_provider_events
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Posture: the question is not "how many errors" but "is anything exhausted,
-- and is the fallback carrying the load" — a chain running permanently on its
-- fallback is one failure from an outage, and looks healthy from the outside.
-- ---------------------------------------------------------------------------
drop function if exists get_llm_provider_health(int);
create or replace function get_llm_provider_health(p_days int default 7)
returns table (
  "functionName" text,
  provider text,
  ok bigint,
  retried bigint,
  "failedOver" bigint,
  exhausted bigint,
  "lastEvent" timestamptz,
  finding text
)
language sql stable security definer set search_path = public as $$
  select e.function_name, e.provider,
    count(*) filter (where e.outcome='ok'),
    count(*) filter (where e.outcome='retried'),
    count(*) filter (where e.outcome='failed_over'),
    count(*) filter (where e.outcome='exhausted'),
    max(e.created_at),
    case
      when count(*) filter (where e.outcome='exhausted') > 0 then
        format('%s exhaustion(s): every provider in the chain failed and a user or '
               || 'loop saw an outage. The chain narrowed to nothing.',
               count(*) filter (where e.outcome='exhausted'))
      when count(*) filter (where e.outcome='failed_over') > 0 then
        format('%s failover(s): this provider is failing and the fallback is carrying '
               || 'its load. Working, and one failure away from not.',
               count(*) filter (where e.outcome='failed_over'))
      when count(*) filter (where e.outcome='retried') > 0 then
        'Transient retries only — absorbed without failover.'
      else 'Clean.'
    end
  from llm_provider_events e
  where e.created_at > now() - make_interval(days => greatest(p_days,1))
  group by e.function_name, e.provider
  order by count(*) filter (where e.outcome='exhausted') desc,
           count(*) filter (where e.outcome='failed_over') desc,
           e.function_name, e.provider;
$$;

grant execute on function get_llm_provider_health(int) to authenticated;

notify pgrst, 'reload schema';
