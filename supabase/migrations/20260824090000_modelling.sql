-- ============================================================================
-- Fault trees and shutdown schedules as first-class data
-- (register C7.10 fault/event trees, C7.13 shutdown critical path,
--  C7.12 maintenance-cost forecasting).
--
-- WHAT IS NOT HERE, AND WHY.
--
-- No reliability-block-diagram table. The block diagram is not a separate model
-- — it IS the dependency graph in `asset_dependencies`, which already records
-- who supplies whom, the redundancy group and how many of that group are
-- required. A second table would be a second version of the same truth, and the
-- two would disagree within a month.
--
-- No Monte Carlo parameter table either. The simulation samples from the
-- Weibull fitted by the validated MLE in src/lib/reliability, off real
-- work-order history. Storing beta and eta would let somebody type a beta in,
-- and a typed-in beta looks exactly like a fitted one once it is in a chart.
--
-- WHAT IS HERE.
--
-- Fault trees and shutdown schedules, because neither can be derived from
-- anything the platform already holds — both are engineering judgements that
-- somebody has to author.
--
-- Canonical reuse: assets, work_orders, app_current_org(), the
-- asset_dependencies graph. Additive.
-- ============================================================================

create table if not exists fault_trees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tree_key text not null,
  title text not null,
  -- The undesired event. Naming it precisely is most of the analysis.
  top_event text not null,
  scope_note text,
  -- Who authored it and against what. A fault tree with no basis is opinion
  -- with boxes drawn round it.
  basis text not null,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organization_id, tree_key)
);

create table if not exists fault_tree_nodes (
  id bigserial primary key,
  tree_id uuid not null references fault_trees(id) on delete cascade,
  node_key text not null,
  label text not null,
  -- Null gate = basic event (a leaf).
  gate text check (gate in ('AND','OR','VOTE')),
  vote_threshold int,
  parent_key text,
  -- Basic events only. NULL is meaningful: it means never assessed, and the
  -- engine refuses to compute a top-event probability when any leaf is null
  -- rather than treating the gap as zero.
  probability numeric,
  probability_basis text,
  -- Optional link to a real asset, so a tree can be traced to the register.
  asset_id uuid references assets(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(tree_id, node_key),
  -- A VOTE gate without a threshold is not a gate.
  constraint vote_needs_threshold
    check (gate is distinct from 'VOTE' or vote_threshold >= 1),
  -- A probability outside [0,1] is a data-entry error, not a rare event.
  constraint probability_is_a_probability
    check (probability is null or (probability >= 0 and probability <= 1))
);

create index if not exists idx_ftn_tree on fault_tree_nodes(tree_id, parent_key);

alter table fault_trees enable row level security;
alter table fault_tree_nodes enable row level security;
drop policy if exists ft_read on fault_trees;
create policy ft_read on fault_trees
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists ftn_read on fault_tree_nodes;
create policy ftn_read on fault_tree_nodes
  for select to authenticated using (
    exists (select 1 from fault_trees t
            where t.id = tree_id and t.organization_id = app_current_org()));

-- ---------------------------------------------------------------------------
-- Shutdown / turnaround schedules.
-- ---------------------------------------------------------------------------
create table if not exists shutdown_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_key text not null,
  title text not null,
  planned_start timestamptz,
  -- What the plan says. Compared against the simulated distribution so the
  -- difference between a target and a forecast is visible.
  planned_duration_hours numeric,
  status text not null default 'planning'
    check (status in ('planning','frozen','executing','complete')),
  created_at timestamptz not null default now(),
  unique(organization_id, event_key)
);

