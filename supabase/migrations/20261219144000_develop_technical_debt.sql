-- Sync Develop D8.02 — TechnicalDebt is an extension of the canonical
-- temporary_modifications record, never a parallel debt store.

alter table public.temporary_modifications
  drop constraint if exists temporary_modifications_modification_kind_check;
alter table public.temporary_modifications
  add constraint temporary_modifications_modification_kind_check check (
    modification_kind in ('jumper','bypass','defeat','temporary_repair',
      'software_override','alternative_part','temporary_support','other',
      'deferred_redesign','incomplete_monitoring'));

alter table public.temporary_modifications
  add column if not exists origin_development_case_id uuid
    references public.development_cases(id) on delete set null,
  add column if not exists lifecycle_cost numeric,
  add column if not exists lifecycle_cost_currency text,
  add column if not exists lifecycle_cost_basis text,
  add column if not exists approved_at timestamptz,
  add column if not exists approval_basis text;

alter table public.temporary_modifications
  drop constraint if exists temporary_modifications_lifecycle_cost_check,
  add constraint temporary_modifications_lifecycle_cost_check check (
    (lifecycle_cost is null and lifecycle_cost_currency is null and lifecycle_cost_basis is null)
    or (lifecycle_cost is not null and lifecycle_cost >= 0
      and lifecycle_cost_currency ~ '^[A-Z]{3}$'
      and length(btrim(lifecycle_cost_basis)) >= 20)),
  drop constraint if exists temporary_modifications_approval_record_check,
  add constraint temporary_modifications_approval_record_check check (
    -- Legacy/process-safety temporary modifications predate this approval
    -- tuple and remain governed by their owning barrier-deviation workflow.
    origin_development_case_id is null
    or (approved_by is null and approved_at is null and approval_basis is null)
    or (approved_by is not null and approved_at is not null
      and length(btrim(approval_basis)) >= 20));

create index if not exists idx_tempmod_origin_case
  on public.temporary_modifications(organization_id, origin_development_case_id)
  where origin_development_case_id is not null;

create or replace function public.record_case_technical_debt(
  p_case_id uuid, p_debt jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_uid uuid:=auth.uid(); v_role text;
  v_asset uuid:=nullif(p_debt->>'asset_id','')::uuid;
  v_due date:=nullif(p_debt->>'required_removal_by','')::date;
  v_kind text:=nullif(btrim(p_debt->>'modification_kind'),'');
  v_cost numeric:=nullif(p_debt->>'lifecycle_cost','')::numeric;
  v_currency text:=nullif(upper(btrim(p_debt->>'lifecycle_cost_currency')),'');
  v_cost_basis text:=nullif(btrim(p_debt->>'lifecycle_cost_basis'),'');
  v_id bigint;
begin
  if v_uid is null or v_org is null then raise exception 'authenticated organization member required'; end if;
  select role into v_role from user_profiles where id=v_uid and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    raise exception 'recording technical debt requires an authorized human planner or engineering role';
  end if;
  if not exists(select 1 from development_cases where id=p_case_id and organization_id=v_org) then
    raise exception 'development case not found in this organization';
  end if;
  if v_asset is null or not exists(select 1 from development_case_assets where organization_id=v_org and development_case_id=p_case_id and asset_id=v_asset) then
    raise exception 'technical debt must name an asset already bound to this development case';
  end if;
  if v_kind not in ('jumper','bypass','defeat','temporary_repair','software_override','alternative_part','temporary_support','other','deferred_redesign','incomplete_monitoring') then
    raise exception 'select a supported technical-debt kind';
  end if;
  if length(btrim(coalesce(p_debt->>'description','')))<20 or length(btrim(coalesce(p_debt->>'reason','')))<20 then
    raise exception 'description and reason must each contain at least 20 characters';
  end if;
  if v_due is null or v_due<current_date then raise exception 'a current or future required-removal date is mandatory'; end if;
  if length(btrim(coalesce(p_debt->>'risk_assessment_ref','')))<3 then raise exception 'a controlled risk-assessment reference is mandatory'; end if;
  if (v_cost is null) <> (v_currency is null) or (v_cost is null) <> (v_cost_basis is null) then
    raise exception 'lifecycle cost, ISO currency, and stated basis must be supplied together or all left unknown';
  end if;
  if v_cost is not null and (not sync_is_finite_numeric(v_cost) or v_cost<0 or v_currency !~ '^[A-Z]{3}$' or length(v_cost_basis)<20) then
    raise exception 'lifecycle cost requires a non-negative amount, ISO currency, and 20-character basis';
  end if;

  insert into temporary_modifications(organization_id,asset_id,modification_kind,
    description,reason,required_removal_by,installed_by,risk_assessment_ref,
    affects_safety_function,origin_development_case_id,lifecycle_cost,
    lifecycle_cost_currency,lifecycle_cost_basis)
  values(v_org,v_asset,v_kind,p_debt->>'description',p_debt->>'reason',v_due,v_uid,
    p_debt->>'risk_assessment_ref',false,p_case_id,v_cost,v_currency,v_cost_basis)
  returning id into v_id;

  insert into audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'technical_debt',v_role,jsonb_build_object('action','recorded','technical_debt_id',v_id,'case_id',p_case_id),
    jsonb_build_object('kind',v_kind,'required_removal_by',v_due,'lifecycle_cost_recorded',v_cost is not null,'risk_assessment_ref',p_debt->>'risk_assessment_ref'));
  return jsonb_build_object('id',v_id,'status','awaiting_independent_approval');
