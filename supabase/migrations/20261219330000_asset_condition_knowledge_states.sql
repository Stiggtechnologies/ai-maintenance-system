-- ============================================================================
-- U18.01 — explicit asset condition knowledge states.
--
-- Canonical reuse: assets, sensors, condition_readings, evidence_items and
-- audit_events. This is an assessment of what the existing evidence proves; it
-- is not another time-series, recommendation, approval or work store.
-- ============================================================================
create table if not exists public.asset_condition_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  knowledge_state text not null check (knowledge_state in
    ('known','estimated','predicted','unknown','conflicting')),
  assessed_value numeric,
  value_unit text,
  basis text not null,
  evidence_item_ids uuid[] not null default '{}',
  observed_at timestamptz,
  valid_through timestamptz,
  status text not null default 'draft' check (status in ('draft','verified','superseded')),
  assessed_by uuid not null references auth.users(id),
  assessed_at timestamptz not null default now(),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  verification_note text,
  supersedes_id uuid references public.asset_condition_assessments(id),
  register_ref text not null default 'U18.01',
  check ((assessed_value is null) = (value_unit is null)),
  check (knowledge_state <> 'unknown' or assessed_value is null),
  check (valid_through is null or valid_through > coalesce(observed_at, assessed_at)),
  check (
    (status='draft' and verified_by is null and verified_at is null)
    or
    (status='verified' and verified_by is not null and verified_at is not null
      and length(trim(coalesce(verification_note,''))) >= 20)
    or status='superseded'
  )
);

create unique index if not exists uq_asset_condition_active
  on public.asset_condition_assessments(organization_id,asset_id)
  where status in ('draft','verified');
create index if not exists idx_asset_condition_org
  on public.asset_condition_assessments(organization_id,assessed_at desc);

alter table public.asset_condition_assessments enable row level security;
drop policy if exists asset_condition_assessments_read
  on public.asset_condition_assessments;
create policy asset_condition_assessments_read
  on public.asset_condition_assessments for select to authenticated
  using (organization_id=public.app_current_org());

revoke insert,update,delete,truncate on public.asset_condition_assessments
  from public,anon,authenticated;

create or replace function public.record_asset_condition_state(
  p_asset_id uuid,
  p_knowledge_state text,
  p_basis text,
  p_assessed_value numeric default null,
  p_value_unit text default null,
  p_evidence_item_ids uuid[] default '{}',
  p_observed_at timestamptz default null,
  p_valid_through timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_existing public.asset_condition_assessments%rowtype;
  v_id uuid;
  v_ids uuid[]:=coalesce(p_evidence_item_ids,'{}');
  v_verified_count int;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in
    ('operator','technician','planner','reliability_engineer',
     'maintenance_manager','executive','admin') then
    return jsonb_build_object('error',
      'recording asset condition requires a named same-tenant operating or engineering role; the AI-operator identity may prepare but cannot attest condition');
  end if;
  if not exists(select 1 from public.assets
    where id=p_asset_id and organization_id=v_org) then
    return jsonb_build_object('error','asset not found in this organization');
  end if;
  if p_knowledge_state not in
    ('known','estimated','predicted','unknown','conflicting') then
    return jsonb_build_object('error',
      'knowledge state must be known, estimated, predicted, unknown, or conflicting');
  end if;
  if coalesce(length(trim(p_basis)),0)<20 then
    return jsonb_build_object('error',
      'state the evidence basis and limitations (20 characters minimum)');
  end if;
  if (p_assessed_value is null) <> (nullif(trim(coalesce(p_value_unit,'')),'') is null) then
    return jsonb_build_object('error',
      'assessed value and unit must be supplied together or both omitted');
  end if;
  if p_knowledge_state='unknown' and p_assessed_value is not null then
    return jsonb_build_object('error',
      'unknown condition cannot carry a numeric value');
  end if;
  if p_knowledge_state='known' and
    (p_observed_at is null or cardinality(v_ids)<1) then
    return jsonb_build_object('error',
      'known condition requires an observation time and verified canonical evidence');
  end if;
  if p_knowledge_state='predicted' and p_valid_through is null then
    return jsonb_build_object('error',
      'predicted condition requires an explicit validity horizon');
  end if;
  if p_knowledge_state='conflicting' and cardinality(v_ids)<2 then
    return jsonb_build_object('error',
      'conflicting condition requires at least two canonical evidence items');
  end if;
  if p_valid_through is not null and
     p_valid_through<=coalesce(p_observed_at,now()) then
    return jsonb_build_object('error',
      'valid-through must be later than the observation or assessment time');
  end if;
  if cardinality(v_ids)<>cardinality(array(select distinct unnest(v_ids))) then
    return jsonb_build_object('error','evidence item ids must be unique');
  end if;
  if exists(
    select 1 from unnest(v_ids) x(id)
    left join public.evidence_items e on e.id=x.id and e.organization_id=v_org
    where e.id is null or (e.asset_id is not null and e.asset_id<>p_asset_id)
  ) then
    return jsonb_build_object('error',
      'every evidence item must belong to this organization and this asset when asset-scoped');
  end if;
  select count(*) into v_verified_count
  from unnest(v_ids) x(id)
  join public.evidence_items e on e.id=x.id and e.organization_id=v_org
  where e.verification_status='verified';
  if p_knowledge_state='known' and v_verified_count<1 then
    return jsonb_build_object('error',
      'known condition requires at least one independently verified evidence item');
  end if;

  select * into v_existing from public.asset_condition_assessments
  where organization_id=v_org and asset_id=p_asset_id
    and status in ('draft','verified')
  for update;
  if found then
    update public.asset_condition_assessments
    set status='superseded'
    where id=v_existing.id;
  end if;

  insert into public.asset_condition_assessments(
    organization_id,asset_id,knowledge_state,assessed_value,value_unit,basis,
    evidence_item_ids,observed_at,valid_through,assessed_by,supersedes_id
  ) values(
    v_org,p_asset_id,p_knowledge_state,p_assessed_value,
    nullif(trim(coalesce(p_value_unit,'')),''),
    trim(p_basis),v_ids,p_observed_at,p_valid_through,auth.uid(),v_existing.id
  ) returning id into v_id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_condition_assessment',v_role,jsonb_build_object(
    'assessment_id',v_id,'asset_id',p_asset_id,
    'knowledge_state',p_knowledge_state,'status','draft',
    'evidence_count',cardinality(v_ids),
    'boundary','assessment only; no work, recommendation, limit, or approval changed'));

  return jsonb_build_object(
    'assessment_id',v_id,'knowledge_state',p_knowledge_state,'status','draft',
    'note','Condition knowledge state recorded as a draft assessment. It does not authorize operation or intervention.');
