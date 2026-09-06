-- Sync Develop — D7.07 residual close + D7.16 honesty (2026-09-06).
--
-- WHAT THIS FILE IS FOR. Slice 7A shipped the forward burn-down
-- (`get_package_constraint_burndown` / `compute_package_constraint_burndown`)
-- and left D7.07 🟡 on two named residuals:
--
--   1. `run_recovery_escalation_clock` "has no scheduled caller"
--   2. `restoration_blockers` is still restoration-event-only
--
-- Residual (1) was already stale when 7A wrote it. 20261001090000 scheduled
-- `syncai-recovery-escalation-clock` on pg_cron every five minutes. The
-- reachability gate counts a pg_cron schedule as a caller. Repeating the
-- claim made the composition look more incomplete than the Recovery closeout
-- already was.
--
-- Residual (2) is the real remaining gap, and it is about the WRONG store.
-- D7.07's burn-down reads `restoration_constraints` (RULING 20 / RULING 21).
-- `restoration_blockers` is Recovery's operational-blocker queue; it is
-- event-anchored on purpose and this slice is not entitled to turn it into a
-- second package-constraint store. The clock that was supposed to be the
-- burn-down's escalation half only walked that event-only table, so a lapsed
-- package constraint produced a burn-down bucket and never an alert.
--
-- THE FIX IS ONE CLOCK, NOT A SECOND ONE. `run_recovery_escalation_clock` is
-- redefined to keep the restoration_blockers loop (byte-identical predicate
-- and the same `system_alerts` insert) and to ADD a second loop over open
-- package-anchored `restoration_constraints` whose required-by or expected
-- clear date is already behind today. Same 60-minute re-escalation, same
-- `system_alerts` store, same pg_cron job. No parallel queue, no burn-down
-- table, no second schedule.
--
-- D7.16's composed payload carries the list of parts still open. Dropping
-- D7.07 from that list is the honesty move: a composition is not more
-- complete than its parts, and this part is now wired. D7.06 (release door
-- does not require a field-readiness assessment) and D7.12 (crew / access /
-- work-order predecessors remain unverifiable) stay named.
--
-- Canonical reuse: restoration_constraints, system_alerts, the existing
-- pg_cron job name. No new table.

-- ---------------------------------------------------------------------------
-- 1. Escalation trail on the ONE constraint store.
-- ---------------------------------------------------------------------------
alter table public.restoration_constraints
  add column if not exists escalated_at timestamptz;
alter table public.restoration_constraints
  add column if not exists escalation_level int not null default 0;

comment on column public.restoration_constraints.escalated_at is
  'D7.07: last time run_recovery_escalation_clock raised this still-open package constraint. Null means the clock has not fired on it. The clock does not clear the constraint.';
comment on column public.restoration_constraints.escalation_level is
  'D7.07: how many times the scheduled clock has raised this still-open package constraint. Incremented only by run_recovery_escalation_clock; never a customer write.';

-- ---------------------------------------------------------------------------
-- 2. THE ONE CLOCK, now walking package constraints as well as event blockers.
--    The restoration_blockers half is the 20261001090000 loop restated, not
--    redesigned: same due-at predicate, same 60-minute re-fire, same
--    system_alerts row shape, same alert_type.
-- ---------------------------------------------------------------------------
create or replace function public.run_recovery_escalation_clock()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  c record;
  v_blockers int := 0;
  v_constraints int := 0;
