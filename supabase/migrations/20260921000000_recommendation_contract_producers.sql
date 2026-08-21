-- ============================================================================
-- C5.24 — the producers fill the contract they are judged against.
--
-- WHAT WAS ACTUALLY WRONG.
--
-- 20260829090000 put a BEFORE UPDATE OF status trigger on `recommendations`
-- that refuses `approved` / `released` / `scheduled` unless ten fields are
-- non-blank. It was right to. But the platform's own producers write NONE of
-- the five fields that gate turns on — consequence_summary,
-- alternatives_considered, required_completion_date, required_approver_role,
-- verification_method — so every recommendation the loop has raised since
-- 2026-08-29 has been permanently un-approvable. The failure surfaces only at
-- the instant a human clicks approve, as a raise from a trigger, with no
-- earlier signal anywhere. It happened in a live demo.
--
-- The gate is not the defect. The producers are.
--
-- WHAT IS DERIVED, AND FROM WHAT.
--
-- Nothing here is invented. Every value is composed from inputs the producer
-- already holds at the moment it inserts:
--
--   required_approver_role  the `accountable` role the SAME insert already
--                           writes. The producer had already decided who is
--                           accountable and simply never plumbed it into the
--                           approver column. This is not new information.
--
--   verification_method     the INVERSE OF THE DETECTOR'S OWN PREDICATE. The
--                           rule fired because a sensor passed its configured
--                           threshold, or parts_ready was false, or a KPI left
--                           its band. "Verified when that is no longer true" is
--                           the strongest verification available: the loop can
--                           check exactly what it detected, with no new
--                           judgement and no new data.
--
--   consequence_summary     composed strictly from recorded facts — the asset's
--                           criticality, the measured value against the
--                           configured threshold, the risk_impact the producer
--                           assigned — and then STATES WHAT IT DOES NOT KNOW.
--                           No monetary or safety magnitude is asserted,
--                           because none is computable from this row.
--
--   alternatives_considered the DETECTION RULE'S OWN OPTION SET. Each of these
--                           producers is a branch: alarm takes one action and
--                           warning takes another, and "no action" is rejected
--                           by the predicate that fired. Naming the branch not
--                           taken, and why the data rejected it, is true. Every
--                           one of these strings ends by bounding itself: it is
--                           the rule's option set, not an engineering options
--                           study, and a reviewer may see options the rule
--                           cannot.
--
-- WHAT IS DELIBERATELY LEFT BLANK.
--
-- `required_completion_date` is populated ONLY where the producer's own inputs
-- already carry a committed date: the work order's scheduled_date, or the
-- 48-hour window the alarm branch already commits to in the action text it
-- writes. Where no such date exists — a warning-level advisory, a KPI breach, a
-- multi-point degradation — the column stays NULL and the recommendation stays
-- un-releasable.
--
-- That is a deliberate refusal, and it follows this repository's own precedent.
-- 20260903090000 declined to invent PM intervals in exactly these words: "A PM
-- interval is an engineering decision owned by the operator... inventing one
-- here would be the fabricated authority the knowledge-base trust tiers exist
-- to prevent." Mapping urgency to a response window would be the same act. An
-- organisation that wants advisories to become releasable has to declare its
-- own response policy; that is customer master data, and it is named in the PR
-- as remaining work rather than filled in here with a plausible number.
--
-- The result is not "everything is approvable now". It is: everything the
-- platform can defend is approvable, everything it cannot is visibly and
-- attributably blocked BEFORE a human reaches for the button, and nothing was
-- made up to close the gap.
--
-- THE GATE IS STRENGTHENED, NOT WEAKENED.
--
-- Producers now write text into fields a trigger checks, which creates a new
-- failure mode: a future producer could satisfy the gate with "TBD". So
-- check_recommendation_contract() now treats a set of non-answer sentinels as
-- blank, and holds the three narrative fields to a minimum length. Both make
-- the gate strictly harder to pass than it was before this migration.
--
-- Canonical reuse: recommendations, check_recommendation_contract(),
-- get_recommendation_contract_posture(), app_current_org(). No new table, no
-- new queue, no new approval model. Existing rows are NOT backfilled — the
-- 2026-08-29 migration ruled that the incomplete backlog stays incomplete and
-- stays visible, and that ruling still holds.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Non-answers do not satisfy a required field.
--
-- Compensating strengthening for the fact that producers now write these
-- fields automatically. Before this, 'TBD' passed.
-- ---------------------------------------------------------------------------
create or replace function public.contract_field_blank(p_value text)
returns boolean language sql immutable as $$
  select p_value is null
      or btrim(p_value) = ''
      or lower(btrim(p_value)) in (
           'n/a', 'na', 'n.a.', 'tbd', 'tbc', 'none', 'nil', 'null', 'unknown',
           'not determined', 'not applicable', 'not assessed', 'not specified',
           'pending', 'todo', 'to be determined', '-', '--', '—', '?'
         );
$$;

comment on function public.contract_field_blank(text) is
  'A required field holding a non-answer is blank. Placed here so the release '
  'gate and the posture report cannot drift apart on what "populated" means.';

-- A narrative field has to say something. Seven characters cannot describe a
-- consequence, an alternative, or a method of verification.
create or replace function public.contract_narrative_blank(p_value text)
returns boolean language sql immutable as $$
  select public.contract_field_blank(p_value) or length(btrim(p_value)) < 24;
$$;

