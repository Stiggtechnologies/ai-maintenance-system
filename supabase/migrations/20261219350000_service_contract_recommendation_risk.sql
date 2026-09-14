-- U13.01 — service-level and contractual obligations in recommendation risk.
-- Extends canonical risk_obligations and recommendations; no parallel queues.

alter table public.risk_obligations
  add column if not exists service_commitment_type text,
  add column if not exists asset_id uuid references public.assets(id) on delete set null,
  add column if not exists service_level_asset_id uuid references public.asset_service_levels(asset_id) on delete set null,
  add column if not exists contract_package_id bigint references public.contract_packages(id) on delete set null,
  add column if not exists supplier_id bigint references public.suppliers(id) on delete set null,
  add column if not exists warranty_term_id bigint references public.warranty_terms(id) on delete set null,
  add column if not exists metric_name text,
  add column if not exists target_value numeric,
  add column if not exists target_unit text,
  add column if not exists measurement_window text,
  add column if not exists measurement_basis text,
  add column if not exists remedy text,
  add column if not exists penalty_value numeric,
  add column if not exists incentive_value numeric,
  add column if not exists commercial_currency text,
  add column if not exists evidence_item_ids uuid[] not null default '{}',
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

alter table public.risk_obligations
  drop constraint if exists risk_obligations_service_commitment_type_check;
alter table public.risk_obligations add constraint risk_obligations_service_commitment_type_check
  check (service_commitment_type is null or service_commitment_type in
    ('availability_guarantee','response_time_guarantee','reliability_guarantee',
     'punctuality_target','service_standard','maintenance_contract',
     'performance_based_logistics','warranty','concession_requirement'));
alter table public.risk_obligations
  drop constraint if exists risk_obligations_service_review_shape_check;
alter table public.risk_obligations add constraint risk_obligations_service_review_shape_check check (
  service_commitment_type is null or (
    source_type in ('contract','oem_requirement') and created_by is not null
    and length(trim(coalesce(measurement_basis,'')))>=20
    and ((target_value is null and target_unit is null)
      or (target_value is not null and length(trim(coalesce(target_unit,'')))>=1))
    and (target_value is null or target_value not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))
    and (penalty_value is null or penalty_value>=0)
    and (incentive_value is null or incentive_value>=0)
    and (penalty_value is null or penalty_value not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))
    and (incentive_value is null or incentive_value not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))
    and ((penalty_value is null and incentive_value is null)
      or commercial_currency ~ '^[A-Z]{3}$')
    and (status<>'adopted' or (
      reviewed_by is not null and reviewed_at is not null
      and reviewed_by<>created_by
      and length(trim(coalesce(review_note,'')))>=20
    ))
  )
);
create index if not exists idx_risk_obligations_service
  on public.risk_obligations(organization_id,service_commitment_type,status)
  where service_commitment_type is not null;

-- The general obligation versioner predates service semantics and copies only
-- its original columns. Refuse semantic stripping; the dedicated versioner
-- below carries every contractual field and evidence reference forward.
create or replace function public.prevent_service_obligation_semantic_strip()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.supersedes_id is not null and new.service_commitment_type is null
    and exists(select 1 from public.risk_obligations old
      where old.id=new.supersedes_id and old.service_commitment_type is not null) then
    raise exception 'service obligations must use create_service_contract_obligation_version';
  end if;
  return new;
end $$;
drop trigger if exists trg_prevent_service_obligation_semantic_strip on public.risk_obligations;
create trigger trg_prevent_service_obligation_semantic_strip
  before insert on public.risk_obligations for each row
  execute function public.prevent_service_obligation_semantic_strip();

