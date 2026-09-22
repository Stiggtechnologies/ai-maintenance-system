-- D2.09 / spec II.12 — evidence-backed operational-disruption modelling for
-- brownfield options.
--
-- Canonical reuse:
--   * business_case_options remains the ONE option identity;
--   * lifecycle_evaluations remains the ONE immutable project-value record;
--   * evidence_items remains the ONE evidence model;
--   * outage_windows remains the ONE outage-window model;
--   * audit_events remains the ONE audit ledger.
--
-- The model is deliberately a subtraction, not an optimizer:
--   ProjectValue − ConstructionDisruption − ProductionLoss − SIMOPSRisk.
-- It exposes comparable recorded results and named gaps. It never ranks,
-- recommends, approves, or selects an option.

create table if not exists public.option_operational_disruption_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  option_id bigint not null references public.business_case_options(id) on delete cascade,
  value_evaluation_id uuid not null references public.lifecycle_evaluations(id) on delete restrict,
  revision int not null check (revision > 0),
  construction_disruption_cost numeric not null check (construction_disruption_cost >= 0),
  construction_disruption_basis text not null check (length(btrim(construction_disruption_basis)) >= 20),
  construction_disruption_evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  production_loss_cost numeric not null check (production_loss_cost >= 0),
  production_loss_basis text not null check (length(btrim(production_loss_basis)) >= 20),
  production_loss_evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  simops_risk_cost numeric not null check (simops_risk_cost >= 0),
  simops_risk_basis text not null check (length(btrim(simops_risk_basis)) >= 20),
  simops_risk_evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  outage_scope_basis text not null check (length(btrim(outage_scope_basis)) >= 20),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (option_id, revision),
  check (superseded_at is null or superseded_at >= recorded_at)
);

create unique index if not exists idx_option_disruption_current
  on public.option_operational_disruption_assessments(option_id)
  where superseded_at is null;
create index if not exists idx_option_disruption_org
  on public.option_operational_disruption_assessments(organization_id, option_id, recorded_at desc);

create table if not exists public.option_operational_disruption_outages (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null references public.option_operational_disruption_assessments(id) on delete cascade,
  outage_window_id uuid not null references public.outage_windows(id) on delete restrict,
  primary key (assessment_id, outage_window_id)
);
create index if not exists idx_option_disruption_outage_org
  on public.option_operational_disruption_outages(organization_id, outage_window_id);

-- Table-wall scope protects every writer, not only the product RPC.
create or replace function public.enforce_option_operational_disruption_scope()
returns trigger language plpgsql set search_path=public
as $$
declare v_case uuid; v_eval_case uuid; v_eval_business bigint;
begin
  select bc.development_case_id, bc.id into v_case, v_eval_business
  from business_case_options o join business_cases bc on bc.id=o.case_id
  where o.id=new.option_id and o.organization_id=new.organization_id
    and bc.organization_id=new.organization_id;
  if v_case is null then
    raise exception 'operational-disruption assessment and option must belong to the same organization and development case';
  end if;
  select development_case_id, business_case_id into v_eval_case, v_eval_business
  from lifecycle_evaluations e
  where e.id=new.value_evaluation_id and e.organization_id=new.organization_id
    and e.evaluation_kind='case_value'
    and exists (
      select 1 from jsonb_array_elements(e.options) x
      where jsonb_typeof(x)='object' and x ? 'optionId'
        and (x->>'optionId') ~ '^[0-9]+$'
        and (x->>'optionId')::bigint=new.option_id
    );
  if v_eval_case is distinct from v_case then
    raise exception 'ProjectValue must come from an immutable case-value evaluation of this option and case';
  end if;
  if exists (
    select 1 from unnest(array[
      new.construction_disruption_evidence_item_id,
      new.production_loss_evidence_item_id,
      new.simops_risk_evidence_item_id
    ]) evidence_id
    where not exists (select 1 from evidence_items e
      where e.id=evidence_id and e.organization_id=new.organization_id
        and e.development_case_id=v_case)
  ) then
    raise exception 'every disruption term requires evidence bound to this organization and development case';
  end if;
  if tg_op='UPDATE' and (
    old.organization_id is distinct from new.organization_id
    or old.option_id is distinct from new.option_id
    or old.value_evaluation_id is distinct from new.value_evaluation_id
    or old.revision is distinct from new.revision
    or old.construction_disruption_cost is distinct from new.construction_disruption_cost
    or old.construction_disruption_basis is distinct from new.construction_disruption_basis
    or old.construction_disruption_evidence_item_id is distinct from new.construction_disruption_evidence_item_id
    or old.production_loss_cost is distinct from new.production_loss_cost
    or old.production_loss_basis is distinct from new.production_loss_basis
    or old.production_loss_evidence_item_id is distinct from new.production_loss_evidence_item_id
    or old.simops_risk_cost is distinct from new.simops_risk_cost
    or old.simops_risk_basis is distinct from new.simops_risk_basis
    or old.simops_risk_evidence_item_id is distinct from new.simops_risk_evidence_item_id
    or old.outage_scope_basis is distinct from new.outage_scope_basis
    or old.recorded_by is distinct from new.recorded_by
    or old.recorded_at is distinct from new.recorded_at
  ) then
    raise exception 'an operational-disruption assessment is immutable; record a new revision';
  end if;
  if tg_op='UPDATE' and old.superseded_at is distinct from new.superseded_at
     and coalesce(current_setting('app.option_disruption_write',true),'')<>'granted' then
    raise exception 'assessment supersession requires the governed recording function';
  end if;
  return new;
