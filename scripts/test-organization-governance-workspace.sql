\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;

create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text,
  timezone text,
  org_level text not null default 'enterprise',
  parent_id uuid references public.organizations(id),
  jurisdiction text
);

create table public.project_frameworks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  version int not null default 1,
  status text not null default 'draft',
  source_authority text not null default 'INDUSTRY_GUIDANCE'
);

alter table public.organizations
  add column governance_profile_id uuid references public.project_frameworks(id);

create table public.user_profiles (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  role text not null
);

create table public.governance_tailoring_rule_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  status text not null default 'draft'
);

create or replace function public.app_current_org()
returns uuid language sql stable as $$
  select organization_id from public.user_profiles where id = auth.uid()
$$;

create or replace function public.seed_governance_framework_library(p_target uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  i int;
  n int := 0;
begin
  for i in 1..6 loop
    if not exists (
      select 1 from project_frameworks
      where organization_id = p_target and name = 'Fixture profile ' || i
    ) then
      insert into project_frameworks(organization_id, name)
      values (p_target, 'Fixture profile ' || i);
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;

create or replace function public.seed_governance_tailoring_defaults(p_target uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from governance_tailoring_rule_sets
    where organization_id = p_target and name = 'Fixture tailoring defaults'
  ) then
    return 0;
  end if;
  insert into governance_tailoring_rule_sets(organization_id, name)
  values (p_target, 'Fixture tailoring defaults');
  return 1;
end
$$;

create or replace function public.org_ancestry(p_start uuid)
returns table(node_id uuid, depth int)
language sql
stable
security definer
set search_path = public
as $$
  with recursive ancestry as (
    select id, parent_id, 0 as depth, array[id] as seen
    from organizations where id = p_start
    union all
    select parent.id, parent.parent_id, ancestry.depth + 1,
           ancestry.seen || parent.id
    from ancestry
    join organizations parent on parent.id = ancestry.parent_id
    where not parent.id = any(ancestry.seen)
  )
  select id, depth from ancestry
$$;

create or replace function public.org_node_in_scope(p_node uuid, p_root uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from org_ancestry(p_node) where node_id = p_root)
$$;

create or replace function public.resolve_org_governance_profile(p_node uuid)
returns table(framework_id uuid, source_node_id uuid, source_depth int)
language sql
stable
security definer
set search_path = public
as $$
  with recursive ancestry as (
    select id, parent_id, governance_profile_id, 0 as depth, array[id] as seen
    from organizations where id = p_node
    union all
    select parent.id, parent.parent_id, parent.governance_profile_id,
           ancestry.depth + 1, ancestry.seen || parent.id
    from ancestry
    join organizations parent on parent.id = ancestry.parent_id
    where not parent.id = any(ancestry.seen)
  )
  select f.id, ancestry.id, ancestry.depth
  from ancestry
  join project_frameworks f on f.id = ancestry.governance_profile_id
  where f.status = 'adopted'
  order by ancestry.depth
  limit 1
$$;

\ir ../supabase/migrations/20270101090000_organization_governance_workspace.sql

insert into organizations(id, name, industry, org_level)
values ('70101090-0000-4000-8000-000000000001', 'Fixture root', 'industrial', 'enterprise');

insert into organizations(id, name, industry, org_level, parent_id)
values (
  '70101090-0000-4000-8000-000000000002',
  'Fixture site',
  'industrial',
  'site',
  '70101090-0000-4000-8000-000000000001'
);

insert into organizations(id, name, industry, org_level)
values ('70101090-0000-4000-8000-000000000003', 'Foreign root', 'industrial', 'enterprise');

insert into user_profiles(id, organization_id, role)
values (
  '70101090-0000-4000-8000-000000000010',
  '70101090-0000-4000-8000-000000000001',
  'executive'
);

update project_frameworks
set status = 'adopted'
where id = (
  select id from project_frameworks
  where organization_id = '70101090-0000-4000-8000-000000000001'
  order by name limit 1
);

update organizations
set governance_profile_id = (
  select id from project_frameworks
  where organization_id = '70101090-0000-4000-8000-000000000001'
    and status = 'adopted'
  limit 1
)
where id = '70101090-0000-4000-8000-000000000001';

select set_config(
  'request.jwt.claim.sub',
  '70101090-0000-4000-8000-000000000010',
  false
);

do $$
declare
  workspace jsonb;
begin
  if (select count(*) from project_frameworks
      where organization_id = '70101090-0000-4000-8000-000000000001') <> 6 then
    raise exception 'root did not receive exactly six profiles';
  end if;
  if (select count(*) from governance_tailoring_rule_sets
      where organization_id = '70101090-0000-4000-8000-000000000001') <> 1 then
    raise exception 'root did not receive tailoring defaults';
  end if;
  if exists (select 1 from project_frameworks
             where organization_id = '70101090-0000-4000-8000-000000000002') then
    raise exception 'child node received a duplicate framework shelf';
  end if;

  workspace := get_organization_governance_workspace();
  if workspace->>'error' is not null then
    raise exception 'workspace refused: %', workspace;
  end if;
  if workspace->'root'->>'id' <> '70101090-0000-4000-8000-000000000001' then
    raise exception 'workspace root escaped caller scope: %', workspace->'root';
  end if;
  if jsonb_array_length(workspace->'nodes') <> 2 then
    raise exception 'workspace did not return exactly the root subtree: %', workspace->'nodes';
  end if;
  if exists (
    select 1 from jsonb_array_elements(workspace->'nodes') n
    where n->>'id' = '70101090-0000-4000-8000-000000000003'
  ) then
    raise exception 'foreign root leaked into workspace';
  end if;
  if workspace->>'canManage' <> 'true' then
    raise exception 'executive authority was not reported';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(workspace->'nodes') n
    where n->>'id' = '70101090-0000-4000-8000-000000000002'
      and n->'resolvedProfile'->>'sourceNodeId' = '70101090-0000-4000-8000-000000000001'
  ) then
    raise exception 'child did not resolve the root profile: %', workspace->'nodes';
  end if;
end
$$;

select 'organization governance workspace fixture passed' as result;
