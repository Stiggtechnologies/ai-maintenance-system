-- E11.01/E11.02/E11.04/E11.12 — make the existing enterprise-resilience
-- model customer-operable without creating a second scenario, cascade or
-- command engine.
--
-- Canonical reuse:
--   * threat_scenarios + scenario_exposure remain the scenario register;
--   * assets/sites/suppliers/continuity_procedures remain referenced nouns;
--   * evidence_items and audit_events carry provenance;
--   * get_dependency_graph + src/lib/resilience remain the cascade engine;
--   * recovery_operating_commands remains the ONLY execution-state authority.
--
-- The four operating_mode_definitions rows are policy/configuration. They do
-- not declare a mode. Actual transitions still require the independent human
-- authorization in review_recovery_operating_mode().

alter table public.threat_scenarios
  drop constraint if exists threat_scenarios_threat_kind_check;
alter table public.threat_scenarios
  add constraint threat_scenarios_threat_kind_check check (threat_kind in (
    'wildfire','smoke','flood','extreme_cold','grid_interruption','cyber_incident',
    'supply_chain','utility_failure','labour_shortage','major_equipment_loss',
    'site_evacuation','emergency_shutdown','communications_failure'
  ));

alter table public.threat_scenarios
  add column if not exists governance_basis text,
  add column if not exists evidence_item_ids uuid[] not null default '{}',
  add column if not exists missing_evidence text[] not null default '{}',
  add column if not exists created_by uuid references auth.users(id) on delete restrict,
  add column if not exists updated_by uuid references auth.users(id) on delete restrict,
  add column if not exists updated_at timestamptz not null default now();

alter table public.scenario_exposure
  add column if not exists evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  add column if not exists confirmed_by uuid references auth.users(id) on delete restrict,
  add column if not exists confirmed_at timestamptz,
  add column if not exists provisional boolean not null default true;

alter table public.operating_mode_definitions
  add column if not exists governance_basis text,
  add column if not exists evidence_item_ids uuid[] not null default '{}',
  add column if not exists missing_evidence text[] not null default '{}',
  add column if not exists created_by uuid references auth.users(id) on delete restrict,
  add column if not exists updated_by uuid references auth.users(id) on delete restrict,
  add column if not exists updated_at timestamptz not null default now();

alter table public.threat_scenarios
  drop constraint if exists threat_scenarios_governed_shape;
alter table public.threat_scenarios
  add constraint threat_scenarios_governed_shape check (
    created_by is null or (
      length(btrim(coalesce(governance_basis,''))) >= 20
      and cardinality(evidence_item_ids) + cardinality(missing_evidence) > 0
    )
  );

alter table public.scenario_exposure
  drop constraint if exists scenario_exposure_confirmation_complete;
alter table public.scenario_exposure
  add constraint scenario_exposure_confirmation_complete check (
    confirmed_by is null or (
      confirmed_at is not null and length(btrim(coalesce(basis,''))) >= 20
      and ((evidence_item_id is not null and provisional=false)
        or (evidence_item_id is null and provisional=true))
    )
  );

alter table public.operating_mode_definitions
  drop constraint if exists operating_mode_definition_governed_shape;
alter table public.operating_mode_definitions
  add constraint operating_mode_definition_governed_shape check (
    created_by is null or (
      length(btrim(coalesce(governance_basis,''))) >= 20
      and cardinality(evidence_item_ids) + cardinality(missing_evidence) > 0
    )
  );

-- RLS is not a service-role boundary. These canonical registers therefore
-- accept mutation only while one of the governed writers below holds the
-- transaction-local marker. The same guard denies TRUNCATE for every role.
create or replace function public.guard_resilience_configuration_write()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='TRUNCATE' then
    raise exception 'resilience configuration history cannot be truncated';
  end if;
  if coalesce(current_setting('app.resilience_configuration_write',true),'')<>'granted' then
    raise exception 'resilience configuration changes require a governed workflow';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists guard_threat_scenario_write on public.threat_scenarios;
