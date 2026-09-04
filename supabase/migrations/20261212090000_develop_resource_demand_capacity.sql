-- ============================================================================
-- Sync Develop Slice 7C, part 1 — ResourceDemand and ResourceCapacity
-- (register D7.01, spec I.22).
--
-- WHAT WAS ALREADY HERE, AND WHY THIS IS NOT A SECOND CAPACITY STORE.
--
-- `craft_capacity` (20260811130000:37) holds the operator's DELIVERED hours
-- per craft-week with a stated basis, and `capacity_deductions`
-- (20260817090000:396) itemizes what was taken out to reach that figure.
-- `get_craft_capacity_reconciliation` puts the two beside a headcount and
-- says, in words, when they do not reconcile — and that the DECLARED figure
-- is the one the scheduler uses. That is the capacity object. The overlap map
-- ruled EXTEND for this row and the register row says it plainly: "EXTEND
-- craft_capacity family — no second capacity store."
--
-- So capacity is extended IN PLACE, with two columns:
--
--     resource_category   spec I.22's nine categories. Existing rows are
--                         `skilled_trades`, which is a statement about the
--                         rows that exist (craft-week hours) rather than a
--                         preference between categories.
--     effective_to        the END of the window a figure applies to. The
--                         table already had `effective_from`; without a close
--                         it cannot say a crew is gone in Q3, which is the
--                         exact shape of the conflict spec I.22 describes.
--
-- THE DEMAND SIDE IS GENUINELY ABSENT, and that is what this file adds.
-- `restoration_resource_requirements` names a resource an EVENT needs, with
-- no hours and no period; job plans carry hours per STEP with no calendar.
-- Neither is a time-phased demand per project, and nothing anywhere holds
-- demand for eight of the nine categories.
--
-- CAPACITY IS NOT DEDUCTED TWICE. `craft_capacity.weekly_hours` is already
-- net — its own comment says "after leave, training and indirect time" — and
-- `capacity_deductions` records what was taken out to REACH it, not a further
-- reduction. Subtracting deductions again would halve every crew in the
-- product. The predicate below therefore uses the DECLARED figure and carries
-- the deductions as itemized basis, which is exactly what
-- get_craft_capacity_reconciliation has always done.
--
-- REFUSAL, NOT INFERENCE. A category with no recorded capacity is reported
-- `not_assessable` and never as zero hours. That posture is inherited, not
-- invented: `evaluate_schedule_feasibility` has said "Not assessable: no
-- craft capacity is recorded … a fabricated figure would silently authorise
-- an unachievable week" since 2026-08-11, and this file carries the same
-- sentence into eight more categories rather than softening it.
--
-- NON-FINITE NUMBERS ARE REFUSED AT EVERY DOOR. In Postgres
-- `'NaN'::numeric = 'NaN'::numeric` is TRUE and `'NaN'::numeric > 0` is TRUE
-- as well, so the `check (weekly_hours > 0)` that has guarded craft_capacity
-- since 2026-08-11 admits NaN without complaint, and a NaN in a capacity row
-- turns every downstream utilisation figure into NaN. Both existing tables
-- gain a finite check here (a tightening on existing rows, all of which are
-- finite) and the new table ships with one.
--
-- §70. Approving a roster — committing named people's hours to a project
-- window — is a human determination. `resource_demand.approved_by` is walled
-- by the ONE wall Slice 7A installed, `enforce_awp_act_is_human`, bound by
-- TG_ARGV to this column. No copy is made: a second wall is a second UPDATE
-- branch to lose. RECORDING a demand line is deliberately NOT walled, because
-- assembling the evidence is the half §70 leaves to the machine (RULING 22's
-- scoping of the assessor), and a wall that refused the drafting act would be
-- the over-broad §70 Slice 7A had to narrow.
--
-- Canonical reuse: craft_capacity, capacity_deductions, work_packages,
-- development_cases, audit_events, security_events, app_current_org,
-- enforce_awp_act_is_human, record_awp_service_write. One new table, and it
-- holds the thing nothing held.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE FINITE-NUMBER PREDICATE.
--
--    One place, because the three-part spelling is exactly the kind of guard
--    that gets copied with a part missing. `p is not null` is included so a
--    caller can use it as a whole answer rather than remembering that NULL
--    propagates through the comparisons to NULL and a NULL check constraint
--    PASSES.
-- ---------------------------------------------------------------------------
create or replace function public.sync_is_finite_numeric(p_value numeric)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_value is not null
     and p_value <> 'NaN'::numeric
     and p_value > '-Infinity'::numeric
     and p_value < 'Infinity'::numeric;
$$;

revoke all on function public.sync_is_finite_numeric(numeric) from public, anon;
grant execute on function public.sync_is_finite_numeric(numeric)
  to authenticated, service_role;

comment on function public.sync_is_finite_numeric(numeric) is
  'D7.01: TRUE only for a real number. Exists because `check (x > 0)` admits NaN in Postgres — NaN compares GREATER than every other numeric — so every numeric door in slice 7C states finiteness separately rather than relying on a range check to imply it.';

-- ---------------------------------------------------------------------------
-- 2. THE NINE CATEGORIES (spec I.22), ordered once.
--
--    Returns the spec's own ordinal so a screen and a report cannot disagree
--    about the order, and NULL for anything else — the sync_awp_level shape.
-- ---------------------------------------------------------------------------
create or replace function public.sync_resource_category_order(p_category text)
returns int
language sql
immutable
set search_path = public
as $$
  select n from (values
    ('engineering', 1),
    ('project_management', 2),
    ('skilled_trades', 3),
    ('inspectors', 4),
    ('commissioning', 5),
    ('cranes', 6),
    ('specialty_tools', 7),
    ('facilities', 8),
    ('suppliers', 9)
  ) as c(k, n) where k = p_category;
$$;

revoke all on function public.sync_resource_category_order(text) from public, anon;
grant execute on function public.sync_resource_category_order(text)
  to authenticated, service_role;

comment on function public.sync_resource_category_order(text) is
  'D7.01 (spec I.22): the nine resource categories — engineering, PM, skilled trades, inspectors, commissioning, cranes, specialty tools, facilities, suppliers — ordered once. NULL for anything else, so a caller that meant to validate cannot get a silent default.';

-- ---------------------------------------------------------------------------
-- 3. CAPACITY, EXTENDED IN PLACE.
--
--    `skilled_trades` as the default is not a guess about future rows: it is
--    what the existing rows ARE. craft_capacity has held craft-week hours and
--    nothing else since it was created, and the connector import
--    (20261003090000:661) writes exactly that shape with an explicit column
--    list, so it keeps working untouched and its rows land in the category
--    they belong to.
-- ---------------------------------------------------------------------------
alter table public.craft_capacity
  add column if not exists resource_category text not null default 'skilled_trades',
  add column if not exists effective_to date;

alter table public.capacity_deductions
  add column if not exists resource_category text not null default 'skilled_trades',
  add column if not exists effective_to date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'craft_capacity_category_known') then
    alter table public.craft_capacity add constraint craft_capacity_category_known
      check (sync_resource_category_order(resource_category) is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'craft_capacity_window') then
    alter table public.craft_capacity add constraint craft_capacity_window
      check (effective_to is null or effective_to > effective_from);
  end if;
  -- A TIGHTENING on a guard that has always been incomplete, never a
  -- widening: `weekly_hours > 0` admits NaN, and every existing row is finite.
  if not exists (select 1 from pg_constraint where conname = 'craft_capacity_hours_finite') then
    alter table public.craft_capacity add constraint craft_capacity_hours_finite
      check (sync_is_finite_numeric(weekly_hours));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'capacity_deductions_category_known') then
    alter table public.capacity_deductions add constraint capacity_deductions_category_known
      check (sync_resource_category_order(resource_category) is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'capacity_deductions_window') then
    alter table public.capacity_deductions add constraint capacity_deductions_window
      check (effective_to is null or effective_to > effective_from);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'capacity_deductions_hours_finite') then
    alter table public.capacity_deductions add constraint capacity_deductions_hours_finite
      check (sync_is_finite_numeric(weekly_hours));
  end if;
end $$;

create index if not exists idx_craft_capacity_category
  on public.craft_capacity(organization_id, resource_category, craft, effective_from desc);
create index if not exists idx_capacity_deductions_category
  on public.capacity_deductions(organization_id, resource_category, craft, effective_from desc);

comment on column public.craft_capacity.resource_category is
  'D7.01 (spec I.22): which of the nine resource categories this pool belongs to. Defaults to skilled_trades because that is what every pre-existing row IS — craft-week hours — not because trades are the assumed case.';
comment on column public.craft_capacity.effective_to is
  'D7.01: the day this figure stops applying. NULL means open-ended. Without it a capacity row could not say a commissioning team leaves in Q3, which is the collective-impossibility case spec I.22 is written around.';

-- ---------------------------------------------------------------------------
-- 4. THE DEMAND OBJECT. Time-phased, per project, across all nine.
--
--    `work_package_id` is optional and NOT the anchor: demand exists before
--    the work is packaged (an engineering estimate for Q3 is real demand with
--    no IWP behind it), and forcing a package would make the object unusable
--    at exactly the point in a project where the conflict is still cheap to
--    fix. When a package IS named, the wall below checks it belongs to the
--    same case — a demand line pointing at another project's package would
--    double-count that project's hours into this one.
--
--    WITHDRAWAL, NOT DELETION. A demand line that is no longer wanted is
--    withdrawn with a reason and stays legible. Deleting it would make a
--    portfolio conflict disappear with no trace of what removed it, which is
--    the one edit this object exists to make visible.
-- ---------------------------------------------------------------------------
create table if not exists public.resource_demand (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- CASCADE at the constraint, refused at the wall — the work_packages
  -- posture (20261210090000:199). A case teardown stays possible; a demand
  -- line cannot be quietly deleted while its case still exists.
  development_case_id uuid not null references public.development_cases(id) on delete cascade,
  work_package_id bigint references public.work_packages(id) on delete set null,
  resource_category text not null,
  -- The named pool INSIDE the category: a craft for trades, a team name for
  -- commissioning, a unit for cranes. Matched to craft_capacity.craft, which
  -- is why it is the same free text rather than a foreign key — capacity is
  -- imported from the operator's own systems and its pool names are theirs.
  resource_pool text not null check (btrim(resource_pool) <> ''),
  period_start date not null,
  period_end date not null,
  demand_hours numeric not null,
  source_kind text not null check (source_kind in
    ('job_plan', 'estimate', 'vendor_quote', 'manual')),
  basis text not null check (length(btrim(basis)) >= 20),
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approval_note text,
  withdrawn_by uuid references auth.users(id),
  withdrawn_at timestamptz,
  withdrawal_reason text,
  constraint resource_demand_category_known
    check (sync_resource_category_order(resource_category) is not null),
  constraint resource_demand_window
    check (period_end > period_start),
  -- BOTH halves stated. `demand_hours > 0` alone admits NaN and Infinity.
  constraint resource_demand_hours_finite
    check (sync_is_finite_numeric(demand_hours) and demand_hours > 0),
  -- TWO EQUALITIES, NOT A CONJUNCTION (the 6A commitment-line lesson):
  -- `approved_at = now(), approved_by = null` passes a folded check, and the
  -- actor column is exactly what the §70 wall reads.
  constraint resource_demand_approval_actor
    check ((approved_at is null) = (approved_by is null)),
  constraint resource_demand_approval_note
    check ((approved_at is null) = (approval_note is null)),
  constraint resource_demand_approval_said_something
    check (approval_note is null or length(btrim(approval_note)) >= 20),
  constraint resource_demand_withdrawal_actor
    check ((withdrawn_at is null) = (withdrawn_by is null)),
  constraint resource_demand_withdrawal_reason
    check ((withdrawn_at is null) = (withdrawal_reason is null)),
  constraint resource_demand_withdrawal_said_something
    check (withdrawal_reason is null or length(btrim(withdrawal_reason)) >= 20)
);