create table if not exists public.recommendation_obligation_risks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recommendation_id uuid not null references public.recommendations(id) on delete cascade,
  obligation_id uuid not null references public.risk_obligations(id) on delete restrict,
  breach_state text not null check (breach_state in ('compliant','at_risk','breached','unknown')),
  risk_rating text not null check (risk_rating in ('low','medium','high','critical','unknown')),
  exposure_basis text not null,
  actual_value numeric,
  actual_unit text,
  estimated_penalty_exposure numeric check (estimated_penalty_exposure is null or estimated_penalty_exposure>=0),
  currency text,
  evidence_item_ids uuid[] not null default '{}',
  missing_evidence text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','verified','superseded')),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  verification_note text,
  check (length(trim(exposure_basis))>=20),
  check ((actual_value is null and actual_unit is null)
    or (actual_value is not null and length(trim(coalesce(actual_unit,'')))>=1)),
  check (actual_value is null or actual_value not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
  check (estimated_penalty_exposure is null or currency ~ '^[A-Z]{3}$'),
  check (estimated_penalty_exposure is null or estimated_penalty_exposure not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
  check ((status='draft' and verified_by is null and verified_at is null)
    or (status='verified' and verified_by is not null and verified_at is not null
      and recorded_by<>verified_by and length(trim(coalesce(verification_note,'')))>=20)
    or status='superseded')
);
create unique index if not exists uq_recommendation_obligation_risk_active
  on public.recommendation_obligation_risks(organization_id,recommendation_id,obligation_id)
  where status in ('draft','verified');
create index if not exists idx_recommendation_obligation_risks_org
  on public.recommendation_obligation_risks(organization_id,recommendation_id,status);
alter table public.recommendation_obligation_risks enable row level security;
drop policy if exists recommendation_obligation_risks_read on public.recommendation_obligation_risks;
create policy recommendation_obligation_risks_read on public.recommendation_obligation_risks
  for select to authenticated using (
    organization_id=public.app_current_org()
    and exists(select 1 from public.recommendations r where r.id=recommendation_id
      and r.organization_id=public.app_current_org()
      and (r.risk_id is null or public.can_read_risk(r.risk_id)))
  );
revoke insert,update,delete,truncate on public.recommendation_obligation_risks
  from public,anon,authenticated;

create or replace function public.record_service_contract_obligation(p_obligation jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_id uuid;
  v_asset uuid:=nullif(p_obligation->>'asset_id','')::uuid;
  v_service_asset uuid:=nullif(p_obligation->>'service_level_asset_id','')::uuid;
  v_contract bigint:=nullif(p_obligation->>'contract_package_id','')::bigint;
  v_supplier bigint:=nullif(p_obligation->>'supplier_id','')::bigint;
  v_warranty bigint:=nullif(p_obligation->>'warranty_term_id','')::bigint;
  v_evidence uuid[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_obligation->'evidence_item_ids','[]'))::uuid),'{}');
  v_type text:=p_obligation->>'service_commitment_type';
  v_target numeric:=nullif(p_obligation->>'target_value','')::numeric;
  v_penalty numeric:=nullif(p_obligation->>'penalty_value','')::numeric;
  v_incentive numeric:=nullif(p_obligation->>'incentive_value','')::numeric;
