-- D2.08 / D4.08 / D4.09 — evidence-backed sustainability and climate
-- resilience in concept selection.
--
-- Canonical reuse:
--   * business_case_options remains the ONE economic option identity;
--   * development_cases / business_cases provide case scope;
--   * evidence_items remains the ONE evidence model;
--   * audit_events remains the ONE audit ledger.
--
-- This records and compares engineering observations. It does not score an
-- option, choose a preferred concept, approve investment, or certify that a
-- design is climate resilient.

create table if not exists public.option_sustainability_observations (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  option_id bigint not null references public.business_case_options(id) on delete cascade,
  dimension text not null check (dimension in (
    'capex','opex','safety','reliability','carbon','energy','water','land',
    'waste','social_effect'
  )),
  observation text not null check (length(btrim(observation)) >= 10),
  value numeric,
  unit text,
  basis text not null check (length(btrim(basis)) >= 10),
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  check (value is null or (value > '-Infinity'::numeric and value < 'Infinity'::numeric)),
  check (value is null or coalesce(length(btrim(unit)),0) > 0)
);

create index if not exists idx_option_sustainability_current
  on public.option_sustainability_observations(
    organization_id,option_id,dimension,recorded_at desc,id desc
  );

create table if not exists public.climate_resilience_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  option_id bigint not null references public.business_case_options(id) on delete cascade,
  assessment_ref text not null check (length(btrim(assessment_ref)) >= 3),
  revision int not null check (revision > 0),
  future_conditions_basis text not null check (length(btrim(future_conditions_basis)) >= 20),
  status text not null default 'draft' check (status in ('draft','reviewed','superseded')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  superseded_at timestamptz,
  unique (option_id,revision),
  unique (organization_id,assessment_ref,revision),
  check ((status='draft')=(reviewed_at is null)),
  check (reviewed_at is null or (
    reviewed_by is not null and reviewed_by<>created_by
    and coalesce(length(btrim(review_note)),0)>=20
  )),
  check ((status='superseded')=(superseded_at is not null))
);

create unique index if not exists idx_climate_assessment_one_draft
  on public.climate_resilience_assessments(option_id) where status='draft';
create unique index if not exists idx_climate_assessment_one_reviewed
  on public.climate_resilience_assessments(option_id) where status='reviewed';

create table if not exists public.climate_resilience_hazard_assessments (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null references public.climate_resilience_assessments(id) on delete cascade,
  hazard text not null check (hazard in (
    'extreme_temperature','wildfire','flood','precipitation',
    'water_availability','freeze_thaw','permafrost','storm_severity'
  )),
  future_condition text not null check (length(btrim(future_condition)) >= 10),
  design_response text not null check (length(btrim(design_response)) >= 10),
  residual_gap text not null check (length(btrim(residual_gap)) >= 3),
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  assessed_by uuid not null references auth.users(id) on delete restrict,
  assessed_at timestamptz not null default now(),
  unique (assessment_id,hazard)
);

create index if not exists idx_climate_hazards_org
  on public.climate_resilience_hazard_assessments(organization_id,assessment_id);

-- Cross-tenant links are refused at the table wall for every writer, not only
-- by the product RPC. RLS controls who can see a row; these triggers prove
-- that every referenced parent and evidence row carries the same tenant.
create or replace function public.enforce_option_sustainability_scope()
returns trigger language plpgsql set search_path=public
as $$
begin
  if not exists(select 1 from business_case_options
      where id=new.option_id and organization_id=new.organization_id) then
    raise exception 'option sustainability observation and option must belong to the same organization';
  end if;
  if not exists(select 1 from evidence_items
      where id=new.evidence_item_id and organization_id=new.organization_id) then
    raise exception 'option sustainability observation and evidence must belong to the same organization';
  end if;
  return new;
end $$;
create trigger trg_option_sustainability_scope
before insert or update on public.option_sustainability_observations
for each row execute function public.enforce_option_sustainability_scope();

