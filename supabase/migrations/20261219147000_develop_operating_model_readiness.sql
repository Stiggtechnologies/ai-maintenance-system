-- Sync Develop D8.01 — Operating Model Readiness across the thirteen
-- dimensions in II.10. Assessments reference evidence; they do not duplicate
-- workforce, maintenance, supply-chain or operating source records.

create table if not exists public.operating_model_readiness_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  development_case_id uuid not null references public.development_cases(id) on delete cascade,
  dimension text not null check (dimension in (
    'organization_structure','staffing','competencies','shift_model',
    'maintenance_strategy','supply_chain','contractors','warehouse',
    'engineering_support','operations_procedures','emergency_response',
    'it_ot_support','budget')),
  version integer not null check (version > 0),
  readiness_status text not null check (readiness_status in ('not_ready','at_risk','ready')),
  owner_id uuid not null references auth.users(id) on delete restrict,
  evidence_reference text not null check (length(btrim(evidence_reference)) >= 3),
  evidence_class text not null check (evidence_class in (
    'MEASURED','INSPECTED','CALCULATED','TESTED','DOCUMENTED','HISTORICAL',
    'EXPERT_JUDGEMENT','AI_INFERENCE')),
  assessment_basis text not null check (length(btrim(assessment_basis)) >= 20),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  unique (development_case_id, dimension, version)
);
create index if not exists idx_operating_model_readiness_case
  on public.operating_model_readiness_assessments(organization_id,development_case_id,dimension,version desc);
alter table public.operating_model_readiness_assessments enable row level security;
drop policy if exists operating_model_readiness_read on public.operating_model_readiness_assessments;
create policy operating_model_readiness_read on public.operating_model_readiness_assessments
  for select to authenticated using (organization_id=app_current_org());

create or replace function public.record_operating_model_readiness(
  p_case_id uuid, p_dimension text, p_status text, p_owner_id uuid,
  p_evidence_reference text, p_evidence_class text, p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_uid uuid:=auth.uid(); v_role text; v_version integer;
begin
  select role into v_role from user_profiles where id=v_uid and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    raise exception 'operating-model readiness assessment requires an authorized human planning, engineering or operations role';
  end if;
  if not exists(select 1 from development_cases where id=p_case_id and organization_id=v_org) then
    raise exception 'development case not found in this organization';
  end if;
  if p_dimension not in ('organization_structure','staffing','competencies','shift_model',
    'maintenance_strategy','supply_chain','contractors','warehouse','engineering_support',
    'operations_procedures','emergency_response','it_ot_support','budget') then
    raise exception 'select one of the thirteen operating-model dimensions';
  end if;
  if p_status not in ('not_ready','at_risk','ready') then
    raise exception 'readiness status must be not ready, at risk or ready';
  end if;
  if not exists(select 1 from user_profiles where id=p_owner_id and organization_id=v_org
      and coalesce(role,'')<>'ai_admin') then
    raise exception 'dimension owner must be a human member of this organization';
  end if;
  if p_evidence_class not in ('MEASURED','INSPECTED','CALCULATED','TESTED','DOCUMENTED',
    'HISTORICAL','EXPERT_JUDGEMENT','AI_INFERENCE') then
    raise exception 'evidence class must use the governed eight-class provenance vocabulary';
  end if;
  if p_status='ready' and p_evidence_class='AI_INFERENCE' then
    raise exception 'AI inference alone cannot establish a ready operating-model dimension';
  end if;
  if length(btrim(coalesce(p_evidence_reference,'')))<3 then
    raise exception 'assessment requires a source or evidence reference';
  end if;
  if length(btrim(coalesce(p_basis,'')))<20 then
    raise exception 'assessment requires an evidence-based rationale of at least 20 characters';
  end if;
  select coalesce(max(version),0)+1 into v_version
    from operating_model_readiness_assessments
    where organization_id=v_org and development_case_id=p_case_id and dimension=p_dimension;
  insert into operating_model_readiness_assessments(organization_id,development_case_id,
    dimension,version,readiness_status,owner_id,evidence_reference,evidence_class,
    assessment_basis,recorded_by)
  values(v_org,p_case_id,p_dimension,v_version,p_status,p_owner_id,
    btrim(p_evidence_reference),p_evidence_class,btrim(p_basis),v_uid);
  insert into audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'operating_model_readiness',v_role,
    jsonb_build_object('action','assessed','case_id',p_case_id,'dimension',p_dimension,'version',v_version),
    jsonb_build_object('status',p_status,'owner_id',p_owner_id,'evidence_reference',btrim(p_evidence_reference),'evidence_class',p_evidence_class));
  return jsonb_build_object('caseId',p_case_id,'dimension',p_dimension,
    'version',v_version,'status',p_status);
end $$;

create or replace function public.get_case_operating_model_readiness(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_result jsonb;
begin
  if not exists(select 1 from development_cases where id=p_case_id and organization_id=v_org) then
    raise exception 'development case not found in this organization';
  end if;
  with dimensions(dimension,sequence) as (values
    ('organization_structure',1),('staffing',2),('competencies',3),('shift_model',4),
    ('maintenance_strategy',5),('supply_chain',6),('contractors',7),('warehouse',8),
    ('engineering_support',9),('operations_procedures',10),('emergency_response',11),
    ('it_ot_support',12),('budget',13)
  ), current_assessments as (
    select d.dimension,d.sequence,a.version,a.readiness_status,a.owner_id,
      coalesce(p.full_name,p.email,a.owner_id::text) owner_name,a.evidence_reference,
      a.evidence_class,a.assessment_basis,a.recorded_by,a.recorded_at
    from dimensions d
    left join lateral (select r.* from operating_model_readiness_assessments r
      where r.organization_id=v_org and r.development_case_id=p_case_id
        and r.dimension=d.dimension order by r.version desc limit 1) a on true
    left join user_profiles p on p.organization_id=v_org and p.id=a.owner_id
  )
  select jsonb_build_object(
    'dimensions',jsonb_agg(jsonb_build_object('dimension',dimension,'sequence',sequence,
      'status',coalesce(readiness_status,'not_assessed'),'version',version,'ownerId',owner_id,
      'ownerName',owner_name,'evidenceReference',evidence_reference,'evidenceClass',evidence_class,
      'basis',assessment_basis,'recordedBy',recorded_by,'recordedAt',recorded_at) order by sequence),
    'dimensionCount',13,
    'readyCount',count(*) filter(where readiness_status='ready'),
    'atRiskCount',count(*) filter(where readiness_status='at_risk'),
    'notReadyCount',count(*) filter(where readiness_status='not_ready'),
    'notAssessedCount',count(*) filter(where readiness_status is null),
    'verdict',case when count(*) filter(where readiness_status='ready')=13 then 'READY' else 'NOT_READY' end,
    'decisionBoundary','Assessment only. This verdict does not approve handover, energization, startup or go-live.') into v_result
  from current_assessments;
  return v_result;
end $$;

revoke all on function public.record_operating_model_readiness(uuid,text,text,uuid,text,text,text) from public,anon;
revoke all on function public.get_case_operating_model_readiness(uuid) from public,anon;
grant execute on function public.record_operating_model_readiness(uuid,text,text,uuid,text,text,text),
  public.get_case_operating_model_readiness(uuid) to authenticated;
notify pgrst,'reload schema';
