-- ============================================================================
-- Asset interdependency: what depends on what, and what falls over with it
-- (capability register U2.01–U2.09).
--
-- Every asset record in this platform has, until now, stood alone. It has a
-- class, a criticality and a site, and nothing that says the crusher cannot
-- run without the substation or that both conveyors draw from the same feeder.
-- That gap is why a criticality rating is so often wrong in practice: an asset
-- rated "medium" on its own replacement cost is critical the moment you notice
-- that eleven other assets stop when it does.
--
-- WHAT THIS MODELS, AND THE ONE IDEA IT TURNS ON.
--
-- A dependency is a directed edge: the DEPENDENT needs the SUPPLIER. Edges
-- carry a redundancy_group. Two edges into the same dependent sharing a group
-- are ALTERNATIVES — either will do. An edge with no group is on its own, and
-- losing that supplier takes the dependent with it.
--
-- That one column is what lets the analysis say something a hierarchy cannot:
-- redundancy only counts when the redundant paths can fail INDEPENDENTLY. Two
-- pumps in an N+1 pair are worth nothing if both are fed by the same MCC, and
-- the common-cause groups here exist to catch exactly that. A redundancy claim
-- that has never been checked against common cause is a claim, not a defence.
--
-- WHAT IS NOT ASSUMED.
--
-- An asset with no recorded edges is NOT assumed independent. The distinction
-- matters more here than almost anywhere else in the platform, because an
-- empty dependency graph produces a beautiful clean result — no single points
-- of failure, no cascades, nothing to worry about — which is indistinguishable
-- from a site that has never been mapped. Every read path reports edge
-- coverage alongside the finding, and the analysis engine refuses to state
-- "no single points of failure" for a graph that has no edges to speak of.
--
-- Dependencies are not inferred from the assets.area / assets.system text
-- fields. Sharing an area string means two assets are near each other, which
-- is evidence for a geographic common cause and is NOT evidence of a
-- functional dependency. Candidates derived that way land in
-- dependency_candidates for a human to confirm, never in the graph itself.
--
-- Canonical reuse: assets, sites, organizations, app_current_org(). No
-- existing table modelled relationships between assets, so there was nothing
-- to extend. Additive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The graph (U2.01 functional dependency, U2.02 topology, U2.04 shared
-- utilities, U2.07 geographic)
-- ---------------------------------------------------------------------------
create table if not exists asset_dependencies (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  -- The asset that stops working.
  dependent_asset_id uuid not null references assets(id) on delete cascade,
  -- The asset it needs in order to keep working.
  supplier_asset_id uuid not null references assets(id) on delete cascade,
  dependency_kind text not null check (dependency_kind in (
    'functional',   -- process: the dependent cannot perform its function
    'utility',      -- shared supply: power, air, water, steam, hydraulics
    'topological',  -- network position: upstream/downstream in a flow or line
    'control',      -- automation, PLC, network, permissive, interlock
    'geographic',   -- co-located: access, containment, shared structure
    'logistical'    -- shared crew, spares, transport, access route
  )),
  -- Edges into one dependent sharing a group are alternatives. NULL means this
  -- supplier is on its own: lose it and the dependent goes down.
  redundancy_group text,
  -- For N+2 and better: how many of the group's suppliers must survive.
  min_suppliers_required int not null default 1 check (min_suppliers_required >= 1),
  -- Share of the dependent's capacity this supplier carries, where known.
  -- Lets the analysis distinguish "stopped" from "running at 60%" (U2.06).
  capacity_share_pct numeric check (capacity_share_pct > 0 and capacity_share_pct <= 100),
  -- Where this edge came from. An unevidenced graph is a drawing exercise.
  evidence text,
  -- 'demo' is deliberately a first-class value: an illustrative edge must be
  -- able to say so about itself, so no one mistakes a sample graph for a
  -- mapped plant. Coverage counts them separately for the same reason.
  source text not null default 'human' check (source in
    ('human', 'p_and_id', 'single_line', 'gis', 'connector', 'derived', 'demo')),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  -- An asset cannot depend on itself.
  check (dependent_asset_id <> supplier_asset_id)
);

alter table asset_dependencies drop constraint if exists asset_dependencies_source_check;
alter table asset_dependencies add constraint asset_dependencies_source_check
  check (source in ('human', 'p_and_id', 'single_line', 'gis', 'connector', 'derived', 'demo'));

create unique index if not exists idx_asset_dep_edge
  on asset_dependencies(organization_id, dependent_asset_id, supplier_asset_id, dependency_kind);
