-- ============================================================================
-- C9.06 — enterprise federation: standard methods, site-specific strategies.
--
-- Canonical reuse is deliberate:
--   * governance_standards is the ONE enterprise-standard authority;
--   * standard_site_variances is the ONE exception/waiver authority;
--   * sites is the ONE site identity;
--   * job_plans is the ONE executable maintenance-procedure family;
--   * audit_events records every governed authoring/adoption act.
--
-- A site inherits an adopted enterprise method until a named human adopts a
-- site strategy. A conforming strategy may tailor implementation without
-- weakening the method. A non-conforming strategy cannot be adopted unless an
-- approved, unexpired variance covers that exact standard and site. Nothing in
-- this slice approves work, changes an operating limit, or releases execution.
-- ============================================================================

alter table public.governance_standards
  add column if not exists standard_kind text not null default 'governance_rule'
    check (standard_kind in ('governance_rule','reliability_method')),
  add column if not exists applicability text,
  add column if not exists adoption_note text;

create table if not exists public.site_standard_strategies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  standard_id uuid not null references public.governance_standards(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete cascade,
  strategy_key text not null,
  title text not null,
  local_context text not null,
  implementation_method text not null,
  job_plan_id uuid references public.job_plans(id) on delete restrict,
  conformance text not null check (conformance in ('aligned','variance')),
  variance_id uuid references public.standard_site_variances(id) on delete restrict,
  evidence_basis text not null,
  status text not null default 'draft'
    check (status in ('draft','adopted','superseded')),
  version int not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  adoption_note text,
  register_ref text not null default 'C9.06',
  unique (organization_id, site_id, standard_id, strategy_key, version),
  check (
    (status = 'draft' and adopted_by is null and adopted_at is null)
    or (status in ('adopted','superseded') and adopted_by is not null and adopted_at is not null)
  ),
  check ((conformance = 'aligned' and variance_id is null) or conformance = 'variance')
);

create index if not exists idx_site_standard_strategies_resolution
  on public.site_standard_strategies(organization_id, standard_id, site_id, status, version desc);
create unique index if not exists idx_one_adopted_site_standard_strategy
  on public.site_standard_strategies(organization_id,site_id,standard_id)
  where status='adopted';

alter table public.site_standard_strategies enable row level security;
drop policy if exists site_standard_strategies_read on public.site_standard_strategies;
create policy site_standard_strategies_read on public.site_standard_strategies
  for select to authenticated using (organization_id = public.app_current_org());

-- Cross-tenant references and false conformance are persistence invariants,
-- including for service writers. Adoption-time conditions are rechecked here
-- so no direct writer can bypass them.
create or replace function public.enforce_site_standard_strategy_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.governance_standards%rowtype;
  si public.sites%rowtype;
  jp public.job_plans%rowtype;
  v public.standard_site_variances%rowtype;
begin
  select * into s from public.governance_standards where id = new.standard_id;
  select * into si from public.sites where id = new.site_id;
  if s.id is null or si.id is null
     or s.organization_id <> new.organization_id
     or si.organization_id <> new.organization_id then
    raise exception 'standard, site and strategy must belong to the same organization'
      using errcode = 'check_violation';
  end if;

  if new.job_plan_id is not null then
    select * into jp from public.job_plans where id = new.job_plan_id;
    if jp.id is null or jp.organization_id <> new.organization_id then
      raise exception 'the referenced job plan is outside this organization'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.conformance = 'variance' then
    if new.variance_id is null then
      if new.status = 'adopted' then
        raise exception 'a non-conforming site strategy requires an approved variance'
          using errcode = 'check_violation';
      end if;
    else
      select * into v from public.standard_site_variances where id = new.variance_id;
      if v.id is null or v.organization_id <> new.organization_id
         or v.subject_type <> 'standard' or v.standard_id <> new.standard_id
         or v.site_id <> new.site_id then
        raise exception 'the variance does not cover this standard and site'
          using errcode = 'check_violation';
      end if;
      if new.status = 'adopted' and (v.status <> 'approved' or v.expires_at <= now()) then
        raise exception 'the covering variance is not approved and unexpired'
          using errcode = 'check_violation';
      end if;
    end if;
  elsif new.variance_id is not null then
    raise exception 'an aligned strategy cannot claim variance coverage'
      using errcode = 'check_violation';
  end if;

  if new.status = 'adopted' then
    if s.status <> 'adopted' then
      raise exception 'a site strategy cannot be adopted against a non-adopted enterprise standard'
        using errcode = 'check_violation';
    end if;
    if new.job_plan_id is not null and jp.status <> 'adopted' then
      raise exception 'a site strategy cannot rely on a non-adopted job plan'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_site_standard_strategy_integrity()
  from public, anon, authenticated;
