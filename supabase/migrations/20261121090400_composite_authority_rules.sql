-- ============================================================================
-- Sync Develop Slice 3B — composite authority rules on the versioned rule-set
-- family (D3.34 + D11.28, spec III.§43 and §71-78), and the act-site family
-- re-created around the ONE shared predicate.
--
-- WHAT A COMPOSITE RULE IS. The 3A tailoring rules SELECT a framework and may
-- floor an intensity; they consume value bands and lifecycle types. What the
-- spec's rules engine adds (§71-78: "IF value > $100M AND risk >= HIGH THEN
-- independent assurance") is a CONJUNCTION over the determination's own
-- factors whose consequence is an ENFORCEABLE DEMAND, not a selection. So:
--
--   * governance_composite_rules rides governance_tailoring_rule_sets — the
--     versioned, one-adopted-per-org, provenance-fenced family from
--     20261120090200. No second rule store, no second versioning discipline;
--     create_governance_rule_set_version clones composite rules with the
--     tailoring rules (re-created below, marked) so succession cannot
--     silently disarm them.
--   * CONDITIONS ARE CONJUNCTIVE and evaluated over the case's CURRENT
--     determination (its frozen factor levels and stated ratings): value
--     band (1-4 against the determination's own thresholds), risk rating,
--     intensity, novelty. All stated conditions must hold; null means "not
--     part of this rule's conjunction"; a rule stating NO condition is
--     refused at authoring — an always-on demand is a binding, and bindings
--     already exist.
--   * THE ONE ENFORCEABLE CONSEQUENCE SHIPPED: independent_assurance_required
--     — a COMPLETED, acceptable, INDEPENDENT risk_assurance_review of the
--     case (subject_type='development_case', the D3.17 family, whose
--     independence the DB itself enforces) must exist before any gate of the
--     case passes. The vocabulary is a check constraint: a consequence
--     nothing enforces cannot be recorded, so the register can never carry
--     a rules-engine ✅ over demands that are display-only.
--   * EVALUATION LIVES IN case_binding_gate_demands — the ONE predicate, now
--     three arms (adopted-binding demands; LAPSED-WAIVER reversion, D3.20;
--     composite demands) with the same five consumers: the review trigger,
--     record_case_gate_review, advance, sanction, and the governance read.
--     No parallel evaluator (ruling 1's mirror).
--
-- THE PREDICATE'S NEW SHAPE (consumers in this file re-created around it):
--   null                      -> nothing armed or everything met (unchanged)
--   jsonb {                   -> at least one arm demands something
--     intensity_level,          (null when no determination exists —
--     binding_level,             the waiver arm needs none)
--     binding_version,
--     unlinked_mandatory: [],   binding arm (waiver-exempt, D3.19)
--     non_independent_gates: [],binding arm
--     waiver_reverted: [],      lapsed-waiver arm (D3.20 auto-reversion):
--                               the unmet criterion WAS covered by a waiver
--                               that has since lapsed
--     criteria_unmet: [],       same latest-pass gap where NO waiver ever
--                               stood — named as what it is (a criterion
--                               without a met finding), because a refusal
--                               that says "your waiver lapsed" to a case
--                               that never held one misdirects the remedy
--     composite_unmet: [] }     composite arm (D3.34/D11.28)
--
-- WAIVER SEMANTICS AT THE ACTS (D3.19/D3.20, completing 20261121090100):
--   * record_case_gate_review: an APPROVED, UNEXPIRED waiver stands in for
--     an unmet mandatory criterion (the waived list is returned and
--     audited); expiry re-blocks the same recording with no further act.
--   * the waiver_reverted arm: a gate whose LATEST passing review leaned on
--     a waiver that has since lapsed no longer carries advance or sanction —
--     no silent permanence, enforced where the acts happen.
--   * the binding's evidence arm exempts actively-waived criteria: a waived
--     requirement does not demand an accepted deliverable while waived.
--
-- D3.07 ALSO LANDS IN record_case_gate_review here (column and ruling in
-- 20261121090200): a passing outcome at a sanction-type gate without the
-- zero-based funding answer is refused; the answer is stored on the review.
--
-- Every re-created function below is assembled from its latest definition
-- with marked insertions, the 20261120090300 discipline.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The composite rules, riding the versioned rule-set family.
-- ---------------------------------------------------------------------------
create table if not exists public.governance_composite_rules (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  rule_set_id uuid not null references governance_tailoring_rule_sets(id) on delete cascade,
  priority int not null check (priority > 0),
  description text not null check (btrim(description) <> ''),
  -- The conjunction. Null = not part of this rule. At least one stated.
  min_value_level int check (min_value_level is null or min_value_level between 1 and 4),
  min_risk_rating text check (min_risk_rating is null or min_risk_rating in ('low','medium','high','critical')),
  min_intensity text check (min_intensity is null or min_intensity in ('light','standard','elevated','full')),
  min_novelty text check (min_novelty is null or min_novelty in ('proven','incremental','adapted','first_of_a_kind')),
  consequence text not null check (consequence in ('independent_assurance_required')),
  created_at timestamptz not null default now(),
  unique (rule_set_id, priority),
  check (min_value_level is not null or min_risk_rating is not null
         or min_intensity is not null or min_novelty is not null)
);

create index if not exists idx_composite_rules_set
  on governance_composite_rules(rule_set_id, priority);

alter table public.governance_composite_rules enable row level security;
drop policy if exists governance_composite_rules_read on public.governance_composite_rules;
create policy governance_composite_rules_read on public.governance_composite_rules
  for select to authenticated using (organization_id = app_current_org());

-- The same §70-adjacent provenance backstop as the rest of the arming data
-- (20261120090200): clients refused even RLS-bypassed; service admitted AND
-- audited. Its own function so the refusal can name this family's verbs.
create or replace function public.enforce_composite_rule_provenance()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.governance_config_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  v_id text := case when tg_op = 'DELETE' then old.id::text else new.id::text end;
begin
  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Composite authority rule ' || v_id || ' written (' || lower(tg_op) ||
           ') by a service caller outside the governance authoring RPCs. ' ||
           'Composite rules decide when independent assurance is demanded of a gate, ' ||
           'so an unaudited rewrite would arm or disarm enforcement silently.');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'Composite authority rules are written only through their authoring RPCs '
      '(add_composite_authority_rule, create_governance_rule_set_version, '
      'adopt_governance_rule_set). A direct write would change when independent '
      'assurance is demanded without the recorded act.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_composite_rules_provenance on public.governance_composite_rules;
create trigger trg_composite_rules_provenance
  before insert or update or delete on public.governance_composite_rules
  for each row execute function public.enforce_composite_rule_provenance();

-- ---------------------------------------------------------------------------
-- 2. Authoring (draft rule sets only, the add_tailoring_rule discipline).
-- ---------------------------------------------------------------------------
create or replace function public.add_composite_authority_rule(
  p_rule_set_id uuid,
  p_priority int,
  p_description text,
  p_consequence text,
  p_min_value_level int default null,
  p_min_risk_rating text default null,
  p_min_intensity text default null,
  p_min_novelty text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  rs governance_tailoring_rule_sets%rowtype;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'authoring composite authority rules requires a governance or engineering role');
  end if;
  select * into rs from governance_tailoring_rule_sets
  where id = p_rule_set_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'rule set not found');
  end if;
  if rs.status <> 'draft' then
    return jsonb_build_object('error', 'an adopted rule set is immutable — draft a new version to change it');
  end if;
  if p_priority is null or p_priority < 1 then
    return jsonb_build_object('error', 'priority is a positive integer');
  end if;
  if coalesce(length(btrim(p_description)), 0) < 10 then
    return jsonb_build_object('error', 'a composite rule states what it demands and why (10 characters minimum)');
  end if;
  if p_consequence is distinct from 'independent_assurance_required' then
    return jsonb_build_object('error',
      'consequence must be one this platform ENFORCES — currently independent_assurance_required (a demand nothing enforces would be display wearing a rule''s name)');
  end if;
  if p_min_value_level is not null and p_min_value_level not between 1 and 4 then
    return jsonb_build_object('error', 'min_value_level is a band 1-4 against the adopted value thresholds');
  end if;
  if p_min_risk_rating is not null and governance_factor_rating_level('risk', p_min_risk_rating) = 0 then
    return jsonb_build_object('error', 'min_risk_rating must be low, medium, high or critical');
  end if;
  if p_min_intensity is not null and governance_intensity_rank(p_min_intensity) = 0 then
    return jsonb_build_object('error', 'min_intensity must be light, standard, elevated or full');
  end if;
  if p_min_novelty is not null and governance_factor_rating_level('novelty', p_min_novelty) = 0 then
    return jsonb_build_object('error', 'min_novelty must be proven, incremental, adapted or first_of_a_kind');
  end if;
  if p_min_value_level is null and p_min_risk_rating is null
     and p_min_intensity is null and p_min_novelty is null then
    return jsonb_build_object('error',
      'a composite rule states at least one condition — an unconditional demand is an intensity binding, and bindings already exist (set_intensity_binding)');
  end if;

  perform set_config('app.governance_config_write', 'granted', true);
  insert into governance_composite_rules
    (organization_id, rule_set_id, priority, description,
     min_value_level, min_risk_rating, min_intensity, min_novelty, consequence)
  values
    (v_org, rs.id, p_priority, btrim(p_description),
     p_min_value_level, p_min_risk_rating, p_min_intensity, p_min_novelty, p_consequence)
  on conflict (rule_set_id, priority) do update set
    description = excluded.description,
    min_value_level = excluded.min_value_level,
    min_risk_rating = excluded.min_risk_rating,
    min_intensity = excluded.min_intensity,
    min_novelty = excluded.min_novelty,
    consequence = excluded.consequence
  returning id into v_id;
  perform set_config('app.governance_config_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'governance_composite_rule', coalesce(v_role, 'unknown'),
    jsonb_build_object('rule_id', v_id, 'rule_set_id', rs.id, 'priority', p_priority,
      'consequence', p_consequence,
      'conditions', jsonb_build_object(
        'min_value_level', p_min_value_level, 'min_risk_rating', p_min_risk_rating,
        'min_intensity', p_min_intensity, 'min_novelty', p_min_novelty)));

  return jsonb_build_object('rule_id', v_id, 'priority', p_priority,
    'consequence', p_consequence);
end
$$;

revoke all on function public.add_composite_authority_rule(uuid, int, text, text, int, text, text, text) from public, anon;
grant execute on function public.add_composite_authority_rule(uuid, int, text, text, int, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE ONE PREDICATE, re-stated with its three arms (header contract).
--    Same signature, same grants, same consumers — plus the two new arms.
-- ---------------------------------------------------------------------------
create or replace function public.case_binding_gate_demands(
  p_case_id uuid,
  p_gate_ids bigint[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gov development_case_governance%rowtype;
  v_bind governance_intensity_bindings%rowtype;
  v_rs governance_tailoring_rule_sets%rowtype;
  c development_cases%rowtype;
  r governance_composite_rules%rowtype;
  v_gates bigint[];
  v_unlinked text[] := '{}';
  v_non_independent text[] := '{}';
  v_waiver_reverted text[] := '{}';
  v_criteria_unmet text[] := '{}';
  v_composite text[] := '{}';
  v_assured boolean;
begin
  select * into c from development_cases where id = p_case_id;
  if c.id is null then
    return null;
  end if;

  -- Scope: the given gates, else every blocking gate of the case's current
  -- stage — the exact set advance/sanction rest their latest-review
  -- predicate on (20261101090300/20261101090500).
  if p_gate_ids is null then
    select coalesce(array_agg(g.id), '{}') into v_gates
    from stage_gates g
    where g.framework_id = c.framework_id
      and g.stage_key = c.current_stage_key
      and exists (select 1 from stage_gate_criteria sc
                  where sc.gate_id = g.id and sc.is_mandatory);
  else
    v_gates := p_gate_ids;
  end if;

  -- THE LAPSED-WAIVER ARM (D3.20 — needs no determination: the mandatory
  -- rule it reverts to is unconditional). A gate whose LATEST review passes
  -- while a mandatory criterion holds no met finding and no ACTIVE waiver
  -- no longer carries the case. Refusal-first means naming the actual gap,
  -- so the rows split on whether a waiver ever lapsed over the criterion:
  -- waiver_reverted (a waiver stood and has lapsed — obtain a new one or
  -- re-satisfy) vs criteria_unmet (no waiver ever stood — the stored pass
  -- simply does not answer the criterion; service-recorded reviews and
  -- post-review criterion changes land here).
  select
    coalesce(array_agg(x.gate_name || ' — ' || x.criterion order by x.gate_name, x.criterion)
             filter (where x.waiver_lapsed), '{}'),
    coalesce(array_agg(x.gate_name || ' — ' || x.criterion order by x.gate_name, x.criterion)
             filter (where not x.waiver_lapsed), '{}')
  into v_waiver_reverted, v_criteria_unmet
  from (
    select g.name as gate_name, sc.criterion,
           exists (
             select 1 from standard_site_variances w2
             where w2.subject_type = 'gate_requirement'
               and w2.development_case_id = c.id and w2.requirement_id = sc.id
               and (w2.status = 'expired'
                    or (w2.status = 'approved' and w2.expires_at <= now()))
           ) as waiver_lapsed
    from stage_gates g
    join lateral (
      select rv.id from stage_gate_reviews rv
      where rv.organization_id = c.organization_id
        and rv.development_case_id = c.id and rv.gate_id = g.id
      order by rv.reviewed_at desc, rv.id desc
      limit 1
    ) lr on true
    join stage_gate_reviews lrow on lrow.id = lr.id
    join stage_gate_criteria sc on sc.gate_id = g.id and sc.is_mandatory
    where g.id = any(v_gates)
      and lrow.outcome in ('proceed','proceed_with_conditions')
      and not exists (
        select 1 from stage_gate_findings f
        where f.review_id = lrow.id
          and btrim(f.criterion_text) = btrim(sc.criterion)
          and f.status = 'met')
      and not exists (
        select 1 from standard_site_variances w
        where w.subject_type = 'gate_requirement'
          and w.development_case_id = c.id and w.requirement_id = sc.id
          and w.status = 'approved' and w.expires_at > now())
  ) x;

  select * into v_gov from development_case_governance
  where development_case_id = p_case_id and status = 'current';

  if v_gov.id is not null then
    v_bind := resolve_case_intensity_binding(v_gov.organization_id, v_gov.intensity_level);

    if v_bind.id is not null and v_bind.evidence_linked_deliverables_required then
      -- Actively-waived criteria do not demand a deliverable (D3.19): the
      -- waiver suspends the requirement, evidence demand included — and its
      -- lapse restores both through the arm above and this one.
      select coalesce(array_agg(sc.criterion order by sc.gate_id, sc.sort_order), '{}')
      into v_unlinked
      from stage_gate_criteria sc
      where sc.organization_id = v_gov.organization_id
        and sc.gate_id = any(v_gates) and sc.is_mandatory
        and not exists (
          select 1 from develop_deliverables d
          where d.organization_id = v_gov.organization_id
            and d.development_case_id = p_case_id
            and d.requirement_id = sc.id
            and d.status = 'accepted'
        )
        and not exists (
          select 1 from standard_site_variances w
          where w.subject_type = 'gate_requirement'
            and w.development_case_id = p_case_id and w.requirement_id = sc.id
            and w.status = 'approved' and w.expires_at > now()
        );
    end if;

    -- A stored passing LATEST review recorded by the sponsor/creator does not
    -- satisfy an independent-assurance binding, whenever it was recorded.
    if v_bind.id is not null and v_bind.independent_assurance_required then
      select coalesce(array_agg(g.name order by g.sequence), '{}')
      into v_non_independent
      from stage_gates g
      where g.id = any(v_gates)
        and exists (
          select 1 from (
            select rv.outcome, rv.reviewed_by
            from stage_gate_reviews rv
            where rv.organization_id = v_gov.organization_id
              and rv.development_case_id = p_case_id
              and rv.gate_id = g.id
            order by rv.reviewed_at desc, rv.id desc
            limit 1
          ) lr
          where lr.outcome in ('proceed','proceed_with_conditions')
            and lr.reviewed_by is not null
            and (lr.reviewed_by = c.sponsor_id or lr.reviewed_by = c.created_by)
        );
    end if;

    -- THE COMPOSITE ARM (D3.34/D11.28): conjunctions over the determination's
    -- own frozen factors, read from the ONE adopted rule set. The flagship
    -- consequence demands a COMPLETED, acceptable, INDEPENDENT assurance
    -- review of the case — the D3.17 family, whose independence the DB
    -- enforces, so the demand cannot be met by the sponsor reviewing
    -- themselves.
    select * into v_rs from governance_tailoring_rule_sets
    where organization_id = v_gov.organization_id and status = 'adopted'
    order by adopted_at desc limit 1;
    if v_rs.id is not null then
      v_assured := exists (
        select 1 from risk_assurance_reviews ar
        where ar.organization_id = v_gov.organization_id
          and ar.subject_type = 'development_case' and ar.subject_id = p_case_id
          and ar.assurance_level = 'independent' and ar.status = 'completed'
          and ar.conclusion in ('acceptable','acceptable_with_actions'));
      for r in select * from governance_composite_rules
               where rule_set_id = v_rs.id order by priority loop
        if (r.min_value_level is null
              or coalesce((v_gov.factor_levels->>'value')::int, 0) >= r.min_value_level)
           and (r.min_risk_rating is null
              or governance_factor_rating_level('risk', coalesce(v_gov.factor_inputs->>'risk','')) >=
                 governance_factor_rating_level('risk', r.min_risk_rating))
           and (r.min_intensity is null
              or governance_intensity_rank(v_gov.intensity_level) >= governance_intensity_rank(r.min_intensity))
           and (r.min_novelty is null
              or governance_factor_rating_level('novelty', coalesce(v_gov.factor_inputs->>'novelty','')) >=
                 governance_factor_rating_level('novelty', r.min_novelty))
        then
          if r.consequence = 'independent_assurance_required' and not v_assured then
            v_composite := array_append(v_composite, r.description);
          end if;
        end if;
      end loop;
    end if;
  end if;

  if coalesce(array_length(v_unlinked, 1), 0) = 0
     and coalesce(array_length(v_non_independent, 1), 0) = 0
     and coalesce(array_length(v_waiver_reverted, 1), 0) = 0
     and coalesce(array_length(v_criteria_unmet, 1), 0) = 0
     and coalesce(array_length(v_composite, 1), 0) = 0 then
    return null;
  end if;
  return jsonb_build_object(
    'intensity_level', v_gov.intensity_level,
    'binding_level', v_bind.intensity_level,
    'binding_version', v_bind.version,
    'unlinked_mandatory', to_jsonb(v_unlinked),
    'non_independent_gates', to_jsonb(v_non_independent),
    'waiver_reverted', to_jsonb(v_waiver_reverted),
    'criteria_unmet', to_jsonb(v_criteria_unmet),
    'composite_unmet', to_jsonb(v_composite));
end
$$;

revoke all on function public.case_binding_gate_demands(uuid, bigint[]) from public, anon, authenticated;
grant execute on function public.case_binding_gate_demands(uuid, bigint[]) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The ONE refusal-message builder for the acts (advance + sanction). A
--    refusal names what is actually missing — arm by arm, nothing assumed.
-- ---------------------------------------------------------------------------
create or replace function public.governance_demands_message(p_demands jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_parts text[] := '{}';
begin
  if p_demands is null then
    return '';
  end if;
  if jsonb_array_length(coalesce(p_demands->'unlinked_mandatory', '[]'::jsonb)) > 0
     or jsonb_array_length(coalesce(p_demands->'non_independent_gates', '[]'::jsonb)) > 0 then
    v_parts := array_append(v_parts, format(
      'this case is governed at %s intensity and the adopted %s binding is not met by the current stage''s gates — %s mandatory criterion/criteria carry no ACCEPTED deliverable, %s gate(s) hold a passing latest review recorded by the case sponsor/creator where independent assurance is required. Accept the deliverables / re-record independently (create_case_deliverable, submit_deliverable, accept_deliverable, record_case_gate_review), or re-apply the determination if the classification is wrong',
      p_demands->>'intensity_level', p_demands->>'binding_level',
      jsonb_array_length(coalesce(p_demands->'unlinked_mandatory', '[]'::jsonb)),
      jsonb_array_length(coalesce(p_demands->'non_independent_gates', '[]'::jsonb))));
  end if;
  if jsonb_array_length(coalesce(p_demands->'waiver_reverted', '[]'::jsonb)) > 0 then
    v_parts := array_append(v_parts, format(
      '%s mandatory requirement(s) hold their latest gate pass only through a waiver that has LAPSED, so the pass no longer stands (spec II.16: a temporary exception does not become permanent by lapse of attention) — re-satisfy the requirement and re-record the gate, or obtain a new waiver: %s',
      jsonb_array_length(p_demands->'waiver_reverted'),
      (select string_agg(x, '; ') from jsonb_array_elements_text(p_demands->'waiver_reverted') x)));
  end if;
  if jsonb_array_length(coalesce(p_demands->'criteria_unmet', '[]'::jsonb)) > 0 then
    v_parts := array_append(v_parts, format(
      '%s mandatory requirement(s) carry no met finding on their gate''s latest passing review and were never covered by a waiver, so the recorded pass does not answer them — re-satisfy the requirement and re-record the gate (record_case_gate_review), or obtain a governed waiver (request_gate_requirement_waiver): %s',
      jsonb_array_length(p_demands->'criteria_unmet'),
      (select string_agg(x, '; ') from jsonb_array_elements_text(p_demands->'criteria_unmet') x)));
  end if;
  if jsonb_array_length(coalesce(p_demands->'composite_unmet', '[]'::jsonb)) > 0 then
    v_parts := array_append(v_parts, format(
      '%s composite authority rule(s) demand a completed independent assurance review of this case (record_risk_assurance_review, subject_type development_case): %s',
      jsonb_array_length(p_demands->'composite_unmet'),
      (select string_agg(x, '; ') from jsonb_array_elements_text(p_demands->'composite_unmet') x)));
  end if;
  return array_to_string(v_parts, '; ');
end
$$;

revoke all on function public.governance_demands_message(jsonb) from public, anon;
grant execute on function public.governance_demands_message(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. create_governance_rule_set_version, re-created from its 20261120090200
--    definition with exactly ONE addition (marked): succession clones the
--    composite rules beside the tailoring rules.
-- ---------------------------------------------------------------------------
create or replace function public.create_governance_rule_set_version(p_rule_set_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  rs governance_tailoring_rule_sets%rowtype;
  v_new uuid;
  v_version int;
  v_rules int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'authoring tailoring rules requires a governance or engineering role');
  end if;
  select * into rs from governance_tailoring_rule_sets
  where id = p_rule_set_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'rule set not found');
  end if;
  if exists (select 1 from governance_tailoring_rule_sets
             where organization_id = v_org and name = rs.name and status = 'draft') then
    return jsonb_build_object('error',
      format('a DRAFT version of "%s" already exists — edit and adopt that one rather than piling up drafts', rs.name));
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from governance_tailoring_rule_sets
  where organization_id = v_org and name = rs.name;

  perform set_config('app.governance_config_write', 'granted', true);
  insert into governance_tailoring_rule_sets
    (organization_id, name, version, status, value_thresholds, basis, created_by)
  values
    (v_org, rs.name, v_version, 'draft', rs.value_thresholds,
     rs.basis || format(' | Drafted as v%s from v%s.', v_version, rs.version),
     auth.uid())
  returning id into v_new;

  insert into governance_tailoring_rules
    (organization_id, rule_set_id, priority, description, lifecycle_types,
     min_value_usd, max_value_usd, min_intensity, max_intensity,
     framework_name, intensity_floor)
  select organization_id, v_new, priority, description, lifecycle_types,
         min_value_usd, max_value_usd, min_intensity, max_intensity,
         framework_name, intensity_floor
  from governance_tailoring_rules where rule_set_id = rs.id;
  get diagnostics v_rules = row_count;

  -- D3.34/D11.28 (20261121090400, marked insertion): composite rules ride
  -- the same rule set, so succession clones them too — a version drafted
  -- without its composite rules would silently disarm them on adoption.
  insert into governance_composite_rules
    (organization_id, rule_set_id, priority, description,
     min_value_level, min_risk_rating, min_intensity, min_novelty, consequence)
  select organization_id, v_new, priority, description,
         min_value_level, min_risk_rating, min_intensity, min_novelty, consequence
  from governance_composite_rules where rule_set_id = rs.id;
  perform set_config('app.governance_config_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'governance_tailoring', coalesce(v_role, 'unknown'),
    jsonb_build_object('rule_set_id', v_new, 'version', v_version,
      'action', 'version_drafted', 'cloned_from', rs.id, 'rules', v_rules));

  return jsonb_build_object('rule_set_id', v_new, 'name', rs.name,
    'version', v_version, 'status', 'draft', 'rules_cloned', v_rules);
end
$$;

revoke all on function public.create_governance_rule_set_version(uuid) from public, anon;
grant execute on function public.create_governance_rule_set_version(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The persistence-boundary trigger, re-created from its 20261120090300
--    definition with two marked changes: the composite arm holds with or
--    without an adopted binding, and the closing refusal names both rule
--    families.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_intensity_governance_binding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client boolean := auth.uid() is not null;
  v_gov development_case_governance%rowtype;
  v_bind governance_intensity_bindings%rowtype;
  c development_cases%rowtype;
  v_unlinked text[];
  v_violation text;
  -- D3.34/D11.28 (20261121090400, marked insertion): composite demands.
  v_composite text[];
begin
  -- Only case-scoped PASSING outcomes are governed here; asset reviews and
  -- non-passing outcomes pass through untouched. On UPDATE, a change of any
  -- subject the predicate reads — outcome, gate, case or reviewer —
  -- re-litigates; an annotation edit on a historical row is not a new pass,
  -- but a review transplanted onto another case or re-attributed to another
  -- reviewer is.
  if new.development_case_id is null or new.gate_id is null
     or new.outcome not in ('proceed','proceed_with_conditions')
     or (tg_op = 'UPDATE'
         and new.outcome is not distinct from old.outcome
         and new.gate_id is not distinct from old.gate_id
         and new.development_case_id is not distinct from old.development_case_id
         and new.reviewed_by is not distinct from old.reviewed_by) then
    return new;
  end if;

  select * into v_gov from development_case_governance
  where development_case_id = new.development_case_id and status = 'current';
  if v_gov.id is null then
    return new;
  end if;
  v_bind := resolve_case_intensity_binding(v_gov.organization_id, v_gov.intensity_level);
  -- D3.34/D11.28 (20261121090400, marked change): a null binding no longer
  -- returns early — composite rules arm on the determination alone. The two
  -- binding checks below self-disarm on a null binding row (their flags read
  -- null), preserving 20261120090300's absence semantics exactly.

  select * into c from development_cases where id = new.development_case_id;

  if v_bind.independent_assurance_required
     and new.reviewed_by is not null
     and (new.reviewed_by = c.sponsor_id or new.reviewed_by = c.created_by) then
    v_violation := format(
      'Intensity binding (%s): the adopted binding requires independent assurance, and this %s is recorded by the case sponsor or creator.',
      v_gov.intensity_level, new.outcome);
  end if;

  if v_violation is null and v_bind.evidence_linked_deliverables_required then
    -- The ONE predicate (case_binding_gate_demands), scoped to the gate
    -- being written. Only its evidence arm can bind here: the incoming
    -- row's reviewer was already checked above on NEW, and the stored-
    -- review independence arm concerns rows this write supersedes.
    v_unlinked := coalesce((
      select array_agg(x)
      from jsonb_array_elements_text(coalesce(
        case_binding_gate_demands(new.development_case_id, array[new.gate_id])
          ->'unlinked_mandatory', '[]'::jsonb)) x), '{}');
    if array_length(v_unlinked, 1) > 0 then
      v_violation := format(
        'Intensity binding (%s): %s mandatory criterion/criteria of this gate carry no ACCEPTED deliverable for this case (first: "%s").',
        v_gov.intensity_level, array_length(v_unlinked, 1), v_unlinked[1]);
    end if;
  end if;

  -- D3.34/D11.28 (20261121090400, marked insertion): the composite arm of
  -- the ONE predicate holds at the persistence boundary too.
  if v_violation is null then
    v_composite := coalesce((
      select array_agg(x)
      from jsonb_array_elements_text(coalesce(
        case_binding_gate_demands(new.development_case_id, array[new.gate_id])
          ->'composite_unmet', '[]'::jsonb)) x), '{}');
    if array_length(v_composite, 1) > 0 then
      v_violation := format(
        'Composite authority rule(s) unmet: %s — a completed, acceptable INDEPENDENT assurance review of this case must be recorded before a gate outcome passes (record_risk_assurance_review, subject_type development_case).',
        array_to_string(v_composite, '; '));
    end if;
  end if;

  if v_violation is null then
    return new;
  end if;

  -- The audited service path (restore, backfill, correction).
  if not v_client then
    if exists (select 1 from organizations where id = v_gov.organization_id) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_gov.organization_id, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         format('Gate outcome "%s" written on case %s gate %s by a service caller in violation of the adopted intensity binding. %s',
                new.outcome, new.development_case_id, new.gate_id, v_violation));
    end if;
    return new;
  end if;

  raise exception
    'Governance intensity binding: this case is governed at % intensity and its adopted demands are not satisfied. % '
    'The binding and the composite rules are data (governance_intensity_bindings, governance_composite_rules), '
    'the determination is recorded (apply_case_governance), and a gate outcome that does not meet them is '
    'refused at the persistence boundary, not advised against.',
    v_gov.intensity_level, v_violation
    using errcode = 'check_violation';
end
$$;

revoke all on function public.enforce_intensity_governance_binding() from public, anon, authenticated;

drop trigger if exists trg_intensity_governance_binding on public.stage_gate_reviews;
create trigger trg_intensity_governance_binding
  before insert or update on public.stage_gate_reviews
  for each row execute function public.enforce_intensity_governance_binding();

-- ---------------------------------------------------------------------------
-- 7. record_case_gate_review, re-created from its 20261120090300 definition
--    with the marked insertions listed in this file's header (funding
--    question, waiver-aware mandatory block, composite refusal, ledger
--    snapshot). The prior signature is dropped first — the 20261115090400
--    precedent for a parameter addition.
-- ---------------------------------------------------------------------------
drop function if exists public.record_case_gate_review(uuid, bigint, text, text, jsonb, jsonb, uuid);
create or replace function public.record_case_gate_review(
  p_case_id uuid,
  p_gate_id bigint,
  p_outcome text,
  p_note text,
  p_findings jsonb default '[]'::jsonb,
  p_conditions jsonb default '[]'::jsonb,
  p_evaluation_id uuid default null,
  p_funding_answer text default null
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
  g stage_gates%rowtype;
  v_review_id bigint;
  v_mandatory_total int;
  v_criteria_total int;
  v_unmet text[];
  f jsonb;
  cond jsonb;
  v_cond_count int := 0;
  v_finding_count int := 0;
  v_seen_criteria text[] := '{}';
  v_owner uuid;
  v_conditions_text text;
  v_design_order int;
  v_gate_order int;
  v_gov development_case_governance%rowtype;
  v_bind governance_intensity_bindings%rowtype;
  v_unlinked text[];
  -- D3.07 / D3.19 / D11.28 (20261121090400, marked insertions): the funding
  -- question's scope, the waived criteria, the composite demands.
  v_sanction_order int;
  v_funding_gate_order int;
  v_funding text := nullif(btrim(coalesce(p_funding_answer, '')), '');
  v_waived text[] := '{}';
  v_all_demands jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    if coalesce(v_role, '') = 'ai_admin' then
      return jsonb_build_object('error',
        'a gate decision is a §70 human determination — the AI-operator identity cannot record one');
    end if;
    return jsonb_build_object('error', 'recording a gate decision requires a governance or engineering role');
  end if;

  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'gates are not recordable on a ' || c.status || ' case');
  end if;

  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate not found');
  end if;
  if c.framework_id is null or g.framework_id <> c.framework_id then
    return jsonb_build_object('error', 'that gate does not belong to this case''s framework');
  end if;

  -- D2.02: a review may LINK the value evaluation it was taken on. The link
  -- is validated here and never inferred — a trajectory point exists exactly
  -- where a review recorded one.
  if p_evaluation_id is not null and not exists (
    select 1 from lifecycle_evaluations e
    where e.id = p_evaluation_id and e.organization_id = v_org
      and e.development_case_id = c.id and e.evaluation_kind = 'case_value'
  ) then
    return jsonb_build_object('error',
      'that evaluation is not a value evaluation of this case — record one with record_case_value_evaluation and link it here');
  end if;

  if p_outcome in ('pass','pass_with_conditions') then
    return jsonb_build_object('error',
      'case gate reviews use the reconciled vocabulary — record ''proceed'' or ''proceed_with_conditions''');
  end if;
  if p_outcome not in ('proceed','proceed_with_conditions','hold','recycle','pivot','redesign','pause','terminate') then
    return jsonb_build_object('error',
      'outcome must be one of proceed, proceed_with_conditions, hold, recycle, pivot, redesign, pause, terminate');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the basis for this gate decision (20 characters minimum)');
  end if;
  if p_findings is null or jsonb_typeof(p_findings) <> 'array' then
    return jsonb_build_object('error', 'findings must be a json array');
  end if;
  if p_conditions is null or jsonb_typeof(p_conditions) <> 'array' then
    return jsonb_build_object('error', 'conditions must be a json array');
  end if;

  -- D3.07 (20261121090400, marked insertion): the zero-based funding question
  -- (spec I.5: "if this project were proposed today using what we now know,
  -- would we still fund it?"). Recorded whenever answered; REQUIRED for a
  -- passing outcome at a sanction-type gate — decision_type 'gate' whose
  -- stage sits at-or-after the master sanction stage (ruling recorded in
  -- 20261121090200). Checkpoints never hard-block on it.
  if p_outcome in ('proceed','proceed_with_conditions') and g.decision_type = 'gate' then
    select stage_order into v_sanction_order from lifecycle_stages where stage_key = 'sanction';
    select stage_order into v_funding_gate_order from lifecycle_stages where stage_key = g.stage_key;
    if v_sanction_order is not null and v_funding_gate_order is not null
       and v_funding_gate_order >= v_sanction_order
       and (v_funding is null or length(v_funding) < 20) then
      return jsonb_build_object('error',
        'this is a sanction-type gate: a passing outcome records the zero-based funding answer — "if this project were proposed today using what we now know, would we still fund it?" (spec I.5, 20 characters minimum)');
    end if;
  end if;

  -- Slice-1 segregation minimum on independent-assurance gates.
  if g.independent_assurance_required
     and p_outcome in ('proceed','proceed_with_conditions')
     and (auth.uid() = c.sponsor_id or auth.uid() = c.created_by) then
    return jsonb_build_object('error',
      'this gate requires independent assurance: the case sponsor or creator cannot record its decision (segregation of duties)');
  end if;

  -- D3.05: the case's CURRENT governance determination and the ADOPTED
  -- binding for its intensity level. Absence enforces nothing (the
  -- enforce_authority_limit posture: nothing invented, nothing blocked);
  -- once both exist, the binding's demands hold at this RPC AND at the
  -- persistence boundary (trg_intensity_governance_binding — the wall
  -- behind this door).
  select * into v_gov from development_case_governance
  where development_case_id = c.id and status = 'current';
  if v_gov.id is not null then
    v_bind := resolve_case_intensity_binding(v_org, v_gov.intensity_level);
  end if;

  -- Intensity-wide segregation: at a level whose adopted binding requires
  -- independent assurance, EVERY gate of the case is recorded independently
  -- of its sponsor and creator — the per-gate flag above extends to the
  -- whole case.
  if v_bind.id is not null and v_bind.independent_assurance_required
     and p_outcome in ('proceed','proceed_with_conditions')
     and (auth.uid() = c.sponsor_id or auth.uid() = c.created_by) then
    return jsonb_build_object('error',
      format('this case is governed at %s intensity: the adopted intensity binding requires independent assurance, so the case sponsor or creator cannot record any of its gate decisions (segregation of duties)',
             v_gov.intensity_level));
  end if;

  -- D1.02 (spec I.3): success is established BEFORE design begins.
  -- Placed AFTER the segregation check deliberately: on an assurance gate a
  -- conflicted recorder is refused for the conflict first — who may record
  -- precedes what the record needs. A gate of
  -- a design-or-later stage cannot PASS while the case has no recorded
  -- success contract. Master stage order is the one stage vocabulary
  -- (ruling 2); 'design' anchors the boundary.
  if p_outcome in ('proceed','proceed_with_conditions') then
    select stage_order into v_design_order from lifecycle_stages where stage_key = 'design';
    select stage_order into v_gate_order from lifecycle_stages where stage_key = g.stage_key;
    if v_gate_order is not null and v_design_order is not null
       and v_gate_order >= v_design_order
       and not exists (
         select 1 from development_success_contracts sc
         where sc.development_case_id = c.id and sc.status = 'recorded'
       ) then
      return jsonb_build_object('error',
        'success is established before design begins (spec I.3): no recorded success contract exists on this case, so a design-or-later gate cannot pass — draft one (draft_success_contract), state its outcomes with owners and bases, and record it (record_success_contract)');
    end if;
  end if;

  -- Validate findings before anything is written.
  for f in select * from jsonb_array_elements(p_findings) loop
    if coalesce(btrim(f->>'criterion_text'), '') = '' then
      return jsonb_build_object('error', 'every finding names its criterion (criterion_text)');
    end if;
    if btrim(f->>'criterion_text') = any(v_seen_criteria) then
      return jsonb_build_object('error',
        format('duplicate finding for criterion "%s" — a review carries exactly one finding per criterion, because two findings on one criterion is a contradiction the gate would have to resolve silently', btrim(f->>'criterion_text')));
    end if;
    v_seen_criteria := v_seen_criteria || btrim(f->>'criterion_text');
    if coalesce(f->>'status', '') not in ('met','not_met','not_assessed') then
      return jsonb_build_object('error', 'finding status must be met, not_met or not_assessed');
    end if;
    if f ? 'criterion_id' and nullif(f->>'criterion_id','') is not null and not exists (
      select 1 from stage_gate_criteria sc
      where sc.id = (f->>'criterion_id')::bigint
        and sc.organization_id = v_org and sc.gate_id = p_gate_id
    ) then
      return jsonb_build_object('error', 'finding references a criterion that does not belong to this gate');
    end if;
    v_finding_count := v_finding_count + 1;
  end loop;

  -- THE MANDATORY BLOCK (assessGate's discipline, repeated at the DB).
  select count(*), count(*) filter (where is_mandatory)
    into v_criteria_total, v_mandatory_total
  from stage_gate_criteria
  where organization_id = v_org and gate_id = p_gate_id;

  if p_outcome in ('proceed','proceed_with_conditions') then
    if v_criteria_total = 0 then
      return jsonb_build_object('error',
        'this gate defines no criteria, so it can block nothing — define what it requires before recording a proceed through it');
    end if;
    -- D3.19 (20261121090400, marked insertion): an APPROVED, UNEXPIRED
    -- gate-requirement waiver stands in for an unmet mandatory criterion —
    -- and stops standing in the moment it lapses (D3.20's auto-reversion:
    -- status and expiry are read LIVE, so an expired waiver blocks again
    -- with no further act).
    select coalesce(array_agg(sc.criterion), '{}') into v_unmet
    from stage_gate_criteria sc
    where sc.organization_id = v_org and sc.gate_id = p_gate_id and sc.is_mandatory
      and not exists (
        select 1 from jsonb_array_elements(p_findings) pf
        where btrim(pf->>'criterion_text') = btrim(sc.criterion)
          and pf->>'status' = 'met'
      )
      and not exists (
        select 1 from standard_site_variances w
        where w.subject_type = 'gate_requirement'
          and w.development_case_id = c.id and w.requirement_id = sc.id
          and w.status = 'approved' and w.expires_at > now()
      );
    select coalesce(array_agg(sc.criterion), '{}') into v_waived
    from stage_gate_criteria sc
    where sc.organization_id = v_org and sc.gate_id = p_gate_id and sc.is_mandatory
      and not exists (
        select 1 from jsonb_array_elements(p_findings) pf
        where btrim(pf->>'criterion_text') = btrim(sc.criterion)
          and pf->>'status' = 'met'
      )
      and exists (
        select 1 from standard_site_variances w
        where w.subject_type = 'gate_requirement'
          and w.development_case_id = c.id and w.requirement_id = sc.id
          and w.status = 'approved' and w.expires_at > now()
      );
    if array_length(v_unmet, 1) > 0 then
      return jsonb_build_object('error',
        format('cannot record %s: %s mandatory criterion/criteria are not explicitly met in this review — silence and not-assessed block for the same reason a failure does', p_outcome, array_length(v_unmet, 1)),
        'unmet_mandatory', to_jsonb(v_unmet));
    end if;

    -- D3.05: at an intensity whose ADOPTED binding requires evidence-linked
    -- deliverables, a met finding alone is not enough — every mandatory
    -- criterion of this gate carries an ACCEPTED deliverable for THIS case,
    -- or the gate does not pass. Acceptance is itself a governed human act
    -- (accept_deliverable, owner-cannot-accept), so the demand chains
    -- determination -> binding -> accepted evidence, all recorded.
    if v_bind.id is not null and v_bind.evidence_linked_deliverables_required then
      v_unlinked := coalesce((
        select array_agg(x)
        from jsonb_array_elements_text(coalesce(
          case_binding_gate_demands(c.id, array[p_gate_id])
            ->'unlinked_mandatory', '[]'::jsonb)) x), '{}');
      if array_length(v_unlinked, 1) > 0 then
        return jsonb_build_object('error',
          format('cannot record %s at %s intensity: %s mandatory criterion/criteria carry no ACCEPTED deliverable for this case — the adopted intensity binding requires an accepted deliverable behind every mandatory gate requirement (create_case_deliverable, submit_deliverable, accept_deliverable, then re-record)',
                 p_outcome, v_gov.intensity_level, array_length(v_unlinked, 1)),
          'unlinked_mandatory', to_jsonb(v_unlinked));
      end if;
    end if;

    -- D3.34 / D11.28 (20261121090400, marked insertion): composite authority
    -- rules. The adopted rule set's composite conditions (value band AND
    -- risk AND intensity AND novelty, conjunctive) are evaluated over the
    -- case's CURRENT determination by the ONE shared predicate; the flagship
    -- consequence — independent assurance recorded before a gate passes —
    -- refuses here, at the trigger, at advance and at sanction alike.
    v_all_demands := case_binding_gate_demands(c.id, array[p_gate_id]);
    if v_all_demands is not null
       and jsonb_array_length(coalesce(v_all_demands->'composite_unmet', '[]'::jsonb)) > 0 then
      return jsonb_build_object('error',
        format('cannot record %s: %s composite authority rule(s) of the adopted rule set demand a completed independent assurance review of this case before a gate passes (record_risk_assurance_review, subject_type development_case) — %s',
               p_outcome,
               jsonb_array_length(v_all_demands->'composite_unmet'),
               (select string_agg(x, '; ') from jsonb_array_elements_text(v_all_demands->'composite_unmet') x)),
        'composite_unmet', v_all_demands->'composite_unmet');
    end if;
  end if;

  -- Conditions: exactly with a conditional proceed, never otherwise.
  if p_outcome = 'proceed_with_conditions' then
    if jsonb_array_length(p_conditions) = 0 then
      return jsonb_build_object('error',
        'proceed_with_conditions requires at least one condition, each with owner, due date, evidence requirement and consequence-if-missed (spec II.16)');
    end if;
    for cond in select * from jsonb_array_elements(p_conditions) loop
      if coalesce(length(btrim(cond->>'description')), 0) < 10 then
        return jsonb_build_object('error', 'each condition states what must be done (10 characters minimum)');
      end if;
      v_owner := nullif(cond->>'owner_id','')::uuid;
      if v_owner is null or not exists (
        select 1 from user_profiles up where up.id = v_owner and up.organization_id = v_org
      ) then
        return jsonb_build_object('error', 'each condition names an owner who is a member of this organization');
      end if;
      if nullif(cond->>'due_date','') is null then
        return jsonb_build_object('error', 'each condition carries a due date');
      end if;
      if (cond->>'due_date')::date < current_date then
        return jsonb_build_object('error', 'a condition cannot be born overdue — its due date is today or later');
      end if;
      if coalesce(length(btrim(cond->>'evidence_requirement')), 0) < 5 then
        return jsonb_build_object('error', 'each condition states the evidence that will close it');
      end if;
      if coalesce(length(btrim(cond->>'consequence_if_missed')), 0) < 5 then
        return jsonb_build_object('error', 'each condition states the consequence if it is missed');
      end if;
      v_cond_count := v_cond_count + 1;
    end loop;
  elsif jsonb_array_length(p_conditions) > 0 then
    return jsonb_build_object('error', 'conditions attach to a proceed_with_conditions outcome only');
  end if;

  if p_outcome = 'proceed_with_conditions' then
    select string_agg(btrim(x->>'description'), '; ') into v_conditions_text
    from jsonb_array_elements(p_conditions) x;
  end if;

  -- The sanctioned write. Local marker: cannot outlive this transaction.
  perform set_config('app.gate_review_write', 'granted', true);

  insert into stage_gate_reviews
    (organization_id, development_case_id, gate_id, stage_key, outcome,
     conditions, reviewed_by, reviewed_at, note, evaluation_id,
     funding_continuation_answer)
  values
    (v_org, c.id, g.id, g.stage_key, p_outcome,
     v_conditions_text, auth.uid(), now(), btrim(p_note), p_evaluation_id,
     v_funding)
  returning id into v_review_id;

  insert into stage_gate_findings
    (organization_id, review_id, criterion_id, criterion_text, status, evidence)
  select v_org, v_review_id,
         nullif(x->>'criterion_id','')::bigint,
         btrim(x->>'criterion_text'),
         x->>'status',
         nullif(btrim(coalesce(x->>'evidence','')), '')
  from jsonb_array_elements(p_findings) x;

  insert into gate_conditions
    (organization_id, review_id, description, owner_id, due_date,
     evidence_requirement, consequence_if_missed)
  select v_org, v_review_id,
         btrim(x->>'description'),
         (x->>'owner_id')::uuid,
         (x->>'due_date')::date,
         btrim(x->>'evidence_requirement'),
         btrim(x->>'consequence_if_missed')
  from jsonb_array_elements(p_conditions) x;

  perform set_config('app.gate_review_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, new_state)
  values (v_org, 'case_gate_review', coalesce(v_role, 'unknown'),
    jsonb_build_object('review_id', v_review_id, 'case_id', c.id, 'gate_id', g.id,
      'gate', g.name, 'decision_type', g.decision_type, 'outcome', p_outcome,
      'findings', v_finding_count, 'conditions', v_cond_count,
      'evaluation_id', p_evaluation_id,
      'funding_answered', v_funding is not null,
      'waived_mandatory', to_jsonb(v_waived)),
    jsonb_build_object('outcome', p_outcome, 'reviewed_by', auth.uid(),
      'funding_continuation_answer', v_funding));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Gate decision "%s" recorded on %s (%s) for case %s as role %s.',
            p_outcome, g.name, g.decision_type, c.title, coalesce(v_role, 'none')));

  return jsonb_build_object(
    'review_id', v_review_id, 'outcome', p_outcome,
    'gate', g.name, 'decision_type', g.decision_type,
    'findings_recorded', v_finding_count, 'conditions_recorded', v_cond_count,
    'waived_mandatory', to_jsonb(v_waived));
end
$$;



revoke all on function public.record_case_gate_review(uuid, bigint, text, text, jsonb, jsonb, uuid, text) from public, anon;
grant execute on function public.record_case_gate_review(uuid, bigint, text, text, jsonb, jsonb, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. advance_development_case_stage, re-created from its 20261120090300
--    definition with ONE marked change: the act-time refusal is assembled by
--    the one message builder over the predicate's three arms.
-- ---------------------------------------------------------------------------
create or replace function public.advance_development_case_stage(
  p_case_id uuid,
  p_to_stage_key text,
  p_reason text default null
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
  v_from_seq int;
  v_to_seq int;
  v_blockers text[];
  -- D3.05 (20261120090300, marked insertion): the binding re-validation's
  -- named demands.
  v_demands jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'moving a case between stages requires a governance or engineering role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'a ' || c.status || ' case does not move between stages');
  end if;
  if c.framework_id is null then
    return jsonb_build_object('error', 'this case has no framework — assign one before moving it through stages');
  end if;

  select sequence into v_from_seq from project_framework_stages
  where framework_id = c.framework_id and stage_key = c.current_stage_key;
  select sequence into v_to_seq from project_framework_stages
  where framework_id = c.framework_id and stage_key = p_to_stage_key;
  if v_to_seq is null then
    return jsonb_build_object('error',
      '"' || coalesce(p_to_stage_key,'') || '" is not a stage of this case''s framework');
  end if;
  if v_from_seq is null then
    -- The case sits outside its framework's members (a state no Slice-1
    -- path can produce: creation seats the case on a member stage and no
    -- framework-reassignment RPC exists yet). FAIL CLOSED rather than
    -- permit a jump that would bypass every gate — when framework
    -- reassignment arrives (later slice), it re-seats the case as part of
    -- the governed act, and this branch stays a refusal.
    return jsonb_build_object('error',
      format('this case''s current stage "%s" is not a member of its framework — its position must be re-established by a governed framework assignment, not by a stage move that would bypass every gate',
             coalesce(c.current_stage_key, 'none')));
  elsif v_to_seq = v_from_seq then
    return jsonb_build_object('error', 'the case is already in that stage');
  elsif v_to_seq > v_from_seq then
    if v_to_seq <> v_from_seq + 1 then
      return jsonb_build_object('error',
        'forward movement is one stage at a time — skipping a stage would skip its gates');
    end if;
    -- Every blocking gate of the CURRENT stage must hold a passing LATEST
    -- review. Latest, not any-ever: a gate whose most recent decision is
    -- terminate/hold/recycle/pivot/redesign/pause blocks regardless of an
    -- earlier proceed, and the row consulted here is the same row the
    -- workspace renders as latestReview (reviewed_at desc, id desc).
    select coalesce(array_agg(g.name), '{}') into v_blockers
    from stage_gates g
    where g.framework_id = c.framework_id
      and g.stage_key = c.current_stage_key
      and exists (select 1 from stage_gate_criteria sc
                  where sc.gate_id = g.id and sc.is_mandatory)
      and coalesce((
        select r.outcome from stage_gate_reviews r
        where r.organization_id = v_org
          and r.development_case_id = c.id
          and r.gate_id = g.id
        order by r.reviewed_at desc, r.id desc
        limit 1
      ), 'none') not in ('proceed','proceed_with_conditions');
    if array_length(v_blockers, 1) > 0 then
      return jsonb_build_object('error',
        format('cannot leave %s: %s gate(s) with mandatory criteria hold no passing latest review for this case — the gate is where someone takes responsibility for the decision, and its most recent decision is the operative one',
               c.current_stage_key, array_length(v_blockers, 1)),
        'blocking_gates', to_jsonb(v_blockers));
    end if;
    -- D3.05 (20261120090300, marked insertion): the adopted intensity
    -- binding is re-validated AT THE ACT over the same gates — a passing
    -- review recorded before the determination existed, or before the
    -- binding was adopted, cannot carry the case out of the stage. One
    -- shared predicate (case_binding_gate_demands) serves the review
    -- trigger, this act and sanction: reuse, not a parallel evaluator —
    -- the latest-review gate-pass test above stays stated exactly once.
    v_demands := case_binding_gate_demands(c.id, null);
    if v_demands is not null then
      -- D3.19/D3.20/D11.28 (20261121090400, marked change): the predicate now
      -- carries three arms (binding, lapsed waivers, composite rules), so the
      -- refusal is assembled by the ONE message builder rather than assuming
      -- the binding arm — a refusal must name what is actually missing.
      return jsonb_build_object('error',
        format('cannot leave %s: %s',
               c.current_stage_key, governance_demands_message(v_demands)),
        'binding_demands', v_demands);
    end if;
  else
    if coalesce(length(btrim(p_reason)), 0) < 10 then
      return jsonb_build_object('error',
        'moving a case backward (recycle) records why (10 characters minimum)');
    end if;
  end if;

  update development_cases
  set current_stage_key = p_to_stage_key, updated_at = now()
  where id = c.id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'development_case', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'action', 'stage_moved',
      'from', c.current_stage_key, 'to', p_to_stage_key,
      'reason', nullif(btrim(coalesce(p_reason,'')), '')));

  return jsonb_build_object('case_id', c.id, 'current_stage_key', p_to_stage_key);
end
$$;


revoke all on function public.advance_development_case_stage(uuid, text, text) from public, anon;
grant execute on function public.advance_development_case_stage(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. sanction_development_case, re-created from its 20261120090300 definition
--    with THREE marked changes: the requester-not-final-approver refusal
--    (D3.33, backing the 20261121090300 DB check), the three-arm act-time
--    refusal through the message builder, and the D11.31 ledger snapshot
--    with the authority delegation named as approval_reference.
-- ---------------------------------------------------------------------------
create or replace function public.sanction_development_case(
  p_case_id uuid,
  p_note text,
  p_sanctioned_value numeric default null
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
  l authority_limits%rowtype;
  v_value numeric;
  v_blockers text[];
  -- D3.05 (20261120090300, marked insertion): binding demands + the current
  -- determination for the value-band staleness refusal.
  v_demands jsonb;
  v_gov development_case_governance%rowtype;
  v_band int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'project sanction is a §70 human determination — the AI-operator identity cannot sanction a case');
  end if;

  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status = 'sanctioned' then
    return jsonb_build_object('error',
      format('already sanctioned on %s. A sanction is not overwritable — the record of the act stands.',
             to_char(c.sanctioned_at, 'YYYY-MM-DD')));
  end if;
  if c.status not in ('active','on_hold') then
    return jsonb_build_object('error', 'a ' || c.status || ' case cannot be sanctioned');
  end if;
  -- No framework, no gates; no gates, no sanction. A sanction that skipped
  -- every gate because none were configured is not gate discipline — assign
  -- an adopted framework (at intake this slice) so its gates can hold the
  -- decision to account.
  if c.framework_id is null then
    return jsonb_build_object('error',
      'this case has no governing framework, so no gate has ever held it to account — a sanction cannot rest on zero gates. Assign an adopted framework first.');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the basis for the sanction decision (20 characters minimum)');
  end if;

  v_value := coalesce(p_sanctioned_value, c.estimated_capex);
  if v_value is null then
    return jsonb_build_object('error',
      'sanction states the value being committed — without one the delegation-of-authority ceiling cannot be verified');
  end if;
  if v_value < 0 then
    return jsonb_build_object('error', 'a sanctioned value cannot be negative');
  end if;
  -- D3.05 (20261120090300, marked insertion): numeric NaN/Infinity compare
  -- ABOVE every ceiling and band in Postgres — a non-finite commitment is
  -- refused, not banded.
  if v_value = 'NaN'::numeric or v_value = 'Infinity'::numeric or v_value = '-Infinity'::numeric then
    return jsonb_build_object('error', 'a sanctioned value must be a finite amount');
  end if;

  -- FAIL-CLOSED authority. "No delegation recorded" refuses the act — the
  -- opposite default from the recommendation ceiling, deliberately: spending
  -- limits ratchet DOWN onto an org that adopts them; the RIGHT to sanction
  -- exists only where the org has delegated it. D3.32 (marked change): the
  -- selection honors the delegation's org-node scope — the 20261121090100
  -- §3 rule, so a recorded scope is consumed at the act, never carried as
  -- dead data on the ladder the audit row will cite.
  select al.* into l
  from authority_limits al
  left join org_ancestry(v_org) anc on anc.node_id = al.org_node_id
  where al.organization_id = v_org and al.role_key = coalesce(v_role, '')
    and al.action_type = 'sanction' and al.status = 'adopted'
    and (al.org_node_id is null or anc.node_id is not null)
  order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc
  limit 1;
  if not found then
    if exists (select 1 from authority_limits
               where organization_id = v_org and role_key = coalesce(v_role, '')
                 and action_type = 'sanction' and status = 'adopted') then
      return jsonb_build_object('error',
        format('every ADOPTED sanction delegation for the %s role is scoped to one organization node whose subtree does not cover this case''s organization. Adopt a delegation covering this node, or escalate.',
               coalesce(v_role, 'none')));
    end if;
    return jsonb_build_object('error',
      format('no ADOPTED sanction authority exists for the %s role in this organization. Sanction is exercised under the delegation-of-authority ladder: adopt the sanction limit (adopt_authority_limit) from your delegation instrument first.',
             coalesce(v_role, 'none')));
  end if;
  if l.max_commitment_usd is not null and v_value > l.max_commitment_usd then
    return jsonb_build_object('error',
      format('$%s exceeds the %s sanction ceiling of $%s for %s. Escalate to %s.',
             v_value, l.tier_label, l.max_commitment_usd, coalesce(v_role, 'none'),
             coalesce(l.escalates_to_role, 'the board')));
  end if;

  -- The sanction decision does not skip the gates: every gate of the case's
  -- CURRENT stage that carries mandatory criteria must hold a passing LATEST
  -- review — latest, not any-ever (20261101090300's latest-review-semantics
  -- note): a gate whose most recent decision is terminate/hold/recycle/
  -- pivot/redesign/pause blocks the sanction regardless of an earlier
  -- proceed, and the row consulted here is the same row the workspace
  -- renders as latestReview (reviewed_at desc, id desc).
  select coalesce(array_agg(g.name), '{}') into v_blockers
  from stage_gates g
  where g.framework_id = c.framework_id
    and g.stage_key = c.current_stage_key
    and exists (select 1 from stage_gate_criteria sc
                where sc.gate_id = g.id and sc.is_mandatory)
    and coalesce((
      select r.outcome from stage_gate_reviews r
      where r.organization_id = v_org
        and r.development_case_id = c.id
        and r.gate_id = g.id
      order by r.reviewed_at desc, r.id desc
      limit 1
    ), 'none') not in ('proceed','proceed_with_conditions');
  if array_length(v_blockers, 1) > 0 then
    return jsonb_build_object('error',
      format('cannot sanction: %s gate(s) of the current stage with mandatory criteria hold no passing latest review for this case',
             array_length(v_blockers, 1)),
      'blocking_gates', to_jsonb(v_blockers));
  end if;

  -- D3.05 (20261120090300, marked insertion): the adopted intensity binding
  -- is re-validated at the highest-stakes act itself — a passing review
  -- recorded before the determination existed, or before the binding was
  -- adopted, cannot carry a sanction. Same shared predicate as the review
  -- trigger and advance (case_binding_gate_demands): reuse, not a parallel
  -- evaluator — the latest-review gate-pass test above stays stated once.
  v_demands := case_binding_gate_demands(c.id, null);
  if v_demands is not null then
    -- D3.19/D3.20/D11.28 (20261121090400, marked change): three-arm refusal
    -- through the ONE message builder — see advance_development_case_stage.
    return jsonb_build_object('error',
      format('cannot sanction: %s', governance_demands_message(v_demands)),
      'binding_demands', v_demands);
  end if;

  -- D3.05 (20261120090300, marked insertion): the determination cannot be
  -- stale relative to the value actually being committed. The comparison
  -- runs against the determination's OWN frozen thresholds — if the
  -- sanction value bands above the value level the regime was computed on,
  -- the regime is re-applied first, never silently outgrown.
  select * into v_gov from development_case_governance
  where development_case_id = c.id and status = 'current';
  if v_gov.id is not null
     and (v_gov.factor_inputs->'value_thresholds') ? 'standard_from_usd'
     and (v_gov.factor_inputs->'value_thresholds') ? 'elevated_from_usd'
     and (v_gov.factor_inputs->'value_thresholds') ? 'full_from_usd' then
    v_band := case
      when v_value >= ((v_gov.factor_inputs->'value_thresholds')->>'full_from_usd')::numeric then 4
      when v_value >= ((v_gov.factor_inputs->'value_thresholds')->>'elevated_from_usd')::numeric then 3
      when v_value >= ((v_gov.factor_inputs->'value_thresholds')->>'standard_from_usd')::numeric then 2
      else 1
    end;
    if v_band > coalesce((v_gov.factor_levels->>'value')::int, 4) then
      return jsonb_build_object('error',
        format('cannot sanction $%s: it bands above the value level the current governance determination was computed on (banded %s/4 against the determination''s own thresholds, determined at %s/4) — re-apply the determination (apply_case_governance) so the governance regime reflects the value actually being committed',
               v_value, v_band, v_gov.factor_levels->>'value'));
    end if;
  end if;

  -- D3.33 (20261121090400, marked insertion): REQUESTER <> FINAL APPROVER
  -- (spec §42) — the LAST door before the act, deliberately: the delegation
  -- ladder, the gate discipline and the governance demands each name their
  -- own refusal first (the transcripts pin those refusals), and only an
  -- otherwise-sanctionable case reaches the conflict rule. The DB check
  -- (dc_sanction_requester_sod, 20261121090300) refuses the same pair for
  -- every writer at the persistence boundary, whatever the path.
  if c.created_by is not null and auth.uid() = c.created_by then
    return jsonb_build_object('error',
      'segregation of duties (spec §42): you raised this case and cannot also record its sanction — the final approval belongs to someone who did not request it');
  end if;

  perform set_config('app.development_sanction_write', 'granted', true);

  update development_cases
  set status = 'sanctioned',
      sanctioned_by = auth.uid(),
      sanctioned_at = now(),
      sanctioned_value = v_value,
      sanction_note = btrim(p_note),
      updated_at = now()
  where id = c.id;

  perform set_config('app.development_sanction_write', '', true);

  -- D11.31 (20261121090400, marked change): the ledger row carries the
  -- previous/new state of the governed record and names the authority
  -- delegation exercised (approval_reference -> authority_limits.id).
  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state, approval_reference)
  values (v_org, 'development_case', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'action', 'sanctioned',
      'sanctioned_value', v_value, 'ceiling', l.max_commitment_usd,
      'tier', l.tier_label,
      'approval_reference_table', 'authority_limits'),
    jsonb_build_object('status', c.status, 'sanctioned_by', c.sanctioned_by,
      'sanctioned_at', c.sanctioned_at, 'sanctioned_value', c.sanctioned_value),
    jsonb_build_object('status', 'sanctioned', 'sanctioned_by', auth.uid(),
      'sanctioned_at', now(), 'sanctioned_value', v_value),
    l.id);

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Development case "%s" sanctioned at $%s by role %s under the %s sanction delegation.',
            c.title, v_value, coalesce(v_role, 'none'), l.tier_label));

  return jsonb_build_object('case_id', c.id, 'status', 'sanctioned',
    'sanctioned_value', v_value, 'tier', l.tier_label);
end
$$;


revoke all on function public.sanction_development_case(uuid, text, numeric) from public, anon;
grant execute on function public.sanction_development_case(uuid, text, numeric) to authenticated;

notify pgrst, 'reload schema';