create trigger guard_threat_scenario_write
before insert or update or delete on public.threat_scenarios
for each row execute function public.guard_resilience_configuration_write();
drop trigger if exists guard_threat_scenario_truncate on public.threat_scenarios;
create trigger guard_threat_scenario_truncate
before truncate on public.threat_scenarios
for each statement execute function public.guard_resilience_configuration_write();

drop trigger if exists guard_scenario_exposure_write on public.scenario_exposure;
create trigger guard_scenario_exposure_write
before insert or update or delete on public.scenario_exposure
for each row execute function public.guard_resilience_configuration_write();
drop trigger if exists guard_scenario_exposure_truncate on public.scenario_exposure;
create trigger guard_scenario_exposure_truncate
before truncate on public.scenario_exposure
for each statement execute function public.guard_resilience_configuration_write();

drop trigger if exists guard_operating_mode_definition_write on public.operating_mode_definitions;
create trigger guard_operating_mode_definition_write
before insert or update or delete on public.operating_mode_definitions
for each row execute function public.guard_resilience_configuration_write();
drop trigger if exists guard_operating_mode_definition_truncate on public.operating_mode_definitions;
create trigger guard_operating_mode_definition_truncate
before truncate on public.operating_mode_definitions
for each statement execute function public.guard_resilience_configuration_write();