create or replace function public.enforce_climate_assessment_scope()
returns trigger language plpgsql set search_path=public
as $$
begin
  if not exists(select 1 from business_case_options
      where id=new.option_id and organization_id=new.organization_id) then
    raise exception 'climate assessment and option must belong to the same organization';
  end if;
  if tg_op='UPDATE' and old.status<>new.status
     and coalesce(current_setting('app.climate_review_write',true),'')<>'granted' then
    raise exception 'climate assessment status changes require the governed review function';
  end if;
  if tg_op='UPDATE' and old.status<>'draft'
     and coalesce(current_setting('app.climate_review_write',true),'')<>'granted' then
    raise exception 'reviewed or superseded climate assessments are immutable';
  end if;
  return new;
end $$;
create trigger trg_climate_assessment_scope
before insert or update on public.climate_resilience_assessments
for each row execute function public.enforce_climate_assessment_scope();

create or replace function public.enforce_climate_hazard_scope()
returns trigger language plpgsql set search_path=public
as $$
begin
  if not exists(select 1 from climate_resilience_assessments
      where id=new.assessment_id and organization_id=new.organization_id and status='draft') then
    raise exception 'climate hazard and a draft assessment must belong to the same organization';
  end if;
  if not exists(select 1 from evidence_items
      where id=new.evidence_item_id and organization_id=new.organization_id) then
    raise exception 'climate hazard and evidence must belong to the same organization';
  end if;
  return new;
end $$;
create trigger trg_climate_hazard_scope
before insert or update on public.climate_resilience_hazard_assessments
for each row execute function public.enforce_climate_hazard_scope();

revoke all on function public.enforce_option_sustainability_scope() from public,anon,authenticated;
revoke all on function public.enforce_climate_assessment_scope() from public,anon,authenticated;
revoke all on function public.enforce_climate_hazard_scope() from public,anon,authenticated;

alter table public.option_sustainability_observations enable row level security;
alter table public.climate_resilience_assessments enable row level security;
alter table public.climate_resilience_hazard_assessments enable row level security;

drop policy if exists option_sustainability_read on public.option_sustainability_observations;
create policy option_sustainability_read on public.option_sustainability_observations
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists climate_resilience_assessment_read on public.climate_resilience_assessments;
create policy climate_resilience_assessment_read on public.climate_resilience_assessments
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists climate_resilience_hazard_read on public.climate_resilience_hazard_assessments;
create policy climate_resilience_hazard_read on public.climate_resilience_hazard_assessments
  for select to authenticated using (organization_id=public.app_current_org());
-- No client write policy: every mutation is a tenant- and role-scoped RPC.

create or replace function public.record_option_sustainability_observation(
  p_option_id bigint,p_dimension text,p_observation text,p_value numeric default null,
  p_unit text default null,p_basis text default null,p_evidence_item_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
  v_id bigint; v_case uuid;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from user_profiles where id=v_actor and organization_id=v_org;
  if coalesce(v_role,'') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','recording an option observation requires a planning, engineering or governance role');
  end if;
  select bc.development_case_id into v_case
  from business_case_options o join business_cases bc on bc.id=o.case_id
  where o.id=p_option_id and o.organization_id=v_org and bc.organization_id=v_org;
  if not found or v_case is null then
    return jsonb_build_object('error','option is not bound to a development case in this organization');
  end if;
  if p_dimension not in ('capex','opex','safety','reliability','carbon','energy','water','land','waste','social_effect') then
    return jsonb_build_object('error','dimension must be capex, opex, safety, reliability, carbon, energy, water, land, waste or social_effect; climate_resilience is derived from its eight-hazard assessment');
  end if;
  if coalesce(length(btrim(p_observation)),0)<10 or coalesce(length(btrim(p_basis)),0)<10 then
    return jsonb_build_object('error','the option observation and its basis each require at least 10 characters');
  end if;
  if p_value is not null and (p_value<='-Infinity'::numeric or p_value>='Infinity'::numeric) then
    return jsonb_build_object('error','an option observation value must be finite');
  end if;
  if p_value is not null and coalesce(length(btrim(p_unit)),0)=0 then
    return jsonb_build_object('error','a quantified option observation requires its unit');
  end if;
  if p_evidence_item_id is null or not exists(
    select 1 from evidence_items where id=p_evidence_item_id and organization_id=v_org) then
    return jsonb_build_object('error','option observation evidence is required and must belong to this organization');
  end if;
  insert into option_sustainability_observations(
    organization_id,option_id,dimension,observation,value,unit,basis,evidence_item_id,recorded_by)
  values(v_org,p_option_id,p_dimension,btrim(p_observation),p_value,
    nullif(btrim(coalesce(p_unit,'')),''),btrim(p_basis),p_evidence_item_id,v_actor)
  returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'option_sustainability_observation',coalesce(v_role,'unknown'),jsonb_build_object(
    'id',v_id,'option_id',p_option_id,'development_case_id',v_case,
    'dimension',p_dimension,'evidence_item_id',p_evidence_item_id));
  return jsonb_build_object('id',v_id,'optionId',p_option_id,'dimension',p_dimension);
