-- ============================================================================
-- The fourth classification: AWAITING DATA (capability register C9.01, U21.02).
--
-- The provenance ladder split human effort three ways — satisfied, awaiting a
-- connection, irreducibly human — and left 1,045 items on the auxiliary fleet
-- in none of them. Diagnosing those found a real hole in the model.
--
-- Seven requirements have DERIVE-ONLY ladders: one rung, no fallback. When the
-- derivation abstains there is nowhere to fall to, so the resolver's catch-all
-- marked them "human required" with nothing named. They are not human — no
-- person can supply an availability baseline by typing it — and they are not
-- awaiting a connection, because the connector is already there or irrelevant.
-- They are awaiting a specific DATUM.
--
-- The auxiliary fleet makes the distinction concrete. Its 21,450 states are
-- ALL down events: 9,640 unplanned, 11,810 planned, and not one running
-- record. So operating hours, start/stop cycles and load profile correctly
-- return nothing — the source is a downtime export, and a downtime export
-- cannot tell you how long the machine ran. Calling that "needs a human" would
-- send someone to type a number they do not have; calling it "needs running-
-- state records" tells them what to go and get.
--
-- Four buckets now, and every item lands in exactly one:
--     satisfied · awaiting a connection · awaiting data · irreducibly human
--
-- Canonical reuse: requirement_sources, asset_onboarding_items. Additive.
-- ============================================================================

alter table requirement_sources
  -- For a derive rung: the datum the derivation needs, in the operator's
  -- language rather than a function name.
  add column if not exists data_need text;

alter table asset_onboarding_items
  add column if not exists blocked_kind text
    check (blocked_kind in ('connection', 'data'));

comment on column asset_onboarding_items.blocked_kind is
  'Whether a blocked item is waiting on a SYSTEM to be connected or on a DATUM that no connected system currently supplies. Both are actionable and neither is a human task; conflating them sends someone to type a number they do not have.';

update requirement_sources set data_need = v.need
from (values
  ('operating_hours',    'running-state records — a downtime export alone cannot show run time'),
  ('start_stop_cycles',  'running-state records, to count starts'),
  ('load_profile',       'load percentage on operating states'),
  ('maintenance_cost',   'asset economics: annual maintenance cost'),
  ('production_impact',  'production records for this asset'),
  ('detectability_coverage', 'sensors mapped to a detection technique'),
  ('reading_quality',    'condition-monitoring readings'),
  ('normal_alarm_rate',  'condition alerts, which need reading history'),
  ('alarm_limits',       'warning and alarm limits on the mapped sensors'),
  ('sensor_inventory',   'sensors mapped to this asset'),
  ('asset_age',          'a commissioning date'),
  ('dq_gate',            'a data-quality rule set and at least one evaluated run'),
  ('alert_workflow',     'one alert routed end to end, to prove the path works'),
  ('sensor_validation',  'sensors reporting against their mapped tags'),
  ('unit_consistency',   'units of measure declared on the mapped sensors'),
  ('bad_data_rules',     'bad-data rules configured for the mapped signals'),
  ('feedback_loop',      'at least one recommendation actioned and its outcome recorded'),
  ('analytics_use_case', 'a configured analytics use case'),
  ('health_index',       'a configured health-index formula'),
  ('reliability_targets','availability or MTBF targets from the asset owner'),
  ('lifecycle_status',   'a lifecycle stage on the asset record'),
  ('support_roles',      'support roles assigned on the asset record'),
  ('fracas_loop',        'a corrective action verified through to effectiveness'),
  ('model_change_log',   'a model change recorded'),
  ('excluded_data',      'a documented data-exclusion decision'),
  ('alert_confidence',   'alerts carrying a confidence value'),
  ('service_severity',   'operating context: duty and environment'),
  ('process_events',     'process alarms or trips'),
  ('strategy_from_history', 'enough coded history to infer a strategy'),
  ('job_plan_details',   'an adopted job plan for this asset class'),
  ('critical_spares',    'a bill of materials or issued-parts history'),
  ('safety_critical',    'a safety-consequence screening on this asset'),
  ('connector_security', 'at least one registered connector')
) as v(k, need)
where requirement_sources.source_kind = 'derive' and requirement_sources.source_ref = v.k;