create or replace function public.save_threat_scenario(p_scenario jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text:=public.app_current_role();
  v_id bigint;
  v_key text;
  v_kind text;
  v_site uuid;
  v_continuity bigint;
  v_supplier bigint;
  v_likelihood numeric;
  v_exercised_on date;
  v_exercise_outcome text;
  v_evidence uuid[]:='{}';
  v_missing text[]:='{}';
  v_previous jsonb;
  v_new jsonb;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','a named same-tenant human planning, engineering or accountable authority is required');
  end if;
  if jsonb_typeof(p_scenario) is distinct from 'object' then
    return jsonb_build_object('error','scenario must be a JSON object');
  end if;
  if (p_scenario ? 'evidence_item_ids' and jsonb_typeof(p_scenario->'evidence_item_ids') is distinct from 'array')
    or (p_scenario ? 'missing_evidence' and jsonb_typeof(p_scenario->'missing_evidence') is distinct from 'array') then
    return jsonb_build_object('error','scenario evidence and missing-evidence values must be arrays');
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_scenario->'evidence_item_ids','[]'::jsonb)) x where jsonb_typeof(x)<>'string')
    or exists(select 1 from jsonb_array_elements(coalesce(p_scenario->'missing_evidence','[]'::jsonb)) x where jsonb_typeof(x)<>'string') then
    return jsonb_build_object('error','scenario evidence arrays may contain strings only');
  end if;
  v_key:=btrim(coalesce(p_scenario->>'scenario_key',''));
  v_kind:=btrim(coalesce(p_scenario->>'threat_kind',''));
  v_site:=nullif(p_scenario->>'site_id','')::uuid;
  v_continuity:=nullif(p_scenario->>'linked_continuity_procedure','')::bigint;
  v_supplier:=nullif(p_scenario->>'linked_supplier','')::bigint;
  v_likelihood:=nullif(p_scenario->>'annual_likelihood','')::numeric;
  v_exercised_on:=nullif(p_scenario->>'last_exercised_on','')::date;
  v_exercise_outcome:=nullif(btrim(coalesce(p_scenario->>'exercise_outcome','')),'');
  select coalesce(array_agg(x.value::uuid order by x.ordinality),'{}') into v_evidence
  from jsonb_array_elements_text(coalesce(p_scenario->'evidence_item_ids','[]'::jsonb)) with ordinality x(value,ordinality);
  select coalesce(array_agg(btrim(x.value) order by x.ordinality) filter(where length(btrim(x.value))>0),'{}') into v_missing
  from jsonb_array_elements_text(coalesce(p_scenario->'missing_evidence','[]'::jsonb)) with ordinality x(value,ordinality);
  if v_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$' then
    return jsonb_build_object('error','scenario key must contain 3–80 safe identifier characters');
  end if;
  if coalesce(length(btrim(p_scenario->>'title')),0)<5
    or coalesce(length(btrim(p_scenario->>'description')),0)<10
    or coalesce(length(btrim(p_scenario->>'governance_basis')),0)<20
    or length(btrim(p_scenario->>'title'))>200
    or length(btrim(p_scenario->>'description'))>4000
    or length(btrim(p_scenario->>'governance_basis'))>4000
    or length(btrim(coalesce(p_scenario->>'plan_reference','')))>500 then
    return jsonb_build_object('error','title, description, plan reference and governance basis must be substantive and within their recorded limits');
  end if;
  if v_kind not in (
    'wildfire','smoke','flood','extreme_cold','grid_interruption','cyber_incident',
    'supply_chain','utility_failure','labour_shortage','major_equipment_loss',
    'site_evacuation','emergency_shutdown','communications_failure'
  ) then return jsonb_build_object('error','unsupported enterprise threat kind'); end if;
  if v_likelihood is not null and (v_likelihood<=0 or v_likelihood>1) then
    return jsonb_build_object('error','annual likelihood must be greater than zero and no more than one');
  end if;
  if (v_exercised_on is null) is distinct from (v_exercise_outcome is null) then
    return jsonb_build_object('error','exercise date and outcome must be recorded together');
  end if;
  if cardinality(v_evidence)=0 and cardinality(v_missing)=0 then
    return jsonb_build_object('error','cite canonical evidence or explicitly name missing evidence');
  end if;
  if v_likelihood is not null and cardinality(v_evidence)=0 then
    return jsonb_build_object('error','quantitative annual likelihood requires at least one verified canonical evidence item');
  end if;
  if cardinality(v_evidence)>100 or cardinality(v_missing)>50
    or exists(select 1 from unnest(v_missing) x(item) where length(x.item)<5 or length(x.item)>500) then
    return jsonb_build_object('error','scenario evidence is limited to 100 citations and 50 substantive missing-evidence statements');
  end if;
  if cardinality(v_evidence)<>cardinality(array(select distinct x.id from unnest(v_evidence) x(id)))
    or exists(select 1 from unnest(v_evidence) x(id)
      left join public.evidence_items e on e.id=x.id and e.organization_id=v_org
        and e.verification_status='verified' and e.verified_by is not null
      where e.id is null) then
    return jsonb_build_object('error','scenario evidence must be unique, same-tenant and verified by a named human');
  end if;
  if v_site is not null and not exists(select 1 from public.sites where id=v_site and organization_id=v_org) then
    return jsonb_build_object('error','site not found in this organization');
  end if;
  if v_continuity is not null and not exists(select 1 from public.continuity_procedures where id=v_continuity and organization_id=v_org) then
    return jsonb_build_object('error','continuity procedure not found in this organization');
  end if;
  if v_supplier is not null and not exists(select 1 from public.suppliers where id=v_supplier and organization_id=v_org) then
    return jsonb_build_object('error','supplier not found in this organization');
  end if;

  select to_jsonb(t) into v_previous from public.threat_scenarios t
  where t.organization_id=v_org and t.scenario_key=v_key for update;

  perform set_config('app.resilience_configuration_write','granted',true);
  insert into public.threat_scenarios(
    organization_id,site_id,scenario_key,title,threat_kind,description,
    annual_likelihood,plan_reference,last_exercised_on,exercise_outcome,
    linked_continuity_procedure,linked_supplier,governance_basis,
    evidence_item_ids,missing_evidence,created_by,updated_by,updated_at
  ) values(
    v_org,v_site,v_key,btrim(p_scenario->>'title'),v_kind,btrim(p_scenario->>'description'),
    v_likelihood,nullif(btrim(coalesce(p_scenario->>'plan_reference','')),''),
    v_exercised_on,v_exercise_outcome,v_continuity,v_supplier,
    btrim(p_scenario->>'governance_basis'),v_evidence,v_missing,auth.uid(),auth.uid(),now()
  ) on conflict(organization_id,scenario_key) do update set
    site_id=excluded.site_id,title=excluded.title,threat_kind=excluded.threat_kind,
    description=excluded.description,annual_likelihood=excluded.annual_likelihood,
    plan_reference=excluded.plan_reference,last_exercised_on=excluded.last_exercised_on,
    exercise_outcome=excluded.exercise_outcome,
    linked_continuity_procedure=excluded.linked_continuity_procedure,
    linked_supplier=excluded.linked_supplier,governance_basis=excluded.governance_basis,
    evidence_item_ids=excluded.evidence_item_ids,missing_evidence=excluded.missing_evidence,
    created_by=coalesce(public.threat_scenarios.created_by,excluded.created_by),
    updated_by=excluded.updated_by,updated_at=now()
  returning id into v_id;

  select to_jsonb(t) into v_new from public.threat_scenarios t
  where t.id=v_id and t.organization_id=v_org;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'resilience_threat_scenario',v_role,jsonb_build_object(
    'scenario_id',v_id,'scenario_key',v_key,'threat_kind',v_kind,'action','saved',
    'evidence_count',cardinality(v_evidence),'missing_evidence_count',cardinality(v_missing)
  ),v_previous,v_new);
  return jsonb_build_object('scenario_id',v_id,'scenario_key',v_key,'status','saved',
    'authority_boundary','Scenario planning only; no emergency declaration, dispatch, isolation, work release or return-to-service action occurred.');