create table if not exists shutdown_tasks (
  id bigserial primary key,
  event_id uuid not null references shutdown_events(id) on delete cascade,
  task_key text not null,
  label text not null,
  duration_hours numeric not null check (duration_hours >= 0),
  -- Optimistic and pessimistic are nullable on purpose: a task with no range
  -- is held fixed in the simulation and reported as understating risk, which
  -- is honest, rather than being given an invented spread.
  optimistic_hours numeric,
  pessimistic_hours numeric,
  asset_id uuid references assets(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(event_id, task_key),
  constraint range_is_ordered
    check (optimistic_hours is null or pessimistic_hours is null
           or pessimistic_hours >= optimistic_hours),
  -- The most likely duration must sit inside the range, or the triangular
  -- sample is undefined.
  constraint mode_within_range
    check (optimistic_hours is null or duration_hours >= optimistic_hours),
  constraint mode_below_pessimistic
    check (pessimistic_hours is null or duration_hours <= pessimistic_hours)
);

create table if not exists shutdown_task_dependencies (
  id bigserial primary key,
  event_id uuid not null references shutdown_events(id) on delete cascade,
  task_key text not null,
  predecessor_key text not null,
  created_at timestamptz not null default now(),
  unique(event_id, task_key, predecessor_key),
  -- Self-dependency is the one cycle cheap enough to reject at write time.
  constraint no_self_dependency check (task_key <> predecessor_key)
);

create index if not exists idx_std_event on shutdown_task_dependencies(event_id, task_key);

alter table shutdown_events enable row level security;
alter table shutdown_tasks enable row level security;
alter table shutdown_task_dependencies enable row level security;
drop policy if exists sde_read on shutdown_events;
create policy sde_read on shutdown_events
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists sdt_read on shutdown_tasks;
create policy sdt_read on shutdown_tasks
  for select to authenticated using (
    exists (select 1 from shutdown_events e
            where e.id = event_id and e.organization_id = app_current_org()));
drop policy if exists sdd_read on shutdown_task_dependencies;
create policy sdd_read on shutdown_task_dependencies
  for select to authenticated using (
    exists (select 1 from shutdown_events e
            where e.id = event_id and e.organization_id = app_current_org()));

-- ---------------------------------------------------------------------------
-- Reads.
-- ---------------------------------------------------------------------------
drop function if exists get_fault_trees();
create or replace function get_fault_trees()
returns table (
  "treeKey" text, title text, "topEvent" text, basis text, reviewed boolean,
  nodes jsonb
)
language sql stable security definer set search_path = public as $$
  select t.tree_key, t.title, t.top_event, t.basis, t.reviewed_at is not null,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.node_key, 'label', n.label, 'gate', n.gate,
        'voteThreshold', n.vote_threshold, 'parent', n.parent_key,
        'probability', n.probability, 'basis', n.probability_basis
      ) order by n.node_key)
      from fault_tree_nodes n where n.tree_id = t.id
    ), '[]'::jsonb)
  from fault_trees t
  where t.organization_id = app_current_org()
  order by t.title;
$$;
grant execute on function get_fault_trees() to authenticated;

drop function if exists get_shutdown_schedules();
create or replace function get_shutdown_schedules()
returns table (
  "eventKey" text, title text, status text,
  "plannedDurationHours" numeric, tasks jsonb
)
language sql stable security definer set search_path = public as $$
  select e.event_key, e.title, e.status, e.planned_duration_hours,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.task_key, 'label', s.label,
        'duration', s.duration_hours,
        'optimistic', s.optimistic_hours,
        'pessimistic', s.pessimistic_hours,
        'predecessors', coalesce((
          select jsonb_agg(d.predecessor_key order by d.predecessor_key)
          from shutdown_task_dependencies d
          where d.event_id = e.id and d.task_key = s.task_key
        ), '[]'::jsonb)
      ) order by s.task_key)
      from shutdown_tasks s where s.event_id = e.id
    ), '[]'::jsonb)
  from shutdown_events e
  where e.organization_id = app_current_org()
  order by e.planned_start nulls last, e.title;
$$;
grant execute on function get_shutdown_schedules() to authenticated;

