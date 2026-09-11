-- C1.14-C1.16 — per-agent authority, software-tool and proposal-limit controls.
--
-- Canonical reuse:
--   * ai_agents is the identity being governed;
--   * decision_rights remains the platform policy for auto/approval/never;
--   * recommendations remains the one consequential-output store;
--   * authority_limits remains HUMAN delegation authority and is not copied.
--
-- An agent profile limits what an agent may READ/ANALYSE/DRAFT/PROPOSE. It can
-- never approve, accept risk, commit spend, release work, or return equipment
-- to service. Approval-tier decision rights may only produce a pending proposal
-- routed to the profile's named human role. Never-tier rights always refuse.

create table if not exists agent_software_tools (
  id uuid primary key default gen_random_uuid(),
  tool_key text not null unique check (tool_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  title text not null,
  purpose text not null,
  access_kind text not null check (access_kind in ('read','analyse','draft','propose')),
  created_at timestamptz not null default now()
);

alter table agent_software_tools enable row level security;
drop policy if exists agent_software_tools_read on agent_software_tools;
create policy agent_software_tools_read on agent_software_tools
  for select to authenticated using (true);
revoke insert, update, delete, truncate on table agent_software_tools
  from public, anon, authenticated;

insert into agent_software_tools (tool_key,title,purpose,access_kind) values
  ('read_sensor_state','Read sensor state','Read tenant-scoped sensor observations; no control-system write.','read'),
  ('read_work_context','Read work context','Read tenant-scoped work, material and capacity context.','read'),
  ('analyse_reliability','Analyse reliability','Compute evidence-grounded reliability indicators without changing source records.','analyse'),
  ('draft_recommendation','Draft recommendation','Create a pending recommendation for accountable human review.','draft'),
  ('draft_job_plan','Draft job plan','Create a draft job plan that carries no release authority.','draft'),
  ('propose_schedule','Propose schedule','Create a schedule option; releasing it remains a human act.','propose')
on conflict (tool_key) do update set
  title=excluded.title,purpose=excluded.purpose,access_kind=excluded.access_kind;

create table if not exists agent_control_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid not null references ai_agents(id) on delete cascade,
  authority_mode text not null default 'advisory_only'
    check (authority_mode in ('advisory_only','propose_with_approval')),
  required_human_approver_role text not null,
  proposal_risk_ceiling text not null default 'Low'
    check (proposal_risk_ceiling in ('Low','Medium','High','Critical')),
  proposal_cost_ceiling_usd numeric not null default 0
    check (proposal_cost_ceiling_usd >= 0 and proposal_cost_ceiling_usd <> 'NaN'::numeric
      and proposal_cost_ceiling_usd <> 'Infinity'::numeric),
  proposal_downtime_ceiling_hours numeric not null default 0
    check (proposal_downtime_ceiling_hours >= 0 and proposal_downtime_ceiling_hours <> 'NaN'::numeric
      and proposal_downtime_ceiling_hours <> 'Infinity'::numeric),
  may_approve boolean not null default false check (not may_approve),
  basis text not null check (length(btrim(basis)) >= 20),
  status text not null default 'draft' check (status in ('draft','adopted','superseded')),
  version integer not null default 1 check (version > 0),
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status='draft' and adopted_at is null)
    or (status in ('adopted','superseded') and adopted_at is not null))
);
create unique index if not exists agent_control_profiles_one_adopted
  on agent_control_profiles(agent_id) where status='adopted';
create index if not exists agent_control_profiles_org_agent
  on agent_control_profiles(organization_id,agent_id,status);

create table if not exists agent_decision_right_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references agent_control_profiles(id) on delete cascade,
  agent_id uuid not null references ai_agents(id) on delete cascade,
  decision_right_id uuid not null references decision_rights(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(profile_id,decision_right_id)
);

create table if not exists agent_tool_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references agent_control_profiles(id) on delete cascade,
  agent_id uuid not null references ai_agents(id) on delete cascade,
  tool_id uuid not null references agent_software_tools(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(profile_id,tool_id)
);

alter table agent_control_profiles enable row level security;
alter table agent_decision_right_bindings enable row level security;
alter table agent_tool_bindings enable row level security;
drop policy if exists agent_control_profiles_read on agent_control_profiles;
create policy agent_control_profiles_read on agent_control_profiles
  for select to authenticated using (agent_control_profiles.organization_id = app_current_org());