exception
  when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow or check_violation then
    return jsonb_build_object('error','scenario contains an invalid identifier, date, number or controlled value');
end $$;

create or replace function public.replace_scenario_exposure(
  p_scenario_id bigint,
  p_asset_ids uuid[],
  p_basis text,
  p_evidence_item_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text:=public.app_current_role();
  v_assets uuid[]:=coalesce(p_asset_ids,'{}');
  v_count integer;
  v_has_missing boolean:=false;
  v_provisional boolean;
  v_previous jsonb;
  v_new jsonb;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','a named same-tenant human must confirm scenario exposure');
  end if;
  if coalesce(length(btrim(p_basis)),0)<20 or length(btrim(p_basis))>4000 then
    return jsonb_build_object('error','record a substantive exposure-mapping basis');
  end if;
  select cardinality(missing_evidence)>0 into v_has_missing
  from public.threat_scenarios where id=p_scenario_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','scenario not found in this organization'); end if;
  if cardinality(v_assets)>500 or cardinality(v_assets)<>cardinality(array(select distinct x.id from unnest(v_assets) x(id))) then
    return jsonb_build_object('error','exposure assets must be unique and limited to 500');
  end if;
  if exists(select 1 from unnest(v_assets) x(id)
    left join public.assets a on a.id=x.id and a.organization_id=v_org where a.id is null) then
    return jsonb_build_object('error','every exposed asset must belong to this organization');
  end if;
  if p_evidence_item_id is not null and not exists(select 1 from public.evidence_items
    where id=p_evidence_item_id and organization_id=v_org
      and verification_status='verified' and verified_by is not null) then
    return jsonb_build_object('error','exposure evidence must be same-tenant and verified by a named human');
  end if;
  if p_evidence_item_id is null and not v_has_missing then
    return jsonb_build_object('error','exposure mapping requires verified evidence or an explicit scenario evidence gap');
  end if;
  v_provisional:=p_evidence_item_id is null;
  select jsonb_build_object('mappings',coalesce(jsonb_agg(to_jsonb(e) order by e.asset_id),'[]'::jsonb))
  into v_previous from public.scenario_exposure e
  where e.scenario_id=p_scenario_id and e.organization_id=v_org;
  perform set_config('app.resilience_configuration_write','granted',true);
  delete from public.scenario_exposure where scenario_id=p_scenario_id and organization_id=v_org;
  insert into public.scenario_exposure(
    scenario_id,asset_id,organization_id,basis,evidence_item_id,confirmed_by,confirmed_at,provisional
  ) select p_scenario_id,x.id,v_org,btrim(p_basis),p_evidence_item_id,auth.uid(),now(),v_provisional
    from unnest(v_assets) x(id);
  get diagnostics v_count=row_count;
  select jsonb_build_object('mappings',coalesce(jsonb_agg(to_jsonb(e) order by e.asset_id),'[]'::jsonb))
  into v_new from public.scenario_exposure e
  where e.scenario_id=p_scenario_id and e.organization_id=v_org;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'resilience_scenario_exposure',v_role,jsonb_build_object(
    'scenario_id',p_scenario_id,'action','replaced','asset_count',v_count,
    'evidence_item_id',p_evidence_item_id,'mapping_status',case when v_count=0 then 'not_mapped' when v_provisional then 'provisional' else 'evidence_verified' end
  ),v_previous,v_new);
  return jsonb_build_object('scenario_id',p_scenario_id,'mapped_assets',v_count,'status','saved',
    'mapping_status',case when v_count=0 then 'not_mapped' when v_provisional then 'provisional' else 'evidence_verified' end);