begin
  -- Recovery operational blockers (20261001090000). Event-anchored on
  -- purpose. Untouched predicate.
  for b in
    select rb.*, e.event_code, e.site_id
      from restoration_blockers rb
      join restoration_events e on e.id = rb.event_id
     where rb.status = 'open'
       and rb.escalation_due_at is not null
       and rb.escalation_due_at <= now()
       and (rb.escalated_at is null or rb.escalated_at <= now() - interval '60 minutes')
  loop
    update restoration_blockers
       set escalated_at = now(),
           escalation_level = escalation_level + 1
     where id = b.id;
    insert into system_alerts (
      organization_id, severity, title, description, alert_type, target_users
    ) values (
      b.organization_id,
      case when b.severity in ('critical', 'high') then b.severity else 'warning' end,
      'Recovery escalation — ' || b.event_code,
      'blocker_id=' || b.id::text || ' | owner=' || b.owner_role || ' | ' || b.description
        || case
             when b.forecast_rts_impact_hours is not null
               then ' | forecast RTS impact ' || b.forecast_rts_impact_hours || ' h'
             else ''
           end,
      'recovery_escalation',
      array[b.owner_role]
    );
    v_blockers := v_blockers + 1;
  end loop;

  -- D7.07: lapsed / overdue package constraints on the ONE constraint store.
  -- A still-open row whose required-by or expected-clear date is already
  -- behind today is the burn-down's LAPSED / overdue fact; the clock raises
  -- it rather than clearing it. Event-anchored constraints stay with the
  -- blocker loop above — this loop is package-anchored only.
  for c in
    select rc.id, rc.organization_id, rc.is_hard, rc.description,
           rc.owner_role, rc.required_by, rc.expected_clear_date,
           wp.package_code
      from restoration_constraints rc
      join work_packages wp on wp.id = rc.work_package_id
     where rc.work_package_id is not null
       and rc.state in ('unknown', 'blocked')
       and (
         (rc.required_by is not null and rc.required_by < current_date)
         or (rc.expected_clear_date is not null and rc.expected_clear_date < current_date)
       )
       and (rc.escalated_at is null or rc.escalated_at <= now() - interval '60 minutes')
  loop
    update restoration_constraints
       set escalated_at = now(),
           escalation_level = escalation_level + 1
     where id = c.id;
    insert into system_alerts (
      organization_id, severity, title, description, alert_type, target_users
    ) values (
      c.organization_id,
      case when c.is_hard then 'warning' else 'info' end,
      'Package constraint escalation — ' || c.package_code,
      'constraint_id=' || c.id::text
        || ' | package=' || c.package_code
        || ' | owner=' || coalesce(c.owner_role, 'unassigned')
        || ' | ' || c.description
        || case
             when c.expected_clear_date is not null and c.expected_clear_date < current_date
               then ' | expected_clear_date lapsed ' || c.expected_clear_date::text
             else ''
           end
        || case
             when c.required_by is not null and c.required_by < current_date
               then ' | required_by overdue ' || c.required_by::text
             else ''
           end,
      'package_constraint_escalation',
      case when c.owner_role is not null then array[c.owner_role] else '{}'::text[] end
    );
    v_constraints := v_constraints + 1;
  end loop;

  return jsonb_build_object(
    'escalated', v_blockers + v_constraints,
    'blockersEscalated', v_blockers,
    'packageConstraintsEscalated', v_constraints,
    'ran_at', now()
  );
end
$$;

revoke all on function public.run_recovery_escalation_clock()
  from public, anon, authenticated;
grant execute on function public.run_recovery_escalation_clock() to service_role;

comment on function public.run_recovery_escalation_clock() is
  'THE ONE escalation clock. Recovery half: open restoration_blockers past escalation_due_at. Develop D7.07 half: open package-anchored restoration_constraints whose required-by or expected-clear date is already behind today. Both write system_alerts; neither clears the underlying row. Scheduled as syncai-recovery-escalation-clock (pg_cron */5). Service-role only.';

