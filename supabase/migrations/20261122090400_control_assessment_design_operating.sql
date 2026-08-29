-- ============================================================================
-- Sync Develop Slice 3C — ControlAssessment separates DESIGN effectiveness
-- from OPERATING effectiveness (D5.24, spec III.§14).
--
-- SPEC §14, VERBATIM: "ControlAssessment: id, control_id, assessed_at,
-- assessor_id, design_effectiveness, operating_effectiveness, confidence,
-- evidence_id. Distinguishes 'control exists' from 'control works.'"
--
-- OVERLAP-MAP RULING IS BINDING: EXTEND risk_control_tests. Six of the eight
-- §14 fields are already there (id, control_id, tested_at = assessed_at,
-- tested_by = assessor_id, evidence_item_id, plus intended_effect_observed
-- and failures_despite_control, which are richer than §14 asks). The two
-- genuinely missing are the two the spec's own sentence is about. No
-- ControlAssessment table is created.
--
-- RULINGS THIS FILE TAKES (§14 names the fields, not their vocabularies):
--
--   * FOUR-VALUE VOCABULARY, SHARED BY BOTH DIMENSIONS: effective,
--     partially_effective, ineffective, not_assessed. 'not_assessed' is an
--     explicit value rather than NULL for the dimension the assessor
--     deliberately did not examine — a design review that never looked at
--     operation should say so, and a null that could mean either "not
--     examined" or "nobody filled the field in" is the ambiguity §46's
--     refusal discipline exists to kill. Columns stay NULLABLE so the
--     thousands of pre-existing test rows remain honestly unclassified
--     rather than being back-filled with an invented judgement (the
--     20261105090000 evidence_class precedent, same reasoning).
--
--   * OPERATING EFFECTIVENESS CANNOT EXCEED AN INEFFECTIVE DESIGN. A
--     control whose design cannot prevent or detect the thing it exists for
--     did not "operate effectively" — it was not exercised by reality, or
--     it was lucky. Recording effective operation over ineffective design is
--     the precise way "control exists" gets mistaken for "control works",
--     which is the failure §14's own sentence names. REFUSED at the RPC and
--     backstopped on the table for every writer, INSERT and UPDATE.
--
--   * CONFIDENCE IS A STATED NUMBER OR ABSENT — never defaulted. A
--     confidence nobody stated is not 50%.
--
--   * THE CONTROL-LEVEL ROLLUP ONLY EVER NARROWS. record_risk_control_test's
--     existing arithmetic is byte-identical; the marked insertion CAPS the
--     resulting rating at 'ineffective' when the control's STANDING design
--     judgement — the most recent assessment that actually judged design,
--     'not_assessed' being a stated position rather than a judgement — found
--     it ineffective. Capping downward is the permitted direction: it
--     can refuse a control that the old formula would have called effective,
--     and it can never bless one the old formula refused.
-- ============================================================================

alter table public.risk_control_tests
  add column if not exists design_effectiveness text
    check (design_effectiveness is null or design_effectiveness in
      ('effective','partially_effective','ineffective','not_assessed')),
  add column if not exists operating_effectiveness text
    check (operating_effectiveness is null or operating_effectiveness in
      ('effective','partially_effective','ineffective','not_assessed')),
  add column if not exists assessment_confidence numeric
    check (assessment_confidence is null or assessment_confidence between 0 and 100);

create index if not exists idx_risk_control_tests_effectiveness
  on risk_control_tests(organization_id, control_id, tested_at desc)
  where design_effectiveness is not null or operating_effectiveness is not null;

comment on column public.risk_control_tests.design_effectiveness is
  'D5.24 / spec §14: is the control CAPABLE of modifying the risk as intended if operated as designed? "The control exists and would work." Null on pre-existing rows means unassessed — never back-filled with an invented judgement.';
comment on column public.risk_control_tests.operating_effectiveness is
  'D5.24 / spec §14: did the control actually operate as designed over the assessed period? "The control works." Cannot be recorded as effective over an ineffective design (enforce_control_assessment_coherence).';

-- ---------------------------------------------------------------------------
-- The persistence backstop. Unconditional for every writer — a row asserting
-- effective operation of an ineffective design is corrupt assessment data
-- whoever wrote it. INSERT and UPDATE both: an assessment later edited to
-- claim effective operation is the same claim with a different verb.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_control_assessment_coherence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.design_effectiveness is not distinct from old.design_effectiveness
     and new.operating_effectiveness is not distinct from old.operating_effectiveness then
    return new;
  end if;
  if new.design_effectiveness = 'ineffective'
     and new.operating_effectiveness in ('effective','partially_effective') then
    raise exception
      'Spec §14: a control whose DESIGN is ineffective cannot be recorded as operating effectively. '
      'A control that cannot prevent or detect what it exists for did not work — it was not exercised, '
      'or it was lucky. Recording effective operation over ineffective design is exactly how '
      '"the control exists" gets mistaken for "the control works".'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_control_assessment_coherence() from public, anon, authenticated;