end $$;

create or replace function public.save_operating_mode_definition(p_definition jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text:=public.app_current_role();
  v_id bigint;
  v_mode text;
  v_evidence uuid[]:='{}';
  v_missing text[]:='{}';
  v_previous jsonb;
  v_new jsonb;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','named human resilience-policy authority is required');
  end if;
  if jsonb_typeof(p_definition) is distinct from 'object' then
    return jsonb_build_object('error','mode definition must be a JSON object');
  end if;
  if (p_definition ? 'evidence_item_ids' and jsonb_typeof(p_definition->'evidence_item_ids') is distinct from 'array')
    or (p_definition ? 'missing_evidence' and jsonb_typeof(p_definition->'missing_evidence') is distinct from 'array') then
    return jsonb_build_object('error','mode evidence and missing-evidence values must be arrays');
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_definition->'evidence_item_ids','[]'::jsonb)) x where jsonb_typeof(x)<>'string')
    or exists(select 1 from jsonb_array_elements(coalesce(p_definition->'missing_evidence','[]'::jsonb)) x where jsonb_typeof(x)<>'string') then
    return jsonb_build_object('error','mode evidence arrays may contain strings only');
  end if;
  v_mode:=btrim(coalesce(p_definition->>'mode',''));
  select coalesce(array_agg(x.value::uuid order by x.ordinality),'{}') into v_evidence
  from jsonb_array_elements_text(coalesce(p_definition->'evidence_item_ids','[]'::jsonb)) with ordinality x(value,ordinality);
  select coalesce(array_agg(btrim(x.value) order by x.ordinality) filter(where length(btrim(x.value))>0),'{}') into v_missing
  from jsonb_array_elements_text(coalesce(p_definition->'missing_evidence','[]'::jsonb)) with ordinality x(value,ordinality);
  if v_mode not in ('normal','degraded','emergency','recovery') then
    return jsonb_build_object('error','one of normal, degraded, emergency or recovery is required');
  end if;
  if coalesce(length(btrim(p_definition->>'entry_criteria')),0)<20
    or coalesce(length(btrim(p_definition->>'exit_criteria')),0)<20
    or coalesce(length(btrim(p_definition->>'declared_by_role')),0)<3
    or coalesce(length(btrim(p_definition->>'authority_changes')),0)<20
    or coalesce(length(btrim(p_definition->>'governance_basis')),0)<20
    or length(btrim(p_definition->>'entry_criteria'))>4000
    or length(btrim(p_definition->>'exit_criteria'))>4000
    or length(btrim(p_definition->>'declared_by_role'))>200
    or length(btrim(p_definition->>'authority_changes'))>4000
    or length(btrim(p_definition->>'governance_basis'))>4000 then
    return jsonb_build_object('error','entry/exit criteria, declaring role, authority changes and governance basis must be substantive');
  end if;
  if cardinality(v_evidence)=0 and cardinality(v_missing)=0 then
    return jsonb_build_object('error','cite canonical evidence or explicitly name missing evidence');
  end if;
  if cardinality(v_evidence)>100 or cardinality(v_missing)>50
    or exists(select 1 from unnest(v_missing) x(item) where length(x.item)<5 or length(x.item)>500) then
    return jsonb_build_object('error','mode evidence is limited to 100 citations and 50 substantive missing-evidence statements');
  end if;
  if cardinality(v_evidence)<>cardinality(array(select distinct x.id from unnest(v_evidence) x(id)))
    or exists(select 1 from unnest(v_evidence) x(id)
      left join public.evidence_items e on e.id=x.id and e.organization_id=v_org
        and e.verification_status='verified' and e.verified_by is not null
      where e.id is null) then
    return jsonb_build_object('error','mode evidence must be unique, same-tenant and verified by a named human');
  end if;

  select to_jsonb(m) into v_previous from public.operating_mode_definitions m
  where m.organization_id=v_org and m.mode=v_mode for update;
  perform set_config('app.resilience_configuration_write','granted',true);
  insert into public.operating_mode_definitions(
    organization_id,mode,entry_criteria,exit_criteria,declared_by_role,
    authority_changes,governance_basis,evidence_item_ids,missing_evidence,
    created_by,updated_by,updated_at
  ) values(
    v_org,v_mode,btrim(p_definition->>'entry_criteria'),btrim(p_definition->>'exit_criteria'),
    btrim(p_definition->>'declared_by_role'),btrim(p_definition->>'authority_changes'),
    btrim(p_definition->>'governance_basis'),v_evidence,v_missing,auth.uid(),auth.uid(),now()
  ) on conflict(organization_id,mode) do update set
    entry_criteria=excluded.entry_criteria,exit_criteria=excluded.exit_criteria,
    declared_by_role=excluded.declared_by_role,authority_changes=excluded.authority_changes,
    governance_basis=excluded.governance_basis,evidence_item_ids=excluded.evidence_item_ids,
    missing_evidence=excluded.missing_evidence,
    created_by=coalesce(public.operating_mode_definitions.created_by,excluded.created_by),
    updated_by=excluded.updated_by,updated_at=now()
  returning id into v_id;
  select to_jsonb(m) into v_new from public.operating_mode_definitions m
  where m.id=v_id and m.organization_id=v_org;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'resilience_operating_mode_definition',v_role,jsonb_build_object(
    'definition_id',v_id,'mode',v_mode,'action','saved','execution_state_changed',false
  ),v_previous,v_new);
  return jsonb_build_object('definition_id',v_id,'mode',v_mode,'status','saved',
    'authority_boundary','Policy definition only. Actual operating-mode transitions remain independently authorized in the Recovery command workspace.');
