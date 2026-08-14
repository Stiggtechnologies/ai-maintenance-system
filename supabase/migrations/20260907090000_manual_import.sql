-- ============================================================================
-- A door a customer can walk through (C6.10, C2.12).
--
-- 20260905090000 taught the ingest contract to accept maintenance plans and
-- notifications, and nobody can reach it. The chain is register_connector →
-- begin_connector_run → ingest_batch → finish_connector_run, and it stops at
-- the first step: register_connector is gated to admin | ai_admin, it registers
-- every connector DISABLED by design ("Enable explicitly"), begin_connector_run
-- refuses a disabled connector — and NO FUNCTION ENABLES ONE. The only way to
-- flip that flag is a raw write against the connectors table through the legacy
-- blanket policy. A planner uploading a spreadsheet cannot do any of it.
--
-- So get_work_management_health still reports PM compliance as
--   "PROXY — completed preventive work as a share of preventive work RAISED.
--    A PM never raised improves this number instead of harming it. Load
--    maintenance_plans to measure compliance against work actually due."
-- and the remedy it names has been unreachable since the day it was written.
-- That makes C6.10 an over-claim, not a capability.
--
-- WHY NOT JUST ADD enable_connector(). Because the disabled default is right.
-- A vendor connector reaches into a customer's CMMS on a schedule with stored
-- credentials, and having to switch it on deliberately is the control standing
-- between "configured" and "pulling production data". A one-off spreadsheet a
-- human is watching is not that, and does not need that control loosened for
-- everything else. This opens the narrow door instead: an operator-initiated
-- upload, role-gated, its own connector, no arbitrary activation.
--
-- Everything downstream is untouched. Validation, idempotency on
-- (source_system, external_id), retained rejects and watermarks are the
-- contract's, not this migration's, and this deliberately adds no entity types
-- so the 300-line validator is not reproduced to reach them.
-- ============================================================================

create or replace function public.begin_manual_import(
  p_entity_type text,
  p_source_name text default 'Manual upload'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_key text;
  v_connector uuid;
  v_run uuid;
  v_from timestamptz;
begin
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;

  -- Same gate as start_history_import (20260813140000): loading master data is
  -- a planning act. A technician reporting a fault needs no permission; a
  -- person rewriting the PM programme does.
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error',
      'importing master data requires a planning, engineering or administrator role');
  end if;

  -- Only the entity types the contract already validates. Naming an unsupported
  -- one here would let a caller open a run that ingest_batch then rejects row by
  -- row, which reads as a data problem when it is a configuration one.
  if p_entity_type not in ('maintenance_plan', 'maintenance_notification', 'work_order') then
    return jsonb_build_object('error',
      format('manual upload does not carry "%s" — supported: maintenance_plan, maintenance_notification, work_order',
             p_entity_type));
  end if;

  -- One connector per organization per entity type, so a re-upload of the same
  -- spreadsheet lands on the same (source_system, external_id) pair the
  -- contract deduplicates on. A per-upload connector key would make every
  -- re-import look like new data.
  v_key := 'manual-upload-' || p_entity_type;

  insert into connectors (organization_id, connector_key, name, connector_type,
    system_kind, contract_note, status, enabled, direction)
  -- system_kind 'file' is the vocabulary the contract already defines for a
  -- source that is a file rather than a system; widening the check constraint
  -- for a synonym would be vocabulary drift.
  values (v_org, v_key, p_source_name, 'manual_upload', 'file',
    'Operator-initiated upload. Enabled at creation because a human starts each '
    || 'run in the moment; it holds no credentials and polls nothing.',
    'active', true, 'read_only')
  on conflict (organization_id, connector_key) where connector_key is not null
    do update set name = excluded.name, enabled = true, status = 'active'
  returning id into v_connector;

  select last_position into v_from from ingest_watermarks
   where connector_id = v_connector and entity_type = p_entity_type;

  insert into connector_runs (organization_id, connector_id, entity_type,
    run_type, status, started_at, watermark_from, triggered_by)
  values (v_org, v_connector, p_entity_type, 'manual', 'running', now(), v_from, auth.uid())
  returning id into v_run;

  return jsonb_build_object('run_id', v_run, 'connector_id', v_connector,
    'entity_type', p_entity_type);
end $$;

grant execute on function public.begin_manual_import(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The rejects, readable back for the person who just uploaded.
-- ---------------------------------------------------------------------------
-- ingest_staging already keeps every refused row with its reason, and until now
-- nothing read them. A rejection nobody sees is the same as a dropped row: the
-- contract's whole argument for retaining them is that a connector reporting
-- success while losing data is the failure worth engineering against — which
-- only holds if somebody is shown what was lost.
drop function if exists get_import_rejects(uuid, int);
create or replace function public.get_import_rejects(p_run_id uuid, p_limit int default 100)
returns table (external_id text, reject_reason text, payload jsonb)
language sql stable security definer set search_path = public as $$
  select s.external_id, s.reject_reason, s.payload
  from ingest_staging s
  where s.run_id = p_run_id
    and s.organization_id = app_current_org()
    and s.status = 'rejected'
  order by s.received_at
  limit greatest(p_limit, 1);
$$;

grant execute on function public.get_import_rejects(uuid, int) to authenticated;

notify pgrst, 'reload schema';
