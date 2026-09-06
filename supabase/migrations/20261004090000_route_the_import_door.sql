-- ============================================================================
-- The import door learns to route (C2.04, C8.03, C2.12).
--
-- THE DEFECT. 20260907090000 opened begin_manual_import as the one door a
-- customer can walk through, and deliberately named only three entity types:
--
--   "Naming an unsupported one here would let a caller open a run that
--    ingest_batch then rejects row by row, which reads as a data problem when
--    it is a configuration one."
--
-- That reasoning was right and the door was left narrow because of it. What it
-- could not say, because nothing in the schema records it, is that the run
-- does not know which function is supposed to process it. begin_manual_import
-- writes entity_type onto connector_runs and returns a run id; the CALLER then
-- picks an RPC. Two functions accept connector runs on disjoint entity sets:
--
--   ingest_batch          (20260905090000, the live definition)
--                         condition_reading, material_stock, work_order,
--                         maintenance_notification, maintenance_plan
--   ingest_context_batch  (20260812090000)
--                         operating_state, production_record
--
-- ingest_context_batch is granted to `authenticated` and has never had a
-- non-test caller. Four validated entity types — two in each function — are
-- unreachable, and operating context is the input the register names as the
-- blocker under C2.04: without it the platform knows THAT an asset failed and
-- never what it was doing when it failed.
--
-- WHY WIDENING THE LIST ALONE WOULD BE WORSE THAN DOING NOTHING. Adding
-- 'operating_state' to the allowlist and stopping there does not half-work. The
-- run opens, the existing caller shape calls ingest_batch, and every row is
-- refused with `unsupported entity_type "operating_state"` while records_read
-- and watermark_to still advance. The operator sees "read 21450 · accepted 0 ·
-- rejected 21450" with a per-row reason that blames their spreadsheet. That is
-- precisely the failure the 20260907090000 comment was written to prevent.
--
-- THE FIX IS A ROUTE, NOT A LONGER STRING. One route table is the single
-- source of truth for which validator owns which entity type. The door refuses
-- from it, and ingest_rows dispatches from it, so "the door said yes" and "a
-- function will accept it" cannot diverge. No validation is copied: each entity
-- type is still validated in exactly one place, by the function that already
-- owned it.
--
-- AND THE OTHER DOOR IS CLOSED. ingest_batch and ingest_context_batch lose
-- their grant to `authenticated`. They were reachable directly, which is how a
-- caller could open an operating_state run and hand it to the wrong validator
-- in the first place. They are SECURITY DEFINER and ingest_rows is too, so the
-- router still calls them; nothing else can. The fail-fast refusal is now a
-- property of the schema rather than of caller discipline.
--
-- NOT ROUTED, DELIBERATELY: operational_constraint_signal. 20261002100000 adds
-- ingest_recovery_signal_batch for it, and that function is not a peer of these
-- two — it demands connector_type = 'recovery_signal', carries its own
-- authority gate (recovery_role_allowed, which admits `operator` and
-- `supervisor` and is therefore NOT the manual-import gate), and belongs to the
-- Recovery workstream. A manual-upload connector is 'manual_upload', so routing
-- it here would open a door that function refuses. It stays out until Recovery
-- decides its own upload story.
--
-- WHO MAY IMPORT DOES NOT CHANGE — AND NOW THE WRITE PATH AGREES. The role
-- gate is the same five roles 20260907090000 named: planner,
-- reliability_engineer, maintenance_manager, admin, ai_admin. Every
-- newly-routed type is the same act the gate was written for — a person loading
-- master or operational data, not a technician reporting a fault.
-- condition_reading is the one worth arguing, because an ingested reading
-- routes through record_condition_reading and can raise an alert; but the actor
-- who loads historian history IS the reliability engineer.
--
-- The gate is checked TWICE, and the second check is the one that matters.
-- 20260907090000 put it only on run creation, and connector_runs' RLS policy
-- (20260917000000:372) is org-wide rather than actor-scoped — so every member
-- of the tenant can read a run id the door just opened for someone else, and
-- ingest_batch was granted to `authenticated`. Measured on a full schema: a
-- technician refused at the door read a planner's run id and pushed two 0.2
-- readings through it, taking `Vibration — Drive End` from 12.4/alarm to
-- 0.2/normal. That hole predates this change; routing four more entity types
-- through one new definer chokepoint is what makes leaving it unforgivable.
-- ingest_rows now re-states the same gate, so a run id is an address and not a
-- capability.
--
-- AND THE RUN MUST BE A MANUAL-UPLOAD RUN. ingest_rows accepted any run in the
-- tenant, and the row's provenance is stamped from the run's connector — so a
-- run pointed at the seeded `SAP PM/EAM` connector wrote a work order that
-- reads as SAP history. The same run also loses idempotency outright, because
-- the dedupe predicate is `source_system = connector_key` and four seeded
-- connectors (SAP PM/EAM, OSIsoft PI, IBM Maximo, Bently Nevada) have a NULL
-- key: `= NULL` is never true, so three identical uploads landed three rows.
-- Requiring connector_type = 'manual_upload' AND a non-null key closes both,
-- and mirrors the check ingest_recovery_signal_batch already makes
-- (20261002100000:167).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The route table. One source of truth, consulted by both the door and the
-- router, so a type can never be admissible at one and unroutable at the other.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_entity_routes()
returns table (entity_type text, handler text)
language sql
immutable
set search_path = public
as $$
  select * from (values
    ('condition_reading',        'ingest_batch'),
    ('material_stock',           'ingest_batch'),
    ('maintenance_notification', 'ingest_batch'),
    ('maintenance_plan',         'ingest_batch'),
    ('work_order',               'ingest_batch'),
    ('operating_state',          'ingest_context_batch'),
    ('production_record',        'ingest_context_batch')
  ) as routes(entity_type, handler);