grant execute on function public.contract_field_blank(text) to authenticated;
grant execute on function public.contract_narrative_blank(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The release gate, restated over the blank-checks above.
--
-- Identical field set and identical messages to 20260829090000. The only
-- change is WHAT COUNTS AS PRESENT: a sentinel no longer does, and a narrative
-- field under 24 characters no longer does.
-- ---------------------------------------------------------------------------
create or replace function public.check_recommendation_contract(p_recommendation_id uuid)
returns table (
  releasable boolean,
  "missingFields" text[],
  completeness numeric,
  reason text
)
language plpgsql stable security definer set search_path = public as $$
declare
  r recommendations%rowtype;
  v_missing text[] := '{}';
  v_present int := 0;
  v_total int := 11;
begin
  select * into r from recommendations
  where id = p_recommendation_id and organization_id = app_current_org();

  if not found then
    return query select false, array['(not found)']::text[], 0::numeric,
      'No such recommendation in this organization.'::text;
    return;
  end if;

  if r.asset_id is not null then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'asset and functional location (C8.11)'); end if;
  if not contract_field_blank(r.issue) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'current condition or problem (C8.12)'); end if;
  if not contract_field_blank(r.rationale) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'evidence used (C8.13)'); end if;
  if not contract_field_blank(r.action) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'recommended action (C8.16)'); end if;
  if r.confidence is not null then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'confidence and uncertainty (C8.19)'); end if;
  if not contract_narrative_blank(r.consequence_summary) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'consequence — safety, environmental, production, financial (C8.15): approving without it is a judgement about cost with the benefit left blank'); end if;
  if not contract_narrative_blank(r.alternatives_considered) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'alternatives considered (C8.17): without it an approver cannot tell a recommendation from the only idea anybody had'); end if;
  if r.required_completion_date is not null then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'required completion date (C8.18): "soon" is not schedulable and can never be overdue'); end if;
  if not contract_field_blank(r.required_approver_role) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'required approver (C8.20): unstated, it defaults to whoever happens to be looking'); end if;
  if not contract_narrative_blank(r.verification_method) then v_present := v_present + 1;
    else v_missing := array_append(v_missing, 'verification method (C8.21): without it the loop never closes and this returns next year'); end if;
  if not contract_field_blank(r.impact) then v_present := v_present + 1; end if;

  return query select
    array_length(v_missing, 1) is null,
    v_missing,
    round(v_present::numeric / v_total, 2),
    case when array_length(v_missing,1) is null
      then 'Contract complete. Every field an approver needs is present.'
      else format(
        'NOT RELEASABLE — %s required field(s) missing. Completeness is %s%%, reported '
        || 'and deliberately not used as the gate: releasing is binary, and missing '
        || 'fields do not become acceptable by being outnumbered.',
        array_length(v_missing,1), round(100.0 * v_present / v_total))
    end;
end;
$$;

