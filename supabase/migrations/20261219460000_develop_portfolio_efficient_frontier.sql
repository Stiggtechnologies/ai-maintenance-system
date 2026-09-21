-- D10.04 / D10.06 — evidence-backed nine-dimension portfolio frontier.
--
-- Canonical reuse: capital_plan_items remains the candidate store;
-- evidence_items remains the provenance store; calculation_runs remains the
-- immutable lineage ledger; recommendations and approvals remain the human
-- decision path. No project, scenario, evidence, approval or workflow store is
-- introduced. The frontier is a bounded deterministic decision aid, not an
-- expenditure, sanction, gate, risk-acceptance or work authorization.

alter table public.capital_plan_items
  add column if not exists portfolio_dimensions jsonb,
  add column if not exists dimension_calibration_note text;

create or replace function public.sync_validate_portfolio_dimensions(p_dimensions jsonb)
returns text language plpgsql immutable set search_path=public as $$
declare
  v_key text;
  v_score numeric;
  v_keys constant text[]:=array[
    'regulatory_necessity','safety_risk','production_benefit','reliability','npv',
    'asset_life','sustainability','resource_demand','execution_risk'
  ];
begin
  if jsonb_typeof(p_dimensions)<>'object' then
    return 'portfolio dimensions must be an object';
  end if;
  if (select count(*) from jsonb_object_keys(p_dimensions))<>9
     or exists(select 1 from jsonb_object_keys(p_dimensions) k where not (k=any(v_keys)))
     or exists(select 1 from unnest(v_keys) k where not (p_dimensions ? k)) then
    return 'portfolio dimensions require exactly the nine governed decision dimensions';
  end if;
  foreach v_key in array v_keys loop
    if jsonb_typeof(p_dimensions->v_key)<>'object' then
      return v_key||' must contain a score and basis';
    end if;
    begin v_score:=(p_dimensions->v_key->>'score')::numeric;
    exception when others then return v_key||' requires a numeric score'; end;
    if v_score<0 or v_score>100 then return v_key||' score must be between 0 and 100'; end if;
    if length(btrim(coalesce(p_dimensions->v_key->>'basis','')))<20 then
      return v_key||' requires a dimension calibration basis of at least 20 characters';
    end if;
  end loop;
  return null;
end $$;

alter table public.capital_plan_items
  drop constraint if exists capital_plan_items_portfolio_dimensions_check;
alter table public.capital_plan_items
  add constraint capital_plan_items_portfolio_dimensions_check check (
    portfolio_dimensions is null
    or public.sync_validate_portfolio_dimensions(portfolio_dimensions) is null
  );

create or replace function public.enforce_portfolio_dimension_integrity()
returns trigger language plpgsql set search_path=public as $$
declare v_error text;
begin
  if new.portfolio_dimensions is null then return new; end if;
  v_error:=public.sync_validate_portfolio_dimensions(new.portfolio_dimensions);
  if v_error is not null then raise exception '%',v_error; end if;
  if length(btrim(coalesce(new.dimension_calibration_note,'')))<30 then
    raise exception 'dimension calibration note must explain the common 0-100 decision scale';
  end if;
  if not exists(
    select 1 from public.user_profiles u
    where u.id=auth.uid() and u.organization_id=new.organization_id
      and u.role<>'ai_admin'
      and u.role in ('admin','executive','maintenance_manager','reliability_engineer','planner')
  ) then
    raise exception 'portfolio dimensions require an authorized named human';
  end if;
  if not exists(
    select 1 from public.evidence_items e
    where e.id=new.evidence_item_id and e.organization_id=new.organization_id
      and e.verification_status='verified' and e.verified_by is distinct from auth.uid()
  ) then
    raise exception 'portfolio dimensions require independently verified same-tenant evidence';
  end if;
  return new;
end $$;

drop trigger if exists trg_capital_plan_item_dimension_integrity on public.capital_plan_items;
create trigger trg_capital_plan_item_dimension_integrity
before insert or update of portfolio_dimensions,dimension_calibration_note,evidence_item_id
on public.capital_plan_items for each row
execute function public.enforce_portfolio_dimension_integrity();