drop trigger if exists trg_site_standard_strategy_integrity
  on public.site_standard_strategies;
create trigger trg_site_standard_strategy_integrity
  before insert or update on public.site_standard_strategies
  for each row execute function public.enforce_site_standard_strategy_integrity();

create or replace function public.upsert_enterprise_reliability_method(p_method jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_key text := lower(btrim(coalesce(p_method->>'standard_key','')));
  v_source uuid;
  v_version int;
  v_id uuid;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles where id = auth.uid();
  if coalesce(v_role,'') not in ('reliability_engineer','executive','admin') then
    return jsonb_build_object('error','authoring an enterprise method requires reliability or executive authority');
  end if;
  if v_role = 'ai_admin' then return jsonb_build_object('error','the AI-operator identity cannot author enterprise methods'); end if;
  if v_key !~ '^[a-z0-9][a-z0-9_-]{2,79}$' then
    return jsonb_build_object('error','method key must be 3-80 lowercase letters, numbers, dashes or underscores');
  end if;
  if coalesce(length(btrim(p_method->>'title')),0) < 5
     or coalesce(length(btrim(p_method->>'requirement')),0) < 20
     or coalesce(length(btrim(p_method->>'basis')),0) < 20
     or coalesce(length(btrim(p_method->>'applicability')),0) < 10 then
    return jsonb_build_object('error','title, method, applicability and evidence basis are required');
  end if;
  if coalesce(p_method->>'owner_role','reliability_engineer') not in
       ('reliability_engineer','maintenance_manager','executive','admin')
     or coalesce(p_method->>'variance_approver_role','reliability_engineer') not in
       ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','method ownership and variance approval must name a human engineering, maintenance or executive role');
  end if;

  if nullif(p_method->>'source_standard_id','') is not null then
    begin v_source := (p_method->>'source_standard_id')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('error','source standard id is invalid');
    end;
    if not exists (select 1 from public.governance_standards where id=v_source and organization_id=v_org) then
      return jsonb_build_object('error','source standard not found');
    end if;
    if (select standard_key from public.governance_standards where id=v_source) <> v_key then
      return jsonb_build_object('error','a new version must retain the enterprise method key');
    end if;
  elsif exists (select 1 from public.governance_standards where organization_id=v_org and standard_key=v_key) then
    return jsonb_build_object('error','that enterprise method key already exists; create a version from the existing method');
  end if;

  select coalesce(max(version),0)+1 into v_version
  from public.governance_standards where organization_id=v_org and standard_key=v_key;
  insert into public.governance_standards(
    organization_id,standard_key,title,requirement,mandatory,owner_role,
    variance_approver_role,basis,status,version,standard_kind,applicability,register_ref
  ) values (
    v_org,v_key,btrim(p_method->>'title'),btrim(p_method->>'requirement'),
    coalesce((p_method->>'mandatory')::boolean,true),
    coalesce(nullif(p_method->>'owner_role',''),'reliability_engineer'),
    coalesce(nullif(p_method->>'variance_approver_role',''),'reliability_engineer'),
    btrim(p_method->>'basis'),'draft',v_version,'reliability_method',
    btrim(p_method->>'applicability'),'C9.06'
  ) returning id into v_id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'enterprise_reliability_method',v_role,jsonb_build_object(
    'action','draft_authored','standard_id',v_id,'standard_key',v_key,'version',v_version,'source_standard_id',v_source));
  return jsonb_build_object('standard_id',v_id,'standard_key',v_key,'version',v_version,'status','draft');
