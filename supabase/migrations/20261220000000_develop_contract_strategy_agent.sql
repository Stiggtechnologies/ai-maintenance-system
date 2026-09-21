-- D12.02 / spec I.17 — evidence-grounded contract-strategy recommendation.
--
-- The recommendation is the canonical recommendations row. This migration
-- adds only its structured six-factor assessment and seven-alternative
-- comparison; it creates no parallel recommendation, approval, contract or
-- award model. Every output is pending and contract award remains the existing
-- named-human procurement act.

insert into public.decision_rights
  (right_key, tier, title, description, enforcement, required_authority, register_ref)
values
  ('recommend_contract_strategy', 'auto', 'Recommend contract strategy',
   'Compare the seven controlled contract strategies for accountable human review; never award, select a bidder or commit spend.',
   'enforced', null, 'D12.02')
on conflict (right_key) do update set
  title = excluded.title,
  description = excluded.description,
  enforcement = excluded.enforcement,
  register_ref = excluded.register_ref;

alter table public.recommendations
  add column if not exists contract_strategy text;

alter table public.recommendations
  drop constraint if exists recommendations_contract_strategy_check;
alter table public.recommendations
  add constraint recommendations_contract_strategy_check
  check (contract_strategy is null or contract_strategy = any(public.sync_contract_types()));