drop trigger if exists trg_control_assessment_coherence on public.risk_control_tests;
create trigger trg_control_assessment_coherence
  before insert or update on public.risk_control_tests
  for each row execute function public.enforce_control_assessment_coherence();

-- ---------------------------------------------------------------------------
-- record_risk_control_test, RE-CREATED from its 20260921110101:1872
-- definition with SIX marked insertions, each counted (an earlier draft of
-- this comment said "exactly THREE"; a re-creation review is bounded by these
-- counts, so an undercount invites the skim that produced this slice's first
-- regression):
--   (1) the DECLARE block's §14 variables, with shape-safe casts;
--   (2) the §70 refusal of an AI-recorded §14 conclusion, the named
--       test_method refusal and the named malformed-confidence refusal;
--   (3) the §14 validation block;
--   (4) the three new columns on the INSERT;
--   (5) the downward-only rating cap, read from the control's STANDING design
--       judgement rather than this call's payload;
--   (6) the §14 keys on the audit event and the returned payload.
-- Every other line is byte-identical, including the two-year window, the
-- 100·passed/total − 20·failures score, the confidence-from-count and the
-- next-test-due arithmetic.
-- ---------------------------------------------------------------------------
create or replace function public.record_risk_control_test(p_control_id uuid, p_test jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  c risk_controls%rowtype;
  v_id uuid;
  v_total int;
  v_passed int;
  v_failures int;
  v_score numeric;
  v_rating text;
  v_trend text;
  -- D5.24 (20261122090400, marked insertion): the two §14 dimensions.
  v_design text := nullif(btrim(coalesce(p_test->>'design_effectiveness','')), '');
  v_operating text := nullif(btrim(coalesce(p_test->>'operating_effectiveness','')), '');
  -- Raw text beside the parsed value (20261122090000 section 0): a cast in a
  -- DECLARE executes before the first guard, so "abc" raised a raw 22P02
  -- while "NaN" — which parses — reached the finite check below.
  v_confidence_raw text := nullif(btrim(coalesce(p_test->>'assessment_confidence','')), '');
  v_confidence numeric := sync_text_as_numeric(v_confidence_raw);
  v_method text := nullif(btrim(coalesce(p_test->>'test_method','')), '');
  v_role text;
  -- D5.24 (20261122090400): the control's standing DESIGN judgement, which is
  -- what the rating cap reads.
  v_judged_design text;
begin
  select * into c from risk_controls where id = p_control_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','control not found in this organization'); end if;
  -- §70. Recording a §14 CONCLUSION about whether a control works is a
  -- determination, not a reading: D5.24 makes this RPC the ControlAssessment
  -- act, and its output moves risk_controls.effectiveness_rating, which the
  -- risk cockpit and every downstream treatment decision read. The AI
  -- identity may run tests; it does not judge design or operation.
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' and (v_design is not null or v_operating is not null) then
    return jsonb_build_object('error',
      'recording a §14 design or operating effectiveness conclusion is a §70 human determination — the AI-operator identity may record the test result and its observations, not the judgement');
  end if;
  if v_method is null then
    return jsonb_build_object('error','name the test method — what was actually done to exercise this control');
  end if;
  if v_confidence_raw is not null and v_confidence is null then
    return jsonb_build_object('error',
      format('assessment_confidence must be a number between 0 and 100 — "%s" is not one', v_confidence_raw));
  end if;
  if coalesce(p_test->>'result','') not in ('passed','failed','inconclusive','not_exercised') then
    return jsonb_build_object('error','invalid test result');
  end if;
  if coalesce(length(btrim(p_test->>'note')),0) < 10 then
    return jsonb_build_object('error','record what was tested and observed');
  end if;
  -- D5.24 (20261122090400, marked insertion): validate the §14 dimensions
  -- before writing. Named refusals; a non-finite confidence is refused
  -- explicitly because 'NaN'::numeric compares TRUE to itself and would
  -- otherwise slide past the range check.
  if v_design is not null and v_design not in
     ('effective','partially_effective','ineffective','not_assessed') then
    return jsonb_build_object('error',
      'design_effectiveness must be effective, partially_effective, ineffective or not_assessed (spec §14)');
  end if;
  if v_operating is not null and v_operating not in
     ('effective','partially_effective','ineffective','not_assessed') then
    return jsonb_build_object('error',
      'operating_effectiveness must be effective, partially_effective, ineffective or not_assessed (spec §14)');
  end if;
  if v_design = 'ineffective' and v_operating in ('effective','partially_effective') then
    return jsonb_build_object('error',
      'spec §14: a control whose design is ineffective cannot be recorded as operating effectively — that is exactly how "the control exists" gets mistaken for "the control works"');
  end if;
  if v_confidence is not null and (v_confidence = 'NaN'::numeric
      or v_confidence < 0 or v_confidence > 100) then
    return jsonb_build_object('error',
      'assessment_confidence is a finite percentage between 0 and 100, or absent — a confidence nobody stated is not 50%');
  end if;
  insert into risk_control_tests (
    organization_id, control_id, test_method, result, intended_effect_observed,
    failures_despite_control, evidence_item_id, note, tested_by, tested_at,
    -- D5.24 (20261122090400, marked insertion).
    design_effectiveness, operating_effectiveness, assessment_confidence
  ) values (
    v_org,c.id,v_method,p_test->>'result',
    nullif(p_test->>'intended_effect_observed','')::boolean,
    coalesce((p_test->>'failures_despite_control')::int,0),
    nullif(p_test->>'evidence_item_id','')::uuid,btrim(p_test->>'note'),auth.uid(),
    coalesce((p_test->>'tested_at')::timestamptz,now()),
    v_design, v_operating, v_confidence
  ) returning id into v_id;

  select count(*) filter (where result <> 'not_exercised'),
         count(*) filter (where result = 'passed' and intended_effect_observed),
         coalesce(sum(failures_despite_control),0)
  into v_total,v_passed,v_failures
  from risk_control_tests
  where control_id = c.id and tested_at >= now() - interval '2 years';
  if v_total = 0 then
    v_score := null; v_rating := 'unknown'; v_trend := 'unknown';
  else
    v_score := greatest(0,least(100,100.0*v_passed/v_total - 20*v_failures));
    v_rating := case when v_score >= 80 and v_failures = 0 then 'effective'
      when v_score >= 50 and v_failures = 0 then 'partial'
      when v_score > 0 then 'weak' else 'ineffective' end;
    v_trend := case when v_failures > 0 or p_test->>'result' = 'failed' then 'declining' else 'stable' end;
  end if;
  -- D5.24 (20261122090400, marked insertion): the downward-only cap, read
  -- from the control's STANDING design judgement.
  --
  -- The first draft capped on THIS call's payload, while the file header and
  -- the register both said "when the latest assessment found the DESIGN
  -- ineffective". Those are different sentences, and the difference was
  -- reachable from the shipped form: the ROS control form defaults
  -- design_effectiveness to 'not_assessed' and always submits it, so one
  -- routine walkthrough with the dropdowns untouched restored 'effective'
  -- and score 100 on a control whose last real design judgement was
  -- 'ineffective' — while get_control_assessment_history, the read this same
  -- row ships, went on reporting that judgement. Two surfaces of one slice
  -- giving opposite answers about one control.
  --
  -- 'not_assessed' is a stated position, not a judgement, so it does not
  -- clear a standing one; only a NEW design judgement does. The query
  -- includes the row just inserted, so a fresh 'effective' design lifts the
  -- cap in the same call that states it.
  select t.design_effectiveness into v_judged_design
  from risk_control_tests t
  where t.control_id = c.id
    and t.design_effectiveness is not null
    and t.design_effectiveness <> 'not_assessed'
  order by t.tested_at desc, t.id desc
  limit 1;
  if v_judged_design = 'ineffective' then
    v_rating := 'ineffective';
    v_trend := 'declining';
  elsif v_judged_design = 'partially_effective' and v_rating = 'effective' then
    v_rating := 'partial';
  end if;
  update risk_controls set effectiveness_score = v_score,
    effectiveness_rating = v_rating,
    effectiveness_confidence = least(100,v_total*20), trend = v_trend,
    last_tested_at = coalesce((p_test->>'tested_at')::timestamptz,now()),
    next_test_due = case when test_frequency_days is null then null
      else coalesce((p_test->>'tested_at')::date,current_date) + test_frequency_days end,
    updated_at = now()
  where id = c.id;
  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org,'risk_control_test',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('control_id',c.id,'test_id',v_id,'rating',v_rating,'score',v_score,
      -- D5.24 (20261122090400, marked insertion).
      'design_effectiveness',v_design,'operating_effectiveness',v_operating,
      'standing_design_effectiveness',v_judged_design,
      'assessment_confidence',v_confidence));
  return jsonb_build_object('test_id',v_id,'rating',v_rating,'score',v_score,
    'trend',v_trend,'confidence',least(100,v_total*20),
    -- D5.24 (20261122090400, marked insertion).
    'design_effectiveness',v_design,'operating_effectiveness',v_operating,
    'standing_design_effectiveness',v_judged_design,
    'assessment_confidence',v_confidence);