create or replace function public.configure_portfolio_candidate_dimensions(
  p_development_case_id uuid,
  p_plan_year int,
  p_dimensions jsonb,
  p_calibration_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_item bigint;
  v_role text;
  v_error text;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','forbidden');
  end if;
  v_error:=public.sync_validate_portfolio_dimensions(p_dimensions);
  if v_error is not null then return jsonb_build_object('error',v_error); end if;
  if length(btrim(coalesce(p_calibration_note,'')))<30 then
    return jsonb_build_object('error','dimension calibration note must explain the common 0-100 decision scale');
  end if;
  select i.id into v_item
  from public.capital_plan_items i
  where i.organization_id=v_org and i.development_case_id=p_development_case_id
    and i.plan_year=p_plan_year and i.evidence_item_id is not null;
  if v_item is null then
    return jsonb_build_object('error','configure the evidence-backed portfolio candidate before its decision dimensions');
  end if;
  update public.capital_plan_items
  set portfolio_dimensions=p_dimensions,
      dimension_calibration_note=btrim(p_calibration_note),
      updated_by=auth.uid(),updated_at=now()
  where id=v_item;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'portfolio_candidate_dimensions_configured',v_role,
    jsonb_build_object('capital_plan_item_id',v_item,'development_case_id',p_development_case_id,
      'plan_year',p_plan_year,'dimension_keys',(select jsonb_agg(k order by k) from jsonb_object_keys(p_dimensions) k),
      'automatic_decision',false));
  return jsonb_build_object('capitalPlanItemId',v_item,'status','dimensions_configured');
exception when others then return jsonb_build_object('error',sqlerrm); end $$;