-- ---------------------------------------------------------------------------
-- Maintenance-cost history for the forecast.
--
-- A FINDING THIS FUNCTION EXISTS TO EXPOSE, NOT TO WORK AROUND.
--
-- No work order in this schema records what it cost. There is no actual_cost,
-- no labour cost, no parts cost — the whole schema's only cost columns are
-- annual estimates on asset_economics and planned figures on contracts. So a
-- maintenance-cost forecast built from work orders is impossible here, and the
-- honest options were to refuse entirely or to derive a named proxy.
--
-- This derives the proxy: downtime hours times the asset's recorded
-- downtime_cost_per_hour_usd, plus expected_repair_cost_usd per corrective
-- event. That is a real, defensible quantity — it is the BUSINESS COST OF
-- DOWNTIME, which is usually the larger number anyway — but it is emphatically
-- not maintenance spend, and every consumer is told so through the `basis`
-- column rather than through a comment nobody reads.
--
-- Assets with no economics row contribute nothing and are counted, so a small
-- number cannot be mistaken for a cheap month when it is really a thin one.
-- ---------------------------------------------------------------------------
drop function if exists get_maintenance_cost_history(int);
create or replace function get_maintenance_cost_history(p_months int default 18)
returns table (
  period text,
  "plannedCost" numeric,
  "unplannedCost" numeric,
  "failureCount" int,
  "eventsCosted" int,
  "eventsWithoutEconomics" int
)
language sql stable security definer set search_path = public as $$
  select to_char(date_trunc('month', w.completed_at), 'YYYY-MM'),
         coalesce(sum(
           coalesce(w.downtime_hours, 0) * e.downtime_cost_per_hour_usd
         ) filter (where w.work_type is distinct from 'corrective'), 0),
         coalesce(sum(
           coalesce(w.downtime_hours, 0) * e.downtime_cost_per_hour_usd
           + coalesce(e.expected_repair_cost_usd, 0)
         ) filter (where w.work_type = 'corrective'), 0),
         count(*) filter (where w.work_type = 'corrective')::int,
         count(*) filter (where e.downtime_cost_per_hour_usd is not null)::int,
         count(*) filter (where e.downtime_cost_per_hour_usd is null)::int
  from work_orders w
  left join asset_economics e on e.asset_id = w.asset_id
  cross join lateral (
    -- Anchored on the END OF THE DATA, not on now(). Every work-order history
    -- in this platform is historical, so a window measured back from today
    -- returns nothing and the forecast reports "insufficient history" when the
    -- real answer is "you asked about the wrong years".
    select max(w2.completed_at) as data_end from work_orders w2
    where w2.organization_id = app_current_org() and w2.completed_at is not null
  ) anchor
  where w.organization_id = app_current_org()
    and w.completed_at is not null
    and w.completed_at >= date_trunc('month', anchor.data_end)
                          - make_interval(months => greatest(p_months, 1))
  group by 1
  order by 1;
$$;
grant execute on function get_maintenance_cost_history(int) to authenticated;

-- What the cost figures actually rest on. Separate from the history so the
-- caveat cannot be dropped by a consumer that only wanted the numbers.
drop function if exists get_cost_capture_posture();
create or replace function get_cost_capture_posture()
returns table (
  "workOrdersClosed" int,
  "workOrdersWithRecordedCost" int,
  "assetsWithEconomics" int,
  "assetsTotal" int,
  basis text
)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from work_orders w
     where w.organization_id = app_current_org() and w.completed_at is not null),
    -- Zero by construction: the column does not exist. Stated as a measured
    -- figure rather than a claim so it stays true if one is ever added.
    0,
    (select count(distinct e.asset_id)::int from asset_economics e
     join assets a on a.id = e.asset_id
     where a.organization_id = app_current_org()
       and e.downtime_cost_per_hour_usd is not null),
    (select count(*)::int from assets a where a.organization_id = app_current_org()),
    'No work order in this system records what it cost — there is no cost field on '
    || 'work_orders to record it in. The figures below are a DERIVED PROXY: downtime '
    || 'hours times the asset''s recorded downtime cost per hour, plus its expected '
    || 'repair cost per corrective event. That is the business cost of the downtime, '
    || 'not maintenance spend, and the two are not interchangeable — a cheap repair on '
    || 'a critical asset costs more here than an expensive one on a spare. Capturing '
    || 'actual labour and parts cost per work order is the fix; until then no forecast '
    || 'from this platform can be reconciled to a maintenance budget.';
$$;
grant execute on function get_cost_capture_posture() to authenticated;

notify pgrst, 'reload schema';