exception when invalid_text_representation then
  return jsonb_build_object('error','method fields contain an invalid value');
end
$$;

create or replace function public.adopt_enterprise_reliability_method(
  p_standard_id uuid, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  s public.governance_standards%rowtype;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles where id=auth.uid();
  if v_role = 'ai_admin' then return jsonb_build_object('error','the AI-operator identity cannot adopt an enterprise method'); end if;
  select * into s from public.governance_standards
    where id=p_standard_id and organization_id=v_org and standard_kind='reliability_method';
  if not found then return jsonb_build_object('error','enterprise method not found'); end if;
  if s.status <> 'draft' then return jsonb_build_object('error','only a draft enterprise method can be adopted'); end if;
  if coalesce(v_role,'') not in ('admin','executive') and v_role is distinct from s.owner_role then
    return jsonb_build_object('error',format('adopting this enterprise method requires the %s role',s.owner_role));
  end if;
  if coalesce(length(btrim(p_note)),0) < 20 then
    return jsonb_build_object('error','record the evidence and review basis for adoption (20 characters minimum)');
  end if;

  update public.governance_standards set status='superseded'
    where organization_id=v_org and standard_key=s.standard_key and status='adopted';
  update public.governance_standards set status='adopted',adopted_by=auth.uid(),adopted_at=now(),adoption_note=btrim(p_note)
    where id=s.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'enterprise_reliability_method',v_role,jsonb_build_object(
    'action','adopted','standard_id',s.id,'standard_key',s.standard_key,'version',s.version,'note',btrim(p_note)));
  return jsonb_build_object('standard_id',s.id,'standard_key',s.standard_key,'version',s.version,'status','adopted');
end
$$;

create or replace function public.author_site_standard_strategy(p_strategy jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_standard uuid;
  v_site uuid;
  v_job_plan uuid;
  v_variance uuid;
  v_key text := lower(btrim(coalesce(p_strategy->>'strategy_key','')));
  v_version int;
  v_id uuid;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles where id=auth.uid();
  if coalesce(v_role,'') not in ('planner','reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','authoring a site strategy requires planning, reliability or maintenance authority');
  end if;
  begin
    v_standard := (p_strategy->>'standard_id')::uuid;
    v_site := (p_strategy->>'site_id')::uuid;
    v_job_plan := nullif(p_strategy->>'job_plan_id','')::uuid;
    v_variance := nullif(p_strategy->>'variance_id','')::uuid;
  exception when invalid_text_representation then return jsonb_build_object('error','strategy references are invalid'); end;
  if not exists(select 1 from public.governance_standards where id=v_standard and organization_id=v_org and status='adopted') then
    return jsonb_build_object('error','select an adopted enterprise method');
  end if;
  if not exists(select 1 from public.sites where id=v_site and organization_id=v_org) then
    return jsonb_build_object('error','site not found');
  end if;
  if v_key !~ '^[a-z0-9][a-z0-9_-]{2,79}$' then return jsonb_build_object('error','strategy key is invalid'); end if;
  if coalesce(length(btrim(p_strategy->>'title')),0)<5
     or coalesce(length(btrim(p_strategy->>'local_context')),0)<20
     or coalesce(length(btrim(p_strategy->>'implementation_method')),0)<20
     or coalesce(length(btrim(p_strategy->>'evidence_basis')),0)<20 then
    return jsonb_build_object('error','title, local context, implementation method and evidence basis are required');
  end if;
  if coalesce(p_strategy->>'conformance','') not in ('aligned','variance') then
    return jsonb_build_object('error','conformance must be aligned or variance');
  end if;

  select coalesce(max(version),0)+1 into v_version from public.site_standard_strategies
    where organization_id=v_org and site_id=v_site and standard_id=v_standard and strategy_key=v_key;
  insert into public.site_standard_strategies(
    organization_id,standard_id,site_id,strategy_key,title,local_context,
    implementation_method,job_plan_id,conformance,variance_id,evidence_basis,
    version,created_by
  ) values (
    v_org,v_standard,v_site,v_key,btrim(p_strategy->>'title'),btrim(p_strategy->>'local_context'),
    btrim(p_strategy->>'implementation_method'),v_job_plan,p_strategy->>'conformance',v_variance,
    btrim(p_strategy->>'evidence_basis'),v_version,auth.uid()
  ) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'site_standard_strategy',v_role,jsonb_build_object(
    'action','draft_authored','strategy_id',v_id,'standard_id',v_standard,'site_id',v_site,'version',v_version));
  return jsonb_build_object('strategy_id',v_id,'version',v_version,'status','draft');