create index if not exists idx_asset_dep_supplier
  on asset_dependencies(organization_id, supplier_asset_id);
create index if not exists idx_asset_dep_dependent
  on asset_dependencies(organization_id, dependent_asset_id);

alter table asset_dependencies enable row level security;
drop policy if exists asset_dependencies_read on asset_dependencies;
create policy asset_dependencies_read on asset_dependencies
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Common cause (U2.03). The reason a redundancy claim can be worthless.
-- ---------------------------------------------------------------------------
create table if not exists common_cause_groups (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  name text not null,
  cause_kind text not null check (cause_kind in (
    'shared_supply',      -- one feeder, one air compressor, one header
    'shared_location',    -- one room, one bund, one flood plain, one fire area
    'shared_design',      -- same make/model/batch — a systemic defect hits all
    'shared_maintenance', -- same crew, same procedure, same calibration source
    'shared_control',     -- one PLC, one network segment, one firmware version
    'shared_environment'  -- same weather, seismic, dust or temperature exposure
  )),
  description text,
  created_at timestamptz not null default now()
);

create table if not exists common_cause_members (
  group_id bigint not null references common_cause_groups(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  primary key (group_id, asset_id)
);

create index if not exists idx_ccg_org on common_cause_groups(organization_id);
create index if not exists idx_ccm_asset on common_cause_members(organization_id, asset_id);

alter table common_cause_groups enable row level security;
alter table common_cause_members enable row level security;
drop policy if exists ccg_read on common_cause_groups;
create policy ccg_read on common_cause_groups
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists ccm_read on common_cause_members;
create policy ccm_read on common_cause_members
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- What the loss actually costs the people outside the fence (U2.08).
-- Kept deliberately thin: this is the consequence of losing THIS asset's
-- service, not a full consequence model. The wider one is U9.
-- ---------------------------------------------------------------------------
create table if not exists asset_service_levels (
  asset_id uuid primary key references assets(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  service_name text not null,
  -- Who or what is on the other end of this service.
  beneficiary text,
  -- Hours the service can be down before the consequence bites.
  tolerable_downtime_hours numeric check (tolerable_downtime_hours >= 0),
  consequence_class text check (consequence_class in
    ('safety', 'environmental', 'regulatory', 'customer', 'production', 'financial')),
  -- Restoration order is decided on consequence, not on convenience.
  restoration_rank int check (restoration_rank >= 1),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_asl_org on asset_service_levels(organization_id);
alter table asset_service_levels enable row level security;
drop policy if exists asl_read on asset_service_levels;
create policy asl_read on asset_service_levels
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Derived candidates. NOT the graph — a queue of things a human should look
-- at. Co-location and shared model numbers are evidence of common cause, and
-- are not evidence of a functional dependency.
-- ---------------------------------------------------------------------------
create table if not exists dependency_candidates (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  dependent_asset_id uuid not null references assets(id) on delete cascade,
  supplier_asset_id uuid references assets(id) on delete cascade,
  suggested_kind text,
  -- What the candidates group under when confirmed, e.g. 'area:Crusher house'
  -- or 'model:Cat 793F'. Stored at generation so confirmation does not have to
  -- re-derive it from an asset record that may have changed since.
  group_key text,
  basis text not null,
  confidence text not null default 'weak' check (confidence in ('weak', 'moderate', 'strong')),
  status text not null default 'open' check (status in ('open', 'confirmed', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table dependency_candidates add column if not exists group_key text;

create index if not exists idx_depcand_open
  on dependency_candidates(organization_id, status) where status = 'open';

alter table dependency_candidates enable row level security;
drop policy if exists depcand_read on dependency_candidates;
create policy depcand_read on dependency_candidates
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Coverage. The number that stops a clean result being mistaken for a safe
-- one. Read this before you believe anything the analysis says.
-- ---------------------------------------------------------------------------
-- Dropped first: the signature has out-parameters, and Postgres will not let
-- create-or-replace change a row type, which would make this migration fail on
-- any environment that already has an earlier version of it.
drop function if exists get_dependency_coverage();
create or replace function get_dependency_coverage()
returns table (
  total_assets bigint,
  assets_with_edges bigint,
  coverage_pct numeric,
  edge_count bigint,
  demo_edges bigint,
  unevidenced_edges bigint,
  common_cause_groups_defined bigint,
  assets_with_service_level bigint,
  open_candidates bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (
    select count(*)::bigint n from assets where organization_id = app_current_org()
  ),
  linked as (
    select count(distinct id)::bigint n from (
      select dependent_asset_id id from asset_dependencies where organization_id = app_current_org()
      union
      select supplier_asset_id from asset_dependencies where organization_id = app_current_org()
    ) x
  ),
  e as (
    select count(*)::bigint n,
           count(*) filter (where source = 'demo')::bigint demo,
           count(*) filter (where evidence is null or btrim(evidence) = '')::bigint unevidenced
    from asset_dependencies where organization_id = app_current_org()
  )
  select a.n,
         linked.n,
         case when a.n = 0 then 0 else round(linked.n * 100.0 / a.n, 1) end,
         e.n,
         e.demo,
         e.unevidenced,
         (select count(*) from common_cause_groups where organization_id = app_current_org()),
         (select count(*) from asset_service_levels where organization_id = app_current_org()),
         (select count(*) from dependency_candidates
            where organization_id = app_current_org() and status = 'open'),
         case
           when e.n = 0 then
             'No dependency edges are recorded. Any cascade or single-point-of-failure '
             || 'result below is empty because the graph is empty, not because the site is resilient.'
           when linked.n * 100.0 / greatest(a.n, 1) < 25 then
             'Only ' || round(linked.n * 100.0 / greatest(a.n, 1), 1) || '% of assets appear in the graph. '
             || 'Findings cover the mapped part of the plant and say nothing about the rest.'
           else
             round(linked.n * 100.0 / greatest(a.n, 1), 1) || '% of assets appear in the dependency graph across '
             || e.n || ' edges'
             || case when e.unevidenced > 0
                     then ', ' || e.unevidenced || ' of them with no recorded evidence' else '' end || '.'
         end
         -- Appended to every non-empty case, not just one of them: a reader
         -- must be told the edges are illustrative whatever else is said.
         || case when e.demo > 0 then ' ' || e.demo || ' of these edges are ILLUSTRATIVE DEMO edges, '
                 || 'not a mapping of a real plant, and every finding drawn from them demonstrates '
                 || 'the method rather than describing equipment.' else '' end
  from a, linked, e;
$$;

grant execute on function get_dependency_coverage() to authenticated;

-- ---------------------------------------------------------------------------
-- The graph itself, shaped for the analysis engine. The traversal maths lives
-- in TypeScript where it is unit-tested against hand-worked cases; this
-- returns the facts, not the conclusions.
-- ---------------------------------------------------------------------------
create or replace function get_dependency_graph()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'tag', a.tag, 'name', a.name,
        'criticality', a.criticality, 'assetClass', a.asset_class,
        'serviceName', sl.service_name,
        'consequenceClass', sl.consequence_class,
        'tolerableDowntimeHours', sl.tolerable_downtime_hours,
        'restorationRank', sl.restoration_rank
      ) order by a.name)
      from assets a
      left join asset_service_levels sl on sl.asset_id = a.id
      where a.organization_id = app_current_org()
        and (exists (select 1 from asset_dependencies d
                     where d.organization_id = a.organization_id
                       and (d.dependent_asset_id = a.id or d.supplier_asset_id = a.id))
             or sl.asset_id is not null)
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dependent', d.dependent_asset_id,
        'supplier', d.supplier_asset_id,
        'kind', d.dependency_kind,
        'redundancyGroup', d.redundancy_group,
        'minRequired', d.min_suppliers_required,
        'capacitySharePct', d.capacity_share_pct,
        'evidence', d.evidence,
        'source', d.source
      ))
      from asset_dependencies d where d.organization_id = app_current_org()
    ), '[]'::jsonb),
    'commonCauseGroups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'causeKind', g.cause_kind,
        'members', coalesce((select jsonb_agg(m.asset_id)
                             from common_cause_members m where m.group_id = g.id), '[]'::jsonb)
      ))
      from common_cause_groups g where g.organization_id = app_current_org()
    ), '[]'::jsonb)
  );
