-- ============================================================================
-- C1.04 / C1.05 / C5.02 / C5.03 / C9.02 — governed Planning & Scheduling
-- agent execution.
--
-- The shared agent-control envelope and the human-authored job-plan library
-- already existed.  What did not exist was an executable planning-agent act.
-- This migration closes that seam without creating a second plan store:
--
--   * the agent reads one tenant-owned work order and canonical context;
--   * it either assesses the attached/open draft or creates ONE canonical
--     job_plans draft from exact prior-plan/work-order facts;
--   * it identifies missing scope, labour, materials, tools, permit/isolation,
--     document and acceptance inputs without inventing any of them;
--   * the exact control profile, tool, decision right, input snapshot and
--     result are retained in the canonical agent_runs ledger;
--   * adoption, application, schedule release, expenditure and return to
--     service remain separate named-human acts.
-- ============================================================================

-- A job plan can now carry exact tenant-KB document references.  Absence is
-- therefore measurable rather than inferred from a free-text basis.
alter table public.ai_agents
  add column if not exists operating_charter jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ai_agents'::regclass
      and conname = 'ai_agents_operating_charter_object'
  ) then
    alter table public.ai_agents add constraint ai_agents_operating_charter_object
      check (jsonb_typeof(operating_charter) = 'object');
  end if;
end $$;

update public.ai_agents
set operating_charter = jsonb_build_object(
  'purpose','Turn approved technical intent into executable job-plan drafts and feasible schedule options.',
  'modes',jsonb_build_array('planner','scheduler'),
  'triggers',jsonb_build_array('unplanned work order','weekly scheduling cycle','material or document readiness review'),
  'inputs',jsonb_build_array('tenant work order','asset context','recorded tasks','material demand','adopted reference plans','indexed documents','craft capacity'),
  'outputs',jsonb_build_array('non-authoritative job-plan draft','readiness gaps','material status','schedule option'),
  'guardrails',jsonb_build_array(
    'Never invent tasks, catalogue items, documents, permits, isolations or acceptance criteria',
    'Never overwrite an existing human draft',
    'Never adopt or apply a job plan',
    'Never release or unfreeze a schedule',
    'Never commit spend or return equipment to service',
    'Route every consequential act to a named human'),
  'routes',jsonb_build_array('/job-plans','/scheduling'))
where key = 'planning_scheduling';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ai_agents'::regclass
      and conname = 'ai_agents_planning_charter_shape'
  ) then
    alter table public.ai_agents add constraint ai_agents_planning_charter_shape
      check (key <> 'planning_scheduling' or operating_charter ?&
        array['purpose','modes','triggers','inputs','outputs','guardrails','routes']);
  end if;
end $$;

-- Charters are platform configuration and execution telemetry is written by
-- governed RPCs. The product has no direct ai_agents writer.
revoke insert, update, delete, truncate on table public.ai_agents
  from public, anon, authenticated;

create table if not exists public.job_plan_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_plan_id uuid not null references public.job_plans(id) on delete cascade,
  document_id uuid not null references public.kb_intake_documents(id) on delete restrict,
  purpose text not null check (length(btrim(purpose)) >= 3),
  created_at timestamptz not null default now(),
  unique (job_plan_id, document_id)
);

create index if not exists idx_job_plan_documents_plan
  on public.job_plan_documents(organization_id, job_plan_id);

alter table public.job_plan_documents enable row level security;
drop policy if exists job_plan_documents_read on public.job_plan_documents;
create policy job_plan_documents_read on public.job_plan_documents
  for select to authenticated
  using (organization_id = app_current_org());
revoke insert, update, delete, truncate on table public.job_plan_documents
  from public, anon, authenticated;

create or replace function public.enforce_job_plan_document_tenancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.job_plans p
    where p.id = new.job_plan_id and p.organization_id = new.organization_id
  ) or not exists (
    select 1 from public.kb_intake_documents d
    where d.id = new.document_id
      and d.organization_id = new.organization_id
      and d.status = 'indexed'
  ) then
    raise exception 'job-plan document link crosses tenant, names an unavailable document, or names the wrong plan';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_job_plan_document_tenancy()
  from public, anon, authenticated;