begin
  if v_org is null or coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','a named same-tenant engineering or accountable management role must author the obligation; AI identity is not accepted');
  end if;
  if v_type not in ('availability_guarantee','response_time_guarantee','reliability_guarantee',
    'punctuality_target','service_standard','maintenance_contract','performance_based_logistics',
    'warranty','concession_requirement') then
    return jsonb_build_object('error','unsupported service commitment type');
  end if;
  if p_obligation->>'source_type' not in ('contract','oem_requirement') then
    return jsonb_build_object('error','service commitments must cite a contract or OEM requirement');
  end if;
  if coalesce(length(trim(p_obligation->>'source_reference')),0)<2
    or coalesce(length(trim(p_obligation->>'requirement')),0)<20
    or coalesce(length(trim(p_obligation->>'applicable_scope')),0)<3
    or coalesce(length(trim(p_obligation->>'responsible_role')),0)<2
    or coalesce(length(trim(p_obligation->>'measurement_basis')),0)<20 then
    return jsonb_build_object('error','source, requirement, scope, responsible role and substantive measurement basis are required');
  end if;
  if v_type in ('availability_guarantee','response_time_guarantee','reliability_guarantee','punctuality_target')
    and (v_target is null or coalesce(length(trim(p_obligation->>'target_unit')),0)<1) then
    return jsonb_build_object('error','a quantified guarantee requires a stated target value and unit; SyncAI will not invent one');
  end if;
  if v_target in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    or v_penalty in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    or v_incentive in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) then
    return jsonb_build_object('error','targets, penalties and incentives must be finite stated values');
  end if;
  if (v_penalty is not null or v_incentive is not null)
    and coalesce(p_obligation->>'commercial_currency','') !~ '^[A-Z]{3}$' then
    return jsonb_build_object('error','penalty or incentive values require an ISO currency code');
  end if;
  if v_asset is not null and not exists(select 1 from public.assets where id=v_asset and organization_id=v_org) then
    return jsonb_build_object('error','asset not found in this organization'); end if;
  if v_service_asset is not null and not exists(select 1 from public.asset_service_levels where asset_id=v_service_asset and organization_id=v_org) then
    return jsonb_build_object('error','service level not found in this organization'); end if;
  if v_asset is not null and v_service_asset is not null and v_asset<>v_service_asset then
    return jsonb_build_object('error','service level must belong to the obligation asset'); end if;
  if v_contract is not null and not exists(select 1 from public.contract_packages where id=v_contract and organization_id=v_org) then
    return jsonb_build_object('error','contract package not found in this organization'); end if;
  if v_supplier is not null and not exists(select 1 from public.suppliers where id=v_supplier and organization_id=v_org) then
    return jsonb_build_object('error','supplier not found in this organization'); end if;
  if v_warranty is not null and not exists(select 1 from public.warranty_terms where id=v_warranty and organization_id=v_org) then
    return jsonb_build_object('error','warranty term not found in this organization'); end if;
  if v_contract is not null and v_supplier is not null and exists(select 1 from public.contract_packages
    where id=v_contract and organization_id=v_org and awarded_supplier_id is not null
      and awarded_supplier_id<>v_supplier) then
    return jsonb_build_object('error','supplier does not match the awarded contract supplier'); end if;
  if v_warranty is not null and v_asset is not null and exists(select 1 from public.warranty_terms
    where id=v_warranty and organization_id=v_org and asset_id is not null and asset_id<>v_asset) then
    return jsonb_build_object('error','warranty does not apply to the obligation asset'); end if;
  if v_warranty is not null and v_supplier is not null and exists(select 1 from public.warranty_terms
    where id=v_warranty and organization_id=v_org and supplier_id is not null and supplier_id<>v_supplier) then
    return jsonb_build_object('error','warranty provider does not match the obligation supplier'); end if;
  if cardinality(v_evidence)<>cardinality(array(select distinct unnest(v_evidence))) then
    return jsonb_build_object('error','evidence item ids must be unique'); end if;
  if exists(select 1 from unnest(v_evidence) x(id) left join public.evidence_items e
    on e.id=x.id and e.organization_id=v_org where e.id is null
      or (v_asset is not null and e.asset_id is not null and e.asset_id<>v_asset)) then
    return jsonb_build_object('error','every evidence item must belong to this organization and asset when asset-scoped'); end if;
  insert into public.risk_obligations(organization_id,source_type,source_reference,jurisdiction,
    applicable_scope,responsible_role,requirement,effective_date,expiry_date,created_by,
    service_commitment_type,asset_id,service_level_asset_id,contract_package_id,supplier_id,
    warranty_term_id,metric_name,target_value,target_unit,measurement_window,measurement_basis,
    remedy,penalty_value,incentive_value,commercial_currency,evidence_item_ids)
  values(v_org,p_obligation->>'source_type',trim(p_obligation->>'source_reference'),
    nullif(trim(coalesce(p_obligation->>'jurisdiction','')),''),trim(p_obligation->>'applicable_scope'),
    trim(p_obligation->>'responsible_role'),trim(p_obligation->>'requirement'),
    nullif(p_obligation->>'effective_date','')::date,nullif(p_obligation->>'expiry_date','')::date,
    auth.uid(),v_type,v_asset,v_service_asset,v_contract,v_supplier,v_warranty,
    nullif(trim(coalesce(p_obligation->>'metric_name','')),''),v_target,
    nullif(trim(coalesce(p_obligation->>'target_unit','')),''),
    nullif(trim(coalesce(p_obligation->>'measurement_window','')),''),trim(p_obligation->>'measurement_basis'),
    nullif(trim(coalesce(p_obligation->>'remedy','')),''),v_penalty,v_incentive,
    nullif(p_obligation->>'commercial_currency',''),v_evidence) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'service_contract_obligation',v_role,jsonb_build_object('obligation_id',v_id,
    'type',v_type,'status','draft','evidence_count',cardinality(v_evidence),
    'boundary','obligation record only; no recommendation approval or work authority granted'));
  return jsonb_build_object('obligation_id',v_id,'status','draft',
    'note','Contractual obligation recorded for independent human adoption.');
end $$;