create or replace function public.run_enterprise_portfolio_frontier(
  p_plan_year int,p_budget numeric,p_currency text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_currency text:=upper(btrim(coalesce(p_currency,'')));
  v_objective text;
  v_objectives constant text[]:=array[
    'regulatory_necessity','safety_risk','production_benefit','reliability','npv',
    'asset_life','sustainability','resource_demand','execution_risk','balanced'
  ];
  v_selected_ids uuid[];
  v_selected jsonb;
  v_deferred jsonb;
  v_cost numeric;
  v_cost_low numeric;
  v_cost_high numeric;
  v_value numeric;
  v_value_low numeric;
  v_value_high numeric;
  v_reg numeric; v_safe numeric; v_prod numeric; v_rel numeric; v_npv numeric;
  v_life numeric; v_sustain numeric; v_resource numeric; v_execution numeric;
  v_key text;
  v_frontier jsonb;
  v_frontier_count int;
  v_feasible_count int;
  v_candidate_count int;
  v_run uuid;
  v_refusals jsonb:='[]'::jsonb;
  v_outputs jsonb;
  r record;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','forbidden');
  end if;
  if p_budget is null or p_budget<=0 then return jsonb_build_object('error','a positive portfolio budget is required'); end if;
  if v_currency !~ '^[A-Z]{3}$' then return jsonb_build_object('error','currency must be a three-letter ISO code'); end if;

  select count(*) into v_candidate_count
  from public.capital_plan_items i join public.development_cases c
    on c.id=i.development_case_id and c.organization_id=v_org
  where i.organization_id=v_org and i.plan_year=p_plan_year and c.status not in ('cancelled','completed');
  if v_candidate_count<2 then return jsonb_build_object('error','at least two governed candidates are required for a portfolio frontier'); end if;
  if exists(
    select 1 from public.capital_plan_items i join public.development_cases c
      on c.id=i.development_case_id and c.organization_id=v_org
    where i.organization_id=v_org and i.plan_year=p_plan_year and c.status not in ('cancelled','completed')
      and (i.currency<>v_currency or i.cost is null or i.cost_low is null or i.cost_high is null
        or i.benefit_present_value is null or i.benefit_low is null or i.benefit_high is null
        or i.benefit_probability is null or i.risk_reduction_value is null
        or i.earliest_start is null or i.latest_start is null or i.duration_months is null
        or i.evidence_item_id is null or i.portfolio_dimensions is null
        or public.sync_validate_portfolio_dimensions(i.portfolio_dimensions) is not null)
  ) then
    return jsonb_build_object('error','every active candidate requires one currency, complete uncertainty and timing, verified evidence, and exactly nine governed dimensions');
  end if;
  if exists(
    select 1 from public.capital_plan_items i join public.evidence_items e on e.id=i.evidence_item_id
    where i.organization_id=v_org and i.plan_year=p_plan_year
      and (e.organization_id<>v_org or e.verification_status<>'verified')
  ) then return jsonb_build_object('error','every candidate requires current same-tenant verified evidence'); end if;

  create temporary table if not exists pg_temp.sync_portfolio_frontier_work(
    portfolio_id text primary key, objective text not null, selected_ids uuid[] not null,
    selected jsonb not null, deferred jsonb not null,
    cost numeric not null,cost_low numeric not null,cost_high numeric not null,
    value_base numeric not null,value_low numeric not null,value_high numeric not null,
    regulatory_necessity numeric not null,safety_risk numeric not null,
    production_benefit numeric not null,reliability numeric not null,npv numeric not null,
    asset_life numeric not null,sustainability numeric not null,
    resource_demand numeric not null,execution_risk numeric not null
  ) on commit drop;
  truncate pg_temp.sync_portfolio_frontier_work;

  if coalesce((select sum(i.cost) from public.capital_plan_items i join public.development_cases c
      on c.id=i.development_case_id and c.organization_id=v_org
      where i.organization_id=v_org and i.plan_year=p_plan_year and c.status not in ('cancelled','completed')
        and i.mandatory and not (i.latest_start<make_date(p_plan_year,1,1) or i.earliest_start>make_date(p_plan_year,12,31))),0)>p_budget then
    v_refusals:=v_refusals||jsonb_build_array('mandatory candidates exceed the stated budget; no feasible portfolio exists');
  else
    foreach v_objective in array v_objectives loop
      v_selected_ids:='{}'::uuid[]; v_selected:='[]'::jsonb; v_cost:=0; v_cost_low:=0; v_cost_high:=0;
      v_value:=0; v_value_low:=0; v_value_high:=0;
      v_reg:=0; v_safe:=0; v_prod:=0; v_rel:=0; v_npv:=0; v_life:=0; v_sustain:=0; v_resource:=0; v_execution:=0;
      for r in
        select i.*,c.title,
          case v_objective
            when 'regulatory_necessity' then (i.portfolio_dimensions->'regulatory_necessity'->>'score')::numeric
            when 'safety_risk' then (i.portfolio_dimensions->'safety_risk'->>'score')::numeric
            when 'production_benefit' then (i.portfolio_dimensions->'production_benefit'->>'score')::numeric
            when 'reliability' then (i.portfolio_dimensions->'reliability'->>'score')::numeric
            when 'npv' then (i.portfolio_dimensions->'npv'->>'score')::numeric
            when 'asset_life' then (i.portfolio_dimensions->'asset_life'->>'score')::numeric
            when 'sustainability' then (i.portfolio_dimensions->'sustainability'->>'score')::numeric
            when 'resource_demand' then 100-(i.portfolio_dimensions->'resource_demand'->>'score')::numeric
            when 'execution_risk' then 100-(i.portfolio_dimensions->'execution_risk'->>'score')::numeric
            else
              (i.portfolio_dimensions->'regulatory_necessity'->>'score')::numeric+
              (i.portfolio_dimensions->'safety_risk'->>'score')::numeric+
              (i.portfolio_dimensions->'production_benefit'->>'score')::numeric+
              (i.portfolio_dimensions->'reliability'->>'score')::numeric+
              (i.portfolio_dimensions->'npv'->>'score')::numeric+
              (i.portfolio_dimensions->'asset_life'->>'score')::numeric+
              (i.portfolio_dimensions->'sustainability'->>'score')::numeric+
              100-(i.portfolio_dimensions->'resource_demand'->>'score')::numeric+
              100-(i.portfolio_dimensions->'execution_risk'->>'score')::numeric
          end as objective_score
        from public.capital_plan_items i join public.development_cases c
          on c.id=i.development_case_id and c.organization_id=v_org
        where i.organization_id=v_org and i.plan_year=p_plan_year and c.status not in ('cancelled','completed')
          and not (i.latest_start<make_date(p_plan_year,1,1) or i.earliest_start>make_date(p_plan_year,12,31))
        order by i.mandatory desc,
          (case when i.cost=0 then 1e30 else
            (case v_objective
              when 'resource_demand' then 100-(i.portfolio_dimensions->'resource_demand'->>'score')::numeric
              when 'execution_risk' then 100-(i.portfolio_dimensions->'execution_risk'->>'score')::numeric
              when 'balanced' then
                (i.portfolio_dimensions->'regulatory_necessity'->>'score')::numeric+
                (i.portfolio_dimensions->'safety_risk'->>'score')::numeric+
                (i.portfolio_dimensions->'production_benefit'->>'score')::numeric+
                (i.portfolio_dimensions->'reliability'->>'score')::numeric+
                (i.portfolio_dimensions->'npv'->>'score')::numeric+
                (i.portfolio_dimensions->'asset_life'->>'score')::numeric+
                (i.portfolio_dimensions->'sustainability'->>'score')::numeric+
                100-(i.portfolio_dimensions->'resource_demand'->>'score')::numeric+
                100-(i.portfolio_dimensions->'execution_risk'->>'score')::numeric
              else (i.portfolio_dimensions->v_objective->>'score')::numeric
            end)/i.cost end) desc,i.id
      loop
        if r.mandatory or v_cost+r.cost<=p_budget then
          v_selected_ids:=array_append(v_selected_ids,r.development_case_id);
          v_selected:=v_selected||jsonb_build_array(jsonb_build_object(
            'caseId',r.development_case_id,'title',r.title,'category',r.portfolio_category,
            'cost',r.cost,'mandatory',r.mandatory,'evidenceItemId',r.evidence_item_id,
            'dimensions',r.portfolio_dimensions));
          v_cost:=v_cost+r.cost; v_cost_low:=v_cost_low+r.cost_low; v_cost_high:=v_cost_high+r.cost_high;
          v_value:=v_value+r.benefit_present_value*r.benefit_probability+r.risk_reduction_value;
          v_value_low:=v_value_low+r.benefit_low*r.benefit_probability+r.risk_reduction_value;
          v_value_high:=v_value_high+r.benefit_high*r.benefit_probability+r.risk_reduction_value;
          v_reg:=v_reg+(r.portfolio_dimensions->'regulatory_necessity'->>'score')::numeric;
          v_safe:=v_safe+(r.portfolio_dimensions->'safety_risk'->>'score')::numeric;
          v_prod:=v_prod+(r.portfolio_dimensions->'production_benefit'->>'score')::numeric;
          v_rel:=v_rel+(r.portfolio_dimensions->'reliability'->>'score')::numeric;
          v_npv:=v_npv+(r.portfolio_dimensions->'npv'->>'score')::numeric;
          v_life:=v_life+(r.portfolio_dimensions->'asset_life'->>'score')::numeric;
          v_sustain:=v_sustain+(r.portfolio_dimensions->'sustainability'->>'score')::numeric;
          v_resource:=v_resource+(r.portfolio_dimensions->'resource_demand'->>'score')::numeric;
          v_execution:=v_execution+(r.portfolio_dimensions->'execution_risk'->>'score')::numeric;
        end if;
      end loop;
      select coalesce(jsonb_agg(jsonb_build_object('caseId',i.development_case_id,'title',c.title,
        'category',i.portfolio_category,'reason',case
          when i.latest_start<make_date(p_plan_year,1,1) or i.earliest_start>make_date(p_plan_year,12,31)
            then 'outside the recorded timing window for this plan year'
          else 'not selected in this feasible objective-led portfolio within the stated budget' end) order by c.title),'[]'::jsonb)
      into v_deferred
      from public.capital_plan_items i join public.development_cases c
        on c.id=i.development_case_id and c.organization_id=v_org
      where i.organization_id=v_org and i.plan_year=p_plan_year and c.status not in ('cancelled','completed')
        and not (i.development_case_id=any(v_selected_ids));
      select 'pf-'||substr(md5(array_to_string(array(select x from unnest(v_selected_ids) x order by x),',')),1,12) into v_key;
      insert into pg_temp.sync_portfolio_frontier_work values(
        v_key,v_objective,v_selected_ids,v_selected,v_deferred,
        v_cost,v_cost_low,v_cost_high,v_value,v_value_low,v_value_high,
        v_reg,v_safe,v_prod,v_rel,v_npv,v_life,v_sustain,v_resource,v_execution
      ) on conflict(portfolio_id) do nothing;
    end loop;
  end if;

  select count(*) into v_feasible_count from pg_temp.sync_portfolio_frontier_work;
  select coalesce(jsonb_agg(jsonb_build_object(
    'portfolioId',p.portfolio_id,'objective',p.objective,'selected',p.selected,'deferred',p.deferred,
    'selectedCount',jsonb_array_length(p.selected),
    'cost',jsonb_build_object('low',p.cost_low,'base',p.cost,'high',p.cost_high),
    'riskAdjustedValue',jsonb_build_object('low',round(p.value_low,2),'base',round(p.value_base,2),'high',round(p.value_high,2)),
    'dimensions',jsonb_build_object('regulatoryNecessity',p.regulatory_necessity,'safetyRisk',p.safety_risk,
      'productionBenefit',p.production_benefit,'reliability',p.reliability,'npv',p.npv,
      'assetLife',p.asset_life,'sustainability',p.sustainability,
      'resourceDemand',p.resource_demand,'executionRisk',p.execution_risk)
    ) order by p.cost,p.portfolio_id),'[]'::jsonb),count(*)
  into v_frontier,v_frontier_count
  from pg_temp.sync_portfolio_frontier_work p
  where not exists(
    select 1 from pg_temp.sync_portfolio_frontier_work q
    where q.portfolio_id<>p.portfolio_id
      and q.regulatory_necessity>=p.regulatory_necessity and q.safety_risk>=p.safety_risk
      and q.production_benefit>=p.production_benefit and q.reliability>=p.reliability
      and q.npv>=p.npv and q.asset_life>=p.asset_life and q.sustainability>=p.sustainability
      and q.resource_demand<=p.resource_demand and q.execution_risk<=p.execution_risk
      and (q.regulatory_necessity>p.regulatory_necessity or q.safety_risk>p.safety_risk
        or q.production_benefit>p.production_benefit or q.reliability>p.reliability
        or q.npv>p.npv or q.asset_life>p.asset_life or q.sustainability>p.sustainability
        or q.resource_demand<p.resource_demand or q.execution_risk<p.execution_risk)
  );
  if v_frontier_count<2 then
    v_refusals:=v_refusals||jsonb_build_array('fewer than two distinct non-dominated feasible portfolios were produced; no efficient-frontier choice is claimed');
  end if;
  v_outputs:=jsonb_build_object(
    'planYear',p_plan_year,'currency',v_currency,'budget',p_budget,'candidateCount',v_candidate_count,
    'feasiblePortfolioCount',v_feasible_count,'frontierCount',v_frontier_count,'frontier',v_frontier,
    'dimensions',jsonb_build_array('regulatory_necessity','safety_risk','production_benefit','reliability','npv','asset_life','sustainability','resource_demand','execution_risk'),
    'maximizedDimensions',jsonb_build_array('regulatory_necessity','safety_risk','production_benefit','reliability','npv','asset_life','sustainability'),
    'minimizedDimensions',jsonb_build_array('resource_demand','execution_risk'),
    'globallyOptimal',false,'frontierExhaustive',false,'operationalAuthorization',false,
    'method','Objective-led feasible portfolios are generated from the nine evidence-backed 0-100 decision scales, then dominated portfolios are removed. This bounded frontier is not an exhaustive combinatorial optimum and does not rank unlike dimensions into one answer.');
  insert into public.calculation_runs(
    organization_id,calculation_key,method,code_version,inputs,input_refs,outputs,refusals,status,computed_by
  ) values(
    v_org,'enterprise_portfolio_frontier','Nine-dimension bounded non-dominated frontier; no unsupported automatic weighting.',
    'd10.04-v1',jsonb_build_object('planYear',p_plan_year,'budget',p_budget,'currency',v_currency),
    (select jsonb_agg(jsonb_build_object('table','capital_plan_items','id',i.id,'evidenceItemId',i.evidence_item_id,'dimensions',i.portfolio_dimensions) order by i.id)
      from public.capital_plan_items i join public.development_cases c
        on c.id=i.development_case_id and c.organization_id=v_org
      where i.organization_id=v_org and i.plan_year=p_plan_year
        and c.status not in ('cancelled','completed')),
    v_outputs,v_refusals,case when jsonb_array_length(v_refusals)>0 then 'computed_with_refusals' else 'computed' end,auth.uid()
  ) returning id into v_run;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'enterprise_portfolio_frontier_run',v_role,jsonb_build_object(
    'calculation_run_id',v_run,'plan_year',p_plan_year,'candidate_count',v_candidate_count,
    'frontier_count',v_frontier_count,'automatic_funding',false,'automatic_sanction',false));
  return v_outputs||jsonb_build_object('calculationRunId',v_run,'refusals',v_refusals);