-- One live line per (case, category, pool, period, package). A second line
-- for the same cell is a double-count, and a double-count is the one arithmetic
-- error a portfolio view cannot survive. Withdrawn lines are excluded so the
-- cell can be re-stated after a withdrawal.
create unique index if not exists uq_resource_demand_cell
  on public.resource_demand(
    organization_id, development_case_id, resource_category, resource_pool,
    period_start, period_end, coalesce(work_package_id, 0))
  where withdrawn_at is null;

create index if not exists idx_resource_demand_case
  on public.resource_demand(organization_id, development_case_id, period_start);
create index if not exists idx_resource_demand_portfolio
  on public.resource_demand(organization_id, resource_category, resource_pool, period_start)
  where withdrawn_at is null;

alter table public.resource_demand enable row level security;
drop policy if exists resource_demand_read on public.resource_demand;
create policy resource_demand_read on public.resource_demand
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: demand is recorded, approved and withdrawn through
-- the definer RPCs below.

revoke truncate on table public.resource_demand from anon, authenticated, service_role;

comment on table public.resource_demand is
  'D7.01 (spec I.22): the ResourceDemand object — how many hours of which pool, in which of the nine categories, over which calendar period, for which project. Time-phased by construction: a demand line without a period cannot be recorded. Its counterpart is craft_capacity, EXTENDED with the same nine categories rather than duplicated (overlap map: no second capacity store).';
comment on column public.resource_demand.approved_by is
  '§70: committing named people''s hours to a project window is a human determination. Walled by enforce_awp_act_is_human — the ONE wall, bound to this column — for every writer, on INSERT and UPDATE. Recording a demand line is NOT walled: assembling the evidence is the half §70 leaves to the machine.';

-- ---------------------------------------------------------------------------
-- 5. THE WALL. Tenancy, the package link, withdrawal integrity, an
--    approval that cannot be rewritten, and a DELETE branch that admits a
--    cascade and refuses a hand.
--
--    Covers INSERT, UPDATE, DELETE and TRUNCATE, because each of the four is
--    a way to change what the portfolio view reports.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_resource_demand_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c development_cases%rowtype;
  p work_packages%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'resource_demand is what makes a portfolio conflict visible before the crew arrives. Truncating it makes every project individually and collectively feasible in one statement. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- Mid-cascade: the organization or the case is going, and the demand
    -- goes with it. The teardown a development case must remain capable of.
    if not exists (select 1 from organizations where id = old.organization_id) then
      return old;
    end if;
    if not exists (select 1 from development_cases where id = old.development_case_id) then
      return old;
    end if;
    if old.approved_at is not null and old.withdrawn_at is null then
      raise exception
        'demand line % was APPROVED on % and has not been withdrawn. Deleting it removes committed hours from every portfolio view with nothing left saying they were ever committed — withdraw it with a reason instead, which keeps the commitment and the retraction both legible.',
        old.id, old.approved_at::date
        using errcode = 'insufficient_privilege';
    end if;
    if auth.uid() is null then
      perform record_awp_service_write(old.organization_id,
        format('Resource demand line %s', old.id), tg_op,
        'A resource demand line was deleted outside the definer RPCs.');
    end if;
    return old;
  end if;

  -- ── Tenancy. The case owns the row's organization, not the caller's claim.
  select * into c from development_cases where id = new.development_case_id;
  if not found or c.organization_id <> new.organization_id then
    raise exception
      'this demand line is stamped with an organization that does not own its development case. A demand line filed under the wrong tenant is hours one organization cannot see and another cannot explain.'
      using errcode = 'check_violation';
  end if;

  if new.work_package_id is not null then
    select * into p from work_packages where id = new.work_package_id;
    if not found
       or p.organization_id <> new.organization_id
       or p.development_case_id <> new.development_case_id then
      raise exception
        'the work package named by this demand line belongs to a different development case or a different organization. Hours attributed across that boundary are counted twice in the portfolio and explained in neither project.'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- AN APPROVAL IS NOT REWRITABLE. Re-pointing it at another person, or
    -- moving its date, changes who is on record as having committed the
    -- hours. Withdraw and re-record instead.
    if old.approved_at is not null
       and (new.approved_at is distinct from old.approved_at
         or new.approved_by is distinct from old.approved_by) then
      raise exception
        'demand line % was approved on % by a named person. That record is not editable: withdraw the line with a reason and record a new one, so both the commitment and its retraction stay legible.',
        old.id, old.approved_at::date
        using errcode = 'insufficient_privilege';
    end if;
    -- THE HOURS AND THE PERIOD ARE WHAT WAS APPROVED. Moving either after an
    -- approval means the approved commitment is not the recorded one, and
    -- every portfolio view would then report hours nobody signed for.
    if old.approved_at is not null
       and (new.demand_hours is distinct from old.demand_hours
         or new.period_start is distinct from old.period_start
         or new.period_end is distinct from old.period_end
         or new.resource_category is distinct from old.resource_category
         or new.resource_pool is distinct from old.resource_pool) then
      raise exception
        'demand line % is approved: its hours, period, category and pool are what a person committed to. Changing them now would leave an approval standing over a commitment nobody made.',
        old.id
        using errcode = 'insufficient_privilege';
    end if;
    -- A WITHDRAWAL IS FINAL in the same way, and for the same reason.
    if old.withdrawn_at is not null
       and (new.withdrawn_at is distinct from old.withdrawn_at
         or new.withdrawn_by is distinct from old.withdrawn_by) then
      raise exception
        'demand line % is already withdrawn. A withdrawal is not reversible by editing it: record a new demand line.',
        old.id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- The admitted service path leaves a trace. Identical posture to
  -- record_awp_service_write's other four callers, which is a bare
  -- `auth.uid() is null`. The first draft ANDed `current_user not in
  -- ('authenticated','anon')` onto it; this function is SECURITY DEFINER, so
  -- `current_user` is the owner and that conjunct is a constant TRUE — the
  -- dead code the brief names, and a clause a later reader would take as
  -- load-bearing. The DELETE branch above never carried it, so the two halves
  -- of one trigger disagreed about whether the guard was needed.
  if auth.uid() is null then
    perform record_awp_service_write(new.organization_id,
      format('Resource demand line for %s/%s', new.resource_category, new.resource_pool),
      tg_op, 'A resource demand line was written outside the definer RPCs.');
  end if;

  return new;
end
$$;

revoke all on function public.enforce_resource_demand_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_resource_demand_integrity on public.resource_demand;
create trigger trg_resource_demand_integrity
  before insert or update or delete on public.resource_demand
  for each row execute function public.enforce_resource_demand_integrity();

drop trigger if exists trg_resource_demand_no_truncate on public.resource_demand;
create trigger trg_resource_demand_no_truncate
  before truncate on public.resource_demand
  for each statement execute function public.enforce_resource_demand_integrity();

-- §70, on the ONE wall Slice 7A installed. No copy is made: a copied wall is
-- an UPDATE branch to lose, and TG_ARGV already carries everything that
-- differs between the columns it guards.
drop trigger if exists trg_resource_demand_approval_human on public.resource_demand;
create trigger trg_resource_demand_approval_human
  before insert or update on public.resource_demand
  for each row execute function public.enforce_awp_act_is_human(
    'approved_by', 'approve a roster — commit named people''s hours to a project window');

-- ---------------------------------------------------------------------------
-- 6. THE CAPACITY PREDICATE. One answer to "how many hours does this pool
--    have between these two dates", used by the balance read, by the
--    portfolio conflict detector and by the weekly feasibility door.
--
--    Revoked from clients: it carries no session org filter and is only ever
--    called from inside a definer that has established the tenant — the
--    sync_field_readiness_elements posture (RULING 22).
-- ---------------------------------------------------------------------------
create or replace function public.sync_resource_capacity_hours(
  p_org uuid,
  p_category text,
  p_pool text,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_weeks numeric;
  v_declared numeric;
  v_basis text;
  v_from date;
  v_effective date;
  v_capacity_id uuid;
  v_deduction numeric;
  v_detail jsonb;
begin
  if p_org is null or p_category is null or p_pool is null then
    return jsonb_build_object('answered', false,
      'refusal', 'a capacity question needs an organization, a category and a pool');
  end if;
  if sync_resource_category_order(p_category) is null then
    return jsonb_build_object('answered', false,
      'refusal', format('"%s" is not one of the nine resource categories', p_category));
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    return jsonb_build_object('answered', false,
      'refusal', 'the window ends on or before it starts. A window of no days holds no capacity and no demand — reporting zero hours for it would read as a shortage.');
  end if;

  v_weeks := round((p_to - p_from)::numeric / 7.0, 3);

  -- The figure in force at the START of the window. `distinct on` takes the
  -- latest row whose effective_from has arrived and whose effective_to has
  -- not — NOT a sum over every row ever recorded, which would add a superseded
  -- figure to the one that superseded it.
  select cc.weekly_hours, cc.basis, cc.effective_from, cc.id
    into v_declared, v_basis, v_effective, v_capacity_id
    from craft_capacity cc
   where cc.organization_id = p_org
     and cc.resource_category = p_category
     and cc.craft = p_pool
     and cc.effective_from <= p_from
     and (cc.effective_to is null or cc.effective_to > p_from)
   order by cc.effective_from desc, cc.id desc
   limit 1;

  if v_declared is null then
    -- THE 2026-08-11 SENTENCE, carried into eight more categories. Capacity
    -- is not inferred from headcount, from a sibling period or from another
    -- pool. A fabricated figure would silently authorise an unachievable
    -- programme, which is worse than saying nothing.
    return jsonb_build_object('answered', false,
      'category', p_category, 'pool', p_pool,
      'from', p_from, 'to', p_to, 'weeks', v_weeks,
      'refusal', format('Not assessable: no capacity is recorded for %s pool "%s" in force on %s. Capacity is deliberately not inferred from headcount, from a neighbouring period or from another pool — a fabricated figure would silently authorise an unachievable programme.',
        p_category, p_pool, p_from));
  end if;

  if not sync_is_finite_numeric(v_declared) or v_declared <= 0 then
    return jsonb_build_object('answered', false,
      'category', p_category, 'pool', p_pool,
      'refusal', format('The recorded capacity for %s pool "%s" is not a usable number of hours. Nothing is computed from it.',
        p_category, p_pool));
  end if;

  -- The deductions BEHIND the declared figure, itemized. They are NOT
  -- subtracted: craft_capacity.weekly_hours is already net of them by its own
  -- definition, and deducting twice would halve every crew in the product.
  select coalesce(sum(cd.weekly_hours), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'kind', cd.deduction_kind, 'weeklyHours', cd.weekly_hours,
           'basis', cd.basis) order by cd.deduction_kind), '[]'::jsonb)
    into v_deduction, v_detail
    from capacity_deductions cd
   where cd.organization_id = p_org
     and cd.resource_category = p_category
     and cd.craft = p_pool
     and cd.effective_from <= p_from
     and (cd.effective_to is null or cd.effective_to > p_from);

  return jsonb_build_object(
    'answered', true,
    'category', p_category,
    'pool', p_pool,
    'from', p_from,
    'to', p_to,
    'weeks', v_weeks,
    'weeklyHours', v_declared,
    'capacityHours', round(v_declared * v_weeks, 1),
    -- WHICH ROW THIS ANSWER CAME FROM, so a screen can offer the close act on
    -- the figure it is actually reading rather than making the reader find it.
    'capacityId', v_capacity_id,
    'effectiveFrom', v_effective,
    'deductionWeeklyHours', v_deduction,
    'deductionsItemised', v_detail,
    'deductionsRecorded', jsonb_array_length(v_detail) > 0,
    'basis', v_basis,
    'note', case when jsonb_array_length(v_detail) = 0
      then 'The declared delivered-hours figure, with no deductions itemized behind it. The number may be right; nothing in the platform can argue with it.'
      else format('The declared delivered-hours figure. %s hours of deductions are itemized behind it and are NOT subtracted again — the declared figure is already net of them, and it is the one the scheduler uses.', v_deduction) end);
