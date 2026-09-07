-- ============================================================================
-- Sync Develop — honest residual cluster (D9.12 / D9.14 / D9.16 / D9.01).
--
-- Extends the ONE stores #363 already grew: learning_events (lessons),
-- value_metrics (benefits + checkpoints), development_baselines (BENEFITS
-- anchor), ram_targets (warranty), stage_gate_reviews (gate outcomes).
-- No lesson table, no VR table, no success-score table, no phase table.
--
-- D9.12  screen_applicable_project_lessons — deterministic match, no LLM.
-- D9.14  approve_case_baseline snapshots the BENEFITS denominator; the
--        ratio refuses when that snapshot is absent, mixed, or zero.
-- D9.16  get_case_project_success — eight §55 slots, each sourced or named
--        missing. Never merely on-time + on-budget.
-- D9.01  get_case_lifecycle_success — per framework stage, so
--        on-budget-but-unreliable reads as failure when RAM is evaluable.
--
-- recommend ≠ authorize: these are reads plus a snapshot taken during the
-- existing human baseline-approval act. No new determination.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Vocabularies mirrored in src/lib/develop/realize.ts
-- ---------------------------------------------------------------------------
create or replace function public.sync_lesson_screen_stopwords()
returns text[]
language sql
immutable
as $$
  select array[
    'about','after','applies','apply','before','case','from','into',
    'lesson','project','that','this','where','with'
  ];
$$;

revoke all on function public.sync_lesson_screen_stopwords() from public, anon;
grant execute on function public.sync_lesson_screen_stopwords() to authenticated, service_role;

create or replace function public.sync_project_success_dimensions()
returns text[]
language sql
immutable
as $$
  select array[
    'safety','value','quality','schedule','cost','ram','operations','stakeholders'
  ];
$$;

revoke all on function public.sync_project_success_dimensions() from public, anon;
grant execute on function public.sync_project_success_dimensions() to authenticated, service_role;

create or replace function public.sync_significant_tokens(p_text text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(tok order by tok), array[]::text[])
  from (
    select distinct t.tok
    from unnest(regexp_split_to_array(lower(coalesce(p_text, '')), '[^a-z0-9]+')) as t(tok)
    where length(t.tok) >= 4
      and t.tok <> all (public.sync_lesson_screen_stopwords())
  ) d;
$$;

revoke all on function public.sync_significant_tokens(text) from public, anon;
grant execute on function public.sync_significant_tokens(text) to authenticated, service_role;

-- True when a recorded lesson applies to a NEW case. A case never matches
-- its own lessons. No score is computed.
create or replace function public.sync_lesson_applies_to_case(
  p_lesson_case_id uuid,
  p_source_lifecycle_type text,
  p_applicability text,
  p_case_id uuid,
  p_lifecycle_type text,
  p_title text,
  p_problem text
)
returns boolean
language plpgsql
immutable
as $$
declare
  v_app text := lower(btrim(coalesce(p_applicability, '')));
  v_life text := lower(btrim(coalesce(p_lifecycle_type, '')));
  v_life_words text;
  v_lesson_toks text[];
  v_case_toks text[];
begin
  if p_lesson_case_id is null or p_lesson_case_id = p_case_id then
    return false;
  end if;
  if length(v_app) < 10 or v_life = '' then
    return false;
  end if;
  if lower(coalesce(p_source_lifecycle_type, '')) = v_life then
    return true;
  end if;
  v_life_words := replace(v_life, '_', ' ');
  if position(v_life in v_app) > 0 or position(v_life_words in v_app) > 0 then
    return true;
  end if;
  v_lesson_toks := public.sync_significant_tokens(p_applicability);
  v_case_toks := public.sync_significant_tokens(coalesce(p_title, '') || ' ' || coalesce(p_problem, ''));
  return exists (
    select 1 from unnest(v_lesson_toks) t(tok)
    where t.tok = any (v_case_toks)
  );
end
$$;

