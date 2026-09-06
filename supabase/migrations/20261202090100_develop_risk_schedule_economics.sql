-- ============================================================================
-- Sync Develop Slice 4C — THE RISK → SCHEDULE → ECONOMICS LINKAGE (D5.08).
--
-- THE SPEC'S SENTENCE (I.10): "Risks connect directly to schedule and cost:
-- RISK (compressor delivery) → probability distribution → Schedule Activity
-- 5100 → mechanical completion → production startup → NPV."
--
-- ── WHAT THIS FILE IS AND IS NOT ───────────────────────────────────────────
-- It is ONE RELATION between two stores that already exist: `risks` (the ISO
-- 31000 spine, canonical per overlap-map ruling on §12) and `shutdown_tasks`
-- (the ScheduleActivity, canonical per D5.28). It creates no risk store, no
-- schedule store, and no third place to type a probability. The whole
-- contribution is the EDGE and what has to be true to draw one.
--
-- ── THE PROBABILITY RULING, WHICH IS THE HARD ONE ──────────────────────────
-- `risks.likelihood` is an UNBOUNDED numeric on a scoring scale
-- (20260921110101: `check (likelihood is null or likelihood >= 0)`). It is a
-- score, not a probability. Reading it as one — dividing by 5, or by 100, or
-- treating a 4 as 0.8 — would silently invent the single most consequential
-- input to the simulation: the number that decides how often a risk happens
-- at all. So the LINK carries its own `probability` in (0,1], mandatory, with
-- a mandatory basis, and a link with no probability cannot be created. Where
-- somebody wants the risk register's score used, they state the conversion in
-- the basis, in words, on the record.
--
-- ── THREE POINTS OR NOTHING ────────────────────────────────────────────────
-- The delay a risk causes is recorded as an optimistic / most-likely /
-- pessimistic triple, ordered, and a single point is REFUSED BY NAME. This is
-- the central rule of this slice enforced at the INPUT end: a simulation that
-- sampled a spread out of one number would be manufacturing a distribution,
-- and the cheapest place to manufacture one is here, at data entry, where it
-- would look like diligence.
--
-- ── THE ECONOMIC HOP ───────────────────────────────────────────────────────
-- Two legs, and they are different:
--
--   DIRECT COST — money spent because the risk occurred (expediting, rework,
--   a second mobilisation). Recorded on the link as its own three-point
--   triple, in the case's currency. Optional: many risks cost only time.
--
--   DELAY COST — money that follows from the DAYS. Spec I.10's chain ends at
--   NPV, and the honest bridge from "17 days" to "$14.2M" is a rate somebody
--   has stated and owns. That rate is an ECONOMIC ASSUMPTION, and this
--   repository already has exactly one home for those: `financial_assumptions`
--   (overlap-map ruling 5 — risk_assumptions is the Assumption, the numeric
--   leg is financial_assumptions), with a live write path
--   (`upsert_financial_assumption`, 20261115090200) that already demands a
--   source. So the rate is a financial assumption under a published,
--   case-scoped key, and NOT a new column on a new table. Where no such
--   assumption exists the delay-to-money hop is REFUSED BY NAME and the
--   simulation reports schedule exposure with the economic half absent —
--   which is spec I.10's chain honestly truncated, not silently completed
--   with a default rate.
--
-- §70: recording what a risk will do to a schedule and to the money is a risk
-- judgement. The AI-operator identity is refused BY NAME on both acts. An
-- identity that could author the probability and the impact would be
-- determining the risk exposure it is forbidden to determine.
--
-- Canonical reuse: risks (+ development_case_id from 20261105090200),
-- shutdown_tasks / shutdown_events, development_cases, financial_assumptions,
-- audit_events, security_events, record_calculation_run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE EDGE.
-- ---------------------------------------------------------------------------
create table if not exists public.risk_schedule_impacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  risk_id uuid not null references risks(id) on delete cascade,
  schedule_task_id bigint not null references shutdown_tasks(id) on delete cascade,

  -- (0,1]. Zero is not a risk and one is not a risk either — it is a fact
  -- somebody should be putting in the plan rather than the register.
  probability numeric not null check (probability > 0 and probability <= 1),

  -- The delay this risk adds to THIS activity if it occurs, in days.
  -- Ordered, finite, non-negative, and genuinely three-valued.
  delay_days_optimistic numeric not null check (delay_days_optimistic >= 0),
  delay_days_likely numeric not null check (delay_days_likely >= 0),
  delay_days_pessimistic numeric not null check (delay_days_pessimistic >= 0),

  -- Direct money, if any. All three or none — a "likely" cost with no range
  -- is the single point this file exists to refuse, wearing a currency sign.
  cost_optimistic numeric,
  cost_likely numeric,
  cost_pessimistic numeric,
  currency text,

  basis text not null check (length(btrim(basis)) >= 20),
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),

  constraint rsi_delay_ordered check (
    delay_days_optimistic <= delay_days_likely
    and delay_days_likely <= delay_days_pessimistic),
  -- THE RULE OF THIS SLICE, AT THE INPUT END. A triple whose ends meet is a
  -- point estimate with three columns, and sampling it would produce a
  -- distribution of zero width dressed as a forecast.
  constraint rsi_delay_is_a_range check (
    delay_days_pessimistic > delay_days_optimistic),
  constraint rsi_delay_finite check (
    delay_days_optimistic <> 'NaN'::numeric and delay_days_optimistic <> 'Infinity'::numeric
    and delay_days_likely <> 'NaN'::numeric and delay_days_likely <> 'Infinity'::numeric
    and delay_days_pessimistic <> 'NaN'::numeric and delay_days_pessimistic <> 'Infinity'::numeric),
  constraint rsi_cost_all_or_none check (
    (cost_optimistic is null and cost_likely is null and cost_pessimistic is null
     and currency is null)
    or (cost_optimistic is not null and cost_likely is not null
        and cost_pessimistic is not null and currency is not null)),
  constraint rsi_cost_ordered check (
    cost_optimistic is null
    or (cost_optimistic >= 0
        and cost_optimistic <= cost_likely and cost_likely <= cost_pessimistic
        and cost_pessimistic > cost_optimistic
        and cost_optimistic <> 'NaN'::numeric and cost_likely <> 'NaN'::numeric
        and cost_pessimistic <> 'NaN'::numeric
        and cost_pessimistic <> 'Infinity'::numeric)),
  -- One statement per (risk, activity). A risk that threatens an activity
  -- twice is two different impacts nobody has reconciled.
  unique (risk_id, schedule_task_id)
);