end $$;
revoke all on function public.record_option_sustainability_observation(bigint,text,text,numeric,text,text,uuid) from public,anon;
grant execute on function public.record_option_sustainability_observation(bigint,text,text,numeric,text,text,uuid) to authenticated;

create or replace function public.create_climate_resilience_assessment(
  p_option_id bigint,p_assessment_ref text,p_future_conditions_basis text
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
  v_id uuid; v_revision int; v_case uuid;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from user_profiles where id=v_actor and organization_id=v_org;
  if coalesce(v_role,'') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','creating a climate resilience assessment requires a planning, engineering or governance role');
  end if;
  select bc.development_case_id into v_case
  from business_case_options o join business_cases bc on bc.id=o.case_id
  where o.id=p_option_id and o.organization_id=v_org and bc.organization_id=v_org;
  if not found or v_case is null then
    return jsonb_build_object('error','option is not bound to a development case in this organization');
  end if;
  if exists(select 1 from climate_resilience_assessments where option_id=p_option_id and status='draft') then
    return jsonb_build_object('error','this option already has a draft climate resilience assessment; complete or supersede it before creating another');
  end if;
  if coalesce(length(btrim(p_assessment_ref)),0)<3 then
    return jsonb_build_object('error','a climate assessment needs a reference (3 characters minimum)');
  end if;
  if coalesce(length(btrim(p_future_conditions_basis)),0)<20 then
    return jsonb_build_object('error','state the source and horizon for the future environmental conditions (20 characters minimum)');
  end if;
  select coalesce(max(revision),0)+1 into v_revision
  from climate_resilience_assessments where option_id=p_option_id;
  insert into climate_resilience_assessments(
    organization_id,option_id,assessment_ref,revision,future_conditions_basis,created_by)
  values(v_org,p_option_id,btrim(p_assessment_ref),v_revision,btrim(p_future_conditions_basis),v_actor)
  returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'climate_resilience_assessment',coalesce(v_role,'unknown'),jsonb_build_object(
    'id',v_id,'action','drafted','option_id',p_option_id,
    'development_case_id',v_case,'revision',v_revision));
  return jsonb_build_object('assessmentId',v_id,'revision',v_revision,'status','draft');
end $$;
revoke all on function public.create_climate_resilience_assessment(bigint,text,text) from public,anon;
grant execute on function public.create_climate_resilience_assessment(bigint,text,text) to authenticated;

create or replace function public.record_climate_resilience_hazard(
  p_assessment_id uuid,p_hazard text,p_future_condition text,p_design_response text,
  p_residual_gap text,p_evidence_item_id uuid
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
  a climate_resilience_assessments%rowtype; v_id bigint;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from user_profiles where id=v_actor and organization_id=v_org;
  if coalesce(v_role,'') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','recording a climate hazard requires a planning, engineering or governance role');
  end if;
  select * into a from climate_resilience_assessments
  where id=p_assessment_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','climate assessment not found in this organization'); end if;
  if a.status<>'draft' then
    return jsonb_build_object('error','a reviewed or superseded climate assessment is immutable; create a new revision');
  end if;
  if p_hazard not in ('extreme_temperature','wildfire','flood','precipitation','water_availability','freeze_thaw','permafrost','storm_severity') then
    return jsonb_build_object('error','hazard must be one of the eight climate-resilience dimensions');
  end if;
  if coalesce(length(btrim(p_future_condition)),0)<10
     or coalesce(length(btrim(p_design_response)),0)<10
     or coalesce(length(btrim(p_residual_gap)),0)<3 then
    return jsonb_build_object('error','future condition, design response and residual gap must all be stated');
  end if;
  if p_evidence_item_id is null or not exists(
    select 1 from evidence_items where id=p_evidence_item_id and organization_id=v_org) then
    return jsonb_build_object('error','climate hazard evidence is required and must belong to this organization');
  end if;
  insert into climate_resilience_hazard_assessments(
    organization_id,assessment_id,hazard,future_condition,design_response,
    residual_gap,evidence_item_id,assessed_by)
  values(v_org,a.id,p_hazard,btrim(p_future_condition),btrim(p_design_response),
    btrim(p_residual_gap),p_evidence_item_id,v_actor)
  on conflict(assessment_id,hazard) do update set
    future_condition=excluded.future_condition,design_response=excluded.design_response,
    residual_gap=excluded.residual_gap,evidence_item_id=excluded.evidence_item_id,
    assessed_by=excluded.assessed_by,assessed_at=now()
  returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'climate_resilience_hazard',coalesce(v_role,'unknown'),jsonb_build_object(
    'id',v_id,'assessment_id',a.id,'option_id',a.option_id,
    'hazard',p_hazard,'evidence_item_id',p_evidence_item_id));
  return jsonb_build_object('id',v_id,'assessmentId',a.id,'hazard',p_hazard);