end
$$;

-- `service_role` IS IN THIS LIST. Supabase's ALTER DEFAULT PRIVILEGES grants
-- EXECUTE on every new public function to service_role, so a revoke that omits
-- it leaves an org-parameterised internal predicate on the public REST surface
-- while its own comment says it is revoked from clients. Slice 7B closed
-- exactly this gap one migration earlier (20261211090200:479) with the
-- reasoning "a stated invariant that is false is worth less than no statement
-- at all", and the same reasoning applies here.
revoke all on function public.sync_resource_capacity_hours(uuid, text, text, date, date)
  from public, anon, authenticated, service_role;

comment on function public.sync_resource_capacity_hours(uuid, text, text, date, date) is
  'D7.01: THE capacity predicate — how many hours one pool in one of the nine categories has between two dates, from the EXTENDED craft_capacity family. Refuses "not assessable" where no figure is in force rather than inferring one (the 2026-08-11 posture, generalized). Deductions are itemized as basis and never subtracted twice: craft_capacity.weekly_hours is net by definition.';

-- ---------------------------------------------------------------------------
-- 7. THE BALANCE READ. Demand and capacity, time-phased and side by side,
--    for one development case.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_resource_balance(
  p_case_id uuid,
  p_horizon_weeks int default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_today date := current_date;
  v_end date;
  v_lines int;
  v_live int;
  v_in_window int;
  v_cells jsonb := '[]'::jsonb;
  v_over int := 0;
  v_at int := 0;
  v_not_assessable int := 0;
  v_within int := 0;
  v_cat_demand int;
  v_refusals jsonb := '[]'::jsonb;
  r record;
  v_cap jsonb;
  v_state text;
  v_capacity numeric;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  if p_horizon_weeks is null or p_horizon_weeks < 1 or p_horizon_weeks > 260 then
    return jsonb_build_object('answered', false,
      'refusal', 'the horizon must be a whole number of weeks from 1 to 260 — a horizon of zero weeks phases nothing and a negative one phases into the past');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'development case not found');
  end if;
  v_end := v_today + (p_horizon_weeks * 7);

  select count(*), count(*) filter (where withdrawn_at is null)
    into v_lines, v_live
    from resource_demand
   where organization_id = v_org and development_case_id = c.id;

  -- REFUSAL 1: nothing recorded. THIS IS THE ROW. A case with no demand
  -- lines is UNASSESSED, and reporting "0 hours required, no conflict" for it
  -- is the reading spec I.22 exists to prevent.
  if v_lines = 0 then
    return jsonb_build_object('answered', false, 'caseId', c.id,
      'demandLines', 0, 'horizonWeeks', p_horizon_weeks,
      'refusal', format('No resource demand has been recorded against "%s", so there is nothing to phase against capacity. This is NOT "no resources required" and it is NOT a clean portfolio position — it is UNASSESSED, and the two read identically on a screen.', c.title));
  end if;
  if v_live = 0 then
    return jsonb_build_object('answered', false, 'caseId', c.id,
      'demandLines', v_lines, 'liveDemandLines', 0, 'horizonWeeks', p_horizon_weeks,
      'refusal', format('Every one of the %s demand line(s) recorded against "%s" has been withdrawn. A withdrawn programme is not a resourced one, and it is not a conflict-free one either.', v_lines, c.title));
  end if;

  select count(*) into v_in_window
    from resource_demand
   where organization_id = v_org and development_case_id = c.id
     and withdrawn_at is null
     and period_start < v_end and period_end > v_today;

  -- REFUSAL 2: a window nobody has phased work into. Not the same fact as a
  -- window with capacity to spare.
  if v_in_window = 0 then
    return jsonb_build_object('answered', false, 'caseId', c.id,
      'demandLines', v_lines, 'liveDemandLines', v_live,
      'horizonWeeks', p_horizon_weeks, 'horizonEnd', v_end,
      'refusal', format('None of the %s live demand line(s) on "%s" overlaps the next %s week(s). That is a window nobody has phased work into — not a window with capacity to spare.', v_live, c.title, p_horizon_weeks));
  end if;

  -- ── TIME-PHASED INTO DISJOINT SEGMENTS, NOT GROUPED BY EACH LINE'S OWN
  --    WINDOW.
  --
  --    The first draft put the clipped window in the GROUP BY key:
  --
  --        group by d.resource_category, d.resource_pool,
  --                 greatest(d.period_start, v_today), least(d.period_end, v_end)
  --
  --    so two demand lines on the SAME pool with different but OVERLAPPING
  --    periods never summed — each became its own cell, and each cell was then
  --    compared against the FULL capacity of its own window. The same crew
  --    hours were credited to both. One case asking 900 hours over weeks 1-8
  --    and 900 more over weeks 5-12 of a 120 h/week pool read as two
  --    comfortable `within_capacity` cells and an EMPTY refusal list, while
  --    `sync_portfolio_resource_conflicts` — grouping by (category, pool) over
  --    one fixed window — reported the identical rows as 1800 hours against
  --    1440 and said "at least one project exceeds the capacity on its own".
  --    Two views in one slice, opposite verdicts, same data. That is exactly
  --    the failure D7.01's problem statement names: "a project reads as
  --    resourced until the week it is not".
  --
  --    The fix keeps the phasing rather than collapsing it. Every clipped
  --    period boundary on a pool becomes a cut, the cuts form CONSECUTIVE and
  --    DISJOINT segments, and each segment sums every line that overlaps it.
  --    Capacity is then asked for once per segment, so no hour is credited
  --    twice, and the totals reconcile with the portfolio roll-up exactly.
  for r in
    with lines as (
      select d.resource_category, d.resource_pool,
             greatest(d.period_start, v_today) as s,
             least(d.period_end, v_end) as e,
             d.demand_hours, d.period_start as os, d.period_end as oe,
             d.approved_at
        from resource_demand d
       where d.organization_id = v_org and d.development_case_id = c.id
         and d.withdrawn_at is null
         and d.period_start < v_end and d.period_end > v_today
    ),
    cuts as (
      select resource_category, resource_pool, b
        from lines, lateral (values (s), (e)) as v(b)
       group by 1, 2, 3
    ),
    segs as (
      select resource_category, resource_pool, b as w_start,
             lead(b) over (partition by resource_category, resource_pool
                           order by b) as w_end
        from cuts
    )
    select g.resource_category, g.resource_pool, g.w_start, g.w_end,
           sum(l.demand_hours
               -- PRO-RATED to the part of the line inside THIS segment. A
               -- twelve-week line overlapping a four-week segment contributes
               -- four twelfths of its hours to it, not all of them and not
               -- none.
               * (g.w_end - g.w_start)::numeric
               / nullif((l.oe - l.os)::numeric, 0)) as demand,
           count(*) as lines,
           count(*) filter (where l.approved_at is not null) as approved
      from segs g
      join lines l
        on l.resource_category = g.resource_category
       and l.resource_pool = g.resource_pool
       and l.s < g.w_end and l.e > g.w_start
     where g.w_end is not null
     group by g.resource_category, g.resource_pool, g.w_start, g.w_end
     order by sync_resource_category_order(g.resource_category),
              g.resource_pool, g.w_start
  loop
    v_cap := sync_resource_capacity_hours(v_org, r.resource_category,
      r.resource_pool, r.w_start, r.w_end);
    if (v_cap->>'answered')::boolean is true then
      v_capacity := (v_cap->>'capacityHours')::numeric;
      v_state := case
        when r.demand > v_capacity then 'over_committed'
        when v_capacity - r.demand <= 0.1 then 'at_capacity'
        else 'within_capacity' end;
    else
      v_capacity := null;
      v_state := 'not_assessable';
    end if;

    if v_state = 'over_committed' then v_over := v_over + 1;
    elsif v_state = 'at_capacity' then v_at := v_at + 1;
    elsif v_state = 'within_capacity' then v_within := v_within + 1;
    else v_not_assessable := v_not_assessable + 1;
    end if;

    v_cells := v_cells || jsonb_build_array(jsonb_build_object(
      'category', r.resource_category,
      'categoryOrder', sync_resource_category_order(r.resource_category),
      'pool', r.resource_pool,
      'periodStart', r.w_start,
      'periodEnd', r.w_end,
      'demandHours', round(r.demand, 1),
      'demandLines', r.lines,
      'approvedLines', r.approved,
      'capacityHours', case when v_capacity is null then null else round(v_capacity, 1) end,
      'weeklyHours', v_cap->'weeklyHours',
      'capacityId', v_cap->>'capacityId',
      'capacityEffectiveFrom', v_cap->>'effectiveFrom',
      'capacityBasis', v_cap->>'basis',
      'deductionsItemised', coalesce(v_cap->'deductionsItemised', '[]'::jsonb),
      'state', v_state,
      'shortfallHours', case when v_capacity is null then null
        else round(greatest(0, r.demand - v_capacity), 1) end,
      'detail', case v_state
        when 'not_assessable' then v_cap->>'refusal'
        when 'over_committed' then format('%s hours of demand against %s hours of recorded capacity — short by %s.',
          round(r.demand, 1), round(v_capacity, 1), round(r.demand - v_capacity, 1))
        when 'at_capacity' then format('%s hours of demand against %s hours of recorded capacity. Fully committed: there is no room for the first thing that goes wrong.',
          round(r.demand, 1), round(v_capacity, 1))
        else format('%s hours of demand against %s hours of recorded capacity.',
          round(r.demand, 1), round(v_capacity, 1)) end));
  end loop;

  if v_not_assessable > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s demand cell(s) have no recorded capacity for their pool, so they are NOT ASSESSABLE. They are not counted as conflicts and they are not counted as clear.', v_not_assessable),
      'scope', 'capacity'));
  end if;

  select count(distinct resource_category) into v_cat_demand
    from resource_demand
   where organization_id = v_org and development_case_id = c.id
     and withdrawn_at is null
     and period_start < v_end and period_end > v_today;

  return jsonb_build_object(
    'answered', true,
    'caseId', c.id,
    'caseTitle', c.title,
    'asOf', v_today,
    'horizonWeeks', p_horizon_weeks,
    'horizonEnd', v_end,
    'demandLines', v_lines,
    'liveDemandLines', v_live,
    'linesInWindow', v_in_window,
    'categoriesWithDemand', v_cat_demand,
    'categoriesInSpec', 9,
    'cells', v_cells,
    'overCommitted', v_over,
    'atCapacity', v_at,
    'withinCapacity', v_within,
    'notAssessable', v_not_assessable,
    'refusals', v_refusals,
    'basis', 'This project''s recorded demand, pro-rated into the horizon and set beside the capacity in force for each pool. Nine categories (spec I.22); a category with no recorded capacity is reported NOT ASSESSABLE rather than as a shortfall or as clear. This is the PROJECT view — the collective position across projects is get_portfolio_resource_conflicts.');