exception when invalid_text_representation then
  return jsonb_build_object('error','mode definition contains an invalid evidence identifier');
end $$;

-- UI-facing transaction boundary. If exposure validation refuses the mapping,
-- the inner exception block rolls the scenario upsert and its audit event back
-- before returning the governed error to the caller.
create or replace function public.save_threat_scenario_with_exposure(
  p_scenario jsonb,
  p_asset_ids uuid[],
  p_exposure_basis text,
  p_exposure_evidence_item_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_scenario jsonb;
  v_exposure jsonb;
begin
  begin
    v_scenario:=public.save_threat_scenario(p_scenario);
    if v_scenario ? 'error' then return v_scenario; end if;
    v_exposure:=public.replace_scenario_exposure(
      (v_scenario->>'scenario_id')::bigint,
      p_asset_ids,
      p_exposure_basis,
      p_exposure_evidence_item_id
    );
    if v_exposure ? 'error' then
      raise exception using errcode='P0001',message=v_exposure->>'error';
    end if;
    return v_scenario || (v_exposure-'scenario_id');
  exception when raise_exception then
    return jsonb_build_object('error',sqlerrm);
  end;
end $$;

create or replace function public.get_resilience_configuration_workspace()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select case when public.app_current_org() is null or auth.uid() is null
    or coalesce(public.app_current_role(),'') not in
      ('planner','reliability_engineer','maintenance_manager','executive','admin')
    then jsonb_build_object('error','forbidden')
  else jsonb_build_object(
    'scenarios',coalesce((select jsonb_agg(
      to_jsonb(t)||jsonb_build_object('asset_ids',coalesce((select jsonb_agg(e.asset_id order by e.asset_id)
        from public.scenario_exposure e where e.scenario_id=t.id),'[]'::jsonb),
        'exposure_evidence_item_id',(select e.evidence_item_id from public.scenario_exposure e
          where e.scenario_id=t.id and e.evidence_item_id is not null order by e.asset_id limit 1),
        'exposure_mapping_status',case
          when not exists(select 1 from public.scenario_exposure e where e.scenario_id=t.id) then 'not_mapped'
          when exists(select 1 from public.scenario_exposure e where e.scenario_id=t.id and e.provisional) then 'provisional'
          else 'evidence_verified' end)
      order by t.scenario_key) from public.threat_scenarios t
      where t.organization_id=public.app_current_org()),'[]'::jsonb),
    'modes',coalesce((select jsonb_agg(to_jsonb(m) order by
      array_position(array['normal','degraded','emergency','recovery'],m.mode))
      from public.operating_mode_definitions m where m.organization_id=public.app_current_org()),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'site_id',a.site_id) order by a.name)
      from public.assets a where a.organization_id=public.app_current_org()),'[]'::jsonb),
    'sites',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name)
      from public.sites s where s.organization_id=public.app_current_org()),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'description',e.description,'verification_status',e.verification_status)
      order by e.created_at desc) from (select * from public.evidence_items where organization_id=public.app_current_org()
      and verification_status='verified' and verified_by is not null
      order by created_at desc limit 200) e),'[]'::jsonb),
    'continuity_procedures',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title) order by c.title)
      from public.continuity_procedures c where c.organization_id=public.app_current_org()),'[]'::jsonb),
    'suppliers',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name)
      from public.suppliers s where s.organization_id=public.app_current_org()),'[]'::jsonb),
    'authority_boundary','Scenario and policy configuration only. Only named-human-verified evidence is selectable. Operating state is read from the independently authorized Recovery command workflow; SyncAI does not infer or autonomously declare a mode.'
  ) end
