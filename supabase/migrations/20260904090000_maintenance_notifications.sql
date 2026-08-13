-- ============================================================================
-- The maintenance notification, and the duplicates it arrives in (C2.02, C5.06).
--
-- A notification is the fault report that PRECEDES a work order: an operator
-- sees something, reports it, and planning decides whether it becomes work.
-- The platform has never modelled it. The `notifications` table in
-- 00000000000002_legacy_compat is an application alert — title, message, read —
-- which is a different object entirely, and building on it would have produced
-- a duplicate detector for UI toasts.
--
-- WHY DUPLICATES MATTER ENOUGH TO SHIP WITH THE TABLE.
--
-- The same fault gets reported repeatedly: three shifts see one leaking seal and
-- raise three notifications, and planning turns them into three work orders
-- against one machine. The cost is not the clutter. It is that every reliability
-- number downstream now counts one failure as three — MTBF collapses, the asset
-- ranks as a bad actor it is not, and a Weibull fitted on that history is
-- confidently wrong. This is the same failure the fleet reclassification work
-- (20260822096000) found from the other direction: one machine recorded as two.
--
-- CANDIDATES, NEVER MERGES. Detection proposes; a human disposes. Two reports
-- hours apart on one pump may be one fault reported twice, or a fault that
-- recurred immediately after a bad repair — and those mean opposite things for
-- reliability. Only somebody who knows the asset can say which. C5.06 declares
-- this right as `auto` with the explicit rider that "merging requires
-- confirmation", and that rider is the whole design.
-- ============================================================================

create extension if not exists pg_trgm;

create table if not exists maintenance_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  notification_no text,
  -- What the reporter observed, in their words. Deliberately not a coded field:
  -- coding is a planning act performed later, and forcing a code at report time
  -- is how observations get bent to fit the nearest available category.
  description text not null,
  notification_type text default 'fault'
    check (notification_type in ('fault', 'observation', 'request', 'safety')),
  reported_by text,
  reported_at timestamptz not null default now(),
  status text not null default 'open'
    check (status in ('open', 'in_planning', 'converted', 'rejected', 'merged')),
  -- Set when planning turns this report into work, so the report survives as
  -- the origin of the work order rather than being overwritten by it.
  work_order_id uuid references work_orders(id) on delete set null,
  -- Set only by a human confirming a merge. The surviving notification is the
  -- one this points at; this row is kept, not deleted, because the fact that a
  -- fault was reported three times is itself evidence about detectability.
  merged_into_id uuid references maintenance_notifications(id) on delete set null,
  merged_by uuid references auth.users(id) on delete set null,
  merged_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mnotif_org_asset
  on maintenance_notifications (organization_id, asset_id, reported_at desc);
create index if not exists idx_mnotif_desc_trgm
  on maintenance_notifications using gin (description gin_trgm_ops);
create unique index if not exists uq_mnotif_org_no
  on maintenance_notifications (organization_id, notification_no)
  where notification_no is not null;

alter table maintenance_notifications enable row level security;
drop policy if exists mnotif_read on maintenance_notifications;
create policy mnotif_read on maintenance_notifications
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Duplicate CANDIDATES. Same asset, close in time, similar wording.
--
-- All three conditions are required, and each is doing work. Same asset alone
-- matches every routine report on a busy machine. Similar wording alone matches
-- "bearing noise" across an entire fleet, which is a fleet-wide pattern worth
-- knowing and is not a duplicate. Closeness in time is what separates one fault
-- reported three times from the same fault recurring next quarter — and the
-- recurrence is the more important signal, so it must not be swallowed here.
--
-- PAIRS, NOT CLUSTERS, AND DELIBERATELY SO. Three reports of one fault surface
-- as overlapping pairs rather than one merged group, because clustering would
-- mean treating similarity as transitive: A resembles B and B resembles C, so
-- merge all three. It is not transitive. Across a 0.45 threshold, A and C can
-- sit well below it while both sit above it against B — which is precisely how
-- two genuinely different faults get chained into one through an intermediate
-- report, destroying exactly the history this exists to protect. A reviewer
-- reading two overlapping pairs sees all three reports and keeps the judgement.
-- The alternative hides the weakest link in the chain.
-- ---------------------------------------------------------------------------
drop function if exists get_duplicate_notification_candidates(int, numeric);
create or replace function get_duplicate_notification_candidates(
  p_window_hours int default 72,
  p_min_similarity numeric default 0.45
)
returns table (
  keep_id uuid,
  keep_no text,
  keep_description text,
  duplicate_id uuid,
  duplicate_no text,
  duplicate_description text,
  asset_id uuid,
  hours_apart numeric,
  similarity numeric,
  rationale text
)
language sql stable security definer set search_path = public as $$
  select
    a.id, a.notification_no, a.description,
    b.id, b.notification_no, b.description,
    a.asset_id,
    round(extract(epoch from (b.reported_at - a.reported_at)) / 3600.0, 1),
    round(similarity(a.description, b.description)::numeric, 2),
    format(
      'Same asset, reported %s hours apart, wording %s%% similar. Proposed as a '
      || 'duplicate of the earlier report — confirm before merging: a repeat '
      || 'report shortly after a repair is a recurrence, not a duplicate, and '
      || 'the two mean opposite things for reliability.',
      round(extract(epoch from (b.reported_at - a.reported_at)) / 3600.0, 1),
      round(similarity(a.description, b.description)::numeric * 100))
  from maintenance_notifications a
  join maintenance_notifications b
    on b.organization_id = a.organization_id
   and b.asset_id is not distinct from a.asset_id
   and b.reported_at > a.reported_at
   and b.reported_at <= a.reported_at + make_interval(hours => greatest(p_window_hours, 1))
  where a.organization_id = app_current_org()
    and a.asset_id is not null
    -- Already-resolved reports are not candidates: a merged row has had its
    -- judgement made, and re-proposing it would ask the same question forever.
    and a.status not in ('merged', 'rejected')
    and b.status not in ('merged', 'rejected')
    and similarity(a.description, b.description) >= p_min_similarity
  order by a.asset_id, a.reported_at;
$$;

grant execute on function get_duplicate_notification_candidates(int, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- The right is now enforced by a code path, not merely declared. The matrix
-- comment requires this upgrade before a connector can make the action
-- possible, and detection existing is what makes it possible.
--
-- It stays tier 'auto' because DETECTING is autonomous. Merging is not exposed
-- autonomously at all: there is no function here that writes merged_into_id.
-- ---------------------------------------------------------------------------
update decision_rights
   set enforcement = 'enforced',
       description = 'Detect and propose merges of duplicate notifications; '
         || 'detection is autonomous, merging is a human act and no autonomous '
         || 'path writes it.',
       version = version + 1,
       effective_at = now()
 where right_key = 'detect_duplicate_notifications'
   and enforcement <> 'enforced';

notify pgrst, 'reload schema';