drop trigger if exists trg_job_plan_document_tenancy on public.job_plan_documents;
create trigger trg_job_plan_document_tenancy
  before insert or update on public.job_plan_documents
  for each row execute function public.enforce_job_plan_document_tenancy();

-- Extend the existing ledgers; do not create a parallel agent-run or job-plan
-- family. Retained runs are the durable provenance behind an agent-originated
-- draft and are excluded from the legacy seven-day run-history pruning.
alter table public.agent_runs
  add column if not exists requested_by uuid references auth.users(id),
  add column if not exists work_order_id uuid references public.work_orders(id) on delete set null,
  add column if not exists job_plan_id uuid references public.job_plans(id) on delete set null,
  add column if not exists agent_control_profile_id uuid references public.agent_control_profiles(id) on delete restrict,
  add column if not exists agent_tool_key text,
  add column if not exists agent_decision_right_key text,
  add column if not exists input_snapshot jsonb,
  add column if not exists result jsonb,
  add column if not exists retained_for_governance boolean not null default false;

alter table public.job_plans
  add column if not exists draft_origin text not null default 'human',
  add column if not exists proposed_by_agent_id uuid references public.ai_agents(id) on delete restrict,
  add column if not exists agent_run_id uuid references public.agent_runs(id) on delete restrict;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.job_plans'::regclass
      and conname = 'job_plans_draft_origin_check'
  ) then
    alter table public.job_plans add constraint job_plans_draft_origin_check
      check (draft_origin in ('human','agent'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.job_plans'::regclass
      and conname = 'job_plans_agent_origin_shape'
  ) then
    alter table public.job_plans add constraint job_plans_agent_origin_shape
      check (
        (draft_origin = 'human' and proposed_by_agent_id is null and agent_run_id is null)
        or
        (draft_origin = 'agent' and proposed_by_agent_id is not null and agent_run_id is not null)
      );
  end if;
end $$;

create index if not exists idx_agent_runs_retained_work
  on public.agent_runs(organization_id, work_order_id, created_at desc)
  where retained_for_governance;

-- Existing clients had an early broad RLS write policy on agent_runs. A
-- durable provenance row is service/RPC written only; reads remain org scoped.
revoke insert, update, delete, truncate on table public.agent_runs
  from public, anon, authenticated;

create or replace function public.enforce_retained_agent_run()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.planner_agent_run_write', true), '');
begin
  if tg_op = 'DELETE' and old.retained_for_governance then
    -- The legacy run-pruner may delete ordinary telemetry. A retained
    -- governance run survives without aborting that maintenance statement.
    return null;
  end if;
  if tg_op = 'UPDATE' and old.retained_for_governance and v_marker <> 'granted' then
    raise exception 'retained agent runs are immutable; run the agent again for a new dated reading';
  end if;
  if tg_op = 'INSERT' and new.retained_for_governance and v_marker <> 'granted' then
    raise exception 'retained agent runs are written only by the governed agent execution path';
  end if;
  if tg_op <> 'DELETE' and new.retained_for_governance then
    if new.requested_by is null or new.work_order_id is null
       or new.agent_control_profile_id is null
       or coalesce(btrim(new.agent_tool_key), '') = ''
       or coalesce(btrim(new.agent_decision_right_key), '') = '' then
      raise exception 'retained agent runs require requester, work, control profile, tool and decision-right provenance';
    end if;
    if not exists (
      select 1 from public.user_profiles p
      where p.id = new.requested_by and p.organization_id = new.organization_id
    ) then
      raise exception 'agent-run requester is not a member of this organization';
    end if;
    if not exists (
      select 1 from public.ai_agents a
      where a.id = new.agent_id and a.organization_id = new.organization_id
    ) then
      raise exception 'agent run crosses its organization boundary';
    end if;
    if not exists (
      select 1 from public.work_orders w
      where w.id = new.work_order_id and w.organization_id = new.organization_id
    ) then
      raise exception 'agent run names work outside its organization';
    end if;
    if new.job_plan_id is not null and not exists (
      select 1 from public.job_plans j
      where j.id = new.job_plan_id and j.organization_id = new.organization_id
    ) then
      raise exception 'agent run names a job plan outside its organization';
    end if;
    if not exists (
      select 1 from public.agent_control_profiles p
      where p.id = new.agent_control_profile_id
        and p.organization_id = new.organization_id
        and p.agent_id = new.agent_id
        and p.status = 'adopted'
    ) then
      raise exception 'agent run does not carry the adopted control profile for this agent';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

revoke all on function public.enforce_retained_agent_run()
  from public, anon, authenticated;
drop trigger if exists trg_retained_agent_run on public.agent_runs;
create trigger trg_retained_agent_run
  before insert or update or delete on public.agent_runs
  for each row execute function public.enforce_retained_agent_run();

create or replace function public.enforce_agent_job_plan_origin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.draft_origin = 'agent' then
    if not exists (
      select 1
      from public.agent_runs r
      where r.id = new.agent_run_id
        and r.organization_id = new.organization_id
        and r.agent_id = new.proposed_by_agent_id
        and r.retained_for_governance
    ) then
      raise exception 'agent-originated plan does not carry a retained same-tenant agent run';
    end if;
    if new.status <> 'draft' and new.adopted_by is null then
      raise exception 'an agent-originated plan may leave draft only through a named-human adoption';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_agent_job_plan_origin()
  from public, anon, authenticated;
drop trigger if exists trg_agent_job_plan_origin on public.job_plans;
create trigger trg_agent_job_plan_origin
  before insert or update on public.job_plans
  for each row execute function public.enforce_agent_job_plan_origin();

-- Extend the live authoring RPC with document references. Exact anchors make
-- this fail closed if the canonical writer changes upstream.
create or replace function public._planner_replace_function(
  p_signature text,
  p_old text,
  p_new text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_oid regprocedure;
  v_definition text;
  v_next text;
begin
  v_oid := to_regprocedure(p_signature);
  if v_oid is null then
    raise exception 'planner-agent migration: function % is missing', p_signature;
  end if;
  select pg_get_functiondef(v_oid) into v_definition;
  if position(p_old in v_definition) = 0 then
    raise exception 'planner-agent migration: anchor not found in %', p_signature;
  end if;
  v_next := replace(v_definition, p_old, p_new);
  if v_next = v_definition then
    raise exception 'planner-agent migration: transformation did not change %', p_signature;
  end if;
  execute v_next;
end
$$;

revoke all on function public._planner_replace_function(text,text,text)
  from public, anon, authenticated;

select public._planner_replace_function(
  'public.upsert_job_plan(jsonb)',
  $old$  v_unresolved text[] := array[]::text[];
  v_n int := 0;$old$,
  $new$  v_unresolved text[] := array[]::text[];
  v_unresolved_docs text[] := array[]::text[];
  v_doc uuid;
  v_n int := 0;$new$
);

select public._planner_replace_function(
  'public.upsert_job_plan(jsonb)',
  $old$  -- Serialize revisions of this key. The second caller waits, then sees the
  -- draft the first caller committed, and updates it instead of inserting
  -- another version.$old$,
  $new$  -- Refuse missing/foreign document ids before any write. The authoring
  -- path links only documents already indexed in this tenant's canonical KB.
  for it in select * from jsonb_array_elements(coalesce(p_plan->'documents', '[]'::jsonb)) loop
    if coalesce(length(btrim(it->>'purpose')),0) < 3 then
      return jsonb_build_object('error',
        'every job-plan document link needs a purpose (3 characters minimum); nothing was saved');
    end if;
    begin
      v_doc := nullif(it->>'document_id', '')::uuid;
    exception when invalid_text_representation then
      v_doc := null;
    end;
    if v_doc is null or not exists (
      select 1 from kb_intake_documents
      where id = v_doc and organization_id = v_org and status = 'indexed'
    ) then
      if coalesce(it->>'document_id', '(blank)') <> all (v_unresolved_docs) then
        v_unresolved_docs := array_append(v_unresolved_docs, coalesce(it->>'document_id', '(blank)'));
      end if;
    end if;
  end loop;
  if coalesce(array_length(v_unresolved_docs, 1), 0) > 0 then
    return jsonb_build_object('error', format(
      'unavailable job-plan document(s) refused; nothing was saved: %s. Index each document in this organization first.',
      array_to_string(v_unresolved_docs, ', ')));
  end if;

  -- Serialize revisions of this key. The second caller waits, then sees the
  -- draft the first caller committed, and updates it instead of inserting
  -- another version.$new$
);

select public._planner_replace_function(
  'public.upsert_job_plan(jsonb)',
  $old$  delete from job_plan_checks where job_plan_id = v_id;$old$,
  $new$  delete from job_plan_checks where job_plan_id = v_id;
  delete from job_plan_documents where job_plan_id = v_id;$new$
);

select public._planner_replace_function(
  'public.upsert_job_plan(jsonb)',
  $old$  for it in select * from jsonb_array_elements(coalesce(p_plan->'checks', '[]'::jsonb)) loop$old$,
  $new$  for it in select * from jsonb_array_elements(coalesce(p_plan->'documents', '[]'::jsonb)) loop
    v_doc := nullif(it->>'document_id', '')::uuid;
    insert into job_plan_documents (organization_id, job_plan_id, document_id, purpose)
    values (v_org, v_id, v_doc, btrim(it->>'purpose'));
  end loop;

  for it in select * from jsonb_array_elements(coalesce(p_plan->'checks', '[]'::jsonb)) loop$new$
);

select public._planner_replace_function(
  'public.get_job_plans()',
  $old$        'checks', (select count(*) from job_plan_checks where job_plan_id = p.id),
        'applied_to_work_orders'$old$,
  $new$        'checks', (select count(*) from job_plan_checks where job_plan_id = p.id),
        'documents', (select count(*) from job_plan_documents where job_plan_id = p.id),
        'draft_origin', p.draft_origin,
        'agent_run_id', p.agent_run_id,
        'applied_to_work_orders'$new$
);

select public._planner_replace_function(
  'public.provision_organization(text,uuid)',
  $old$  insert into ai_agents (organization_id, key, name, category, status, autonomy_mode)
  select v_new, key, name, category, 'active', autonomy_mode
  from ai_agents where organization_id = p_template_org;$old$,
  $new$  insert into ai_agents
    (organization_id, key, name, category, status, autonomy_mode, operating_charter)
  select v_new, key, name, category, 'active', autonomy_mode, operating_charter
  from ai_agents where organization_id = p_template_org;$new$
);

drop function public._planner_replace_function(text,text,text);

-- Upgrade only the exact platform baseline for the combined planning and
-- scheduling agent. Customer-authored control profiles are never rewritten;
-- their administrator must deliberately add these rights/tools in the
-- existing Agent Control panel.
do $$
declare
  r record;
  v_profile uuid;
  v_version int;
  v_basis constant text :=
    'Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.';
begin
  for r in
    select a.id agent_id, a.organization_id, p.id old_profile,
           p.required_human_approver_role, p.proposal_risk_ceiling,
           p.proposal_cost_ceiling_usd, p.proposal_downtime_ceiling_hours
    from public.ai_agents a
    join public.agent_control_profiles p on p.agent_id = a.id
      and p.organization_id = a.organization_id and p.status = 'adopted'
    where a.key = 'planning_scheduling' and p.basis = v_basis
  loop
    select coalesce(max(version),0)+1 into v_version
    from public.agent_control_profiles where agent_id = r.agent_id;
    update public.agent_control_profiles set status = 'superseded'
    where id = r.old_profile;
    insert into public.agent_control_profiles
      (organization_id,agent_id,authority_mode,required_human_approver_role,
       proposal_risk_ceiling,proposal_cost_ceiling_usd,
       proposal_downtime_ceiling_hours,may_approve,basis,status,version,adopted_at)
    values
      (r.organization_id,r.agent_id,'advisory_only',
       r.required_human_approver_role,r.proposal_risk_ceiling,
       r.proposal_cost_ceiling_usd,r.proposal_downtime_ceiling_hours,
       false,v_basis,'draft',v_version,null)
    returning id into v_profile;

    insert into public.agent_decision_right_bindings
      (organization_id,profile_id,agent_id,decision_right_id)
    select r.organization_id,v_profile,r.agent_id,d.id
    from public.decision_rights d
    where d.right_key in (
      'draft_job_plans','identify_missing_materials_docs','produce_schedule_options'
    );

    insert into public.agent_tool_bindings
      (organization_id,profile_id,agent_id,tool_id)
    select r.organization_id,v_profile,r.agent_id,t.id
    from public.agent_software_tools t
    where t.tool_key in (
      'read_work_context','draft_job_plan','propose_schedule','draft_recommendation'
    );

    update public.agent_control_profiles
    set status = 'adopted', adopted_at = now()
    where id = v_profile;
  end loop;
end
$$;

create or replace function public.run_planning_agent(p_work_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  w public.work_orders%rowtype;
  a public.assets%rowtype;
  ag public.ai_agents%rowtype;
  ref public.job_plans%rowtype;
  p public.job_plans%rowtype;
  v_control jsonb;
  v_material_control jsonb;
  v_risk text;
  v_key text;
  v_run uuid;
  v_plan uuid;
  v_created boolean := false;
  v_reference uuid;
  v_gaps jsonb := '[]'::jsonb;
  v_materials jsonb := '[]'::jsonb;
  v_result jsonb;
  v_steps int;
  v_labour_gaps int;
  v_plan_materials int;
  v_unready_materials int;
  v_tools int;
  v_permits int;
  v_documents int;
  v_checks int;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role,'') not in
     ('planner','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error',
      'running the Planning agent requires a named human planning, engineering or maintenance-management role');
  end if;
  select * into w from public.work_orders
  where id = p_work_order_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','work order not found'); end if;
  if w.status in ('completed','cancelled') then
    return jsonb_build_object('error','completed or cancelled work cannot receive a new planning-agent draft');
  end if;
  if w.asset_id is not null then
    select * into a from public.assets where id = w.asset_id and organization_id = v_org;
  end if;
  select * into ag from public.ai_agents
  where organization_id = v_org and key = 'planning_scheduling'
  order by created_at limit 1;
  if not found then
    return jsonb_build_object('error',
      'no Planning & Scheduling agent is configured in this organization');
  end if;

  v_risk := case
    when coalesce(w.safety_flag,false) or lower(coalesce(w.priority,'')) = 'critical' then 'Critical'
    when lower(coalesce(w.priority,'')) = 'high' then 'High'
    when lower(coalesce(w.priority,'')) = 'medium' then 'Medium'
    else 'Low' end;
  v_control := public.evaluate_agent_control_internal(
    v_org, ag.id, 'draft_job_plans', 'draft_job_plan', v_risk, null, null);
  if not coalesce((v_control->>'allowed')::boolean,false) then
    return jsonb_build_object('error','Planning agent refused: '||(v_control->>'reason'));
  end if;
  v_material_control := public.evaluate_agent_control_internal(
    v_org, ag.id, 'identify_missing_materials_docs', 'read_work_context',
    v_risk, null, null);
  if not coalesce((v_material_control->>'allowed')::boolean,false) then
    return jsonb_build_object('error',
      'Planning agent material/document check refused: '||(v_material_control->>'reason'));
  end if;
  if v_material_control->>'profile_id' is distinct from v_control->>'profile_id' then
    return jsonb_build_object('error','Planning agent control profile changed during the run; retry');
  end if;

  v_key := left('AGENT-WO-' || upper(regexp_replace(
    coalesce(nullif(btrim(w.wo_number),''), left(w.id::text,8)),
    '[^A-Za-z0-9]+','-','g')), 120);

  -- Resolve, but never overwrite: an attached plan wins; then an existing
  -- open work-order draft. Only the absence of both allows a new agent draft.
  if w.job_plan_id is not null then
    select * into p from public.job_plans
    where id = w.job_plan_id and organization_id = v_org;
    if not found then
      return jsonb_build_object('error','work order names an unreadable job plan');
    end if;
    v_plan := p.id;
  else
    select * into p from public.job_plans
    where organization_id = v_org and plan_key = v_key
      and status in ('draft','adopted')
    order by case when status='draft' then 0 else 1 end, version desc limit 1;
    if found then
      v_plan := p.id;
    end if;
  end if;

  if v_plan is null then
    select jp.* into ref
    from public.job_plans jp
    where jp.organization_id = v_org and jp.status = 'adopted'
      and (
        (a.id is not null and nullif(btrim(a.asset_class),'') is not null
          and lower(jp.applies_to_asset_class) = lower(a.asset_class))
        or
        (a.id is not null and nullif(btrim(a.system),'') is not null
          and lower(jp.applies_to_system_group) = lower(a.system))
      )
    order by
      case when lower(jp.applies_to_asset_class) = lower(a.asset_class) then 0 else 1 end,
      jp.version desc, jp.adopted_at desc
    limit 1;
    if found then v_reference := ref.id; end if;
  end if;

  perform set_config('app.planner_agent_run_write','granted',true);
  insert into public.agent_runs
    (organization_id,agent_id,asset_id,status,summary,confidence,
     started_at,requested_by,work_order_id,agent_control_profile_id,
     agent_tool_key,agent_decision_right_key,input_snapshot,
     retained_for_governance)
  values
    (v_org,ag.id,w.asset_id,'running','Planning agent is reading canonical work context.',
     100,now(),auth.uid(),w.id,(v_control->>'profile_id')::uuid,
     'draft_job_plan','draft_job_plans',
     jsonb_build_object(
       'asOf',now(),'workOrderId',w.id,'workOrderNumber',w.wo_number,
       'workStatus',w.status,'priority',w.priority,'assetId',w.asset_id,
       'assetClass',a.asset_class,'system',a.system,'referencePlanId',v_reference,
       'sourceTables',jsonb_build_array(
         'work_orders','assets','work_order_tasks','work_order_materials',
         'job_plans','job_plan_steps','job_plan_materials','job_plan_tools',
         'job_plan_permits','job_plan_documents','job_plan_checks')),
     true)
  returning id into v_run;

  if v_plan is null then
    insert into public.job_plans
      (organization_id,plan_key,title,scope,applies_to_asset_class,
       applies_to_system_group,version,status,basis,created_by,draft_origin,
       proposed_by_agent_id,agent_run_id)
    values
      (v_org,v_key,'Draft plan — '||coalesce(w.wo_number,w.id::text)||' — '||w.title,
       coalesce(nullif(btrim(w.description),''),
         'Planning boundary from work order '||coalesce(w.wo_number,w.id::text)||': '||w.title),
       a.asset_class,a.system,1,'draft',
       case when v_reference is not null
         then 'Planning agent copied exact content from adopted plan '||v_reference::text||
              '; a named human must verify applicability, edit and adopt.'
         else 'Planning agent used only recorded work-order context; missing content is listed in retained run '
              ||v_run::text||'. A named human must complete and adopt.' end,
       auth.uid(),'agent',ag.id,v_run)
    returning id into v_plan;
    v_created := true;

    if v_reference is not null then
      insert into public.job_plan_steps
        (organization_id,job_plan_id,step_number,description,craft,crew_size,estimated_hours)
      select v_org,v_plan,step_number,description,craft,crew_size,estimated_hours
      from public.job_plan_steps where job_plan_id = v_reference;
      insert into public.job_plan_materials
        (organization_id,job_plan_id,material_id,qty)
      select v_org,v_plan,material_id,qty
      from public.job_plan_materials where job_plan_id = v_reference;
      insert into public.job_plan_tools
        (organization_id,job_plan_id,tool,note)
      select v_org,v_plan,tool,note
      from public.job_plan_tools where job_plan_id = v_reference;
      insert into public.job_plan_permits
        (organization_id,job_plan_id,permit_type,isolation_required,verification_note)
      select v_org,v_plan,permit_type,isolation_required,verification_note
      from public.job_plan_permits where job_plan_id = v_reference;
      insert into public.job_plan_documents
        (organization_id,job_plan_id,document_id,purpose)
      select v_org,v_plan,document_id,purpose
      from public.job_plan_documents where job_plan_id = v_reference;
      insert into public.job_plan_checks
        (organization_id,job_plan_id,check_description,acceptance_criterion,is_hold_point)
      select v_org,v_plan,check_description,acceptance_criterion,is_hold_point
      from public.job_plan_checks where job_plan_id = v_reference;
    else
      insert into public.job_plan_steps
        (organization_id,job_plan_id,step_number,description,craft,crew_size,estimated_hours)
      select v_org,v_plan,(row_number() over(order by task_sequence,id))::int,
             btrim(description),craft,coalesce(crew_size,1),estimated_hours
      from public.work_order_tasks
      where work_order_id = w.id and organization_id = v_org
        and coalesce(length(btrim(description)),0) > 0
        and estimated_hours > 0;
      insert into public.job_plan_materials
        (organization_id,job_plan_id,material_id,qty)
      select v_org,v_plan,material_id,qty_required
      from public.work_order_materials
      where work_order_id = w.id and organization_id = v_org
        and status <> 'cancelled';
    end if;
  end if;

  select count(*), count(*) filter (
      where nullif(btrim(coalesce(craft,'')),'') is null
         or crew_size is null or crew_size <= 0
         or estimated_hours is null or estimated_hours <= 0)
    into v_steps,v_labour_gaps
  from public.job_plan_steps where job_plan_id = v_plan;
  select count(*) into v_plan_materials
  from public.job_plan_materials where job_plan_id = v_plan;
  select count(*) into v_tools
  from public.job_plan_tools where job_plan_id = v_plan;
  select count(*) into v_permits
  from public.job_plan_permits where job_plan_id = v_plan;
  select count(*) into v_documents
  from public.job_plan_documents where job_plan_id = v_plan;
  select count(*) into v_checks
  from public.job_plan_checks where job_plan_id = v_plan
    and nullif(btrim(acceptance_criterion),'') is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
      'materialId',pm.material_id,'materialCode',m.material_code,
      'description',m.description,'quantity',pm.qty,
      'workOrderStatus',coalesce(wm.status,'not_requested'),
      'quantityReserved',coalesce(wm.qty_reserved,0),
      'quantityRequired',coalesce(wm.qty_required,pm.qty),
      'ready',coalesce(wm.status in ('kitted','issued'),false))
      order by m.material_code),'[]'::jsonb),
    count(*) filter (where wm.id is null or wm.status not in ('kitted','issued'))
  into v_materials,v_unready_materials
  from public.job_plan_materials pm
  join public.materials m on m.id = pm.material_id
  left join public.work_order_materials wm
    on wm.work_order_id = w.id and wm.material_id = pm.material_id
      and wm.organization_id = v_org and wm.status <> 'cancelled'
  where pm.job_plan_id = v_plan;

  if coalesce(length(btrim((select scope from public.job_plans where id=v_plan))),0) < 20 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'code','scope','severity','blocker','label','Executable scope',
      'detail','The draft does not state a sufficiently specific work boundary.'));
  end if;
  if v_steps = 0 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'code','sequence','severity','blocker','label','Task sequence',
      'detail','No evidenced task sequence exists; the agent did not invent one.'));
  elsif v_labour_gaps > 0 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'code','labour','severity','blocker','label','Labour and estimates',
      'detail',v_labour_gaps||' step(s) lack craft, crew size or a positive duration.'));
  end if;
  if v_plan_materials = 0 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'code','materials','severity','attention','label','Material requirement',
      'detail','No material requirement is recorded. A human planner must confirm that none is needed or add catalogue-backed lines.'));
  elsif v_unready_materials > 0 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'code','materials','severity','blocker','label','Material readiness',
      'detail',v_unready_materials||' required material line(s) are not kitted or issued for this work order.'));
  end if;
  if v_tools = 0 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'code','tools','severity','attention','label','Tools and services',
      'detail','No tools or specialist services are recorded; absence is not treated as readiness.'));
  end if;
  if v_permits = 0 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'code','permits','severity','attention','label','Permits and isolations',
      'detail','No permit/isolation requirement or explicit not-required determination is recorded.'));
  end if;
  if v_documents = 0 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'code','documents','severity','attention','label','Controlled documents',
      'detail','No indexed tenant document is linked to the plan; current procedures/drawings remain unverified.'));
  end if;
  if v_checks = 0 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'code','acceptance','severity','blocker','label','Acceptance criteria',
      'detail','No measurable acceptance criterion exists. The canonical adoption RPC will refuse this draft.'));
  end if;

  v_result := jsonb_build_object(
    'run_id',v_run,'agent_id',ag.id,'agent_key',ag.key,
    'work_order_id',w.id,'job_plan_id',v_plan,'draft_created',v_created,
    'draft_origin',(select draft_origin from public.job_plans where id=v_plan),
    'reference_plan_id',v_reference,'gaps',v_gaps,'materials',v_materials,
    'human_approval_required',true,
    'required_human_approver_role',v_control->>'required_human_approver_role',
    'may_adopt',false,'may_apply',false,'may_release_schedule',false,
    'basis','Deterministic reading of canonical tenant work context. No missing task, material, document, permit, tool or acceptance criterion was invented.');

  update public.agent_runs
  set job_plan_id = v_plan,status = 'completed',completed_at = now(),
      summary = case when v_created
        then 'Created one non-authoritative canonical job-plan draft and identified '||jsonb_array_length(v_gaps)||' readiness gap(s).'
        else 'Assessed the existing canonical job plan without overwriting it and identified '||jsonb_array_length(v_gaps)||' readiness gap(s).' end,
      result = v_result
  where id = v_run;
  perform set_config('app.planner_agent_run_write','',true);

  update public.ai_agents
  set last_action_at = now(), status = 'active',
      current_task = 'Planning '||coalesce(w.wo_number,w.id::text),
      last_action = case when v_created
        then 'Created a governed draft and identified planning gaps'
        else 'Assessed an existing plan and identified planning gaps' end,
      recommendations_generated = coalesce(recommendations_generated,0) + 1
  where id = ag.id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'planning_agent_run',v_role,
    jsonb_build_object('action','planning_agent_draft','work_order_id',w.id,
      'agent_run_id',v_run,'job_plan_id',v_plan,'draft_created',v_created,
      'gap_count',jsonb_array_length(v_gaps),
      'control_profile_id',v_control->>'profile_id','requested_by',auth.uid(),
      'human_approval_required',true));

  return v_result;
end
$$;

revoke all on function public.run_planning_agent(uuid) from public, anon;
grant execute on function public.run_planning_agent(uuid) to authenticated;

comment on function public.run_planning_agent(uuid) is
  'C1.04/C1.05/C5.02/C5.03: governed Planning & Scheduling agent act. It reads one same-tenant work order, creates at most one canonical non-authoritative draft from exact recorded/reference content, identifies material/document/readiness gaps, retains provenance, and cannot adopt, apply, release, spend or return equipment to service.';

notify pgrst, 'reload schema';
