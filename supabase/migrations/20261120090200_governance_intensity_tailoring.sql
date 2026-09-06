-- ============================================================================
-- Sync Develop Slice 3 — GovernanceIntensity + the tailoring rules compiler
-- (D3.04 spec I.2, D3.03 spec I.1) and the intensity→requirements binding
-- tables (D3.05 — enforced in 20261120090300).
--
-- SPEC RULINGS THIS FILE TAKES (I.2 gives the six factors, not their scales
-- or composition — the rulings are recorded here because the code cannot
-- express why):
--
--   * THE SIX FACTORS, verbatim from I.2: Value, Risk, Complexity, Novelty,
--     RegulatoryExposure, Interfaces. Nothing added, nothing dropped.
--   * FOUR INTENSITY LEVELS: light < standard < elevated < full. I.1 names
--     the ends ("Light Sustainment", "Major Project Governance, full
--     assurance regime"); two interior steps make tailoring expressible
--     without pretending a continuous scale the spec never gives.
--   * EACH FACTOR MAPS TO A LEVEL 1–4 on a stated scale. Five factors are
--     STATED CLASSIFICATIONS with fixed vocabularies (below); Value is the
--     case's own stated number (sanctioned value, else estimated capex)
--     banded by the ADOPTED rule set's value_thresholds — configurable per
--     tenant, never a pretended universal science (the §46 posture).
--   * COMPOSITION IS max(): governance intensity is a protection function,
--     so a single critical exposure cannot be averaged away by five mild
--     factors. The factors AT the max are returned as named drivers.
--   * REFUSAL-FIRST (D3.04's whole point): a missing or unstateable factor
--     refuses the calculation NAMING EVERY missing factor — the assessGate
--     discipline. No default, no zero, no guess.
--   * TAILORING RULES ARE DATA: versioned rule sets (the
--     risk_criteria_profiles draft→adopted→superseded discipline), rules
--     matched in priority order on lifecycle type / value band / computed
--     intensity. A rule may RAISE the intensity to a floor, never lower it
--     — de-intensifying below the six-factor result would be the compiler
--     quietly weakening governance. No matching rule is a NAMED refusal,
--     never a silent default framework.
--   * THE COMPILER IS EVALUATED TWICE, DELIBERATELY: a pure lib
--     (src/lib/develop/governance.ts) for instant UI preview, and this
--     file's SQL for the persisted determination — a documented repeat of
--     the assessGate/record_case_gate_review precedent (D3.35's "documented
--     repeat, not a fork"); the static slice test pins both to the same
--     vocabularies so they cannot drift silently.
--   * THE DETERMINATION IS §70-ADJACENT: it decides what enforcement demands
--     of every later gate, so development_case_governance rows are writable
--     only through apply_case_governance (provenance trigger below; client
--     writes refused even RLS-bypassed, service admitted AND audited), and
--     ai_admin is refused BY NAME at the RPC.
--   * THE ARMING DATA IS §70-ADJACENT TOO: rule sets, rules and bindings
--     decide the same demands one step earlier, so all three tables carry
--     the identical provenance backstop (clients refused even RLS-bypassed;
--     service admitted AND audited) — an unaudited service rewrite of an
--     adopted binding would disarm enforcement silently.
--   * BINDING RESOLUTION IS MONOTONE: enforcement reads the STRONGEST
--     adopted binding at-or-below the case's effective level
--     (resolve_case_intensity_binding). Without this, raising a case to a
--     level nobody armed would DISARM it — a full case escaping demands an
--     elevated case is blocked by. An explicitly adopted row at the exact
--     level is always taken as that level's policy; only ABSENCE falls back.
--   * ONE ADOPTED RULE SET PER ORGANIZATION, enforced by a partial unique
--     index: the compiler reads exactly one configuration, so adoption
--     supersedes EVERY currently adopted set (any name) — two rows both
--     labeled adopted with only one consulted would be a lie in the data.
--   * NON-FINITE VALUE REFUSED: numeric NaN/Infinity band above every
--     threshold in Postgres, so apply_case_governance refuses them naming
--     value — a determination computed over NaN would be a fabricated band.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. The two ladders, each stated once.
-- ---------------------------------------------------------------------------
create or replace function public.governance_intensity_rank(p_level text)
returns int
language sql
immutable
as $$
  select case p_level
    when 'light' then 1
    when 'standard' then 2
    when 'elevated' then 3
    when 'full' then 4
    else 0
  end
$$;

revoke all on function public.governance_intensity_rank(text) from public, anon;
grant execute on function public.governance_intensity_rank(text) to authenticated, service_role;

-- The five stated-classification scales (Value is banded by adopted
-- thresholds, not by this function). 0 = not a recognized rating.
create or replace function public.governance_factor_rating_level(p_factor text, p_rating text)
returns int
language sql
immutable
as $$
  select case p_factor
    when 'risk' then case p_rating
      when 'low' then 1 when 'medium' then 2 when 'high' then 3 when 'critical' then 4 else 0 end
    when 'complexity' then case p_rating
      when 'low' then 1 when 'medium' then 2 when 'high' then 3 when 'very_high' then 4 else 0 end
    when 'novelty' then case p_rating
      when 'proven' then 1 when 'incremental' then 2 when 'adapted' then 3 when 'first_of_a_kind' then 4 else 0 end
    when 'regulatory_exposure' then case p_rating
      when 'none' then 1 when 'notification' then 2 when 'permit_required' then 3 when 'major_approval' then 4 else 0 end
    when 'interfaces' then case p_rating
      when 'isolated' then 1 when 'limited' then 2 when 'multiple' then 3 when 'extensive' then 4 else 0 end
    else 0
  end
$$;

revoke all on function public.governance_factor_rating_level(text, text) from public, anon;
grant execute on function public.governance_factor_rating_level(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Tailoring rule sets + rules (D3.03) — rules as DATA, versioned on the
--    risk_criteria_profiles discipline.
-- ---------------------------------------------------------------------------
create table if not exists public.governance_tailoring_rule_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  version int not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft','adopted','superseded')),
  -- The Value factor's band boundaries, ascending USD. Enforced complete
  -- and ordered at ADOPTION; the compiler refuses on a set that lacks them.
  value_thresholds jsonb not null default '{}'::jsonb,
  basis text not null,
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  superseded_by uuid references governance_tailoring_rule_sets(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(value_thresholds) = 'object')
);

create unique index if not exists idx_gov_rule_sets_name_version
  on governance_tailoring_rule_sets(organization_id, name, version);
create index if not exists idx_gov_rule_sets_active
  on governance_tailoring_rule_sets(organization_id, status);

alter table public.governance_tailoring_rule_sets enable row level security;
drop policy if exists governance_tailoring_rule_sets_read on public.governance_tailoring_rule_sets;
create policy governance_tailoring_rule_sets_read on public.governance_tailoring_rule_sets
  for select to authenticated using (organization_id = app_current_org());

create table if not exists public.governance_tailoring_rules (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  rule_set_id uuid not null references governance_tailoring_rule_sets(id) on delete cascade,
  priority int not null check (priority > 0),
  description text not null check (btrim(description) <> ''),
  -- Match predicates. '[]' means "any lifecycle type"; null bounds are open.
  lifecycle_types jsonb not null default '[]'::jsonb,
  min_value_usd numeric check (min_value_usd is null or min_value_usd >= 0),
  max_value_usd numeric check (max_value_usd is null or max_value_usd >= 0),
  min_intensity text check (min_intensity is null or min_intensity in ('light','standard','elevated','full')),
  max_intensity text check (max_intensity is null or max_intensity in ('light','standard','elevated','full')),
  -- Selection: the framework PROFILE by name — resolved to the currently
  -- ADOPTED version of that name at apply time, so a rule survives
  -- framework versioning without pinning a retired row.
  framework_name text not null check (btrim(framework_name) <> ''),
  -- A rule may raise the computed intensity to this floor. Raising only —
  -- see the header ruling.
  intensity_floor text check (intensity_floor is null or intensity_floor in ('light','standard','elevated','full')),
  created_at timestamptz not null default now(),
  unique (rule_set_id, priority),
  check (jsonb_typeof(lifecycle_types) = 'array'),
  check (min_value_usd is null or max_value_usd is null or min_value_usd < max_value_usd)
);

create index if not exists idx_gov_rules_set
  on governance_tailoring_rules(rule_set_id, priority);

alter table public.governance_tailoring_rules enable row level security;
drop policy if exists governance_tailoring_rules_read on public.governance_tailoring_rules;
create policy governance_tailoring_rules_read on public.governance_tailoring_rules
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 2. Intensity → required governance elements (D3.05 binding table).
--    Versioned per (org, level) on the authority_limits discipline: DRAFTS
--    enforce nothing; adoption is the act that arms them.
-- ---------------------------------------------------------------------------
create table if not exists public.governance_intensity_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  intensity_level text not null check (intensity_level in ('light','standard','elevated','full')),
  version int not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft','adopted','superseded')),
  -- The enforceable elements. Both booleans are read by the 20261120090300
  -- trigger; cadence and assurance depth are displayed governance the later
  -- assurance slice (D3.16) will bind further.
  independent_assurance_required boolean not null default false,
  evidence_linked_deliverables_required boolean not null default false,
  review_cadence_days int check (review_cadence_days is null or review_cadence_days > 0),
  assurance_level text not null default 'none'
    check (assurance_level in ('none','line_1','line_2','independent')),
  basis text not null,
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  superseded_by uuid references governance_intensity_bindings(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_gov_bindings_active
  on governance_intensity_bindings(organization_id, intensity_level, status);

alter table public.governance_intensity_bindings enable row level security;
drop policy if exists governance_intensity_bindings_read on public.governance_intensity_bindings;
create policy governance_intensity_bindings_read on public.governance_intensity_bindings
  for select to authenticated using (organization_id = app_current_org());

-- One adopted rule set per organization: the compiler consults exactly one
-- configuration, so "adopted" must mean THE active one (see header ruling).
create unique index if not exists idx_gov_rule_sets_one_adopted
  on governance_tailoring_rule_sets(organization_id) where status = 'adopted';

-- Monotone binding resolution (header ruling): the strongest ADOPTED binding
-- at-or-below the level. Consulted by the enforcement trigger, the gate RPC,
-- advance, sanction, apply and the governance read — one resolver, so
-- absence at a stricter level can never mean weaker enforcement.
create or replace function public.resolve_case_intensity_binding(p_org uuid, p_level text)
returns governance_intensity_bindings
language sql
stable
security definer
set search_path = public
as $$
  select b.* from governance_intensity_bindings b
  where b.organization_id = p_org
    and b.status = 'adopted'
    and governance_intensity_rank(b.intensity_level) <= governance_intensity_rank(p_level)
  order by governance_intensity_rank(b.intensity_level) desc, b.version desc
  limit 1
$$;

revoke all on function public.resolve_case_intensity_binding(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_case_intensity_binding(uuid, text) to service_role;

-- Provenance backstop for the ARMING data (header ruling): rule sets, rules
-- and bindings are written only through the authoring RPCs below (marker),
-- exactly the development_case_governance discipline — client writes refused
-- even RLS-bypassed, service admitted AND audited for every operation.
create or replace function public.enforce_governance_config_provenance()
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
         tg_table_name || ' row ' || v_id || ' written (' || lower(tg_op) ||
           ') by a service caller outside the governance authoring RPCs. ' ||
           'Rule sets and intensity bindings decide what gate enforcement demands, ' ||
           'so an unaudited rewrite would arm or disarm enforcement silently.');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'Tailoring rule sets, rules and intensity bindings are written only through their '
      'authoring RPCs (set_rule_set_thresholds, add_tailoring_rule, adopt_governance_rule_set, '
      'create_governance_rule_set_version, set_intensity_binding, adopt_intensity_binding). '
      'A direct write would change what enforcement demands without the recorded act.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_gov_rule_sets_provenance on public.governance_tailoring_rule_sets;
create trigger trg_gov_rule_sets_provenance
  before insert or update or delete on public.governance_tailoring_rule_sets
  for each row execute function public.enforce_governance_config_provenance();
drop trigger if exists trg_gov_rules_provenance on public.governance_tailoring_rules;
create trigger trg_gov_rules_provenance
  before insert or update or delete on public.governance_tailoring_rules
  for each row execute function public.enforce_governance_config_provenance();
drop trigger if exists trg_gov_bindings_provenance on public.governance_intensity_bindings;
create trigger trg_gov_bindings_provenance
  before insert or update or delete on public.governance_intensity_bindings
  for each row execute function public.enforce_governance_config_provenance();

-- ---------------------------------------------------------------------------
-- 3. The persisted determination: which regime governs this case, computed
--    from what, decided by whom. Append-only current/superseded — a
--    determination is never edited, it is superseded by the next one.
-- ---------------------------------------------------------------------------
create table if not exists public.development_case_governance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  rule_set_id uuid not null references governance_tailoring_rule_sets(id),
  rule_id bigint not null references governance_tailoring_rules(id),
  framework_id uuid not null references project_frameworks(id),
  intensity_level text not null check (intensity_level in ('light','standard','elevated','full')),
  computed_level text not null check (computed_level in ('light','standard','elevated','full')),
  -- Frozen at determination time (the record_case_value_evaluation idiom):
  -- the six raw inputs, the six per-factor levels, and the named drivers.
  factor_inputs jsonb not null,
  factor_levels jsonb not null,
  drivers jsonb not null,
  basis text not null check (length(btrim(basis)) >= 20),
  status text not null default 'current' check (status in ('current','superseded')),
  determined_by uuid not null references auth.users(id),
  determined_at timestamptz not null default now(),
  superseded_by uuid references development_case_governance(id),
  check (jsonb_typeof(factor_inputs) = 'object'),
  check (jsonb_typeof(factor_levels) = 'object'),
  check (jsonb_typeof(drivers) = 'array'),
  check (governance_intensity_rank(intensity_level) >= governance_intensity_rank(computed_level))
);

create unique index if not exists idx_case_governance_current
  on development_case_governance(development_case_id) where status = 'current';
create index if not exists idx_case_governance_case
  on development_case_governance(organization_id, development_case_id, determined_at desc);

alter table public.development_case_governance enable row level security;
drop policy if exists development_case_governance_read on public.development_case_governance;
create policy development_case_governance_read on public.development_case_governance
  for select to authenticated using (organization_id = app_current_org());

-- Provenance backstop: the determination decides what enforcement demands,
-- so it is writable only through apply_case_governance. Post-fix idiom
-- (20261005090300): SECURITY INVOKER, transaction-local marker, client
-- writes refused even RLS-bypassed, service admitted AND audited for every
-- operation.
create or replace function public.enforce_case_governance_provenance()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.case_governance_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
begin
  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Case governance determination row ' ||
           (case when tg_op = 'DELETE' then old.id::text else new.id::text end) ||
           ' written (' || lower(tg_op) || ') by a service caller outside apply_case_governance. ' ||
           'The determination decides what gate enforcement demands, so an unaudited rewrite would move the goalposts silently.');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'A governance determination is recorded only through apply_case_governance, which '
      'computes the six-factor intensity from stated inputs, matches the adopted tailoring '
      'rules, and records who determined it. A direct write would assert a regime nobody '
      'determined.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_case_governance_provenance on public.development_case_governance;
create trigger trg_case_governance_provenance
  before insert or update or delete on public.development_case_governance
  for each row execute function public.enforce_case_governance_provenance();

-- ---------------------------------------------------------------------------
-- 3b. THE ONE BINDING PREDICATE. What the case's current determination and
--     the resolved (monotone) adopted binding demand of a set of gates, as
--     a named jsonb — or NULL when nothing is armed or everything is met.
--     Consumed by the enforcement trigger and record_case_gate_review
--     (20261120090300) for the gate being written, and by
--     advance_development_case_stage / sanction_development_case for the
--     current stage's blocking gates — so a passing review recorded BEFORE
--     the determination existed or the binding was adopted cannot carry the
--     case through the acts that matter. One predicate, four consumers:
--     re-validation at the act is reuse, not a parallel evaluator.
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
  c development_cases%rowtype;
  v_gates bigint[];
  v_unlinked text[] := '{}';
  v_non_independent text[] := '{}';
begin
  select * into v_gov from development_case_governance
  where development_case_id = p_case_id and status = 'current';
  if v_gov.id is null then
    -- No determination: nothing armed (the documented absence posture —
    -- and the panel renders that absence, never hides it).
    return null;
  end if;
  v_bind := resolve_case_intensity_binding(v_gov.organization_id, v_gov.intensity_level);
  if v_bind.id is null then
    return null;
  end if;

  select * into c from development_cases where id = p_case_id;

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

  if v_bind.evidence_linked_deliverables_required then
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
      );
  end if;

  -- A stored passing LATEST review recorded by the sponsor/creator does not
  -- satisfy an independent-assurance binding, whenever it was recorded.
  if v_bind.independent_assurance_required then
    select coalesce(array_agg(g.name order by g.sequence), '{}')
    into v_non_independent
    from stage_gates g
    where g.id = any(v_gates)
      and exists (
        select 1 from (
          select r.outcome, r.reviewed_by
          from stage_gate_reviews r
          where r.organization_id = v_gov.organization_id
            and r.development_case_id = p_case_id
            and r.gate_id = g.id
          order by r.reviewed_at desc, r.id desc
          limit 1
        ) lr
        where lr.outcome in ('proceed','proceed_with_conditions')
          and lr.reviewed_by is not null
          and (lr.reviewed_by = c.sponsor_id or lr.reviewed_by = c.created_by)
      );
  end if;

  if coalesce(array_length(v_unlinked, 1), 0) = 0
     and coalesce(array_length(v_non_independent, 1), 0) = 0 then
    return null;
  end if;
  return jsonb_build_object(
    'intensity_level', v_gov.intensity_level,
    'binding_level', v_bind.intensity_level,
    'binding_version', v_bind.version,
    'unlinked_mandatory', to_jsonb(v_unlinked),
    'non_independent_gates', to_jsonb(v_non_independent));
end
$$;

revoke all on function public.case_binding_gate_demands(uuid, bigint[]) from public, anon, authenticated;
grant execute on function public.case_binding_gate_demands(uuid, bigint[]) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Rule-set authoring (draft-only) + adoption + succession.
-- ---------------------------------------------------------------------------
create or replace function public.set_rule_set_thresholds(
  p_rule_set_id uuid,
  p_value_thresholds jsonb
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
  if rs.status <> 'draft' then
    return jsonb_build_object('error', 'an adopted rule set is immutable — draft a new version to change it');
  end if;
  if p_value_thresholds is null or jsonb_typeof(p_value_thresholds) <> 'object'
     or not (p_value_thresholds ? 'standard_from_usd'
             and p_value_thresholds ? 'elevated_from_usd'
             and p_value_thresholds ? 'full_from_usd') then
    return jsonb_build_object('error',
      'value_thresholds states the three ascending band boundaries: standard_from_usd, elevated_from_usd, full_from_usd');
  end if;
  if not ((p_value_thresholds->>'standard_from_usd')::numeric < (p_value_thresholds->>'elevated_from_usd')::numeric
          and (p_value_thresholds->>'elevated_from_usd')::numeric < (p_value_thresholds->>'full_from_usd')::numeric) then
    return jsonb_build_object('error', 'value thresholds must ascend: standard_from_usd < elevated_from_usd < full_from_usd');
  end if;

  perform set_config('app.governance_config_write', 'granted', true);
  update governance_tailoring_rule_sets
  set value_thresholds = p_value_thresholds where id = rs.id;
  perform set_config('app.governance_config_write', '', true);

  return jsonb_build_object('rule_set_id', rs.id, 'value_thresholds', p_value_thresholds);
end
$$;

revoke all on function public.set_rule_set_thresholds(uuid, jsonb) from public, anon;
grant execute on function public.set_rule_set_thresholds(uuid, jsonb) to authenticated;

create or replace function public.add_tailoring_rule(
  p_rule_set_id uuid,
  p_priority int,
  p_description text,
  p_framework_name text,
  p_lifecycle_types jsonb default '[]'::jsonb,
  p_min_value_usd numeric default null,
  p_max_value_usd numeric default null,
  p_min_intensity text default null,
  p_max_intensity text default null,
  p_intensity_floor text default null
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
  lt text;
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
  if rs.status <> 'draft' then
    return jsonb_build_object('error', 'an adopted rule set is immutable — draft a new version to change it');
  end if;
  if p_priority is null or p_priority < 1 then
    return jsonb_build_object('error', 'priority is a positive integer — rules match in ascending priority order');
  end if;
  if coalesce(length(btrim(p_description)), 0) < 10 then
    return jsonb_build_object('error', 'a rule states what it selects and why (10 characters minimum)');
  end if;
  if coalesce(length(btrim(p_framework_name)), 0) < 3 then
    return jsonb_build_object('error', 'a rule names the framework profile it selects');
  end if;
  if p_lifecycle_types is null or jsonb_typeof(p_lifecycle_types) <> 'array' then
    return jsonb_build_object('error', 'lifecycle_types is a json array ([] means any)');
  end if;
  for lt in select jsonb_array_elements_text(p_lifecycle_types) loop
    if lt not in ('greenfield','brownfield','sustaining_capital','replacement',
                  'reliability_improvement','regulatory','capacity','life_extension','decommissioning') then
      return jsonb_build_object('error',
        format('"%s" is not one of the nine spec §3 lifecycle types', lt));
    end if;
  end loop;
  if p_min_intensity is not null and governance_intensity_rank(p_min_intensity) = 0 then
    return jsonb_build_object('error', 'min_intensity must be light, standard, elevated or full');
  end if;
  if p_max_intensity is not null and governance_intensity_rank(p_max_intensity) = 0 then
    return jsonb_build_object('error', 'max_intensity must be light, standard, elevated or full');
  end if;
  if p_intensity_floor is not null and governance_intensity_rank(p_intensity_floor) = 0 then
    return jsonb_build_object('error', 'intensity_floor must be light, standard, elevated or full');
  end if;
  if p_min_value_usd is not null and p_max_value_usd is not null
     and p_min_value_usd >= p_max_value_usd then
    return jsonb_build_object('error', 'min_value_usd must be below max_value_usd');
  end if;

  perform set_config('app.governance_config_write', 'granted', true);
  insert into governance_tailoring_rules
    (organization_id, rule_set_id, priority, description, lifecycle_types,
     min_value_usd, max_value_usd, min_intensity, max_intensity,
     framework_name, intensity_floor)
  values
    (v_org, rs.id, p_priority, btrim(p_description), p_lifecycle_types,
     p_min_value_usd, p_max_value_usd, p_min_intensity, p_max_intensity,
     btrim(p_framework_name), p_intensity_floor)
  on conflict (rule_set_id, priority) do update set
    description = excluded.description,
    lifecycle_types = excluded.lifecycle_types,
    min_value_usd = excluded.min_value_usd,
    max_value_usd = excluded.max_value_usd,
    min_intensity = excluded.min_intensity,
    max_intensity = excluded.max_intensity,
    framework_name = excluded.framework_name,
    intensity_floor = excluded.intensity_floor
  returning id into v_id;
  perform set_config('app.governance_config_write', '', true);

  return jsonb_build_object('rule_id', v_id, 'priority', p_priority);
end
$$;

revoke all on function public.add_tailoring_rule(uuid, int, text, text, jsonb, numeric, numeric, text, text, text) from public, anon;
grant execute on function public.add_tailoring_rule(uuid, int, text, text, jsonb, numeric, numeric, text, text, text) to authenticated;

-- Adoption: the executability contract. Thresholds complete and ascending,
-- at least one rule, and every referenced framework name resolving to an
-- ADOPTED framework — a rule set that selects frameworks nobody adopted
-- would compile refusals for every case.
create or replace function public.adopt_governance_rule_set(
  p_rule_set_id uuid,
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
  rs governance_tailoring_rule_sets%rowtype;
  v_rules int;
  v_unresolved text[];
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive') then
    return jsonb_build_object('error', 'adopting tailoring rules requires an executive or administrator — they decide how every case is governed');
  end if;
  select * into rs from governance_tailoring_rule_sets
  where id = p_rule_set_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'rule set not found');
  end if;
  if rs.status <> 'draft' then
    return jsonb_build_object('error', 'only draft rule sets can be adopted');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the authority and basis for adoption (20 characters minimum)');
  end if;
  if not (rs.value_thresholds ? 'standard_from_usd'
          and rs.value_thresholds ? 'elevated_from_usd'
          and rs.value_thresholds ? 'full_from_usd')
     or not ((rs.value_thresholds->>'standard_from_usd')::numeric < (rs.value_thresholds->>'elevated_from_usd')::numeric
             and (rs.value_thresholds->>'elevated_from_usd')::numeric < (rs.value_thresholds->>'full_from_usd')::numeric) then
    return jsonb_build_object('error',
      'this rule set is not executable: value_thresholds must state the three ascending band boundaries (set_rule_set_thresholds)');
  end if;
  select count(*) into v_rules from governance_tailoring_rules where rule_set_id = rs.id;
  if v_rules = 0 then
    return jsonb_build_object('error', 'this rule set is not executable: it has no rules');
  end if;
  select coalesce(array_agg(distinct r.framework_name), '{}') into v_unresolved
  from governance_tailoring_rules r
  where r.rule_set_id = rs.id
    and not exists (
      select 1 from project_frameworks f
      where f.organization_id = v_org and f.name = r.framework_name and f.status = 'adopted'
    );
  if array_length(v_unresolved, 1) > 0 then
    return jsonb_build_object('error',
      format('this rule set is not executable: %s referenced framework profile(s) have no ADOPTED version in this organization — adopt them first (adopt_project_framework)',
             array_length(v_unresolved, 1)),
      'unresolved_frameworks', to_jsonb(v_unresolved));
  end if;

  perform set_config('app.governance_config_write', 'granted', true);
  -- Adopted means THE active compiler configuration (header ruling + the
  -- one-adopted partial unique index): every currently adopted set steps
  -- aside, whatever its name — a second "adopted" row nothing consults
  -- would be a lie in the data.
  update governance_tailoring_rule_sets set status = 'superseded', superseded_by = rs.id
  where organization_id = v_org and status = 'adopted';

  update governance_tailoring_rule_sets
  set status = 'adopted', adopted_by = auth.uid(), adopted_at = now(),
      basis = basis || ' | Adoption: ' || btrim(p_note)
  where id = rs.id;
  perform set_config('app.governance_config_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'governance_tailoring', coalesce(v_role, 'unknown'),
    jsonb_build_object('rule_set_id', rs.id, 'version', rs.version,
      'action', 'adopted', 'rules', v_rules));

  return jsonb_build_object('rule_set_id', rs.id, 'version', rs.version, 'status', 'adopted');
end
$$;

revoke all on function public.adopt_governance_rule_set(uuid, text) from public, anon;
grant execute on function public.adopt_governance_rule_set(uuid, text) to authenticated;

-- Succession (the create_risk_criteria_version pattern): clone a rule set —
-- thresholds, basis and every rule — into the next DRAFT version of its
-- name. Without this verb an adopted set is immutable AND unreplaceable:
-- "draft a new version to change it" must name an act that exists.
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
-- 5. Binding authoring (new draft version) + adoption.
-- ---------------------------------------------------------------------------
create or replace function public.set_intensity_binding(
  p_intensity_level text,
  p_independent_assurance_required boolean,
  p_evidence_linked_deliverables_required boolean,
  p_assurance_level text,
  p_review_cadence_days int,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'drafting an intensity binding requires a governance or engineering role');
  end if;
  if governance_intensity_rank(p_intensity_level) = 0 then
    return jsonb_build_object('error', 'intensity_level must be light, standard, elevated or full');
  end if;
  if p_assurance_level not in ('none','line_1','line_2','independent') then
    return jsonb_build_object('error', 'assurance_level must be none, line_1, line_2 or independent');
  end if;
  if p_review_cadence_days is not null and p_review_cadence_days < 1 then
    return jsonb_build_object('error', 'review_cadence_days is a positive number of days, or null');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object('error', 'state the basis for what this intensity level requires (20 characters minimum)');
  end if;

  perform set_config('app.governance_config_write', 'granted', true);
  insert into governance_intensity_bindings
    (organization_id, intensity_level, version, status,
     independent_assurance_required, evidence_linked_deliverables_required,
     assurance_level, review_cadence_days, basis)
  values
    (v_org, p_intensity_level,
     coalesce((select max(version) from governance_intensity_bindings
               where organization_id = v_org and intensity_level = p_intensity_level), 0) + 1,
     'draft',
     coalesce(p_independent_assurance_required, false),
     coalesce(p_evidence_linked_deliverables_required, false),
     p_assurance_level, p_review_cadence_days, btrim(p_basis))
  returning id into v_id;
  perform set_config('app.governance_config_write', '', true);

  return jsonb_build_object('binding_id', v_id, 'intensity_level', p_intensity_level, 'status', 'draft');
end
$$;

revoke all on function public.set_intensity_binding(text, boolean, boolean, text, int, text) from public, anon;
grant execute on function public.set_intensity_binding(text, boolean, boolean, text, int, text) to authenticated;

create or replace function public.adopt_intensity_binding(
  p_binding_id uuid,
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
  b governance_intensity_bindings%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive') then
    return jsonb_build_object('error', 'adopting an intensity binding requires an executive or administrator — it arms enforcement');
  end if;
  select * into b from governance_intensity_bindings
  where id = p_binding_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'binding not found');
  end if;
  if b.status <> 'draft' then
    return jsonb_build_object('error', 'only draft bindings can be adopted');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the authority and basis for adoption (20 characters minimum)');
  end if;

  perform set_config('app.governance_config_write', 'granted', true);
  update governance_intensity_bindings set status = 'superseded', superseded_by = b.id
  where organization_id = v_org and intensity_level = b.intensity_level and status = 'adopted';

  update governance_intensity_bindings
  set status = 'adopted', adopted_by = auth.uid(), adopted_at = now(),
      basis = basis || ' | Adoption: ' || btrim(p_note)
  where id = b.id;
  perform set_config('app.governance_config_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'governance_intensity_binding', coalesce(v_role, 'unknown'),
    jsonb_build_object('binding_id', b.id, 'intensity_level', b.intensity_level,
      'version', b.version, 'action', 'adopted',
      'independent_assurance_required', b.independent_assurance_required,
      'evidence_linked_deliverables_required', b.evidence_linked_deliverables_required));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Governance intensity binding %s v%s adopted by role %s — gate enforcement at this level is now armed.',
            b.intensity_level, b.version, coalesce(v_role, 'none')));

  return jsonb_build_object('binding_id', b.id, 'intensity_level', b.intensity_level, 'status', 'adopted');
end
$$;

revoke all on function public.adopt_intensity_binding(uuid, text) from public, anon;
grant execute on function public.adopt_intensity_binding(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. THE DETERMINATION ACT (D3.03 + D3.04 persisted): compute the six-factor
--    intensity from stated inputs, match the adopted rules, resolve the
--    framework, persist with audit. Refusal-first throughout.
-- ---------------------------------------------------------------------------
create or replace function public.apply_case_governance(
  p_case_id uuid,
  p_risk text default null,
  p_complexity text default null,
  p_novelty text default null,
  p_regulatory_exposure text default null,
  p_interfaces text default null,
  p_basis text default null
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
  rs governance_tailoring_rule_sets%rowtype;
  r governance_tailoring_rules%rowtype;
  f project_frameworks%rowtype;
  b governance_intensity_bindings%rowtype;
  v_value numeric;
  v_missing text[] := '{}';
  v_levels jsonb;
  v_level_value int;
  v_computed int;
  v_effective int;
  v_drivers jsonb;
  v_prior development_case_governance%rowtype;
  v_id uuid;
  v_stage text;
  v_names text[] := array['light','standard','elevated','full'];
  v_demands jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'a governance determination decides what enforcement demands of every later gate — the AI-operator identity cannot record one');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'determining a case''s governance regime requires a governance or engineering role');
  end if;

  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'governance is not determinable on a ' || c.status || ' case');
  end if;
  -- Two concurrent determinations on one case must CHAIN (each superseding
  -- the one before), not race the one-current partial unique index into a
  -- raw 23505 — the lock is per-case and transaction-scoped.
  perform pg_advisory_xact_lock(hashtextextended('development_case_governance:' || p_case_id::text, 0));
  if coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object('error',
      'state the basis for the classification inputs — who assessed them and from what (20 characters minimum)');
  end if;

  -- The adopted rule set is the compiler's configuration. Nothing adopted →
  -- nothing determinable, by name.
  select * into rs from governance_tailoring_rule_sets
  where organization_id = v_org and status = 'adopted'
  order by adopted_at desc limit 1;
  if not found then
    return jsonb_build_object('error',
      'no ADOPTED tailoring rule set exists in this organization — adopt one (adopt_governance_rule_set) before determining governance regimes; a determination without adopted rules would be an opinion');
  end if;
  if not (rs.value_thresholds ? 'standard_from_usd'
          and rs.value_thresholds ? 'elevated_from_usd'
          and rs.value_thresholds ? 'full_from_usd') then
    return jsonb_build_object('error',
      'the adopted rule set states no value band thresholds — governance intensity is not computable: missing value_thresholds (standard_from_usd, elevated_from_usd, full_from_usd)');
  end if;

  -- D3.04: REFUSE NAMING EVERY MISSING FACTOR. Value comes from the case's
  -- own stated number; the five classifications are stated inputs.
  v_value := coalesce(c.sanctioned_value, c.estimated_capex);
  if v_value is null then
    v_missing := array_append(v_missing, 'value (the case states no sanctioned value and no estimated capex — record estimated_capex on the case)');
  elsif v_value = 'NaN'::numeric or v_value = 'Infinity'::numeric or v_value = '-Infinity'::numeric then
    -- Postgres numeric NaN/Infinity compare ABOVE every threshold, so an
    -- unrefused non-finite value would band as full — a fabricated level.
    -- The lib mirror refuses via Number.isFinite; this is the same refusal.
    v_missing := array_append(v_missing,
      format('value (the case''s stated number %s is not a finite amount — correct estimated_capex or sanctioned_value)', v_value));
  end if;
  -- Off-scale ratings ACCUMULATE beside the missing ones (the lib mirror's
  -- behavior): every unusable factor is named in one refusal, not one at a
  -- time across repeated attempts.
  if nullif(btrim(coalesce(p_risk, '')), '') is null then
    v_missing := array_append(v_missing, 'risk (low, medium, high or critical)');
  elsif governance_factor_rating_level('risk', btrim(p_risk)) = 0 then
    v_missing := array_append(v_missing,
      format('risk ("%s" is not on the stated scale: low, medium, high, critical)', btrim(p_risk)));
  end if;
  if nullif(btrim(coalesce(p_complexity, '')), '') is null then
    v_missing := array_append(v_missing, 'complexity (low, medium, high or very_high)');
  elsif governance_factor_rating_level('complexity', btrim(p_complexity)) = 0 then
    v_missing := array_append(v_missing,
      format('complexity ("%s" is not on the stated scale: low, medium, high, very_high)', btrim(p_complexity)));
  end if;
  if nullif(btrim(coalesce(p_novelty, '')), '') is null then
    v_missing := array_append(v_missing, 'novelty (proven, incremental, adapted or first_of_a_kind)');
  elsif governance_factor_rating_level('novelty', btrim(p_novelty)) = 0 then
    v_missing := array_append(v_missing,
      format('novelty ("%s" is not on the stated scale: proven, incremental, adapted, first_of_a_kind)', btrim(p_novelty)));
  end if;
  if nullif(btrim(coalesce(p_regulatory_exposure, '')), '') is null then
    v_missing := array_append(v_missing, 'regulatory_exposure (none, notification, permit_required or major_approval)');
  elsif governance_factor_rating_level('regulatory_exposure', btrim(p_regulatory_exposure)) = 0 then
    v_missing := array_append(v_missing,
      format('regulatory_exposure ("%s" is not on the stated scale: none, notification, permit_required, major_approval)', btrim(p_regulatory_exposure)));
  end if;
  if nullif(btrim(coalesce(p_interfaces, '')), '') is null then
    v_missing := array_append(v_missing, 'interfaces (isolated, limited, multiple or extensive)');
  elsif governance_factor_rating_level('interfaces', btrim(p_interfaces)) = 0 then
    v_missing := array_append(v_missing,
      format('interfaces ("%s" is not on the stated scale: isolated, limited, multiple, extensive)', btrim(p_interfaces)));
  end if;
  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object('error',
      format('governance intensity is not computable: %s of the six I.2 factors are missing or not on their stated scales', array_length(v_missing, 1)),
      'missing_factors', to_jsonb(v_missing));
  end if;

  -- Factor levels. Value bands by the adopted thresholds; the five stated
  -- scales by the one ladder function (mirrored, deliberately, by the pure
  -- lib — see the header).
  v_level_value := case
    when v_value >= (rs.value_thresholds->>'full_from_usd')::numeric then 4
    when v_value >= (rs.value_thresholds->>'elevated_from_usd')::numeric then 3
    when v_value >= (rs.value_thresholds->>'standard_from_usd')::numeric then 2
    else 1
  end;
  v_levels := jsonb_build_object(
    'value', v_level_value,
    'risk', governance_factor_rating_level('risk', btrim(p_risk)),
    'complexity', governance_factor_rating_level('complexity', btrim(p_complexity)),
    'novelty', governance_factor_rating_level('novelty', btrim(p_novelty)),
    'regulatory_exposure', governance_factor_rating_level('regulatory_exposure', btrim(p_regulatory_exposure)),
    'interfaces', governance_factor_rating_level('interfaces', btrim(p_interfaces)));

  select max((v.value)::int) into v_computed from jsonb_each_text(v_levels) v;
  -- Drivers in the spec I.2 factor order — the same order the lib mirror
  -- returns, so preview and record can never list them differently.
  select jsonb_agg(fac.factor order by fac.ord) into v_drivers
  from (values ('value',1),('risk',2),('complexity',3),('novelty',4),
               ('regulatory_exposure',5),('interfaces',6)) fac(factor, ord)
  where (v_levels->>fac.factor)::int = v_computed;

  -- First matching rule in priority order (the compiler).
  select * into r from governance_tailoring_rules
  where rule_set_id = rs.id
    and (lifecycle_types = '[]'::jsonb or lifecycle_types ? c.lifecycle_type)
    and (min_value_usd is null or v_value >= min_value_usd)
    and (max_value_usd is null or v_value < max_value_usd)
    and (min_intensity is null or v_computed >= governance_intensity_rank(min_intensity))
    and (max_intensity is null or v_computed <= governance_intensity_rank(max_intensity))
  order by priority asc limit 1;
  if not found then
    return jsonb_build_object('error',
      format('no tailoring rule in "%s" v%s matches this case (lifecycle %s, value $%s, computed intensity %s) — the compiler selects nothing silently; add or adjust a rule and re-apply',
             rs.name, rs.version, c.lifecycle_type, v_value, v_names[v_computed]));
  end if;

  -- Resolve the selected profile: the currently ADOPTED version of the name.
  select * into f from project_frameworks
  where organization_id = v_org and name = r.framework_name and status = 'adopted'
  order by version desc limit 1;
  if not found then
    return jsonb_build_object('error',
      format('tailoring rule %s selects framework "%s", which has no ADOPTED version in this organization — adopt it (adopt_project_framework) and re-apply',
             r.priority, r.framework_name));
  end if;

  -- The rule floor raises, never lowers (header ruling).
  v_effective := greatest(v_computed, coalesce(governance_intensity_rank(r.intensity_floor), 0));

  -- The case's framework must BE the selected one. A frameworkless case is
  -- seated on the selected framework here (the governed assignment path);
  -- a case already governed by a DIFFERENT framework is refused — framework
  -- reassignment mid-flight re-seats stages and is not this RPC's act.
  if c.framework_id is null then
    select stage_key into v_stage from project_framework_stages
    where framework_id = f.id order by sequence asc limit 1;
    if v_stage is null then
      return jsonb_build_object('error', 'the selected framework has no stages');
    end if;
    if exists (select 1 from stage_gate_reviews
               where development_case_id = c.id and organization_id = v_org) then
      return jsonb_build_object('error',
        'this case already carries gate reviews but no framework — its position must be re-established by a governed framework assignment, not by this determination');
    end if;
    update development_cases
    set framework_id = f.id,
        current_stage_key = case
          when exists (select 1 from project_framework_stages
                       where framework_id = f.id and stage_key = c.current_stage_key)
          then c.current_stage_key else v_stage end,
        updated_at = now()
    where id = c.id;
  elsif c.framework_id <> f.id then
    return jsonb_build_object('error',
      format('this case is governed by a different framework than the rules select ("%s") — framework reassignment is a governed act of its own, and this determination does not perform it',
             r.framework_name));
  end if;

  -- Persist: supersede the prior determination, insert the new current one.
  select * into v_prior from development_case_governance
  where development_case_id = c.id and status = 'current';

  perform set_config('app.case_governance_write', 'granted', true);

  -- Supersede FIRST: the one-current-per-case partial unique index would
  -- refuse a second 'current' row, so the prior determination steps aside
  -- before its successor exists and is stamped with the successor's id
  -- immediately after — all three writes inside one transaction, so no
  -- reader ever sees zero current rows.
  if v_prior.id is not null then
    update development_case_governance
    set status = 'superseded'
    where id = v_prior.id;
  end if;

  insert into development_case_governance
    (organization_id, development_case_id, rule_set_id, rule_id, framework_id,
     intensity_level, computed_level, factor_inputs, factor_levels, drivers,
     basis, status, determined_by)
  values
    (v_org, c.id, rs.id, r.id, f.id,
     v_names[v_effective], v_names[v_computed],
     jsonb_build_object(
       'value_usd', v_value,
       'value_source', case when c.sanctioned_value is not null then 'sanctioned_value' else 'estimated_capex' end,
       'risk', btrim(p_risk), 'complexity', btrim(p_complexity),
       'novelty', btrim(p_novelty),
       'regulatory_exposure', btrim(p_regulatory_exposure),
       'interfaces', btrim(p_interfaces),
       'value_thresholds', rs.value_thresholds),
     v_levels, coalesce(v_drivers, '[]'::jsonb),
     btrim(p_basis), 'current', auth.uid())
  returning id into v_id;

  if v_prior.id is not null then
    update development_case_governance
    set superseded_by = v_id
    where id = v_prior.id;
  end if;

  perform set_config('app.case_governance_write', '', true);

  b := resolve_case_intensity_binding(v_org, v_names[v_effective]);

  -- What the binding demands of the CURRENT stage's gates right now — so a
  -- determination applied AFTER gates were passed surfaces its unmet
  -- demands immediately (and advance/sanction refuse on the same predicate).
  v_demands := case_binding_gate_demands(c.id, null);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_governance', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'determination_id', v_id,
      'intensity_level', v_names[v_effective], 'computed_level', v_names[v_computed],
      'drivers', v_drivers, 'rule_id', r.id, 'rule_priority', r.priority,
      'framework', f.name, 'framework_version', f.version,
      'superseded', v_prior.id,
      'binding_unmet', v_demands));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Governance regime determined for case "%s": %s intensity (computed %s, drivers %s) under rule %s of "%s" v%s, framework "%s" v%s, by role %s.',
            c.title, v_names[v_effective], v_names[v_computed], v_drivers::text,
            r.priority, rs.name, rs.version, f.name, f.version, coalesce(v_role, 'none')));

  return jsonb_build_object(
    'determination_id', v_id,
    'intensity_level', v_names[v_effective],
    'computed_level', v_names[v_computed],
    'drivers', coalesce(v_drivers, '[]'::jsonb),
    'factor_levels', v_levels,
    'rule', jsonb_build_object('id', r.id, 'priority', r.priority, 'description', r.description,
      'intensity_floor', r.intensity_floor),
    'framework', jsonb_build_object('id', f.id, 'name', f.name, 'version', f.version),
    'binding', case when b.id is null then null else jsonb_build_object(
      'intensity_level', b.intensity_level, 'version', b.version,
      'independent_assurance_required', b.independent_assurance_required,
      'evidence_linked_deliverables_required', b.evidence_linked_deliverables_required,
      'assurance_level', b.assurance_level,
      'review_cadence_days', b.review_cadence_days) end,
    'binding_note', case
      when b.id is null
      then 'no ADOPTED binding exists at or below this intensity level — its requirements are not yet armed (adopt_intensity_binding)'
      when b.intensity_level <> v_names[v_effective]
      then format('no ADOPTED binding exists at %s — the strongest adopted binding at-or-below applies (%s v%s); a stricter level is never enforced more weakly than a milder one', v_names[v_effective], b.intensity_level, b.version)
      else null end,
    'binding_unmet', v_demands);