create or replace function public.adopt_service_contract_obligation(p_obligation_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); o public.risk_obligations%rowtype;
begin
  if v_org is null or coalesce(v_role,'') not in ('executive','maintenance_manager','admin') then
    return jsonb_build_object('error','independent obligation adoption requires named accountable management; AI identity is not accepted'); end if;
  select * into o from public.risk_obligations where id=p_obligation_id and organization_id=v_org
    and service_commitment_type is not null for update;
  if not found or o.status<>'draft' then return jsonb_build_object('error','draft service obligation not found'); end if;
  if o.created_by=auth.uid() then return jsonb_build_object('error','the obligation author cannot independently adopt the same record'); end if;
  if coalesce(length(trim(p_note)),0)<20 then return jsonb_build_object('error','record a substantive independent adoption basis'); end if;
  if cardinality(o.evidence_item_ids)=0 then return jsonb_build_object('error','adoption requires at least one canonical evidence item'); end if;
  if exists(select 1 from unnest(o.evidence_item_ids) x(id) left join public.evidence_items e
    on e.id=x.id and e.organization_id=v_org where e.id is null or e.verification_status<>'verified') then
    return jsonb_build_object('error','all obligation evidence must be independently verified before adoption'); end if;
  update public.risk_obligations set status='adopted',reviewed_by=auth.uid(),reviewed_at=now(),
    review_note=trim(p_note),updated_at=now() where id=o.id;
  if o.supersedes_id is not null then
    insert into public.risk_obligation_links(organization_id,risk_id,obligation_id,applicability)
      select organization_id,risk_id,o.id,applicability from public.risk_obligation_links
      where organization_id=v_org and obligation_id=o.supersedes_id on conflict do nothing;
    update public.risk_obligations set status='superseded',updated_at=now()
      where id=o.supersedes_id and organization_id=v_org and status='adopted';
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'service_contract_obligation_adoption',v_role,jsonb_build_object('obligation_id',o.id,
    'independent',true,'boundary','adoption governs the obligation; it does not approve recommendations or release work'));
  return jsonb_build_object('obligation_id',o.id,'status','adopted');
end $$;

create or replace function public.create_service_contract_obligation_version(
  p_obligation_id uuid,p_changes jsonb,p_reason text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  o public.risk_obligations%rowtype; v_payload jsonb; v_result jsonb; v_id uuid;
begin
  if v_org is null or coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','a named same-tenant human role must author a service-obligation version'); end if;
  if coalesce(length(trim(p_reason)),0)<20 then
    return jsonb_build_object('error','record a substantive reason for the contractual obligation version'); end if;
  select * into o from public.risk_obligations where id=p_obligation_id
    and organization_id=v_org and service_commitment_type is not null and status='adopted';
  if not found then return jsonb_build_object('error','adopted service obligation not found'); end if;
  if exists(select 1 from public.risk_obligations where supersedes_id=o.id and status='draft') then
    return jsonb_build_object('error','a draft successor already exists'); end if;
  v_payload:=jsonb_strip_nulls(jsonb_build_object(
    'service_commitment_type',o.service_commitment_type,'source_type',o.source_type,
    'source_reference',o.source_reference,'jurisdiction',o.jurisdiction,
    'requirement',o.requirement,'applicable_scope',o.applicable_scope,
    'responsible_role',o.responsible_role,'effective_date',o.effective_date,
    'expiry_date',o.expiry_date,'asset_id',o.asset_id,
    'service_level_asset_id',o.service_level_asset_id,'contract_package_id',o.contract_package_id,
    'supplier_id',o.supplier_id,'warranty_term_id',o.warranty_term_id,
    'metric_name',o.metric_name,'target_value',o.target_value,'target_unit',o.target_unit,
    'measurement_window',o.measurement_window,'measurement_basis',o.measurement_basis,
    'remedy',o.remedy,'penalty_value',o.penalty_value,'incentive_value',o.incentive_value,
    'commercial_currency',o.commercial_currency,'evidence_item_ids',to_jsonb(o.evidence_item_ids)
  )) || coalesce(p_changes,'{}'::jsonb);
  v_result:=public.record_service_contract_obligation(v_payload);
  if v_result ? 'error' then return v_result; end if;
  v_id:=(v_result->>'obligation_id')::uuid;
  update public.risk_obligations set supersedes_id=o.id,version=o.version+1 where id=v_id and organization_id=v_org;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'service_contract_obligation_version',v_role,jsonb_build_object(
    'obligation_id',v_id,'supersedes_id',o.id,'version',o.version+1,'reason',trim(p_reason)));
  return jsonb_build_object('obligation_id',v_id,'status','draft','version',o.version+1,
    'supersedes_id',o.id,'note','Successor recorded for independent adoption; current obligation remains adopted until then.');
