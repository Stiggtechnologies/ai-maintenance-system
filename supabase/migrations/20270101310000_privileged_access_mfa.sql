-- ============================================================================
-- E5.05 — tenant-enforced MFA and privileged-access management.
--
-- Canonical reuse:
--   * user_profiles remains the identity-to-tenant and role authority;
--   * auth.mfa_factors remains the factor system of record;
--   * app_current_org() remains the single RLS / governed-RPC tenant resolver;
--   * security_events and audit_events retain the security and governance trail.
--
-- A tenant policy is proposed by one named human and adopted by another. Once
-- effective, an in-scope session receives an organization only when both a
-- verified factor exists and the JWT is AAL2. The pre-workspace posture RPC is
-- intentionally independent of app_current_org(): an unenrolled user must be
-- able to discover why access is blocked and complete enrollment without being
-- granted access to tenant data.
-- ============================================================================

create table if not exists public.organization_mfa_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check (version > 0),
  enforcement_scope text not null
    check (enforcement_scope in ('privileged_roles','all_members')),
  privileged_roles text[] not null default
    array['admin','ai_admin','executive','maintenance_manager']::text[],
  effective_at timestamptz not null,
  status text not null default 'proposed'
    check (status in ('proposed','adopted','rejected','superseded')),
  proposed_by uuid not null references public.user_profiles(id),
  proposed_at timestamptz not null default now(),
  proposal_reason text not null check (length(btrim(proposal_reason)) >= 20),
  decided_by uuid references public.user_profiles(id),
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  constraint organization_mfa_policy_roles_required check (
    enforcement_scope <> 'privileged_roles' or cardinality(privileged_roles) > 0
  ),
  constraint organization_mfa_policy_decision_complete check (
    (status = 'proposed' and decided_by is null and decided_at is null and decision_reason is null)
    or
    (status <> 'proposed' and decided_by is not null and decided_at is not null
      and length(btrim(decision_reason)) >= 20)
  ),
  constraint organization_mfa_policy_segregation check (
    decided_by is null or decided_by <> proposed_by
  ),
  unique (organization_id, version)
);

create unique index if not exists organization_mfa_policy_one_proposed
  on public.organization_mfa_policies(organization_id)
  where status = 'proposed';
create unique index if not exists organization_mfa_policy_one_adopted
  on public.organization_mfa_policies(organization_id)
  where status = 'adopted';
create index if not exists organization_mfa_policy_effective
  on public.organization_mfa_policies(organization_id, effective_at desc)
  where status = 'adopted';

alter table public.organization_mfa_policies enable row level security;

-- No client table policy is intentional. All reads and writes use the bounded
-- RPCs below so an AAL1 session cannot enumerate a tenant's security posture.
revoke all on table public.organization_mfa_policies
  from public, anon, authenticated, service_role;

create or replace function public.guard_organization_mfa_policy_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'MFA policy records are retained and cannot be deleted';
  end if;
  if coalesce(current_setting('app.organization_mfa_policy_writer', true),'') <> 'governed' then
    raise exception 'MFA policy changes require the governed named-human workflow';
  end if;
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.version is distinct from old.version
       or new.enforcement_scope is distinct from old.enforcement_scope
       or new.privileged_roles is distinct from old.privileged_roles
       or new.effective_at is distinct from old.effective_at
       or new.proposed_by is distinct from old.proposed_by
       or new.proposed_at is distinct from old.proposed_at
       or new.proposal_reason is distinct from old.proposal_reason
       or new.created_at is distinct from old.created_at then
      raise exception 'A proposed MFA policy is immutable; propose a new version';
    end if;
    if old.status <> 'proposed' and not (old.status='adopted' and new.status='superseded') then
      raise exception 'A decided MFA policy is immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_organization_mfa_policy_write
  on public.organization_mfa_policies;
create trigger trg_guard_organization_mfa_policy_write
  before insert or update or delete on public.organization_mfa_policies
  for each row execute function public.guard_organization_mfa_policy_write();

revoke all on function public.guard_organization_mfa_policy_write()
  from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Assurance helpers. These are intentionally narrow and return booleans only.
