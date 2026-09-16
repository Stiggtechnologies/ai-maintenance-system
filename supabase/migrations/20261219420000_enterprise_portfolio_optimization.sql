-- U11.01 — governed enterprise portfolio optimization.
--
-- Canonical reuse: development_cases/capital_projects are the candidate
-- identities; capital_plan_items is extended in place for portfolio inputs;
-- evidence_items supplies provenance; calculation_runs is the immutable run
-- ledger; recommendations + approvals retain the human decision boundary.
-- No project, risk, approval, work, scenario, or audit system is duplicated.

alter table public.capital_plan_items
  add column if not exists development_case_id uuid references public.development_cases(id) on delete cascade,
  add column if not exists portfolio_category text,
  add column if not exists currency text,
  add column if not exists cost_low numeric,
  add column if not exists cost_high numeric,
  add column if not exists benefit_low numeric,
  add column if not exists benefit_high numeric,
  add column if not exists benefit_probability numeric,
  add column if not exists risk_reduction_value numeric,
  add column if not exists earliest_start date,
  add column if not exists latest_start date,
  add column if not exists duration_months integer,
  add column if not exists evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  add column if not exists constraint_note text,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.capital_plan_items drop constraint if exists capital_plan_items_portfolio_category_check;
alter table public.capital_plan_items add constraint capital_plan_items_portfolio_category_check
  check (portfolio_category is null or portfolio_category in
    ('sustaining_capital','growth_capital','regulatory_capital','reliability',
     'obsolescence','decarbonization','safety_risk','life_extension',
     'modernization','capacity','decommissioning'));
alter table public.capital_plan_items drop constraint if exists capital_plan_items_portfolio_currency_check;
alter table public.capital_plan_items add constraint capital_plan_items_portfolio_currency_check
  check (currency is null or currency ~ '^[A-Z]{3}$');
alter table public.capital_plan_items drop constraint if exists capital_plan_items_portfolio_ranges_check;
alter table public.capital_plan_items add constraint capital_plan_items_portfolio_ranges_check check (
  (cost_low is null or cost_low>=0) and (cost_high is null or cost_high>=0)
  and (benefit_low is null or benefit_low>=0) and (benefit_high is null or benefit_high>=0)
  and (risk_reduction_value is null or risk_reduction_value>=0)
  and (benefit_probability is null or benefit_probability between 0 and 1)
  and (duration_months is null or duration_months>0)
  and (cost_low is null or cost_high is null or cost_low<=cost_high)
  and (benefit_low is null or benefit_high is null or benefit_low<=benefit_high)
  and (earliest_start is null or latest_start is null or earliest_start<=latest_start)
);

create unique index if not exists capital_plan_items_case_year_unique
  on public.capital_plan_items(organization_id,development_case_id,plan_year)
  where development_case_id is not null;
create index if not exists capital_plan_items_portfolio_idx
  on public.capital_plan_items(organization_id,plan_year,portfolio_category)
  where development_case_id is not null;

alter table public.recommendations
  add column if not exists portfolio_calculation_run_id uuid
    references public.calculation_runs(id) on delete restrict;
create unique index if not exists recommendations_portfolio_run_unique
  on public.recommendations(portfolio_calculation_run_id)
  where portfolio_calculation_run_id is not null;

create or replace function public.enforce_portfolio_recommendation_link()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.portfolio_calculation_run_id is not null
     and (tg_op='INSERT' or new.portfolio_calculation_run_id is distinct from old.portfolio_calculation_run_id)
     and coalesce(current_setting('app.portfolio_proposal_write',true),'')<>'on' then
    raise exception 'portfolio calculation links are created only by the governed proposal function';
  end if;
  if new.portfolio_calculation_run_id is not null and not exists(
    select 1 from public.calculation_runs r where r.id=new.portfolio_calculation_run_id
      and r.organization_id=new.organization_id and r.calculation_key='enterprise_portfolio_optimization'
      and r.status in ('computed','computed_with_refusals')) then
    raise exception 'portfolio recommendation requires a same-tenant computed portfolio run';
  end if;
  return new;