end $$;

create or replace function public.record_recommendation_contract_risk(p_assessment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_id uuid;
  v_rec uuid:=nullif(p_assessment->>'recommendation_id','')::uuid;
  v_obligation uuid:=nullif(p_assessment->>'obligation_id','')::uuid;
  v_rec_asset uuid; v_obligation_asset uuid;
  v_evidence uuid[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_assessment->'evidence_item_ids','[]'))::uuid),'{}');
  v_missing text[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_assessment->'missing_evidence','[]'))),'{}');
begin
  if v_org is null or coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','a named same-tenant engineering or accountable management role must assess contractual risk; AI identity is not accepted'); end if;
  select asset_id into v_rec_asset from public.recommendations where id=v_rec and organization_id=v_org
    and (risk_id is null or public.can_read_risk(risk_id));
  if not found then
    return jsonb_build_object('error','recommendation not found in this organization'); end if;
  select asset_id into v_obligation_asset from public.risk_obligations where id=v_obligation
    and organization_id=v_org and service_commitment_type is not null and status='adopted';
  if not found then
    return jsonb_build_object('error','adopted service obligation not found in this organization'); end if;
  if v_rec_asset is not null and v_obligation_asset is not null and v_rec_asset<>v_obligation_asset then
    return jsonb_build_object('error','obligation and recommendation refer to different assets'); end if;
  if p_assessment->>'breach_state' not in ('compliant','at_risk','breached','unknown')
    or p_assessment->>'risk_rating' not in ('low','medium','high','critical','unknown') then
    return jsonb_build_object('error','valid breach state and contractual risk rating are required'); end if;
  if coalesce(length(trim(p_assessment->>'exposure_basis')),0)<20 then
    return jsonb_build_object('error','state the contractual exposure basis (20 characters minimum)'); end if;
  if cardinality(v_evidence)=0 and cardinality(v_missing)=0 then
    return jsonb_build_object('error','cite canonical evidence or explicitly name the missing evidence; SyncAI will not infer compliance'); end if;
  if cardinality(v_evidence)<>cardinality(array(select distinct unnest(v_evidence))) then
    return jsonb_build_object('error','evidence item ids must be unique'); end if;
  if exists(select 1 from unnest(v_evidence) x(id) left join public.evidence_items e
    on e.id=x.id and e.organization_id=v_org where e.id is null
      or (v_rec_asset is not null and e.asset_id is not null and e.asset_id<>v_rec_asset)) then
    return jsonb_build_object('error','every evidence item must belong to this organization and recommendation asset when asset-scoped'); end if;
  update public.recommendation_obligation_risks set status='superseded'
    where organization_id=v_org and recommendation_id=v_rec and obligation_id=v_obligation
      and status in ('draft','verified');
  insert into public.recommendation_obligation_risks(organization_id,recommendation_id,obligation_id,
    breach_state,risk_rating,exposure_basis,actual_value,actual_unit,estimated_penalty_exposure,
    currency,evidence_item_ids,missing_evidence,recorded_by)
  values(v_org,v_rec,v_obligation,p_assessment->>'breach_state',p_assessment->>'risk_rating',
    trim(p_assessment->>'exposure_basis'),nullif(p_assessment->>'actual_value','')::numeric,
    nullif(trim(coalesce(p_assessment->>'actual_unit','')),''),
    nullif(p_assessment->>'estimated_penalty_exposure','')::numeric,
    nullif(p_assessment->>'currency',''),v_evidence,v_missing,auth.uid()) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'recommendation_contract_risk',v_role,jsonb_build_object('assessment_id',v_id,
    'recommendation_id',v_rec,'obligation_id',v_obligation,'status','draft',
    'boundary','risk context only; recommendation remains in its canonical human approval workflow'));
  return jsonb_build_object('assessment_id',v_id,'status','draft',
    'note','Contractual risk recorded for independent verification; recommendation authority is unchanged.');
end $$;

