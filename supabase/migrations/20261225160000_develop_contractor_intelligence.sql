-- ============================================================================
-- Sync Develop D6.02 — contractor cross-project performance intelligence.
--
-- Exactly five independent dimensions, accrued from recorded acts:
--   1. schedule reliability  — canonical dated contract-package receipts;
--   2. NCR rate              — canonical supplier NCRs / acceptance tests;
--   3. engineering response  — the one missing evidence family added here;
--   4. rework rate           — canonical inspected and reworked quantities;
--   5. warranty claims       — canonical warranty claims and recoveries.
--
-- This does not score, rank, recommend or award a supplier. Each dimension
-- answers or refuses independently and carries its numerator, denominator,
-- observation window and project coverage. A procurement evaluator sees the
-- evidence after bid opening; sealed-bid confidentiality is unchanged.
-- ============================================================================

create table if not exists public.contractor_engineering_responses (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id bigint not null references public.suppliers(id) on delete restrict,
  development_case_id uuid not null references public.development_cases(id) on delete restrict,
  package_id bigint not null references public.contract_packages(id) on delete restrict,
  response_ref text not null,
  requested_at timestamptz not null,
  responded_at timestamptz not null,
  request_summary text not null,
  response_summary text not null,
  basis text not null,
  request_evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  response_evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, response_ref),
  check (responded_at >= requested_at),
  check (length(btrim(response_ref)) >= 3),
  check (length(btrim(request_summary)) >= 10),
  check (length(btrim(response_summary)) >= 10),
  check (length(btrim(basis)) >= 10)
);

create index if not exists idx_contractor_engineering_responses_supplier
  on public.contractor_engineering_responses
    (organization_id, supplier_id, responded_at desc);
create index if not exists idx_contractor_engineering_responses_case
  on public.contractor_engineering_responses
    (organization_id, development_case_id, responded_at desc);

alter table public.contractor_engineering_responses enable row level security;
drop policy if exists contractor_engineering_responses_read
  on public.contractor_engineering_responses;
create policy contractor_engineering_responses_read
  on public.contractor_engineering_responses
  for select to authenticated
  using (organization_id = public.app_current_org());

comment on table public.contractor_engineering_responses is
  'D6.02 / spec I.15: immutable, evidence-backed measurements of elapsed contractor engineering response time. This is the only new fact family in D6.02; schedule, NCR, rework and warranty evidence remain in their canonical stores.';

create or replace function public.enforce_contractor_engineering_response_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.contractor_engineering_response_write', true), '');
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'contractor engineering-response history is evidence and cannot be truncated'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'an engineering-response measurement is immutable; record a correction as a separately evidenced measurement'
      using errcode = 'insufficient_privilege';
  end if;
  if v_marker <> 'granted' then
    raise exception 'engineering-response evidence is written only through record_contractor_engineering_response'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.suppliers s
    where s.id = new.supplier_id and s.organization_id = new.organization_id
  ) then
    raise exception 'supplier does not belong to this organization'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.development_cases c
    where c.id = new.development_case_id and c.organization_id = new.organization_id
  ) then
    raise exception 'development case does not belong to this organization'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.contract_packages p
    where p.id = new.package_id
      and p.organization_id = new.organization_id
      and p.development_case_id = new.development_case_id
  ) then
    raise exception 'procurement package does not belong to this organization and development case'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.evidence_items e
    where e.id = new.request_evidence_item_id and e.organization_id = new.organization_id
  ) or not exists (
    select 1 from public.evidence_items e
    where e.id = new.response_evidence_item_id and e.organization_id = new.organization_id
  ) then
    raise exception 'request and response evidence must both belong to this organization'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_contractor_engineering_response_scope()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_contractor_engineering_response_scope
  on public.contractor_engineering_responses;
create trigger trg_contractor_engineering_response_scope
  before insert or update or delete on public.contractor_engineering_responses
  for each row execute function public.enforce_contractor_engineering_response_scope();

drop trigger if exists trg_contractor_engineering_response_no_truncate
  on public.contractor_engineering_responses;
create trigger trg_contractor_engineering_response_no_truncate
  before truncate on public.contractor_engineering_responses
  for each statement execute function public.enforce_contractor_engineering_response_scope();

revoke insert, update, delete, truncate on public.contractor_engineering_responses
  from anon, authenticated, service_role;

