-- ============================================================================
-- LLM enrichment plumbing for the continuous agent loop.
--
-- The agent-loop-enrich edge function upgrades loop-raised PENDING
-- recommendations with model reasoning (via the Stigg AI Gateway). This
-- migration adds:
--   1. enrichment stamps on recommendations
--   2. private.enrichment_config (NOT exposed via PostgREST) holding the edge
--      function URL + service key for the cron caller
--   3. configure_agent_enrichment(): service-role-only RPC to set that config
--   4. a pg_cron job that no-ops until config exists, then POSTs the edge
--      function every 10 minutes via pg_net
--
-- Everything is fail-soft: no config → cron does nothing; no LLM secrets on
-- the function → it returns {skipped}. The deterministic loop never depends
-- on enrichment.
-- ============================================================================

alter table recommendations add column if not exists enriched_at timestamptz;
alter table recommendations add column if not exists enrichment_model text;

create extension if not exists pg_net;

-- Private schema: not in PostgREST's exposed schemas, invisible to the API.
create schema if not exists private;

create table if not exists private.enrichment_config (
  id boolean primary key default true check (id),
  function_url text not null,
  service_key text not null,
  updated_at timestamptz not null default now()
);

create or replace function public.configure_agent_enrichment(
  p_function_url text,
  p_service_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into private.enrichment_config (id, function_url, service_key)
  values (true, p_function_url, p_service_key)
  on conflict (id) do update
    set function_url = excluded.function_url,
        service_key = excluded.service_key,
        updated_at = now();
  return jsonb_build_object('configured', true, 'function_url', p_function_url);
end
$$;

revoke execute on function public.configure_agent_enrichment(text, text) from public, anon, authenticated;
grant execute on function public.configure_agent_enrichment(text, text) to service_role;

-- Cron-callable trigger: reads config, fires the edge function via pg_net.
create or replace function public.trigger_agent_enrichment()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg record;
  req_id bigint;
begin
  select * into cfg from private.enrichment_config where id = true;
  if cfg.function_url is null then
    return jsonb_build_object('skipped', 'not_configured');
  end if;

  select net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cfg.service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) into req_id;

  return jsonb_build_object('requested', true, 'request_id', req_id);
end
$$;

revoke execute on function public.trigger_agent_enrichment() from public, anon, authenticated;
grant execute on function public.trigger_agent_enrichment() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'syncai-agent-enrich';
    perform cron.schedule('syncai-agent-enrich', '*/10 * * * *', 'select public.trigger_agent_enrichment()');
  end if;
end
$$;