exception when others then return jsonb_build_object('error',sqlerrm); end $$;

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
      and r.organization_id=new.organization_id
      and r.calculation_key in ('enterprise_portfolio_optimization','enterprise_portfolio_frontier')
      and r.status in ('computed','computed_with_refusals')) then
    raise exception 'portfolio recommendation requires a same-tenant computed portfolio run';
  end if;
  return new;
end $$;

create or replace function public.propose_enterprise_portfolio_frontier(
  p_calculation_run_id uuid,p_portfolio_id text,p_rationale text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; r public.calculation_runs%rowtype;
  v_portfolio jsonb; v_rec uuid; v_approval uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden');
  end if;
  if length(btrim(coalesce(p_rationale,'')))<30 then
    return jsonb_build_object('error','proposal rationale must explain the chosen frontier trade-off');
  end if;
  select * into r from public.calculation_runs
  where id=p_calculation_run_id and organization_id=v_org and calculation_key='enterprise_portfolio_frontier';
  if not found then return jsonb_build_object('error','portfolio frontier run not found in this organization'); end if;
  select value into v_portfolio from jsonb_array_elements(coalesce(r.outputs->'frontier','[]'::jsonb))
  where value->>'portfolioId'=p_portfolio_id;
  if v_portfolio is null then return jsonb_build_object('error','chosen portfolio is not on this recorded non-dominated frontier'); end if;
  if exists(select 1 from public.recommendations where portfolio_calculation_run_id=r.id) then
    return jsonb_build_object('error','this portfolio frontier already has a governed recommendation');
  end if;
  perform set_config('app.portfolio_proposal_write','on',true);
  insert into public.recommendations(
    organization_id,title,issue,action,impact,confidence,urgency,status,
    approval_required,accountable,rationale,portfolio_calculation_run_id
  ) values(
    v_org,'Review frontier portfolio '||p_portfolio_id,
    'A named human selected one non-dominated feasible portfolio from the recorded nine-dimension frontier.',
    'Review the selected projects, dimension trade-offs, evidence currency, constraints and delegated funding authority.',
    'Decision support only; it does not sanction projects, accept risk, release work or commit funds.',
    null,'advisory','pending',
    'Named human funding and sanction approval is required; existing project-level authority remains controlling.',
    'executive',btrim(p_rationale)||' Frontier portfolio: '||p_portfolio_id||'. Calculation run: '||r.id,r.id
  ) returning id into v_rec;
  insert into public.approvals(
    organization_id,recommendation_id,status,owner_role,reason,consequence_of_wrong,required_validation
  ) values(
    v_org,v_rec,'pending','executive',btrim(p_rationale),
    'A wrong portfolio choice can crowd out mandatory work, misallocate capital, conceal risk or overstate value.',
    'Validate all nine dimension calibrations, evidence currency, budget, mandatory obligations, timing, resources, uncertainty and delegated authority.'
  ) returning id into v_approval;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'enterprise_portfolio_frontier_proposed',v_role,jsonb_build_object(
    'calculation_run_id',r.id,'portfolio_id',p_portfolio_id,'recommendation_id',v_rec,
    'approval_id',v_approval,'funds_committed',false,'projects_sanctioned',false));
  return jsonb_build_object('recommendationId',v_rec,'approvalId',v_approval,
    'portfolioId',p_portfolio_id,'status','pending_human_review',
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
      'durationMonths',i.duration_months,'evidenceItemId',i.evidence_item_id,'constraintNote',i.constraint_note,
      'portfolioDimensions',i.portfolio_dimensions,'dimensionCalibrationNote',i.dimension_calibration_note) order by c.title)
      from public.development_cases c join public.capital_plan_items i on i.organization_id=v_org
        and i.development_case_id=c.id and i.plan_year=v_year
      where c.organization_id=v_org and c.status not in ('cancelled','completed')),'[]'::jsonb),
    'latestRun',(select jsonb_build_object('id',r.id,'outputs',r.outputs,'refusals',r.refusals,'status',r.status,
      'computedAt',r.computed_at,'recommendationId',(select rec.id from public.recommendations rec where rec.portfolio_calculation_run_id=r.id)) from public.calculation_runs r
      where r.organization_id=v_org and r.calculation_key='enterprise_portfolio_optimization'
        and (r.inputs->>'planYear')::int=v_year order by r.computed_at desc limit 1),
    'decisionBoundary','Optimization is advisory. Funding, sanction, risk acceptance, gate passage, work release and operational authorization remain separate named-human decisions.');
