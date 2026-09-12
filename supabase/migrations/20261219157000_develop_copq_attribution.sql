-- D4.07 / spec I.14 — six-term Cost of Poor Quality and forecast attribution.
--
-- Canonical reuse:
--   * quality_cost_entries remains the ONE sourced quality-cost ledger;
--   * quality_defects.scrap_cost and quality_rework_records remain the atomic
--     scrap and rework sources;
--   * project_scope_changes remains the ONE post-baseline scope-growth record;
--   * development_cases is referenced, never copied.
--
-- This calculates and presents recorded attribution. It does not approve a
-- claim, change, forecast, baseline, regulatory conclusion or operating act.

alter table public.quality_cost_entries
  add column if not exists development_case_id uuid
    references public.development_cases(id) on delete set null,
  add column if not exists copq_term text,
  add column if not exists forecast_growth_amount numeric,
  add column if not exists forecast_growth_basis text;

alter table public.quality_cost_entries
  drop constraint if exists quality_cost_copq_term,
  add constraint quality_cost_copq_term check (
    copq_term is null or copq_term in
      ('rework','scrap','retesting','delay','claims','startup_failures')
  ),
  drop constraint if exists quality_cost_failure_term_required,
  add constraint quality_cost_failure_term_required check (
    (category in ('internal_failure','external_failure') and copq_term is not null)
    or (category in ('prevention','appraisal') and copq_term is null)
  ) not valid,
  drop constraint if exists quality_cost_forecast_growth_complete,
  add constraint quality_cost_forecast_growth_complete check (
    forecast_growth_amount is null
    or (category in ('internal_failure','external_failure')
        and copq_term is not null
        and forecast_growth_amount >= 0
        and forecast_growth_amount < 'Infinity'::numeric
        and development_case_id is not null
        and coalesce(length(btrim(forecast_growth_basis)),0) >= 10)
  ) not valid;

create index if not exists idx_quality_cost_case_forecast
  on public.quality_cost_entries(
    organization_id,development_case_id,currency,incurred_at
  ) where development_case_id is not null;

create or replace function public.enforce_quality_cost_attribution_scope()
returns trigger language plpgsql set search_path=public
as $$
declare v_case_project bigint; v_linked_project bigint;
begin
  if new.development_case_id is null then return new; end if;
  select capital_project_id into v_case_project
  from public.development_cases
  where id=new.development_case_id and organization_id=new.organization_id;
  if not found then
    raise exception 'quality cost development case must belong to this organization';
  end if;

  if new.ncr_id is not null then
    select project_id into v_linked_project from public.quality_ncrs
    where id=new.ncr_id and organization_id=new.organization_id;
  elsif new.defect_id is not null then
    select project_id into v_linked_project from public.quality_defects
    where id=new.defect_id and organization_id=new.organization_id;
  end if;
  if v_linked_project is not null
     and v_case_project is distinct from v_linked_project then
    raise exception 'quality cost case and linked quality record name different capital projects';
  end if;
  return new;
end $$;

drop trigger if exists trg_quality_cost_attribution_scope
  on public.quality_cost_entries;
create trigger trg_quality_cost_attribution_scope
before insert or update on public.quality_cost_entries
for each row execute function public.enforce_quality_cost_attribution_scope();

revoke all on function public.enforce_quality_cost_attribution_scope()
  from public,anon,authenticated;