$$;

grant execute on function get_dependency_graph() to authenticated;

-- ---------------------------------------------------------------------------
-- Candidate generation (U2.07 geographic, and the shared-design arm of U2.03).
-- Proposes common-cause groupings from facts already in the asset register.
-- Writes CANDIDATES ONLY. Nothing enters the graph without a human.
-- ---------------------------------------------------------------------------
create or replace function suggest_dependency_candidates()
returns table (created bigint, basis text)
language plpgsql
-- Definer because the caller has read-only RLS on this table by design; every
-- insert below is hard-scoped to v_org, which comes from app_current_org() and
-- from nowhere else, so a caller cannot reach another tenant through it.
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_created bigint := 0;
  v_geo bigint := 0;
  v_model bigint := 0;
begin
  if v_org is null then
    return query select 0::bigint, 'No organization in session.'::text;
    return;
  end if;

  -- Co-location: same site and same area string. Evidence of shared exposure,
  -- NOT of a functional dependency — which is why it becomes a common-cause
  -- candidate with a weak confidence and no supplier asset attached.
  insert into dependency_candidates
    (organization_id, dependent_asset_id, supplier_asset_id, suggested_kind, group_key, basis, confidence)
  select v_org, a.id, null, 'geographic', 'area:' || a.area,
         'Shares area "' || a.area || '" with ' || (cnt.n - 1) || ' other assets. '
         || 'Co-location is evidence of shared exposure (fire, flood, access, containment), '
         || 'not of a functional dependency.',
         'weak'
  from assets a
  join (
    select site_id, area, count(*) n from assets
    where organization_id = v_org and area is not null and btrim(area) <> ''
    group by site_id, area having count(*) > 1
  ) cnt on cnt.site_id is not distinct from a.site_id and cnt.area = a.area
  where a.organization_id = v_org
    and not exists (
      select 1 from dependency_candidates c
      where c.organization_id = v_org and c.dependent_asset_id = a.id
        and c.suggested_kind = 'geographic')
  ;
  get diagnostics v_geo = row_count;

  -- Same make and model: a systemic defect or a bad batch does not respect
  -- the redundancy diagram. This is the failure mode that makes an N+1 pair
  -- fail together on the same day.
  insert into dependency_candidates
    (organization_id, dependent_asset_id, supplier_asset_id, suggested_kind, group_key, basis, confidence)
  select v_org, a.id, null, 'shared_design', 'model:' || a.manufacturer || ' ' || a.model,
         'Shares make/model "' || a.manufacturer || ' ' || a.model || '" with '
         || (cnt.n - 1) || ' other assets. A systemic defect or a bad batch hits all of them, '
         || 'which is how an N+1 pair fails on the same day.',
         'moderate'
  from assets a
  join (
    select manufacturer, model, count(*) n from assets
    where organization_id = v_org
      and manufacturer is not null and btrim(manufacturer) <> ''
      and model is not null and btrim(model) <> ''
    group by manufacturer, model having count(*) > 1
  ) cnt on cnt.manufacturer = a.manufacturer and cnt.model = a.model
  where a.organization_id = v_org
    and not exists (
      select 1 from dependency_candidates c
      where c.organization_id = v_org and c.dependent_asset_id = a.id
        and c.suggested_kind = 'shared_design')
  ;
  get diagnostics v_model = row_count;

  v_created := v_geo + v_model;

  return query select v_created,
    ('Proposed ' || v_created || ' candidates (' || v_geo || ' co-location, ' || v_model
     || ' shared make/model) for human review. None entered the dependency graph: '
     || 'proximity and a shared model number are evidence of COMMON CAUSE, never of a '
     || 'functional dependency. The functional edges have to come from a P&ID, a single-line '
     || 'diagram or someone who knows the plant.')::text;