$$;

-- Replace the old optimistic default. No command record means the mode is
-- unrecorded, not normal. Multiple live scopes may honestly report mixed.
create or replace function public.get_resilience_posture()
returns table (
  scenarios_total bigint,
  threat_kinds_covered bigint,
  scenarios_with_exposure bigint,
  scenarios_never_exercised bigint,
  scenarios_stale_exercise bigint,
  modes_defined bigint,
  modes_fully_specified bigint,
  current_mode text,
  basis text
)
language sql stable security invoker set search_path=public as $$
  with org as (select public.app_current_org() id),
  s as (
    select count(*)::bigint n,count(distinct threat_kind)::bigint kinds,
      count(*) filter(where exists(select 1 from public.scenario_exposure e where e.scenario_id=t.id))::bigint with_exp,
      count(*) filter(where last_exercised_on is null)::bigint never,
      count(*) filter(where last_exercised_on is not null and last_exercised_on<current_date-730)::bigint stale
    from public.threat_scenarios t where t.organization_id=(select id from org)
  ),
  m as (
    select count(*)::bigint n,count(*) filter(where
      nullif(btrim(entry_criteria),'') is not null and nullif(btrim(exit_criteria),'') is not null
      and nullif(btrim(declared_by_role),'') is not null and nullif(btrim(authority_changes),'') is not null
      and created_by is not null
      and cardinality(evidence_item_ids)+cardinality(missing_evidence)>0)::bigint full_n
    from public.operating_mode_definitions where organization_id=(select id from org)
  ),
  command_modes as (
    select distinct case
      when current_mode='normal' then 'normal'
      when current_mode='elevated_risk' then 'degraded'
      when current_mode in ('emergency_response','business_continuity','damage_assessment') then 'emergency'
      else 'recovery' end mode
    from public.recovery_operating_commands where organization_id=(select id from org)
  ),
  cur as (
    select case when count(*)=0 then 'unrecorded' when count(*)=1 then max(mode) else 'mixed' end mode
    from command_modes
  )
  select s.n,s.kinds,s.with_exp,s.never,s.stale,m.n,m.full_n,cur.mode,btrim(
    case when s.n=0 then
      'No threat scenarios are recorded. The register names thirteen — wildfire, smoke, flood, extreme cold, grid, cyber, supply chain, utilities, labour, equipment loss, evacuation, emergency shutdown and communications — and none has been assessed against this asset base.'
    else s.n||' scenario(s) across '||s.kinds||' of the 13 threat kinds. '
      ||case when s.with_exp<s.n then (s.n-s.with_exp)||' have NO assets mapped as exposed, so nothing can be computed for them — a scenario with no exposure mapped is a title. ' else '' end
      ||case when s.never>0 then s.never||' have never been exercised; every plan works on paper, which is exactly why the paper proves nothing. ' else '' end
      ||case when s.stale>0 then s.stale||' were last exercised more than two years ago. ' else '' end end
    ||case when m.n=0 then 'No operating-mode policies are defined. '
      when m.full_n<4 then m.full_n||' of 4 operating-mode policies are fully specified. '
      else 'All four operating-mode policies are fully specified. ' end
    ||case when cur.mode='unrecorded' then 'No governed Recovery command records operating state; SyncAI therefore reports it as unrecorded, not normal.'
      when cur.mode='mixed' then 'Governed Recovery commands currently span more than one operating mode; no false enterprise-wide mode is inferred.'
      else 'Governed Recovery command state maps to the '||cur.mode||' enterprise mode.' end)
  from s,m,cur