revoke all on function public.sync_lesson_applies_to_case(uuid, text, text, uuid, text, text, text) from public, anon;
grant execute on function public.sync_lesson_applies_to_case(uuid, text, text, uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D9.12 — screen at / after case creation.
-- ---------------------------------------------------------------------------
create or replace function public.screen_applicable_project_lessons(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_lessons jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select coalesce(jsonb_agg(row_obj order by created_at desc), '[]'::jsonb)
    into v_lessons
  from (
    select jsonb_build_object(
      'id', e.id,
      'title', e.title,
      'failureModeKey', e.failure_mode_key,
      'cause', e.cause,
      'correctiveAction', e.corrective_action,
      'applicability', e.applicability,
      'sourceCaseId', e.development_case_id,
      'sourceLifecycleType', src.lifecycle_type,
      'matchReason', case
        when lower(coalesce(src.lifecycle_type, '')) = lower(c.lifecycle_type)
          then 'source case shares this lifecycle type'
        when position(lower(c.lifecycle_type) in lower(e.applicability)) > 0
          or position(replace(lower(c.lifecycle_type), '_', ' ') in lower(e.applicability)) > 0
          then 'applicability names this lifecycle type'
        else 'significant token overlap with the new case title or problem'
      end,
      'createdAt', e.created_at
    ) as row_obj,
    e.created_at
    from learning_events e
    join development_cases src
      on src.id = e.development_case_id and src.organization_id = v_org
    where e.organization_id = v_org
      and e.event_type = 'lesson_learned'
      and e.failure_mode_key = any (sync_delivery_failure_types())
      and public.sync_lesson_applies_to_case(
        e.development_case_id, src.lifecycle_type, e.applicability,
        c.id, c.lifecycle_type, c.title, c.problem_statement)
  ) matched;

  return jsonb_build_object(
    'caseId', c.id,
    'lifecycleType', c.lifecycle_type,
    'count', jsonb_array_length(v_lessons),
    'lessons', v_lessons,
    'emptyReason', case
      when jsonb_array_length(v_lessons) = 0 then
        '0 applicable lessons — none of this organization''s recorded project lessons match this case''s lifecycle type or applicability text'
      else null
    end,
    'basis', 'Deterministic match on learning_events.applicability and source-case lifecycle_type. No score. A case is never screened against its own lessons.');
end
$$;

revoke all on function public.screen_applicable_project_lessons(uuid) from public, anon;
grant execute on function public.screen_applicable_project_lessons(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D9.14 — snapshot the BENEFITS denominator on the existing approval act.
-- ---------------------------------------------------------------------------
create or replace function public.sync_benefits_denominator_snapshot(
  p_org uuid,
  p_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_units text[];
  v_sum numeric;
  v_legs jsonb;
begin
  select array_agg(distinct btrim(v.unit)),
         sum(v.value),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'label', v.label, 'value', v.value, 'unit', v.unit)
           order by v.label), '[]'::jsonb)
    into v_units, v_sum, v_legs
  from value_metrics v
  where v.organization_id = p_org
    and v.development_case_id = p_case_id
    and v.owner_id is not null
    and v.checkpoint_horizon_days is null;

  if coalesce(cardinality(v_units), 0) = 0 then
    return jsonb_build_object(
      'approvedExpectedBenefit', null,
      'approvedExpectedUnit', null,
      'approvedBenefitLegs', '[]'::jsonb,
      'mixedUnits', false,
      'snapshotNote', 'no case benefits existed at approval — the denominator is absent, not zero');
  end if;
  if cardinality(v_units) > 1 then
    return jsonb_build_object(
      'approvedExpectedBenefit', null,
      'approvedExpectedUnit', null,
      'approvedBenefitLegs', v_legs,
      'mixedUnits', true,
      'snapshotNote', 'benefits are in mixed units and cannot be combined into one denominator');
  end if;
  return jsonb_build_object(
    'approvedExpectedBenefit', v_sum,
    'approvedExpectedUnit', v_units[1],
    'approvedBenefitLegs', v_legs,
    'mixedUnits', false,
    'snapshotNote', 'frozen at BENEFITS baseline approval — later benefit edits do not rewrite this denominator');
end
$$;

revoke all on function public.sync_benefits_denominator_snapshot(uuid, uuid) from public, anon;

-- Recreated from 20261110090000 with ONE addition: a BENEFITS approval
-- freezes the denominator into content. Everything else is the prior act.
create or replace function public.approve_case_baseline(
  p_baseline_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  b development_baselines%rowtype;
  v_content jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    if coalesce(v_role, '') = 'ai_admin' then
      return jsonb_build_object('error',
        'approving a baseline is a human accountability act — the AI-operator identity cannot record one');
    end if;
    return jsonb_build_object('error', 'approving a baseline requires a governance or engineering role');
  end if;
  select * into b from development_baselines where id = p_baseline_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'baseline not found');
  end if;
  if b.status <> 'draft' then
    return jsonb_build_object('error',
      'only a draft baseline can be approved — a prior version is immutable and its approval is not overwritable');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the basis for approving this baseline (20 characters minimum)');
  end if;

  v_content := coalesce(b.content, '{}'::jsonb);
  if b.baseline_type = 'BENEFITS' then
    v_content := v_content || public.sync_benefits_denominator_snapshot(v_org, b.development_case_id);
  end if;

  perform set_config('app.baseline_write', 'granted', true);

  update development_baselines
  set status = 'superseded', superseded_at = now()
  where development_case_id = b.development_case_id
    and baseline_type = b.baseline_type
    and status = 'approved';

  update development_baselines
  set status = 'approved', approved_by = auth.uid(), approved_at = now(),
      approval_note = btrim(p_note),
      content = v_content
  where id = b.id;

  perform set_config('app.baseline_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'development_baseline', coalesce(v_role, 'unknown'),
    jsonb_build_object('baseline_id', b.id, 'case_id', b.development_case_id,
      'action', 'approved', 'baseline_type', b.baseline_type, 'version', b.version,
      'benefits_denominator_snapshotted', b.baseline_type = 'BENEFITS'));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Baseline %s v%s approved on case %s as role %s — prior approved version (if any) superseded.',
            b.baseline_type, b.version, b.development_case_id, coalesce(v_role, 'none')));

  return jsonb_build_object('baseline_id', b.id, 'baseline_type', b.baseline_type,
    'version', b.version, 'status', 'approved',
    'approvedExpectedBenefit', v_content->'approvedExpectedBenefit');
