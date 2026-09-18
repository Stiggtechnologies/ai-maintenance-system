-- D1.03 / spec section 40 — Hybrid Development inside one Development Case.
--
-- Canonical-home ruling: development_cases remains the project/case object.
-- This table is its owned workstream collection, not a parallel project model.
-- An accountable human records the delivery method; AI/system identities are
-- refused and no row makes a gate, sanction or approval determination.

create table if not exists development_workstreams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  workstream_code text not null check (workstream_code ~ '^[A-Z0-9][A-Z0-9._-]{0,31}$'),
  title text not null check (length(btrim(title)) >= 3),
  development_approach text not null
    check (development_approach in ('predictive','adaptive','iterative','hybrid')),
  approach_rationale text not null check (length(btrim(approach_rationale)) >= 20),
  owner_id uuid references auth.users(id),
  planning_horizon_days integer check (planning_horizon_days is null or planning_horizon_days > 0),
  review_cadence_days integer check (review_cadence_days is null or review_cadence_days > 0),
  status text not null default 'adopted' check (status in ('adopted','retired')),
  version integer not null default 1 check (version > 0),
  adopted_by uuid not null references auth.users(id),
  adopted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (development_case_id, workstream_code, version)
);

create unique index if not exists development_workstreams_one_active_code
  on development_workstreams(development_case_id, workstream_code)
  where status='adopted';
create index if not exists development_workstreams_case
  on development_workstreams(organization_id, development_case_id, status);

alter table development_workstreams enable row level security;
drop policy if exists development_workstreams_read on development_workstreams;
create policy development_workstreams_read on development_workstreams
  for select to authenticated
  using (organization_id = app_current_org());
revoke insert, update, delete, truncate on table development_workstreams
  from public, anon, authenticated;

create or replace function public.enforce_development_workstream_tenancy()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_case_org uuid; v_owner_org uuid; v_adopter_org uuid;
begin
  select organization_id into v_case_org from development_cases
    where id=new.development_case_id;
  if v_case_org is null or v_case_org <> new.organization_id then
    raise exception 'workstream and development case must belong to the same organization'
      using errcode='23514';
  end if;
  if new.owner_id is not null then
    select organization_id into v_owner_org from user_profiles where id=new.owner_id;
    if v_owner_org is null or v_owner_org <> new.organization_id then
      raise exception 'workstream owner must belong to the development case organization'
        using errcode='23514';
    end if;
  end if;
  select organization_id into v_adopter_org from user_profiles where id=new.adopted_by;
  if v_adopter_org is null or v_adopter_org <> new.organization_id then
    raise exception 'workstream adopter must be a human member of the development case organization'
      using errcode='23514';
  end if;
  return new;
end; $$;
revoke all on function public.enforce_development_workstream_tenancy()
  from public, anon, authenticated;
drop trigger if exists trg_development_workstream_tenancy on development_workstreams;
create trigger trg_development_workstream_tenancy
  before insert or update on development_workstreams
  for each row execute function public.enforce_development_workstream_tenancy();

create or replace function public.enforce_development_workstream_history()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    raise exception 'development workstreams are retained as project governance evidence';
  end if;
  if old.status='retired' then
    raise exception 'retired development workstreams are immutable';
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.development_case_id is distinct from old.development_case_id
     or new.workstream_code is distinct from old.workstream_code
     or new.title is distinct from old.title
     or new.development_approach is distinct from old.development_approach
     or new.approach_rationale is distinct from old.approach_rationale
     or new.owner_id is distinct from old.owner_id
     or new.planning_horizon_days is distinct from old.planning_horizon_days
     or new.review_cadence_days is distinct from old.review_cadence_days
     or new.version is distinct from old.version
     or new.adopted_by is distinct from old.adopted_by
     or new.adopted_at is distinct from old.adopted_at then
    raise exception 'an adopted workstream is immutable; revise it through a new version';
  end if;
  if new.status <> 'retired' then
    raise exception 'an adopted workstream may only transition to retired';
  end if;
  return new;
end; $$;
revoke all on function public.enforce_development_workstream_history()
  from public, anon, authenticated;
drop trigger if exists trg_development_workstream_history on development_workstreams;
create trigger trg_development_workstream_history
  before update or delete on development_workstreams
  for each row execute function public.enforce_development_workstream_history();