-- ---------------------------------------------------------------------------
create or replace function public.app_actor_has_verified_mfa(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select p_user_id is not null and exists (
    select 1 from auth.mfa_factors f
    where f.user_id = p_user_id and f.status = 'verified'
  )
$$;

create or replace function public.app_current_aal()
returns text
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(nullif(auth.jwt()->>'aal',''),'aal1')
$$;

create or replace function public.app_actor_mfa_required(
  p_user_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select p.enforcement_scope = 'all_members'
      or coalesce(u.role,'') = any(p.privileged_roles)
    from public.organization_mfa_policies p
    join public.user_profiles u
      on u.id = p_user_id and u.organization_id = p.organization_id
    where p.organization_id = p_organization_id
      and p.status = 'adopted'
      and p.effective_at <= now()
    order by p.version desc
    limit 1
  ), false)
$$;

create or replace function public.app_actor_mfa_satisfied(
  p_user_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select not public.app_actor_mfa_required(p_user_id,p_organization_id)
    or (
      public.app_actor_has_verified_mfa(p_user_id)
      and public.app_current_aal() = 'aal2'
    )
$$;

revoke all on function public.app_actor_has_verified_mfa(uuid) from public,anon,authenticated;
revoke all on function public.app_current_aal() from public,anon,authenticated;
revoke all on function public.app_actor_mfa_required(uuid,uuid) from public,anon,authenticated;
revoke all on function public.app_actor_mfa_satisfied(uuid,uuid) from public,anon,authenticated;

-- Preserve the commercial-entitlement boundary from 20261228100000 and add
-- assurance to THE canonical organization resolver. Every RLS policy and every
-- governed function that resolves through app_current_org now fails closed.
create or replace function public.app_current_org()
returns uuid
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select p.organization_id
  from public.user_profiles p
  where p.id = auth.uid()
    and public.app_org_has_commercial_entitlement(p.organization_id)
    and public.app_actor_mfa_satisfied(p.id,p.organization_id)
$$;

-- ---------------------------------------------------------------------------
-- Pre-workspace posture: authenticated identity only, no tenant data payload.
-- ---------------------------------------------------------------------------
create or replace function public.get_current_security_posture()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_policy public.organization_mfa_policies%rowtype;
  v_required boolean := false;
  v_factor_count integer := 0;
  v_aal text := public.app_current_aal();
begin
  if v_uid is null then
    return jsonb_build_object('authenticated',false,'satisfied',false,'reason','authentication_required');
  end if;

  select organization_id into v_org
  from public.user_profiles where id=v_uid;
  if v_org is null then
    return jsonb_build_object('authenticated',true,'workspaceMember',false,
      'required',false,'satisfied',false,'reason','workspace_membership_required');
  end if;

  select * into v_policy
  from public.organization_mfa_policies
  where organization_id=v_org and status='adopted'
  order by version desc limit 1;

  select count(*)::integer into v_factor_count
  from auth.mfa_factors where user_id=v_uid and status='verified';

  v_required := public.app_actor_mfa_required(v_uid,v_org);
  return jsonb_build_object(
    'authenticated',true,
    'workspaceMember',true,
    'required',v_required,
    'verifiedFactorCount',v_factor_count,
    'currentAal',v_aal,
    'satisfied',not v_required or (v_factor_count > 0 and v_aal='aal2'),
    'reason',case
      when v_policy.id is null then 'no_adopted_policy'
      when v_policy.effective_at > now() then 'policy_not_effective'
      when not v_required then 'role_not_in_scope'
      when v_factor_count = 0 then 'factor_enrollment_required'
      when v_aal <> 'aal2' then 'step_up_required'
      else 'satisfied' end,
    'boundary','MFA establishes workspace assurance only; it grants no engineering or operational authority.'
  );
end;
$$;

revoke all on function public.get_current_security_posture() from public,anon;
grant execute on function public.get_current_security_posture() to authenticated;

-- ---------------------------------------------------------------------------
-- Governed policy lifecycle.
-- ---------------------------------------------------------------------------
create or replace function public.get_organization_mfa_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in ('admin','executive') then
    return jsonb_build_object('error','An assured administrator or executive is required');
  end if;
  return jsonb_build_object(
    'adopted',(
      select jsonb_build_object(
        'id',p.id,'version',p.version,'scope',p.enforcement_scope,
        'privilegedRoles',p.privileged_roles,'effectiveAt',p.effective_at,
        'status',p.status,'proposedBy',p.proposed_by,'proposedAt',p.proposed_at,
        'proposedByLabel',(select coalesce(u.full_name,u.email) from public.user_profiles u where u.id=p.proposed_by),
        'proposalReason',p.proposal_reason,'decidedBy',p.decided_by,
        'decidedByLabel',(select coalesce(u.full_name,u.email) from public.user_profiles u where u.id=p.decided_by),
        'decidedAt',p.decided_at,'decisionReason',p.decision_reason)
      from public.organization_mfa_policies p
      where p.organization_id=v_org and p.status='adopted'
      order by p.version desc limit 1),
    'proposed',(
      select jsonb_build_object(
        'id',p.id,'version',p.version,'scope',p.enforcement_scope,
        'privilegedRoles',p.privileged_roles,'effectiveAt',p.effective_at,
        'status',p.status,'proposedBy',p.proposed_by,'proposedAt',p.proposed_at,
        'proposedByLabel',(select coalesce(u.full_name,u.email) from public.user_profiles u where u.id=p.proposed_by),
        'proposalReason',p.proposal_reason)
      from public.organization_mfa_policies p
      where p.organization_id=v_org and p.status='proposed'
      order by p.version desc limit 1),
    'boundary','One named human proposes; a different AAL2 human adopts. Policy does not confer role or operational authority.'
  );
end;
$$;

create or replace function public.propose_organization_mfa_policy(
  p_enforcement_scope text,
  p_privileged_roles text[],
  p_effective_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_role text;
  v_version integer;
  v_id uuid;
  v_roles text[];
  v_allowed constant text[] := array[
    'admin','ai_admin','executive','maintenance_manager','reliability_engineer',
    'planner','supervisor','technician','operator','viewer','assessment_sponsor'
  ];
begin
  select role into v_role from public.user_profiles
  where id=v_uid and organization_id=v_org;
  if v_org is null or v_uid is null or coalesce(v_role,'') not in ('admin','executive') then
    return jsonb_build_object('error','An assured named administrator or executive is required');
  end if;
  if p_enforcement_scope not in ('privileged_roles','all_members') then
    return jsonb_build_object('error','Enforcement scope must be privileged_roles or all_members');
  end if;
  if length(btrim(coalesce(p_reason,''))) < 20 then
    return jsonb_build_object('error','State a policy basis of at least 20 characters');
  end if;
  if p_effective_at is null or p_effective_at < now() - interval '5 minutes'
     or p_effective_at > now() + interval '30 days' then
    return jsonb_build_object('error','Effective time must be immediate or within 30 days from now');
  end if;
  select coalesce(array_agg(distinct r order by r),'{}'::text[]) into v_roles
  from unnest(coalesce(p_privileged_roles,'{}'::text[])) r
  where r = any(v_allowed);
  if p_enforcement_scope='privileged_roles' and cardinality(v_roles)=0 then
    return jsonb_build_object('error','Select at least one recognized privileged role');
  end if;
  if exists(select 1 from public.organization_mfa_policies
            where organization_id=v_org and status='proposed') then
    return jsonb_build_object('error','Decide the current proposal before creating another');
  end if;

  select coalesce(max(version),0)+1 into v_version
  from public.organization_mfa_policies where organization_id=v_org;
  perform set_config('app.organization_mfa_policy_writer','governed',true);
  insert into public.organization_mfa_policies(
    organization_id,version,enforcement_scope,privileged_roles,effective_at,
    proposed_by,proposal_reason
  ) values (
    v_org,v_version,p_enforcement_scope,
    case when p_enforcement_scope='all_members' then '{}'::text[] else v_roles end,
    p_effective_at,v_uid,btrim(p_reason)
  ) returning id into v_id;
  perform set_config('app.organization_mfa_policy_writer','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'organization_mfa_policy',v_role,jsonb_build_object(
    'event','mfa_policy_proposed','policy_id',v_id,'version',v_version,
    'enforcement_scope',p_enforcement_scope,'privileged_roles',v_roles,
    'effective_at',p_effective_at,'proposed_by',v_uid,
    'operational_authority',false));
  insert into public.security_events(
    organization_id,actor_id,actor_label,event_type,severity,detail)
  values(v_org,v_uid,(select coalesce(full_name,email) from public.user_profiles where id=v_uid),
    'admin_action','notice','Proposed organization MFA policy version '||v_version);

  return jsonb_build_object('policyId',v_id,'version',v_version,'status','proposed',
    'independentReviewRequired',true,'operationalAuthority',false);
exception when others then
  perform set_config('app.organization_mfa_policy_writer','',true);
  raise;
end;
$$;

create or replace function public.decide_organization_mfa_policy(
  p_policy_id uuid,
  p_decision text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_role text;
  v_policy public.organization_mfa_policies%rowtype;
  v_status text;
begin
  select role into v_role from public.user_profiles
  where id=v_uid and organization_id=v_org;
  if v_org is null or v_uid is null or coalesce(v_role,'') not in ('admin','executive') then
    return jsonb_build_object('error','An assured named administrator or executive is required');
  end if;
  if p_decision not in ('adopt','reject') then
    return jsonb_build_object('error','Decision must be adopt or reject');
  end if;
  if length(btrim(coalesce(p_reason,''))) < 20 then
    return jsonb_build_object('error','State an independent decision basis of at least 20 characters');
  end if;
  select * into v_policy from public.organization_mfa_policies
  where id=p_policy_id and organization_id=v_org and status='proposed'
  for update;
  if not found then
    return jsonb_build_object('error','Proposed MFA policy not found in this tenant');
  end if;
  if v_policy.proposed_by=v_uid then
    return jsonb_build_object('error','The proposer cannot independently adopt or reject the same policy');
  end if;
  if not public.app_actor_has_verified_mfa(v_uid) or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error','Policy disposition requires a verified factor and an AAL2 session');
  end if;

  v_status := case when p_decision='adopt' then 'adopted' else 'rejected' end;
  perform set_config('app.organization_mfa_policy_writer','governed',true);
  if p_decision='adopt' then
    update public.organization_mfa_policies
      set status='superseded'
    where organization_id=v_org and status='adopted';
  end if;
  update public.organization_mfa_policies
    set status=v_status,decided_by=v_uid,decided_at=now(),decision_reason=btrim(p_reason)
  where id=v_policy.id;
  perform set_config('app.organization_mfa_policy_writer','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'organization_mfa_policy',v_role,jsonb_build_object(
    'event','mfa_policy_'||v_status,'policy_id',v_policy.id,
    'version',v_policy.version,'decision',p_decision,'decided_by',v_uid,
    'proposed_by',v_policy.proposed_by,'segregation_of_duties',true,
    'aal','aal2','verified_factor',true,'operational_authority',false));
  insert into public.security_events(
    organization_id,actor_id,actor_label,event_type,severity,detail)
  values(v_org,v_uid,(select coalesce(full_name,email) from public.user_profiles where id=v_uid),
    'admin_action','warning','MFA policy version '||v_policy.version||' '||v_status);

  return jsonb_build_object('policyId',v_policy.id,'version',v_policy.version,
    'status',v_status,'effectiveAt',v_policy.effective_at,
    'segregationOfDuties',true,'operationalAuthority',false);
exception when others then
  perform set_config('app.organization_mfa_policy_writer','',true);
  raise;
end;
$$;

revoke all on function public.get_organization_mfa_policy() from public,anon;
revoke all on function public.propose_organization_mfa_policy(text,text[],timestamptz,text)
  from public,anon;
revoke all on function public.decide_organization_mfa_policy(uuid,text,text)
  from public,anon;
grant execute on function public.get_organization_mfa_policy() to authenticated;
grant execute on function public.propose_organization_mfa_policy(text,text[],timestamptz,text)
  to authenticated;
grant execute on function public.decide_organization_mfa_policy(uuid,text,text)
  to authenticated;

comment on table public.organization_mfa_policies is
  'Versioned tenant assurance policy. One named human proposes and a different AAL2 human adopts; records are retained and do not grant business authority.';
comment on function public.get_current_security_posture() is
  'Pre-workspace identity posture only. Returns no tenant records and permits an in-scope AAL1 user to discover enrollment or step-up requirements.';
comment on function public.app_current_org() is
  'Canonical tenant resolver: commercial entitlement plus any effective tenant MFA policy. In-scope sessions require a verified factor and AAL2.';

notify pgrst, 'reload schema';