drop policy if exists agent_decision_right_bindings_read on agent_decision_right_bindings;
create policy agent_decision_right_bindings_read on agent_decision_right_bindings
  for select to authenticated using (agent_decision_right_bindings.organization_id = app_current_org());
drop policy if exists agent_tool_bindings_read on agent_tool_bindings;
create policy agent_tool_bindings_read on agent_tool_bindings
  for select to authenticated using (agent_tool_bindings.organization_id = app_current_org());
revoke insert, update, delete, truncate on table agent_control_profiles,
  agent_decision_right_bindings, agent_tool_bindings from public, anon, authenticated;

create or replace function public.enforce_agent_control_tenancy()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_agent_org uuid; v_profile_org uuid; v_profile_agent uuid;
begin
  select organization_id into v_agent_org from ai_agents where id=new.agent_id;
  if v_agent_org is null or v_agent_org <> new.organization_id then
    raise exception 'agent not found in this organization' using errcode='23514';
  end if;
  if tg_table_name <> 'agent_control_profiles' then
    select organization_id,agent_id into v_profile_org,v_profile_agent
      from agent_control_profiles where id=new.profile_id;
    if v_profile_org is null or v_profile_org <> new.organization_id or v_profile_agent <> new.agent_id then
      raise exception 'agent control binding crosses organization or agent boundary' using errcode='23514';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.enforce_agent_control_tenancy() from public,anon,authenticated;
drop trigger if exists trg_agent_control_profile_tenancy on agent_control_profiles;
create trigger trg_agent_control_profile_tenancy before insert or update on agent_control_profiles
  for each row execute function public.enforce_agent_control_tenancy();
drop trigger if exists trg_agent_decision_binding_tenancy on agent_decision_right_bindings;
create trigger trg_agent_decision_binding_tenancy before insert or update on agent_decision_right_bindings
  for each row execute function public.enforce_agent_control_tenancy();
drop trigger if exists trg_agent_tool_binding_tenancy on agent_tool_bindings;
create trigger trg_agent_tool_binding_tenancy before insert or update on agent_tool_bindings
  for each row execute function public.enforce_agent_control_tenancy();

create or replace function public.enforce_agent_binding_history()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
  if tg_op='UPDATE' then
    raise exception 'agent control bindings are immutable; adopt a new profile version';
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
drop trigger if exists trg_agent_decision_binding_history on agent_decision_right_bindings;
create trigger trg_agent_decision_binding_history before insert or update or delete on agent_decision_right_bindings
  for each row execute function public.enforce_agent_binding_history();
drop trigger if exists trg_agent_tool_binding_history on agent_tool_bindings;
create trigger trg_agent_tool_binding_history before insert or update or delete on agent_tool_bindings
  for each row execute function public.enforce_agent_binding_history();

create or replace function public.enforce_agent_control_history()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_adopter_role text;
begin
  if tg_op='DELETE' then
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
drop trigger if exists trg_agent_control_history on agent_control_profiles;
create trigger trg_agent_control_history before insert or update or delete on agent_control_profiles
  for each row execute function public.enforce_agent_control_history();

-- Existing agents receive a conservative platform baseline so current advisory
-- producers keep operating. This is not a customer delegation: it authorizes
-- pending drafts only, grants no approval, and routes every consequence to a
-- named human role. Newly created agents fail closed until configured.
insert into agent_control_profiles
  (organization_id,agent_id,authority_mode,required_human_approver_role,
   proposal_risk_ceiling,proposal_cost_ceiling_usd,proposal_downtime_ceiling_hours,
   may_approve,basis,status,version,adopted_at)
select a.organization_id,a.id,'advisory_only','reliability_engineer',
  'Critical',0,0,false,
  'Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.',
  'draft',1,null
from ai_agents a
where not exists (select 1 from agent_control_profiles p where p.agent_id=a.id and p.status='adopted');

