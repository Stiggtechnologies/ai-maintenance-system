-- ============================================================================
-- Sync Develop Slice 1 — Gate Readiness (D3.35 / D13.05, spec §45 + §80).
--
-- THE CALCULATION (spec §45, verbatim rule): GR = Σ(w_i·r_i)/Σw_i over the
-- gate's criteria, weights configurable per criterion (default 1.0) — BUT one
-- failed mandatory requirement, or a mandatory requirement NEVER ASSESSED AT
-- ALL, forces BLOCKED at any percentage. 97% readiness cannot hide an
-- unresolved mandatory safety issue, and absence is not a pass.
--
-- WHERE THE ARITHMETIC LIVES (overlap-map ruling 1 — assessGate stays the
-- single gate evaluator; no fork): the client-side calculation is an
-- EXTENSION of the assessGate family (src/lib/lifecycle/stages.ts
-- gateReadiness composes assessGate for the block verdict). This RPC repeats
-- that discipline at the DB exactly as record_case_gate_review already
-- repeats assessGate's mandatory-block (20261101090300: "The DB repeats
-- assessGate's discipline rather than trusting the caller") — a repeat of
-- the same named discipline at the persistence boundary, documented as such,
-- not a second evaluator with its own semantics. r_i is 1 for a criterion
-- explicitly 'met' in the LATEST review and 0 for everything else: not_met,
-- not_assessed, and never-assessed all score zero, because the alternative
-- is a percentage that pays out for nobody having looked.
--
-- ENFORCED TRUTH = DISPLAYED TRUTH (the #282 principle): this RPC returns
-- the per-criterion rows, the per-category rollup, the named blockers and
-- the projection in ONE query, and the Case Workspace readiness panel
-- renders exactly these rows. The latest-review semantics are the same rows
-- advance_development_case_stage and sanction_development_case enforce
-- against (reviewed_at desc, id desc).
--
-- FINDING↔CRITERION MATCHING mirrors the enforcement path exactly:
-- record_case_gate_review's mandatory-block matches findings to criteria by
-- trimmed criterion TEXT (20261101090300:404), so this calculation matches
-- the same way — a criterion this RPC scores 'met' is one the record RPC
-- would accept as met, never a looser or stricter set.
--
-- ONE FINDING PER CRITERION (the fan-out rule). Nothing in the schema makes
-- (review_id, criterion_text) unique, and a plain join would multiply every
-- count, weight and percentage by the number of duplicate findings — a
-- fabricated denominator ("mandatory 1 of 2 met" on a one-mandatory gate).
-- So every finding lookup here is a LATERAL picking exactly one row per
-- criterion: the LATEST finding (highest id) wins, which is the same winner
-- the client evaluator picks (assessGate/gateReadiness key a Map on trimmed
-- criterion text, last entry wins, and the workspace read feeds findings in
-- id order — src/lib/lifecycle/stages.ts). Duplicates cannot arrive through
-- record_case_gate_review at all (20261110090400 refuses a review carrying
-- two findings for one criterion); this LATERAL keeps the numbers honest for
-- rows that predate that refusal or arrive through the admitted-and-audited
-- service path. The closure-event subquery needs no such guard: it groups by
-- criterion and takes min(reviewed_at), which duplicate rows cannot move.
--
-- PER-CATEGORY ROLLUP (spec §44): grouped on the criterion's existing
-- category field. The spec-§44 seven (business, technical, risk,
-- cost/schedule, operations, supply, regulatory) order first; any other
-- category present (the reference seed also uses quality/value/learning)
-- follows; a criterion with NO category rolls up as 'uncategorized' —
-- VISIBLY, never silently dropped.
--
-- NAMED BLOCKERS (spec §80 — every blocker named, none invented):
--   * every mandatory criterion not explicitly met in the latest review
--     (status carried: not_met / not_assessed / never_assessed);
--   * every unresolved High/Critical risk bound to the case (D5.22
--     consumption; unresolved = not closed/archived/accepted — the
--     src/lib/develop openRiskBlockers semantics, repeated here so the RPC
--     and the client rollup name the same rows);
--   * every OPEN condition from PROCEED_WITH_CONDITIONS reviews on this
--     case (gate_conditions.status = 'open'), because an unmet condition is
--     borrowed credit from an earlier gate.
--   Risks and conditions are NAMED blockers the review must answer for; the
--   BLOCKED verdict itself is forced only by mandatory criteria (§45's
--   rule) and by a gate with no criteria at all (control-shaped without
--   being control — assessGate's refusal, repeated).
--
-- SUPPORT COUNTS (consumption of rows 4–8, no invented linkage): each
-- criterion row carries its deliverable support (total/accepted via
-- develop_deliverables.requirement_id); the case-level evidence summary
-- counts verified/unverified/rejected and AI_INFERENCE-unverified rows.
-- These are DISPLAY support only — the readiness number consumes ONLY
-- criterion satisfaction, so an unverified AI inference can never move a
-- percentage or a blocker (§70; D12.07's advisory boundary is structural).
--
-- THE CLOSURE-RATE PROJECTION (§80: "Projected gate date at current closure
-- rate") — a RATE computed from recorded history, with an honest refusal
-- below the defensible threshold. A closure event is the FIRST review at
-- which a criterion of this gate carried an explicit 'met' finding for this
-- case. The threshold is derived from what a date-granularity rate needs:
--
--   1. At least THREE closure events. A rate is an average of inter-arrival
--      intervals; n events give n−1 intervals, and an average of one
--      interval is that interval, not a trend — so two points are never
--      extrapolated (the Learn-tier standard, verbatim requirement).
--   2. An observed span of at least ONE DAY between first and last closure.
--      The projection is a DATE; a history whose entire span is sub-day
--      cannot carry date-granularity extrapolation (and a zero span would
--      divide by zero — the ≥2-distinct-timestamps requirement is subsumed
--      by this one).
--
--   rate = (events − 1) / span_days   [mean inter-arrival, closures/day]
--   projected date = max(today, last closure) + remaining / rate
--
-- Below threshold the RPC returns available:false with the spec's own
-- refusal shape — "not yet: N of 3 closure events recorded" — and the panel
-- renders that sentence. No date is ever fabricated.
--
-- Also here: the per-criterion weight column (default 1.0) with its
-- authoring path — set_gate_requirement gains p_weight (draft frameworks
-- only, as before) and create_project_framework_version carries weight on
-- the clone so a new version cannot silently reset a configured weight to
-- 1.0. provision_organization's TEMPLATE clone is deliberately untouched:
-- it copies stage-scoped template criteria whose weights are all 1.0, and
-- per-criterion weights are per-tenant configuration authored on draft
-- frameworks — noted here so the gap is visible, not silent.
--
-- SECURITY INVOKER, deliberately (get_development_case's argument, kept):
-- every consulted table carries an org-scoped read policy, and the
-- risk-sensitivity boundary applies to this aggregate exactly as it applies
-- to the ROS surfaces — a reader who cannot see a sensitive risk does not
-- see it named as a blocker here either.
-- ============================================================================

alter table public.stage_gate_criteria
  add column if not exists weight numeric not null default 1.0
    check (weight > 0);

-- ---------------------------------------------------------------------------
-- set_gate_requirement, re-created with p_weight. The old signature is
-- dropped (a defaulted parameter changes the signature); everything except
-- the weight validation and the two weight column references is identical
-- to the 20261101090400 definition — diffed at authoring time.
-- ---------------------------------------------------------------------------
drop function if exists public.set_gate_requirement(bigint, text, boolean, text, text, text, numeric, text, int);

create or replace function public.set_gate_requirement(
  p_gate_id bigint,
  p_criterion text,
  p_is_mandatory boolean,
  p_source_authority text,
  p_category text default null,
  p_evidence_type text default null,
  p_minimum_confidence numeric default null,
  p_guidance text default null,
  p_sort_order int default 100,
  p_weight numeric default 1.0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  g stage_gates%rowtype;
  f project_frameworks%rowtype;
  v_existing stage_gate_criteria%rowtype;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'authoring gate requirements requires a governance or engineering role');
  end if;
  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate not found');
  end if;
  select * into f from project_frameworks where id = g.framework_id;
  if f.status <> 'draft' then
    return jsonb_build_object('error',
      'an adopted framework version is immutable — create a new version to change its requirements');
  end if;
  if coalesce(length(btrim(p_criterion)), 0) < 5 then
    return jsonb_build_object('error', 'a requirement states what must be established (5 characters minimum)');
  end if;
  if source_authority_rank(p_source_authority) = 0 then
    return jsonb_build_object('error', 'source_authority must be one of the eight provenance tiers');
  end if;
  if p_source_authority in ('LAW','REGULATION','CORPORATE_STANDARD','CONTRACT')
     and coalesce(length(btrim(p_guidance)), 0) < 20 then
    return jsonb_build_object('error',
      'a requirement at the ' || p_source_authority || ' tier names the instrument it comes from in guidance (20 characters minimum)');
  end if;
  if p_minimum_confidence is not null and (p_minimum_confidence < 0 or p_minimum_confidence > 1) then
    return jsonb_build_object('error', 'minimum_confidence is a fraction between 0 and 1');
  end if;
  if p_weight is null or p_weight <= 0 then
    return jsonb_build_object('error',
      'weight must be a positive number — a zero-weight requirement would vanish from the readiness percentage while still rendering as a requirement');
  end if;

  select * into v_existing from stage_gate_criteria
  where organization_id = v_org and gate_id = g.id and criterion = btrim(p_criterion);

  if found and source_authority_rank(p_source_authority) > source_authority_rank(v_existing.source_authority) then
    return jsonb_build_object('error',
      format('raising this requirement''s provenance (%s to %s) is a recorded human act — use promote_requirement_authority',
             v_existing.source_authority, p_source_authority));
  end if;

  insert into stage_gate_criteria
    (organization_id, stage_key, gate_id, criterion, is_mandatory, guidance,
     sort_order, category, evidence_type, minimum_confidence, source_authority, weight)
  values
    (v_org, g.stage_key, g.id, btrim(p_criterion), coalesce(p_is_mandatory, true),
     p_guidance, coalesce(p_sort_order, 100), nullif(btrim(coalesce(p_category,'')), ''),
     nullif(btrim(coalesce(p_evidence_type,'')), ''), p_minimum_confidence, p_source_authority,
     coalesce(p_weight, 1.0))
  on conflict (gate_id, criterion) where gate_id is not null do update set
    is_mandatory = excluded.is_mandatory,
    guidance = excluded.guidance,
    sort_order = excluded.sort_order,
    category = excluded.category,
    evidence_type = excluded.evidence_type,
    minimum_confidence = excluded.minimum_confidence,
    source_authority = excluded.source_authority,
    weight = excluded.weight
  returning id into v_id;

  return jsonb_build_object('criterion_id', v_id, 'gate_id', g.id,
    'source_authority', p_source_authority, 'weight', coalesce(p_weight, 1.0));
end
$$;

revoke all on function public.set_gate_requirement(bigint, text, boolean, text, text, text, numeric, text, int, numeric) from public, anon;
grant execute on function public.set_gate_requirement(bigint, text, boolean, text, text, text, numeric, text, int, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_project_framework_version, re-created with exactly one change: the
-- requirement clone carries `weight`, so versioning a framework cannot
-- silently reset a configured weight to the default. Everything else is
-- byte-identical to the 20261101090400 definition — diffed at authoring time.
-- ---------------------------------------------------------------------------
create or replace function public.create_project_framework_version(
  p_source_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  f project_frameworks%rowtype;
  v_new uuid;
  v_version int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'versioning a project framework requires a governance or engineering role');
  end if;
  select * into f from project_frameworks where id = p_source_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'source framework not found');
  end if;
  if exists (select 1 from project_frameworks
             where organization_id = v_org and name = f.name and status = 'draft') then
    return jsonb_build_object('error', 'a draft of that framework already exists — adopt or edit it first');
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from project_frameworks where organization_id = v_org and name = f.name;

  insert into project_frameworks
    (organization_id, name, version, source, source_authority, status,
     project_classes, basis, created_by)
  values
    (v_org, f.name, v_version, f.source, f.source_authority, 'draft',
     f.project_classes,
     f.basis || format(' | Version %s drafted from version %s.', v_version, f.version),
     auth.uid())
  returning id into v_new;

  insert into project_framework_stages
    (organization_id, framework_id, stage_key, sequence, display_name,
     purpose, entry_criteria, exit_criteria)
  select organization_id, v_new, stage_key, sequence, display_name,
         purpose, entry_criteria, exit_criteria
  from project_framework_stages where framework_id = f.id;

  insert into stage_gates
    (organization_id, framework_id, stage_key, name, sequence, decision_type,
     risk_threshold, readiness_threshold, independent_assurance_required)
  select organization_id, v_new, stage_key, name, sequence, decision_type,
         risk_threshold, readiness_threshold, independent_assurance_required
  from stage_gates where framework_id = f.id;

  -- Requirements travel with their provenance tier AND promotion record —
  -- the promotion happened to this requirement's content and remains true of
  -- it in the new version; severing it would demote silently. The weight
  -- travels for the same reason: it is configuration of THIS requirement.
  insert into stage_gate_criteria
    (organization_id, stage_key, gate_id, criterion, is_mandatory, guidance,
     sort_order, category, evidence_type, minimum_confidence, source_authority,
     weight, authority_promoted_by, authority_promoted_at, authority_promotion_note)
  select sc.organization_id, sc.stage_key, ng.id, sc.criterion, sc.is_mandatory,
         sc.guidance, sc.sort_order, sc.category, sc.evidence_type,
         sc.minimum_confidence, sc.source_authority,
         sc.weight, sc.authority_promoted_by, sc.authority_promoted_at, sc.authority_promotion_note
  from stage_gate_criteria sc
  join stage_gates og on og.id = sc.gate_id and og.framework_id = f.id
  join stage_gates ng on ng.framework_id = v_new
    and ng.stage_key = og.stage_key and ng.name = og.name;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'project_framework', coalesce(v_role, 'unknown'),
    jsonb_build_object('framework_id', v_new, 'action', 'version_created',
      'from_version', f.version, 'version', v_version));

  return jsonb_build_object('framework_id', v_new, 'version', v_version, 'status', 'draft');
end
$$;

revoke all on function public.create_project_framework_version(uuid) from public, anon;
grant execute on function public.create_project_framework_version(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The readiness read: one query, the rows the screen renders.
-- ---------------------------------------------------------------------------
create or replace function public.get_gate_readiness(
  p_case_id uuid,
  p_gate_id bigint
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  g stage_gates%rowtype;
  v_review_id bigint;
  v_reviewed_at timestamptz;
  v_outcome text;
  v_criteria jsonb;
  v_categories jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_criteria_total int;
  v_mandatory_total int;
  v_mandatory_met int;
  v_remaining int;
  v_weight_sum numeric;
  v_weighted_met numeric;
  v_readiness numeric;
  v_blocked boolean;
  v_events int;
  v_span_days numeric;
  v_first_closure timestamptz;
  v_last_closure timestamptz;
  v_rate numeric;
  v_projection jsonb;
  v_evidence jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate not found');
  end if;
  if c.framework_id is null or g.framework_id <> c.framework_id then
    return jsonb_build_object('error', 'that gate does not belong to this case''s framework');
  end if;

  -- The operative review: latest wins (the same ordering the gate blockers
  -- enforce against).
  select r.id, r.reviewed_at, r.outcome into v_review_id, v_reviewed_at, v_outcome
  from stage_gate_reviews r
  where r.organization_id = v_org
    and r.development_case_id = c.id and r.gate_id = g.id
  order by r.reviewed_at desc, r.id desc
  limit 1;

  -- Per-criterion rows: text-matched to the latest review's findings, the
  -- record RPC's own matching rule — one finding per criterion, latest wins
  -- (the header's fan-out rule; a plain join would multiply every count by
  -- the number of duplicate findings).
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', sc.id,
      'criterion', sc.criterion,
      'category', coalesce(nullif(btrim(sc.category), ''), 'uncategorized'),
      'isMandatory', sc.is_mandatory,
      'weight', sc.weight,
      'sourceAuthority', sc.source_authority,
      'evidenceType', sc.evidence_type,
      'status', coalesce(fi.status, 'never_assessed'),
      'findingEvidence', fi.evidence,
      'deliverables', (
        select jsonb_build_object(
          'total', count(*),
          'accepted', count(*) filter (where d.status = 'accepted'))
        from develop_deliverables d
        where d.requirement_id = sc.id and d.development_case_id = c.id
          and d.organization_id = v_org))
      order by sc.sort_order, sc.criterion), '[]'::jsonb),
    count(*),
    count(*) filter (where sc.is_mandatory),
    count(*) filter (where sc.is_mandatory and coalesce(fi.status, '') = 'met'),
    count(*) filter (where coalesce(fi.status, '') <> 'met'),
    coalesce(sum(sc.weight), 0),
    coalesce(sum(sc.weight) filter (where coalesce(fi.status, '') = 'met'), 0)
  into v_criteria, v_criteria_total, v_mandatory_total, v_mandatory_met,
       v_remaining, v_weight_sum, v_weighted_met
  from stage_gate_criteria sc
  left join lateral (
    select f.status, f.evidence
    from stage_gate_findings f
    where f.review_id = v_review_id
      and btrim(f.criterion_text) = btrim(sc.criterion)
    order by f.id desc
    limit 1
  ) fi on true
  where sc.organization_id = v_org and sc.gate_id = g.id;

  -- GR = Σ(w·r)/Σw. Null — not 0, not 100 — when the gate defines nothing:
  -- 0/0 is not a readiness, and rendering one would be an invented number.
  v_readiness := case when v_weight_sum > 0
    then round((v_weighted_met / v_weight_sum) * 100, 1) end;

  -- BLOCKED (spec §45): a mandatory criterion not explicitly met — including
  -- never assessed — blocks at ANY percentage. A gate with no criteria
  -- blocks because it can block nothing (assessGate's refusal, repeated).
  v_blocked := v_criteria_total = 0 or v_mandatory_met < v_mandatory_total;

  -- Per-category rollup: §44 seven first, others after, uncategorized LAST
  -- and visible.
  select coalesce(jsonb_agg(row_obj order by cat_rank, category), '[]'::jsonb)
  into v_categories
  from (
    select
      coalesce(nullif(btrim(sc.category), ''), 'uncategorized') as category,
      case coalesce(nullif(btrim(sc.category), ''), 'uncategorized')
        when 'business' then 1 when 'technical' then 2 when 'risk' then 3
        when 'cost_schedule' then 4 when 'operations' then 5
        when 'supply' then 6 when 'regulatory' then 7
        when 'uncategorized' then 99 else 50 end as cat_rank,
      jsonb_build_object(
        'category', coalesce(nullif(btrim(sc.category), ''), 'uncategorized'),
        'criteriaTotal', count(*),
        'mandatoryTotal', count(*) filter (where sc.is_mandatory),
        'metCount', count(*) filter (where coalesce(fi.status, '') = 'met'),
        'unmetMandatory', count(*) filter (where sc.is_mandatory and coalesce(fi.status, '') <> 'met'),
        'weightSum', coalesce(sum(sc.weight), 0),
        'readinessPct', case when coalesce(sum(sc.weight), 0) > 0
          then round((coalesce(sum(sc.weight) filter (where coalesce(fi.status, '') = 'met'), 0)
                      / sum(sc.weight)) * 100, 1) end
      ) as row_obj
    from stage_gate_criteria sc
    left join lateral (
      select f.status
      from stage_gate_findings f
      where f.review_id = v_review_id
        and btrim(f.criterion_text) = btrim(sc.criterion)
      order by f.id desc
      limit 1
    ) fi on true
    where sc.organization_id = v_org and sc.gate_id = g.id
    group by coalesce(nullif(btrim(sc.category), ''), 'uncategorized')
  ) grouped;

  -- Named blockers: unmet mandatory criteria + unresolved High/Critical case
  -- risks + open conditions on this case. Each named and typed; none invented.
  select v_blockers || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'mandatory_criterion',
      'id', sc.id,
      'name', sc.criterion,
      'status', coalesce(fi.status, 'never_assessed'),
      'category', coalesce(nullif(btrim(sc.category), ''), 'uncategorized'))
      order by sc.sort_order, sc.criterion), '[]'::jsonb)
  into v_blockers
  from stage_gate_criteria sc
  left join lateral (
    select f.status
    from stage_gate_findings f
    where f.review_id = v_review_id
      and btrim(f.criterion_text) = btrim(sc.criterion)
    order by f.id desc
    limit 1
  ) fi on true
  where sc.organization_id = v_org and sc.gate_id = g.id
    and sc.is_mandatory and coalesce(fi.status, '') <> 'met';

  select v_blockers || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'open_risk',
      'id', r.id,
      'name', r.title,
      'level', r.current_risk_level,
      'status', r.status)
      order by case r.current_risk_level when 'Critical' then 0 else 1 end, r.title), '[]'::jsonb)
  into v_blockers
  from risks r
  where r.organization_id = v_org and r.development_case_id = c.id
    and r.current_risk_level in ('High', 'Critical')
    and r.status not in ('closed', 'archived', 'accepted');

  select v_blockers || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'open_condition',
      'id', gc.id,
      'name', gc.description,
      'dueDate', gc.due_date,
      'overdue', gc.due_date < current_date,
      'gate', g2.name)
      order by gc.due_date), '[]'::jsonb)
  into v_blockers
  from gate_conditions gc
  join stage_gate_reviews r2 on r2.id = gc.review_id
  left join stage_gates g2 on g2.id = r2.gate_id
  where gc.organization_id = v_org
    and r2.development_case_id = c.id
    and gc.status = 'open';

  -- Case evidence summary — display support only; the readiness number never
  -- consumes it, so an unverified AI inference cannot move anything (§70).
  select jsonb_build_object(
    'total', count(*),
    'verified', count(*) filter (where e.verification_status = 'verified'),
    'rejected', count(*) filter (where e.verification_status = 'rejected'),
    'unverified', count(*) filter (where e.verification_status = 'unverified'),
    'aiInferenceUnverified', count(*) filter
      (where e.evidence_class = 'AI_INFERENCE' and e.verification_status <> 'verified'))
  into v_evidence
  from evidence_items e
  where e.organization_id = v_org and e.development_case_id = c.id;

  -- The closure-rate projection, with its refusal (header: the derivation).
  select count(*), min(closed_at), max(closed_at)
  into v_events, v_first_closure, v_last_closure
  from (
    select min(r.reviewed_at) as closed_at
    from stage_gate_criteria sc
    join stage_gate_findings fi
      on btrim(fi.criterion_text) = btrim(sc.criterion) and fi.status = 'met'
    join stage_gate_reviews r
      on r.id = fi.review_id
     and r.organization_id = v_org
     and r.development_case_id = c.id and r.gate_id = g.id
    where sc.organization_id = v_org and sc.gate_id = g.id
    group by sc.id
  ) closures;

  v_span_days := case when v_events >= 2
    then extract(epoch from (v_last_closure - v_first_closure)) / 86400.0 end;

  if v_remaining = 0 and v_criteria_total > 0 then
    v_projection := jsonb_build_object(
      'available', false,
      'closureEvents', v_events,
      'requiredEvents', 3,
      'remaining', 0,
      'reason', 'nothing remaining — every criterion is met on the latest review');
  elsif v_events < 3 then
    v_projection := jsonb_build_object(
      'available', false,
      'closureEvents', v_events,
      'requiredEvents', 3,
      'remaining', v_remaining,
      'reason', format('not yet: %s of 3 closure events recorded for this gate''s criteria — a rate is an average of intervals, and fewer than three closures gives it nothing defensible to average', v_events));
  elsif v_span_days < 1 then
    v_projection := jsonb_build_object(
      'available', false,
      'closureEvents', v_events,
      'requiredEvents', 3,
      'remaining', v_remaining,
      'spanDays', round(v_span_days, 3),
      'reason', 'not yet: the recorded closures span less than one day — a date-granularity projection cannot stand on a sub-day history');
  else
    v_rate := (v_events - 1) / v_span_days;
    -- Days-to-close is computed as remaining·span/(events−1) — algebraically
    -- remaining/rate, but with ONE division instead of two: dividing by the
    -- already-divided rate lets numeric representation error (2/(2/13) =
    -- 13.000…033) leak through ceil() as a whole extra day.
    v_projection := jsonb_build_object(
      'available', true,
      'closureEvents', v_events,
      'requiredEvents', 3,
      'remaining', v_remaining,
      'spanDays', round(v_span_days, 2),
      'ratePerDay', round(v_rate, 4),
      'projectedDate', (greatest(now(), v_last_closure)
        + make_interval(days => ceil(v_remaining * v_span_days / (v_events - 1))::int))::date);
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'gateId', g.id,
    'gateName', g.name,
    'decisionType', g.decision_type,
    'readinessThreshold', g.readiness_threshold,
    'blocked', v_blocked,
    'readinessPct', v_readiness,
    'weightSum', v_weight_sum,
    'criteriaTotal', v_criteria_total,
    'mandatoryTotal', v_mandatory_total,
    'mandatoryMet', v_mandatory_met,
    'latestReview', case when v_review_id is null then null else jsonb_build_object(
      'id', v_review_id, 'outcome', v_outcome, 'reviewedAt', v_reviewed_at) end,
    'criteria', v_criteria,
    'categories', v_categories,
    'blockers', v_blockers,
    'evidenceSummary', v_evidence,
    'projection', v_projection);
end
$$;

revoke all on function public.get_gate_readiness(uuid, bigint) from public, anon;
grant execute on function public.get_gate_readiness(uuid, bigint) to authenticated;

notify pgrst, 'reload schema';