end
$$;

create or replace function public.adopt_site_standard_strategy(
  p_strategy_id uuid, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  x public.site_standard_strategies%rowtype;
  s public.governance_standards%rowtype;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles where id=auth.uid();
  if v_role='ai_admin' then return jsonb_build_object('error','the AI-operator identity cannot adopt a site strategy'); end if;
  select * into x from public.site_standard_strategies where id=p_strategy_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','site strategy not found'); end if;
  select * into s from public.governance_standards where id=x.standard_id and organization_id=v_org;
  if x.status<>'draft' then return jsonb_build_object('error','only a draft site strategy can be adopted'); end if;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager') and v_role is distinct from s.owner_role then
    return jsonb_build_object('error',format('adopting this site strategy requires the %s or maintenance-manager role',s.owner_role));
  end if;
  if coalesce(length(btrim(p_note)),0)<20 then
    return jsonb_build_object('error','record the site review and evidence basis for adoption (20 characters minimum)');
  end if;

  update public.site_standard_strategies set status='superseded'
    where organization_id=v_org and site_id=x.site_id and standard_id=x.standard_id
      and status='adopted';
  update public.site_standard_strategies set status='adopted',adopted_by=auth.uid(),adopted_at=now(),adoption_note=btrim(p_note)
    where id=x.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'site_standard_strategy',v_role,jsonb_build_object(
    'action','adopted','strategy_id',x.id,'standard_id',x.standard_id,'site_id',x.site_id,
    'conformance',x.conformance,'variance_id',x.variance_id,'note',btrim(p_note)));
  return jsonb_build_object('strategy_id',x.id,'status','adopted','resolution','site_strategy');
exception when check_violation then return jsonb_build_object('error',sqlerrm);
end
$$;