create index if not exists idx_rsi_case
  on risk_schedule_impacts(organization_id, development_case_id, risk_id);
create index if not exists idx_rsi_task
  on risk_schedule_impacts(schedule_task_id);

alter table public.risk_schedule_impacts enable row level security;
drop policy if exists rsi_read on public.risk_schedule_impacts;
create policy rsi_read on public.risk_schedule_impacts
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: the act below is the only door.

comment on table public.risk_schedule_impacts is
  'D5.08 (spec I.10): the edge from a Risk to the Schedule Activity it threatens, carrying its OWN probability (risks.likelihood is an unbounded score, not a probability) and a three-point delay in days plus an optional three-point direct cost. A single-point impact is refused at the schema — a spread manufactured at data entry looks exactly like diligence. This is a relation between two canonical stores; it is not a risk store and not a schedule store.';

-- ---------------------------------------------------------------------------
-- 2. THE PROVENANCE BACKSTOP. INSERT, UPDATE, DELETE and TRUNCATE.
--
--    Deletion matters as much as insertion here: dropping the link to the
--    risk that drives the spread is how a P80 is lowered without changing a
--    single number anybody would notice.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_risk_schedule_impact()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.risk_schedule_impact_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid;
  v_case uuid;
  v_task_case uuid;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'risk_schedule_impacts is what a recorded P80 was simulated over; truncating it removes every driver of every recorded distribution in one statement, which no row-level guard can refuse.'
      using errcode = 'insufficient_privilege';
  end if;

  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted' and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'A risk-to-schedule impact was ' || lower(tg_op) || 'd by a service caller '
           'outside record_risk_schedule_impact. These edges are what a recorded '
           'P80 was simulated over (D5.08/D5.09), so changing one changes what a '
           'past forecast is understood to have been computed from.');
    end if;
  elsif v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'a risk-to-schedule impact is written through record_risk_schedule_impact — a direct write would supply the probability and the spread a forecast is built on with no recorded act behind it.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- Tenancy and case coherence, checked at the row rather than trusted from
  -- the act: the reads below run inside SECURITY DEFINER functions.
  select organization_id into v_case from development_cases where id = new.development_case_id;
  if v_case is null or v_case <> new.organization_id then
    raise exception
      'this impact is stamped with an organization that does not own its development case'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from risks r
                  where r.id = new.risk_id and r.organization_id = new.organization_id) then
    raise exception
      'this impact names a risk that does not belong to the organization that owns it'
      using errcode = 'check_violation';
  end if;
  select e.development_case_id into v_task_case
    from shutdown_tasks t join shutdown_events e on e.id = t.event_id
   where t.id = new.schedule_task_id and e.organization_id = new.organization_id;
  if v_task_case is null or v_task_case <> new.development_case_id then
    raise exception
      'an impact does not jump between cases: its schedule activity belongs to another development case (or to no case at all)'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_risk_schedule_impact() from public, anon, authenticated;