end $$;

drop trigger if exists trg_option_operational_disruption_scope on public.option_operational_disruption_assessments;
create trigger trg_option_operational_disruption_scope
before insert or update on public.option_operational_disruption_assessments
for each row execute function public.enforce_option_operational_disruption_scope();

create or replace function public.enforce_option_operational_disruption_outage_scope()
returns trigger language plpgsql set search_path=public
as $$
declare v_site uuid; v_assessment_org uuid;
begin
  select a.organization_id, c.site_id into v_assessment_org, v_site
  from option_operational_disruption_assessments a
  join business_case_options o on o.id=a.option_id
  join business_cases bc on bc.id=o.case_id
  join development_cases c on c.id=bc.development_case_id
  where a.id=new.assessment_id;
  if v_assessment_org is distinct from new.organization_id then
    raise exception 'operational-disruption outage link and assessment must belong to the same organization';
  end if;
  if not exists (
    select 1 from outage_windows w
    where w.id=new.outage_window_id and w.organization_id=new.organization_id
      and w.status<>'cancelled' and w.site_id=v_site
  ) then
    raise exception 'outage window must be active and belong to the brownfield case site and organization';
  end if;
  return new;
end $$;

drop trigger if exists trg_option_operational_disruption_outage_scope on public.option_operational_disruption_outages;
create trigger trg_option_operational_disruption_outage_scope
before insert or update on public.option_operational_disruption_outages
for each row execute function public.enforce_option_operational_disruption_outage_scope();

revoke all on function public.enforce_option_operational_disruption_scope() from public,anon,authenticated;
revoke all on function public.enforce_option_operational_disruption_outage_scope() from public,anon,authenticated;

alter table public.option_operational_disruption_assessments enable row level security;
alter table public.option_operational_disruption_outages enable row level security;
drop policy if exists option_operational_disruption_read on public.option_operational_disruption_assessments;
create policy option_operational_disruption_read
  on public.option_operational_disruption_assessments for select to authenticated
  using (organization_id=public.app_current_org());
drop policy if exists option_operational_disruption_outages_read on public.option_operational_disruption_outages;
create policy option_operational_disruption_outages_read
  on public.option_operational_disruption_outages for select to authenticated
  using (organization_id=public.app_current_org());
-- No client write policy: all writes use the governed role- and tenant-scoped RPC.