end $$;

create or replace function public.approve_case_technical_debt(p_debt_id bigint,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_uid uuid:=auth.uid(); v_role text; v_rec temporary_modifications%rowtype;
begin
  select role into v_role from user_profiles where id=v_uid and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    raise exception 'technical-debt approval requires accountable human engineering or operations authority';
  end if;
  select * into v_rec from temporary_modifications where id=p_debt_id and organization_id=v_org and origin_development_case_id is not null and removed_at is null;
  if not found then raise exception 'open case technical debt not found'; end if;
  if v_rec.installed_by=v_uid then raise exception 'the recorder cannot approve the same technical-debt choice'; end if;
  if v_rec.approved_by is not null then raise exception 'technical debt is already approved'; end if;
  if length(btrim(coalesce(p_basis,'')))<20 then raise exception 'approval requires an evidence basis of at least 20 characters'; end if;
  update temporary_modifications set approved_by=v_uid,approved_at=now(),approval_basis=btrim(p_basis) where id=p_debt_id;
  insert into audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'technical_debt',v_role,jsonb_build_object('action','approved','technical_debt_id',p_debt_id,'case_id',v_rec.origin_development_case_id),
    jsonb_build_object('approval_status','awaiting_independent_approval'),jsonb_build_object('approval_status','approved','basis',btrim(p_basis)));
  return jsonb_build_object('id',p_debt_id,'status','approved');
end $$;

create or replace function public.get_case_technical_debt(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_result jsonb;
begin
  if not exists(select 1 from development_cases where id=p_case_id and organization_id=v_org) then raise exception 'development case not found in this organization'; end if;
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object('id',t.id,'assetId',t.asset_id,'assetName',a.name,'kind',t.modification_kind,
      'description',t.description,'reason',t.reason,'requiredRemovalBy',t.required_removal_by,'riskAssessmentRef',t.risk_assessment_ref,
      'lifecycleCost',t.lifecycle_cost,'currency',t.lifecycle_cost_currency,'costBasis',t.lifecycle_cost_basis,
      'recordedBy',t.installed_by,'approvedBy',t.approved_by,'approvedAt',t.approved_at,'removedAt',t.removed_at)
      order by t.created_at desc) filter(where t.id is not null),'[]'::jsonb),
    'valuationStatus',case when count(*)=0 then 'not_applicable_no_items' when count(*) filter(where t.lifecycle_cost is null)>0 then 'incomplete_unvalued_items_present' else 'complete_recorded_values' end,
    'unvaluedCount',count(*) filter(where t.lifecycle_cost is null),
    'note','Recorded lifecycle costs are stated-basis inputs, not forecasts. Unknown cost remains unvalued and is never treated as zero.') into v_result
  from temporary_modifications t join assets a on a.id=t.asset_id and a.organization_id=v_org
  where t.organization_id=v_org and t.origin_development_case_id=p_case_id;
  return v_result;
end $$;

revoke all on function public.record_case_technical_debt(uuid,jsonb) from public,anon;
revoke all on function public.approve_case_technical_debt(bigint,text) from public,anon;
revoke all on function public.get_case_technical_debt(uuid) from public,anon;
grant execute on function public.record_case_technical_debt(uuid,jsonb), public.approve_case_technical_debt(bigint,text), public.get_case_technical_debt(uuid) to authenticated;
notify pgrst,'reload schema';