end $$;

create or replace function public.get_enterprise_portfolio_frontier(p_plan_year int default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_year int:=coalesce(p_plan_year,extract(year from current_date)::int);
begin
  if v_org is null then return jsonb_build_object('error','authenticated organization required'); end if;
  return coalesce((
    select jsonb_build_object('id',r.id,'outputs',r.outputs,'refusals',r.refusals,
      'status',r.status,'computedAt',r.computed_at,
      'recommendationId',(select rec.id from public.recommendations rec where rec.portfolio_calculation_run_id=r.id))
    from public.calculation_runs r
    where r.organization_id=v_org and r.calculation_key='enterprise_portfolio_frontier'
      and (r.inputs->>'planYear')::int=v_year
    order by r.computed_at desc limit 1
  ),'null'::jsonb);
end $$;

revoke all on function public.sync_validate_portfolio_dimensions(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.enforce_portfolio_dimension_integrity() from public,anon,authenticated,service_role;
revoke all on function public.configure_portfolio_candidate_dimensions(uuid,int,jsonb,text) from public,anon,service_role;
revoke all on function public.run_enterprise_portfolio_frontier(int,numeric,text) from public,anon,service_role;
revoke all on function public.propose_enterprise_portfolio_frontier(uuid,text,text) from public,anon,service_role;
revoke all on function public.get_enterprise_portfolio_frontier(int) from public,anon;
grant execute on function public.configure_portfolio_candidate_dimensions(uuid,int,jsonb,text) to authenticated;
grant execute on function public.run_enterprise_portfolio_frontier(int,numeric,text) to authenticated;
grant execute on function public.propose_enterprise_portfolio_frontier(uuid,text,text) to authenticated;
grant execute on function public.get_enterprise_portfolio_frontier(int) to authenticated;

comment on function public.run_enterprise_portfolio_frontier(int,numeric,text) is
  'D10.04 bounded non-dominated feasible frontier across exactly nine evidence-backed decision dimensions. It is advisory, non-exhaustive, records refusals and grants no funding, sanction, gate, risk acceptance or work authority.';
notify pgrst,'reload schema';