$$;

create or replace function public.get_threat_scenarios()
returns jsonb language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'scenarioKey',t.scenario_key,'title',t.title,'threatKind',t.threat_kind,
    'description',t.description,'siteId',t.site_id,'annualLikelihood',t.annual_likelihood,
    'planReference',t.plan_reference,'lastExercisedOn',t.last_exercised_on,
    'exerciseOutcome',t.exercise_outcome,'governanceBasis',t.governance_basis,
    'missingEvidence',t.missing_evidence,
    'exposureStatus',case
      when not exists(select 1 from public.scenario_exposure e where e.scenario_id=t.id) then 'not_mapped'
      when exists(select 1 from public.scenario_exposure e where e.scenario_id=t.id and e.provisional) then 'provisional'
      else 'evidence_verified' end,
    'directlyAffected',coalesce((select jsonb_agg(e.asset_id order by e.asset_id)
      from public.scenario_exposure e where e.scenario_id=t.id),'[]'::jsonb)
  ) order by t.scenario_key),'[]'::jsonb)
  from public.threat_scenarios t where t.organization_id=public.app_current_org()
$$;

create or replace function public.get_operating_modes()
returns jsonb language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'mode',m.mode,'entryCriteria',m.entry_criteria,'exitCriteria',m.exit_criteria,
    'declaredByRole',m.declared_by_role,'authorityChanges',m.authority_changes,
    'governanceStatus',case when m.created_by is not null
      and cardinality(m.evidence_item_ids)+cardinality(m.missing_evidence)>0
      then 'governed' else 'legacy_unverified' end,
    'missingEvidence',m.missing_evidence
  ) order by array_position(array['normal','degraded','emergency','recovery'],m.mode)),'[]'::jsonb)
  from public.operating_mode_definitions m where m.organization_id=public.app_current_org()
$$;

revoke all on function public.save_threat_scenario(jsonb) from public,anon;
revoke all on function public.replace_scenario_exposure(bigint,uuid[],text,uuid) from public,anon;
revoke all on function public.save_operating_mode_definition(jsonb) from public,anon;
revoke all on function public.save_threat_scenario_with_exposure(jsonb,uuid[],text,uuid) from public,anon;
revoke all on function public.get_resilience_configuration_workspace() from public,anon;
revoke all on function public.guard_resilience_configuration_write() from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate on table public.threat_scenarios from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate on table public.scenario_exposure from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate on table public.operating_mode_definitions from public,anon,authenticated,service_role;
grant execute on function public.save_threat_scenario(jsonb) to authenticated;
grant execute on function public.replace_scenario_exposure(bigint,uuid[],text,uuid) to authenticated;
grant execute on function public.save_operating_mode_definition(jsonb) to authenticated;
grant execute on function public.save_threat_scenario_with_exposure(jsonb,uuid[],text,uuid) to authenticated;
grant execute on function public.get_resilience_configuration_workspace() to authenticated;

comment on function public.save_threat_scenario(jsonb) is
  'Named-human, tenant-bound configuration of the canonical enterprise threat scenario; never an emergency declaration.';
comment on function public.save_operating_mode_definition(jsonb) is
  'Named-human policy definition only; execution remains exclusively in the independently authorized Recovery command workflow.';
comment on function public.save_threat_scenario_with_exposure(jsonb,uuid[],text,uuid) is
  'Atomic named-human scenario and exposure writer; rolls back both records when either governed validation refuses the request.';

notify pgrst,'reload schema';