-- Baseline capture IS derivable: a baseline is the performance the history
-- demonstrates, and refusing to call it captured when 456 events are on record
-- would be pedantry rather than rigour.
create or replace function public.derive_onboarding_value(
  p_asset_id uuid,
  p_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid;
  a assets%rowtype;
  n int;
begin
  select * into a from assets where id = p_asset_id;
  if not found then return null; end if;
  v_org := a.organization_id;

  if p_key = 'baseline_captured' then
    select count(*) into n from work_orders
    where asset_id = p_asset_id and work_type = 'corrective' and completed_at is not null;
    -- Ten events is the point below which a "baseline" is a rumour.
    return case when n >= 10
      then to_jsonb(format('Baseline from %s corrective events on record', n)) end;
  end if;

  return derive_onboarding_value_core(p_asset_id, p_key);
end
$$;

grant execute on function public.derive_onboarding_value(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- Resolver: a derive rung that abstains records WHAT IT NEEDED
-- ----------------------------------------------------------------------------
create or replace function public.run_onboarding_resolution(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  a assets%rowtype;
  it record;
  rung record;
  v_val jsonb;
  v_done boolean;
  v_needs text[];
  v_resolved int := 0;
  v_queued int := 0;
  v_human int := 0;
  v_conn int := 0;
  v_data int := 0;
  v_irreducible int := 0;
  v_missing_connectors text[] := '{}';
begin
  select * into a from assets where id = p_asset_id;
  if not found then return jsonb_build_object('error', 'asset not found'); end if;
  v_org := a.organization_id;

  for it in
    select i.id, i.requirement_key
    from asset_onboarding_items i
    where i.asset_id = p_asset_id
      and i.status not in ('auto_filled', 'provided', 'deduced')
  loop
    v_done := false;
    v_needs := '{}';

    for rung in
      select * from requirement_sources
      where requirement_key = it.requirement_key order by rank
    loop
      if v_done then exit; end if;

      if rung.source_kind = 'derive' then
        v_val := derive_onboarding_value(p_asset_id, rung.source_ref);
        if v_val is not null then
          update asset_onboarding_items
          set status = 'auto_filled', value = v_val, source = 'derived',
              resolved_by = 'derive', resolved_ref = rung.source_ref,
              blocked_on = null, blocked_kind = null, irreducible = false,
              filled_at = now()
          where id = it.id;
          v_resolved := v_resolved + 1;
          v_done := true;
        elsif rung.data_need is not null
              and not (rung.data_need = any(v_needs)) then
          -- Remember what it wanted. This is the difference between "we need a
          -- person" and "we need running-state records".
          v_needs := v_needs || rung.data_need;
        end if;

      elsif rung.source_kind = 'connector' then
        if not exists (select 1 from connectors
                       where organization_id = v_org and enabled
                         and (system_kind = rung.source_ref or connector_type = rung.source_ref))
           and not (rung.source_ref = any(v_missing_connectors)) then
          v_missing_connectors := v_missing_connectors || rung.source_ref;
        end if;

      elsif rung.source_kind in ('ai', 'library') then
        update asset_onboarding_items
        set status = 'pending_ai', resolved_by = rung.source_kind,
            resolved_ref = rung.source_ref, blocked_on = null,
            blocked_kind = null, irreducible = false
        where id = it.id;
        v_queued := v_queued + 1;
        v_done := true;

      elsif rung.source_kind = 'human' then
        update asset_onboarding_items
        set status = 'human_required', resolved_by = null,
            irreducible = rung.irreducible,
            blocked_kind = case when rung.irreducible then null else 'connection' end,
            blocked_on = case when rung.irreducible then null else (
              select string_agg(distinct s2.source_ref, ', ')
              from requirement_sources s2
              where s2.requirement_key = it.requirement_key
                and s2.source_kind = 'connector'
                and not exists (select 1 from connectors c
                                where c.organization_id = v_org and c.enabled
                                  and (c.system_kind = s2.source_ref or c.connector_type = s2.source_ref))) end,
            note = coalesce(rung.guidance->>'what', note)
        where id = it.id;
        v_human := v_human + 1;
        if rung.irreducible then v_irreducible := v_irreducible + 1; else v_conn := v_conn + 1; end if;
        v_done := true;
      end if;
    end loop;

    if not v_done then
      -- Nothing answered. Say which KIND of thing is missing: a system to
      -- connect, or a datum no connected system supplies. Neither is a person.
      declare
        v_conn_missing text;
      begin
        select string_agg(distinct s2.source_ref, ', ') into v_conn_missing
        from requirement_sources s2
        where s2.requirement_key = it.requirement_key
          and s2.source_kind = 'connector'
          and not exists (select 1 from connectors c
                          where c.organization_id = v_org and c.enabled
                            and (c.system_kind = s2.source_ref or c.connector_type = s2.source_ref));

        if v_conn_missing is not null then
          update asset_onboarding_items
          set status = 'human_required', irreducible = false,
              blocked_kind = 'connection', blocked_on = v_conn_missing, resolved_by = null
          where id = it.id;
          v_conn := v_conn + 1;
        else
          update asset_onboarding_items
          set status = 'human_required', irreducible = false,
              blocked_kind = 'data',
              -- nullif because array_to_string on an empty array returns '',
              -- not NULL — and an empty string in this column would render as
              -- a blank reason, which reads as "no reason" rather than "we
              -- have not modelled what this needs".
              blocked_on = coalesce(nullif(array_to_string(v_needs, '; '), ''),
                                    'a derivation input this platform does not yet model'),
              resolved_by = null
          where id = it.id;
          v_data := v_data + 1;
        end if;
      end;
      v_human := v_human + 1;
    end if;
  end loop;

  update asset_onboarding_state s
  set completion_pct = (
        select round(100.0 * count(*) filter (where status in ('auto_filled','provided','deduced'))
               / greatest(count(*),1))
        from asset_onboarding_items where asset_id = p_asset_id),
      human_required_count = (
        select count(*) from asset_onboarding_items
        where asset_id = p_asset_id and status = 'human_required' and irreducible),
      updated_at = now()
  where s.asset_id = p_asset_id;

  return jsonb_build_object(
    'asset', a.name,
    'resolved_by_derivation', v_resolved,
    'queued_for_ai_or_library', v_queued,
    'irreducibly_human', v_irreducible,
    'awaiting_a_connection', v_conn,
    'awaiting_data', v_data,
    'missing_connectors', to_jsonb(v_missing_connectors),
    'note', 'Four outcomes, and every item lands in exactly one. Only "irreducibly human" is a floor. human_required_count on the asset now counts ONLY those — the previous number treated a missing historian as a staffing problem.');
end
$$;

grant execute on function public.run_onboarding_resolution(uuid) to authenticated;

create or replace function public.get_onboarding_human_floor()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_assets int;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select count(*) into v_assets from assets where organization_id = v_org;

  return jsonb_build_object(
    'assets', v_assets,
    'items_total', (select count(*) from asset_onboarding_items where organization_id = v_org),
    'auto_satisfied', (select count(*) from asset_onboarding_items
                       where organization_id = v_org and status in ('auto_filled','deduced','provided')),
    'queued_for_ai', (select count(*) from asset_onboarding_items
                      where organization_id = v_org and status = 'pending_ai'),
    'human_irreducible', (select count(*) from asset_onboarding_items
                          where organization_id = v_org and status='human_required' and irreducible),
    'awaiting_connection', (select count(*) from asset_onboarding_items
                            where organization_id = v_org and blocked_kind='connection'),
    'awaiting_data', (select count(*) from asset_onboarding_items
                      where organization_id = v_org and blocked_kind='data'),
    'unclassified', (select count(*) from asset_onboarding_items
                     where organization_id = v_org and status='human_required'
                       and not irreducible and blocked_kind is null),
    'irreducible_per_asset', (select round(count(*)::numeric / greatest(v_assets,1),1)
                              from asset_onboarding_items
                              where organization_id = v_org and status='human_required' and irreducible),
    'connections_that_would_help', (
      select coalesce(jsonb_agg(jsonb_build_object('connector', k, 'items_unblocked', n) order by n desc), '[]'::jsonb)
      from (select blocked_on k, count(*) n from asset_onboarding_items
            where organization_id = v_org and blocked_kind='connection' group by 1) x),
    'data_that_would_help', (
      select coalesce(jsonb_agg(jsonb_build_object('datum', k, 'items_unblocked', n) order by n desc), '[]'::jsonb)
      from (select blocked_on k, count(*) n from asset_onboarding_items
            where organization_id = v_org and blocked_kind='data' group by 1 order by count(*) desc limit 10) x),
    'note', 'Four buckets, every item in exactly one. IRREDUCIBLE is the floor. AWAITING A CONNECTION names a system to integrate. AWAITING DATA names a datum no connected system supplies — a downtime export cannot tell you how long a machine ran, and sending someone to type that number is how a checklist stalls.');
end
$$;

grant execute on function public.get_onboarding_human_floor() to authenticated;

notify pgrst, 'reload schema';