end $$;
drop trigger if exists trg_recommendations_portfolio_link on public.recommendations;
create trigger trg_recommendations_portfolio_link before insert or update on public.recommendations
for each row execute function public.enforce_portfolio_recommendation_link();

create or replace function public.configure_portfolio_candidate(p_candidate jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; v_case uuid;
  v_year int; v_evidence uuid; v_id bigint; v_currency text;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','forbidden');
  end if;
  begin v_case:=(p_candidate->>'developmentCaseId')::uuid;
  exception when others then return jsonb_build_object('error','a valid development case is required'); end;
  begin v_evidence:=(p_candidate->>'evidenceItemId')::uuid;
  exception when others then return jsonb_build_object('error','verified canonical evidence is required'); end;
  begin v_year:=(p_candidate->>'planYear')::int;
  exception when others then return jsonb_build_object('error','a valid plan year is required'); end;
  v_currency:=upper(btrim(coalesce(p_candidate->>'currency','')));
  if v_year not between extract(year from current_date)::int-1 and extract(year from current_date)::int+30 then
    return jsonb_build_object('error','plan year is outside the governed planning horizon');
  end if;
  if not exists(select 1 from public.development_cases where id=v_case and organization_id=v_org) then
    return jsonb_build_object('error','development case not found in this organization');
  end if;
  if not exists(select 1 from public.evidence_items where id=v_evidence and organization_id=v_org
    and verification_status='verified' and verified_by is distinct from auth.uid()) then
    return jsonb_build_object('error','candidate inputs require same-tenant evidence independently verified by someone other than the editor');
  end if;
  if coalesce(p_candidate->>'category','') not in
    ('sustaining_capital','growth_capital','regulatory_capital','reliability',
     'obsolescence','decarbonization','safety_risk','life_extension',
     'modernization','capacity','decommissioning') then
    return jsonb_build_object('error','a canonical portfolio category is required');
  end if;
  if v_currency !~ '^[A-Z]{3}$' then return jsonb_build_object('error','currency must be a three-letter ISO code'); end if;
  if coalesce(length(btrim(p_candidate->>'constraintNote')),0)<20 then
    return jsonb_build_object('error','constraint note must explain timing and delivery constraints');
  end if;
  begin
    if (p_candidate->>'cost')::numeric<0 or (p_candidate->>'costLow')::numeric<0
       or (p_candidate->>'costHigh')::numeric<(p_candidate->>'costLow')::numeric
       or (p_candidate->>'cost')::numeric not between (p_candidate->>'costLow')::numeric and (p_candidate->>'costHigh')::numeric
       or (p_candidate->>'benefit')::numeric<0 or (p_candidate->>'benefitLow')::numeric<0
       or (p_candidate->>'benefitHigh')::numeric<(p_candidate->>'benefitLow')::numeric
       or (p_candidate->>'benefit')::numeric not between (p_candidate->>'benefitLow')::numeric and (p_candidate->>'benefitHigh')::numeric
       or (p_candidate->>'benefitProbability')::numeric not between 0 and 1
       or (p_candidate->>'riskReductionValue')::numeric<0
       or (p_candidate->>'durationMonths')::int<=0 then
      return jsonb_build_object('error','cost, benefit, probability, risk value and duration ranges are invalid');
    end if;
  exception when others then return jsonb_build_object('error','complete numeric cost, benefit, probability, risk value and duration inputs are required'); end;
  if public.sync_text_as_date(p_candidate->>'earliestStart') is null
     or public.sync_text_as_date(p_candidate->>'latestStart') is null
     or public.sync_text_as_date(p_candidate->>'earliestStart')>public.sync_text_as_date(p_candidate->>'latestStart') then
    return jsonb_build_object('error','valid earliest and latest start dates are required');
  end if;
  insert into public.capital_plan_items(organization_id,plan_year,case_id,label,cost,benefit_present_value,mandatory,mandatory_basis,
    development_case_id,portfolio_category,currency,cost_low,cost_high,benefit_low,benefit_high,benefit_probability,
    risk_reduction_value,earliest_start,latest_start,duration_months,evidence_item_id,constraint_note,updated_by,updated_at)
  select v_org,v_year,bc.id,c.title,(p_candidate->>'cost')::numeric,(p_candidate->>'benefit')::numeric,
    coalesce((p_candidate->>'mandatory')::boolean,false),nullif(btrim(p_candidate->>'mandatoryBasis'),''),
    v_case,p_candidate->>'category',v_currency,(p_candidate->>'costLow')::numeric,(p_candidate->>'costHigh')::numeric,
    (p_candidate->>'benefitLow')::numeric,(p_candidate->>'benefitHigh')::numeric,(p_candidate->>'benefitProbability')::numeric,
    (p_candidate->>'riskReductionValue')::numeric,public.sync_text_as_date(p_candidate->>'earliestStart'),
    public.sync_text_as_date(p_candidate->>'latestStart'),(p_candidate->>'durationMonths')::int,v_evidence,
    btrim(p_candidate->>'constraintNote'),auth.uid(),now()
  from public.development_cases c left join public.business_cases bc
    on bc.organization_id=v_org and bc.project_id=c.capital_project_id and bc.status in ('submitted','approved')
  where c.id=v_case
  order by case when bc.status='approved' then 0 else 1 end,bc.created_at desc limit 1
  on conflict(organization_id,development_case_id,plan_year) where development_case_id is not null
  do update set case_id=excluded.case_id,label=excluded.label,cost=excluded.cost,
    benefit_present_value=excluded.benefit_present_value,mandatory=excluded.mandatory,
    mandatory_basis=excluded.mandatory_basis,portfolio_category=excluded.portfolio_category,
    currency=excluded.currency,cost_low=excluded.cost_low,cost_high=excluded.cost_high,
    benefit_low=excluded.benefit_low,benefit_high=excluded.benefit_high,
    benefit_probability=excluded.benefit_probability,risk_reduction_value=excluded.risk_reduction_value,
    earliest_start=excluded.earliest_start,latest_start=excluded.latest_start,
    duration_months=excluded.duration_months,evidence_item_id=excluded.evidence_item_id,
    constraint_note=excluded.constraint_note,updated_by=excluded.updated_by,updated_at=now()
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'portfolio_candidate_configured',v_role,jsonb_build_object('capital_plan_item_id',v_id,
    'development_case_id',v_case,'plan_year',v_year,'category',p_candidate->>'category','evidence_item_id',v_evidence));
  return jsonb_build_object('capitalPlanItemId',v_id,'status','configured');