drop trigger if exists trg_risk_schedule_impact on public.risk_schedule_impacts;
create trigger trg_risk_schedule_impact
  before insert or update or delete on public.risk_schedule_impacts
  for each row execute function public.enforce_risk_schedule_impact();

drop trigger if exists trg_risk_schedule_impact_no_truncate on public.risk_schedule_impacts;
create trigger trg_risk_schedule_impact_no_truncate
  before truncate on public.risk_schedule_impacts
  for each statement execute function public.enforce_risk_schedule_impact();

revoke truncate on table public.risk_schedule_impacts from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. THE PUBLISHED KEY for the delay-cost rate, and the reader that resolves
--    it. One convention, stated once, greppable from both sides.
-- ---------------------------------------------------------------------------
create or replace function public.sync_case_delay_cost_key(p_case_id uuid)
returns text
language sql
immutable
set search_path = public
as $$
  select 'develop.case.' || p_case_id::text || '.delay_cost_per_day';
$$;

revoke all on function public.sync_case_delay_cost_key(uuid) from public, anon;
grant execute on function public.sync_case_delay_cost_key(uuid) to authenticated, service_role;

comment on function public.sync_case_delay_cost_key(uuid) is
  'D5.08 (spec I.10): the financial_assumptions key that carries this case''s cost of one day of delay. The rate lives in the canonical numeric-assumption store (overlap-map ruling 5) with its mandatory source, not in a new column — and where no version of this key exists, the days-to-money hop is refused by name rather than defaulted.';