create or replace function public.quality_scope_in_org(p_record jsonb,p_org uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select p_org is not null
    and (nullif(p_record->>'assetId','') is null or exists(
      select 1 from public.assets where id=(p_record->>'assetId')::uuid and organization_id=p_org))
    and (nullif(p_record->>'projectId','') is null or exists(
      select 1 from public.capital_projects where id=(p_record->>'projectId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'supplierId','') is null or exists(
      select 1 from public.suppliers where id=(p_record->>'supplierId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'workOrderId','') is null or exists(
      select 1 from public.work_orders where id=(p_record->>'workOrderId')::uuid and organization_id=p_org))
    and (nullif(p_record->>'requirementId','') is null or exists(
      select 1 from public.quality_requirements where id=(p_record->>'requirementId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'itpId','') is null or exists(
      select 1 from public.quality_itps where id=(p_record->>'itpId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'itpPointId','') is null or exists(
      select 1 from public.quality_itp_points where id=(p_record->>'itpPointId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'ncrId','') is null or exists(
      select 1 from public.quality_ncrs where id=(p_record->>'ncrId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'defectId','') is null or exists(
      select 1 from public.quality_defects where id=(p_record->>'defectId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'ownerId','') is null or exists(
      select 1 from public.user_profiles where id=(p_record->>'ownerId')::uuid and organization_id=p_org))
    and (nullif(p_record->>'designRequirementId','') is null or exists(
      select 1 from public.design_requirements where id=(p_record->>'designRequirementId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'developmentCaseId','') is null or exists(
      select 1 from public.development_cases where id=(p_record->>'developmentCaseId')::uuid and organization_id=p_org));
$$;
revoke all on function public.quality_scope_in_org(jsonb,uuid)
  from public,anon,authenticated;

create or replace function public.record_quality_cost(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_id bigint;
  v_evidence uuid; v_case uuid; v_category text:=p_record->>'category';
  v_term text:=nullif(p_record->>'copqTerm',''); v_forecast numeric;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.quality_scope_in_org(p_record,v_org) then
    return jsonb_build_object('error','one or more scoped records are outside this organization');
  end if;
  v_evidence:=nullif(p_record->>'evidenceItemId','')::uuid;
  v_case:=nullif(p_record->>'developmentCaseId','')::uuid;
  if v_evidence is not null and not public.quality_evidence_in_org(v_evidence,v_org) then
    return jsonb_build_object('error','cost evidence is outside this organization');
  end if;
  if v_category in ('internal_failure','external_failure')
     and coalesce(v_term,'') not in
       ('rework','scrap','retesting','delay','claims','startup_failures') then
    return jsonb_build_object('error','failure cost requires one COPQ term: rework, scrap, retesting, delay, claims or startup_failures');
  end if;
  if v_category in ('prevention','appraisal') and v_term is not null then
    return jsonb_build_object('error','prevention and appraisal are Cost of Quality, not a COPQ failure term');
  end if;
  if nullif(p_record->>'forecastGrowthAmount','') is not null then
    if v_category not in ('internal_failure','external_failure') then
      return jsonb_build_object('error','forecast quality growth requires an internal or external failure cost');
    end if;
    v_forecast:=public.sync_text_as_numeric(p_record->>'forecastGrowthAmount');
    if v_forecast is null or v_forecast < 0 or v_forecast >= 'Infinity'::numeric then
      return jsonb_build_object('error','forecast growth amount must be a finite non-negative number');
    end if;
    if v_case is null or coalesce(length(btrim(p_record->>'forecastGrowthBasis')),0)<10 then
      return jsonb_build_object('error','forecast growth requires a development case and stated basis');
    end if;
  end if;
  insert into public.quality_cost_entries(
    organization_id,ncr_id,defect_id,work_order_id,incurred_at,category,amount,
    currency,cost_type,source_reference,evidence_item_id,recorded_by,
    development_case_id,copq_term,forecast_growth_amount,forecast_growth_basis)
  values(v_org,nullif(p_record->>'ncrId','')::bigint,nullif(p_record->>'defectId','')::bigint,
    nullif(p_record->>'workOrderId','')::uuid,(p_record->>'incurredAt')::timestamptz,
    v_category,(p_record->>'amount')::numeric,upper(p_record->>'currency'),
    btrim(p_record->>'costType'),btrim(p_record->>'sourceReference'),v_evidence,v_actor,
    v_case,v_term,v_forecast,nullif(btrim(p_record->>'forecastGrowthBasis'),''))
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'quality_cost','member',jsonb_build_object(
    'id',v_id,'action','recorded','category',v_category,'copq_term',v_term,
    'development_case_id',v_case,'forecast_growth_amount',v_forecast));
  return jsonb_build_object('id',v_id,'status','recorded','copqTerm',v_term,
    'developmentCaseId',v_case,'forecastGrowthAmount',v_forecast);
end $$;
revoke all on function public.record_quality_cost(jsonb) from public,anon;
grant execute on function public.record_quality_cost(jsonb) to authenticated;

create or replace function public.get_quality_cost_attribution(
  p_from timestamptz default null,p_to timestamptz default null)
returns jsonb language sql stable security invoker set search_path=public
as $$
with bounds as (
  select app_current_org() org,coalesce(p_from,'-infinity'::timestamptz) since,
         coalesce(p_to,'infinity'::timestamptz) until
), ledger as (
  select currency,'internal_failure' category,'scrap' term,scrap_cost amount
  from quality_defects,bounds where organization_id=org
    and detected_at>=since and detected_at<until and scrap_cost>0
  union all
  select currency,'internal_failure','rework',
    labour_cost+material_cost+equipment_cost+downtime_cost+external_cost
  from quality_rework_records,bounds where organization_id=org
    and started_at>=since and started_at<until
  union all
  select currency,category,copq_term,amount from quality_cost_entries,bounds
  where organization_id=org and incurred_at>=since and incurred_at<until
), grouped as (
  select currency,
    sum(amount) filter(where category='prevention') prevention,
    sum(amount) filter(where category='appraisal') appraisal,
    sum(amount) filter(where category='internal_failure') internal_failure,
    sum(amount) filter(where category='external_failure') external_failure,
    sum(amount) filter(where category in ('internal_failure','external_failure') and term is null) unattributed,
    jsonb_build_object(
      'rework',coalesce(sum(amount) filter(where term='rework'),0),
      'scrap',coalesce(sum(amount) filter(where term='scrap'),0),
      'retesting',coalesce(sum(amount) filter(where term='retesting'),0),
      'delay',coalesce(sum(amount) filter(where term='delay'),0),
      'claims',coalesce(sum(amount) filter(where term='claims'),0),
      'startup_failures',coalesce(sum(amount) filter(where term='startup_failures'),0)
    ) terms
  from ledger group by currency
)
select coalesce(jsonb_agg(jsonb_build_object(
  'currency',currency,'prevention',coalesce(prevention,0),
  'appraisal',coalesce(appraisal,0),'internalFailure',coalesce(internal_failure,0),
  'externalFailure',coalesce(external_failure,0),'copqByTerm',terms,
  'unattributedFailure',coalesce(unattributed,0),
  'costOfPoorQuality',coalesce(internal_failure,0)+coalesce(external_failure,0),
  'totalCostOfQuality',coalesce(prevention,0)+coalesce(appraisal,0)+
    coalesce(internal_failure,0)+coalesce(external_failure,0)
) order by currency),'[]'::jsonb) from grouped;
$$;
revoke all on function public.get_quality_cost_attribution(timestamptz,timestamptz)
  from public,anon;
grant execute on function public.get_quality_cost_attribution(timestamptz,timestamptz)
  to authenticated;

create or replace function public.get_quality_forecast_attribution(
  p_from timestamptz default null,p_to timestamptz default null)
returns jsonb language sql stable security invoker set search_path=public
as $$
with bounds as (
  select app_current_org() org,coalesce(p_from,'-infinity'::timestamptz) since,
         coalesce(p_to,'infinity'::timestamptz) until
), quality as (
  select development_case_id,currency,sum(forecast_growth_amount) quality_growth,
    count(*) quality_count
  from quality_cost_entries,bounds where organization_id=org
    and incurred_at>=since and incurred_at<until
    and development_case_id is not null and forecast_growth_amount is not null
  group by development_case_id,currency
), scope as (
  select sc.development_case_id,sc.currency,
    coalesce(sum(sc.cost_effect) filter(where sc.cost_effect>0),0) scope_growth,
    count(*) filter(where sc.cost_effect>0) scope_count,
    count(*) filter(where sc.cost_effect is null) uncosted_count,
    count(*) filter(where sc.cost_effect<=0) non_growth_count
  from project_scope_changes sc join development_baselines b on b.id=sc.baseline_id,
       bounds
  where sc.organization_id=org and sc.added_at>=since and sc.added_at<until
    and b.status='approved' and b.baseline_type='SCOPE'
  group by sc.development_case_id,sc.currency
), joined as (
  select coalesce(q.development_case_id,s.development_case_id) case_id,
    coalesce(q.currency,s.currency) currency,coalesce(q.quality_growth,0) quality_growth,
    coalesce(s.scope_growth,0) scope_growth,coalesce(q.quality_count,0) quality_count,
    coalesce(s.scope_count,0) scope_count,coalesce(s.uncosted_count,0) uncosted_count,
    coalesce(s.non_growth_count,0) non_growth_count
  from quality q full join scope s
    on s.development_case_id=q.development_case_id and s.currency=q.currency
)
select coalesce(jsonb_agg(jsonb_build_object(
  'developmentCaseId',j.case_id,
  'caseRef',coalesce(cp.project_code,'CASE-'||left(j.case_id::text,8)),
  'caseTitle',c.title,'currency',j.currency,
  'qualityFailureGrowth',j.quality_growth,'scopeGrowth',j.scope_growth,
  'combinedGrowth',case when j.uncosted_count=0 then j.quality_growth+j.scope_growth else null end,
  'qualitySharePct',case when j.uncosted_count=0 and j.quality_growth+j.scope_growth>0
    then round(100*j.quality_growth/(j.quality_growth+j.scope_growth),2) else null end,
  'qualityEntryCount',j.quality_count,'scopeChangeCount',j.scope_count,
  'uncostedScopeChangeCount',j.uncosted_count,
  'nonGrowthScopeChangeCount',j.non_growth_count,
  'basis','Recorded quality-ledger forecast growth versus positive cost effects on the currently approved SCOPE baseline. Uncosted scope changes make the combined figure and share unavailable; reductions are counted but not called growth. Currencies are never combined.'
) order by c.title,j.currency),'[]'::jsonb)
from joined j join development_cases c on c.id=j.case_id
left join capital_projects cp on cp.id=c.capital_project_id;
$$;
revoke all on function public.get_quality_forecast_attribution(timestamptz,timestamptz)
  from public,anon;
grant execute on function public.get_quality_forecast_attribution(timestamptz,timestamptz)
  to authenticated;

alter function public.get_quality_cockpit(timestamptz,timestamptz)
  rename to get_quality_cockpit_before_d407;
revoke all on function public.get_quality_cockpit_before_d407(timestamptz,timestamptz)
  from public,anon;
grant execute on function public.get_quality_cockpit_before_d407(timestamptz,timestamptz)
  to authenticated;

create or replace function public.get_quality_cockpit(
  p_from timestamptz default null,p_to timestamptz default null)
returns jsonb language sql stable security invoker set search_path=public
as $$
  select public.get_quality_cockpit_before_d407(p_from,p_to)
    || jsonb_build_object(
      'costByCurrency',public.get_quality_cost_attribution(p_from,p_to),
      'forecastAttribution',public.get_quality_forecast_attribution(p_from,p_to),
      'basis','Seven quality metrics plus six-term COPQ attribution from atomic records. Forecast attribution compares recorded quality-failure growth with positive cost effects on the existing approved scope baseline. Legacy unclassified failure cost and incomplete scope costing stay visible; currencies are never combined. This calculation approves nothing.'
    );
$$;
revoke all on function public.get_quality_cockpit(timestamptz,timestamptz)
  from public,anon;
grant execute on function public.get_quality_cockpit(timestamptz,timestamptz)
  to authenticated;

comment on function public.get_quality_cockpit(timestamptz,timestamptz) is
  'D4.07: customer-reachable six-term COPQ and quality-versus-scope forecast attribution. Calculation only; no approval or certification.';