create or replace function public.verify_recommendation_contract_risk(p_assessment_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); a public.recommendation_obligation_risks%rowtype;
begin
  if v_org is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','independent contractual-risk verification requires a named same-tenant human role'); end if;
  select * into a from public.recommendation_obligation_risks where id=p_assessment_id
    and organization_id=v_org for update;
  if not found or a.status<>'draft' then return jsonb_build_object('error','draft contractual-risk assessment not found'); end if;
  if a.recorded_by=auth.uid() then return jsonb_build_object('error','the assessment author cannot independently verify the same record'); end if;
  if coalesce(length(trim(p_note)),0)<20 then return jsonb_build_object('error','record a substantive verification method and conclusion'); end if;
  if exists(select 1 from unnest(a.evidence_item_ids) x(id) left join public.evidence_items e
    on e.id=x.id and e.organization_id=v_org where e.id is null or e.verification_status<>'verified') then
    return jsonb_build_object('error','cited evidence must be independently verified before the assessment can be verified'); end if;
  update public.recommendation_obligation_risks set status='verified',verified_by=auth.uid(),
    verified_at=now(),verification_note=trim(p_note) where id=a.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'recommendation_contract_risk_verification',v_role,jsonb_build_object('assessment_id',a.id,
    'recommendation_id',a.recommendation_id,'independent',true,
    'boundary','verification does not approve, reject, modify, escalate, dismiss or execute the recommendation'));
  return jsonb_build_object('assessment_id',a.id,'status','verified');
end $$;

create or replace function public.get_service_contract_risk_workspace()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.app_current_org() is null then jsonb_build_object('error','forbidden') else
    jsonb_build_object(
      'commitment_types',jsonb_build_array('availability_guarantee','response_time_guarantee',
        'reliability_guarantee','punctuality_target','service_standard','maintenance_contract',
        'performance_based_logistics','warranty','concession_requirement'),
      'obligations',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc)
        from public.risk_obligations o where o.organization_id=public.app_current_org()
          and o.service_commitment_type is not null),'[]'::jsonb),
      'assessments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,
        'recommendation_id',a.recommendation_id,'recommendation_title',r.title,
        'obligation_id',a.obligation_id,'source_reference',o.source_reference,
        'commitment_type',o.service_commitment_type,'breach_state',a.breach_state,
        'risk_rating',a.risk_rating,'exposure_basis',a.exposure_basis,'actual_value',a.actual_value,
        'actual_unit',a.actual_unit,'estimated_penalty_exposure',a.estimated_penalty_exposure,
        'currency',a.currency,'evidence_item_ids',a.evidence_item_ids,'missing_evidence',a.missing_evidence,
        'status',a.status,'recorded_by',a.recorded_by,'verified_by',a.verified_by,
        'verified_at',a.verified_at,'verification_note',a.verification_note) order by a.recorded_at desc)
        from public.recommendation_obligation_risks a join public.recommendations r
          on r.id=a.recommendation_id and r.organization_id=a.organization_id
        join public.risk_obligations o on o.id=a.obligation_id and o.organization_id=a.organization_id
        where a.organization_id=public.app_current_org() and a.status in ('draft','verified')
          and (r.risk_id is null or public.can_read_risk(r.risk_id))),'[]'::jsonb),
      'basis','Contractual risk is evidence-backed context on canonical recommendations. It never approves a recommendation, accepts risk or releases work.'
    ) end
$$;

revoke all on function public.record_service_contract_obligation(jsonb) from public,anon;
revoke all on function public.adopt_service_contract_obligation(uuid,text) from public,anon;
revoke all on function public.create_service_contract_obligation_version(uuid,jsonb,text) from public,anon;
revoke all on function public.record_recommendation_contract_risk(jsonb) from public,anon;
revoke all on function public.verify_recommendation_contract_risk(uuid,text) from public,anon;
revoke all on function public.get_service_contract_risk_workspace() from public,anon;
grant execute on function public.record_service_contract_obligation(jsonb) to authenticated,service_role;
grant execute on function public.adopt_service_contract_obligation(uuid,text) to authenticated,service_role;
grant execute on function public.create_service_contract_obligation_version(uuid,jsonb,text) to authenticated,service_role;
grant execute on function public.record_recommendation_contract_risk(jsonb) to authenticated,service_role;
grant execute on function public.verify_recommendation_contract_risk(uuid,text) to authenticated,service_role;
grant execute on function public.get_service_contract_risk_workspace() to authenticated,service_role;

comment on table public.recommendation_obligation_risks is
  'U13.01 evidence-backed service/contract exposure linked to canonical recommendations; never an approval or work authority.';