exception when others then return jsonb_build_object('error',sqlerrm); end $$;

create or replace function public.run_enterprise_portfolio_optimization(p_plan_year int,p_budget numeric,p_currency text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; v_currency text:=upper(btrim(coalesce(p_currency,'')));
  v_selected jsonb:='[]'::jsonb; v_deferred jsonb:='[]'::jsonb; v_refusals jsonb:='[]'::jsonb;
  v_cost numeric:=0; v_cost_low numeric:=0; v_cost_high numeric:=0;
  v_value numeric:=0; v_value_low numeric:=0; v_value_high numeric:=0;
  v_count int:=0; v_candidate_count int:=0; v_run uuid; r record; v_outputs jsonb;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','forbidden');
  end if;
  if p_budget is null or p_budget<=0 then return jsonb_build_object('error','a positive portfolio budget is required'); end if;
  if v_currency !~ '^[A-Z]{3}$' then return jsonb_build_object('error','currency must be a three-letter ISO code'); end if;
  select count(*) into v_candidate_count from public.capital_plan_items i join public.development_cases c
    on c.id=i.development_case_id and c.organization_id=v_org
    where i.organization_id=v_org and i.plan_year=p_plan_year and c.status not in ('cancelled','completed');
  if v_candidate_count=0 then return jsonb_build_object('error','no governed portfolio candidates are configured for this year'); end if;
  if exists(select 1 from public.capital_plan_items i join public.development_cases c on c.id=i.development_case_id
    where i.organization_id=v_org and i.plan_year=p_plan_year and c.status not in ('cancelled','completed')
      and (i.portfolio_category is null or i.currency<>v_currency or i.cost_low is null or i.cost_high is null
        or i.benefit_low is null or i.benefit_high is null or i.benefit_probability is null
        or i.risk_reduction_value is null or i.earliest_start is null or i.latest_start is null
        or i.duration_months is null or i.evidence_item_id is null)) then
    return jsonb_build_object('error','every active candidate needs one currency, complete uncertainty ranges, timing, category and verified evidence');
  end if;
  if exists(select 1 from public.capital_plan_items i join public.evidence_items e on e.id=i.evidence_item_id
    where i.organization_id=v_org and i.plan_year=p_plan_year
      and (e.organization_id<>v_org or e.verification_status<>'verified')) then
    return jsonb_build_object('error','every candidate requires current same-tenant verified evidence');
  end if;
  for r in
    select i.*,c.title,
      ((i.benefit_present_value*i.benefit_probability)+i.risk_reduction_value)/nullif(i.cost,0) priority_ratio
    from public.capital_plan_items i join public.development_cases c on c.id=i.development_case_id and c.organization_id=v_org
    where i.organization_id=v_org and i.plan_year=p_plan_year and c.status not in ('cancelled','completed')
    order by i.mandatory desc,
      case when i.cost=0 then 1e30 else ((i.benefit_present_value*i.benefit_probability)+i.risk_reduction_value)/i.cost end desc,
      i.id
  loop
    if r.latest_start < make_date(p_plan_year,1,1) or r.earliest_start > make_date(p_plan_year,12,31) then
      v_deferred:=v_deferred||jsonb_build_array(jsonb_build_object('caseId',r.development_case_id,'title',r.title,
        'category',r.portfolio_category,'reason','outside the recorded timing window for this plan year'));
    elsif v_cost+r.cost<=p_budget then
      v_selected:=v_selected||jsonb_build_array(jsonb_build_object('caseId',r.development_case_id,'title',r.title,
        'category',r.portfolio_category,'cost',r.cost,'riskAdjustedValue',round(r.benefit_present_value*r.benefit_probability+r.risk_reduction_value,2),
        'mandatory',r.mandatory,'evidenceItemId',r.evidence_item_id,'earliestStart',r.earliest_start,
        'latestStart',r.latest_start,'durationMonths',r.duration_months));
      v_cost:=v_cost+r.cost; v_cost_low:=v_cost_low+r.cost_low; v_cost_high:=v_cost_high+r.cost_high;
      v_value:=v_value+r.benefit_present_value*r.benefit_probability+r.risk_reduction_value;
      v_value_low:=v_value_low+r.benefit_low*r.benefit_probability+r.risk_reduction_value;
      v_value_high:=v_value_high+r.benefit_high*r.benefit_probability+r.risk_reduction_value; v_count:=v_count+1;
    else
      v_deferred:=v_deferred||jsonb_build_array(jsonb_build_object('caseId',r.development_case_id,'title',r.title,
        'category',r.portfolio_category,'reason',case when r.mandatory then 'mandatory candidate exceeds remaining budget — portfolio is infeasible' else 'does not fit the remaining budget under the transparent value-per-cost ordering' end));
      if r.mandatory then v_refusals:=v_refusals||jsonb_build_array('mandatory candidate '||r.title||' cannot fit within the stated budget'); end if;
    end if;
  end loop;
  v_outputs:=jsonb_build_object('planYear',p_plan_year,'currency',v_currency,'budget',p_budget,
    'selected',v_selected,'deferred',v_deferred,'selectedCount',v_count,'candidateCount',v_candidate_count,
    'cost',jsonb_build_object('low',v_cost_low,'base',v_cost,'high',v_cost_high),
    'riskAdjustedValue',jsonb_build_object('low',round(v_value_low,2),'base',round(v_value,2),'high',round(v_value_high,2)),
    'remainingBudget',p_budget-v_cost,'globallyOptimal',false,'operationalAuthorization',false,
    'method','Mandatory-first, then descending evidence-backed risk-adjusted value per unit cost within the stated budget and timing window. This transparent heuristic does not claim a global mathematical optimum.');
  insert into public.calculation_runs(organization_id,calculation_key,method,code_version,inputs,input_refs,outputs,refusals,status,computed_by)
  values(v_org,'enterprise_portfolio_optimization','Transparent constrained portfolio prioritization; no unsupported cross-unit normalization.',
    'u11.01-v1',jsonb_build_object('planYear',p_plan_year,'budget',p_budget,'currency',v_currency),
    (select jsonb_agg(jsonb_build_object('table','capital_plan_items','id',i.id,'evidenceItemId',i.evidence_item_id))
      from public.capital_plan_items i where i.organization_id=v_org and i.plan_year=p_plan_year),
    v_outputs,v_refusals,case when jsonb_array_length(v_refusals)>0 then 'computed_with_refusals' else 'computed' end,auth.uid())
  returning id into v_run;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'enterprise_portfolio_optimization_run',v_role,jsonb_build_object('calculation_run_id',v_run,
    'plan_year',p_plan_year,'candidate_count',v_candidate_count,'selected_count',v_count,'operational_authorization',false));
  return v_outputs||jsonb_build_object('calculationRunId',v_run,'refusals',v_refusals);