end;
$$;
grant execute on function public.record_risk_control_test(uuid, jsonb) to authenticated, service_role;
revoke execute on function public.record_risk_control_test(uuid,jsonb) from public, anon;

-- ---------------------------------------------------------------------------
-- The §14 read: the assessment history of a control with both dimensions
-- separated, so "exists" and "works" are two columns on the screen and not
-- one word. Consumed by the ROS cockpit read family.
-- ---------------------------------------------------------------------------
create or replace function public.get_control_assessment_history(p_control_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c risk_controls%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from risk_controls where id = p_control_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'control not found in this organization');
  end if;
  return jsonb_build_object(
    'controlId', c.id,
    'controlName', c.name,
    'effectivenessRating', c.effectiveness_rating,
    'effectivenessScore', c.effectiveness_score,
    -- The latest STATED design and operating positions, each carried
    -- separately and each null when never assessed — no midpoint, no
    -- inference from the other dimension.
    --
    -- 'not_assessed' IS a stated position and is returned as one: if the most
    -- recent assessment declined to judge operation, the current answer to
    -- "how is this control operating?" is "the last review did not look",
    -- and surfacing an older 'effective' as if it were current would present
    -- a stale judgement as a live one. The last REAL judgement is not lost
    -- either — it is returned beside it, with its date, so a screen can say
    -- both things instead of choosing one and hiding the other.
    --
    -- BOTH DIMENSIONS COME FROM ONE ASSESSMENT ROW. The first draft picked
    -- the newest non-null value per column INDEPENDENTLY, so two rows
    -- recorded minutes apart — one stating an ineffective design, one
    -- stating effective operation — reassembled on the screen into exactly
    -- the pair enforce_control_assessment_coherence refuses to let a single
    -- row assert. A rule enforced per row and broken by the read is not
    -- enforced.
    'latestDesignEffectiveness', (
      select t.design_effectiveness from risk_control_tests t
      where t.control_id = c.id
        and (t.design_effectiveness is not null or t.operating_effectiveness is not null)
      order by t.tested_at desc, t.id desc limit 1),
    'latestOperatingEffectiveness', (
      select t.operating_effectiveness from risk_control_tests t
      where t.control_id = c.id
        and (t.design_effectiveness is not null or t.operating_effectiveness is not null)
      order by t.tested_at desc, t.id desc limit 1),
    'latestAssessment', (
      select jsonb_build_object(
        'assessedAt', t.tested_at,
        'designEffectiveness', t.design_effectiveness,
        'operatingEffectiveness', t.operating_effectiveness,
        'confidence', t.assessment_confidence)
      from risk_control_tests t
      where t.control_id = c.id
        and (t.design_effectiveness is not null or t.operating_effectiveness is not null)
      order by t.tested_at desc, t.id desc limit 1),
    'lastJudgedDesignEffectiveness', (
      select jsonb_build_object('value', t.design_effectiveness, 'assessedAt', t.tested_at)
      from risk_control_tests t
      where t.control_id = c.id and t.design_effectiveness is not null
        and t.design_effectiveness <> 'not_assessed'
      order by t.tested_at desc, t.id desc limit 1),
    'lastJudgedOperatingEffectiveness', (
      select jsonb_build_object('value', t.operating_effectiveness, 'assessedAt', t.tested_at)
      from risk_control_tests t
      where t.control_id = c.id and t.operating_effectiveness is not null
        and t.operating_effectiveness <> 'not_assessed'
      order by t.tested_at desc, t.id desc limit 1),
    'assessments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'assessedAt', t.tested_at,
        'assessor', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = t.tested_by),
        'method', t.test_method,
        'result', t.result,
        'designEffectiveness', t.design_effectiveness,
        'operatingEffectiveness', t.operating_effectiveness,
        'confidence', t.assessment_confidence,
        'intendedEffectObserved', t.intended_effect_observed,
        'failuresDespiteControl', t.failures_despite_control,
        'evidenceItemId', t.evidence_item_id,
        'note', t.note)
        order by t.tested_at desc)
      from risk_control_tests t
      where t.control_id = c.id and t.organization_id = v_org
    ), '[]'::jsonb));
end
$$;

revoke all on function public.get_control_assessment_history(uuid) from public, anon;
grant execute on function public.get_control_assessment_history(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