create or replace function public.get_case_delay_cost_rate(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  fa financial_assumptions%rowtype;
  v_key text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  v_key := sync_case_delay_cost_key(c.id);

  select * into fa from financial_assumptions
   where organization_id = v_org and assumption_key = v_key
     and effective_from <= current_date
   order by effective_from desc, id desc limit 1;

  if not found then
    return jsonb_build_object(
      'caseId', c.id, 'key', v_key, 'value', null, 'unit', null, 'source', null,
      'refusal', format(
        'No cost of delay is recorded for this case, so days cannot be converted into money. Spec I.10''s chain ends at NPV and the bridge from "17 days" to "$14.2M" is a RATE somebody has stated and owns — deferred margin, standing costs, contractual liquidated damages, or a combination of them. Record it as a financial assumption under the key "%s" (upsert_financial_assumption, which demands a source) and the economic half of every risk attribution on this case becomes computable. Until then the schedule exposure is reported and the money is refused, which is I.10''s chain honestly truncated rather than silently completed at a default rate.',
        v_key));
  end if;

  if fa.value is null or fa.value = 'NaN'::numeric or fa.value = 'Infinity'::numeric
     or fa.value = '-Infinity'::numeric or fa.value < 0 then
    return jsonb_build_object(
      'caseId', c.id, 'key', v_key, 'value', null, 'unit', fa.unit, 'source', fa.source,
      'refusal', format('The recorded cost of delay for this case is %s, which is not a usable rate. A negative or non-finite cost of delay would turn every simulated slip into a benefit.', fa.value));
  end if;

  return jsonb_build_object(
    'caseId', c.id, 'key', v_key, 'value', fa.value, 'unit', fa.unit,
    'source', fa.source, 'effectiveFrom', fa.effective_from, 'label', fa.label,
    'refusal', null);
end
$$;

revoke all on function public.get_case_delay_cost_rate(uuid) from public, anon, service_role;
grant execute on function public.get_case_delay_cost_rate(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE ACT. §70: refused to the AI-operator identity by name.
-- ---------------------------------------------------------------------------
create or replace function public.record_risk_schedule_impact(
  p_case_id uuid,
  p_impact jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  r risks%rowtype;
  t shutdown_tasks%rowtype;
  v_matches int;
  v_risk_id uuid;
  v_risk_raw text := nullif(btrim(coalesce(p_impact->>'risk_id','')), '');
  v_activity_key text := nullif(btrim(coalesce(p_impact->>'activity_key','')), '');
  v_prob numeric := sync_text_as_numeric(nullif(btrim(coalesce(p_impact->>'probability','')), ''));
  v_o numeric := sync_text_as_numeric(nullif(btrim(coalesce(p_impact->>'delay_days_optimistic','')), ''));
  v_l numeric := sync_text_as_numeric(nullif(btrim(coalesce(p_impact->>'delay_days_likely','')), ''));
  v_p numeric := sync_text_as_numeric(nullif(btrim(coalesce(p_impact->>'delay_days_pessimistic','')), ''));
  v_co numeric := sync_text_as_numeric(nullif(btrim(coalesce(p_impact->>'cost_optimistic','')), ''));
  v_cl numeric := sync_text_as_numeric(nullif(btrim(coalesce(p_impact->>'cost_likely','')), ''));
  v_cp numeric := sync_text_as_numeric(nullif(btrim(coalesce(p_impact->>'cost_pessimistic','')), ''));
  v_currency text := nullif(btrim(coalesce(p_impact->>'currency','')), '');
  v_basis text := nullif(btrim(coalesce(p_impact->>'basis','')), '');
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'stating how likely a risk is and how many days it costs is a risk judgement — the AI-operator identity cannot record one (spec §70). This is the number a P80 is built on, and an identity that could author it would be determining the exposure it is forbidden to determine.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'linking a risk to a schedule activity requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  if v_risk_raw is null then
    return jsonb_build_object('error', 'name the risk this impact is about (risk_id)');
  end if;
  begin
    v_risk_id := v_risk_raw::uuid;
  exception when others then
    return jsonb_build_object('error', format('risk_id "%s" is not a uuid', v_risk_raw));
  end;
  select * into r from risks where id = v_risk_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'risk not found in this organization');
  end if;
  if r.development_case_id is distinct from c.id then
    return jsonb_build_object('error',
      format('risk "%s" is not bound to this development case. Bind it first (bind_risk_to_development_case) — a risk driving this case''s forecast that its risk register does not list is a driver nobody reviews.', r.title));
  end if;

  if v_activity_key is null then
    return jsonb_build_object('error',
      'name the schedule activity this risk threatens (activity_key) — spec I.10''s chain runs through a specific activity, not through the project in general');
  end if;
  -- AMBIGUITY IS REFUSED, NOT RESOLVED BY `limit 1`. `task_key` is unique per
  -- shutdown_event and a case holds two of them by design (the P6 import and
  -- Sync's own activities), so one key can name two activities. Picking either
  -- would attach a risk to a schedule nobody chose.
  select count(*) into v_matches from shutdown_tasks t2
    join shutdown_events e2 on e2.id = t2.event_id
   where e2.organization_id = v_org and e2.development_case_id = c.id
     and t2.task_key = v_activity_key;
  if coalesce(v_matches, 0) = 0 then
    return jsonb_build_object('error',
      format('activity "%s" is not in this case''s schedule', v_activity_key));
  end if;
  if v_matches > 1 then
    return jsonb_build_object('error',
      format('activity id "%s" names %s activities on this case — the imported schedule and the Sync-authored one each carry it. Rename one in its own system; attaching the risk to either would be a choice nobody made.',
             v_activity_key, v_matches));
  end if;
  select t2.* into t from shutdown_tasks t2
    join shutdown_events e2 on e2.id = t2.event_id
   where e2.organization_id = v_org and e2.development_case_id = c.id
     and t2.task_key = v_activity_key;

  if v_prob is null then
    return jsonb_build_object('error',
      'state the probability this risk occurs, as a fraction between 0 and 1 (probability). The risk register''s `likelihood` is an unbounded score, not a probability, and reading one as the other would invent the number that decides how often this risk happens at all.');
  end if;
  if v_prob = 'NaN'::numeric or v_prob = 'Infinity'::numeric or v_prob = '-Infinity'::numeric
     or v_prob <= 0 or v_prob > 1 then
    return jsonb_build_object('error',
      format('probability is %s; it must be greater than 0 and at most 1. A probability of zero is not a risk, and a probability of one is a fact that belongs in the plan rather than the register.', v_prob));
  end if;

  if v_o is null or v_l is null or v_p is null then
    return jsonb_build_object('error',
      'a schedule impact is a THREE-POINT range in days: delay_days_optimistic, delay_days_likely, delay_days_pessimistic. A single number here would be turned into a spread by the simulation, and a spread nobody estimated is the one thing this slice must not produce.');
  end if;
  if v_o = 'NaN'::numeric or v_l = 'NaN'::numeric or v_p = 'NaN'::numeric
     or v_o = 'Infinity'::numeric or v_l = 'Infinity'::numeric or v_p = 'Infinity'::numeric
     or v_o = '-Infinity'::numeric or v_l = '-Infinity'::numeric or v_p = '-Infinity'::numeric then
    return jsonb_build_object('error', 'a delay must be a finite number of days');
  end if;
  if v_o < 0 then
    return jsonb_build_object('error', 'a delay cannot be negative — an opportunity that SHORTENS a schedule is modelled as an opportunity, not as a risk with a minus sign');
  end if;
  if not (v_o <= v_l and v_l <= v_p) then
    return jsonb_build_object('error',
      format('the delay range is not ordered: optimistic %s, likely %s, pessimistic %s', v_o, v_l, v_p));
  end if;
  if not (v_p > v_o) then
    return jsonb_build_object('error',
      format('optimistic and pessimistic delay are both %s, which is a single-point estimate wearing three columns. Sampling it would produce a distribution of zero width and print a P80 identical to the plan.', v_o));
  end if;

  if (v_co is not null or v_cl is not null or v_cp is not null or v_currency is not null)
     and (v_co is null or v_cl is null or v_cp is null or v_currency is null) then
    return jsonb_build_object('error',
      'a direct cost impact is three points and a currency, or it is nothing at all. A "likely cost" on its own is the single-point estimate this act refuses for delays, wearing a currency sign.');
  end if;
  if v_co is not null then
    if v_co = 'NaN'::numeric or v_cl = 'NaN'::numeric or v_cp = 'NaN'::numeric
       or v_co = 'Infinity'::numeric or v_cl = 'Infinity'::numeric or v_cp = 'Infinity'::numeric then
      return jsonb_build_object('error', 'a cost impact must be a finite amount');
    end if;
    if v_co < 0 then
      return jsonb_build_object('error', 'a direct cost impact cannot be negative');
    end if;
    if not (v_co <= v_cl and v_cl <= v_cp) then
      return jsonb_build_object('error',
        format('the cost range is not ordered: optimistic %s, likely %s, pessimistic %s', v_co, v_cl, v_cp));
    end if;
    if not (v_cp > v_co) then
      return jsonb_build_object('error',
        format('optimistic and pessimistic cost are both %s, which is a single-point estimate wearing three columns.', v_co));
    end if;
  end if;

  if v_basis is null or length(v_basis) < 20 then
    return jsonb_build_object('error',
      'state the basis for this probability and this range (basis, 20 characters minimum). A three-point impact with no basis is three numbers somebody liked, and it will be the largest driver of a P80 an executive reads.');
  end if;

  perform set_config('app.risk_schedule_impact_write', 'granted', true);
  insert into risk_schedule_impacts
    (organization_id, development_case_id, risk_id, schedule_task_id, probability,
     delay_days_optimistic, delay_days_likely, delay_days_pessimistic,
     cost_optimistic, cost_likely, cost_pessimistic, currency, basis, recorded_by)
  values
    (v_org, c.id, r.id, t.id, v_prob, v_o, v_l, v_p,
     v_co, v_cl, v_cp, v_currency, v_basis, auth.uid())
  on conflict (risk_id, schedule_task_id) do update
    set probability = excluded.probability,
        delay_days_optimistic = excluded.delay_days_optimistic,
        delay_days_likely = excluded.delay_days_likely,
        delay_days_pessimistic = excluded.delay_days_pessimistic,
        cost_optimistic = excluded.cost_optimistic,
        cost_likely = excluded.cost_likely,
        cost_pessimistic = excluded.cost_pessimistic,
        currency = excluded.currency,
        basis = excluded.basis,
        recorded_by = excluded.recorded_by,
        recorded_at = now()
  returning id into v_id;
  perform set_config('app.risk_schedule_impact_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'risk_schedule_impact', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'impact_id', v_id, 'risk_id', r.id,
      'activity_key', v_activity_key),
    null,
    jsonb_build_object('risk_title', r.title, 'activity_key', v_activity_key,
      'probability', v_prob, 'delay_days_likely', v_l,
      'delay_days_pessimistic', v_p, 'cost_likely', v_cl, 'basis', v_basis));

  return jsonb_build_object('impact_id', v_id, 'case_id', c.id, 'risk_id', r.id,
    'risk_title', r.title, 'activity_key', v_activity_key, 'probability', v_prob,
    'delay_days_likely', v_l, 'cost_likely', v_cl);
end
$$;

revoke all on function public.record_risk_schedule_impact(uuid, jsonb) from public, anon, service_role;
grant execute on function public.record_risk_schedule_impact(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE CHAIN, WALKABLE IN DATA (D5.08).
--
--    Risk → activity → milestone → money, one row per edge, each hop stating
--    what it has and what it is missing. This is the read the simulation
--    consumes and the read the screen renders: one predicate, so a driver
--    ranked on screen is a driver the simulation actually sampled.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_risk_schedule_chain(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_links jsonb;
  v_rate jsonb;
  v_bound int := 0;
  v_linked int := 0;
  v_unlinked jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_rate := get_case_delay_cost_rate(c.id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'riskId', r.id,
           'riskTitle', r.title,
           'riskLevel', r.current_risk_level,
           'riskStatus', r.status,
           'activityId', t.id,
           'activityKey', t.task_key,
           'activityLabel', t.label,
           'activityOrigin', t.origin,
           'activityPlannedFinish', t.planned_finish,
           'wbsCode', w.wbs_code,
           'probability', i.probability,
           'delayDaysOptimistic', i.delay_days_optimistic,
           'delayDaysLikely', i.delay_days_likely,
           'delayDaysPessimistic', i.delay_days_pessimistic,
           'costOptimistic', i.cost_optimistic,
           'costLikely', i.cost_likely,
           'costPessimistic', i.cost_pessimistic,
           'currency', i.currency,
           'basis', i.basis,
           'recordedBy', (select email from user_profiles up where up.id = i.recorded_by),
           'recordedAt', i.recorded_at,
           -- The economic hop, stated per edge so the truncation is visible
           -- exactly where it happens.
           'economicHop', case
             when v_rate->>'value' is not null then format(
               'Delay converts to money at %s %s per day (%s), so this risk''s most-likely %s day(s) carry %s of delay cost before any direct cost.',
               v_rate->>'value', coalesce(v_rate->>'unit', ''), v_rate->>'source',
               i.delay_days_likely,
               round(i.delay_days_likely * (v_rate->>'value')::numeric, 0))
             else v_rate->>'refusal' end,
           'economicHopAvailable', (v_rate->>'value' is not null))
         order by i.probability * i.delay_days_likely desc), '[]'::jsonb)
    into v_links
  from risk_schedule_impacts i
  join risks r on r.id = i.risk_id
  join shutdown_tasks t on t.id = i.schedule_task_id
  left join project_wbs_elements w on w.id = t.wbs_element_id
  where i.organization_id = v_org and i.development_case_id = c.id;

  select count(*) into v_bound from risks
   where organization_id = v_org and development_case_id = c.id
     and status not in ('closed','archived');

  select count(distinct i.risk_id) into v_linked from risk_schedule_impacts i
   where i.organization_id = v_org and i.development_case_id = c.id;

  -- Named, not counted. "9 risks are not linked" tells a planner nothing
  -- about which nine.
  select coalesce(jsonb_agg(jsonb_build_object(
           'riskId', r.id, 'riskTitle', r.title, 'riskLevel', r.current_risk_level)
         order by r.current_risk_score desc nulls last, r.title), '[]'::jsonb)
    into v_unlinked
  from risks r
  where r.organization_id = v_org and r.development_case_id = c.id
    and r.status not in ('closed','archived')
    and not exists (select 1 from risk_schedule_impacts i where i.risk_id = r.id);

  return jsonb_build_object(
    'caseId', c.id,
    'links', v_links,
    'linkCount', jsonb_array_length(v_links),
    'openRiskCount', v_bound,
    'linkedRiskCount', v_linked,
    'unlinkedRisks', v_unlinked,
    'delayCostRate', v_rate,
    'coverageNote', case
      when v_bound = 0 then
        'No open risk is bound to this case, so there is no risk-driven exposure to simulate. That is a statement about the risk register, not a statement that the project is safe.'
      when v_linked = 0 then format(
        '%s open risk(s) are bound to this case and NONE names the schedule activity it threatens. Spec I.10''s chain starts at a specific activity; until a risk names one, the register can say a risk is Critical and the forecast cannot say what it costs.', v_bound)
      when v_linked < v_bound then format(
        '%s of %s open risk(s) name the activity they threaten. The other %s are in the register and outside the forecast — a simulated P80 understates exposure by exactly them, which is why they are named above rather than counted.',
        v_linked, v_bound, v_bound - v_linked)
      else format('All %s open risk(s) on this case name the activity they threaten.', v_bound) end,
    'evaluable', jsonb_array_length(v_links) > 0);
end
$$;

revoke all on function public.get_case_risk_schedule_chain(uuid) from public, anon, service_role;
grant execute on function public.get_case_risk_schedule_chain(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. THE RECORDING ACT for the linkage itself (D11.29): what the chain was
--    at the moment somebody read it, including how much of the register it
--    covers. A P80 recorded later cites this run's coverage, so "the forecast
--    excluded nine risks" is recoverable from the ledger rather than from
--    memory.
-- ---------------------------------------------------------------------------
create or replace function public.compute_case_risk_schedule_economics(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_chain jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_outputs jsonb;
  v_run uuid;
  rec record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'computing the risk-schedule-economics chain requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_chain := get_case_risk_schedule_chain(c.id);
  if v_chain ? 'error' then
    return v_chain;
  end if;

  if v_chain->'delayCostRate'->>'refusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_chain->'delayCostRate'->>'refusal');
  end if;
  if jsonb_array_length(v_chain->'unlinkedRisks') > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      '%s open risk(s) on this case name no schedule activity and are therefore outside any forecast computed from this chain: %s.',
      jsonb_array_length(v_chain->'unlinkedRisks'),
      (select string_agg(value->>'riskTitle', '; ')
         from jsonb_array_elements(v_chain->'unlinkedRisks')))::text);
  end if;
  for rec in select value as link from jsonb_array_elements(v_chain->'links') loop
    if rec.link->>'costLikely' is null then
      v_refusals := v_refusals || to_jsonb(format(
        'Risk "%s" on activity %s carries no direct cost impact, so its economic exposure is delay cost only.',
        rec.link->>'riskTitle', rec.link->>'activityKey')::text);
    end if;
  end loop;

  if coalesce((v_chain->>'evaluable')::boolean, false) = false then
    v_outputs := null;
    v_refusals := v_refusals || to_jsonb(v_chain->>'coverageNote');
  else
    v_outputs := jsonb_build_object(
      'linkCount', v_chain->'linkCount',
      'openRiskCount', v_chain->'openRiskCount',
      'linkedRiskCount', v_chain->'linkedRiskCount',
      'delayCostPerDay', v_chain->'delayCostRate'->'value',
      'delayCostSource', v_chain->'delayCostRate'->'source',
      'economicHopAvailable', to_jsonb(v_chain->'delayCostRate'->>'value' is not null));
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_risk_schedule_economics',
    'The I.10 chain as data: every recorded edge from a risk bound to this case to the schedule activity it threatens, with the edge''s own probability and three-point delay, its optional three-point direct cost, and the case cost-of-delay rate that converts days into money. Risks with no activity named are recorded as refusals BY NAME, because a forecast computed from this chain understates exposure by exactly them.',
    jsonb_build_object(
      'linkCount', v_chain->'linkCount',
      'openRiskCount', v_chain->'openRiskCount',
      'linkedRiskCount', v_chain->'linkedRiskCount',
      'delayCostPerDay', v_chain->'delayCostRate'->'value'),
    coalesce((select jsonb_agg(jsonb_build_object('table', 'risk_schedule_impacts', 'id', i.id))
                from risk_schedule_impacts i
               where i.organization_id = v_org and i.development_case_id = c.id), '[]'::jsonb),
    v_outputs,
    v_refusals);

  return v_chain || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_risk_schedule_economics'));
end
$$;

revoke all on function public.compute_case_risk_schedule_economics(uuid) from public, anon, service_role;
grant execute on function public.compute_case_risk_schedule_economics(uuid) to authenticated;

notify pgrst, 'reload schema';