create or replace function public.record_contractor_engineering_response(
  p_package_id bigint,
  p_supplier_id bigint,
  p_measurement jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text;
  p public.contract_packages%rowtype;
  v_ref text := nullif(btrim(coalesce(p_measurement->>'responseRef','')), '');
  v_requested timestamptz;
  v_responded timestamptz;
  v_request text := nullif(btrim(coalesce(p_measurement->>'requestSummary','')), '');
  v_response text := nullif(btrim(coalesce(p_measurement->>'responseSummary','')), '');
  v_basis text := nullif(btrim(coalesce(p_measurement->>'basis','')), '');
  v_request_evidence uuid;
  v_response_evidence uuid;
  v_id bigint;
begin
  if v_org is null or v_actor is null then
    return jsonb_build_object('error','forbidden');
  end if;
  select role into v_role from public.user_profiles
  where id = v_actor and organization_id = v_org;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error','AI identities cannot record contractor performance evidence');
  end if;
  if coalesce(v_role,'') not in
    ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording engineering-response evidence requires a planning, engineering or governance role');
  end if;
  select * into p from public.contract_packages
  where id = p_package_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','procurement package not found'); end if;
  if p.development_case_id is null then
    return jsonb_build_object('error','the procurement package has no development case, so this measurement has no project context');
  end if;
  if not exists (
    select 1 from public.package_bidders pb
    where pb.package_id = p.id and pb.supplier_id = p_supplier_id
  ) and p.awarded_supplier_id is distinct from p_supplier_id then
    return jsonb_build_object('error','supplier was not invited to or awarded this package');
  end if;
  begin
    v_requested := (p_measurement->>'requestedAt')::timestamptz;
    v_responded := (p_measurement->>'respondedAt')::timestamptz;
    v_request_evidence := (p_measurement->>'requestEvidenceItemId')::uuid;
    v_response_evidence := (p_measurement->>'responseEvidenceItemId')::uuid;
  exception when others then
    return jsonb_build_object('error','requestedAt, respondedAt and both evidence item IDs must be valid');
  end;
  if v_ref is null or length(v_ref) < 3
     or v_request is null or length(v_request) < 10
     or v_response is null or length(v_response) < 10
     or v_basis is null or length(v_basis) < 10 then
    return jsonb_build_object('error','state the response reference, request, response and measurement basis');
  end if;
  if v_requested is null or v_responded is null or v_responded < v_requested then
    return jsonb_build_object('error','response time cannot be negative and both timestamps are required');
  end if;
  if v_requested > now() or v_responded > now() then
    return jsonb_build_object('error','an engineering-response measurement cannot be recorded from the future');
  end if;
  if not exists (select 1 from public.evidence_items e where e.id=v_request_evidence and e.organization_id=v_org)
     or not exists (select 1 from public.evidence_items e where e.id=v_response_evidence and e.organization_id=v_org) then
    return jsonb_build_object('error','request and response evidence must both belong to this organization');
  end if;

  perform set_config('app.contractor_engineering_response_write','granted',true);
  insert into public.contractor_engineering_responses(
    organization_id,supplier_id,development_case_id,package_id,response_ref,
    requested_at,responded_at,request_summary,response_summary,basis,
    request_evidence_item_id,response_evidence_item_id,recorded_by)
  values (
    v_org,p_supplier_id,p.development_case_id,p.id,v_ref,
    v_requested,v_responded,v_request,v_response,v_basis,
    v_request_evidence,v_response_evidence,v_actor)
  returning id into v_id;
  perform set_config('app.contractor_engineering_response_write','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values (v_org,'contractor_engineering_response',coalesce(v_role,'unknown'),
    jsonb_build_object('supplierId',p_supplier_id,'packageId',p.id,
      'developmentCaseId',p.development_case_id,'responseRef',v_ref,
      'requestedAt',v_requested,'respondedAt',v_responded,
      'elapsedHours',round(extract(epoch from (v_responded-v_requested))/3600.0,2),
      'requestEvidenceItemId',v_request_evidence,
      'responseEvidenceItemId',v_response_evidence,'basis',v_basis,
      'action','recorded'),null,
    jsonb_build_object('measurementId',v_id,'supplierId',p_supplier_id,
      'packageId',p.id,'developmentCaseId',p.development_case_id,
      'responseRef',v_ref,'immutable',true));

  return jsonb_build_object('measurementId',v_id,'supplierId',p_supplier_id,
    'packageId',p.id,'developmentCaseId',p.development_case_id,
    'elapsedHours',round(extract(epoch from (v_responded-v_requested))/3600.0,2),
    'immutable',true);
exception
  when unique_violation then
    perform set_config('app.contractor_engineering_response_write','',true);
    return jsonb_build_object('error','that engineering-response reference is already recorded');
end
$$;

revoke all on function public.record_contractor_engineering_response(bigint,bigint,jsonb)
  from public, anon, service_role;
grant execute on function public.record_contractor_engineering_response(bigint,bigint,jsonb)
  to authenticated;

comment on function public.record_contractor_engineering_response(bigint,bigint,jsonb) is
  'D6.02: records one immutable, fully evidenced engineering-response measurement for a supplier on a real project package. It is a fact, not an evaluation or award decision.';

create or replace function public.get_contractor_performance_evidence(p_supplier_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  s public.suppliers%rowtype;
  v_schedule_total int; v_schedule_ontime int; v_schedule_projects int;
  v_schedule_first timestamptz; v_schedule_last timestamptz;
  v_ncrs int; v_tests int; v_quality_projects int;
  v_quality_first timestamptz; v_quality_last timestamptz;
  v_response_count int; v_response_projects int; v_response_hours numeric;
  v_response_first timestamptz; v_response_last timestamptz;
  v_inspected numeric; v_reworked numeric; v_rework_projects int;
  v_rework_first timestamptz; v_rework_last timestamptz;
  v_claims int; v_unvalued int; v_claim_currencies int; v_claim_currency text;
  v_claimed numeric; v_recovered numeric; v_warranty_projects int;
  v_warranty_first timestamptz; v_warranty_last timestamptz;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select * into s from public.suppliers where id=p_supplier_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','supplier not found'); end if;

  select count(*),count(*) filter(where p.actual_delivery_date<=p.required_date),
         count(distinct p.development_case_id),min(p.actual_delivery_date)::timestamptz,
         max(p.actual_delivery_date)::timestamptz
  into v_schedule_total,v_schedule_ontime,v_schedule_projects,v_schedule_first,v_schedule_last
  from public.contract_packages p
  where p.organization_id=v_org and p.awarded_supplier_id=s.id
    and p.required_date is not null and p.actual_delivery_date is not null;

  select count(*),count(distinct n.project_id),min(n.detected_at),max(n.detected_at)
  into v_ncrs,v_quality_projects,v_quality_first,v_quality_last
  from public.quality_ncrs n
  where n.organization_id=v_org and n.supplier_id=s.id and n.status<>'cancelled';
  select count(*) into v_tests from public.acceptance_tests t
  where t.organization_id=v_org and t.supplier_id=s.id and t.performed_on is not null
    and t.outcome<>'not_performed';

  select count(*),count(distinct r.development_case_id),
         avg(extract(epoch from (r.responded_at-r.requested_at))/3600.0),
         min(r.requested_at),max(r.responded_at)
  into v_response_count,v_response_projects,v_response_hours,v_response_first,v_response_last
  from public.contractor_engineering_responses r
  where r.organization_id=v_org and r.supplier_id=s.id;

  select coalesce(sum(d.inspected_quantity),0),coalesce(sum(d.reworked_quantity),0),
         count(distinct d.project_id),min(d.detected_at),max(d.detected_at)
  into v_inspected,v_reworked,v_rework_projects,v_rework_first,v_rework_last
  from public.quality_defects d
  where d.organization_id=v_org and d.supplier_id=s.id;

  select count(*),count(*) filter(where c.claim_value is null or c.currency is null),
         count(distinct coalesce(c.currency,'(none stated)')),min(c.currency),
         sum(c.claim_value),sum(c.recovered_value),
         count(distinct p.development_case_id),min(c.raised_on)::timestamptz,max(c.raised_on)::timestamptz
  into v_claims,v_unvalued,v_claim_currencies,v_claim_currency,v_claimed,v_recovered,
       v_warranty_projects,v_warranty_first,v_warranty_last
  from public.warranty_claims c
  join public.warranty_terms w on w.id=c.warranty_id and w.organization_id=v_org
  left join public.contract_packages p on p.id=w.package_id and p.organization_id=v_org
  where c.organization_id=v_org and w.supplier_id=s.id and c.status<>'withdrawn';

  return jsonb_build_object(
    'supplierId',s.id,'supplier',s.name,'supplierCode',s.supplier_code,
    'dimensions',jsonb_build_object(
      'scheduleReliability',jsonb_build_object(
        'answered',v_schedule_total>0,'value',case when v_schedule_total>0 then round(100.0*v_schedule_ontime/v_schedule_total,2) end,
        'unit','%','numerator',v_schedule_ontime,'denominator',v_schedule_total,
        'formula','completed, dated contract receipts on/before required date / completed, dated contract receipts × 100',
        'projectCount',v_schedule_projects,'firstObservedAt',v_schedule_first,'lastObservedAt',v_schedule_last,
        'refusal',case when v_schedule_total=0 then 'There is no completed, dated contract receipt with a required date for this supplier; schedule reliability is not assessable, not 100%.' end),
      'ncrRate',jsonb_build_object(
        'answered',v_tests>0,'value',case when v_tests>0 then round(100.0*v_ncrs/v_tests,2) end,
        'unit','NCRs per 100 acceptance tests','numerator',v_ncrs,'denominator',v_tests,
        'formula','non-cancelled supplier NCRs / performed supplier acceptance tests × 100',
        'projectCount',v_quality_projects,'firstObservedAt',v_quality_first,'lastObservedAt',v_quality_last,
        'refusal',case when v_tests=0 then 'There is no supplier-linked acceptance test to provide the NCR-rate denominator; zero recorded NCRs is not a zero percent NCR rate.' end),
      'engineeringResponse',jsonb_build_object(
        'answered',v_response_count>0,'value',case when v_response_count>0 then round(v_response_hours,2) end,
        'unit','hours average','numerator',case when v_response_count>0 then round(v_response_hours*v_response_count,2) end,
        'denominator',v_response_count,'formula','sum of evidenced request-to-response hours / completed engineering responses',
        'projectCount',v_response_projects,'firstObservedAt',v_response_first,'lastObservedAt',v_response_last,
        'refusal',case when v_response_count=0 then 'There is no completed engineering response with evidence for both timestamps; response time is not assessable.' end),
      'reworkRate',jsonb_build_object(
        'answered',v_inspected>0,'value',case when v_inspected>0 then round(100.0*v_reworked/v_inspected,2) end,
        'unit','%','numerator',v_reworked,'denominator',v_inspected,
        'formula','supplier-attributed reworked quantity / supplier-attributed inspected quantity × 100',
        'projectCount',v_rework_projects,'firstObservedAt',v_rework_first,'lastObservedAt',v_rework_last,
        'refusal',case when v_inspected=0 then 'There is no inspected quantity attributed to this supplier; rework rate is not assessable, not zero.' end),
      'warrantyClaims',jsonb_build_object(
        'answered',v_claims>0 and v_unvalued=0 and v_claim_currencies=1,
        'value',case when v_claims>0 and v_unvalued=0 and v_claim_currencies=1 then v_claimed end,
        'unit',case when v_claims>0 and v_unvalued=0 and v_claim_currencies=1 then v_claim_currency end,
        'numerator',v_claimed,'denominator',v_claims,'claimCount',v_claims,'recoveredValue',v_recovered,
        'formula','sum of recorded warranty claim values, only when every claim states one common currency',
        'projectCount',v_warranty_projects,'firstObservedAt',v_warranty_first,'lastObservedAt',v_warranty_last,
        'refusal',case
          when v_claims=0 then 'No warranty claim is recorded for this supplier. Absence of a claim is not evidence of zero warranty exposure.'
          when v_unvalued>0 then format('%s warranty claim(s) have no value or currency, so a monetary total is refused.',v_unvalued)
          when v_claim_currencies>1 then 'Warranty claims use more than one currency. Sync holds no exchange rate, so the values are not added.' end)
    ),
    'basis','Exactly five independent dimensions accrued from canonical project and quality records. This evidence does not score, rank, recommend or award a supplier.'
  );
end
$$;

revoke all on function public.get_contractor_performance_evidence(bigint)
  from public, anon, service_role;
grant execute on function public.get_contractor_performance_evidence(bigint)
  to authenticated;

create or replace function public.get_package_contractor_intelligence(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  p public.contract_packages%rowtype;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select * into p from public.contract_packages
  where id=p_package_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','procurement package not found'); end if;
  if p.bids_close_at is null then
    return jsonb_build_object('packageId',p.id,'answered',false,'suppliers','[]'::jsonb,
      'refusal','This package has not been issued for tender, so there is no procurement evaluation in which to show contractor history.');
  end if;
  if p.bids_opened_at is null then
    return jsonb_build_object('packageId',p.id,'answered',false,'suppliers','[]'::jsonb,
      'refusal','Contractor performance evidence is withheld until the bids are opened. Showing it while envelopes remain sealed could identify or bias the evaluation of a lodged bid.');
  end if;
  return jsonb_build_object('packageId',p.id,'answered',true,
    'suppliers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'bidId',b.id,'supplierId',s.id,'supplier',s.name,'supplierCode',s.supplier_code,
        'evidence',public.get_contractor_performance_evidence(s.id)) order by s.name)
      from public.contract_bids b
      join public.suppliers s on s.id=b.supplier_id and s.organization_id=v_org
      where b.package_id=p.id and b.organization_id=v_org and b.withdrawn_at is null
    ),'[]'::jsonb),
    'basis','Historical contractor evidence is shown beside the opened bids. It is not a bid score, recommendation or award decision.');
end
$$;

revoke all on function public.get_package_contractor_intelligence(bigint)
  from public, anon, service_role;
grant execute on function public.get_package_contractor_intelligence(bigint)
  to authenticated;

comment on function public.get_package_contractor_intelligence(bigint) is
  'D6.02: procurement-time evidence for each live opened bid. Before bid opening it returns a named refusal and no supplier evidence, preserving the sealed-tender boundary.';