end
$$;

revoke all on function public.apply_case_governance(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.apply_case_governance(uuid, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The governance read: determination, inheritance chain, rule set and
--    bindings in one call. SECURITY DEFINER because the inheritance walk
--    reads ancestor org rows the self-row-only policy hides; what leaves is
--    the case's OWN governance position — node names/levels on the walk and
--    framework identity, nothing else of an ancestor.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_governance(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_det jsonb;
  v_chain jsonb;
  v_resolved record;
  v_resolved_fw jsonb;
  v_rule_set jsonb;
  v_bindings jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select jsonb_build_object(
    'id', g.id,
    'intensityLevel', g.intensity_level,
    'computedLevel', g.computed_level,
    'factorInputs', g.factor_inputs,
    'factorLevels', g.factor_levels,
    'drivers', g.drivers,
    'basis', g.basis,
    'determinedAt', g.determined_at,
    'determinedBy', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = g.determined_by),
    'rule', jsonb_build_object('id', r.id, 'priority', r.priority, 'description', r.description,
      'frameworkName', r.framework_name, 'intensityFloor', r.intensity_floor),
    'ruleSet', jsonb_build_object('id', rs.id, 'name', rs.name, 'version', rs.version),
    'framework', jsonb_build_object('id', f.id, 'name', f.name, 'version', f.version),
    'binding', (
      select jsonb_build_object(
        'intensityLevel', b.intensity_level, 'version', b.version, 'status', b.status,
        'independentAssuranceRequired', b.independent_assurance_required,
        'evidenceLinkedDeliverablesRequired', b.evidence_linked_deliverables_required,
        'assuranceLevel', b.assurance_level, 'reviewCadenceDays', b.review_cadence_days,
        'basis', b.basis)
      from resolve_case_intensity_binding(v_org, g.intensity_level) b
      where b.id is not null))
  into v_det
  from development_case_governance g
  join governance_tailoring_rules r on r.id = g.rule_id
  join governance_tailoring_rule_sets rs on rs.id = g.rule_set_id
  join project_frameworks f on f.id = g.framework_id
  where g.development_case_id = c.id and g.status = 'current';

  -- The org walk, rendered as the chain the resolver saw (node names and
  -- levels only — see the header note on what a DEFINER read may expose).
  select jsonb_agg(jsonb_build_object(
      'nodeId', o.id, 'name', o.name, 'orgLevel', o.org_level, 'depth', a.depth,
      'carriesProfile', o.governance_profile_id is not null)
    order by a.depth)
  into v_chain
  from org_ancestry(v_org) a
  join organizations o on o.id = a.node_id;

  select * into v_resolved from resolve_org_governance_profile(v_org);
  if found then
    select jsonb_build_object(
      'frameworkId', fw.id, 'name', fw.name, 'version', fw.version,
      'sourceAuthority', fw.source_authority,
      'sourceNode', (select jsonb_build_object('nodeId', o.id, 'name', o.name, 'orgLevel', o.org_level)
                     from organizations o where o.id = v_resolved.source_node_id),
      'depth', v_resolved.source_depth,
      'operableHere', fw.organization_id = v_org)
    into v_resolved_fw
    from project_frameworks fw where fw.id = v_resolved.framework_id;
  end if;

  select jsonb_build_object(
    'id', rs.id, 'name', rs.name, 'version', rs.version, 'status', rs.status,
    'valueThresholds', rs.value_thresholds,
    'rules', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'priority', r.priority, 'description', r.description,
        'lifecycleTypes', r.lifecycle_types,
        'minValueUsd', r.min_value_usd, 'maxValueUsd', r.max_value_usd,
        'minIntensity', r.min_intensity, 'maxIntensity', r.max_intensity,
        'frameworkName', r.framework_name, 'intensityFloor', r.intensity_floor)
        order by r.priority), '[]'::jsonb)
      from governance_tailoring_rules r where r.rule_set_id = rs.id))
  into v_rule_set
  from governance_tailoring_rule_sets rs
  where rs.organization_id = v_org and rs.status = 'adopted'
  order by rs.adopted_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'intensityLevel', b.intensity_level, 'version', b.version, 'status', b.status,
      'independentAssuranceRequired', b.independent_assurance_required,
      'evidenceLinkedDeliverablesRequired', b.evidence_linked_deliverables_required,
      'assuranceLevel', b.assurance_level, 'reviewCadenceDays', b.review_cadence_days)
    order by governance_intensity_rank(b.intensity_level)), '[]'::jsonb)
  into v_bindings
  from governance_intensity_bindings b
  where b.organization_id = v_org and b.status = 'adopted';

  return jsonb_build_object(
    'caseId', c.id,
    'caseValueUsd', coalesce(c.sanctioned_value, c.estimated_capex),
    'caseValueSource', case
      when c.sanctioned_value is not null then 'sanctioned_value'
      when c.estimated_capex is not null then 'estimated_capex'
      else null end,
    'bindingUnmet', case_binding_gate_demands(c.id, null),
    'draftRuleSets', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', rs.id, 'name', rs.name, 'version', rs.version) order by rs.name, rs.version), '[]'::jsonb)
      from governance_tailoring_rule_sets rs
      where rs.organization_id = v_org and rs.status = 'draft'),
    'draftBindings', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', b.id, 'intensityLevel', b.intensity_level, 'version', b.version,
          'independentAssuranceRequired', b.independent_assurance_required,
          'evidenceLinkedDeliverablesRequired', b.evidence_linked_deliverables_required,
          'assuranceLevel', b.assurance_level, 'reviewCadenceDays', b.review_cadence_days)
        order by governance_intensity_rank(b.intensity_level), b.version), '[]'::jsonb)
      from governance_intensity_bindings b
      where b.organization_id = v_org and b.status = 'draft'),
    'lifecycleType', c.lifecycle_type,
    'framework', case when c.framework_id is null then null else (
      select jsonb_build_object('id', f.id, 'name', f.name, 'version', f.version, 'status', f.status)
      from project_frameworks f where f.id = c.framework_id) end,
    'determination', v_det,
    'orgChain', coalesce(v_chain, '[]'::jsonb),
    'inheritedProfile', v_resolved_fw,
    'adoptedRuleSet', v_rule_set,
    'adoptedBindings', v_bindings);