create or replace function public.record_development_workstream(
  p_case_id uuid,
  p_workstream_code text,
  p_title text,
  p_development_approach text,
  p_approach_rationale text,
  p_owner_id uuid default null,
  p_planning_horizon_days integer default null,
  p_review_cadence_days integer default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; v_id uuid; v_code text; v_version integer;
begin
  select role into v_role from user_profiles
    where id=auth.uid() and organization_id=v_org;
  if v_role is null or v_role='ai_admin' then
    return jsonb_build_object('error','an accountable human project role must adopt a workstream approach');
  end if;
  if v_role not in ('admin','executive','manager','planner','engineer','reliability_engineer') then
    return jsonb_build_object('error','your role cannot adopt a development workstream approach');
  end if;
  if not exists(select 1 from development_cases where id=p_case_id and organization_id=v_org) then
    return jsonb_build_object('error','development case not found');
  end if;
  v_code:=upper(btrim(coalesce(p_workstream_code,'')));
  if v_code !~ '^[A-Z0-9][A-Z0-9._-]{0,31}$' then
    return jsonb_build_object('error','workstream code must be 1-32 letters, numbers, dots, underscores or hyphens');
  end if;
  if coalesce(length(btrim(p_title)),0)<3 then
    return jsonb_build_object('error','name the workstream');
  end if;
  if p_development_approach not in ('predictive','adaptive','iterative','hybrid') then
    return jsonb_build_object('error','development approach must be predictive, adaptive, iterative or hybrid');
  end if;
  if coalesce(length(btrim(p_approach_rationale)),0)<20 then
    return jsonb_build_object('error','record at least 20 characters explaining why this approach fits the workstream');
  end if;
  if (p_planning_horizon_days is not null and p_planning_horizon_days<=0)
     or (p_review_cadence_days is not null and p_review_cadence_days<=0) then
    return jsonb_build_object('error','planning horizon and review cadence must be positive days when supplied');
  end if;
  if p_owner_id is not null and not exists(
    select 1 from user_profiles where id=p_owner_id and organization_id=v_org
  ) then
    return jsonb_build_object('error','workstream owner must belong to this organization');
  end if;

  select coalesce(max(version),0)+1 into v_version
  from development_workstreams
  where development_case_id=p_case_id and workstream_code=v_code;
  update development_workstreams set status='retired'
    where development_case_id=p_case_id and organization_id=v_org
      and workstream_code=v_code and status='adopted';
  insert into development_workstreams(
    organization_id,development_case_id,workstream_code,title,
    development_approach,approach_rationale,owner_id,planning_horizon_days,
    review_cadence_days,status,version,adopted_by
  ) values (
    v_org,p_case_id,v_code,btrim(p_title),p_development_approach,
    btrim(p_approach_rationale),p_owner_id,p_planning_horizon_days,
    p_review_cadence_days,'adopted',v_version,auth.uid()
  ) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
    values(v_org,'development_workstream',v_role,
      jsonb_build_object('workstream_id',v_id,'action','adopted','case_id',p_case_id,'workstream_code',v_code,
        'development_approach',p_development_approach,'version',v_version,
        'human_determined',true));
  return jsonb_build_object('workstream_id',v_id,'workstream_code',v_code,
    'development_approach',p_development_approach,'version',v_version);
end; $$;
revoke all on function public.record_development_workstream(uuid,text,text,text,text,uuid,integer,integer)
  from public,anon;
grant execute on function public.record_development_workstream(uuid,text,text,text,text,uuid,integer,integer)
  to authenticated;

create or replace function public.get_case_development_workstreams(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_result jsonb;
begin
  if not exists(select 1 from development_cases where id=p_case_id and organization_id=v_org) then
    return jsonb_build_object('error','development case not found');
  end if;
  select jsonb_build_object(
    'workstreams',coalesce(jsonb_agg(jsonb_build_object(
      'id',w.id,'workstreamCode',w.workstream_code,'title',w.title,
      'developmentApproach',w.development_approach,
      'approachRationale',w.approach_rationale,'ownerId',w.owner_id,
      'owner',coalesce(nullif(u.full_name,''),u.email),
      'planningHorizonDays',w.planning_horizon_days,
      'reviewCadenceDays',w.review_cadence_days,'version',w.version,
      'adoptedBy',coalesce(nullif(a.full_name,''),a.email),
      'adoptedAt',w.adopted_at
    ) order by w.workstream_code) filter(where w.id is not null),'[]'::jsonb),
    'distinctApproaches',coalesce(count(distinct w.development_approach),0),
    'isHybridCase',coalesce(count(distinct w.development_approach),0)>1
  ) into v_result
  from development_workstreams w
  left join user_profiles u on u.id=w.owner_id and u.organization_id=v_org
  left join user_profiles a on a.id=w.adopted_by and a.organization_id=v_org
  where w.development_case_id=p_case_id and w.organization_id=v_org and w.status='adopted';
  return v_result;
end; $$;
revoke all on function public.get_case_development_workstreams(uuid) from public,anon;
grant execute on function public.get_case_development_workstreams(uuid) to authenticated;

comment on table development_workstreams is
  'D1.03: human-adopted per-workstream delivery approaches under one canonical Development Case.';