create or replace function public.record_option_operational_disruption_assessment(
  p_option_id bigint,
  p_value_evaluation_id uuid,
  p_construction_disruption_cost numeric,
  p_construction_disruption_basis text,
  p_construction_disruption_evidence_item_id uuid,
  p_production_loss_cost numeric,
  p_production_loss_basis text,
  p_production_loss_evidence_item_id uuid,
  p_simops_risk_cost numeric,
  p_simops_risk_basis text,
  p_simops_risk_evidence_item_id uuid,
  p_outage_window_ids uuid[] default '{}'::uuid[],
  p_outage_scope_basis text default null
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
  v_case development_cases%rowtype; v_bc business_cases%rowtype;
  v_option business_case_options%rowtype; v_eval lifecycle_evaluations%rowtype;
  v_id uuid; v_revision int; v_outage_count int; v_net numeric;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from user_profiles where id=v_actor and organization_id=v_org;
  if coalesce(v_role,'') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','recording operational disruption requires a planning, engineering or governance role');
  end if;
  select o.* into v_option
  from business_case_options o join business_cases bc on bc.id=o.case_id
  where o.id=p_option_id and o.organization_id=v_org and bc.organization_id=v_org;
  if not found then
    return jsonb_build_object('error','option is not bound to a development case in this organization');
  end if;
  select * into v_bc from business_cases
  where id=v_option.case_id and organization_id=v_org;
  if not found or v_bc.development_case_id is null then
    return jsonb_build_object('error','option is not bound to a development case in this organization');
  end if;
  select * into v_case from development_cases
  where id=v_bc.development_case_id and organization_id=v_org;
  if not found or v_case.lifecycle_type<>'brownfield' then
    return jsonb_build_object('error','operational-disruption modelling is available for a brownfield development case');
  end if;
  if v_case.site_id is null then
    return jsonb_build_object('error','brownfield operational-disruption modelling requires the affected site');
  end if;
  select * into v_eval from lifecycle_evaluations e
  where e.id=p_value_evaluation_id and e.organization_id=v_org
    and e.evaluation_kind='case_value'
    and e.development_case_id=v_case.id and e.business_case_id=v_bc.id
    and exists (
      select 1 from jsonb_array_elements(e.options) x
      where jsonb_typeof(x)='object' and x ? 'optionId'
        and (x->>'optionId') ~ '^[0-9]+$'
        and (x->>'optionId')::bigint=p_option_id
    );
  if not found then
    return jsonb_build_object('error','ProjectValue requires an immutable case-value evaluation recorded for this exact option');
  end if;
  if least(coalesce(p_construction_disruption_cost,-1),coalesce(p_production_loss_cost,-1),coalesce(p_simops_risk_cost,-1))<0 then
    return jsonb_build_object('error','construction disruption, production loss and SIMOPS risk costs must each be non-negative');
  end if;
  if coalesce(length(btrim(p_construction_disruption_basis)),0)<20
     or coalesce(length(btrim(p_production_loss_basis)),0)<20
     or coalesce(length(btrim(p_simops_risk_basis)),0)<20 then
    return jsonb_build_object('error','each disruption term requires its own substantive basis (20 characters minimum)');
  end if;
  if coalesce(length(btrim(p_outage_scope_basis)),0)<20 then
    return jsonb_build_object('error','outage scope requires a substantive basis, including when no outage is required');
  end if;
  if exists (
    select 1 from unnest(array[
      p_construction_disruption_evidence_item_id,
      p_production_loss_evidence_item_id,
      p_simops_risk_evidence_item_id
    ]) evidence_id
    where not exists (select 1 from evidence_items e
      where e.id=evidence_id and e.organization_id=v_org
        and e.development_case_id=v_case.id)
  ) then
    return jsonb_build_object('error','each term requires an evidence item bound to this development case');
  end if;
  if exists(select 1 from unnest(coalesce(p_outage_window_ids,'{}'::uuid[])) x where x is null) then
    return jsonb_build_object('error','outage scope cannot contain a null window');
  end if;
  select count(distinct x) into v_outage_count
  from unnest(coalesce(p_outage_window_ids,'{}'::uuid[])) x;
  if v_outage_count<>coalesce(array_length(p_outage_window_ids,1),0) then
    return jsonb_build_object('error','outage scope cannot repeat a window');
  end if;
  if exists (
    select 1 from unnest(coalesce(p_outage_window_ids,'{}'::uuid[])) x
    where not exists (
      select 1 from outage_windows w where w.id=x and w.organization_id=v_org
        and w.site_id=v_case.site_id and w.status<>'cancelled'
    )
  ) then
    return jsonb_build_object('error','every outage window must be active and belong to this brownfield case site and organization');
  end if;

  select coalesce(max(revision),0)+1 into v_revision
  from option_operational_disruption_assessments where option_id=p_option_id;
  perform set_config('app.option_disruption_write','granted',true);
  update option_operational_disruption_assessments set superseded_at=now()
  where option_id=p_option_id and organization_id=v_org and superseded_at is null;
  insert into option_operational_disruption_assessments(
    organization_id,option_id,value_evaluation_id,revision,
    construction_disruption_cost,construction_disruption_basis,construction_disruption_evidence_item_id,
    production_loss_cost,production_loss_basis,production_loss_evidence_item_id,
    simops_risk_cost,simops_risk_basis,simops_risk_evidence_item_id,
    outage_scope_basis,recorded_by)
  values(v_org,p_option_id,p_value_evaluation_id,v_revision,
    p_construction_disruption_cost,btrim(p_construction_disruption_basis),p_construction_disruption_evidence_item_id,
    p_production_loss_cost,btrim(p_production_loss_basis),p_production_loss_evidence_item_id,
    p_simops_risk_cost,btrim(p_simops_risk_basis),p_simops_risk_evidence_item_id,
    btrim(p_outage_scope_basis),v_actor)
  returning id into v_id;
  insert into option_operational_disruption_outages(organization_id,assessment_id,outage_window_id)
  select v_org,v_id,x from unnest(coalesce(p_outage_window_ids,'{}'::uuid[])) x;
  perform set_config('app.option_disruption_write','',true);

  v_net:=v_eval.expected_value-p_construction_disruption_cost-p_production_loss_cost-p_simops_risk_cost;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'option_operational_disruption_assessment',coalesce(v_role,'unknown'),jsonb_build_object(
    'assessment_id',v_id,'option_id',p_option_id,'revision',v_revision,
    'value_evaluation_id',p_value_evaluation_id,'project_value',v_eval.expected_value,
    'construction_disruption',p_construction_disruption_cost,'production_loss',p_production_loss_cost,
    'simops_risk',p_simops_risk_cost,'net_option_value',v_net,'outage_count',v_outage_count,
    'calculation_only_not_approval_or_selection',true));
  return jsonb_build_object('assessmentId',v_id,'revision',v_revision,
    'projectValue',v_eval.expected_value,'netOptionValue',v_net,'outageCount',v_outage_count,
    'formula','ProjectValue − ConstructionDisruption − ProductionLoss − SIMOPSRisk',
    'decisionBoundary','Recorded calculation only; no option is ranked, recommended, approved or selected.');