end
$$;

revoke all on function public.get_case_governance(uuid) from public, anon;
grant execute on function public.get_case_governance(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Reference seeds, DRAFTS for every organization: a starting proposal a
--    tenant edits and adopts — never silently enforced (the authority_limits
--    posture: drafts arm nothing).
-- ---------------------------------------------------------------------------
create or replace function public.seed_governance_tailoring_defaults(p_target uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rs uuid;
  v_seeded int := 0;
begin
  if not exists (select 1 from organizations where id = p_target) then
    return 0;
  end if;

  perform set_config('app.governance_config_write', 'granted', true);
  if not exists (select 1 from governance_tailoring_rule_sets
                 where organization_id = p_target and name = 'Reference Tailoring Rules') then
    insert into governance_tailoring_rule_sets
      (organization_id, name, version, status, value_thresholds, basis)
    values
      (p_target, 'Reference Tailoring Rules', 1, 'draft',
       '{"standard_from_usd": 5000000, "elevated_from_usd": 50000000, "full_from_usd": 250000000}'::jsonb,
       'Starting proposal mapping the nine lifecycle types onto the seeded library archetypes with placeholder value bands. Replace the bands with this organization''s own delegation and governance boundaries, then adopt (adopt_governance_rule_set). Drafts determine nothing.')
    returning id into v_rs;

    insert into governance_tailoring_rules
      (organization_id, rule_set_id, priority, description, lifecycle_types,
       min_value_usd, max_value_usd, min_intensity, max_intensity,
       framework_name, intensity_floor)
    values
      (p_target, v_rs, 10,
       'Greenfield and capacity investments run the major-capital regime whatever their size.',
       '["greenfield","capacity"]'::jsonb, null, null, null, null,
       'Major Capital Projects — Mining & Metals', null),
      (p_target, v_rs, 20,
       'Routine sustaining work below the elevated value band runs light governance.',
       '["sustaining_capital","replacement","reliability_improvement"]'::jsonb,
       null, 50000000, null, null,
       'Sustaining Capital — Light Governance', null),
      (p_target, v_rs, 30,
       'Sustaining-class work at or above the elevated value band is governed as major capital.',
       '["sustaining_capital","replacement","reliability_improvement"]'::jsonb,
       50000000, null, null, null,
       'Major Capital Projects — Mining & Metals', null),
      (p_target, v_rs, 40,
       'Work on or beside an operating plant runs the brownfield regime with an elevated intensity floor.',
       '["brownfield","life_extension","regulatory","decommissioning"]'::jsonb,
       null, null, null, null,
       'Brownfield Modification — Operating Site', 'elevated');

    v_seeded := v_seeded + 1;
  end if;

  -- One draft binding proposal per level (versioned; set_intensity_binding
  -- drafts replacements).
  insert into governance_intensity_bindings
    (organization_id, intensity_level, version, status,
     independent_assurance_required, evidence_linked_deliverables_required,
     assurance_level, review_cadence_days, basis)
  select p_target, v.level, 1, 'draft', v.assure, v.evidence, v.alevel, v.cadence, v.basis
  from (values
    ('light', false, false, 'none', 90,
     'Proposed: light governance relies on the gate criteria themselves. Placeholder cadence — adopt only from this organization''s governance instrument.'),
    ('standard', false, false, 'line_1', 60,
     'Proposed: standard governance adds first-line review cadence. Placeholder cadence — adopt only from this organization''s governance instrument.'),
    ('elevated', true, true, 'line_2', 45,
     'Proposed: elevated intensity requires independent-of-the-case gate recording and an ACCEPTED deliverable behind every mandatory gate requirement. Adopt only from this organization''s governance instrument.'),
    ('full', true, true, 'independent', 30,
     'Proposed: full intensity requires independent assurance and evidence-linked deliverables on every mandatory gate requirement. Adopt only from this organization''s governance instrument.')
  ) as v(level, assure, evidence, alevel, cadence, basis)
  where not exists (
    select 1 from governance_intensity_bindings b
    where b.organization_id = p_target and b.intensity_level = v.level
  );
  perform set_config('app.governance_config_write', '', true);

  return v_seeded;
end
$$;

revoke all on function public.seed_governance_tailoring_defaults(uuid) from public, anon;
grant execute on function public.seed_governance_tailoring_defaults(uuid) to service_role;

do $$
declare
  o record;
begin
  for o in select id from organizations loop
    perform seed_governance_tailoring_defaults(o.id);
  end loop;
end $$;

-- The tenant-facing seeder now stocks the whole shelf: profiles (090100) +
-- tailoring defaults. Re-created from its 20261120090100 definition with
-- that one addition.
create or replace function public.seed_governance_framework_library()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_n int;
  v_t int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive') then
    return jsonb_build_object('error', 'seeding the framework library requires an executive or administrator');
  end if;

  v_n := seed_governance_framework_library(v_org);
  v_t := seed_governance_tailoring_defaults(v_org);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'project_framework', coalesce(v_role, 'unknown'),
    jsonb_build_object('action', 'library_seeded', 'profiles_added', v_n,
      'tailoring_defaults_added', v_t));

  return jsonb_build_object('profiles_added', v_n, 'tailoring_defaults_added', v_t,
    'note', 'Library content arrives as DRAFTS at INDUSTRY_GUIDANCE/BEST_PRACTICE tier. Nothing governs a case until an accountable person adopts it (adopt_project_framework / adopt_governance_rule_set / adopt_intensity_binding).');
end
$$;

revoke all on function public.seed_governance_framework_library() from public, anon;
grant execute on function public.seed_governance_framework_library() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. provision_organization, re-created from its 20261101090400 definition
--    with EXACTLY ONE addition: every future tenant receives the framework
--    profile library and the tailoring defaults (drafts) beside the other
--    governance reference data. Everything else is byte-identical —
--    assembled from the prior definition at authoring time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_organization(p_name text, p_template_org uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_new uuid;
  v_counts jsonb := '{}'::jsonb;
  v_n int;
begin
  if coalesce(length(trim(p_name)), 0) < 3 then
    return jsonb_build_object('error', 'an organisation needs a name');
  end if;
  if exists (select 1 from organizations where name = trim(p_name)) then
    return jsonb_build_object('error', 'an organisation with that name already exists');
  end if;

  insert into organizations (name) values (trim(p_name)) returning id into v_new;

  -- Independent reference data first.
  insert into damage_mechanisms (organization_id, mechanism_key, name, description)
  select v_new, mechanism_key, name, description
  from damage_mechanisms where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('damage_mechanisms', v_n);

  insert into detection_techniques (organization_id, technique_key, name, description)
  select v_new, technique_key, name, description
  from detection_techniques where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('detection_techniques', v_n);

  -- Then the matrix, remapped through the keys rather than the ids.
  insert into mechanism_detectability (organization_id, mechanism_id, technique_id,
    detectability, typical_warning, basis)
  select v_new, nm.id, nt.id, d.detectability, d.typical_warning, d.basis
  from mechanism_detectability d
  join damage_mechanisms om on om.id = d.mechanism_id
  join detection_techniques ot on ot.id = d.technique_id
  join damage_mechanisms nm on nm.organization_id = v_new and nm.mechanism_key = om.mechanism_key
  join detection_techniques nt on nt.organization_id = v_new and nt.technique_key = ot.technique_key
  where d.organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('mechanism_detectability', v_n);

  insert into system_group_candidates (organization_id, source_label, mechanism_id, basis)
  select v_new, c.source_label, nm.id, c.basis
  from system_group_candidates c
  join damage_mechanisms om on om.id = c.mechanism_id
  join damage_mechanisms nm on nm.organization_id = v_new and nm.mechanism_key = om.mechanism_key
  where c.organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('system_group_candidates', v_n);

  -- Governance reference data, all reset to DRAFT. See the header: one
  -- tenant's adoption is not another's.
  insert into taxonomy_definitions (organization_id, def_key, title, definition, basis, register_ref, status, version)
  select v_new, def_key, title, definition, basis, register_ref, 'draft', 1
  from taxonomy_definitions where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('taxonomy_definitions', v_n);

  insert into authority_limits (organization_id, role_key, tier_label, max_commitment_usd,
    max_risk_level, max_production_downtime_hours, escalates_to_role, basis, status)
  select v_new, role_key, tier_label, max_commitment_usd, max_risk_level,
         max_production_downtime_hours, escalates_to_role, basis, 'draft'
  from authority_limits where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('authority_limits', v_n);

  insert into retention_policies (organization_id, record_class, table_name, timestamp_column,
    retain_years, basis, status)
  select v_new, record_class, table_name, timestamp_column, retain_years, basis, 'draft'
  from retention_policies where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('retention_policies', v_n);

  insert into governance_standards (organization_id, standard_key, title, requirement,
    mandatory, owner_role, variance_approver_role, basis, status, version)
  select v_new, standard_key, title, requirement, mandatory, owner_role,
         variance_approver_role, basis, 'draft', 1
  from governance_standards where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('governance_standards', v_n);

  insert into engineering_approval_rules (organization_id, change_class, title, required_role, basis, status)
  select v_new, change_class, title, required_role, basis, 'draft'
  from engineering_approval_rules where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('engineering_approval_rules', v_n);

  insert into pf_intervals (organization_id, asset_class, failure_mode, detection_technique,
    pf_interval_days, basis, status)
  select v_new, asset_class, failure_mode, detection_technique, pf_interval_days, basis, 'draft'
  from pf_intervals where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('pf_intervals', v_n);

  -- Template materials only. Another tenant's real catalogue is their data.
  insert into materials (organization_id, material_code, description, category,
    unit_of_measure, lead_time_days, repairable, criticality, is_template, basis)
  select v_new, material_code, description, category, unit_of_measure, lead_time_days,
         repairable, criticality, true, basis
  from materials where organization_id = p_template_org and is_template;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('materials_templates', v_n);

  insert into ai_agents (organization_id, key, name, category, status, autonomy_mode)
  select v_new, key, name, category, 'active', autonomy_mode
  from ai_agents where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('ai_agents', v_n);

  -- Added by the lifecycle-stages slice. A new tenant with no gate criteria
  -- has gates that block nothing, which looks like control and is not.
  -- Only STAGE-scoped criteria travel (gate_id is null): gate-scoped rows
  -- belong to a framework this clone does not copy, and copying them without
  -- their gate would junk them into the asset-stage list. The provenance
  -- TIER travels with the content; the promotion RECORD does not — nobody in
  -- the new organisation performed that promotion.
  insert into stage_gate_criteria
    (organization_id, stage_key, criterion, is_mandatory, guidance, sort_order,
     category, evidence_type, minimum_confidence, source_authority)
  select v_new, stage_key, criterion, is_mandatory, guidance, sort_order,
         category, evidence_type, minimum_confidence, source_authority
  from stage_gate_criteria where organization_id = p_template_org and gate_id is null;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('stage_gate_criteria', v_n);

  -- Added by the governance-tailoring slice (D3.02/D3.03): the six starter
  -- framework profiles and the reference tailoring defaults arrive as
  -- DRAFTS at INDUSTRY_GUIDANCE/BEST_PRACTICE tier. Adoption stays an act
  -- by an accountable person in THIS organisation.
  v_n := seed_governance_framework_library(v_new);
  v_counts := v_counts || jsonb_build_object('governance_framework_library', v_n);
  v_n := seed_governance_tailoring_defaults(v_new);
  v_counts := v_counts || jsonb_build_object('governance_tailoring_defaults', v_n);

  return jsonb_build_object('organization_id', v_new, 'name', trim(p_name),
    'cloned', v_counts,
    'note', 'All governance reference data arrives as DRAFT. Adoption is an act by an accountable person in THIS organisation; inheriting another tenant''s adoptions would manufacture governance nobody performed.');
end
$$;

-- Grants unchanged from 20260813090000: service_role only, revoked from
-- public and anon. Restated so the ratchet reads them beside the definition.
revoke all on function public.provision_organization(text, uuid) from public, anon;
grant execute on function public.provision_organization(text, uuid) to service_role;

notify pgrst, 'reload schema';