insert into agent_decision_right_bindings(organization_id,profile_id,agent_id,decision_right_id)
select p.organization_id,p.id,p.agent_id,d.id
from agent_control_profiles p join decision_rights d on d.right_key = case
  when (select key from ai_agents where id=p.agent_id)='planning_scheduling' then 'produce_schedule_options'
  when (select key from ai_agents where id=p.agent_id)='inventory_management' then 'identify_missing_materials_docs'
  else 'recommend_inspection_review' end
where p.status='draft'
  and p.basis='Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.'
on conflict do nothing;

insert into agent_tool_bindings(organization_id,profile_id,agent_id,tool_id)
select p.organization_id,p.id,p.agent_id,t.id
from agent_control_profiles p cross join agent_software_tools t
where p.status='draft'
  and p.basis='Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.'
  and t.tool_key='draft_recommendation' on conflict do nothing;

insert into agent_tool_bindings(organization_id,profile_id,agent_id,tool_id)
select p.organization_id,p.id,p.agent_id,t.id
from agent_control_profiles p join ai_agents a on a.id=p.agent_id
cross join agent_software_tools t
where p.status='draft'
  and p.basis='Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.'
  and t.tool_key=case
  when a.key='condition_monitoring' then 'read_sensor_state'
  when a.key in ('planning_scheduling','inventory_management','workforce_capacity') then 'read_work_context'
  else 'analyse_reliability' end
on conflict do nothing;

update agent_control_profiles set status='adopted',adopted_at=now()
where status='draft'
  and adopted_by is null
  and basis='Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.';