-- Re-assert the schedule that 20261001090000 already installed. A later
-- environment without the job (or with pg_cron added after that migration)
-- must not be able to recreate the "no scheduled caller" residual.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
      from cron.job
     where jobname = 'syncai-recovery-escalation-clock';
    perform cron.schedule(
      'syncai-recovery-escalation-clock',
      '*/5 * * * *',
      'select public.run_recovery_escalation_clock()'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. D7.16 composition list — D7.07 is no longer an open part.
--    Body otherwise restated from 20261212090300 so the horizon validation,
--    the workface window and the six composed sources stay one function.
-- ---------------------------------------------------------------------------
create or replace function public.get_sync_field_module(
  p_case_id uuid,
  p_horizon_days int default 90
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
  v_weeks int;
  v_workface_end date;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  -- THE HORIZON IS VALIDATED HERE, ONCE, FOR THE WHOLE MODULE.
  --
  -- The first draft passed `p_horizon_days` straight through and derived the
  -- resource window as `greatest(1, least(260, p_horizon_days / 7))`. Postgres
  -- GREATEST and LEAST IGNORE null arguments, so a null horizon evaluated to
  -- `greatest(1, 260)` — 260 weeks — and this RPC is granted to
  -- `authenticated`. One payload then refused the index because the horizon
  -- was unusable and answered a FIVE-YEAR resource position computed from the
  -- same unusable input. A module that half-refuses an input is worse than one
  -- that refuses it, because the half that answered looks deliberate.
  if p_horizon_days is null or p_horizon_days <= 0 or p_horizon_days > 1825 then
    return jsonb_build_object('answered', false, 'caseId', p_case_id,
      'refusal', 'the horizon must be a whole number of days from 1 to 1825. Every figure on this module is about that window, so an unusable horizon refuses the whole module rather than half of it.');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'development case not found');
  end if;
  v_weeks := greatest(1, least(260, p_horizon_days / 7));
  -- THE WORKFACE WINDOW IS THE CALLER'S WINDOW, not a constant.
  --
  -- The first draft called `get_workface_execution_metrics(c.id, null, null)`,
  -- which defaults to fourteen days, while the index and the resource reads
  -- honoured `p_horizon_days`. On an ordinary case with packages at +30, +45
  -- and +60 days and a 90-day horizon, the index answered and BOTH workface
  -- percentages showed the empty-window refusal permanently — honest, but a
  -- composed surface that can never display two of the four metrics it exists
  -- to compose, with nothing in the payload saying the window was chosen for
  -- the reader. `get_workface_execution_metrics` refuses a look-ahead longer
  -- than a year by its own rule, so the horizon is clamped to that rule rather
  -- than sent through to be refused.
  v_workface_end := current_date + least(365, p_horizon_days);

  return jsonb_build_object(
    'answered', true,
    'caseId', c.id,
    'caseTitle', c.title,
    'asOf', current_date,
    'horizonDays', p_horizon_days,
    'horizonWeeks', v_weeks,
    'workfaceWindowEnd', v_workface_end,
    'packages', get_case_work_packages(c.id),
    'constraintFreeWork', get_constraint_free_work_index(c.id, p_horizon_days),
    'workface', get_workface_execution_metrics(c.id, current_date, v_workface_end),
    'resourceBalance', get_case_resource_balance(c.id, v_weeks),
    'portfolioConflicts', get_portfolio_resource_conflicts(v_weeks),
    'executionReadiness', get_execution_readiness_board(c.id),
    'composition', jsonb_build_array(
      jsonb_build_object('part', 'Work packaging (AWP chain)', 'row', 'D7.10/D7.17', 'source', 'get_case_work_packages'),
      jsonb_build_object('part', 'Constraint-free work', 'row', 'D7.08/D7.20', 'source', 'get_constraint_free_work_index'),
      jsonb_build_object('part', 'Workface planning', 'row', 'D7.13/D7.14', 'source', 'get_workface_execution_metrics'),
      jsonb_build_object('part', 'Resource demand and capacity', 'row', 'D7.01', 'source', 'get_case_resource_balance'),
      jsonb_build_object('part', 'Portfolio resource conflicts', 'row', 'D7.02', 'source', 'get_portfolio_resource_conflicts'),
      jsonb_build_object('part', 'Execution readiness', 'row', 'D7.19/D13.09', 'source', 'get_execution_readiness_board')),
    'openParts', jsonb_build_array(
      jsonb_build_object('row', 'D7.06', 'gap', 'the release door does not REQUIRE a field-readiness assessment, so a package nobody walked can still read ready for a person'),
      jsonb_build_object('row', 'D7.12', 'gap', 'three of the ten field-ready elements — crew, access, work-order predecessors — have no canonical store and are reported unverifiable')),
    'basis', 'Sync Field, composed. Every figure on this payload is another function''s answer returned verbatim; nothing here recomputes a readiness verdict, a constraint position or a percentage. The parts still open are listed rather than implied, because a composed module is not more complete than what it composes.');
end
$$;

revoke all on function public.get_sync_field_module(uuid, int) from public, anon;
grant execute on function public.get_sync_field_module(uuid, int) to authenticated;

comment on function public.get_sync_field_module(uuid, int) is
  'D7.16 (spec II.engines): the composed Sync Field module. COMPOSES and never recomputes. Open parts (2026-09-06): D7.06 (release door does not require a field-readiness assessment) and D7.12 (crew / access / work-order predecessors unverifiable). D7.07 closed: the one escalation clock now walks package-anchored restoration_constraints.';

notify pgrst, 'reload schema';