end $$;
revoke all on function public.record_climate_resilience_hazard(uuid,text,text,text,text,uuid) from public,anon;
grant execute on function public.record_climate_resilience_hazard(uuid,text,text,text,text,uuid) to authenticated;

create or replace function public.review_climate_resilience_assessment(
  p_assessment_id uuid,p_note text
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
  a climate_resilience_assessments%rowtype; v_count int;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from user_profiles where id=v_actor and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','independent climate review requires an engineering or governance reviewer');
  end if;
  select * into a from climate_resilience_assessments
  where id=p_assessment_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','climate assessment not found in this organization'); end if;
  if a.status<>'draft' then return jsonb_build_object('error','only a draft climate assessment can be reviewed'); end if;
  if a.created_by=v_actor then return jsonb_build_object('error','the assessment author cannot perform the independent review'); end if;
  if coalesce(length(btrim(p_note)),0)<20 then
    return jsonb_build_object('error','independent review requires a note of at least 20 characters');
  end if;
  select count(*) into v_count from climate_resilience_hazard_assessments
  where assessment_id=a.id and organization_id=v_org;
  if v_count<>8 then
    return jsonb_build_object('error',format('all eight climate hazards are required before review; %s of 8 are recorded',v_count));
  end if;
  perform set_config('app.climate_review_write','granted',true);
  update climate_resilience_assessments set status='superseded',superseded_at=now()
  where option_id=a.option_id and organization_id=v_org and status='reviewed';
  update climate_resilience_assessments set status='reviewed',reviewed_by=v_actor,
    reviewed_at=now(),review_note=btrim(p_note) where id=a.id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'climate_resilience_assessment',coalesce(v_role,'unknown'),jsonb_build_object(
    'id',a.id,'action','independently_reviewed','option_id',a.option_id,
    'hazards',v_count,'review_is_not_approval',true));
  return jsonb_build_object('assessmentId',a.id,'status','reviewed','hazards',v_count,
    'decisionBoundary','Independent review confirms recorded completeness; it does not certify resilience, approve investment or select an option.');
end $$;
revoke all on function public.review_climate_resilience_assessment(uuid,text) from public,anon;
grant execute on function public.review_climate_resilience_assessment(uuid,text) to authenticated;