$$;

revoke all on function public.ingest_entity_routes() from public, anon;
grant execute on function public.ingest_entity_routes() to authenticated;

create or replace function public.ingest_handler_for(p_entity_type text)
returns text
language sql
stable
set search_path = public
as $$
  select r.handler from public.ingest_entity_routes() r
   where r.entity_type = p_entity_type;
$$;

revoke all on function public.ingest_handler_for(text) from public, anon;
grant execute on function public.ingest_handler_for(text) to authenticated;

-- The refusal message is derived, never retyped. A list maintained by hand in
-- an error string is how a door starts lying about what it accepts.
create or replace function public.ingest_supported_entity_types()
returns text
language sql
stable
set search_path = public
as $$
  select string_agg(r.entity_type, ', ' order by r.entity_type)
    from public.ingest_entity_routes() r;
$$;

revoke all on function public.ingest_supported_entity_types() from public, anon;
grant execute on function public.ingest_supported_entity_types() to authenticated;

-- ---------------------------------------------------------------------------
-- The door. Identical to 20260907090000 except that the allowlist is now the
-- route table rather than a literal.
-- ---------------------------------------------------------------------------
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
  -- person rewriting the PM programme does. UNCHANGED from 20260907090000.
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error',
      'importing master data requires a planning, engineering or administrator role');
  end if;

  -- Only the entity types a validator actually owns, read from the route table
  -- the router dispatches on. An unsupported type still fails HERE, before a
  -- run exists, naming what is supported — the property 20260907090000 bought
  -- with a narrow literal, now bought with a route instead.
  if public.ingest_handler_for(p_entity_type) is null then
    return jsonb_build_object('error',
      format('manual upload does not carry "%s" — supported: %s',
             p_entity_type, public.ingest_supported_entity_types()));
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