end;
$$;

grant execute on function suggest_dependency_candidates() to authenticated;

-- ---------------------------------------------------------------------------
-- Acting on a candidate. A review queue nobody can clear is a to-do list the
-- software wrote for itself, so confirmation is a real transition:
--
--   reject                     -> recorded as rejected, with who and when.
--   confirm WITH a supplier    -> becomes a dependency edge.
--   confirm WITHOUT a supplier -> becomes membership of a common-cause group,
--                                 because that is what co-location and a
--                                 shared model number are actually evidence of.
--
-- Definer for the same reason as the generator: the caller holds read-only RLS
-- on these tables and every write is scoped to app_current_org().
-- ---------------------------------------------------------------------------
create or replace function review_dependency_candidate(
  p_candidate_id bigint,
  p_decision text,
  p_dependency_kind text default null
)
returns table (outcome text, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_c dependency_candidates%rowtype;
  v_group_id bigint;
  v_cause text;
  v_name text;
begin
  if v_org is null then
    return query select 'error'::text, 'No organization in session.'::text;
    return;
  end if;
  if p_decision not in ('confirmed', 'rejected') then
    return query select 'error'::text,
      'Decision must be confirmed or rejected.'::text;
    return;
  end if;

  select * into v_c from dependency_candidates
   where id = p_candidate_id and organization_id = v_org and status = 'open';
  if not found then
    return query select 'error'::text,
      'No open candidate with that id in this organization.'::text;
    return;
  end if;

  update dependency_candidates
     set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_candidate_id;

  if p_decision = 'rejected' then
    return query select 'rejected'::text,
      'Recorded. It will not be proposed again.'::text;
    return;
  end if;

  -- Confirmed with a named supplier: a real dependency edge.
  if v_c.supplier_asset_id is not null then
    insert into asset_dependencies
      (organization_id, dependent_asset_id, supplier_asset_id, dependency_kind,
       evidence, source, confirmed_by, confirmed_at)
    values
      (v_org, v_c.dependent_asset_id, v_c.supplier_asset_id,
       coalesce(p_dependency_kind, v_c.suggested_kind, 'functional'),
       'Confirmed from candidate #' || v_c.id || ': ' || v_c.basis,
       'derived', auth.uid(), now())
    on conflict do nothing;
    return query select 'edge_created'::text,
      'A dependency edge now exists and will be included in cascade analysis.'::text;
    return;
  end if;

  -- Confirmed without a supplier: this is a COMMON CAUSE, not a dependency.
  v_cause := case v_c.suggested_kind
               when 'geographic' then 'shared_location'
               when 'shared_design' then 'shared_design'
               else 'shared_environment' end;
  v_name := coalesce(v_c.group_key, 'Group for candidate #' || v_c.id);

  select id into v_group_id from common_cause_groups
   where organization_id = v_org and name = v_name and cause_kind = v_cause;
  if v_group_id is null then
    insert into common_cause_groups (organization_id, name, cause_kind, description)
    values (v_org, v_name, v_cause,
            'Created by confirming a derived candidate. ' || v_c.basis)
    returning id into v_group_id;
  end if;

  insert into common_cause_members (group_id, asset_id, organization_id)
  values (v_group_id, v_c.dependent_asset_id, v_org)
  on conflict do nothing;

  return query select 'common_cause_member'::text,
    ('Added to common-cause group "' || v_name || '". Any redundancy whose '
     || 'alternatives all sit in this group is now reported as defeated.')::text;
end;
$$;

-- Deliberately NOT granted to authenticated. Nineteen haul trucks sharing one
-- model number is ONE decision, not nineteen, and a queue that asks for it
-- nineteen times will be cleared by clicking rather than by thinking. The
-- grouped function below is the only way in, and it calls this one per member.
revoke all on function review_dependency_candidate(bigint, text, text) from public;

-- The review queue, at the grain a person actually decides at.
drop function if exists get_dependency_candidates(int);
create or replace function get_dependency_candidates(p_limit int default 25)
returns table (
  group_key text,
  suggested_kind text,
  confidence text,
  asset_count bigint,
  example_assets text,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.group_key,
         min(c.suggested_kind),
         min(c.confidence),
         count(*)::bigint,
         string_agg(da.name, ', ' order by da.name) filter (where da.name is not null),
         min(c.basis)
  from dependency_candidates c
  join assets da on da.id = c.dependent_asset_id
  where c.organization_id = app_current_org() and c.status = 'open'
    and c.group_key is not null
  group by c.group_key
  order by count(*) desc, c.group_key
  limit greatest(1, least(p_limit, 200));
$$;

grant execute on function get_dependency_candidates(int) to authenticated;

-- One decision for the whole group.
create or replace function review_dependency_candidate_group(
  p_group_key text,
  p_decision text
)
returns table (outcome text, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_id bigint;
  v_n int := 0;
  v_last text;
begin
  if v_org is null then
    return query select 'error'::text, 'No organization in session.'::text;
    return;
  end if;

  for v_id in
    select id from dependency_candidates
     where organization_id = v_org and status = 'open' and group_key = p_group_key
  loop
    -- Aliased: this function's own OUT parameter is also called `detail`, and
    -- an unqualified reference resolves to the variable, not the column.
    select r.detail into v_last
      from review_dependency_candidate(v_id, p_decision, null) r;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    return query select 'error'::text,
      'No open candidates under that key in this organization.'::text;
    return;
  end if;

  return query select
    (case when p_decision = 'rejected' then 'rejected' else 'applied' end)::text,
    (v_n || ' asset(s) under "' || p_group_key || '" ' ||
     case when p_decision = 'rejected'
          then 'recorded as rejected; they will not be proposed again.'
          else coalesce(v_last, 'processed.') end)::text;
end;
$$;

grant execute on function review_dependency_candidate_group(text, text) to authenticated;

notify pgrst, 'reload schema';