create or replace function public.get_enterprise_method_federation()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare v_org uuid := public.app_current_org();
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  return jsonb_build_object(
    'methods',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'standard_key',s.standard_key,'title',s.title,'method',s.requirement,
      'applicability',s.applicability,'mandatory',s.mandatory,'owner_role',s.owner_role,
      'variance_approver_role',s.variance_approver_role,'basis',s.basis,'status',s.status,
      'version',s.version,'adoption_note',s.adoption_note
    ) order by s.standard_key,s.version desc) from public.governance_standards s
      where s.organization_id=v_org and s.standard_kind='reliability_method'
        and s.status in ('draft','adopted')),'[]'::jsonb),
    'effective_site_methods',coalesce((select jsonb_agg(jsonb_build_object(
      'standard_id',s.id,'standard_key',s.standard_key,'standard_title',s.title,
      'site_id',si.id,'site',si.name,
      'resolution',case when st.id is null then 'enterprise_standard' else 'site_strategy' end,
      'strategy_id',st.id,'strategy_title',st.title,'local_context',st.local_context,
      'implementation_method',coalesce(st.implementation_method,s.requirement),
      'job_plan_id',st.job_plan_id,'job_plan',jp.title,
      'conformance',coalesce(st.conformance,'inherited'),
      'evidence_basis',coalesce(st.evidence_basis,s.basis),
      'variance_id',st.variance_id,'variance_status',v.status,'variance_expires_at',v.expires_at,
      'authority','method resolution only; no work, operating limit, approval or execution state changed'
    ) order by s.title,si.name) from public.governance_standards s
      cross join public.sites si
      left join lateral (
        select z.* from public.site_standard_strategies z
        where z.organization_id=v_org and z.standard_id=s.id and z.site_id=si.id and z.status='adopted'
          and (z.conformance='aligned' or exists (
            select 1 from public.standard_site_variances cover
            where cover.id=z.variance_id and cover.organization_id=v_org
              and cover.subject_type='standard' and cover.standard_id=z.standard_id
              and cover.site_id=z.site_id and cover.status='approved' and cover.expires_at>now()
          ))
        order by z.version desc,z.adopted_at desc limit 1
      ) st on true
      left join public.job_plans jp on jp.id=st.job_plan_id and jp.organization_id=v_org
      left join public.standard_site_variances v on v.id=st.variance_id and v.organization_id=v_org
      where s.organization_id=v_org and s.standard_kind='reliability_method' and s.status='adopted'
        and si.organization_id=v_org),'[]'::jsonb),
    'available_variances',coalesce((select jsonb_agg(jsonb_build_object(
      'id',v.id,'standard_id',v.standard_id,'site_id',v.site_id,
      'status',v.status,'expires_at',v.expires_at,'justification',v.justification,
      'compensating_controls',v.compensating_controls
    ) order by v.expires_at) from public.standard_site_variances v
      where v.organization_id=v_org and v.subject_type='standard'
        and v.status='approved' and v.expires_at>now()),'[]'::jsonb),
    'site_strategy_drafts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',st.id,'standard_id',st.standard_id,'standard_title',s.title,
      'site_id',st.site_id,'site',si.name,'strategy_key',st.strategy_key,
      'title',st.title,'conformance',st.conformance,'variance_id',st.variance_id,
      'version',st.version,'evidence_basis',st.evidence_basis
    ) order by si.name,s.title,st.version desc) from public.site_standard_strategies st
      join public.governance_standards s on s.id=st.standard_id and s.organization_id=v_org
      join public.sites si on si.id=st.site_id and si.organization_id=v_org
      where st.organization_id=v_org and st.status='draft'),'[]'::jsonb),
    'blocked_site_strategies',coalesce((select jsonb_agg(jsonb_build_object(
      'id',st.id,'standard_id',st.standard_id,'standard_title',s.title,
      'site_id',st.site_id,'site',si.name,'title',st.title,
      'reason','covering variance is no longer approved and unexpired; enterprise method applies',
      'variance_id',st.variance_id,'variance_status',v.status,'variance_expires_at',v.expires_at
    ) order by si.name,s.title) from public.site_standard_strategies st
      join public.governance_standards s on s.id=st.standard_id and s.organization_id=v_org
      join public.sites si on si.id=st.site_id and si.organization_id=v_org
      left join public.standard_site_variances v on v.id=st.variance_id and v.organization_id=v_org
      where st.organization_id=v_org and st.status='adopted' and st.conformance='variance'
        and (v.id is null or v.status<>'approved' or v.expires_at<=now())),'[]'::jsonb),
    'controls',jsonb_build_object(
      'inheritance','an adopted enterprise method applies until a site strategy is adopted',
      'variance','a non-conforming strategy requires an approved, unexpired variance for the exact site and method',
      'execution','resolution is advisory governance context and cannot approve or release work')
  );
end
$$;

revoke all on function public.upsert_enterprise_reliability_method(jsonb) from public, anon;
revoke all on function public.adopt_enterprise_reliability_method(uuid,text) from public, anon;
revoke all on function public.author_site_standard_strategy(jsonb) from public, anon;
revoke all on function public.adopt_site_standard_strategy(uuid,text) from public, anon;
revoke all on function public.get_enterprise_method_federation() from public, anon;
grant execute on function public.upsert_enterprise_reliability_method(jsonb) to authenticated;
grant execute on function public.adopt_enterprise_reliability_method(uuid,text) to authenticated;
grant execute on function public.author_site_standard_strategy(jsonb) to authenticated;
grant execute on function public.adopt_site_standard_strategy(uuid,text) to authenticated;
grant execute on function public.get_enterprise_method_federation() to authenticated;

notify pgrst, 'reload schema';