revoke all on function public.begin_manual_import(text, text) from public, anon;
grant execute on function public.begin_manual_import(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The router. The run decides which validator sees the rows; the caller does
-- not get to choose and cannot get it wrong.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_rows(
  p_run_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_entity text;
  v_handler text;
begin
  -- SECURITY DEFINER because ingest_batch and ingest_context_batch are no
  -- longer executable by `authenticated`; this function is the only caller
  -- they have. It therefore re-states the tenant filter itself rather than
  -- leaning on the connector_runs policy, which RLS does not apply here.
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;

  -- The SAME gate the door applies, restated on the write. A run id is not a
  -- capability: connector_runs' policy is org-wide, so any member of the tenant
  -- can read the id of a run the door opened for a planner. Without this a
  -- technician the door had just refused could push condition readings through
  -- that run and clear a live alarm — measured, not supposed.
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error',
      'importing master data requires a planning, engineering or administrator role');
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('error', 'rows must be a JSON array');
  end if;

  -- The run must be one this door opened. Rows are stamped with the run's
  -- connector_key as source_system, so accepting any run in the tenant let a
  -- caller write work orders that read as SAP history; and a connector with a
  -- NULL key defeats the dedupe predicate entirely, so the same file loaded
  -- three times landed three rows.
  select cr.entity_type into v_entity
    from connector_runs cr
    join connectors c on c.id = cr.connector_id
   where cr.id = p_run_id
     and cr.organization_id = v_org
     and c.connector_type = 'manual_upload'
     and c.connector_key is not null;
  if not found then
    return jsonb_build_object('error', 'run not found');
  end if;

  v_handler := public.ingest_handler_for(v_entity);
  if v_handler is null then
    -- Fail fast on the whole call. A run whose type no validator owns is a
    -- configuration fault, and refusing every row one at a time would report it
    -- as a data fault — the distinction 20260907090000 exists to preserve.
    return jsonb_build_object('error',
      format('no ingest handler for entity type "%s" — supported: %s',
             v_entity, public.ingest_supported_entity_types()));
  end if;

  -- Dispatch is an explicit branch rather than a dynamically built call. The
  -- route table is trusted today; a dynamic call site would still be there the
  -- day it is not.
  if v_handler = 'ingest_batch' then
    return public.ingest_batch(p_run_id, p_rows);
  elsif v_handler = 'ingest_context_batch' then
    return public.ingest_context_batch(p_run_id, p_rows);
  end if;

  return jsonb_build_object('error',
    format('the route table names handler "%s", which this router cannot call', v_handler));
end $$;

revoke all on function public.ingest_rows(uuid, jsonb) from public, anon;
grant execute on function public.ingest_rows(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- One door, not three.
-- ---------------------------------------------------------------------------
-- Both validators were granted to `authenticated`, so any caller could hand a
-- run to the wrong one — which is exactly the misroute the router exists to
-- make impossible. Leaving the direct grants in place would leave the old
-- failure reachable beside the fix. They keep SECURITY DEFINER, so ingest_rows
-- (also definer, same owner) still calls them; no other caller can.
--
-- Verified before revoking: `ingest_batch` had exactly one non-migration caller
-- in the tree (src/components/MaintenancePlanImport.tsx:108, rewritten in this
-- change to call ingest_rows) and `ingest_context_batch` had none at all. No
-- edge function references either.
revoke all on function public.ingest_batch(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ingest_context_batch(uuid, jsonb) from public, anon, authenticated;

-- `service_role` keeps both, for the vendor adapter the contract reserves it
-- for. Supabase's platform default (ALTER DEFAULT PRIVILEGES ... ON FUNCTIONS
-- TO postgres, anon, authenticated, service_role) already grants it, and the
-- revokes above deliberately do not name it — but a grant that exists only
-- because of a platform default is a grant nobody can read in this file, and a
-- review of this branch read it wrong. Stated explicitly so it is checkable.
grant execute on function public.ingest_batch(uuid, jsonb) to service_role;
grant execute on function public.ingest_context_batch(uuid, jsonb) to service_role;
grant execute on function public.ingest_rows(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- The watermark rule stops being a property of one caller.
-- ---------------------------------------------------------------------------
-- Body spliced from 20260810160000 rather than retyped; the two edits below are
-- the whole difference and each is asserted to match exactly once.
create or replace function public.finish_connector_run(
  p_run_id uuid,
  p_status text default 'success',
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  r connector_runs%rowtype;
begin
  select * into r from connector_runs where id = p_run_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'run not found');
  end if;

  update connector_runs
  set status = p_status, finished_at = now(), error_message = p_error,
      records_processed = records_accepted
  where id = p_run_id;

  -- The watermark advances only on a clean run. Advancing it after a partial
  -- failure is how rows get skipped forever.
  --
  -- 20260810160000 stated that as a property and enforced only `p_status =
  -- 'success'`, leaving the rest to the caller. The browser importer does pass
  -- 'partial' when anything was rejected — but the rule was a property of that
  -- one call site, not of the contract: a run carrying records_rejected = 1,
  -- finished with 'success', advanced the watermark straight past the skipped
  -- row, and `greatest(...)` means it can never come back down. The row is
  -- already sitting in r.records_rejected; consulting it is what makes the
  -- sentence above true for every caller, including the vendor adapter that
  -- does not exist yet.
  if p_status = 'success' and r.records_rejected = 0 and r.watermark_to is not null then
    insert into ingest_watermarks (organization_id, connector_id, entity_type,
      last_position, last_run_id)
    values (v_org, r.connector_id, r.entity_type, r.watermark_to, p_run_id)
    on conflict (connector_id, entity_type) do update
      set last_position = greatest(ingest_watermarks.last_position, excluded.last_position),
          last_run_id = excluded.last_run_id, updated_at = now();
  end if;

  update connectors
  set last_success_at = case when p_status = 'success' then now() else last_success_at end,
      last_failure_at = case when p_status <> 'success' then now() else last_failure_at end
  where id = r.connector_id;

  return jsonb_build_object('run_id', p_run_id, 'status', p_status,
    'watermark_advanced',
      p_status = 'success' and r.records_rejected = 0 and r.watermark_to is not null,
    'records_rejected', r.records_rejected);
end
$$;

-- ---------------------------------------------------------------------------
-- The two functions the manual door already used, which `anon` could call.
-- ---------------------------------------------------------------------------
-- 20260907090000:125 and 20260810160000:487 grant to `authenticated` without
-- the `revoke ... from public, anon` this repository uses 241 times elsewhere,
-- so both were executable by PUBLIC and therefore by `anon`. Harmless today
-- (app_current_org() is null for anon, so one returns no rows and the other
-- 'run not found'), but the convention exists so that harmlessness does not
-- have to be re-derived every time the body changes.
revoke all on function public.get_import_rejects(uuid, int) from public, anon;
grant execute on function public.get_import_rejects(uuid, int) to authenticated;
grant execute on function public.get_import_rejects(uuid, int) to service_role;

revoke all on function public.finish_connector_run(uuid, text, text) from public, anon;
grant execute on function public.finish_connector_run(uuid, text, text) to authenticated;
grant execute on function public.finish_connector_run(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