create table if not exists public.contract_strategy_assessments (
  recommendation_id uuid primary key references public.recommendations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  development_case_id uuid not null references public.development_cases(id) on delete cascade,
  assessment jsonb not null check (jsonb_typeof(assessment) = 'object'),
  evaluations jsonb not null check (jsonb_typeof(evaluations) = 'array'),
  limitations text not null check (length(btrim(limitations)) >= 20),
  model text check (model is null or length(model) <= 200),
  requested_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_contract_strategy_assessments_case
  on public.contract_strategy_assessments(organization_id, development_case_id, created_at desc);

alter table public.contract_strategy_assessments enable row level security;
drop policy if exists contract_strategy_assessments_read on public.contract_strategy_assessments;
create policy contract_strategy_assessments_read
  on public.contract_strategy_assessments for select to authenticated
  using (organization_id = public.app_current_org());
revoke insert, update, delete, truncate on public.contract_strategy_assessments
  from public, anon, authenticated;

create or replace function public.enforce_contract_strategy_assessment_integrity()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.recommendations%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'contract-strategy assessments are immutable; record a new pending recommendation';
  end if;
  select * into r from public.recommendations where id = new.recommendation_id;
  if not found or r.organization_id <> new.organization_id
     or r.development_case_id <> new.development_case_id
     or r.contract_strategy is null then
    raise exception 'contract-strategy assessment must extend its canonical case recommendation';
  end if;
  return new;
end $$;
revoke all on function public.enforce_contract_strategy_assessment_integrity() from public, anon, authenticated;
drop trigger if exists trg_contract_strategy_assessment_integrity on public.contract_strategy_assessments;
create trigger trg_contract_strategy_assessment_integrity
  before insert or update or delete on public.contract_strategy_assessments
  for each row execute function public.enforce_contract_strategy_assessment_integrity();

-- This migration seeds an adopted agent_control_profiles row on every
-- organization insert. The C1.14 history trigger on main refuses DELETE of
-- non-draft profiles, which contradicts the ON DELETE CASCADE already
-- declared on organization_id: a probe-org teardown (and any real tenant
-- removal) cannot complete. Tenant teardown is not a control mutation —
-- the adopted-control invariant governs in-place rewrite while the tenant
-- exists; it does not outlive the tenant. Same idiom as
-- enforce_framework_immutability / thread-object mid-cascade escapes.
create or replace function public.enforce_agent_control_history()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_adopter_role text;
begin
  if tg_op='DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id) then
      return old;
    end if;
    if old.status <> 'draft' then
      raise exception 'adopted agent controls are immutable; supersede them with a new version';
    end if;
    return old;
  end if;
  if tg_op='UPDATE' and old.status='adopted' then
    if new.status <> 'superseded'
       or new.organization_id is distinct from old.organization_id
       or new.agent_id is distinct from old.agent_id
       or new.authority_mode is distinct from old.authority_mode
       or new.required_human_approver_role is distinct from old.required_human_approver_role
       or new.proposal_risk_ceiling is distinct from old.proposal_risk_ceiling
       or new.proposal_cost_ceiling_usd is distinct from old.proposal_cost_ceiling_usd
       or new.proposal_downtime_ceiling_hours is distinct from old.proposal_downtime_ceiling_hours
       or new.may_approve is distinct from old.may_approve
       or new.basis is distinct from old.basis
       or new.version is distinct from old.version
       or new.adopted_by is distinct from old.adopted_by
       or new.adopted_at is distinct from old.adopted_at then
      raise exception 'adopted agent controls are immutable; supersede them with a new version';
    end if;
  end if;
  if new.status='adopted' and new.adopted_by is not null then
    select role into v_adopter_role from user_profiles
      where id=new.adopted_by and organization_id=new.organization_id;
    if v_adopter_role is null or v_adopter_role not in ('admin','executive') then
      raise exception 'adopted agent controls require an accountable human administrator or executive';
    end if;
  end if;
  if new.status='adopted' and new.adopted_by is null
     and new.basis <> 'Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.' then
    raise exception 'only the exact non-authoritative platform advisory baseline may omit a human adopter';
  end if;
  return new;
end; $$;
revoke all on function public.enforce_agent_control_history() from public,anon,authenticated;

create or replace function public.enforce_agent_binding_history()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
  if tg_op='UPDATE' then
    raise exception 'agent control bindings are immutable; adopt a new profile version';
  end if;
  if tg_op='DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from agent_control_profiles where id = old.profile_id) then
      return old;
    end if;
  end if;
  select status into v_status from agent_control_profiles
    where id=case when tg_op='DELETE' then old.profile_id else new.profile_id end;
  if tg_op='INSERT' and v_status <> 'draft' then
    raise exception 'bindings can only be added while the profile is draft';
  end if;
  if tg_op='DELETE' and v_status <> 'draft' then
    raise exception 'adopted agent control bindings are immutable';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function public.enforce_agent_binding_history() from public,anon,authenticated;

create or replace function public.provision_contract_strategy_agent(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := p_org;
  v_agent uuid;
  v_profile uuid;
begin
  select id into v_agent from public.ai_agents
   where organization_id = v_org and key = 'contract_strategy'
   order by created_at limit 1;
  if v_agent is null then
    insert into public.ai_agents
      (organization_id, key, name, category, status, autonomy_mode,
       current_task, confidence, supervisor)
    values
      (v_org, 'contract_strategy', 'Contract Strategy Advisor', 'project_delivery',
       'active', 'advisory', 'Compare contract strategies for human review', null,
       'Accountable procurement authority')
    returning id into v_agent;
  end if;

  select id into v_profile from public.agent_control_profiles
   where agent_id = v_agent and status = 'adopted' limit 1;
  if v_profile is null then
    insert into public.agent_control_profiles
      (organization_id, agent_id, authority_mode, required_human_approver_role,
       proposal_risk_ceiling, proposal_cost_ceiling_usd,
       proposal_downtime_ceiling_hours, may_approve, basis, status, version)
    values
      (v_org, v_agent, 'advisory_only', 'maintenance_manager', 'Critical', 0, 0,
       false,
       'Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.',
       'draft', 1)
    returning id into v_profile;

    insert into public.agent_decision_right_bindings
      (organization_id, profile_id, agent_id, decision_right_id)
    select v_org, v_profile, v_agent, id from public.decision_rights
     where right_key = 'recommend_contract_strategy';
    insert into public.agent_tool_bindings
      (organization_id, profile_id, agent_id, tool_id)
    select v_org, v_profile, v_agent, id from public.agent_software_tools
     where tool_key = 'draft_recommendation';
    update public.agent_control_profiles
       set status = 'adopted', adopted_at = now()
     where id = v_profile;
  end if;
  return;
end $$;
revoke all on function public.provision_contract_strategy_agent(uuid) from public, anon, authenticated;

create or replace function public.seed_contract_strategy_agent_for_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.provision_contract_strategy_agent(new.id);
  return new;
end $$;
revoke all on function public.seed_contract_strategy_agent_for_org() from public, anon, authenticated;

drop trigger if exists trg_seed_contract_strategy_agent on public.organizations;
create trigger trg_seed_contract_strategy_agent
  after insert on public.organizations
  for each row execute function public.seed_contract_strategy_agent_for_org();

do $$ declare o public.organizations%rowtype;
begin
  for o in select * from public.organizations loop
    perform public.provision_contract_strategy_agent(o.id);
  end loop;
end $$;

create or replace function public.get_contract_strategy_context(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  c public.development_cases%rowtype;
begin
  if v_org is null then return jsonb_build_object('error', 'forbidden'); end if;
  select * into c from public.development_cases
   where id = p_case_id and organization_id = v_org;
  if not found then return jsonb_build_object('error', 'development case not found'); end if;
  return jsonb_build_object(
    'caseId', c.id,
    'caseTitle', c.title,
    'caseStatus', c.status,
    'allowedStrategies', to_jsonb(public.sync_contract_types()),
    'priorRecommendations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'recommendationId', r.id, 'strategy', r.contract_strategy,
        'status', r.status, 'createdAt', r.created_at)
        order by r.created_at desc)
      from public.recommendations r
      where r.organization_id = v_org and r.development_case_id = c.id
        and r.contract_strategy is not null
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.get_contract_strategy_context(uuid) from public, anon;
grant execute on function public.get_contract_strategy_context(uuid) to authenticated;

create or replace function public.record_contract_strategy_recommendation(
  p_case_id uuid,
  p_assessment jsonb,
  p_advice jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_dimension text;
  v_factor jsonb;
  v_evidence uuid;
  v_strategy text := nullif(btrim(coalesce(p_advice->>'recommendedStrategy', '')), '');
  v_rationale text := btrim(coalesce(p_advice->>'rationale', ''));
  v_limitations text := btrim(coalesce(p_advice->>'limitations', ''));
  v_model text := nullif(btrim(coalesce(p_advice->>'model', '')), '');
  v_agent uuid;
  v_recommendation uuid;
  v_expected text[] := array['definition_maturity','uncertainty','market_conditions',
    'owner_capability','interface_complexity','risk_allocation'];
begin
  if v_org is null then return jsonb_build_object('error', 'forbidden'); end if;
  select role into v_role from public.user_profiles
   where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'requesting contract-strategy advice requires a planning, engineering or governance role');
  end if;
  if not exists (select 1 from public.development_cases
      where id = p_case_id and organization_id = v_org and status not in ('cancelled','completed')) then
    return jsonb_build_object('error', 'active development case not found');
  end if;
  if jsonb_typeof(p_assessment) <> 'object'
     or array_length(v_expected, 1) <> (select count(*) from jsonb_object_keys(p_assessment)) then
    return jsonb_build_object('error', 'exactly the six I.17 assessment dimensions are required');
  end if;
  foreach v_dimension in array v_expected loop
    v_factor := p_assessment->v_dimension;
    if v_factor is null or coalesce(v_factor->>'level','') not in ('low','medium','high') then
      return jsonb_build_object('error', v_dimension || ' must be assessed low, medium or high');
    end if;
    if length(btrim(coalesce(v_factor->>'basis',''))) < 20 then
      return jsonb_build_object('error', v_dimension || ' requires a stated basis of at least 20 characters');
    end if;
    v_evidence := public.sync_text_as_uuid(v_factor->>'evidenceItemId');
    if v_evidence is null or not exists (
      select 1 from public.evidence_items e
       where e.id = v_evidence and e.organization_id = v_org
         and e.development_case_id = p_case_id) then
      return jsonb_build_object('error', v_dimension || ' requires evidence recorded against this case');
    end if;
  end loop;
  if v_strategy is null or not (v_strategy = any(public.sync_contract_types())) then
    return jsonb_build_object('error', 'recommendedStrategy is not one of the seven controlled contract strategies');
  end if;
  if length(v_rationale) < 50 or length(v_limitations) < 20 then
    return jsonb_build_object('error', 'the advice requires a substantive rationale and stated limitations');
  end if;
  if v_model is null or length(v_model) > 200 then
    return jsonb_build_object('error', 'the exact model identifier is required and must be at most 200 characters');
  end if;
  if jsonb_typeof(p_advice->'evaluations') <> 'array'
     or jsonb_array_length(p_advice->'evaluations') <> 7
     or (select count(distinct x->>'strategy') from jsonb_array_elements(p_advice->'evaluations') x) <> 7
     or exists (select 1 from jsonb_array_elements(p_advice->'evaluations') x
       where not (coalesce(x->>'strategy','') = any(public.sync_contract_types()))
          or coalesce(x->>'fit','') not in ('strong','conditional','weak')
          or length(btrim(coalesce(x->>'reason',''))) < 20) then
    return jsonb_build_object('error', 'all seven controlled strategies require one substantive comparative evaluation');
  end if;

  select id into v_agent from public.ai_agents
   where organization_id = v_org and key = 'contract_strategy' and status = 'active'
   order by created_at limit 1;
  if v_agent is null then
    return jsonb_build_object('error', 'the controlled contract-strategy advisory agent is not provisioned');
  end if;

  perform set_config('app.recommendation_case_binding_write', 'granted', true);
  insert into public.recommendations
    (organization_id, agent_id, title, issue, action, impact, confidence,
     urgency, status, approval_required, accountable, responsible,
     alternatives_considered, risk_impact, rationale, development_case_id,
     contract_strategy, enrichment_model, agent_tool_key, agent_decision_right_key)
  values
    (v_org, v_agent, 'Review contract strategy: ' || replace(initcap(v_strategy), '_', ' '),
     'Select a pre-tender contract strategy from evidence, without treating the recommendation as an award.',
     'A named human should review the ' || replace(initcap(v_strategy), '_', ' ') || ' recommendation and its seven-alternative comparison.',
     'Contract strategy affects risk allocation, interfaces and delivery incentives; no spend or award is committed here.',
     null, 'advisory', 'pending',
     'Named human procurement or project authority review is required; contract award remains separate.',
     'Accountable project or procurement authority', 'Project and procurement team',
     (p_advice->'evaluations')::text, 'Medium', v_rationale, p_case_id,
     v_strategy, v_model, 'draft_recommendation', 'recommend_contract_strategy')
  returning id into v_recommendation;
  perform set_config('app.recommendation_case_binding_write', '', true);

  insert into public.contract_strategy_assessments
    (recommendation_id, organization_id, development_case_id, assessment,
     evaluations, limitations, model, requested_by)
  values
    (v_recommendation, v_org, p_case_id, p_assessment,
     p_advice->'evaluations', v_limitations, v_model, auth.uid());

  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (v_org, 'contract_strategy_recommendation', coalesce(v_role, 'unknown'),
    jsonb_build_object('recommendation_id', v_recommendation,
      'development_case_id', p_case_id, 'strategy', v_strategy,
      'status', 'pending', 'model', v_model));

  return jsonb_build_object('recommendationId', v_recommendation,
    'strategy', v_strategy, 'status', 'pending');
exception when others then
  perform set_config('app.recommendation_case_binding_write', '', true);
  raise;
end $$;
revoke all on function public.record_contract_strategy_recommendation(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.record_contract_strategy_recommendation(uuid, jsonb, jsonb) to authenticated;

comment on function public.record_contract_strategy_recommendation(uuid, jsonb, jsonb) is
  'D12.02 / I.17: records evidence-grounded advisory output in the ONE recommendations model as pending. It cannot award, select a bidder, commit spend or approve itself.';

notify pgrst, 'reload schema';