end
$$;

revoke all on function public.approve_case_baseline(uuid, text) from public, anon;
grant execute on function public.approve_case_baseline(uuid, text) to authenticated;

create or replace function public.get_case_value_realization(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  b development_baselines%rowtype;
  v_realized numeric;
  v_unverified int;
  v_ratio numeric;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select * into b from development_baselines
   where organization_id = v_org
     and development_case_id = c.id
     and baseline_type = 'BENEFITS'
     and status = 'approved';
  if not found then
    return jsonb_build_object(
      'caseId', c.id,
      'evaluable', false,
      'refusal', 'no_approved_benefits_baseline',
      'reason', 'No approved BENEFITS baseline — no Value Realization percentage (register standing constraint 3)');
  end if;

  if b.content ? 'mixedUnits' and (b.content->>'mixedUnits')::boolean then
    return jsonb_build_object(
      'caseId', c.id,
      'evaluable', false,
      'refusal', 'mixed_units',
      'reason', 'Case benefits are in mixed units and cannot be combined into one Value Realization ratio — borrowing a unit would invent the number',
      'approvedBenefitLegs', b.content->'approvedBenefitLegs');
  end if;

  if not (b.content ? 'approvedExpectedBenefit') then
    return jsonb_build_object(
      'caseId', c.id,
      'evaluable', false,
      'refusal', 'baseline_has_no_denominator_snapshot',
      'reason', 'This approved BENEFITS baseline was recorded before the denominator was snapshotted — approve a new BENEFITS baseline to freeze the expected total');
  end if;

  if b.content->>'approvedExpectedBenefit' is null
     or (b.content->>'approvedExpectedBenefit')::numeric = 0 then
    return jsonb_build_object(
      'caseId', c.id,
      'evaluable', false,
      'refusal', 'zero_denominator',
      'reason', coalesce(b.content->>'snapshotNote',
        'The approved expected benefit is zero or absent, so a Value Realization ratio would be 0 or infinite — neither is a measurement'));
  end if;

  select coalesce(sum(v.value), 0),
         count(*) filter (where v.status is distinct from 'verified')
    into v_realized, v_unverified
  from value_metrics v
  where v.organization_id = v_org
    and v.development_case_id = c.id
    and v.owner_id is not null
    and v.checkpoint_horizon_days is null
    and v.status = 'verified'
    and btrim(v.unit) = btrim(b.content->>'approvedExpectedUnit');

  v_ratio := v_realized / (b.content->>'approvedExpectedBenefit')::numeric;

  return jsonb_build_object(
    'caseId', c.id,
    'evaluable', true,
    'ratio', v_ratio,
    'unit', b.content->>'approvedExpectedUnit',
    'approvedExpectedBenefit', (b.content->>'approvedExpectedBenefit')::numeric,
    'realizedBenefit', v_realized,
    'unverifiedBenefitCount', v_unverified,
    'baselineId', b.id,
    'baselineVersion', b.version,
    'formula', 'VR = RealizedBenefit / ApprovedExpectedBenefit (spec §52)',
    'note', 'Unverified benefits are omitted from the numerator — they are not counted as zero');
end
$$;

revoke all on function public.get_case_value_realization(uuid) from public, anon;
grant execute on function public.get_case_value_realization(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared dimension helper — used by D9.16 and D9.01. Flat plpgsql: no
-- nested procedure (this chain's Postgres does not accept those).
-- ---------------------------------------------------------------------------
create or replace function public.sync_success_slot(
  p_key text, p_label text, p_verdict text, p_source text,
  p_value text, p_missing text
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    p_key, jsonb_build_object(
      'key', p_key,
      'label', p_label,
      'verdict', p_verdict,
      'source', p_source,
      'value', p_value,
      'missingReason', p_missing));
$$;

revoke all on function public.sync_success_slot(text, text, text, text, text, text) from public, anon;
grant execute on function public.sync_success_slot(text, text, text, text, text, text) to authenticated, service_role;

create or replace function public.sync_case_success_dimensions(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_ev jsonb;
  v_or jsonb;
  v_vr jsonb;
  v_risks int; v_open_high int;
  v_qr int; v_qr_open int;
  v_warranty int; v_verified_ck int; v_failed_ck int;
  v_sc int; v_sc_open int;
  v_dims jsonb := '{}'::jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- Safety: unresolved High/Critical case risks (same rule as openRiskBlockers).
  select count(*),
         count(*) filter (
           where r.current_risk_level in ('High','Critical')
             and r.status not in ('closed','archived','accepted'))
    into v_risks, v_open_high
  from risks r
  where r.organization_id = v_org and r.development_case_id = c.id;
  if coalesce(v_risks, 0) = 0 then
    v_dims := v_dims || public.sync_success_slot('safety','Safety','missing',
      'risks.development_case_id', null,
      'no risks are bound to this case — Safety is not evaluable');
  elsif v_open_high > 0 then
    v_dims := v_dims || public.sync_success_slot('safety','Safety','not_met',
      'risks (openRiskBlockers: unresolved High/Critical)',
      v_open_high::text || ' unresolved High/Critical', null);
  else
    v_dims := v_dims || public.sync_success_slot('safety','Safety','met',
      'risks (openRiskBlockers: unresolved High/Critical)',
      v_risks::text || ' bound, none unresolved High/Critical', null);
  end if;

  -- Value: the §52 ratio, or its named refusal.
  v_vr := public.get_case_value_realization(c.id);
  if coalesce(v_vr->>'evaluable', 'false') = 'true' then
    v_dims := v_dims || public.sync_success_slot('value','Value',
      case when (v_vr->>'ratio')::numeric >= 1 then 'met' else 'not_met' end,
      'get_case_value_realization',
      'VR ' || (v_vr->>'ratio'), null);
  else
    v_dims := v_dims || public.sync_success_slot('value','Value','missing',
      'get_case_value_realization', null,
      coalesce(v_vr->>'reason', 'Value Realization is not evaluable'));
  end if;

  -- Quality: case-bound quality_requirements via the ONE requirement table.
  select count(*),
         count(*) filter (where q.status = 'draft')
    into v_qr, v_qr_open
  from quality_requirements q
  join design_requirements d on d.id = q.design_requirement_id
  where q.organization_id = v_org
    and d.development_case_id = c.id;
  if coalesce(v_qr, 0) = 0 then
    v_dims := v_dims || public.sync_success_slot('quality','Quality','missing',
      'quality_requirements.design_requirement_id → design_requirements', null,
      'no quality requirements are bound to this case''s design requirements');
  elsif v_qr_open > 0 then
    v_dims := v_dims || public.sync_success_slot('quality','Quality','not_met',
      'quality_requirements bound to design_requirements',
      v_qr_open::text || ' still draft of ' || v_qr::text, null);
  else
    v_dims := v_dims || public.sync_success_slot('quality','Quality','met',
      'quality_requirements bound to design_requirements',
      v_qr::text || ' approved', null);
  end if;

  -- Schedule + Cost from the ONE earned-value predicate.
  v_ev := public.get_case_earned_value(c.id);
  if v_ev ? 'error' then
    v_dims := v_dims || public.sync_success_slot('schedule','Schedule','missing','get_case_earned_value',null,v_ev->>'error');
    v_dims := v_dims || public.sync_success_slot('cost','Cost','missing','get_case_earned_value',null,v_ev->>'error');
  else
    if v_ev#>>'{spi,refusal}' is not null then
      v_dims := v_dims || public.sync_success_slot('schedule','Schedule','missing','get_case_earned_value.spi',
        null, v_ev#>>'{spi,refusal}');
    elsif v_ev#>>'{spi,value}' is null then
      v_dims := v_dims || public.sync_success_slot('schedule','Schedule','incomplete','get_case_earned_value.spi',
        null, 'SPI is not computable on this case');
    elsif (v_ev#>>'{spi,value}')::numeric < 1 then
      v_dims := v_dims || public.sync_success_slot('schedule','Schedule','not_met','get_case_earned_value.spi',
        'SPI ' || (v_ev#>>'{spi,value}'), null);
    else
      v_dims := v_dims || public.sync_success_slot('schedule','Schedule','met','get_case_earned_value.spi',
        'SPI ' || (v_ev#>>'{spi,value}'), null);
    end if;

    if v_ev#>>'{cpi,refusal}' is not null then
      v_dims := v_dims || public.sync_success_slot('cost','Cost','missing','get_case_earned_value.cpi',
        null, v_ev#>>'{cpi,refusal}');
    elsif v_ev#>>'{cpi,value}' is null then
      v_dims := v_dims || public.sync_success_slot('cost','Cost','incomplete','get_case_earned_value.cpi',
        null, 'CPI is not computable on this case');
    elsif (v_ev#>>'{cpi,value}')::numeric < 1 then
      v_dims := v_dims || public.sync_success_slot('cost','Cost','not_met','get_case_earned_value.cpi',
        'CPI ' || (v_ev#>>'{cpi,value}'), null);
    else
      v_dims := v_dims || public.sync_success_slot('cost','Cost','met','get_case_earned_value.cpi',
        'CPI ' || (v_ev#>>'{cpi,value}'), null);
    end if;
  end if;

  -- RAM: warranty stated; failing verified checkpoint actuals are not_met.
  select count(*) into v_warranty
  from ram_targets t
  where t.organization_id = v_org
    and (t.development_case_id = c.id
         or (c.capital_project_id is not null and t.project_id = c.capital_project_id));
  select count(*) filter (where v.status = 'verified'),
         count(*) filter (
           where v.status = 'verified'
             and v.observed_value is not null
             and v.value is not null
             and (
               (v.warranted_metric in ('availability','throughput','reliability','quality')
                and v.observed_value < v.value)
               or
               (v.warranted_metric in ('maintenance_cost','energy','operating_cost')
                and v.observed_value > v.value)
             ))
    into v_verified_ck, v_failed_ck
  from value_metrics v
  where v.organization_id = v_org
    and v.development_case_id = c.id
    and v.checkpoint_horizon_days is not null
    and v.ram_target_id is not null;
  if coalesce(v_warranty, 0) = 0 then
    v_dims := v_dims || public.sync_success_slot('ram','RAM','missing','ram_targets + realization checkpoints',
      null, 'no operational warranty is recorded on this case — RAM is not warranted');
  elsif coalesce(v_failed_ck, 0) > 0 then
    v_dims := v_dims || public.sync_success_slot('ram','RAM','not_met','verified realization checkpoints vs design target',
      v_failed_ck::text || ' verified actual(s) worse than design', null);
  elsif coalesce(v_verified_ck, 0) = 0 then
    v_dims := v_dims || public.sync_success_slot('ram','RAM','incomplete','ram_targets + realization checkpoints',
      v_warranty::text || ' warranted, none verified',
      'warranty is stated but no verified actual exists — the design target is not the actual');
  else
    v_dims := v_dims || public.sync_success_slot('ram','RAM','met','verified realization checkpoints vs design target',
      v_verified_ck::text || ' verified actual(s) at or better than design', null);
  end if;

  -- Operations: the existing case ORI read.
  v_or := public.get_case_operational_readiness(c.id);
  if (v_or->>'assetCount')::int is not null and (v_or->>'assetCount')::int = 0 then
    v_dims := v_dims || public.sync_success_slot('operations','Operations','missing','get_case_operational_readiness',
      null, coalesce(v_or->>'note', 'no assets bound to operational-readiness scope'));
  elsif v_or->'hardBlockers' is not null and jsonb_array_length(v_or->'hardBlockers') > 0 then
    v_dims := v_dims || public.sync_success_slot('operations','Operations','not_met','get_case_operational_readiness',
      jsonb_array_length(v_or->'hardBlockers')::text || ' hard blocker(s)', null);
  elsif v_or->'overall' is null then
    v_dims := v_dims || public.sync_success_slot('operations','Operations','incomplete','get_case_operational_readiness',
      null, 'operational readiness has no overall figure yet');
  else
    v_dims := v_dims || public.sync_success_slot('operations','Operations','met','get_case_operational_readiness',
      'overall recorded, no hard blockers', null);
  end if;

  -- Stakeholders: commitments on this case.
  select count(*),
         count(*) filter (where s.status in ('open','breached'))
    into v_sc, v_sc_open
  from stakeholder_commitments s
  where s.organization_id = v_org and s.development_case_id = c.id;
  if coalesce(v_sc, 0) = 0 then
    v_dims := v_dims || public.sync_success_slot('stakeholders','Stakeholders','missing','stakeholder_commitments',
      null, 'no stakeholder commitments are recorded on this case');
  elsif v_sc_open > 0 then
    v_dims := v_dims || public.sync_success_slot('stakeholders','Stakeholders','not_met','stakeholder_commitments',
      v_sc_open::text || ' open or breached of ' || v_sc::text, null);
  else
    v_dims := v_dims || public.sync_success_slot('stakeholders','Stakeholders','met','stakeholder_commitments',
      v_sc::text || ' satisfied or withdrawn', null);
  end if;

  return jsonb_build_object('caseId', c.id, 'dimensions', v_dims);
end
$$;

revoke all on function public.sync_case_success_dimensions(uuid) from public, anon;
grant execute on function public.sync_case_success_dimensions(uuid) to authenticated, service_role;

create or replace function public.get_case_project_success(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_raw jsonb;
  v_list jsonb := '[]'::jsonb;
  v_key text;
  v_missing int := 0;
  v_not_met int := 0;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  v_raw := public.sync_case_success_dimensions(p_case_id);
  if v_raw ? 'error' then
    return v_raw;
  end if;

  foreach v_key in array public.sync_project_success_dimensions()
  loop
    v_list := v_list || jsonb_build_array(v_raw->'dimensions'->v_key);
    if v_raw->'dimensions'->v_key->>'verdict' in ('missing','incomplete') then
      v_missing := v_missing + 1;
    elsif v_raw->'dimensions'->v_key->>'verdict' = 'not_met' then
      v_not_met := v_not_met + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'caseId', v_raw->>'caseId',
    'dimensions', v_list,
    'missingCount', v_missing,
    'notMetCount', v_not_met,
    'headline', case
      when v_not_met > 0 then
        'Not success — at least one evaluable dimension is not met. On-time and on-budget alone are not success (spec §55).'
      when v_missing = 8 then
        'No dimension is evaluable yet — every slot is named missing rather than scored.'
      when v_missing > 0 then
        'Incomplete — ' || v_missing::text || ' dimension(s) have no source. Missing is displayed, not zeroed.'
      else
        'Every §55 dimension is evaluable and met.'
    end,
    'basis', 'Eight spec-§55 dimensions. Each slot names its source or its missing reason. No composite percentage is computed.');
end
$$;

revoke all on function public.get_case_project_success(uuid) from public, anon;
grant execute on function public.get_case_project_success(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D9.01 — per framework-stage success. Phases ARE the adopted framework
-- stages (ruling 2). Cost and RAM stay case-level and are labelled as such.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_lifecycle_success(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_dims jsonb;
  v_cost text;
  v_ram text;
  v_phases jsonb := '[]'::jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.framework_id is null then
    return jsonb_build_object(
      'caseId', c.id,
      'available', false,
      'reason', 'no governing framework — phases are the adopted framework''s stages, not invented');
  end if;

  v_dims := public.sync_case_success_dimensions(c.id);
  if v_dims ? 'error' then
    return v_dims;
  end if;
  v_cost := v_dims->'dimensions'->'cost'->>'verdict';
  v_ram := v_dims->'dimensions'->'ram'->>'verdict';

  select coalesce(jsonb_agg(phase order by seq), '[]'::jsonb)
    into v_phases
  from (
    select s.sequence as seq,
           jsonb_build_object(
             'stageKey', s.stage_key,
             'displayName', s.display_name,
             'sequence', s.sequence,
             'isCurrent', s.stage_key = c.current_stage_key,
             'gateCount', coalesce(g.gate_count, 0),
             'reviewedCount', coalesce(g.reviewed_count, 0),
             'gateVerdict', case
               when coalesce(g.gate_count, 0) = 0 then 'missing'
               when coalesce(g.failing_count, 0) > 0 then 'not_met'
               when coalesce(g.reviewed_count, 0) < coalesce(g.gate_count, 0) then 'incomplete'
               else 'met'
             end,
             'costVerdict', v_cost,
             'ramVerdict', v_ram,
             'costScope', 'case-level — earned value is not allocated per phase',
             'ramScope', 'case-level — warranty is not allocated per phase',
             'verdict', case
               when coalesce(g.failing_count, 0) > 0 then 'not_success'
               when v_ram = 'not_met' then 'not_success'
               when coalesce(g.gate_count, 0) = 0
                 or coalesce(g.reviewed_count, 0) < coalesce(g.gate_count, 0)
                 or v_cost = 'incomplete'
                 or v_ram = 'incomplete' then 'incomplete'
               when v_cost = 'not_met' then 'not_success'
               when coalesce(g.reviewed_count, 0) = coalesce(g.gate_count, 0)
                    and coalesce(g.gate_count, 0) > 0 then 'success'
               else 'incomplete'
             end,
             'onBudgetUnreliable', (v_cost in ('met','missing') and v_ram = 'not_met')
           ) as phase
    from project_framework_stages s
    left join lateral (
      select count(*) as gate_count,
             count(*) filter (where latest.outcome is not null) as reviewed_count,
             count(*) filter (
               where latest.outcome in
                 ('hold','terminate','recycle','pivot','redesign','pause')) as failing_count
      from stage_gates sg
      left join lateral (
        select r.outcome
        from stage_gate_reviews r
        where r.organization_id = v_org
          and r.development_case_id = c.id
          and r.gate_id = sg.id
        order by r.reviewed_at desc
        limit 1
      ) latest on true
      where sg.framework_id = s.framework_id
        and sg.stage_key = s.stage_key
        and sg.organization_id = v_org
    ) g on true
    where s.framework_id = c.framework_id
      and s.organization_id = v_org
  ) phases;

  return jsonb_build_object(
    'caseId', c.id,
    'available', true,
    'frameworkId', c.framework_id,
    'phases', v_phases,
    'rule', 'On-budget-but-unreliable is failure: a phase whose case-level RAM is not met is not success even when cost is met (spec I.35). Cost and RAM are case-level and labelled so — they are not invented per phase.');
end
$$;

revoke all on function public.get_case_lifecycle_success(uuid) from public, anon;
grant execute on function public.get_case_lifecycle_success(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