end
$$;

create or replace function public.verify_asset_condition_state(
  p_assessment_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_row public.asset_condition_assessments%rowtype;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error',
      'condition verification requires a named same-tenant engineering or accountable management role');
  end if;
  select * into v_row from public.asset_condition_assessments
  where id=p_assessment_id and organization_id=v_org for update;
  if not found then
    return jsonb_build_object('error','condition assessment not found');
  end if;
  if v_row.status<>'draft' then
    return jsonb_build_object('error',
      'only a draft condition assessment can be verified or superseded');
  end if;
  if v_row.assessed_by=auth.uid() then
    return jsonb_build_object('error',
      'the assessment author cannot independently verify the same condition state');
  end if;
  if p_decision not in ('verified','superseded') then
    return jsonb_build_object('error','decision must be verified or superseded');
  end if;
  if coalesce(length(trim(p_note)),0)<20 then
    return jsonb_build_object('error',
      'record a substantive verification method and conclusion (20 characters minimum)');
  end if;

  update public.asset_condition_assessments set
    status=p_decision,verified_by=auth.uid(),verified_at=now(),
    verification_note=trim(p_note)
  where id=v_row.id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_condition_assessment',v_role,jsonb_build_object(
    'assessment_id',v_row.id,'asset_id',v_row.asset_id,
    'decision',p_decision,'independent',true,
    'boundary','verification does not authorize operation or intervention'));

  return jsonb_build_object(
    'assessment_id',v_row.id,'status',p_decision,
    'note','Condition assessment disposition recorded. No operating or work authority was granted.');
end
$$;

create or replace function public.get_asset_condition_states()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select case when public.app_current_org() is null
    then jsonb_build_object('error','forbidden')
    else jsonb_build_object(
      'states',jsonb_build_array('known','estimated','predicted','unknown','conflicting'),
      'assessments',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',c.id,'asset_id',c.asset_id,'asset',a.name,
          'knowledge_state',c.knowledge_state,'assessed_value',c.assessed_value,
          'value_unit',c.value_unit,'basis',c.basis,
          'evidence_item_ids',c.evidence_item_ids,
          'observed_at',c.observed_at,'valid_through',c.valid_through,
          'status',c.status,'assessed_by',c.assessed_by,
          'assessed_at',c.assessed_at,'verified_by',c.verified_by,
          'verified_at',c.verified_at,'verification_note',c.verification_note
        ) order by c.assessed_at desc)
        from public.asset_condition_assessments c
        join public.assets a on a.id=c.asset_id and a.organization_id=c.organization_id
        where c.organization_id=public.app_current_org()
          and c.status in ('draft','verified')
      ),'[]'::jsonb),
      'basis','Condition state is explicit. Unknown and conflicting are preserved; no state authorizes operation, intervention, or a limit change.'
    ) end
$$;

revoke all on function public.record_asset_condition_state(
  uuid,text,text,numeric,text,uuid[],timestamptz,timestamptz)
  from public,anon;
revoke all on function public.verify_asset_condition_state(uuid,text,text)
  from public,anon;
revoke all on function public.get_asset_condition_states()
  from public,anon;
grant execute on function public.record_asset_condition_state(
  uuid,text,text,numeric,text,uuid[],timestamptz,timestamptz)
  to authenticated,service_role;
grant execute on function public.verify_asset_condition_state(uuid,text,text)
  to authenticated,service_role;
grant execute on function public.get_asset_condition_states()
  to authenticated,service_role;

comment on table public.asset_condition_assessments is
  'U18.01 governed assessment overlay on canonical condition evidence. Not a time-series, recommendation, approval or work store.';
comment on function public.get_asset_condition_states() is
  'U18.01 tenant-scoped current condition knowledge states. Explicitly preserves unknown/conflicting and grants no operating authority.';