end
$$;

revoke all on function public.get_case_resource_balance(uuid, int) from public, anon;
grant execute on function public.get_case_resource_balance(uuid, int) to authenticated;

comment on function public.get_case_resource_balance(uuid, int) is
  'D7.01 (spec I.22): one project''s ResourceDemand set beside ResourceCapacity, time-phased across a caller-stated horizon and covering all nine categories. Refuses over a case with no demand recorded (UNASSESSED is not "no resources required"), over an entirely withdrawn set, and over a horizon nobody has phased work into. A pool with no recorded capacity is NOT ASSESSABLE, never zero.';

-- ---------------------------------------------------------------------------
-- 8. THE WRITE PATHS.
-- ---------------------------------------------------------------------------
create or replace function public.record_resource_capacity(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_category text := btrim(coalesce(p_payload->>'category', ''));
  v_pool text := btrim(coalesce(p_payload->>'pool', ''));
  v_basis text := btrim(coalesce(p_payload->>'basis', ''));
  v_hours numeric;
  v_from date;
  v_to date;
  v_site uuid := sync_text_as_uuid(p_payload->>'siteId');
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'planner', 'supervisor') then
    return jsonb_build_object('answered', false,
      'refusal', 'recording a capacity figure requires a planning, supervisory or governance role');
  end if;
  if sync_resource_category_order(v_category) is null then
    return jsonb_build_object('answered', false,
      'refusal', format('"%s" is not one of the nine resource categories (spec I.22)', v_category));
  end if;
  if v_pool = '' then
    return jsonb_build_object('answered', false,
      'refusal', 'a capacity figure belongs to a NAMED pool — the craft, team or unit whose hours these are');
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object('answered', false,
      'refusal', 'a capacity figure needs its basis stated in at least 20 characters. A number with no basis cannot be argued with, only believed.');
  end if;
  begin
    v_hours := (p_payload->>'weeklyHours')::numeric;
  exception when others then
    v_hours := null;
  end;
  if not sync_is_finite_numeric(v_hours) or v_hours <= 0 then
    return jsonb_build_object('answered', false,
      'refusal', 'weekly hours must be a finite number greater than zero. NaN and infinity are refused here rather than at the screen, because `hours > 0` admits both in Postgres.');
  end if;
  v_from := coalesce((p_payload->>'effectiveFrom')::date, current_date);
  v_to := nullif(p_payload->>'effectiveTo', '')::date;
  if v_to is not null and v_to <= v_from then
    return jsonb_build_object('answered', false,
      'refusal', 'the capacity window ends on or before it starts');
  end if;
  -- THE SITE IS RESOLVED INSIDE THE TENANT, and the demand path four hundred
  -- lines up already says why. `site_id references sites(id) on delete
  -- cascade` carries no organization correlation, so a pasted or stale site id
  -- from another tenant was accepted here: it also sidestepped the
  -- unique(organization_id, site_id, craft, effective_from) collision refusal,
  -- and when the OTHER tenant tidied up their sites this tenant's recorded
  -- capacity vanished through the cascade with no deletion anyone could audit
  -- — silently changing the portfolio verdict and the weekly labour gate.
  if v_site is not null
     and not exists (select 1 from sites
                      where id = v_site and organization_id = v_org) then
    return jsonb_build_object('answered', false,
      'refusal', 'that site does not belong to this organization. A capacity figure filed against another tenant''s site is hours this organization cannot explain and another can delete.');
  end if;

  insert into craft_capacity
    (organization_id, site_id, craft, weekly_hours, basis, effective_from,
     effective_to, resource_category, register_ref)
  values
    (v_org, v_site, v_pool, v_hours, v_basis, v_from, v_to, v_category, 'D7.01')
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'resource_capacity',
    coalesce(v_role, 'system'),
    jsonb_build_object('capacityId', v_id, 'category', v_category, 'pool', v_pool),
    null,
    jsonb_build_object('category', v_category, 'pool', v_pool,
      'weeklyHours', v_hours, 'effectiveFrom', v_from, 'effectiveTo', v_to,
      'basis', v_basis));

  return jsonb_build_object('answered', true, 'capacityId', v_id,
    'category', v_category, 'pool', v_pool, 'weeklyHours', v_hours,
    'effectiveFrom', v_from, 'effectiveTo', v_to,
    'note', 'Recorded on the ONE capacity store. Deductions itemized against the same category and pool explain this figure; they are not subtracted from it.');
exception when unique_violation then
  -- craft_capacity has carried unique(organization_id, site_id, craft,
  -- effective_from) since 2026-08-11 and that constraint is left exactly as
  -- it was. Restating the collision is honest; widening the key to admit the
  -- write would be the guard-widening this programme refuses.
  return jsonb_build_object('answered', false,
    'refusal', format('A capacity figure already exists for pool "%s" at that site effective %s. Supersede it with `close_resource_capacity` — close the standing figure with an effective-to date, then record the new one from that day — so the history says what was believed when and the two are never summed together.',
      v_pool, v_from));
end
$$;

revoke all on function public.record_resource_capacity(jsonb) from public, anon;
grant execute on function public.record_resource_capacity(jsonb) to authenticated;

comment on function public.record_resource_capacity(jsonb) is
  'D7.01: the customer write path onto the EXTENDED craft_capacity family — nine categories, an optional close date, a mandatory basis and a finite-number guard the original `weekly_hours > 0` check could not provide. No second capacity store.';

create or replace function public.record_capacity_deduction(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_category text := btrim(coalesce(p_payload->>'category', ''));
  v_pool text := btrim(coalesce(p_payload->>'pool', ''));
  v_kind text := btrim(coalesce(p_payload->>'deductionKind', ''));
  v_basis text := btrim(coalesce(p_payload->>'basis', ''));
  v_hours numeric;
  v_from date;
  v_to date;
  v_site uuid := sync_text_as_uuid(p_payload->>'siteId');
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'planner', 'supervisor') then
    return jsonb_build_object('answered', false,
      'refusal', 'recording a capacity deduction requires a planning, supervisory or governance role');
  end if;
  if sync_resource_category_order(v_category) is null then
    return jsonb_build_object('answered', false,
      'refusal', format('"%s" is not one of the nine resource categories (spec I.22)', v_category));
  end if;
  if v_kind not in ('leave', 'training', 'sickness', 'indirect_time', 'travel',
                    'toolbox_and_permits', 'standby', 'vacancy') then
    return jsonb_build_object('answered', false,
      'refusal', format('"%s" is not a recorded deduction kind', v_kind));
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object('answered', false,
      'refusal', 'a deduction needs its basis stated in at least 20 characters');
  end if;
  begin
    v_hours := (p_payload->>'weeklyHours')::numeric;
  exception when others then
    v_hours := null;
  end;
  if not sync_is_finite_numeric(v_hours) or v_hours < 0 then
    return jsonb_build_object('answered', false,
      'refusal', 'deduction hours must be a finite number of zero or more');
  end if;
  v_from := coalesce((p_payload->>'effectiveFrom')::date, current_date);
  v_to := nullif(p_payload->>'effectiveTo', '')::date;
  -- THE SAME WINDOW GUARD ITS SIBLING HAS. Without it the
  -- `capacity_deductions_window` CHECK fired as an unhandled exception out of
  -- a definer, and PostgREST returned the failing row verbatim — including
  -- organization_id and site_id — to the client. A refusal sentence is both
  -- safer and more use to the person who typed the dates.
  if v_to is not null and v_to <= v_from then
    return jsonb_build_object('answered', false,
      'refusal', 'the deduction window ends on or before it starts');
  end if;
  if v_site is not null
     and not exists (select 1 from sites
                      where id = v_site and organization_id = v_org) then
    return jsonb_build_object('answered', false,
      'refusal', 'that site does not belong to this organization. A deduction filed against another tenant''s site explains a figure this organization cannot see.');
  end if;

  insert into capacity_deductions
    (organization_id, site_id, craft, deduction_kind, weekly_hours, basis,
     effective_from, effective_to, resource_category)
  values
    (v_org, v_site, v_pool, v_kind, v_hours,
     v_basis, v_from, v_to, v_category)
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'capacity_deduction', coalesce(v_role, 'system'),
    jsonb_build_object('deductionId', v_id, 'category', v_category, 'pool', v_pool),
    null,
    jsonb_build_object('category', v_category, 'pool', v_pool,
      'deductionKind', v_kind, 'weeklyHours', v_hours, 'basis', v_basis));

  return jsonb_build_object('answered', true, 'deductionId', v_id,
    'note', 'Recorded as EXPLANATION of the declared figure, not as a further reduction of it. The declared delivered-hours figure is already net of these and is the one the scheduler uses.');