exception when others then return jsonb_build_object('error',sqlerrm); end $$;

create or replace function public.propose_enterprise_portfolio_plan(p_calculation_run_id uuid,p_rationale text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; r public.calculation_runs%rowtype; v_rec uuid; v_approval uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer') then return jsonb_build_object('error','forbidden'); end if;
  if length(btrim(coalesce(p_rationale,'')))<30 then return jsonb_build_object('error','proposal rationale must explain the portfolio trade-off'); end if;
  select * into r from public.calculation_runs where id=p_calculation_run_id and organization_id=v_org
    and calculation_key='enterprise_portfolio_optimization';
  if not found then return jsonb_build_object('error','portfolio calculation run not found in this organization'); end if;
  if exists(select 1 from public.recommendations where portfolio_calculation_run_id=r.id) then
    return jsonb_build_object('error','this portfolio run already has a governed recommendation');
  end if;
  perform set_config('app.portfolio_proposal_write','on',true);
  insert into public.recommendations(organization_id,title,issue,action,impact,confidence,urgency,status,
    approval_required,accountable,rationale,portfolio_calculation_run_id)
  values(v_org,'Review enterprise portfolio plan '||coalesce(r.outputs->>'planYear',''),
    'A constrained portfolio scenario has been computed from evidence-backed candidate inputs.',
    'Review the selected and deferred candidates, validate constraint assumptions, and decide funding through existing authority controls.',
    'Decision support only; it does not sanction projects, accept risk, release work, or commit funds.',null,'advisory','pending',
    'Named human funding and sanction approval is required; existing project-level authority remains controlling.',
    'executive',btrim(p_rationale)||' Calculation run: '||r.id,r.id) returning id into v_rec;
  insert into public.approvals(organization_id,recommendation_id,status,owner_role,reason,consequence_of_wrong,required_validation)
  values(v_org,v_rec,'pending','executive',btrim(p_rationale),
    'A wrong portfolio choice can crowd out mandatory work, misallocate capital, or conceal risk.',
    'Validate evidence currency, budget, mandatory obligations, timing, resource conflicts, uncertainty ranges and delegated authority.')
  returning id into v_approval;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'enterprise_portfolio_plan_proposed',v_role,jsonb_build_object('calculation_run_id',r.id,
    'recommendation_id',v_rec,'approval_id',v_approval,'funds_committed',false,'projects_sanctioned',false));
  return jsonb_build_object('recommendationId',v_rec,'approvalId',v_approval,'status','pending_human_review',
    'fundsCommitted',false,'projectsSanctioned',false);