create or replace function public.configure_agent_controls(
  p_agent_id uuid,
  p_required_human_approver_role text,
  p_proposal_risk_ceiling text,
  p_proposal_cost_ceiling_usd numeric,
  p_proposal_downtime_ceiling_hours numeric,
  p_decision_right_keys text[],
  p_tool_keys text[],
  p_basis text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; v_profile uuid; v_version int;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error','ai/system identities cannot adopt agent authority controls');
  end if;
  if v_role not in ('admin','executive') then
    return jsonb_build_object('error','an accountable human administrator or executive must adopt agent controls');
  end if;
  if not exists(select 1 from ai_agents where id=p_agent_id and organization_id=v_org) then
    return jsonb_build_object('error','agent not found in this organization');
  end if;
  if coalesce(length(btrim(p_required_human_approver_role)),0)<2 then
    return jsonb_build_object('error','name the accountable human approver role');
  end if;
  if p_proposal_risk_ceiling not in ('Low','Medium','High','Critical') then
    return jsonb_build_object('error','invalid risk ceiling');
  end if;
  if p_proposal_cost_ceiling_usd is null
     or p_proposal_cost_ceiling_usd in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
     or p_proposal_cost_ceiling_usd < 0
     or p_proposal_downtime_ceiling_hours is null
     or p_proposal_downtime_ceiling_hours in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
     or p_proposal_downtime_ceiling_hours < 0 then
    return jsonb_build_object('error','proposal ceilings must be finite non-negative values');
  end if;
  if coalesce(length(btrim(p_basis)),0)<20 then
    return jsonb_build_object('error','record at least 20 characters of control basis');
  end if;
  if coalesce(cardinality(p_decision_right_keys),0)=0 or cardinality(p_decision_right_keys)>50
     or coalesce(cardinality(p_tool_keys),0)=0 or cardinality(p_tool_keys)>50 then
    return jsonb_build_object('error','select between 1 and 50 decision rights and tools');
  end if;
  if exists(select 1 from unnest(p_decision_right_keys) k
      left join decision_rights d on d.right_key=k where d.id is null) then
    return jsonb_build_object('error','unknown decision right — denied (fail-closed)');
  end if;
  if exists(select 1 from decision_rights d where d.right_key=any(p_decision_right_keys) and d.tier='never') then
    return jsonb_build_object('error','a never-autonomous decision right cannot be assigned to an agent');
  end if;
  if exists(select 1 from unnest(p_tool_keys) k
      left join agent_software_tools t on t.tool_key=k where t.id is null) then
    return jsonb_build_object('error','unknown software tool — denied (fail-closed)');
  end if;

  select coalesce(max(version),0)+1 into v_version from agent_control_profiles where agent_id=p_agent_id;
  update agent_control_profiles set status='superseded'
    where agent_id=p_agent_id and organization_id=v_org and status='adopted';
  insert into agent_control_profiles(organization_id,agent_id,authority_mode,
    required_human_approver_role,proposal_risk_ceiling,proposal_cost_ceiling_usd,
    proposal_downtime_ceiling_hours,may_approve,basis,status,version,adopted_by,adopted_at)
  values(v_org,p_agent_id,'propose_with_approval',btrim(p_required_human_approver_role),
    p_proposal_risk_ceiling,p_proposal_cost_ceiling_usd,p_proposal_downtime_ceiling_hours,
    false,btrim(p_basis),'draft',v_version,auth.uid(),null) returning id into v_profile;
  insert into agent_decision_right_bindings(organization_id,profile_id,agent_id,decision_right_id)
    select v_org,v_profile,p_agent_id,id from decision_rights where right_key=any(p_decision_right_keys);
  insert into agent_tool_bindings(organization_id,profile_id,agent_id,tool_id)
    select v_org,v_profile,p_agent_id,id from agent_software_tools where tool_key=any(p_tool_keys);
  update agent_control_profiles set status='adopted',adopted_at=now() where id=v_profile;
  insert into security_events(organization_id,actor_id,actor_label,event_type,severity,detail)
    values(v_org,auth.uid(),v_role,'admin_action','warning',
      'Agent control profile adopted for agent '||p_agent_id||' at version '||v_version||
      '. This limits proposals and tools; accountable human approval remains mandatory.');
  return jsonb_build_object('profile_id',v_profile,'version',v_version,'may_approve',false,
    'required_human_approver_role',btrim(p_required_human_approver_role));
end; $$;
revoke all on function public.configure_agent_controls(uuid,text,text,numeric,numeric,text[],text[],text)
  from public,anon;
grant execute on function public.configure_agent_controls(uuid,text,text,numeric,numeric,text[],text[],text)
  to authenticated;

create or replace function public.evaluate_agent_control_internal(
  p_org uuid,p_agent_id uuid,p_decision_right_key text,p_tool_key text,
  p_risk_level text,p_estimated_cost_usd numeric,p_downtime_hours numeric
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p agent_control_profiles%rowtype; d decision_rights%rowtype; v_rank int;
begin
  if not exists(select 1 from ai_agents where id=p_agent_id and organization_id=p_org) then
    return jsonb_build_object('allowed',false,'reason','agent not found in this organization');
  end if;
  select * into p from agent_control_profiles where agent_id=p_agent_id and organization_id=p_org
    and status='adopted' order by version desc limit 1;
  if not found then return jsonb_build_object('allowed',false,'reason','no adopted control profile'); end if;
  if not exists(select 1 from agent_tool_bindings b join agent_software_tools t on t.id=b.tool_id
      where b.profile_id=p.id and b.agent_id=p_agent_id and b.organization_id=p_org and t.tool_key=p_tool_key) then
    return jsonb_build_object('allowed',false,'reason','tool is not enabled for this agent');
  end if;
  select d0.* into d from decision_rights d0 join agent_decision_right_bindings b
    on b.decision_right_id=d0.id where b.profile_id=p.id and b.agent_id=p_agent_id
    and b.organization_id=p_org and d0.right_key=p_decision_right_key;
  if not found then return jsonb_build_object('allowed',false,'reason','decision right is not enabled for this agent'); end if;
  -- Reuse the canonical decision-right evaluator; never remains never.
  if (public.check_decision_right(p_decision_right_key)->>'tier')='never' then
    return jsonb_build_object('allowed',false,'reason','decision right is never autonomous');
  end if;
  if p_risk_level is not null then
    v_rank:=case p_risk_level when 'Low' then 1 when 'Medium' then 2 when 'High' then 3 when 'Critical' then 4 else 99 end;
    if v_rank > (case p.proposal_risk_ceiling when 'Low' then 1 when 'Medium' then 2 when 'High' then 3 else 4 end) then
      return jsonb_build_object('allowed',false,'reason','proposal exceeds this agent''s risk ceiling'); end if;
  end if;
  if p_estimated_cost_usd is not null then
    if p_estimated_cost_usd in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
       or p_estimated_cost_usd < 0 then
      return jsonb_build_object('allowed',false,'reason','proposal cost must be a finite non-negative value');
    end if;
    if p_estimated_cost_usd>p.proposal_cost_ceiling_usd then
      return jsonb_build_object('allowed',false,'reason','proposal exceeds this agent''s cost ceiling');
    end if;
  end if;
  if p_downtime_hours is not null then
    if p_downtime_hours in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
       or p_downtime_hours < 0 then
      return jsonb_build_object('allowed',false,'reason','proposal downtime must be a finite non-negative value');
    end if;
    if p_downtime_hours>p.proposal_downtime_ceiling_hours then
      return jsonb_build_object('allowed',false,'reason','proposal exceeds this agent''s downtime ceiling');
    end if;
  end if;
  return jsonb_build_object('allowed',true,'profile_id',p.id,'authority_mode',p.authority_mode,
    'decision_tier',d.tier,'human_approval_required',true,
    'required_human_approver_role',p.required_human_approver_role,
    'reason','proposal admitted; accountable human approval remains mandatory');
end; $$;
revoke all on function public.evaluate_agent_control_internal(uuid,uuid,text,text,text,numeric,numeric)
  from public,anon,authenticated;

create or replace function public.evaluate_agent_control(
  p_agent_id uuid,p_decision_right_key text,p_tool_key text,
  p_risk_level text default null,p_estimated_cost_usd numeric default null,
  p_downtime_hours numeric default null
) returns jsonb language sql stable security definer set search_path=public as $$
  select public.evaluate_agent_control_internal(app_current_org(),p_agent_id,p_decision_right_key,
    p_tool_key,p_risk_level,p_estimated_cost_usd,p_downtime_hours)
$$;
revoke all on function public.evaluate_agent_control(uuid,text,text,text,numeric,numeric) from public,anon;
grant execute on function public.evaluate_agent_control(uuid,text,text,text,numeric,numeric) to authenticated;

-- Every agent-authored recommendation is stamped with the exact per-agent
-- profile, tool and decision right admitted at insertion. Producers that do
-- not yet provide explicit keys receive a conservative mapping; unknown/new
-- agents have no adopted profile and therefore fail closed.
alter table recommendations
  add column if not exists agent_control_profile_id uuid references agent_control_profiles(id) on delete restrict,
  add column if not exists agent_tool_key text,
  add column if not exists agent_decision_right_key text;

create or replace function public.enforce_agent_recommendation_control()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_agent_key text; v_result jsonb;
begin
  if new.agent_id is null then return new; end if;
  select key into v_agent_key from ai_agents where id=new.agent_id and organization_id=new.organization_id;
  if v_agent_key is null then raise exception 'agent not found in this organization'; end if;
  new.agent_tool_key:=coalesce(new.agent_tool_key,'draft_recommendation');
  new.agent_decision_right_key:=coalesce(new.agent_decision_right_key,case
    when v_agent_key='planning_scheduling' then 'produce_schedule_options'
    when v_agent_key='inventory_management' then 'identify_missing_materials_docs'
    else 'recommend_inspection_review' end);
  v_result:=public.evaluate_agent_control_internal(new.organization_id,new.agent_id,
    new.agent_decision_right_key,new.agent_tool_key,new.risk_impact,new.estimated_cost_usd,null);
  if not coalesce((v_result->>'allowed')::boolean,false) then
    raise exception 'agent recommendation refused: %',v_result->>'reason' using errcode='42501';
  end if;
  new.agent_control_profile_id:=(v_result->>'profile_id')::uuid;
  -- This trigger never changes status: recommendations remain pending and the
  -- canonical approval workflow remains the only path forward.
  if new.status <> 'pending' then raise exception 'agent recommendations must enter as pending'; end if;
  return new;
end; $$;
revoke all on function public.enforce_agent_recommendation_control() from public,anon,authenticated;
drop trigger if exists trg_agent_recommendation_control on recommendations;
create trigger trg_agent_recommendation_control before insert on recommendations
  for each row execute function public.enforce_agent_recommendation_control();

comment on table agent_control_profiles is
  'C1.14/C1.16: versioned per-agent proposal envelope. It never grants approval; authority_limits remains the human delegation instrument.';
comment on table agent_tool_bindings is
  'C1.15: the explicit software-tool set for one agent profile; no shared implicit tool envelope.';