end
$$;

revoke all on function public.record_capacity_deduction(jsonb) from public, anon;
grant execute on function public.record_capacity_deduction(jsonb) to authenticated;

create or replace function public.record_resource_demand(
  p_case_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_category text := btrim(coalesce(p_payload->>'category', ''));
  v_pool text := btrim(coalesce(p_payload->>'pool', ''));
  v_basis text := btrim(coalesce(p_payload->>'basis', ''));
  v_source text := coalesce(nullif(btrim(p_payload->>'sourceKind'), ''), 'manual');
  v_hours numeric;
  v_start date;
  v_end date;
  v_package bigint;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer',
      'planner', 'supervisor', 'ai_admin') then
    return jsonb_build_object('answered', false,
      'refusal', 'recording resource demand requires a planning, engineering, supervisory or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'development case not found');
  end if;
  if sync_resource_category_order(v_category) is null then
    return jsonb_build_object('answered', false,
      'refusal', format('"%s" is not one of the nine resource categories (spec I.22)', v_category));
  end if;
  if v_pool = '' then
    return jsonb_build_object('answered', false,
      'refusal', 'demand belongs to a NAMED pool — the craft, team or unit whose hours are being asked for');
  end if;
  if v_source not in ('job_plan', 'estimate', 'vendor_quote', 'manual') then
    return jsonb_build_object('answered', false,
      'refusal', format('"%s" is not a recorded demand source', v_source));
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object('answered', false,
      'refusal', 'a demand line needs its basis stated in at least 20 characters — where the hours came from is the difference between a forecast and a wish');
  end if;
  begin
    v_hours := (p_payload->>'demandHours')::numeric;
  exception when others then
    v_hours := null;
  end;
  if not sync_is_finite_numeric(v_hours) or v_hours <= 0 then
    return jsonb_build_object('answered', false,
      'refusal', 'demand hours must be a finite number greater than zero. NaN and infinity are refused by name: in Postgres NaN compares GREATER than every other numeric, so a range check alone admits it.');
  end if;
  begin
    v_start := (p_payload->>'periodStart')::date;
    v_end := (p_payload->>'periodEnd')::date;
  exception when others then
    v_start := null; v_end := null;
  end;
  if v_start is null or v_end is null then
    return jsonb_build_object('answered', false,
      'refusal', 'a demand line is TIME-PHASED by definition: it needs a period start and a period end. Demand with no calendar cannot conflict with anything, which is how six individually feasible projects become collectively impossible unnoticed.');
  end if;
  if v_end <= v_start then
    return jsonb_build_object('answered', false,
      'refusal', 'the demand period ends on or before it starts');
  end if;
  v_package := nullif(p_payload->>'workPackageId', '')::bigint;

  insert into resource_demand
    (organization_id, development_case_id, work_package_id, resource_category,
     resource_pool, period_start, period_end, demand_hours, source_kind, basis,
     recorded_by)
  values
    (v_org, c.id, v_package, v_category, v_pool, v_start, v_end, v_hours,
     v_source, v_basis, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'resource_demand', coalesce(v_role, 'system'),
    jsonb_build_object('demandId', v_id, 'caseId', c.id,
      'category', v_category, 'pool', v_pool),
    null,
    jsonb_build_object('category', v_category, 'pool', v_pool,
      'periodStart', v_start, 'periodEnd', v_end, 'demandHours', v_hours,
      'sourceKind', v_source, 'approved', false));

  return jsonb_build_object('answered', true, 'demandId', v_id,
    'category', v_category, 'pool', v_pool,
    'periodStart', v_start, 'periodEnd', v_end, 'demandHours', v_hours,
    'approved', false,
    'note', 'Recorded, not approved. A demand line counts in this project''s balance immediately; the PORTFOLIO conflict view counts APPROVED lines, because committing people''s hours across projects is a §70 human act.');
exception when unique_violation then
  return jsonb_build_object('answered', false,
    'refusal', format('A live demand line already exists for %s pool "%s" over that exact period on this case. A second line for the same cell is a double-count, and a double-count is the one arithmetic error a portfolio view cannot survive — withdraw the existing line first.',
      v_category, v_pool));
end
$$;

revoke all on function public.record_resource_demand(uuid, jsonb) from public, anon;
grant execute on function public.record_resource_demand(uuid, jsonb) to authenticated;

comment on function public.record_resource_demand(uuid, jsonb) is
  'D7.01 (spec I.22): records one time-phased demand line for a project. ADMITS ai_admin — drafting demand from a job plan is evidence assembly, which §70 leaves to the machine (RULING 22''s scoping). Approving it is the human act and lives at approve_resource_demand.';

create or replace function public.approve_resource_demand(
  p_demand_id bigint,
  p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  d resource_demand%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'planner', 'supervisor') then
    return jsonb_build_object('answered', false,
      'refusal', 'approving a roster commitment requires a planning, supervisory or governance role');
  end if;
  select * into d from resource_demand where id = p_demand_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'demand line not found');
  end if;
  if d.withdrawn_at is not null then
    return jsonb_build_object('answered', false,
      'refusal', format('Demand line %s was withdrawn on %s. A withdrawn commitment is not approved into existence again — record a new line.',
        d.id, d.withdrawn_at::date));
  end if;
  if d.approved_at is not null then
    return jsonb_build_object('answered', false,
      'refusal', format('Demand line %s was already approved on %s.', d.id, d.approved_at::date));
  end if;
  if length(v_note) < 20 then
    return jsonb_build_object('answered', false,
      'refusal', 'an approval states what is being committed, in at least 20 characters. A signature with no sentence beside it records that somebody clicked, not what they decided.');
  end if;

  update resource_demand
     set approved_by = auth.uid(), approved_at = now(), approval_note = v_note
   where id = d.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'resource_demand', coalesce(v_role, 'system'),
    jsonb_build_object('demandId', d.id, 'caseId', d.development_case_id,
      'act', 'approve'),
    jsonb_build_object('approved', false, 'demandHours', d.demand_hours,
      'periodStart', d.period_start, 'periodEnd', d.period_end),
    jsonb_build_object('approved', true, 'demandHours', d.demand_hours,
      'periodStart', d.period_start, 'periodEnd', d.period_end,
      'approvalNote', v_note));

  return jsonb_build_object('answered', true, 'demandId', d.id, 'approved', true,
    'note', 'These hours now count in the PORTFOLIO conflict view. §70: the AI-operator identity cannot reach this act — the database refuses it at the wall, not at this check.');
end
$$;

revoke all on function public.approve_resource_demand(bigint, text) from public, anon;
grant execute on function public.approve_resource_demand(bigint, text) to authenticated;

comment on function public.approve_resource_demand(bigint, text) is
  'D7.01 / §70: approving a roster — committing named people''s hours to a project window — is a human determination. The AI-operator identity is refused at the DATABASE by enforce_awp_act_is_human bound to resource_demand.approved_by, so the refusal survives every path into the table, not only this one.';

create or replace function public.withdraw_resource_demand(
  p_demand_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  d resource_demand%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'planner', 'supervisor') then
    return jsonb_build_object('answered', false,
      'refusal', 'withdrawing a demand line requires a planning, supervisory or governance role');
  end if;
  select * into d from resource_demand where id = p_demand_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'demand line not found');
  end if;
  if d.withdrawn_at is not null then
    return jsonb_build_object('answered', false,
      'refusal', format('Demand line %s is already withdrawn.', d.id));
  end if;
  if length(v_reason) < 20 then
    return jsonb_build_object('answered', false,
      'refusal', 'a withdrawal states why, in at least 20 characters. Hours that vanish without a reason are hours somebody will re-plan against next quarter.');
  end if;

  update resource_demand
     set withdrawn_by = auth.uid(), withdrawn_at = now(), withdrawal_reason = v_reason
   where id = d.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'resource_demand', coalesce(v_role, 'system'),
    jsonb_build_object('demandId', d.id, 'caseId', d.development_case_id,
      'act', 'withdraw'),
    jsonb_build_object('withdrawn', false, 'approved', d.approved_at is not null,
      'demandHours', d.demand_hours),
    jsonb_build_object('withdrawn', true, 'reason', v_reason,
      'demandHours', d.demand_hours));

  return jsonb_build_object('answered', true, 'demandId', d.id, 'withdrawn', true,
    'note', 'Withdrawn, not deleted. The line stays legible so a later reader can see what was committed and what removed it.');
end
$$;

revoke all on function public.withdraw_resource_demand(bigint, text) from public, anon;
grant execute on function public.withdraw_resource_demand(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. THE DEMAND LIST, so a screen can show what it is about to phase.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_resource_demand(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_rows jsonb;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'development case not found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'demandId', d.id,
           'category', d.resource_category,
           'categoryOrder', sync_resource_category_order(d.resource_category),
           'pool', d.resource_pool,
           'periodStart', d.period_start,
           'periodEnd', d.period_end,
           'demandHours', d.demand_hours,
           'sourceKind', d.source_kind,
           'basis', d.basis,
           'workPackageId', d.work_package_id,
           'packageCode', p.package_code,
           'approved', d.approved_at is not null,
           'approvedAt', d.approved_at,
           'approvalNote', d.approval_note,
           'withdrawn', d.withdrawn_at is not null,
           'withdrawnAt', d.withdrawn_at,
           'withdrawalReason', d.withdrawal_reason)
           order by sync_resource_category_order(d.resource_category),
                    d.resource_pool, d.period_start), '[]'::jsonb)
    into v_rows
    from resource_demand d
    left join work_packages p on p.id = d.work_package_id
   where d.organization_id = v_org and d.development_case_id = c.id;

  return jsonb_build_object('answered', true, 'caseId', c.id, 'demand', v_rows,
    'basis', 'Every demand line recorded against this case, withdrawn ones included and marked as such.');
end
$$;

