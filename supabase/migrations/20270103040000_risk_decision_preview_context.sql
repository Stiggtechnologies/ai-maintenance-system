-- Governed risk-decision preview context
--
-- The customer-facing analysis and treatment forms need to explain what the
-- authoritative writers will calculate before a user records the action.  A
-- preview must not select "the latest" criteria or accept caller-supplied
-- competency claims: record_risk_analysis binds to risks.criteria_profile_id,
-- and create_risk_treatment checks the canonical active workforce roster.
-- This read projection returns those exact inputs and nothing that can approve,
-- purchase, select or execute a decision.

-- Secondary risks contain copied parent context. Their existing typed links
-- and the ONE append-only ledger must not become a declassification channel.
-- The private projection also recognizes a recorded origin on a legacy row
-- whose old ON DELETE SET NULL relation was already severed. No history or
-- customer row is rewritten, and conflicting/missing lineage fails closed.
create index if not exists idx_audit_events_risk_secondary_origin
  on public.audit_events(organization_id, (public.sync_text_as_uuid(event_data->>'risk_id')))
  where entity_type = 'risk_secondary_created';

create or replace function public.get_risk_secondary_origin_internal(
  p_risk public.risks
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_count bigint;
  v_valid bigint;
  v_origins jsonb;
  v_parent uuid := p_risk.secondary_to_risk_id;
  v_scenario uuid := p_risk.arising_from_scenario_id;
begin
  select count(*), count(*) filter (where
    public.sync_text_as_uuid(a.event_data->>'parent_risk_id') is not null
    and public.sync_text_as_uuid(a.event_data->>'scenario_id') is not null
    and jsonb_typeof(a.new_state) = 'object'
    and a.new_state->>'status' = 'draft'
    and public.sync_text_as_uuid(a.new_state->>'secondary_to_risk_id')
      = public.sync_text_as_uuid(a.event_data->>'parent_risk_id')
    and public.sync_text_as_uuid(a.new_state->>'arising_from_scenario_id')
      = public.sync_text_as_uuid(a.event_data->>'scenario_id')
  ), jsonb_agg(distinct jsonb_build_object(
    'parent_id', public.sync_text_as_uuid(a.event_data->>'parent_risk_id'),
    'scenario_id', public.sync_text_as_uuid(a.event_data->>'scenario_id')
  )) into v_count, v_valid, v_origins
  from public.audit_events a
  where a.organization_id = p_risk.organization_id
    and a.entity_type = 'risk_secondary_created'
    and public.sync_text_as_uuid(a.event_data->>'risk_id') = p_risk.id;

  if v_count > 0 then
    if v_valid <> v_count or jsonb_array_length(v_origins) <> 1 then
      return jsonb_build_object('valid', false, 'derived', true);
    end if;
    if (v_parent is not null and v_parent is distinct from
        public.sync_text_as_uuid(v_origins->0->>'parent_id'))
      or (v_scenario is not null and v_scenario is distinct from
        public.sync_text_as_uuid(v_origins->0->>'scenario_id')) then
      return jsonb_build_object('valid', false, 'derived', true);
    end if;
    v_parent := public.sync_text_as_uuid(v_origins->0->>'parent_id');
    v_scenario := public.sync_text_as_uuid(v_origins->0->>'scenario_id');
  end if;

  if v_parent is null and v_scenario is null then
    return jsonb_build_object('valid', true, 'derived', false,
      'parent_id', null, 'scenario_id', null);
  end if;
  if v_parent is null or v_scenario is null or not exists (
    select 1 from public.risks parent
    where parent.id = v_parent and parent.organization_id = p_risk.organization_id
  ) or not exists (
    select 1 from public.scenarios scenario
    where scenario.id = v_scenario and scenario.organization_id = p_risk.organization_id
      and scenario.risk_id = v_parent
  ) then
    return jsonb_build_object('valid', false, 'derived', true);
  end if;
  return jsonb_build_object('valid', true, 'derived', true,
    'parent_id', v_parent, 'scenario_id', v_scenario);
end;
$$;
revoke all on function public.get_risk_secondary_origin_internal(public.risks)
  from public, anon, authenticated, service_role;

create or replace function public.can_read_risk(p_risk_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_user uuid := auth.uid();
  v_role text;
  v_cursor uuid := p_risk_id;
  v_seen uuid[] := '{}'::uuid[];
  v_row public.risks%rowtype;
  v_origin jsonb;
begin
  if p_risk_id is null or v_org is null or v_user is null then return false; end if;
  select role into v_role from public.user_profiles
  where id = v_user and organization_id = v_org;
  while v_cursor is not null loop
    if v_cursor = any(v_seen) then return false; end if;
    v_seen := array_append(v_seen, v_cursor);
    select * into v_row from public.risks
    where id = v_cursor and organization_id = v_org;
    if not found then return false; end if;
    -- Preserve the original rule, independently for EVERY ancestor. A child
    -- owner or stakeholder cannot override an unreadable parent/grandparent.
    if not coalesce(
      v_row.information_sensitivity in ('public','internal')
      or v_row.risk_owner_id = v_user or v_row.decision_owner_id = v_user
      or exists(select 1 from public.risk_stakeholder_views sv
        where sv.risk_id = v_row.id and sv.organization_id = v_org
          and sv.stakeholder_user_id = v_user)
      or (v_row.information_sensitivity = 'confidential' and v_role in
        ('admin','ai_admin','executive','maintenance_manager','reliability_engineer'))
      or (v_row.information_sensitivity = 'restricted' and v_role in
        ('admin','ai_admin','executive')), false
    ) then return false; end if;
    v_origin := public.get_risk_secondary_origin_internal(v_row);
    if v_origin->'valid' is distinct from 'true'::jsonb then return false; end if;
    v_cursor := public.sync_text_as_uuid(v_origin->>'parent_id');
  end loop;
  return true;
end;
$$;
revoke all on function public.can_read_risk(uuid) from public, anon;
grant execute on function public.can_read_risk(uuid) to authenticated, service_role;

create or replace function public.enforce_secondary_risk_origin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origin jsonb;
  v_cursor uuid;
  v_seen uuid[] := array[new.id];
  v_parent public.risks%rowtype;
begin
  if tg_op = 'UPDATE' then
    v_origin := public.get_risk_secondary_origin_internal(old);
    if old.secondary_to_risk_id is not null
      and new.secondary_to_risk_id is distinct from old.secondary_to_risk_id then
      raise exception 'Secondary risk parent provenance cannot be severed or replaced'
        using errcode = 'check_violation';
    end if;
    if old.arising_from_scenario_id is not null
      and new.arising_from_scenario_id is distinct from old.arising_from_scenario_id then
      raise exception 'Secondary risk treatment provenance cannot be severed or replaced'
        using errcode = 'check_violation';
    end if;
    if v_origin->'derived' = 'true'::jsonb
      and (new.id is distinct from old.id or new.organization_id is distinct from old.organization_id) then
      raise exception 'Secondary risk origin identity and tenant are immutable'
        using errcode = 'check_violation';
    end if;
    -- Ordinary edits do not reinterpret quarantined legacy origins. Restoring
    -- a missing typed link must match its recorded canonical origin exactly.
    if new.secondary_to_risk_id is not distinct from old.secondary_to_risk_id
      and new.arising_from_scenario_id is not distinct from old.arising_from_scenario_id then
      return new;
    end if;
    if v_origin->'derived' = 'true'::jsonb and (
      v_origin->'valid' is distinct from 'true'::jsonb
      or new.secondary_to_risk_id is distinct from public.sync_text_as_uuid(v_origin->>'parent_id')
      or new.arising_from_scenario_id is distinct from public.sync_text_as_uuid(v_origin->>'scenario_id')
    ) then
      raise exception 'Restored secondary risk links must match the canonical origin receipt'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.secondary_to_risk_id is null and new.arising_from_scenario_id is null then return new; end if;
  if new.secondary_to_risk_id is null or new.arising_from_scenario_id is null
    or not exists(select 1 from public.scenarios
      where id = new.arising_from_scenario_id and organization_id = new.organization_id
        and risk_id = new.secondary_to_risk_id) then
    raise exception 'Secondary risk origin requires a bound same-tenant parent and treatment'
      using errcode = 'check_violation';
  end if;
  -- Only lineage acts serialize; routine risk analysis remains unaffected.
  -- This also prevents two concurrent re-links from each missing the other's
  -- new edge. The walk has no arbitrary 64-hop escape hatch.
  perform pg_advisory_xact_lock(hashtextextended('risk-secondary-origin:' || new.organization_id::text, 0));
  v_cursor := new.secondary_to_risk_id;
  while v_cursor is not null loop
    if v_cursor = any(v_seen) then
      raise exception 'Secondary risk origin cannot form a cycle' using errcode = 'check_violation';
    end if;
    v_seen := array_append(v_seen, v_cursor);
    select * into v_parent from public.risks
    where id = v_cursor and organization_id = new.organization_id;
    if not found then
      raise exception 'Secondary risk parent must exist in the same tenant' using errcode = 'check_violation';
    end if;
    v_origin := public.get_risk_secondary_origin_internal(v_parent);
    if v_origin->'valid' is distinct from 'true'::jsonb then
      raise exception 'Secondary risk ancestry is not verifiable' using errcode = 'check_violation';
    end if;
    v_cursor := public.sync_text_as_uuid(v_origin->>'parent_id');
  end loop;
  return new;
end;
$$;
revoke all on function public.enforce_secondary_risk_origin()
  from public, anon, authenticated, service_role;
drop trigger if exists trg_secondary_risk_origin on public.risks;
create trigger trg_secondary_risk_origin before insert or update on public.risks
  for each row execute function public.enforce_secondary_risk_origin();

-- Protect the other end too: clearing/moving/deleting a canonical scenario
-- must not sever a child's treatment origin, including legacy ledger-bound
-- children whose typed link was already cleared. Existing ordinary scenarios
-- remain subject to their existing permissions and lifecycle contracts.
create or replace function public.enforce_secondary_scenario_origin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists(select 1 from public.risks where arising_from_scenario_id = old.id)
    or exists(select 1 from public.audit_events
      where organization_id = old.organization_id and entity_type = 'risk_secondary_created'
        and public.sync_text_as_uuid(event_data->>'scenario_id') = old.id) then
    if tg_op = 'DELETE' then
      raise exception 'A secondary risk treatment origin cannot be deleted'
        using errcode = 'check_violation';
    end if;
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
      or new.risk_id is distinct from old.risk_id then
      raise exception 'A secondary risk treatment origin identity, tenant and parent are immutable'
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.enforce_secondary_scenario_origin()
  from public, anon, authenticated, service_role;
drop trigger if exists trg_secondary_scenario_origin on public.scenarios;
create trigger trg_secondary_scenario_origin before update or delete on public.scenarios
  for each row execute function public.enforce_secondary_scenario_origin();

-- A new origin receipt must describe an actual typed canonical child written
-- by the current named human. Direct service-key appends cannot fabricate an
-- origin for an unlinked row and use it to restore/declassify copied content.
create or replace function public.enforce_risk_secondary_origin_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child public.risks%rowtype;
  v_role text;
  v_pass integer;
begin
  -- Validate before waiting to reject unauthorized calls promptly, then repeat
  -- the SAME binding after the advisory wait. Post-wait row locks preserve
  -- current human authority and child identity until the receipt commits.
  for v_pass in 1..2 loop
  if new.organization_id is distinct from public.app_current_org() or auth.uid() is null then
    raise exception 'Secondary risk origin receipts require a current named human tenant'
      using errcode = 'insufficient_privilege';
  end if;
  if v_pass = 2 then
    select role into v_role from public.user_profiles
    where id = auth.uid() and organization_id = new.organization_id for share;
  else
    select role into v_role from public.user_profiles
    where id = auth.uid() and organization_id = new.organization_id;
  end if;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    raise exception 'Secondary risk origin receipts require an authorized human risk-management role'
      using errcode = 'insufficient_privilege';
  end if;
  if v_pass = 2 then
    select * into v_child from public.risks
    where id = public.sync_text_as_uuid(new.event_data->>'risk_id')
      and organization_id = new.organization_id for share;
  else
    select * into v_child from public.risks
    where id = public.sync_text_as_uuid(new.event_data->>'risk_id')
      and organization_id = new.organization_id;
  end if;
  if not found or v_child.created_by is distinct from auth.uid()
    or v_child.secondary_to_risk_id is null or v_child.arising_from_scenario_id is null
    or public.sync_text_as_uuid(new.event_data->>'parent_risk_id') is distinct from v_child.secondary_to_risk_id
    or public.sync_text_as_uuid(new.event_data->>'scenario_id') is distinct from v_child.arising_from_scenario_id
    or public.sync_text_as_uuid(new.new_state->>'secondary_to_risk_id') is distinct from v_child.secondary_to_risk_id
    or public.sync_text_as_uuid(new.new_state->>'arising_from_scenario_id') is distinct from v_child.arising_from_scenario_id
    or new.new_state->>'status' is distinct from 'draft'
    or v_child.status is distinct from 'draft' then
    raise exception 'Secondary risk origin receipt does not match its canonical child'
      using errcode = 'check_violation';
  end if;
  if v_pass = 1 then
    perform pg_advisory_xact_lock(hashtextextended('risk-secondary-origin-receipt:' || v_child.id::text, 0));
  end if;
  end loop;
  if exists(select 1 from public.audit_events
    where organization_id = new.organization_id and entity_type = 'risk_secondary_created'
      and public.sync_text_as_uuid(event_data->>'risk_id') = v_child.id) then
    raise exception 'A secondary risk canonical origin receipt already exists'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_risk_secondary_origin_receipt()
  from public, anon, authenticated, service_role;
drop trigger if exists trg_risk_secondary_origin_receipt on public.audit_events;
create trigger trg_risk_secondary_origin_receipt before insert on public.audit_events
  for each row when (new.entity_type = 'risk_secondary_created')
  execute function public.enforce_risk_secondary_origin_receipt();

create or replace function public.get_risk_decision_preview_context(
  p_risk_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_risk public.risks%rowtype;
  v_criteria public.risk_criteria_profiles%rowtype;
  v_active_competencies jsonb := '[]'::jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select *
  into v_risk
  from public.risks
  where id = p_risk_id
    and organization_id = v_org
    and public.can_read_risk(id);

  if not found then
    return jsonb_build_object('error', 'risk not available to this user');
  end if;

  if v_risk.criteria_profile_id is null then
    return jsonb_build_object('error', 'risk has no bound criteria profile');
  end if;

  select *
  into v_criteria
  from public.risk_criteria_profiles
  where id = v_risk.criteria_profile_id
    and organization_id = v_org;

  if not found then
    return jsonb_build_object('error', 'bound criteria profile not found');
  end if;

  select coalesce(jsonb_agg(q.competency_key order by q.competency_key), '[]'::jsonb)
  into v_active_competencies
  from (
    select distinct c.competency_key
    from public.competencies c
    join public.member_competencies mc
      on mc.competency_id = c.id
     and mc.organization_id = v_org
    join public.workforce_members wm
      on wm.id = mc.member_id
     and wm.organization_id = v_org
     and wm.active
    where c.organization_id = v_org
      and mc.granted_on <= current_date
      and (mc.expires_on is null or mc.expires_on >= current_date)
  ) q;

  return jsonb_build_object(
    'risk_id', v_risk.id,
    'criteria', jsonb_build_object(
      'id', v_criteria.id,
      'name', v_criteria.name,
      'status', v_criteria.status,
      'version', v_criteria.version,
      'consequence_dimensions', v_criteria.consequence_dimensions,
      'likelihood_scale', v_criteria.likelihood_scale,
      'thresholds', v_criteria.thresholds,
      'scoring_weights', v_criteria.scoring_weights,
      'decision_thresholds', v_criteria.decision_thresholds,
      'risk_capacity', v_criteria.risk_capacity,
      'time_factors', v_criteria.time_factors
    ),
    'active_competencies', v_active_competencies,
    'generated_at', now(),
    'advisory_only', true,
    'human_decision_required', true
  );
end;
$$;

comment on function public.get_risk_decision_preview_context(uuid) is
  'Sensitivity-filtered, tenant-scoped exact criteria and active-competency inputs for advisory risk analysis and treatment-readiness previews. It grants no decision or execution authority.';

grant execute on function public.get_risk_decision_preview_context(uuid)
  to authenticated, service_role;
revoke execute on function public.get_risk_decision_preview_context(uuid)
  from public, anon;

-- ---------------------------------------------------------------------------
-- The preview is sensitivity-filtered, so the authoritative writers it feeds
-- must apply the same boundary.  These legacy SECURITY DEFINER functions were
-- organization-scoped but did not call can_read_risk and did not restrict the
-- human role.  Renaming preserves the one canonical implementation of each
-- calculation/write; the public signature becomes a guarded door in front of
-- it.  The internal functions are executable only by their owner.
-- ---------------------------------------------------------------------------

alter function public.record_risk_analysis(uuid, jsonb)
  rename to record_risk_analysis_authoritative_internal;
revoke all on function public.record_risk_analysis_authoritative_internal(uuid, jsonb)
  from public, anon, authenticated, service_role;

-- One canonical PostgreSQL numeric calculation. Preserve the original
-- expression ordering and classify the unrounded numeric score: even an exact
-- rational browser implementation differs from PostgreSQL division at boundaries.
create or replace function public.calculate_risk_analysis_internal(
  p_kind text,
  p_analysis jsonb,
  c public.risk_criteria_profiles
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_max_likelihood numeric;
  v_peak numeric;
  v_likelihood numeric;
  v_control numeric;
  v_uncertainty numeric;
  v_confidence numeric;
  v_complexity numeric;
  v_connectivity numeric;
  v_exposure numeric;
  v_capacity numeric;
  v_velocity numeric;
  v_days numeric;
  v_time_pressure numeric;
  v_inherent numeric;
  v_controlled numeric;
  v_current numeric;
  v_opportunity numeric;
  v_level text;
  v_action text;
begin
  if jsonb_array_length(c.likelihood_scale)=0 or c.thresholds='{}'::jsonb
     or not (c.scoring_weights ?& array['inherent','exposure','uncertainty','connectivity','velocity','capacity']) then
    return jsonb_build_object('error','criteria must be configured before analysis; adoption is required before evaluation');
  end if;
  if coalesce(p_analysis->>'analysis_level','') not in ('qualitative','semi_quantitative','quantitative')
     or coalesce(btrim(p_analysis->>'analysis_method'),'')='' then
    return jsonb_build_object('error','analysis level and method are required');
  end if;
  if jsonb_typeof(coalesce(p_analysis->'consequences','{}'::jsonb))<>'object'
     or p_analysis->'consequences'='{}'::jsonb then
    return jsonb_build_object('error','consequence scores by dimension are required');
  end if;
  select max(case when jsonb_typeof(x)='number' then (x#>>'{}')::numeric
    else nullif(x->>'score','')::numeric end)
  into v_max_likelihood from jsonb_array_elements(c.likelihood_scale) x;
  select max(value::numeric) into v_peak
  from jsonb_each_text(p_analysis->'consequences');
  v_likelihood:=nullif(p_analysis->>'likelihood','')::numeric;
  v_control:=nullif(p_analysis->>'control_effectiveness','')::numeric;
  v_uncertainty:=nullif(p_analysis->>'uncertainty','')::numeric;
  v_confidence:=nullif(p_analysis->>'confidence','')::numeric;
  v_complexity:=nullif(p_analysis->>'complexity','')::numeric;
  v_connectivity:=nullif(p_analysis->>'connectivity','')::numeric;
  v_exposure:=nullif(p_analysis->>'exposure','')::numeric;
  v_capacity:=nullif(p_analysis->>'capacity_load','')::numeric;
  v_velocity:=nullif(p_analysis->>'velocity','')::numeric;
  v_days:=nullif(p_analysis->>'time_to_unacceptable_days','')::numeric;
  if v_likelihood is null or v_peak is null or v_control is null or v_uncertainty is null
     or v_confidence is null or v_complexity is null or v_connectivity is null
     or v_exposure is null or v_capacity is null or v_velocity is null then
    return jsonb_build_object('error','likelihood, control effectiveness, uncertainty, confidence, complexity, connectivity, exposure, capacity and velocity are required');
  end if;
  if v_max_likelihood is null or v_max_likelihood<=0 then
    return jsonb_build_object('error','likelihood scale has no numeric maximum');
  end if;
  v_time_pressure:=case when v_days is null then 0 when v_days<=0 then 100
    else greatest(0,100*(1-least(v_days,365)/365)) end;
  v_inherent:=least(100,greatest(0,100*(v_likelihood/v_max_likelihood)*(v_peak/5)));
  v_controlled:=v_inherent*(1-least(100,greatest(0,v_control))/100);
  v_current:=least(100,greatest(0,
    v_controlled*coalesce((c.scoring_weights->>'inherent')::numeric,0)+
    v_exposure*coalesce((c.scoring_weights->>'exposure')::numeric,0)+
    v_uncertainty*coalesce((c.scoring_weights->>'uncertainty')::numeric,0)+
    ((v_complexity+v_connectivity)/2)*coalesce((c.scoring_weights->>'connectivity')::numeric,0)+
    greatest(0,v_velocity)*coalesce((c.scoring_weights->>'velocity')::numeric,0)+
    v_capacity*coalesce((c.scoring_weights->>'capacity')::numeric,0)+
    v_time_pressure*coalesce((c.time_factors->>'weight')::numeric,0)));
  v_opportunity:=case when p_kind='threat' then 0 else
    least(100,greatest(0,coalesce((p_analysis->>'opportunity_value')::numeric,0)
      *v_confidence/100*(0.5+v_exposure/200))) end;
  v_level:=case
    when v_current>=(c.thresholds->>'critical')::numeric then 'Critical'
    when v_current>=(c.thresholds->>'high')::numeric then 'High'
    when v_current>=(c.thresholds->>'medium')::numeric then 'Medium'
    when v_current>=(c.thresholds->>'low')::numeric then 'Low'
    else 'Very Low' end;
  v_action:=case when c.status<>'adopted' then 'INVESTIGATE'
    when v_current>=95 then 'STOP'
    when v_current>=(c.decision_thresholds->>'escalate')::numeric then 'ESCALATE'
    when v_current>=(c.decision_thresholds->>'treat')::numeric then 'TREAT'
    when v_current>=(c.decision_thresholds->>'investigate')::numeric then 'INVESTIGATE'
    when v_current>=(c.decision_thresholds->>'monitor')::numeric then 'MONITOR'
    else 'ACCEPT' end;
  return jsonb_build_object(
    'likelihood', v_likelihood,
    'control', v_control,
    'uncertainty', v_uncertainty,
    'confidence', v_confidence,
    'complexity', v_complexity,
    'connectivity', v_connectivity,
    'exposure', v_exposure,
    'capacity', v_capacity,
    'velocity', v_velocity,
    'days', v_days,
    'time_pressure', v_time_pressure,
    'inherent', v_inherent,
    'controlled', v_controlled,
    'current', v_current,
    'opportunity', v_opportunity,
    'level', v_level, 'recommended_action', v_action
  );
end;
$$;
revoke all on function public.calculate_risk_analysis_internal(text, jsonb, public.risk_criteria_profiles)
  from public, anon, authenticated, service_role;

-- Preserve the canonical writer's contract validation, persistence, audit and
-- response. Only its calculation delegates to the shared private calculator.
create or replace function public.record_risk_analysis_authoritative_internal(p_risk_id uuid, p_analysis jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid:=app_current_org();
  r risks%rowtype;
  c risk_criteria_profiles%rowtype;
  v_max_likelihood numeric;
  v_peak numeric;
  v_likelihood numeric;
  v_control numeric;
  v_uncertainty numeric;
  v_confidence numeric;
  v_complexity numeric;
  v_connectivity numeric;
  v_exposure numeric;
  v_capacity numeric;
  v_velocity numeric;
  v_days numeric;
  v_time_pressure numeric;
  v_inherent numeric;
  v_controlled numeric;
  v_current numeric;
  v_opportunity numeric;
  v_level text;
  v_action text;
  v_gaps text[];
  v_calculation jsonb;
begin
  select * into r from risks where id=p_risk_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  select * into c from risk_criteria_profiles where id=r.criteria_profile_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','criteria profile not found'); end if;
  v_calculation:=public.calculate_risk_analysis_internal(r.kind,p_analysis,c);
  if v_calculation ? 'error' then return v_calculation; end if;
  v_likelihood:=(v_calculation->>'likelihood')::numeric;
  v_control:=(v_calculation->>'control')::numeric;
  v_uncertainty:=(v_calculation->>'uncertainty')::numeric;
  v_confidence:=(v_calculation->>'confidence')::numeric;
  v_complexity:=(v_calculation->>'complexity')::numeric;
  v_connectivity:=(v_calculation->>'connectivity')::numeric;
  v_exposure:=(v_calculation->>'exposure')::numeric;
  v_capacity:=(v_calculation->>'capacity')::numeric;
  v_velocity:=(v_calculation->>'velocity')::numeric;
  v_days:=(v_calculation->>'days')::numeric;
  v_inherent:=(v_calculation->>'inherent')::numeric;
  v_current:=(v_calculation->>'current')::numeric;
  v_opportunity:=(v_calculation->>'opportunity')::numeric;
  v_level:=v_calculation->>'level';
  v_action:=v_calculation->>'recommended_action';
  r.status:='analyzed'; r.analysis_level:=p_analysis->>'analysis_level';
  r.analysis_method:=p_analysis->>'analysis_method'; r.likelihood:=v_likelihood;
  r.consequences:=p_analysis->'consequences'; r.control_effectiveness:=v_control;
  r.uncertainty:=v_uncertainty; r.confidence:=v_confidence; r.complexity:=v_complexity;
  r.connectivity:=v_connectivity; r.exposure:=v_exposure; r.capacity_load:=v_capacity;
  r.risk_velocity:=v_velocity; r.inherent_risk_score:=v_inherent;
  r.current_risk_score:=v_current; r.current_risk_level:=v_level; r.decision_action:=v_action;
  v_gaps:=public.risk_contract_gaps(r);
  if array_length(v_gaps,1)>0 then
    return jsonb_build_object('error','risk contract incomplete','gaps',v_gaps);
  end if;
  update risks set analysis_level=p_analysis->>'analysis_level',analysis_method=p_analysis->>'analysis_method',
    analysis_model_reference=nullif(p_analysis->>'analysis_model_reference',''),
    likelihood=v_likelihood,consequences=p_analysis->'consequences',control_effectiveness=v_control,
    uncertainty=v_uncertainty,confidence=v_confidence,complexity=v_complexity,
    connectivity=v_connectivity,exposure=v_exposure,capacity_load=v_capacity,risk_velocity=v_velocity,
    time_to_unacceptable=case when v_days is null then null else make_interval(days=>round(v_days)::int) end,
    inherent_risk_score=round(v_inherent,1),current_risk_score=round(v_current,1),
    opportunity_score=round(v_opportunity,1),current_risk_level=v_level,decision_action=v_action,
    status='analyzed',updated_at=now() where id=r.id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_analysis',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('risk_id',r.id,'method',p_analysis->>'analysis_method','score',round(v_current,1),
      'level',v_level,'recommended_action',v_action,'criteria_status',c.status));
  return jsonb_build_object('risk_id',r.id,'status','analyzed','inherent_score',round(v_inherent,1),
    'current_score',round(v_current,1),'opportunity_score',round(v_opportunity,1),
    'level',v_level,'recommended_action',v_action,'authoritative',c.status='adopted');
end;
$$;
revoke all on function public.record_risk_analysis_authoritative_internal(uuid, jsonb)
  from public, anon, authenticated, service_role;


create or replace function public.record_risk_analysis(
  p_risk_id uuid,
  p_analysis jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer') then
    return jsonb_build_object('error',
      'recording risk analysis requires an authorized human risk-management role');
  end if;
  if not exists (
    select 1 from public.risks
    where id = p_risk_id and organization_id = v_org
      and public.can_read_risk(p_risk_id)
  ) then
    return jsonb_build_object('error', 'risk not available to this user');
  end if;
  return public.record_risk_analysis_authoritative_internal(p_risk_id, p_analysis);
end;
$$;

comment on function public.record_risk_analysis(uuid, jsonb) is
  'Sensitivity- and human-role-gated door to the canonical multidimensional risk-analysis writer.';
revoke all on function public.record_risk_analysis(uuid, jsonb) from public, anon;
grant execute on function public.record_risk_analysis(uuid, jsonb)
  to authenticated, service_role;

-- A preview uses the same calculator but no write path. It does not freeze
-- criteria or promise that the lifecycle/approval contract permits recording.
-- The writer rechecks current canonical records when the human submits.
create or replace function public.get_risk_analysis_preview(
  p_risk_id uuid,
  p_analysis jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_risk public.risks%rowtype;
  v_criteria public.risk_criteria_profiles%rowtype;
  v_calculation jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into v_risk from public.risks
  where id = p_risk_id and organization_id = v_org
    and public.can_read_risk(id);
  if not found then
    return jsonb_build_object('error', 'risk not available to this user');
  end if;
  select * into v_criteria from public.risk_criteria_profiles
  where id = v_risk.criteria_profile_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'bound criteria profile not found');
  end if;
  v_calculation := public.calculate_risk_analysis_internal(
    v_risk.kind, p_analysis, v_criteria
  );
  if v_calculation ? 'error' then return v_calculation; end if;
  return jsonb_build_object(
    'risk_id', v_risk.id,
    'criteria_id', v_criteria.id,
    'criteria_version', v_criteria.version,
    'criteria_status', v_criteria.status,
    'analysis', p_analysis,
    'generated_at', now(),
    'advisory_only', true,
    'human_decision_required', true,
    'inherent_score', round((v_calculation->>'inherent')::numeric, 1),
    'controlled_score', round((v_calculation->>'controlled')::numeric, 1),
    'current_score', round((v_calculation->>'current')::numeric, 1),
    'opportunity_score', round((v_calculation->>'opportunity')::numeric, 1),
    'time_pressure', round((v_calculation->>'time_pressure')::numeric, 1),
    'level', v_calculation->>'level',
    'recommended_action', v_calculation->>'recommended_action',
    'authoritative', v_criteria.status = 'adopted'
  );
end;
$$;
comment on function public.get_risk_analysis_preview(uuid, jsonb) is
  'Tenant- and sensitivity-filtered read-only advisory projection of the canonical PostgreSQL numeric calculator. Rounded display scores never determine the returned level/action; no recording or approval authority is granted.';
revoke all on function public.get_risk_analysis_preview(uuid, jsonb)
  from public, anon;
grant execute on function public.get_risk_analysis_preview(uuid, jsonb)
  to authenticated, service_role;

alter function public.record_risk_value_of_information(uuid, jsonb)
  rename to record_risk_value_of_information_authoritative_internal;
revoke all on function public.record_risk_value_of_information_authoritative_internal(uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.record_risk_value_of_information(
  p_risk_id uuid,
  p_analysis jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_result jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer') then
    return jsonb_build_object('error',
      'recording value of information requires an authorized human risk-management role');
  end if;
  if not exists (
    select 1 from public.risks
    where id = p_risk_id and organization_id = v_org
      and public.can_read_risk(p_risk_id)
  ) then
    return jsonb_build_object('error', 'risk not available to this user');
  end if;
  v_result := public.record_risk_value_of_information_authoritative_internal(
    p_risk_id,
    p_analysis
  );
  -- Never turn a canonical refusal or an incomplete write response into a
  -- success receipt. The client must reconcile an unknown outcome, not retry
  -- a potentially committed information action.
  if jsonb_typeof(v_result) is distinct from 'object'
     or v_result ? 'error'
     or public.sync_text_as_uuid(v_result->>'evidence_id') is null
     or v_result->'human_decision_required' is distinct from 'true'::jsonb then
    return v_result;
  end if;
  return v_result || jsonb_build_object(
    'risk_id', p_risk_id,
    'advisory_only', true
  );
end;
$$;

comment on function public.record_risk_value_of_information(uuid, jsonb) is
  'Sensitivity- and human-role-gated door to the canonical value-of-information writer.';
revoke all on function public.record_risk_value_of_information(uuid, jsonb)
  from public, anon;
grant execute on function public.record_risk_value_of_information(uuid, jsonb)
  to authenticated, service_role;

alter function public.create_risk_treatment(uuid, jsonb, boolean)
  rename to create_risk_treatment_authoritative_internal;
revoke all on function public.create_risk_treatment_authoritative_internal(uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;

-- Re-create the single private canonical treatment writer from 20261122090500.
-- The only behavioral delta is explicit inheritance of parent sensitivity on
-- newly created secondary risks. Ancestor visibility above also protects legacy
-- internal children and later parent reclassification; no historical rows or
-- immutable audit receipts are rewritten.
create or replace function public.create_risk_treatment_authoritative_internal(
  p_risk_id uuid,
  p_option jsonb,
  p_select boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  r risks%rowtype;
  v_scenario uuid;
  v_rec uuid;
  v_approval uuid;
  v_strategy text := p_option->>'strategy';
  v_required jsonb := coalesce(p_option->'required_resources','[]'::jsonb);
  v_available jsonb := coalesce(p_option->'available_resources','[]'::jsonb);
  v_competencies jsonb := coalesce(p_option->'required_competencies','[]'::jsonb);
  v_missing jsonb := '[]'::jsonb;
  v_executable boolean := true;
  v_residual numeric;
  v_introduced numeric;
  v_net numeric;
  item text;
  -- D5.25 (20261122090500, marked insertion): the §15 secondary risks.
  v_new_risks jsonb := coalesce(p_option->'new_risk_created','[]'::jsonb);
  v_new_risk jsonb;
  v_secondary uuid;
  v_secondary_ids jsonb := '[]'::jsonb;
  v_score numeric;
  v_owner uuid;
  v_secondary_max numeric := 0;
  v_secondary_worst text;
begin
  select * into r from risks where id = p_risk_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  if v_strategy not in ('avoid','pursue_opportunity','remove_source','change_likelihood',
    'change_consequence','share','retain') then
    return jsonb_build_object('error','invalid ISO 31000 treatment strategy');
  end if;
  if coalesce(btrim(p_option->>'label'),'') = '' then
    return jsonb_build_object('error','treatment label is required');
  end if;
  v_residual := nullif(p_option->>'residual_risk','')::numeric;
  v_introduced := coalesce(nullif(p_option->>'introduced_risk','')::numeric,0);
  if v_residual is null then return jsonb_build_object('error','expected residual risk is required'); end if;
  if not (p_option ? 'introduced_risks') then
    return jsonb_build_object('error','introduced_risks must be assessed, even when the answer is an empty array');
  end if;

  -- D5.25 (20261122090500, marked insertion): validate every secondary risk
  -- BEFORE anything is written. A treatment whose secondary risk cannot be
  -- rated is refused whole — half a treatment with a missing hazard record
  -- is the failure this row exists to close.
  if jsonb_typeof(v_new_risks) <> 'array' then
    return jsonb_build_object('error',
      'new_risk_created is an array of the risks this treatment creates (spec §15) — one object per risk, each rated');
  end if;
  if jsonb_array_length(v_new_risks) > 0
     and jsonb_array_length(coalesce(p_option->'introduced_risks','[]'::jsonb)) = 0 then
    return jsonb_build_object('error',
      'this treatment states it introduces no risks (introduced_risks is empty) yet names risks it creates — a treatment cannot both introduce nothing and introduce something');
  end if;
  if jsonb_array_length(v_new_risks) > 0 and r.objective_id is null then
    return jsonb_build_object('error',
      'a risk created by treating this risk threatens the same objective this risk threatens, and this risk carries no objective link (a pre-invariant row). Link it first (link_risk_objective) — inventing an objective for the secondary risk would fabricate what it endangers');
  end if;
  for v_new_risk in select * from jsonb_array_elements(v_new_risks) loop
    if coalesce(length(btrim(coalesce(v_new_risk->>'title',''))),0) < 5 then
      return jsonb_build_object('error',
        'each risk this treatment creates carries a title (5 characters minimum) — spec §15 new_risk_created');
    end if;
    if coalesce(length(btrim(coalesce(v_new_risk->>'event_description',''))),0) < 10 then
      return jsonb_build_object('error',
        format('secondary risk "%s" states no event — what actually happens if it occurs (10 characters minimum)', v_new_risk->>'title'));
    end if;
    v_score := nullif(v_new_risk->>'current_risk_score','')::numeric;
    if v_score is null then
      return jsonb_build_object('error',
        format('secondary risk "%s" is unrated (current_risk_score). An unrated risk created by a treatment cannot be compared with the risk the treatment reduces, which leaves net_risk_change standing on nothing', v_new_risk->>'title'));
    end if;
    if v_score = 'NaN'::numeric or v_score < 0 or v_score > 100 then
      return jsonb_build_object('error',
        format('secondary risk "%s" carries a non-finite or out-of-range score — a rating must be a finite number between 0 and 100', v_new_risk->>'title'));
    end if;
    if coalesce(v_new_risk->>'current_risk_level','') not in
       ('Very Low','Low','Medium','High','Critical') then
      return jsonb_build_object('error',
        format('secondary risk "%s" states no risk level (Very Low, Low, Medium, High, Critical)', v_new_risk->>'title'));
    end if;
    v_owner := coalesce(nullif(v_new_risk->>'risk_owner_id','')::uuid,
                        nullif(p_option->>'treatment_owner_id','')::uuid,
                        r.risk_owner_id);
    if v_owner is null or not exists (
      select 1 from user_profiles where id = v_owner and organization_id = v_org) then
      return jsonb_build_object('error',
        format('secondary risk "%s" has no owner in this organization — a hazard the treatment creates and nobody owns is the exact failure spec §15 names', v_new_risk->>'title'));
    end if;
    if v_score > v_secondary_max then
      v_secondary_max := v_score;
      v_secondary_worst := btrim(v_new_risk->>'title');
    end if;
  end loop;

  -- D5.25 (20261122090500, marked insertion): THE RATED SECONDARY RISKS ENTER
  -- THE ARITHMETIC.
  --
  -- This row demands a rating on every risk a treatment creates, and states
  -- why: "an unrated secondary risk leaves net_risk_change standing on
  -- nothing". The first draft collected the ratings, wrote them onto real
  -- risks rows — and then computed net_risk_change from the caller's free
  -- text `introduced_risk` scalar, cross-checking nothing. A treatment could
  -- be recorded as a 60-point improvement in the same transaction that
  -- created a Critical 95-point hazard. The rating was demanded and ignored.
  --
  -- The floor is the GREATEST secondary score, not the sum: two hazards of 60
  -- and 95 are not a 155-point exposure, but the treatment introduces at
  -- least the worst of them. Refused rather than silently floored, because
  -- overwriting the caller's stated number would replace one invented
  -- quantity with another.
  if v_secondary_max > 0 and v_introduced < v_secondary_max then
    return jsonb_build_object('error',
      format('this treatment states it introduces %s of risk while creating "%s", rated %s — introduced_risk must be at least the greatest secondary-risk score, or expected_risk_reduction claims an improvement the treatment''s own new hazards contradict (spec §15)',
             v_introduced, v_secondary_worst, v_secondary_max));
  end if;

  for item in select jsonb_array_elements_text(v_required) loop
    if not (v_available ? item) then
      v_missing := v_missing || jsonb_build_array('resource: ' || item);
      v_executable := false;
    end if;
  end loop;
  -- Competency requirements name the canonical competency key. At least one
  -- active workforce member must hold each key; identity is not guessed.
  for item in select jsonb_array_elements_text(v_competencies) loop
    if not exists (
      select 1 from competencies c
      join member_competencies mc on mc.competency_id = c.id
      join workforce_members wm on wm.id = mc.member_id and wm.active
      where c.organization_id = v_org and c.competency_key = item
        and (mc.expires_on is null or mc.expires_on >= current_date)
    ) then
      v_missing := v_missing || jsonb_build_array('competency: ' || item);
      v_executable := false;
    end if;
  end loop;
  v_net := coalesce(r.current_risk_score,0) - v_residual - v_introduced;

  insert into scenarios (
    organization_id, risk_id, asset_id, key, label, cost, downtime_impact,
    production_impact, safety_risk, environmental_risk, financial_exposure,
    mission_readiness_impact, recommended, treatment_strategy,
    expected_residual_risk, introduced_risks, expected_risk_reduction,
    confidence, required_resources, available_resources,
    required_competencies, executable, readiness_gaps, asset_life_impact,
    objective_tradeoffs
  ) values (
    v_org,r.id,r.asset_id,coalesce(p_option->>'key',v_strategy),btrim(p_option->>'label'),
    coalesce((p_option->>'cost')::numeric,0),p_option->>'downtime_impact',
    p_option->>'production_impact',p_option->>'safety_risk',p_option->>'environmental_risk',
    p_option->>'financial_exposure',p_option->>'mission_readiness_impact',p_select,
    v_strategy,v_residual,coalesce(p_option->'introduced_risks','[]'::jsonb),v_net,
    nullif(p_option->>'confidence','')::numeric,v_required,v_available,
    v_competencies,v_executable,v_missing,p_option->>'asset_life_impact',
    coalesce(p_option->'objective_tradeoffs','{}'::jsonb)
  ) returning id into v_scenario;

  -- D5.25 (20261122090500, marked insertion): the secondary risks become
  -- REAL risks, in this transaction, linked both ways, each audited. They
  -- inherit the parent's objective (header ruling), context, criteria
  -- profile, site and asset — the same exposure, arrived at differently.
  for v_new_risk in select * from jsonb_array_elements(v_new_risks) loop
    v_owner := coalesce(nullif(v_new_risk->>'risk_owner_id','')::uuid,
                        nullif(p_option->>'treatment_owner_id','')::uuid,
                        r.risk_owner_id);
    insert into risks (
      organization_id, context_id, criteria_profile_id, site_id, asset_id,
      objective_id, development_case_id, title, kind, objective_at_risk,
      risk_source, event_description, current_risk_score, current_risk_level,
      risk_owner_id, status, source_kind, created_by,
      secondary_to_risk_id, arising_from_scenario_id, information_sensitivity
    ) values (
      v_org, r.context_id, r.criteria_profile_id, r.site_id, r.asset_id,
      r.objective_id, r.development_case_id, btrim(v_new_risk->>'title'),
      'threat', r.objective_at_risk,
      format('Secondary risk created by the "%s" treatment of risk "%s"',
             btrim(p_option->>'label'), r.title),
      btrim(v_new_risk->>'event_description'),
      nullif(v_new_risk->>'current_risk_score','')::numeric,
      -- BORN 'draft', deliberately (header ruling): the platform's own risk
      -- lifecycle contract requires a full scoping record before a risk may
      -- stand at 'identified', and this file will neither fabricate those
      -- fields nor let the missing scope refuse the treatment. The secondary
      -- risk is real, rated and owned from the moment it exists; promoting it
      -- through the lifecycle is the owner's act, on the same terms as every
      -- other risk.
      v_new_risk->>'current_risk_level', v_owner, 'draft', 'human', auth.uid(),
      r.id, v_scenario, r.information_sensitivity
    ) returning id into v_secondary;

    v_secondary_ids := v_secondary_ids || jsonb_build_array(jsonb_build_object(
      'risk_id', v_secondary, 'title', btrim(v_new_risk->>'title'),
      'level', v_new_risk->>'current_risk_level',
      'score', nullif(v_new_risk->>'current_risk_score','')::numeric));

    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (v_org,'risk_secondary_created',
      coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
      jsonb_build_object('risk_id', v_secondary, 'parent_risk_id', r.id,
        'scenario_id', v_scenario, 'treatment_strategy', v_strategy,
        'title', btrim(v_new_risk->>'title'),
        'level', v_new_risk->>'current_risk_level'),
      null,
      jsonb_build_object('status','draft','secondary_to_risk_id', r.id,
        'arising_from_scenario_id', v_scenario,
        'current_risk_level', v_new_risk->>'current_risk_level'));
  end loop;

  if p_select then
    if not v_executable then
      return jsonb_build_object('scenario_id',v_scenario,'selected',false,
        'error','treatment is not executable','readiness_gaps',v_missing);
    end if;
    if coalesce(length(btrim(p_option->>'rationale')),0) < 20
       or coalesce(btrim(p_option->>'consequence_summary'),'') = ''
       or coalesce(btrim(p_option->>'alternatives_considered'),'') = ''
       or nullif(p_option->>'required_completion_date','') is null
       or coalesce(btrim(p_option->>'required_approver_role'),'') = ''
       or coalesce(btrim(p_option->>'verification_method'),'') = ''
       or nullif(p_option->>'treatment_owner_id','') is null
       or not exists(select 1 from user_profiles where
         id=(p_option->>'treatment_owner_id')::uuid and organization_id=v_org) then
      return jsonb_build_object('scenario_id',v_scenario,'selected',false,
        'error','selected treatment lacks the canonical recommendation contract or named treatment owner');
    end if;
    insert into recommendations (
      organization_id, risk_id, asset_id, title, issue, action, impact,
      confidence, urgency, status, approval_required, accountable, responsible,
      consulted, informed, financial_impact, risk_impact, rationale,
      consequence_summary, alternatives_considered, required_completion_date,
      required_approver_role, verification_method, estimated_cost_usd,
      treatment_strategy, treatment_owner_id, original_risk_score,
      expected_residual_risk_score, target_risk_score, new_risks_introduced,
      net_risk_change, resource_readiness, raised_by
    ) values (
      v_org,r.id,r.asset_id,btrim(p_option->>'label'),r.event_description,
      coalesce(p_option->>'action',p_option->>'label'),p_option->>'impact',
      coalesce((p_option->>'confidence')::int,round(coalesce(r.confidence,0))::int),
      case when r.current_risk_level in ('Critical','High') then 'critical' else 'action' end,
      'pending',p_option->>'required_approver_role',
      coalesce((select full_name from user_profiles where id=r.risk_owner_id),'Named risk owner'),
      coalesce((select full_name from user_profiles where id=(p_option->>'treatment_owner_id')::uuid),'Named treatment owner'),
      array_to_string(array(select jsonb_array_elements_text(r.stakeholders)),', '),
      p_option->>'informed',p_option->>'financial_exposure',coalesce(r.current_risk_level,'Medium'),
      btrim(p_option->>'rationale'),btrim(p_option->>'consequence_summary'),
      btrim(p_option->>'alternatives_considered'),(p_option->>'required_completion_date')::date,
      p_option->>'required_approver_role',p_option->>'verification_method',
      coalesce((p_option->>'cost')::numeric,0),v_strategy,
      (p_option->>'treatment_owner_id')::uuid,r.current_risk_score,v_residual,
      coalesce(nullif(p_option->>'target_risk','')::numeric,r.target_risk_score),
      coalesce(p_option->'introduced_risks','[]'::jsonb),v_net,
      jsonb_build_object('executable',v_executable,'gaps',v_missing),auth.uid()
    ) returning id into v_rec;
    insert into approvals (
      organization_id,risk_id,recommendation_id,status,owner_role,reason,
      consequence_of_wrong,required_validation
    ) values (
      v_org,r.id,v_rec,'required',p_option->>'required_approver_role',
      'Human approval required before risk treatment becomes executable work.',
      p_option->>'consequence_summary',p_option->>'verification_method'
    ) returning id into v_approval;
    update risks set status = 'treatment_active',updated_at=now() where id=r.id;
  end if;
  insert into audit_events (organization_id,entity_type,actor,event_data)
  values (v_org,'risk_treatment',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('risk_id',r.id,'scenario_id',v_scenario,'selected',p_select,
      'recommendation_id',v_rec,'approval_id',v_approval,'executable',v_executable,
      -- D5.25 (20261122090500, marked insertion).
      'secondary_risks',v_secondary_ids));
  return jsonb_build_object('scenario_id',v_scenario,'selected',p_select,
    'executable',v_executable,'readiness_gaps',v_missing,
    'recommendation_id',v_rec,'approval_id',v_approval,'net_risk_change',v_net,
    'human_approval_required',p_select,
    -- D5.25 (20261122090500, marked insertion).
    'secondary_risks',v_secondary_ids);
end;
$$;
revoke all on function public.create_risk_treatment_authoritative_internal(uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.create_risk_treatment(
  p_risk_id uuid,
  p_option jsonb,
  p_select boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_required jsonb := coalesce(p_option->'required_competencies', '[]'::jsonb);
  v_competency_gaps jsonb := '[]'::jsonb;
  v_result jsonb;
  v_scenario_id uuid;
  v_previous_executable boolean;
  v_previous_gaps jsonb;
  v_corrected_gaps jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer') then
    return jsonb_build_object('error',
      'recording risk treatment requires an authorized human risk-management role');
  end if;
  if not exists (
    select 1 from public.risks
    where id = p_risk_id and organization_id = v_org
      and public.can_read_risk(p_risk_id)
  ) then
    return jsonb_build_object('error', 'risk not available to this user');
  end if;
  if jsonb_typeof(v_required) <> 'array' then
    return jsonb_build_object('error', 'required_competencies must be an array');
  end if;

  -- The canonical writer already refuses absent and expired holdings.  This
  -- query isolates the only false-positive it admitted: an active person's
  -- unexpired qualification whose grant date is still in the future.
  select coalesce(
    jsonb_agg('competency: ' || required.competency_key order by required.competency_key),
    '[]'::jsonb
  )
  into v_competency_gaps
  from (
    select distinct requirement.competency_key
    from jsonb_array_elements_text(v_required) requirement(competency_key)
    where exists (
      select 1
      from public.competencies c
      join public.member_competencies mc
        on mc.competency_id = c.id
       and mc.organization_id = v_org
      join public.workforce_members wm
        on wm.id = mc.member_id
       and wm.organization_id = v_org
       and wm.active
      where c.organization_id = v_org
        and c.competency_key = requirement.competency_key
        and mc.granted_on > current_date
        and (mc.expires_on is null or mc.expires_on >= current_date)
    )
    and not exists (
      select 1
      from public.competencies c
      join public.member_competencies mc
        on mc.competency_id = c.id
       and mc.organization_id = v_org
      join public.workforce_members wm
        on wm.id = mc.member_id
       and wm.organization_id = v_org
       and wm.active
      where c.organization_id = v_org
        and c.competency_key = requirement.competency_key
        and mc.granted_on <= current_date
        and (mc.expires_on is null or mc.expires_on >= current_date)
    )
  ) required;

  if p_select and jsonb_array_length(v_competency_gaps) > 0 then
    return jsonb_build_object(
      'selected', false,
      'error', 'treatment is not executable',
      'readiness_gaps', v_competency_gaps
    );
  end if;

  v_result := public.create_risk_treatment_authoritative_internal(
    p_risk_id,
    p_option,
    p_select
  );

  -- Non-selected options are valid evidence even when not executable.  Make
  -- the persisted scenario and returned contract agree with the current-date
  -- competency rule the preview applies.
  if jsonb_array_length(v_competency_gaps) > 0 then
    v_scenario_id := public.sync_text_as_uuid(v_result->>'scenario_id');
    if v_scenario_id is not null then
      -- Snapshot the actual canonical row under its write lock. The legacy
      -- writer may already have refused execution because of resource gaps.
      select executable, coalesce(readiness_gaps, '[]'::jsonb)
      into v_previous_executable, v_previous_gaps
      from public.scenarios
      where id = v_scenario_id and organization_id = v_org
        and risk_id = p_risk_id
      for update;
      if not found or jsonb_typeof(v_previous_gaps) is distinct from 'array' then
        -- An impossible internal receipt is not a success; raising also rolls
        -- back the canonical writer's changes in this transaction.
        raise exception 'canonical treatment readiness receipt could not be reconciled';
      end if;
      v_corrected_gaps := v_previous_gaps || v_competency_gaps;
      update public.scenarios
      set executable = false,
          readiness_gaps = v_corrected_gaps
      where id = v_scenario_id and organization_id = v_org
        and risk_id = p_risk_id;

      insert into public.audit_events (
        organization_id,
        entity_type,
        actor,
        event_data,
        previous_state,
        new_state
      ) values (
        v_org,
        'risk_treatment_readiness_correction',
        v_role,
        jsonb_build_object(
          'risk_id', p_risk_id,
          'scenario_id', v_scenario_id,
          'reason', 'future-dated competency holdings are not current'
        ),
        jsonb_build_object('executable', v_previous_executable,
          'readiness_gaps', v_previous_gaps),
        jsonb_build_object('executable', false,
          'readiness_gaps', v_corrected_gaps)
      );

      v_result := v_result
        || jsonb_build_object(
          'executable', false,
          'readiness_gaps', v_corrected_gaps
        );
    end if;
  end if;

  -- Bind only a successful canonical response to its persisted scenario.
  -- A selected-option refusal may already have created a comparison scenario;
  -- preserve that partial receipt rather than relabeling it noncommitting.
  if jsonb_typeof(v_result) = 'object' and not (v_result ? 'error') then
    v_scenario_id := public.sync_text_as_uuid(v_result->>'scenario_id');
    if v_scenario_id is null or not exists (
      select 1 from public.scenarios
      where id = v_scenario_id and organization_id = v_org and risk_id = p_risk_id
    ) then
      raise exception 'canonical treatment receipt could not be reconciled';
    end if;
    return v_result || jsonb_build_object(
      'risk_id', p_risk_id,
      'advisory_only', true,
      'human_decision_required', true
    );
  end if;
  return v_result;
end;
$$;

comment on function public.create_risk_treatment(uuid, jsonb, boolean) is
  'Sensitivity- and human-role-gated door to the canonical treatment writer; future-dated qualifications never satisfy readiness.';
revoke all on function public.create_risk_treatment(uuid, jsonb, boolean)
  from public, anon;
grant execute on function public.create_risk_treatment(uuid, jsonb, boolean)
  to authenticated, service_role;

-- The canonical ledger remains append-only. Its existing tenant policy is
-- necessary but insufficient for payloads bearing restricted risk details.
-- A restrictive policy adds sensitivity filtering without replacing or
-- weakening any tenant policy. Malformed/missing risk identities fail closed.
-- Secondary-risk receipts also name their parent, which may be restricted.
drop policy if exists risk_decision_audit_sensitivity on public.audit_events;
create policy risk_decision_audit_sensitivity on public.audit_events
as restrictive
for select to authenticated
using (
  entity_type not in (
    'risk_analysis', 'risk_value_of_information', 'risk_treatment',
    'risk_treatment_readiness_correction', 'risk_secondary_created'
  )
  or (
    organization_id = public.app_current_org()
    and public.can_read_risk(public.sync_text_as_uuid(event_data->>'risk_id'))
    and (
      entity_type <> 'risk_secondary_created'
      or public.can_read_risk(public.sync_text_as_uuid(event_data->>'parent_risk_id'))
    )
  )
);

notify pgrst, 'reload schema';