grant execute on function public.check_recommendation_contract(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Posture: how many rows can actually be approved.
--
-- The 2026-08-29 version reported per-field population, which answers "which
-- column is empty" but not the question anybody actually asks, which is "how
-- much of my backlog can I act on". Both are now in one call: the per-field
-- rows are unchanged, and every row carries the two totals so a caller reads
-- the headline without a second round trip.
--
-- releasable/blocked are computed by calling check_recommendation_contract()
-- per row rather than by restating its predicates here. A second copy of that
-- logic would drift from the trigger, and a posture report that disagrees with
-- the gate is worse than none: it would tell an approver a row is ready and
-- then refuse it.
-- ---------------------------------------------------------------------------
drop function if exists get_recommendation_contract_posture();
create or replace function public.get_recommendation_contract_posture()
returns table (
  register text,
  label text,
  blocking boolean,
  populated bigint,
  total bigint,
  share numeric,
  releasable_rows bigint,
  blocked_rows bigint
)
language sql stable security definer set search_path = public as $$
  with r as (select * from recommendations where organization_id = app_current_org()),
  t as (select count(*) n from r),
  releasability as (
    select
      count(*) filter (where c.releasable) as ok,
      count(*) filter (where not c.releasable) as blocked
    from r, lateral check_recommendation_contract(r.id) c
  )
  select v.reg, v.lab, v.blk, v.pop, t.n,
         case when t.n > 0 then round(v.pop::numeric / t.n, 3) else 0 end,
         rel.ok, rel.blocked
  from t, releasability rel, lateral (values
    ('C8.11','Asset and functional location', true,
      (select count(*) from r where asset_id is not null)),
    ('C8.12','Current condition or problem', true,
      (select count(*) from r where not contract_field_blank(issue))),
    ('C8.13','Evidence used', true,
      (select count(*) from r where not contract_field_blank(rationale))),
    ('C8.15','Consequence: safety, environmental, production, financial', true,
      (select count(*) from r where not contract_narrative_blank(consequence_summary))),
    ('C8.16','Recommended action', true,
      (select count(*) from r where not contract_field_blank(action))),
    ('C8.17','Alternative actions considered', true,
      (select count(*) from r where not contract_narrative_blank(alternatives_considered))),
    ('C8.18','Required completion date', true,
      (select count(*) from r where required_completion_date is not null)),
    ('C8.19','Confidence and uncertainty', true,
      (select count(*) from r where confidence is not null)),
    ('C8.20','Required human approval (named authority)', true,
      (select count(*) from r where not contract_field_blank(required_approver_role))),
    ('C8.21','Method for verifying effectiveness', true,
      (select count(*) from r where not contract_narrative_blank(verification_method)))
  ) as v(reg, lab, blk, pop)
  order by 6, 1;
$$;

grant execute on function public.get_recommendation_contract_posture() to authenticated;

-- ==========================================================================
-- run_agent_loop() — verbatim from 00000000000007_continuous_agent_loop.sql, contract fields added.
-- ==========================================================================
create or replace function public.run_agent_loop()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_recs_total int := 0;
  v_recs_org int;
  v_flagged int := 0;
  s record;
  v_urgency text;
  v_title text;
begin
  for v_org in select id from organizations loop
    v_recs_org := 0;

    -- Condition Monitoring: raise recommendations from live sensor state.
    for s in
      select se.id as sensor_id, se.name, se.status, se.trend, se.last_value,
             se.unit, se.threshold, a.id as aid, a.name as asset_name, a.criticality
      from sensors se
      join assets a on a.id = se.asset_id
      where se.organization_id = v_org
        and se.status in ('alarm', 'warning')
    loop
      v_flagged := v_flagged + 1;
      v_title := 'Investigate ' || s.name || ' on ' || s.asset_name;

      if not exists (
        select 1 from recommendations r
        where r.asset_id = s.aid
          and r.title = v_title
          and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
      ) then
        v_urgency := case
          when s.status = 'alarm' and s.criticality in ('critical', 'high') then 'critical'
          when s.status = 'alarm' then 'action'
          else 'advisory'
        end;

        insert into recommendations (
          organization_id, asset_id, agent_id, title, issue, action, impact,
          confidence, urgency, status, approval_required, accountable,
          responsible, consulted, informed, risk_impact, rationale,
          consequence_summary, alternatives_considered, required_completion_date,
          required_approver_role, verification_method
        )
        select
          v_org, s.aid, ag.id, v_title,
          s.name || ' at ' || s.last_value || ' ' || coalesce(s.unit, '')
            || ' vs threshold ' || s.threshold || ' — ' || s.status
            || ', trend ' || s.trend,
          case when s.status = 'alarm'
            then 'Schedule inspection within 48 hours'
            else 'Increase monitoring frequency and review trend' end,
          'Early intervention prevents unplanned downtime',
          case when s.status = 'alarm' then 84 else 76 end,
          v_urgency,
          'pending',
          case when v_urgency = 'critical' then 'Maintenance Manager' else 'Reliability Engineer' end,
          'Maintenance Manager', 'Planner', 'Operations', 'Reliability Engineer',
          case when v_urgency = 'critical' then 'High' else 'Medium' end,
          'Raised by the continuous condition-monitoring loop from live sensor state. Human approval required before any action.',
          -- C8.15 consequence. Recorded facts only; the magnitude is named as
          -- unknown rather than estimated.
          'If not acted on: ' || s.name || ' remains ' || s.status || ' at '
            || s.last_value || coalesce(' ' || s.unit, '')
            || ' against its configured threshold of ' || s.threshold
            || ' on a ' || coalesce(s.criticality, 'unrated')
            || '-criticality asset, with the trend ' || s.trend
            || '. Safety, environmental and financial magnitude are not quantified:'
            || ' no consequence model is attached to this asset.',
          -- C8.17 alternatives: the rule's own branches, and why the data
          -- rejected the one not taken.
          case when s.status = 'alarm' then
            'Considered and rejected: continue monitoring and review the trend — rejected because '
              || s.name || ' is in alarm, not warning, so further observation defers the response'
              || ' without reducing exposure. Considered and rejected: no action — rejected because'
              || ' the reading has passed its configured threshold of ' || s.threshold || '.'
          else
            'Considered and rejected: schedule an inspection within 48 hours — rejected because '
              || s.name || ' is in warning, not alarm, so an inspection window is not yet justified'
              || ' by the reading. Considered and rejected: no action — rejected because the reading'
              || ' has crossed its warning threshold of ' || s.threshold
              || ' with the trend ' || s.trend || '.'
          end
            || ' This is the detection rule''s own option set, not an engineering options study;'
            || ' a reviewer may identify options the rule cannot see.',
          -- C8.18 date. Only the alarm branch commits to a window, and it does
          -- so in the action text this same insert writes. The warning branch
          -- commits to none, so it gets none and stays un-releasable.
          case when s.status = 'alarm' then current_date + 2 end,
          -- C8.20 approver: the accountable role already decided above.
          case when v_urgency = 'critical' then 'Maintenance Manager' else 'Reliability Engineer' end,
          -- C8.21 verification: the inverse of the predicate that fired.
          'Re-read sensor ' || s.name || ' after the work: verified when it reports within its'
            || ' configured threshold of ' || s.threshold || coalesce(' ' || s.unit, '')
            || ' and its status is no longer alarm or warning.'
        from ai_agents ag
        where ag.organization_id = v_org and ag.key = 'condition_monitoring'
        limit 1;

        v_recs_org := v_recs_org + 1;
      end if;
    end loop;

    -- Heartbeat: monitoring freshness + agent liveness for the UI.
    update asset_health_monitoring set monitored_at = now()
      where organization_id = v_org;

    update ai_agents ag set
      last_action_at = now(),
      current_task = case when v_recs_org > 0
        then 'Raised ' || v_recs_org || ' condition recommendation(s)'
        else 'Monitoring sensor streams' end,
      last_action = case when v_recs_org > 0
        then 'Created ' || v_recs_org || ' recommendation(s) from live sensor state'
        else ag.last_action end,
      recommendations_generated = ag.recommendations_generated + v_recs_org
    where ag.organization_id = v_org and ag.key = 'condition_monitoring';

    if v_recs_org > 0 then
      insert into agent_runs (organization_id, agent_id, status, summary, confidence, started_at, completed_at)
      select v_org, ag.id, 'completed',
             'Continuous loop: ' || v_recs_org || ' recommendation(s) raised from sensor state',
             85, now(), now()
      from ai_agents ag
      where ag.organization_id = v_org and ag.key = 'condition_monitoring'
      limit 1;
    end if;

    v_recs_total := v_recs_total + v_recs_org;
  end loop;

  -- Self-maintenance: keep run history bounded.
  delete from agent_runs where created_at < now() - interval '7 days';

  return jsonb_build_object(
    'sensors_flagged', v_flagged,
    'recommendations_created', v_recs_total,
    'ran_at', now()
  );
end
$$;

-- ==========================================================================
-- run_proactive_agent_passes() — verbatim from 00000000000013_realtime_operating_picture.sql, contract fields added.
-- ==========================================================================
create or replace function public.run_proactive_agent_passes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  w record;
  cap record;
  v_title text;
  v_schedule int := 0;
  v_material int := 0;
  v_capacity int := 0;
begin
  for v_org in select id from organizations loop

    -- ---- Schedule agent: overdue or blocked work is a delivery risk --------
    for w in
      select wo.id, wo.title, wo.status, wo.scheduled_date, wo.priority,
             a.name as asset_name, a.id as aid
      from work_orders wo
      left join assets a on a.id = wo.asset_id
      where wo.organization_id = v_org
        and (
          (wo.status in ('pending','approval','scheduled')
             and wo.scheduled_date is not null
             and wo.scheduled_date ~ '^\d{4}-\d{2}-\d{2}'
             and wo.scheduled_date::date < current_date)
          or wo.status = 'blocked'
        )
    loop
      v_title := 'Schedule risk: ' || w.title;
      if not exists (
        select 1 from recommendations r
        where r.organization_id = v_org and r.title = v_title
          and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
      ) then
        insert into recommendations (organization_id, asset_id, agent_id, title, issue, action,
          impact, confidence, urgency, status, approval_required, accountable, responsible,
          consulted, informed, risk_impact, rationale,
          consequence_summary, alternatives_considered, required_completion_date,
          required_approver_role, verification_method)
        select v_org, w.aid, ag.id, v_title,
          case when w.status = 'blocked'
            then w.title || ' is blocked — every blocked day extends asset exposure'
            else w.title || ' is past its scheduled date (' || w.scheduled_date || ')' end,
          case when w.status = 'blocked'
            then 'Resolve the blocker or re-plan the work window'
            else 'Reschedule into the next available window and confirm resources' end,
          'Protects schedule adherence before the backlog compounds',
          78, case when w.priority in ('critical','high') then 'action' else 'advisory' end,
          'pending', null, 'Maintenance Manager', 'Planner', 'Operations', 'Reliability Engineer',
          'Medium',
          'Raised by the proactive schedule pass — surfacing schedule risk before it becomes a delivery gap. Human approval required.',
          'If not acted on: work order "' || w.title || '" stays ' || w.status
            || coalesce(' against a committed date of ' || w.scheduled_date, ' with no committed date')
            || ' at ' || coalesce(w.priority, 'unrated') || ' priority, so the asset stays exposed'
            || ' for as long as the work stays open. Safety, environmental and financial magnitude'
            || ' are not quantified: no consequence model is attached to this work order.',
          case when w.status = 'blocked' then
            'Considered and rejected: reschedule into the next window — rejected because the work is'
              || ' blocked, so a new date would be committed with the blocker still in place.'
          else
            'Considered and rejected: resolve a blocker — rejected because the work is not blocked;'
              || ' it is past its committed date of ' || w.scheduled_date || '.'
          end
            || ' Considered and rejected: accept the slip and take no action — rejected because the'
            || ' condition that raised this has already occurred rather than being forecast.'
            || ' This is the detection rule''s own option set, not an engineering options study;'
            || ' a reviewer may identify options the rule cannot see.',
          -- The only date anybody committed to is the one on the work order.
          -- For an overdue order it is in the past, which is what overdue means;
          -- reporting it as already due is truthful, and inventing a fresh
          -- future date would erase the slip this recommendation exists to show.
          case when w.scheduled_date ~ '^\d{4}-\d{2}-\d{2}' then w.scheduled_date::date end,
          'Maintenance Manager',
          'Re-check work order ' || w.id || ': verified when its status is no longer blocked and it'
            || ' carries a scheduled date that is not in the past.'
        from ai_agents ag
        where ag.organization_id = v_org and ag.key = 'planning_scheduling'
        limit 1;
        v_schedule := v_schedule + 1;
      end if;
    end loop;

    -- ---- Material agent: parts not staged ahead of scheduled work ----------
    for w in
      select wo.id, wo.title, wo.scheduled_date, a.name as asset_name, a.id as aid
      from work_orders wo
      left join assets a on a.id = wo.asset_id
      where wo.organization_id = v_org
        and wo.status in ('pending','approval','scheduled')
        and wo.parts_ready = false
        and wo.scheduled_date is not null
        and wo.scheduled_date ~ '^\d{4}-\d{2}-\d{2}'
        and wo.scheduled_date::date between current_date and current_date + 7
    loop
      v_title := 'Material risk: parts not staged for ' || w.title;
      if not exists (
        select 1 from recommendations r
        where r.organization_id = v_org and r.title = v_title
          and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
      ) then
        insert into recommendations (organization_id, asset_id, agent_id, title, issue, action,
          impact, confidence, urgency, status, accountable, responsible, consulted, informed,
          risk_impact, rationale,
          consequence_summary, alternatives_considered, required_completion_date,
          required_approver_role, verification_method)
        select v_org, w.aid, ag.id, v_title,
          'Work is scheduled for ' || w.scheduled_date || ' but required parts are not staged',
          'Expedite parts or pull forward procurement; confirm kit completeness before the window',
          'Prevents a schedule slip caused by material readiness',
          80, 'action', 'pending', 'Maintenance Manager', 'Planner', 'Inventory', 'Operations',
          'Medium',
          'Raised by the proactive material pass — flagging material risk before it becomes a gap. Human approval required.',
          'If not acted on: work order "' || w.title || '" reaches its committed window of '
            || w.scheduled_date || ' without staged parts, so the window is consumed without the'
            || ' work being completable and the crew is mobilised for work it cannot finish.'
            || ' Financial and production magnitude are not quantified: no consequence model is'
            || ' attached to this work order.',
          'Considered and rejected: let the window proceed and stage parts on the day — rejected'
            || ' because parts_ready is false with the window ' || (w.scheduled_date::date - current_date)
            || ' day(s) away. Considered and rejected: re-plan the window to a later date — rejected'
            || ' because the material gap, not the date, is what blocks the work, and moving the date'
            || ' does not stage the parts. This is the detection rule''s own option set, not an'
            || ' engineering options study; a reviewer may identify options the rule cannot see.',
          -- Parts must be staged by the window the customer already committed to.
          w.scheduled_date::date,
          'Maintenance Manager',
          'Re-check work order ' || w.id || ': verified when parts_ready is true before '
            || w.scheduled_date || '.'
        from ai_agents ag
        where ag.organization_id = v_org and ag.key = 'inventory_management'
        limit 1;
        v_material := v_material + 1;
      end if;
    end loop;

    -- ---- Capacity agent: workload imbalance across assignees ----------------
    for cap in
      select hi.assignee as loaded, hi.n as loaded_n, hi.first_due
      from (
        select assignee, count(*) as n,
               -- The earliest date this overload actually bites. A committed
               -- date the customer already set, not an interval invented here.
               min(scheduled_date) filter (
                 where scheduled_date ~ '^\d{4}-\d{2}-\d{2}'
               ) as first_due
        from work_orders
        where organization_id = v_org
          and status in ('pending','approval','scheduled','in_progress')
          and assignee is not null
        group by assignee
      ) hi
      where hi.n >= 3
    loop
      v_title := 'Capacity: rebalance workload from ' || cap.loaded;
      if not exists (
        select 1 from recommendations r
        where r.organization_id = v_org and r.title = v_title
          and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
      ) then
        insert into recommendations (organization_id, agent_id, title, issue, action,
          impact, confidence, urgency, status, accountable, responsible, consulted, informed,
          risk_impact, rationale,
          consequence_summary, alternatives_considered, required_completion_date,
          required_approver_role, verification_method)
        select v_org, ag.id, v_title,
          cap.loaded || ' carries ' || cap.loaded_n || ' open work orders while other capacity is available',
          'Reallocate lower-priority work to available technicians or the next shift',
          'Frees constrained capacity before it becomes a schedule gap',
          75, 'advisory', 'pending', 'Maintenance Manager', 'Maintenance Supervisor',
          'Planner', 'Operations', 'Low',
          'Raised by the proactive capacity pass — identifying capacity that can be reallocated before it becomes a gap. Human approval required.',
          'If not acted on: ' || cap.loaded || ' continues to carry ' || cap.loaded_n
            || ' open work orders'
            || coalesce(', the earliest committed for ' || cap.first_due, ' with no committed dates')
            || ', so the queue behind them lengthens and their dates slip together rather than'
            || ' one at a time. Financial and production magnitude are not quantified: no'
            || ' consequence model is attached to crew loading.',
          'Considered and rejected: leave the allocation unchanged — rejected because ' || cap.loaded
            || ' carries ' || cap.loaded_n || ' open work orders against the threshold of 3 that'
            || ' raised this. Considered and rejected: add capacity — rejected because this pass'
            || ' cannot commit resource that is not recorded as available. This is the detection'
            || ' rule''s own option set, not an engineering options study; a reviewer may identify'
            || ' options the rule cannot see.',
          -- The imbalance bites at the first date already committed to.
          cap.first_due::date,
          'Maintenance Manager',
          'Re-count open work orders assigned to ' || cap.loaded || ': verified when the total is'
            || ' below the ' || cap.loaded_n || ' recorded here.'
        from ai_agents ag
        where ag.organization_id = v_org and ag.key = 'maintenance_operations'
        limit 1;
        v_capacity := v_capacity + 1;
      end if;
    end loop;

    -- Heartbeats for the agents that did work this pass.
    update ai_agents ag set last_action_at = now(),
      current_task = 'Scanning schedule adherence and backlog risk'
    where ag.organization_id = v_org and ag.key = 'planning_scheduling';
    update ai_agents ag set last_action_at = now(),
      current_task = 'Checking material readiness for upcoming work'
    where ag.organization_id = v_org and ag.key = 'inventory_management';
    update ai_agents ag set last_action_at = now(),
      current_task = 'Balancing crew capacity across open work'
    where ag.organization_id = v_org and ag.key = 'maintenance_operations';
  end loop;

  return jsonb_build_object(
    'schedule_risks', v_schedule,
    'material_risks', v_material,
    'capacity_recommendations', v_capacity,
    'ran_at', now()
  );
end
$$;

-- ==========================================================================
-- run_ops_expansion_passes() — verbatim from 00000000000014_universal_ops_pack.sql, contract fields added.
-- ==========================================================================
create or replace function public.run_ops_expansion_passes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  w record;
  d record;
  v_title text;
  v_hse int := 0;
  v_production int := 0;
begin
  for v_org in select id from organizations loop

    -- ---- HSE pass: safety-flagged work aging without completion -----------
    for w in
      select wo.id, wo.title, wo.created_at, wo.scheduled_date,
             a.name as asset_name, a.id as aid
      from work_orders wo
      left join assets a on a.id = wo.asset_id
      where wo.organization_id = v_org
        and wo.safety_flag = true
        and wo.status in ('pending','approval','scheduled','blocked')
        and wo.created_at < now() - interval '3 days'
    loop
      v_title := 'HSE exposure: safety work aging — ' || w.title;
      if not exists (
        select 1 from recommendations r
        where r.organization_id = v_org and r.title = v_title
          and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
      ) then
        insert into recommendations (organization_id, asset_id, agent_id, title, issue, action,
          impact, confidence, urgency, status, accountable, responsible, consulted, informed,
          risk_impact, rationale,
          consequence_summary, alternatives_considered, required_completion_date,
          required_approver_role, verification_method)
        select v_org, w.aid, ag.id, v_title,
          'Safety-flagged work open since ' || to_char(w.created_at, 'YYYY-MM-DD') || ' without completion',
          'Prioritize into the next execution window; verify interim risk controls are in place',
          'Closes an open safety exposure before it normalizes',
          82, 'action', 'pending', 'HSE Manager', 'Maintenance Manager', 'Operations', 'Reliability Engineer',
          'High',
          'Raised by the proactive HSE pass — aging safety work is an escalating exposure. Human approval required.',
          'If not acted on: safety-flagged work "' || w.title || '" stays open beyond the '
            || (current_date - w.created_at::date) || ' days it has already been open, so whatever'
            || ' interim controls are in place remain the only barrier, indefinitely and without'
            || ' anyone having decided that. The hazard itself is not characterised here: the'
            || ' safety flag records that one was identified, not its severity.',
          'Considered and rejected: leave the work in its current queue position — rejected because'
            || ' it has already been open ' || (current_date - w.created_at::date)
            || ' days with a safety flag set. Considered and rejected: clear the safety flag —'
            || ' rejected because nothing has recorded the exposure as resolved, and clearing it'
            || ' would remove the signal rather than the hazard. This is the detection rule''s own'
            || ' option set, not an engineering options study; a reviewer may identify options the'
            || ' rule cannot see.',
          case when w.scheduled_date ~ '^\d{4}-\d{2}-\d{2}' then w.scheduled_date::date end,
          'HSE Manager',
          'Re-check work order ' || w.id || ': verified when it is completed, or when its safety'
            || ' flag is cleared against a recorded reason.'
        from ai_agents ag
        where ag.organization_id = v_org and ag.key = 'compliance_auditing'
        limit 1;
        v_hse := v_hse + 1;
      end if;
    end loop;

    -- ---- Production pass: multi-point degradation signals derate risk ------
    for d in
      select a.id as aid, a.name as asset_name, a.criticality,
             count(*) as degraded_points,
             string_agg(se.name || ' (' || se.status || ')', ', ') as points
      from sensors se
      join assets a on a.id = se.asset_id
      where se.organization_id = v_org
        and se.status in ('warning','alarm')
      group by a.id, a.name, a.criticality
      having count(*) >= 2
    loop
      v_title := 'Production risk: multi-point degradation on ' || d.asset_name;
      if not exists (
        select 1 from recommendations r
        where r.organization_id = v_org and r.title = v_title
          and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
      ) then
        insert into recommendations (organization_id, asset_id, agent_id, title, issue, action,
          impact, confidence, urgency, status, accountable, responsible, consulted, informed,
          risk_impact, rationale,
          consequence_summary, alternatives_considered, required_completion_date,
          required_approver_role, verification_method)
        select v_org, d.aid, ag.id, v_title,
          d.degraded_points || ' monitoring points degraded simultaneously: ' || d.points,
          'Review operating point with operations; plan intervention before a forced derate or trip',
          'Protects throughput by acting ahead of a forced outage',
          79,
          case when d.criticality in ('critical','high') then 'action' else 'advisory' end,
          'pending', 'Operations Manager', 'Reliability Engineer', 'Planner', 'Maintenance Manager',
          case when d.criticality = 'critical' then 'High' else 'Medium' end,
          'Raised by the proactive production pass — simultaneous multi-point degradation precedes derates and trips. Human approval required.',
          'If not acted on: ' || d.degraded_points || ' monitoring points stay degraded together on '
            || d.asset_name || ', a ' || coalesce(d.criticality, 'unrated') || '-criticality asset ('
            || d.points || '). Production and financial magnitude are not quantified: no consequence'
            || ' model is attached to this asset, and the time to a derate or trip is not estimated'
            || ' because nothing here measures it.',
          'Considered and rejected: handle each degraded point on its own — rejected because '
            || d.degraded_points || ' points degrading together is the signal, and per-point'
            || ' handling discards it. Considered and rejected: no action — rejected because every'
            || ' one of those points is already reporting warning or alarm rather than trending'
            || ' toward it. This is the detection rule''s own option set, not an engineering options'
            || ' study; a reviewer may identify options the rule cannot see.',
          -- No committed date exists for a condition nobody has scheduled work
          -- against. Deriving one from urgency would be an invented interval.
          null,
          'Operations Manager',
          'Re-count degraded monitoring points on ' || d.asset_name || ': verified when fewer than'
            || ' 2 of them report warning or alarm.'
        from ai_agents ag
        where ag.organization_id = v_org and ag.key = 'reliability_engineering'
        limit 1;
        v_production := v_production + 1;
      end if;
    end loop;

    update ai_agents ag set last_action_at = now(),
      current_task = 'Auditing open safety work and compliance exposure'
    where ag.organization_id = v_org and ag.key = 'compliance_auditing';
  end loop;

  return jsonb_build_object(
    'hse_escalations', v_hse,
    'production_risks', v_production,
    'ran_at', now()
  );
end
$$;

-- ==========================================================================
-- compute_kpi_snapshot() — verbatim from 00000000000017_kpi_service.sql, contract fields added.
-- ==========================================================================
create or replace function public.compute_kpi_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_written int := 0;
  v_breaches int := 0;
  k record;
  v numeric;
  conf text;
  lineage jsonb;
  v_status text;
  v_variance numeric;
  v_title text;
  -- shared measures
  m record;
begin
  for v_org in select id from organizations loop

    -- Gather shared measures once per org.
    select
      (select round(avg(oee)::numeric, 1) from oee_measurements where organization_id = v_org
         and measurement_date > current_date - 30) as oee,
      (select round(avg(availability)::numeric, 1) from oee_measurements where organization_id = v_org
         and measurement_date > current_date - 30) as availability,
      (select round(avg(performance)::numeric, 1) from oee_measurements where organization_id = v_org
         and measurement_date > current_date - 30) as throughput,
      (select count(*) from work_orders where organization_id = v_org) as wo_total,
      (select count(*) from work_orders where organization_id = v_org and priority = 'critical') as wo_emergency,
      (select count(*) from work_orders where organization_id = v_org and status = 'completed') as wo_completed,
      (select count(*) from work_orders where organization_id = v_org
         and scheduled_date ~ '^\d{4}-\d{2}-\d{2}' and scheduled_date::date < current_date) as wo_due,
      (select count(*) from work_orders where organization_id = v_org and status = 'completed'
         and scheduled_date ~ '^\d{4}-\d{2}-\d{2}') as wo_completed_scheduled,
      (select round(avg(extract(epoch from (closed_at - created_at)) / 3600)::numeric, 1)
         from work_orders where organization_id = v_org and closed_at is not null) as mttr,
      (select coalesce(sum(downtime_hours), 0) from work_orders where organization_id = v_org
         and closed_at > now() - interval '30 days') as downtime_hours_30d,
      (select count(*) from work_orders where organization_id = v_org and safety_flag
         and created_at > now() - interval '30 days') as safety_incidents_30d,
      (select count(*) from assets where organization_id = v_org) as assets_total,
      (select count(*) from assets where organization_id = v_org and criticality in ('critical','high')) as assets_critical,
      (select count(distinct s.asset_id) from sensors s where s.organization_id = v_org) as assets_monitored,
      (select count(distinct s.asset_id) from sensors s join assets a on a.id = s.asset_id
         where s.organization_id = v_org and a.criticality in ('critical','high')) as critical_monitored,
      (select round(avg(risk_score)::numeric, 0) from assets where organization_id = v_org) as risk_index,
      (select round(avg(completion_pct)::numeric, 0) from asset_onboarding_state where organization_id = v_org) as data_completeness,
      (select count(*) from asset_onboarding_items i where i.organization_id = v_org
         and i.requirement_key = 's20_dq_gate' and i.status = 'auto_filled') as dq_pass,
      (select count(*) from approvals where organization_id = v_org) as controls_total,
      (select count(*) from approvals where organization_id = v_org and status = 'approved') as controls_ok,
      (select count(*) from recommendations where organization_id = v_org) as recs_total,
      (select count(*) from recommendations where organization_id = v_org
         and status in ('approved','modified')) as recs_actioned,
      (select count(*) from recommendations where organization_id = v_org
         and status in ('approved','rejected','dismissed','modified','escalated')) as recs_decided,
      (select extract(epoch from (now() - max(created_at))) / 60 from recommendations
         where organization_id = v_org) as minutes_since_rec,
      (select count(*) from integrations i where i.organization_id = v_org
         and lower(coalesce(i.status,'')) in ('connected','healthy','active')) as integrations_live,
      (select coalesce(sum(value) filter (where status = 'verified'), 0) from value_metrics
         where organization_id = v_org and unit = 'usd') as value_verified,
      (select coalesce(sum(value), 0) from value_metrics
         where organization_id = v_org and unit = 'usd') as value_total,
      (select mtbf from (
         select round(
           greatest(extract(epoch from (now() - min(a2.installed_date::timestamptz))) / 86400.0, 1)
           / greatest(count(w2.id) filter (where w2.priority in ('critical','high') or w2.safety_flag), 1), 0) as mtbf
         from assets a2 left join work_orders w2 on w2.asset_id = a2.id
         where a2.organization_id = v_org and a2.installed_date is not null
       ) q) as mtbf_days
    into m;

    for k in select * from kpi_catalog where computable loop
      v := null; conf := 'medium'; lineage := null;

      case k.kpi_key
        when 'oee' then
          v := m.oee; conf := 'high';
          lineage := jsonb_build_object('source', 'oee_measurements (30d avg)');
        when 'availability' then
          v := m.availability; conf := 'high';
          lineage := jsonb_build_object('source', 'oee_measurements availability (30d avg)');
        when 'production_throughput' then
          v := m.throughput; conf := 'low';
          lineage := jsonb_build_object('source', 'oee performance component as throughput proxy — replace with production feed');
        when 'mtbf' then
          v := m.mtbf_days; conf := 'medium';
          lineage := jsonb_build_object('source', 'service days / significant events (work orders)');
        when 'mttr' then
          v := m.mttr; conf := 'high';
          lineage := jsonb_build_object('source', 'work-order closeouts (open→close hours)');
        when 'planned_maintenance_pct' then
          if m.wo_total > 0 then v := round(100.0 * (m.wo_total - m.wo_emergency) / m.wo_total, 1); end if;
          lineage := jsonb_build_object('source', 'work_orders: non-emergency / total');
        when 'emergency_maintenance_pct' then
          if m.wo_total > 0 then v := round(100.0 * m.wo_emergency / m.wo_total, 1); end if;
          lineage := jsonb_build_object('source', 'work_orders: critical-priority / total');
        when 'schedule_compliance' then
          if m.wo_due + m.wo_completed_scheduled > 0 then
            v := round(100.0 * m.wo_completed_scheduled / greatest(m.wo_completed_scheduled + m.wo_due, 1), 1);
          end if;
          lineage := jsonb_build_object('source', 'work_orders: completed-scheduled vs overdue');
        when 'pm_compliance' then
          if m.wo_completed_scheduled + m.wo_due > 0 then
            v := round(100.0 * m.wo_completed_scheduled / greatest(m.wo_completed_scheduled + m.wo_due, 1), 1);
          end if;
          conf := 'low';
          lineage := jsonb_build_object('source', 'scheduled-work completion proxy — refine with PM plan feed');
        -- cost_of_downtime and asset_risk_index are REFUSED here, not
        -- computed. 20260921002000 marks both non-computable and says why;
        -- these branches are left as an explicit null so that flipping the
        -- catalog flag back on cannot silently resurrect the fabrication.
        --   cost_of_downtime multiplied downtime hours by a hardcoded
        --   $10,000/h while its own lineage promised "set site rate to
        --   refine" — a rate that could not be set anywhere.
        --   asset_risk_index averaged assets.risk_score, which NOTHING in
        --   this repository writes: the demo figures are hand-typed and a
        --   real import leaves the column 0.
        when 'cost_of_downtime' then
          v := null;
        when 'asset_risk_index' then
          v := null;
        when 'critical_control_compliance' then
          if m.controls_total > 0 then v := round(100.0 * m.controls_ok / m.controls_total, 1);
          else v := 100; conf := 'low'; end if;
          lineage := jsonb_build_object('source', 'approvals: approved / total');
        when 'asset_safety_incidents' then
          v := m.safety_incidents_30d; conf := 'high';
          lineage := jsonb_build_object('source', 'safety-flagged work orders (30d)');
        when 'asset_register_accuracy' then
          if m.assets_total > 0 then v := round(100.0 * m.dq_pass / m.assets_total, 1); end if;
          lineage := jsonb_build_object('source', 'data-quality gate passes / assets');
        when 'data_completeness' then
          v := m.data_completeness; conf := 'high';
          lineage := jsonb_build_object('source', 'onboarding completion (org avg)');
        when 'update_latency' then
          v := round(coalesce(m.minutes_since_rec, 0), 0); conf := 'medium';
          lineage := jsonb_build_object('source', 'minutes since newest platform event');
        when 'digital_twin_coverage' then
          if m.assets_critical > 0 then v := round(100.0 * m.critical_monitored / m.assets_critical, 1); end if;
          lineage := jsonb_build_object('source', 'monitored critical assets / critical assets');
        when 'pdm_coverage' then
          if m.assets_total > 0 then v := round(100.0 * m.assets_monitored / m.assets_total, 1); end if;
          lineage := jsonb_build_object('source', 'assets with live points / all assets');
        when 'ai_recommendations_implemented' then
          if m.recs_decided > 0 then v := round(100.0 * m.recs_actioned / m.recs_decided, 1); end if;
          lineage := jsonb_build_object('source', 'recommendations actioned / decided');
        when 'cmms_integration_score' then
          v := case when m.integrations_live > 0 then 95 else 75 end; conf := 'medium';
          lineage := jsonb_build_object('source', case when m.integrations_live > 0
            then 'external CMMS connected' else 'SyncAI-native work management (no external CMMS yet)' end);
        when 'asset_value_realization' then
          if m.value_total > 0 then v := round(100.0 * m.value_verified / m.value_total, 1); end if;
          lineage := jsonb_build_object('source', 'value_metrics: verified / total (USD)');
        else
          v := null;
      end case;

      if v is null then continue; end if;

      -- Status vs target.
      v_status := case
        when k.direction = 'up' and k.target_low is not null then
          case when v >= k.target_low then 'on_target'
               when v >= k.target_low * 0.9 then 'watch' else 'breach' end
        when k.direction = 'down' and k.target_high is not null then
          case when v <= k.target_high then 'on_target'
               when v <= k.target_high * 1.25 then 'watch' else 'breach' end
        when k.direction = 'range' and k.target_low is not null and k.target_high is not null then
          case when v between k.target_low and k.target_high then 'on_target'
               when v >= k.target_low * 0.9 then 'watch' else 'breach' end
        else 'on_target'  -- trend KPIs (Increase/Decrease with no absolute bound)
      end;
      v_variance := case when k.target_low is not null and k.target_low <> 0
        then round(100.0 * (v - k.target_low) / k.target_low, 1) end;

      insert into kpi_values (organization_id, kpi_key, value, status, variance_pct, confidence, computed_from)
      values (v_org, k.kpi_key, v, v_status, v_variance, conf, lineage);
      v_written := v_written + 1;

      -- Threshold trigger: breach → HITL recommendation routed by RACI.
      -- Low-confidence computations record status but never spam actions.
      if v_status = 'breach' and conf <> 'low' then
        v_title := 'KPI breach: ' || k.name;
        if not exists (
          select 1 from recommendations r
          where r.organization_id = v_org and r.title = v_title
            and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
        ) then
          insert into recommendations (organization_id, agent_id, title, issue, action, impact,
            confidence, urgency, status, accountable, responsible, consulted, informed,
            risk_impact, rationale,
            consequence_summary, alternatives_considered, required_completion_date,
            required_approver_role, verification_method)
          select v_org, ag.id, v_title,
            k.name || ' at ' || v || coalesce(' ' || k.unit, '') || ' vs target ' || k.target_label,
            'Review drivers with ' || k.responsible || '; agree corrective plan and owner',
            'Restores ' || k.name || ' to the ISO 55000 target band',
            80, 'action', 'pending', k.accountable, k.responsible, coalesce(k.consulted, 'Reliability Engineer'),
            coalesce(k.informed, 'Operations'), 'Medium',
            'Raised by the KPI service (ISO 55000 monitor) — threshold breach routed per the KPI RACI chain. Human approval required.',
            'If not acted on: ' || k.name || ' stays at ' || v || coalesce(' ' || k.unit, '')
              || ' against a target of ' || k.target_label || ' — a breach, not a watch, computed at '
              || conf || ' confidence. What the gap costs is not quantified: this KPI measures the'
              || ' distance from target, and nothing in the platform prices that distance.',
            'Considered and rejected: re-baseline the target to the measured value — rejected because'
              || ' the target is the band the organisation set under ISO 55000, not an output of the'
              || ' measurement, and moving it would close the gap on paper only. Considered and'
              || ' rejected: no action — rejected because ' || v || ' is outside the band rather than'
              || ' inside the watch margin. This is the detection rule''s own option set, not an'
              || ' engineering options study; a reviewer may identify options the rule cannot see.',
            -- A KPI band carries no due date, and the recovery time for a KPI is
            -- not derivable from the breach. Left null deliberately.
            null,
            k.accountable,
            'Re-compute ' || k.name || ' on a subsequent snapshot: verified when it returns inside'
              || ' its target band of ' || k.target_label || '.'
          from ai_agents ag
          where ag.organization_id = v_org and ag.key = coalesce(k.agent_owner, 'asset_management')
          limit 1;
          v_breaches := v_breaches + 1;
        end if;
      end if;
    end loop;
  end loop;

  -- Keep the fact table bounded.
  delete from kpi_values where computed_at < now() - interval '90 days';

  return jsonb_build_object('kpi_values_written', v_written, 'breaches_raised', v_breaches, 'ran_at', now());
end
$$;

-- ==========================================================================
-- evaluate_ca_effectiveness() — verbatim from 00000000000026_ca_effectiveness_loop.sql, contract fields added.
-- ==========================================================================
create or replace function public.evaluate_ca_effectiveness()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  rec_id uuid;
  n_eval int := 0;
  n_ineffective int := 0;
begin
  for v in
    select cv.* from ca_verifications cv
    where cv.status = 'observing' and cv.effectiveness = 'observing'
  loop
    -- recurrence: same asset, same failure mode, completed after the CA
    select w.id into rec_id
    from work_orders w
    where w.asset_id = v.asset_id
      and w.work_type = 'corrective'
      and w.id <> v.work_order_id
      and w.actual_failure_mode is not distinct from v.failure_mode
      and w.completed_at > v.observation_start
      and w.completed_at <= v.observation_start + make_interval(days => v.observation_days)
    order by w.completed_at
    limit 1;

    if rec_id is not null then
      update ca_verifications set effectiveness = 'ineffective',
        effectiveness_evaluated_at = now(), recurrence_wo_id = rec_id,
        status = 'reopened_ineffective'
      where id = v.id;
      n_ineffective := n_ineffective + 1;

      insert into recommendations (organization_id, asset_id, title, issue,
        action, urgency, confidence, status, approval_required, rationale,
        verification_method,
        consequence_summary, alternatives_considered, required_completion_date,
        required_approver_role)
      select v.organization_id, v.asset_id,
        'Corrective action ineffective — ' || coalesce(v.failure_mode, 'failure') || ' recurred',
        'The corrective action verified under CA verification ' || v.id ||
        ' did not hold: the same failure mode recurred within the ' ||
        v.observation_days || '-day observation window.',
        'Re-open causal analysis (FRACAS) and revise the corrective action.',
        'action', 88, 'pending', true,
        'Deterministic recurrence measurement by evaluate_ca_effectiveness()',
        'No recurrence of ' || coalesce(v.failure_mode, 'the failure mode') ||
        ' on this asset for ' || v.observation_days || ' further days',
        'If not acted on: ' || coalesce(v.failure_mode, 'the failure mode') ||
        ' has already recurred on this asset inside the ' || v.observation_days ||
        '-day observation window, so the corrective action in place demonstrably does not' ||
        ' prevent it and the recurrence continues at whatever rate it had before. The cost' ||
        ' of that recurrence is not quantified: this loop measures whether the action held,' ||
        ' not what each failure costs.',
        'Considered and rejected: extend the observation window — rejected because recurrence' ||
        ' has been measured, not merely awaited. Considered and rejected: repeat the same' ||
        ' corrective action — rejected because it is the action that did not hold. This is the' ||
        ' detection rule''s own option set, not an engineering options study; a reviewer may' ||
        ' identify options the rule cannot see.',
        -- Re-opening a causal analysis has no committed date until a planner
        -- schedules it. Not derivable here.
        null,
        'Reliability Engineer'
      where not exists (
        select 1 from recommendations r
        where r.asset_id = v.asset_id
          and r.title like 'Corrective action ineffective%' || coalesce(v.failure_mode, 'failure') || '%'
          and r.status in ('pending', 'approved')
      );
      n_eval := n_eval + 1;
    elsif now() >= v.observation_start + make_interval(days => v.observation_days) then
      update ca_verifications set effectiveness = 'effective',
        effectiveness_evaluated_at = now(), status = 'closed_effective'
      where id = v.id;
      n_eval := n_eval + 1;
    end if;
  end loop;

  return jsonb_build_object('evaluated', n_eval, 'ineffective', n_ineffective);
end
$$;

notify pgrst, 'reload schema';