revoke all on function public.get_case_resource_demand(uuid) from public, anon;
grant execute on function public.get_case_resource_demand(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. THE SUPERSEDE HALF — the act `record_resource_capacity`'s own refusal
--     instructs, and which the first draft did not ship.
--
--     The collision refusal reads: "Supersede it by closing it with an
--     effective-to date and recording the new figure from the following day,
--     so the history says what was believed when." `effective_to` was settable
--     only at INSERT. There was no update path in the repository, no UPDATE
--     policy and no trigger on the table, so the instruction was unactionable
--     and the ONLY reachable flow was a second open-ended row beside the
--     first — which is precisely what the ONE capacity predicate calls "adding
--     a superseded figure to the one that superseded it".
--
--     A refusal that instructs an act the product cannot perform is a lie
--     about the product. This is that act.
--
--     IT ONLY EVER CLOSES. A capacity figure's hours, basis and start are what
--     somebody recorded and are not editable here: this sets the day the figure
--     stops applying, refuses to move a close that already exists, and refuses
--     a close that would land on or before the figure's own start.
-- ---------------------------------------------------------------------------
create or replace function public.close_resource_capacity(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_id uuid := sync_text_as_uuid(p_payload->>'capacityId');
  v_to date;
  cc craft_capacity%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'planner', 'supervisor') then
    return jsonb_build_object('answered', false,
      'refusal', 'closing a capacity figure requires a planning, supervisory or governance role');
  end if;
  if v_id is null then
    return jsonb_build_object('answered', false,
      'refusal', 'a capacity figure to close must be named by its id');
  end if;
  select * into cc from craft_capacity where id = v_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'capacity figure not found');
  end if;
  begin
    v_to := nullif(btrim(coalesce(p_payload->>'effectiveTo', '')), '')::date;
  exception when others then
    v_to := null;
  end;
  if v_to is null then
    return jsonb_build_object('answered', false,
      'refusal', 'a close needs the date the figure stops applying. Without one the row stays open-ended and the next figure is added to it rather than replacing it.');
  end if;
  if cc.effective_to is not null then
    return jsonb_build_object('answered', false,
      'refusal', format('That capacity figure was already closed on %s. A close is not moved by editing it — the history has to say what was believed when.', cc.effective_to));
  end if;
  if v_to <= cc.effective_from then
    return jsonb_build_object('answered', false,
      'refusal', format('The close date must be after the figure''s own start of %s. A window that ends on or before it starts holds no hours at all, and the CHECK on this table refuses it.', cc.effective_from));
  end if;

  update craft_capacity set effective_to = v_to
   where id = cc.id and organization_id = v_org;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'resource_capacity', coalesce(v_role, 'system'),
    jsonb_build_object('capacityId', cc.id, 'act', 'close',
      'category', cc.resource_category, 'pool', cc.craft),
    jsonb_build_object('category', cc.resource_category, 'pool', cc.craft,
      'weeklyHours', cc.weekly_hours, 'effectiveFrom', cc.effective_from,
      'effectiveTo', null),
    jsonb_build_object('category', cc.resource_category, 'pool', cc.craft,
      'weeklyHours', cc.weekly_hours, 'effectiveFrom', cc.effective_from,
      'effectiveTo', v_to));

  return jsonb_build_object('answered', true, 'capacityId', cc.id,
    'category', cc.resource_category, 'pool', cc.craft,
    'effectiveFrom', cc.effective_from, 'effectiveTo', v_to,
    'note', format('Closed on %s. The ONE capacity predicate stops counting these hours from that day, and a figure recorded from %s onward supersedes rather than adds to it.',
      v_to, v_to));
end
$$;

revoke all on function public.close_resource_capacity(jsonb) from public, anon;
grant execute on function public.close_resource_capacity(jsonb) to authenticated;

comment on function public.close_resource_capacity(jsonb) is
  'D7.01: the supersede act `record_resource_capacity`''s collision refusal instructs — closing a capacity figure with an effective-to date so the next figure replaces it instead of being summed beside it. Closes only: hours, basis and start are what somebody recorded and are not editable here, and a close that already exists is not moved.';