exception when others then return jsonb_build_object('error',sqlerrm); end $$;

create or replace function public.get_enterprise_portfolio_workspace(p_plan_year int default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_year int:=coalesce(p_plan_year,extract(year from current_date)::int);
begin
  if v_org is null then return jsonb_build_object('error','authenticated organization required'); end if;
  return jsonb_build_object('planYear',v_year,
    'categories',jsonb_build_array('sustaining_capital','growth_capital','regulatory_capital','reliability','obsolescence',
      'decarbonization','safety_risk','life_extension','modernization','capacity','decommissioning'),
    'candidates',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'developmentCaseId',c.id,'title',c.title,
      'status',c.status,'category',i.portfolio_category,'currency',i.currency,'cost',i.cost,'costLow',i.cost_low,'costHigh',i.cost_high,
      'benefit',i.benefit_present_value,'benefitLow',i.benefit_low,'benefitHigh',i.benefit_high,
      'benefitProbability',i.benefit_probability,'riskReductionValue',i.risk_reduction_value,'mandatory',i.mandatory,
      'mandatoryBasis',i.mandatory_basis,'earliestStart',i.earliest_start,'latestStart',i.latest_start,
      'durationMonths',i.duration_months,'evidenceItemId',i.evidence_item_id,'constraintNote',i.constraint_note) order by c.title)
      from public.development_cases c left join public.capital_plan_items i on i.organization_id=v_org
        and i.development_case_id=c.id and i.plan_year=v_year
      where c.organization_id=v_org and c.status not in ('cancelled','completed')),'[]'::jsonb),
    'latestRun',(select jsonb_build_object('id',r.id,'outputs',r.outputs,'refusals',r.refusals,'status',r.status,
      'computedAt',r.computed_at,'recommendationId',(select rec.id from public.recommendations rec where rec.portfolio_calculation_run_id=r.id)) from public.calculation_runs r
      where r.organization_id=v_org and r.calculation_key='enterprise_portfolio_optimization'
        and (r.inputs->>'planYear')::int=v_year order by r.computed_at desc limit 1),
    'decisionBoundary','Optimization is advisory. Funding, sanction, risk acceptance, gate passage, work release and operational authorization remain separate named-human decisions.');
end $$;

revoke all on function public.configure_portfolio_candidate(jsonb) from public,anon,service_role;
revoke all on function public.run_enterprise_portfolio_optimization(int,numeric,text) from public,anon,service_role;
revoke all on function public.propose_enterprise_portfolio_plan(uuid,text) from public,anon,service_role;
revoke all on function public.get_enterprise_portfolio_workspace(int) from public,anon;
revoke all on function public.enforce_portfolio_recommendation_link() from public,anon,authenticated,service_role;
grant execute on function public.configure_portfolio_candidate(jsonb) to authenticated;
grant execute on function public.run_enterprise_portfolio_optimization(int,numeric,text) to authenticated;
grant execute on function public.propose_enterprise_portfolio_plan(uuid,text) to authenticated;
grant execute on function public.get_enterprise_portfolio_workspace(int) to authenticated;

comment on function public.run_enterprise_portfolio_optimization(int,numeric,text) is
  'U11.01 evidence-backed constrained portfolio decision support across all eleven named categories. Records uncertainty and refusals, does not claim global optimality, and grants no funding, sanction, risk acceptance or operational authority.';
notify pgrst,'reload schema';