end $$;
revoke all on function public.record_option_operational_disruption_assessment(bigint,uuid,numeric,text,uuid,numeric,text,uuid,numeric,text,uuid,uuid[],text) from public,anon;
grant execute on function public.record_option_operational_disruption_assessment(bigint,uuid,numeric,text,uuid,numeric,text,uuid,numeric,text,uuid,uuid[],text) to authenticated;

create or replace function public.get_case_operational_disruption(p_case_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); c development_cases%rowtype; bc business_cases%rowtype;
begin
  select * into c from development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;
  if c.lifecycle_type<>'brownfield' then
    return jsonb_build_object('caseId',c.id,'available',false,'reason','Operational-disruption modelling applies to brownfield development cases.','options','[]'::jsonb,
      'formula','ProjectValue − ConstructionDisruption − ProductionLoss − SIMOPSRisk');
  end if;
  if c.site_id is null then
    return jsonb_build_object('caseId',c.id,'available',false,'reason','Record the affected site before modelling brownfield disruption.','options','[]'::jsonb,
      'formula','ProjectValue − ConstructionDisruption − ProductionLoss − SIMOPSRisk');
  end if;
  select * into bc from business_cases where organization_id=v_org and development_case_id=c.id
  order by created_at desc,id desc limit 1;
  if not found then
    return jsonb_build_object('caseId',c.id,'available',false,'reason','Record a business case and options before modelling operational disruption.','options','[]'::jsonb,
      'formula','ProjectValue − ConstructionDisruption − ProductionLoss − SIMOPSRisk');
  end if;
  return jsonb_build_object(
    'caseId',c.id,'available',true,'currency',bc.currency,
    'formula','ProjectValue − ConstructionDisruption − ProductionLoss − SIMOPSRisk',
    'availableOutageWindows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',w.id,'windowKey',w.window_key,'title',w.title,'kind',w.kind,
      'startsAt',w.starts_at,'endsAt',w.ends_at,'status',w.status) order by w.starts_at,w.window_key)
      from outage_windows w where w.organization_id=v_org and w.site_id=c.site_id and w.status<>'cancelled'),'[]'::jsonb),
    'options',coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'label',o.label,'isDoNothing',o.is_do_nothing,
      'valueEvaluations',coalesce((select jsonb_agg(jsonb_build_object(
        'id',e.id,'projectValue',e.expected_value,'basis',e.rationale,
        'uncertaintyLevel',e.uncertainty_level,'evaluatedAt',e.evaluated_at,
        'engineVersion',e.engine_version) order by e.evaluated_at desc,e.id desc)
        from lifecycle_evaluations e where e.organization_id=v_org
          and e.development_case_id=c.id and e.business_case_id=bc.id
          and e.evaluation_kind='case_value' and exists(
            select 1 from jsonb_array_elements(e.options) x
            where jsonb_typeof(x)='object' and x ? 'optionId'
              and (x->>'optionId') ~ '^[0-9]+$' and (x->>'optionId')::bigint=o.id
          )),'[]'::jsonb),
      'assessment',case when a.id is null then null else jsonb_build_object(
        'id',a.id,'revision',a.revision,'valueEvaluationId',a.value_evaluation_id,
        'projectValue',e.expected_value,
        'constructionDisruption',a.construction_disruption_cost,
        'constructionDisruptionBasis',a.construction_disruption_basis,
        'constructionDisruptionEvidenceItemId',a.construction_disruption_evidence_item_id,
        'productionLoss',a.production_loss_cost,'productionLossBasis',a.production_loss_basis,
        'productionLossEvidenceItemId',a.production_loss_evidence_item_id,
        'simopsRisk',a.simops_risk_cost,'simopsRiskBasis',a.simops_risk_basis,
        'simopsRiskEvidenceItemId',a.simops_risk_evidence_item_id,
        'netOptionValue',e.expected_value-a.construction_disruption_cost-a.production_loss_cost-a.simops_risk_cost,
        'outageScopeBasis',a.outage_scope_basis,'recordedBy',a.recorded_by,'recordedAt',a.recorded_at,
        'outages',coalesce((select jsonb_agg(jsonb_build_object(
          'id',w.id,'windowKey',w.window_key,'title',w.title,'kind',w.kind,
          'startsAt',w.starts_at,'endsAt',w.ends_at,'status',w.status) order by w.starts_at,w.window_key)
          from option_operational_disruption_outages ao join outage_windows w on w.id=ao.outage_window_id
          where ao.assessment_id=a.id),'[]'::jsonb)
      ) end,
      'missing',case when a.id is null then jsonb_build_array(
        'ProjectValue evaluation','ConstructionDisruption','ProductionLoss','SIMOPSRisk','outage scope') else '[]'::jsonb end
    ) order by o.is_do_nothing desc,o.label)
    from business_case_options o
    left join lateral (select x.* from option_operational_disruption_assessments x
      where x.option_id=o.id and x.organization_id=v_org and x.superseded_at is null) a on true
    left join lifecycle_evaluations e on e.id=a.value_evaluation_id and e.organization_id=v_org
    where o.case_id=bc.id and o.organization_id=v_org),'[]'::jsonb),
    'comparisonComplete',coalesce((select bool_and(exists(select 1 from option_operational_disruption_assessments a
      where a.option_id=o.id and a.organization_id=v_org and a.superseded_at is null))
      from business_case_options o where o.case_id=bc.id and o.organization_id=v_org),false),
    'decisionBoundary','Net option value is a transparent recorded calculation. SyncAI does not rank, recommend, approve or select an option; an authorized human uses the evidence and governance process.'
  );
end $$;
revoke all on function public.get_case_operational_disruption(uuid) from public,anon;
grant execute on function public.get_case_operational_disruption(uuid) to authenticated;

comment on function public.get_case_operational_disruption(uuid) is
  'D2.09: evidence-backed brownfield ProjectValue minus construction disruption, production loss and SIMOPS risk, with canonical outage scope and no automatic option selection.';

notify pgrst,'reload schema';