-- ---------------------------------------------------------------------------
-- 11. THE EXISTING WRITER'S VALIDATOR, MIRRORED TO THE TIGHTENING ABOVE.
--
--     `craft_capacity_hours_finite` is a TIGHTENING and it stays. But a
--     tightening at the TABLE that the existing RPC's own validator does not
--     mirror is the over-block class Slice 7A had to narrow: the guard is
--     right and the caller finds out about it in the worst possible way.
--
--     `ingest_recovery_activation_batch` is the connector import path, and it
--     validates each row with `recovery_activation_validate_row`, staging the
--     rejects with a reason and letting the rest land. Its craft_capacity
--     branch tested `if v_num<=0 then raise exception 'invalid'`. In Postgres
--     `'NaN'::numeric <= 0` is FALSE and `'NaN'::numeric > 0` is TRUE, so NaN
--     passed validation, hit the new CHECK, and — because the entity inserts
--     carry no per-row exception handler — the `check_violation` escaped the
--     whole function. PROVEN: a two-row batch with one `weekly_hours: "-5"`
--     returned {read:2, accepted:1, rejected:1} and the good row landed; the
--     same batch with `"NaN"` returned HTTP 400 23514, ZERO rows landed, and
--     the run counters stayed at read=0 accepted=0 rejected=0. It also leaked
--     the failing row — organization_id, site_id, basis — to the client
--     through PostgREST's `details`.
--
--     So the validator is redefined here with the finiteness test mirrored in,
--     and NOTHING else changed. `developSlice7cMigration.test.ts` diffs this
--     definition against the 20261003090000 original and asserts the ONLY
--     difference is that guard and its refusal sentence, so the copy cannot
--     drift into a second validator.
-- ---------------------------------------------------------------------------
create or replace function public.recovery_activation_validate_row(
  p_org uuid,p_source text,p_entity_type text,p_row jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_ext text:=nullif(trim(coalesce(p_row->>'external_id','')),'');
  v_site uuid; v_asset uuid; v_material uuid;
  v_num numeric; v_num2 numeric; v_start timestamptz; v_end timestamptz; v_date date;
begin
  if p_org is null or p_org is distinct from public.app_current_org() then
    return jsonb_build_object('ok',false,'reason','row tenant does not match the active tenant');
  end if;
  if jsonb_typeof(p_row)<>'object' then return jsonb_build_object('ok',false,'reason','row must be a JSON object'); end if;
  if exists(select 1 from jsonb_each(p_row) item where jsonb_typeof(item.value) in ('array','object')) then
    return jsonb_build_object('ok',false,'reason','canonical row values must be scalar');
  end if;
  if exists(select 1 from jsonb_object_keys(p_row) field
    where not (field=any(public.recovery_activation_allowed_fields(p_entity_type)))) then
    return jsonb_build_object('ok',false,'reason','row contains a field outside the approved canonical entity contract');
  end if;
  if v_ext is null then return jsonb_build_object('ok',false,'reason','missing external_id: replay-safe source identity is required'); end if;
  if length(v_ext)>200 then return jsonb_build_object('ok',false,'reason','external_id exceeds 200 characters'); end if;

  if p_entity_type='site' then
    if coalesce(length(trim(p_row->>'name')),0)<2 then return jsonb_build_object('ok',false,'reason','site name is required'); end if;
    if exists(select 1 from public.sites where organization_id=p_org and name=trim(p_row->>'name')
      and (source_system is distinct from p_source or external_id is distinct from v_ext)) then
      return jsonb_build_object('ok',false,'reason','site name already exists under another identity; bind it deliberately before import');
    end if;

  elsif p_entity_type='asset' then
    if coalesce(length(trim(p_row->>'name')),0)<2 then return jsonb_build_object('ok',false,'reason','asset name is required'); end if;
    select id into v_site from public.sites where organization_id=p_org and source_system=p_source
      and external_id=nullif(trim(p_row->>'site_external_id'),'');
    if v_site is null then return jsonb_build_object('ok',false,'reason','unknown site_external_id: sites must be loaded first'); end if;
    if nullif(p_row->>'criticality','') is not null and p_row->>'criticality' not in ('critical','high','medium','low') then
      return jsonb_build_object('ok',false,'reason','criticality must be mapped to critical, high, medium or low');
    end if;
    if exists(select 1 from public.assets where organization_id=p_org
      and (name=trim(p_row->>'name') or (nullif(p_row->>'tag','') is not null and tag=p_row->>'tag'))
      and (source_system is distinct from p_source or external_id is distinct from v_ext)) then
      return jsonb_build_object('ok',false,'reason','asset name/tag already exists under another identity; bind it deliberately before import');
    end if;
    return jsonb_build_object('ok',true,'external_id',v_ext,'site_id',v_site);

  elsif p_entity_type='work_order' then
    if coalesce(length(trim(p_row->>'title')),0)<3 then return jsonb_build_object('ok',false,'reason','work-order title is required'); end if;
    select id into v_asset from public.assets where organization_id=p_org and source_system=p_source
      and external_id=nullif(trim(p_row->>'asset_external_id'),'');
    if v_asset is null then return jsonb_build_object('ok',false,'reason','unknown asset_external_id: assets must be loaded first'); end if;
    if nullif(p_row->>'priority','') is not null and p_row->>'priority' not in ('critical','high','medium','low') then
      return jsonb_build_object('ok',false,'reason','priority must be mapped to critical, high, medium or low');
    end if;
    if nullif(p_row->>'status','') is not null and p_row->>'status' not in
      ('pending','open','approval','scheduled','in_progress','blocked','critical','completed','closed','cancelled') then
      return jsonb_build_object('ok',false,'reason','work-order status is not in the governed vocabulary');
    end if;
    begin
      if nullif(p_row->>'planned_hours','') is not null then v_num:=(p_row->>'planned_hours')::numeric; if v_num<=0 then raise exception 'invalid'; end if; end if;
      if nullif(p_row->>'downtime_hours','') is not null then v_num2:=(p_row->>'downtime_hours')::numeric; if v_num2<0 then raise exception 'invalid'; end if; end if;
      if nullif(p_row->>'created_at','') is not null then v_start:=(p_row->>'created_at')::timestamptz; end if;
      if nullif(p_row->>'completed_at','') is not null then v_end:=(p_row->>'completed_at')::timestamptz; end if;
    exception when others then return jsonb_build_object('ok',false,'reason','work-order hours or timestamps are invalid'); end;
    if p_row->>'status' in ('completed','closed') and v_end is null then
      return jsonb_build_object('ok',false,'reason','completed/closed work requires completed_at evidence');
    end if;
    return jsonb_build_object('ok',true,'external_id',v_ext,'asset_id',v_asset);

  elsif p_entity_type='material' then
    if coalesce(length(trim(p_row->>'material_code')),0)<1 or coalesce(length(trim(p_row->>'description')),0)<2 or
       coalesce(length(trim(p_row->>'unit_of_measure')),0)<1 then
      return jsonb_build_object('ok',false,'reason','material code, description and unit of measure are required');
    end if;
    if coalesce(length(trim(p_row->>'basis')),0)<10 then return jsonb_build_object('ok',false,'reason','material catalogue evidence basis is required'); end if;
    if nullif(p_row->>'criticality','') is not null and p_row->>'criticality' not in ('critical','essential','routine') then
      return jsonb_build_object('ok',false,'reason','material criticality must be critical, essential or routine');
    end if;
    begin
      if nullif(p_row->>'unit_cost_usd','') is not null and (p_row->>'unit_cost_usd')::numeric<0 then raise exception 'invalid'; end if;
      if nullif(p_row->>'lead_time_days','') is not null and (p_row->>'lead_time_days')::int<0 then raise exception 'invalid'; end if;
    exception when others then return jsonb_build_object('ok',false,'reason','material cost or lead time is invalid'); end;
    if exists(select 1 from public.materials where organization_id=p_org and material_code=trim(p_row->>'material_code')
      and (source_system is distinct from p_source or external_id is distinct from v_ext)) then
      return jsonb_build_object('ok',false,'reason','material code already exists under another identity; bind it deliberately before import');
    end if;

  elsif p_entity_type='material_stock' then
    select id into v_material from public.materials where organization_id=p_org and source_system=p_source
      and external_id=nullif(trim(p_row->>'material_external_id'),'');
    select id into v_site from public.sites where organization_id=p_org and source_system=p_source
      and external_id=nullif(trim(p_row->>'site_external_id'),'');
    if v_material is null then return jsonb_build_object('ok',false,'reason','unknown material_external_id: materials must be loaded first'); end if;
    if v_site is null then return jsonb_build_object('ok',false,'reason','unknown site_external_id: sites must be loaded first'); end if;
    if exists(select 1 from public.material_stock where organization_id=p_org
      and source_system=p_source and external_id=v_ext
      and (material_id is distinct from v_material or site_id is distinct from v_site)) then
      return jsonb_build_object('ok',false,'reason','stock external_id is already bound to another material/site position');
    end if;
    if exists(select 1 from public.material_stock where organization_id=p_org
      and material_id=v_material and site_id is not distinct from v_site
      and (source_system is distinct from p_source or external_id is distinct from v_ext)) then
      return jsonb_build_object('ok',false,'reason','material/site stock already exists under another identity; bind it deliberately before import');
    end if;
    begin
      v_num:=(p_row->>'qty_on_hand')::numeric;
      v_num2:=coalesce(nullif(p_row->>'qty_reserved','')::numeric,0);
      if v_num<0 or v_num2<0 or coalesce(nullif(p_row->>'qty_on_order','')::numeric,0)<0 then raise exception 'invalid'; end if;
      if nullif(p_row->>'last_counted_at','') is not null then v_start:=(p_row->>'last_counted_at')::timestamptz; end if;
    exception when others then return jsonb_build_object('ok',false,'reason','stock quantities must be non-negative numbers and count time must parse'); end;
    return jsonb_build_object('ok',true,'external_id',v_ext,'material_id',v_material,'site_id',v_site);

  elsif p_entity_type='craft_capacity' then
    select id into v_site from public.sites where organization_id=p_org and source_system=p_source
      and external_id=nullif(trim(p_row->>'site_external_id'),'');
    if v_site is null then return jsonb_build_object('ok',false,'reason','unknown site_external_id: sites must be loaded first'); end if;
    if coalesce(length(trim(p_row->>'craft')),0)<2 or coalesce(length(trim(p_row->>'basis')),0)<10 then
      return jsonb_build_object('ok',false,'reason','craft and a substantive operator capacity basis are required');
    end if;
    begin
      v_num:=(p_row->>'weekly_hours')::numeric; v_date:=(p_row->>'effective_from')::date;
      -- MIRRORS THE TABLE. `craft_capacity_hours_finite` (slice 7C) rejects a
      -- non-finite weekly_hours at the CHECK, and `'NaN'::numeric <= 0` is
      -- FALSE in Postgres, so `v_num<=0` alone admitted NaN through this
      -- validator and the check_violation then escaped
      -- ingest_recovery_activation_batch — which has no per-row handler around
      -- the entity inserts — aborting a whole batch on one bad cell. Rejecting
      -- the row HERE stages it with a reason and lets the other rows land.
      if not public.sync_is_finite_numeric(v_num) or v_num<=0 then raise exception 'invalid'; end if;
    exception when others then return jsonb_build_object('ok',false,'reason','weekly_hours must be a finite number greater than zero and effective_from must be a date'); end;
    if exists(select 1 from public.craft_capacity where organization_id=p_org and site_id=v_site
      and craft=trim(p_row->>'craft') and effective_from=v_date
      and (source_system is distinct from p_source or external_id is distinct from v_ext)) then
      return jsonb_build_object('ok',false,'reason','craft capacity already exists under another identity for this site/date');
    end if;
    return jsonb_build_object('ok',true,'external_id',v_ext,'site_id',v_site);

  elsif p_entity_type='operating_state' then
    select id into v_asset from public.assets where organization_id=p_org and source_system=p_source
      and external_id=nullif(trim(p_row->>'asset_external_id'),'');
    if v_asset is null then return jsonb_build_object('ok',false,'reason','unknown asset_external_id: assets must be loaded first'); end if;
    if p_row->>'state' not in ('running','idle','standby','down_planned','down_unplanned','offline') then
      return jsonb_build_object('ok',false,'reason','operating state is not in the governed vocabulary');
    end if;
    begin
      v_start:=(p_row->>'started_at')::timestamptz;
      if nullif(p_row->>'ended_at','') is not null then v_end:=(p_row->>'ended_at')::timestamptz; if v_end<=v_start then raise exception 'invalid'; end if; end if;
      if nullif(p_row->>'load_pct','') is not null then v_num:=(p_row->>'load_pct')::numeric; if v_num<0 or v_num>200 then raise exception 'invalid'; end if; end if;
    exception when others then return jsonb_build_object('ok',false,'reason','operating-state timestamps/load are invalid'); end;
    if exists(select 1 from public.operating_states where organization_id=p_org and source_system=p_source and external_id=v_ext) then
      return jsonb_build_object('ok',true,'external_id',v_ext,'duplicate',true,'asset_id',v_asset);
    end if;
    return jsonb_build_object('ok',true,'external_id',v_ext,'asset_id',v_asset);

  elsif p_entity_type='production_record' then
    if nullif(trim(p_row->>'asset_external_id'),'') is not null then
      select id into v_asset from public.assets where organization_id=p_org and source_system=p_source and external_id=trim(p_row->>'asset_external_id');
      if v_asset is null then return jsonb_build_object('ok',false,'reason','unknown asset_external_id'); end if;
    end if;
    if nullif(trim(p_row->>'site_external_id'),'') is not null then
      select id into v_site from public.sites where organization_id=p_org and source_system=p_source and external_id=trim(p_row->>'site_external_id');
      if v_site is null then return jsonb_build_object('ok',false,'reason','unknown site_external_id'); end if;
    end if;
    if v_asset is null and v_site is null then return jsonb_build_object('ok',false,'reason','production must map to a known asset or site'); end if;
    if coalesce(length(trim(p_row->>'unit_of_measure')),0)<1 then return jsonb_build_object('ok',false,'reason','production unit of measure is required'); end if;
    begin
      v_start:=(p_row->>'period_start')::timestamptz; v_end:=(p_row->>'period_end')::timestamptz;
      v_num:=(p_row->>'units_produced')::numeric;
      if v_end<=v_start or v_num<0 then raise exception 'invalid'; end if;
    exception when others then return jsonb_build_object('ok',false,'reason','production period/quantity is invalid'); end;
    if exists(select 1 from public.production_records where organization_id=p_org and source_system=p_source and external_id=v_ext) then
      return jsonb_strip_nulls(jsonb_build_object('ok',true,'external_id',v_ext,'duplicate',true,'asset_id',v_asset,'site_id',v_site));
    end if;
    return jsonb_strip_nulls(jsonb_build_object('ok',true,'external_id',v_ext,'asset_id',v_asset,'site_id',v_site));
  else
    return jsonb_build_object('ok',false,'reason','unsupported entity type');
  end if;
  return jsonb_build_object('ok',true,'external_id',v_ext);
end $$;

revoke all on function public.recovery_activation_validate_row(uuid,text,text,jsonb) from public,anon,authenticated;

create or replace function public.preview_recovery_activation_batch(
  p_connector_key text,p_entity_type text,p_rows jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype; v_row jsonb; v_result jsonb;
  v_read int:=0; v_ok int:=0; v_dup int:=0; v_rejected int:=0; v_results jsonb:='[]'::jsonb;
begin
  if v_org is null or not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','activation preview authority denied');
  end if;
  if jsonb_typeof(p_rows)<>'array' then return jsonb_build_object('error','rows must be a JSON array'); end if;
  if jsonb_array_length(p_rows)>500 then return jsonb_build_object('error','dry-run batches are limited to 500 rows'); end if;
  select * into v_connector from public.connectors where organization_id=v_org
    and connector_key=trim(p_connector_key) and connector_type='recovery_activation';
  if not found then return jsonb_build_object('error','Recovery activation source not found'); end if;
  select * into v_mapping from public.connector_entity_mappings where organization_id=v_org
    and connector_id=v_connector.id and entity_type=p_entity_type;
  if not found then return jsonb_build_object('error','save the entity mapping before dry-run validation'); end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_read:=v_read+1;
    v_result:=public.recovery_activation_validate_row(v_org,v_connector.connector_key,p_entity_type,v_row);
    if coalesce((v_result->>'ok')::boolean,false) then
      if coalesce((v_result->>'duplicate')::boolean,false) then v_dup:=v_dup+1; else v_ok:=v_ok+1; end if;
    else v_rejected:=v_rejected+1; end if;
    if v_read<=100 then v_results:=v_results||jsonb_build_array(v_result||jsonb_build_object('row_number',v_read)); end if;
  end loop;
  return jsonb_build_object('dry_run',true,'read',v_read,'accepted',v_ok,'duplicate',v_dup,
    'rejected',v_rejected,'results',v_results,
    'note','A dry run never writes canonical or staging rows. Fix every rejected identity/value before commit.');
end $$;

create or replace function public.begin_recovery_activation_run(
  p_connector_key text,p_entity_type text,p_run_type text default 'manual'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype; v_run uuid; v_from timestamptz;
begin
  if v_org is null or not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','activation import authority denied');
  end if;
  if p_run_type not in ('manual','sync') then return jsonb_build_object('error','run type must be manual or sync'); end if;
  select * into v_connector from public.connectors where organization_id=v_org
    and connector_key=trim(p_connector_key) and connector_type='recovery_activation';
  if not found or not v_connector.enabled then return jsonb_build_object('error','active Recovery activation source not found'); end if;
  if v_connector.direction<>'read_only' or v_connector.write_enabled then return jsonb_build_object('error','Recovery activation refuses a write-enabled source'); end if;
  select * into v_mapping from public.connector_entity_mappings where organization_id=v_org
    and connector_id=v_connector.id and entity_type=p_entity_type and status='approved';
  if not found then return jsonb_build_object('error','an administrator must approve the entity mapping before import'); end if;
  select last_position into v_from from public.ingest_watermarks where connector_id=v_connector.id and entity_type=p_entity_type;
  insert into public.connector_runs(organization_id,connector_id,entity_type,run_type,status,started_at,watermark_from,triggered_by)
  values(v_org,v_connector.id,p_entity_type,p_run_type,'running',now(),v_from,auth.uid()) returning id into v_run;
  return jsonb_build_object('ok',true,'run_id',v_run,'watermark_from',v_from);
end $$;

create or replace function public.ingest_recovery_activation_batch(p_run_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_run public.connector_runs%rowtype; v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype; v_row jsonb; v_result jsonb; v_ext text;
  v_site uuid; v_asset uuid; v_material uuid;
  v_read int:=0; v_ok int:=0; v_dup int:=0; v_rejected int:=0; v_max_ts timestamptz;
begin
  if v_org is null or not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','activation ingestion authority denied');
  end if;
  if jsonb_typeof(p_rows)<>'array' then return jsonb_build_object('error','rows must be a JSON array'); end if;
  if jsonb_array_length(p_rows)>500 then return jsonb_build_object('error','commit batches are limited to 500 rows'); end if;
  select * into v_run from public.connector_runs where id=p_run_id and organization_id=v_org and status='running';
  if not found then return jsonb_build_object('error','running connector run not found'); end if;
  select * into v_connector from public.connectors where id=v_run.connector_id and organization_id=v_org
    and connector_type='recovery_activation' and enabled and direction='read_only' and not write_enabled;
  if not found then return jsonb_build_object('error','active read-only Recovery activation source not found'); end if;
  select * into v_mapping from public.connector_entity_mappings where organization_id=v_org
    and connector_id=v_connector.id and entity_type=v_run.entity_type and status='approved';
  if not found then return jsonb_build_object('error','approved mapping not found for this run'); end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_read:=v_read+1; v_ext:=nullif(trim(v_row->>'external_id'),'');
    v_result:=public.recovery_activation_validate_row(v_org,v_connector.connector_key,v_run.entity_type,v_row);
    if not coalesce((v_result->>'ok')::boolean,false) then
      v_rejected:=v_rejected+1;
      insert into public.ingest_staging(organization_id,connector_id,run_id,entity_type,external_id,payload,status,reject_reason)
      values(v_org,v_connector.id,p_run_id,v_run.entity_type,v_ext,v_row,'rejected',v_result->>'reason');
      continue;
    end if;
    if coalesce((v_result->>'duplicate')::boolean,false) then
      v_dup:=v_dup+1;
      insert into public.ingest_staging(organization_id,connector_id,run_id,entity_type,external_id,payload,status)
      values(v_org,v_connector.id,p_run_id,v_run.entity_type,v_ext,v_row,'duplicate');
      continue;
    end if;

    if v_run.entity_type='site' then
      insert into public.sites(organization_id,name,code,location,source_system,external_id)
      values(v_org,trim(v_row->>'name'),nullif(trim(v_row->>'code'),''),nullif(trim(v_row->>'location'),''),v_connector.connector_key,v_ext)
      on conflict(organization_id,source_system,external_id) where external_id is not null do update
      set name=excluded.name,code=excluded.code,location=excluded.location;

    elsif v_run.entity_type='asset' then
      v_site:=(v_result->>'site_id')::uuid;
      insert into public.assets(organization_id,site_id,tag,name,asset_class,criticality,status,area,system,manufacturer,model,serial_number,source_system,external_id)
      values(v_org,v_site,nullif(trim(v_row->>'tag'),''),trim(v_row->>'name'),nullif(trim(v_row->>'asset_class'),''),
        nullif(v_row->>'criticality',''),nullif(v_row->>'status',''),
        nullif(trim(v_row->>'area'),''),nullif(trim(v_row->>'system'),''),nullif(trim(v_row->>'manufacturer'),''),
        nullif(trim(v_row->>'model'),''),nullif(trim(v_row->>'serial_number'),''),v_connector.connector_key,v_ext)
      on conflict(organization_id,source_system,external_id) where external_id is not null do update set
        site_id=excluded.site_id,tag=excluded.tag,name=excluded.name,asset_class=excluded.asset_class,
        criticality=excluded.criticality,status=excluded.status,area=excluded.area,system=excluded.system,
        manufacturer=excluded.manufacturer,model=excluded.model,serial_number=excluded.serial_number;

    elsif v_run.entity_type='work_order' then
      v_asset:=(v_result->>'asset_id')::uuid;
      insert into public.work_orders(organization_id,asset_id,wo_number,title,status,priority,work_type,planned_hours,
        created_at,completed_at,actual_failure_mode,downtime_hours,source_system,external_id)
      values(v_org,v_asset,coalesce(nullif(trim(v_row->>'wo_number'),''),v_ext),trim(v_row->>'title'),
        nullif(v_row->>'status',''),nullif(v_row->>'priority',''),
        nullif(v_row->>'work_type',''),nullif(v_row->>'planned_hours','')::numeric,
        coalesce(nullif(v_row->>'created_at','')::timestamptz,now()),nullif(v_row->>'completed_at','')::timestamptz,
        nullif(trim(v_row->>'failure_mode'),''),nullif(v_row->>'downtime_hours','')::numeric,v_connector.connector_key,v_ext)
      on conflict(organization_id,source_system,external_id) where external_id is not null do update set
        asset_id=excluded.asset_id,wo_number=excluded.wo_number,title=excluded.title,status=excluded.status,
        priority=excluded.priority,work_type=excluded.work_type,planned_hours=excluded.planned_hours,
        completed_at=excluded.completed_at,actual_failure_mode=excluded.actual_failure_mode,
        downtime_hours=excluded.downtime_hours,updated_at=now();

    elsif v_run.entity_type='material' then
      insert into public.materials(organization_id,material_code,description,category,unit_of_measure,unit_cost_usd,
        lead_time_days,criticality,is_template,basis,source_system,external_id)
      values(v_org,trim(v_row->>'material_code'),trim(v_row->>'description'),nullif(trim(v_row->>'category'),''),
        trim(v_row->>'unit_of_measure'),nullif(v_row->>'unit_cost_usd','')::numeric,nullif(v_row->>'lead_time_days','')::int,
        nullif(v_row->>'criticality',''),false,trim(v_row->>'basis'),v_connector.connector_key,v_ext)
      on conflict(organization_id,source_system,external_id) where external_id is not null do update set
        material_code=excluded.material_code,description=excluded.description,category=excluded.category,
        unit_of_measure=excluded.unit_of_measure,unit_cost_usd=excluded.unit_cost_usd,
        lead_time_days=excluded.lead_time_days,criticality=excluded.criticality,basis=excluded.basis;

    elsif v_run.entity_type='material_stock' then
      v_material:=(v_result->>'material_id')::uuid; v_site:=(v_result->>'site_id')::uuid;
      insert into public.material_stock(organization_id,material_id,site_id,qty_on_hand,qty_reserved,qty_on_order,last_counted_at,source_system,external_id)
      values(v_org,v_material,v_site,(v_row->>'qty_on_hand')::numeric,coalesce(nullif(v_row->>'qty_reserved','')::numeric,0),
        coalesce(nullif(v_row->>'qty_on_order','')::numeric,0),nullif(v_row->>'last_counted_at','')::timestamptz,
        v_connector.connector_key,v_ext)
      on conflict(material_id,site_id) do update set qty_on_hand=excluded.qty_on_hand,qty_reserved=excluded.qty_reserved,
        qty_on_order=excluded.qty_on_order,last_counted_at=excluded.last_counted_at,source_system=excluded.source_system,
        external_id=excluded.external_id,updated_at=now();

    elsif v_run.entity_type='craft_capacity' then
      v_site:=(v_result->>'site_id')::uuid;
      insert into public.craft_capacity(organization_id,site_id,craft,weekly_hours,basis,effective_from,source_system,external_id)
      values(v_org,v_site,trim(v_row->>'craft'),(v_row->>'weekly_hours')::numeric,trim(v_row->>'basis'),
        (v_row->>'effective_from')::date,v_connector.connector_key,v_ext)
      on conflict(organization_id,source_system,external_id) where external_id is not null do update set
        site_id=excluded.site_id,craft=excluded.craft,weekly_hours=excluded.weekly_hours,basis=excluded.basis,
        effective_from=excluded.effective_from;

    elsif v_run.entity_type='operating_state' then
      v_asset:=(v_result->>'asset_id')::uuid;
      insert into public.operating_states(organization_id,asset_id,state,load_pct,started_at,ended_at,reason_code,source_system,external_id)
      values(v_org,v_asset,v_row->>'state',nullif(v_row->>'load_pct','')::numeric,(v_row->>'started_at')::timestamptz,
        nullif(v_row->>'ended_at','')::timestamptz,nullif(trim(v_row->>'reason_code'),''),v_connector.connector_key,v_ext);
      v_max_ts:=greatest(coalesce(v_max_ts,(v_row->>'started_at')::timestamptz),(v_row->>'started_at')::timestamptz);

    elsif v_run.entity_type='production_record' then
      v_asset:=nullif(v_result->>'asset_id','')::uuid; v_site:=nullif(v_result->>'site_id','')::uuid;
      insert into public.production_records(organization_id,asset_id,site_id,period_start,period_end,units_produced,unit_of_measure,source_system,external_id)
      values(v_org,v_asset,v_site,(v_row->>'period_start')::timestamptz,(v_row->>'period_end')::timestamptz,
        (v_row->>'units_produced')::numeric,trim(v_row->>'unit_of_measure'),v_connector.connector_key,v_ext);
      v_max_ts:=greatest(coalesce(v_max_ts,(v_row->>'period_end')::timestamptz),(v_row->>'period_end')::timestamptz);
    end if;

    v_ok:=v_ok+1;
    insert into public.ingest_staging(organization_id,connector_id,run_id,entity_type,external_id,payload,status)
    values(v_org,v_connector.id,p_run_id,v_run.entity_type,v_ext,v_row,'accepted');
  end loop;

  update public.connector_runs set records_read=records_read+v_read,records_accepted=records_accepted+v_ok,
    records_rejected=records_rejected+v_rejected,records_duplicate=records_duplicate+v_dup,
    watermark_to=greatest(coalesce(watermark_to,v_max_ts),v_max_ts) where id=p_run_id;
  return jsonb_build_object('read',v_read,'accepted',v_ok,'duplicate',v_dup,'rejected',v_rejected);
end $$;

create or replace function public.get_recovery_activation_rejects(p_run_id uuid,p_limit int default 100)
returns table(row_number bigint,external_id text,reject_reason text,payload jsonb)
language sql stable security definer set search_path=public as $$
  select row_number() over(order by s.received_at,s.id),s.external_id,s.reject_reason,s.payload
  from public.ingest_staging s join public.connector_runs r on r.id=s.run_id and r.organization_id=s.organization_id
  join public.connectors c on c.id=r.connector_id and c.organization_id=r.organization_id
  where s.organization_id=public.app_current_org() and s.run_id=p_run_id and s.status='rejected'
    and c.connector_type='recovery_activation'
  order by s.received_at,s.id limit greatest(least(p_limit,500),1)
$$;

notify pgrst, 'reload schema';