create or replace function public.get_case_option_comparison(p_case_id uuid)
returns jsonb language sql stable security invoker set search_path=public
as $$
with case_row as (
  select c.id from development_cases c
  where c.id=p_case_id and c.organization_id=app_current_org()
), options as (
  select o.* from business_case_options o join business_cases bc on bc.id=o.case_id
  join case_row c on c.id=bc.development_case_id
  where o.organization_id=app_current_org() and bc.organization_id=app_current_org()
), latest_observations as (
  select distinct on (s.option_id,s.dimension) s.*
  from option_sustainability_observations s join options o on o.id=s.option_id
  order by s.option_id,s.dimension,s.recorded_at desc,s.id desc
), latest_climate as (
  select distinct on (a.option_id) a.*
  from climate_resilience_assessments a join options o on o.id=a.option_id
  order by a.option_id,a.revision desc
), option_payload as (
  select o.id,o.label,o.is_do_nothing,
    (select coalesce(jsonb_agg(jsonb_build_object(
      'dimension',d.dimension,'status',case
        when d.dimension='climate_resilience' then
          case when lc.status='reviewed' and (select count(*) from climate_resilience_hazard_assessments h where h.assessment_id=lc.id)=8 then 'recorded' else 'missing' end
        when lo.id is null then 'missing' else 'recorded' end,
      'observation',case when d.dimension='climate_resilience' then
        case when lc.id is null then null else 'Eight-hazard climate resilience assessment '||lc.assessment_ref||' revision '||lc.revision end
        else lo.observation end,
      'value',lo.value,'unit',lo.unit,'basis',case when d.dimension='climate_resilience' then lc.future_conditions_basis else lo.basis end,
      'evidenceItemId',lo.evidence_item_id)
      order by d.ordinality),'[]'::jsonb)
     from unnest(array['capex','opex','safety','reliability','carbon','energy','water','land','waste','social_effect','climate_resilience']) with ordinality d(dimension,ordinality)
     left join latest_observations lo on lo.option_id=o.id and lo.dimension=d.dimension
    ) dimensions,
    (select coalesce(jsonb_agg(d.dimension order by d.ordinality) filter(where
      (d.dimension='climate_resilience' and not(coalesce(lc.status,'')='reviewed' and (select count(*) from climate_resilience_hazard_assessments h where h.assessment_id=lc.id)=8))
      or (d.dimension<>'climate_resilience' and lo.id is null)),'[]'::jsonb)
     from unnest(array['capex','opex','safety','reliability','carbon','energy','water','land','waste','social_effect','climate_resilience']) with ordinality d(dimension,ordinality)
     left join latest_observations lo on lo.option_id=o.id and lo.dimension=d.dimension
    ) missing_dimensions,
    case when lc.id is null then null else jsonb_build_object(
      'id',lc.id,'assessmentRef',lc.assessment_ref,'revision',lc.revision,
      'status',lc.status,'futureConditionsBasis',lc.future_conditions_basis,
      'reviewedAt',lc.reviewed_at,'reviewNote',lc.review_note,
      'hazards',coalesce((select jsonb_agg(jsonb_build_object(
        'hazard',h.hazard,'futureCondition',h.future_condition,
        'designResponse',h.design_response,'residualGap',h.residual_gap,
        'evidenceItemId',h.evidence_item_id) order by h.hazard)
        from climate_resilience_hazard_assessments h where h.assessment_id=lc.id),'[]'::jsonb),
      'missingHazards',(select coalesce(jsonb_agg(x.hazard),'[]'::jsonb)
        from unnest(array['extreme_temperature','wildfire','flood','precipitation','water_availability','freeze_thaw','permafrost','storm_severity']) x(hazard)
        where not exists(select 1 from climate_resilience_hazard_assessments h where h.assessment_id=lc.id and h.hazard=x.hazard))
    ) end climate_assessment
  from options o left join latest_climate lc on lc.option_id=o.id
)
select jsonb_build_object(
  'caseId',p_case_id,
  'available',exists(select 1 from case_row),
  'options',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'label',label,'isDoNothing',is_do_nothing,'dimensions',dimensions,
    'missingDimensions',missing_dimensions,'comparisonComplete',jsonb_array_length(missing_dimensions)=0,
    'climateAssessment',climate_assessment) order by is_do_nothing desc,label)
    from option_payload),'[]'::jsonb),
  'comparisonComplete',coalesce((select bool_and(jsonb_array_length(missing_dimensions)=0) from option_payload),false),
  'requiredDimensions',11,'requiredClimateHazards',8,
  'decisionBoundary','Completeness means evidence is recorded across all eleven dimensions and all eight climate hazards were independently reviewed. SyncAI does not score, rank, certify or select an option.')
$$;
revoke all on function public.get_case_option_comparison(uuid) from public,anon;
grant execute on function public.get_case_option_comparison(uuid) to authenticated;

comment on function public.get_case_option_comparison(uuid) is
  'D2.08/D4.08/D4.09: evidence-backed eleven-dimension option comparison with an eight-hazard climate assessment. No scoring, certification or automatic selection.';

notify pgrst,'reload schema';
