-- ============================================================================
-- Sync Develop Slice 4B — THE ESTIMATE BASIS RECORD (D5.16, spec II.7) and
-- THE ESTIMATE CONFIDENCE RATING THAT TRAVELS WITH EVERY FORECAST (D5.17).
--
-- THE SPEC'S OWN WORDS (II.7, Estimate quality assurance):
--
--   "What estimate class? Scope maturity? % quantity-based vs factored?
--    Supporting quotations? Escalation and productivity assumptions?
--    Exclusions? Contingency basis? Then: forecast $284M, estimate
--    confidence LOW. The distinction is crucial."
--
-- ── AMBIGUITY RESOLVED: WHERE THE EIGHTH DIMENSION COMES FROM ──────────────
-- The register row is titled "Estimate basis record (eight dimensions)" and
-- the spec paragraph asks SEVEN questions. The seventh question — "Escalation
-- and productivity assumptions?" — names TWO independent bases joined by an
-- "and": escalation is a market-price trajectory and productivity is a labour
-- performance assumption, they are sourced differently, they move
-- independently, and an estimate can be strong on one and silent on the
-- other. RULING: they are recorded as two dimensions, giving the eight:
--
--   1. estimate_class            (AACE-style class 5 → 1)
--   2. scope_maturity            (concept → detailed design)
--   3. quantity_based_percent    (% quantity-based vs factored)
--   4. quotation_support         (none / indicative / budgetary / firm)
--   5. escalation_basis          (prose, sourced)
--   6. productivity_basis        (prose, sourced)
--   7. exclusions                (prose — what the number does NOT cover)
--   8. contingency_basis         (prose — where the contingency came from)
--
-- ALL EIGHT ARE NOT NULL. The row's own sentence is "an estimate without a
-- basis cannot back a forecast", and a basis record with three of eight
-- dimensions filled in is exactly the half-answer that reads as a whole one.
-- A caller supplying seven gets a refusal that NAMES the missing dimension.
--
-- ── THE RATING IS DERIVED, NEVER DECLARED ──────────────────────────────────
-- There is no `confidence` column on this table and no parameter through
-- which a caller can state one. `estimate_confidence_rating()` derives the
-- band from the eight dimensions by a stated, deterministic mapping and
-- returns the drivers that produced it. A declared confidence is an opinion
-- wearing a number's clothes; §46's own note applies — "configurable
-- weights — do not pretend universal science" — so the mapping is returned
-- WITH the rating so a reader can disagree with it explicitly.
--
-- ── UNRATED IS A STATE, AND IT IS NOT "LOW" ────────────────────────────────
-- With no basis record the rating is `unrated` with a named refusal, not
-- LOW. LOW is a finding about a weak estimate; unrated is the absence of any
-- finding, and collapsing the two would let "nobody wrote the basis down"
-- and "the estimate is genuinely poor" print the same word. Both suppress a
-- confident-looking forecast; only one of them is a statement about the
-- estimate. Every forecast surface in this slice carries the rating, so a
-- number without a basis is visibly unrated rather than silently confident.
--
-- ── IMMUTABLE, VERSIONED ───────────────────────────────────────────────────
-- A basis record that can be edited after a forecast was published rewrites
-- the defence of that forecast. Recording a new basis appends a VERSION; the
-- current basis is the highest version, and every superseded one stays
-- readable beside it.
--
-- §70: recording an estimate basis is refused to the AI-operator identity BY
-- NAME. The eight dimensions determine the confidence that travels with
-- every forecast, so an identity that could write "class 1, 95% quantity-
-- based, firm quotations" would be approving a forecast's confidence without
-- ever touching the forecast.
--
-- Canonical reuse: development_cases, audit_events, security_events,
-- calculation_runs / record_calculation_run (20261130090600). No second
-- estimate store — project_cost_items stays the coded cost record and this
-- describes HOW those numbers were arrived at.
-- ============================================================================

create table if not exists public.project_estimate_basis (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  version int not null check (version >= 1),

  -- DIMENSION 1. AACE-style estimate class, coarsest to finest.
  estimate_class text not null check (estimate_class in
    ('class_5','class_4','class_3','class_2','class_1')),
  -- DIMENSION 2. How mature the scope the estimate was priced against is.
  scope_maturity text not null check (scope_maturity in
    ('concept','feasibility','pre_feed','feed','detailed_design')),
  -- DIMENSION 3. % priced from measured quantities rather than factored from
  -- an analogue. Finite, 0-100, and NOT NULL: "we did not track it" and "it
  -- is zero" are different estimates.
  quantity_based_percent numeric not null,
  -- DIMENSION 4. Strength of the vendor pricing behind it.
  quotation_support text not null check (quotation_support in
    ('none','indicative','budgetary','firm')),
  supporting_quotation_count int not null check (supporting_quotation_count >= 0),
  -- DIMENSIONS 5-8. Prose, and prose is where an estimate is actually
  -- defended, so each carries a length floor rather than being optional.
  escalation_basis text not null check (length(btrim(escalation_basis)) >= 10),
  productivity_basis text not null check (length(btrim(productivity_basis)) >= 10),
  exclusions text not null check (length(btrim(exclusions)) >= 10),
  contingency_basis text not null check (length(btrim(contingency_basis)) >= 10),

  prepared_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (development_case_id, version),
  constraint estimate_quantity_percent_finite check (
    quantity_based_percent > '-Infinity'::numeric
    and quantity_based_percent < 'Infinity'::numeric
    and quantity_based_percent >= 0
    and quantity_based_percent <= 100
  ),
  -- A firm or budgetary quotation claim with no quotations behind it is the
  -- dimension answering itself.
  constraint estimate_quotation_count check (
    quotation_support = 'none' or supporting_quotation_count > 0
  )
);

create index if not exists idx_estimate_basis_case
  on project_estimate_basis(organization_id, development_case_id, version desc);

alter table public.project_estimate_basis enable row level security;
drop policy if exists project_estimate_basis_read on public.project_estimate_basis;
create policy project_estimate_basis_read on public.project_estimate_basis
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: every mutation is a definer RPC.

comment on table public.project_estimate_basis is
  'D5.16 (spec II.7): the eight-dimension estimate basis. All eight NOT NULL — an estimate without a basis cannot back a forecast. There is no confidence column: D5.17 DERIVES the rating from these dimensions and returns the mapping with it.';

-- ---------------------------------------------------------------------------
-- The wall. Append-only for clients, admitted AND audited for service,
-- INSERT/UPDATE/DELETE all covered — a basis that can be edited or removed
-- after a forecast was published rewrites that forecast's defence.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_estimate_basis_immutable()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.estimate_basis_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid;
  v_case_org uuid;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'project_estimate_basis is what every forecast confidence rating on this project is derived from; truncating it makes every published forecast unrated in one statement, with nothing recording that it happened.'
      using errcode = 'insufficient_privilege';
  end if;

  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  if tg_op in ('UPDATE','DELETE') then
    if not v_client and current_user not in ('authenticated', 'anon') then
      if exists (select 1 from organizations where id = v_org) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values
          (v_org, null, 'service (' || current_user || ')',
           'admin_action', 'warning',
           'An estimate basis record was ' || lower(tg_op) || 'd by a service caller. '
             || 'The eight dimensions are what the confidence rating travelling with '
             || 'every forecast is derived from (D5.16/D5.17), so changing one changes '
             || 'what a published forecast is understood to have rested on.');
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    raise exception
      'an estimate basis is immutable — it states what an estimate rested on at the moment forecasts were published against it. Record a new version; the superseded one stays readable beside it.'
      using errcode = 'insufficient_privilege';
  end if;

  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = new.organization_id) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (new.organization_id, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'An estimate basis was written by a service caller outside '
           'record_estimate_basis. The eight dimensions decide the confidence '
           'rating shown beside every forecast on this case (D5.17).');
    end if;
  elsif v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'an estimate basis is written through record_estimate_basis — a direct write would set the confidence shown beside every forecast with no recorded act behind it.'
      using errcode = 'insufficient_privilege';
  end if;

  select organization_id into v_case_org from development_cases where id = new.development_case_id;
  if v_case_org is null or v_case_org <> new.organization_id then
    raise exception
      'this estimate basis is stamped with an organization that does not own its development case'
      using errcode = 'check_violation';
  end if;
  -- The actor column is org-checked too: get_case_estimate_basis resolves it
  -- to an email address inside a SECURITY DEFINER, so a foreign user id
  -- stamped by the (admitted, audited) service path would leak it.
  if new.prepared_by is not null
     and not exists (select 1 from user_profiles up
                      where up.id = new.prepared_by
                        and up.organization_id = new.organization_id) then
    raise exception
      'this estimate basis names a preparer who does not belong to the organization that owns it — the estimate-basis read resolves that id to an email address inside an RLS-bypassing read'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_estimate_basis_immutable() from public, anon, authenticated;

drop trigger if exists trg_estimate_basis_immutable on public.project_estimate_basis;
create trigger trg_estimate_basis_immutable
  before insert or update or delete on public.project_estimate_basis
  for each row execute function public.enforce_estimate_basis_immutable();

drop trigger if exists trg_estimate_basis_no_truncate on public.project_estimate_basis;
create trigger trg_estimate_basis_no_truncate
  before truncate on public.project_estimate_basis
  for each statement execute function public.enforce_estimate_basis_immutable();

revoke truncate on table public.project_estimate_basis from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- THE ACT. §70: refused to the AI-operator identity by name.
-- ---------------------------------------------------------------------------
create or replace function public.record_estimate_basis(
  p_case_id uuid,
  p_basis jsonb
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
  v_class text := nullif(btrim(coalesce(p_basis->>'estimate_class','')), '');
  v_maturity text := nullif(btrim(coalesce(p_basis->>'scope_maturity','')), '');
  v_qty_raw text := nullif(btrim(coalesce(p_basis->>'quantity_based_percent','')), '');
  v_qty numeric;
  v_quote text := nullif(btrim(coalesce(p_basis->>'quotation_support','')), '');
  v_quote_count_raw text := nullif(btrim(coalesce(p_basis->>'supporting_quotation_count','')), '');
  v_quote_count int := 0;
  v_escalation text := nullif(btrim(coalesce(p_basis->>'escalation_basis','')), '');
  v_productivity text := nullif(btrim(coalesce(p_basis->>'productivity_basis','')), '');
  v_exclusions text := nullif(btrim(coalesce(p_basis->>'exclusions','')), '');
  v_contingency text := nullif(btrim(coalesce(p_basis->>'contingency_basis','')), '');
  v_version int;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'the eight dimensions of an estimate basis decide the confidence rating shown beside every forecast on this case — recording them is approving a forecast''s confidence, which the AI-operator identity cannot do (spec §70)');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording an estimate basis requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- ALL EIGHT, NAMED ONE AT A TIME. A partial basis is the half-answer that
  -- reads as a whole one, so the refusal says WHICH dimension is missing.
  if v_class is null then
    return jsonb_build_object('error',
      'dimension 1 of 8 is missing: estimate_class (class_5, class_4, class_3, class_2 or class_1)');
  end if;
  if v_class not in ('class_5','class_4','class_3','class_2','class_1') then
    return jsonb_build_object('error',
      format('"%s" is not an estimate class: class_5, class_4, class_3, class_2, class_1', v_class));
  end if;
  if v_maturity is null then
    return jsonb_build_object('error',
      'dimension 2 of 8 is missing: scope_maturity (concept, feasibility, pre_feed, feed or detailed_design)');
  end if;
  if v_maturity not in ('concept','feasibility','pre_feed','feed','detailed_design') then
    return jsonb_build_object('error',
      format('"%s" is not a scope maturity: concept, feasibility, pre_feed, feed, detailed_design', v_maturity));
  end if;
  if v_qty_raw is null then
    return jsonb_build_object('error',
      'dimension 3 of 8 is missing: quantity_based_percent — how much of this estimate was priced from measured quantities rather than factored from an analogue. "We did not track it" and "it is zero" are different estimates, so there is no default.');
  end if;
  v_qty := sync_text_as_numeric(v_qty_raw);
  if v_qty is null then
    return jsonb_build_object('error', format('quantity_based_percent "%s" is not a number', v_qty_raw));
  end if;
  if v_qty = 'NaN'::numeric or v_qty = 'Infinity'::numeric or v_qty = '-Infinity'::numeric then
    return jsonb_build_object('error',
      format('quantity_based_percent is %s; it must be a finite number', v_qty));
  end if;
  if v_qty < 0 or v_qty > 100 then
    return jsonb_build_object('error',
      format('quantity_based_percent is %s; it is a percentage between 0 and 100', v_qty));
  end if;
  if v_quote is null then
    return jsonb_build_object('error',
      'dimension 4 of 8 is missing: quotation_support (none, indicative, budgetary or firm)');
  end if;
  if v_quote not in ('none','indicative','budgetary','firm') then
    return jsonb_build_object('error',
      format('"%s" is not a quotation support level: none, indicative, budgetary, firm', v_quote));
  end if;
  if v_quote_count_raw is not null then
    begin
      v_quote_count := v_quote_count_raw::int;
    exception when others then
      return jsonb_build_object('error',
        format('supporting_quotation_count "%s" is not a whole number', v_quote_count_raw));
    end;
  end if;
  if v_quote <> 'none' and v_quote_count <= 0 then
    return jsonb_build_object('error',
      format('quotation_support is "%s" but no supporting quotations are counted — a quotation strength with no quotations behind it is the dimension answering itself', v_quote));
  end if;
  if v_escalation is null or length(v_escalation) < 10 then
    return jsonb_build_object('error',
      'dimension 5 of 8 is missing: escalation_basis — the price trajectory this estimate assumes, and where it came from (10 characters minimum)');
  end if;
  if v_productivity is null or length(v_productivity) < 10 then
    return jsonb_build_object('error',
      'dimension 6 of 8 is missing: productivity_basis — the labour performance this estimate assumes, and where it came from (10 characters minimum). Escalation and productivity are recorded separately because an estimate can be well sourced on one and silent on the other.');
  end if;
  if v_exclusions is null or length(v_exclusions) < 10 then
    return jsonb_build_object('error',
      'dimension 7 of 8 is missing: exclusions — what this number does NOT cover (10 characters minimum). "Nothing is excluded" is itself a statement and must be written down as one.');
  end if;
  if v_contingency is null or length(v_contingency) < 10 then
    return jsonb_build_object('error',
      'dimension 8 of 8 is missing: contingency_basis — where the contingency in this estimate came from (10 characters minimum)');
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from project_estimate_basis where development_case_id = c.id;

  perform set_config('app.estimate_basis_write', 'granted', true);
  insert into project_estimate_basis
    (organization_id, development_case_id, version, estimate_class, scope_maturity,
     quantity_based_percent, quotation_support, supporting_quotation_count,
     escalation_basis, productivity_basis, exclusions, contingency_basis, prepared_by)
  values (v_org, c.id, v_version, v_class, v_maturity, v_qty, v_quote, v_quote_count,
          v_escalation, v_productivity, v_exclusions, v_contingency, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_estimate_basis', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'estimate_basis_id', v_id, 'version', v_version,
      'action', 'recorded'),
    null,
    jsonb_build_object('version', v_version, 'estimate_class', v_class,
      'scope_maturity', v_maturity, 'quantity_based_percent', v_qty,
      'quotation_support', v_quote, 'supporting_quotation_count', v_quote_count));

  return jsonb_build_object('estimate_basis_id', v_id, 'version', v_version,
    'estimate_class', v_class, 'confidence', estimate_confidence_rating(c.id));
end
$$;

revoke all on function public.record_estimate_basis(uuid, jsonb) from public, anon, service_role;
grant execute on function public.record_estimate_basis(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- D5.17 — THE DERIVATION. One predicate; everything that shows a forecast
-- calls THIS, so the rating beside a number cannot differ between screens.
--
-- THE MAPPING, STATED (spec §46's discipline: "configurable weights — do not
-- pretend universal science"). It is returned WITH the rating as `drivers`,
-- so a reader can see exactly which of the eight dimensions moved it:
--
--   start   class_1/class_2 → high · class_3 → medium · class_4/class_5 → low
--   -1 band quantity_based_percent < 50   (mostly factored, not measured)
--   -1 band quotation_support in (none, indicative)
--   -1 band scope_maturity in (concept, feasibility)
--   floor   low. There is no band below it and no arithmetic that invents one.
--
-- The rating NEVER goes up. Nothing in the eight dimensions is evidence that
-- an estimate is better than its class, and a mapping that could promote
-- would let a well-written exclusions paragraph out-vote a class 5 estimate.
-- ---------------------------------------------------------------------------
-- ── THE TENANT GATE ON AN INTERNAL HELPER ──────────────────────────────────
-- This function is SECURITY DEFINER, so it runs as the owner and RLS on
-- project_estimate_basis does not apply to it. It returns the four PROSE
-- dimensions — escalation, productivity, exclusions, contingency — which are
-- the commercially sensitive defence of a competitor's number.
--
-- It therefore carries 20261130090700's DUAL-CALLER GATE, in that migration's
-- own words: `current_user` inside a SECURITY DEFINER owned by postgres is
-- always `postgres`, never 'authenticated', so `auth.uid()` is the only
-- discriminator that can tell a JWT holder from an internal definer caller.
-- A JWT holder whose app_current_org() is NULL, or one whose org does not own
-- the case, is refused; an internal caller (no JWT — the three definers in
-- this slice that already scoped the case before calling) passes through.
--
-- AND it has no EXECUTE grant, for the reason 20261130090500 states about
-- controls_structure_state: a grant to `authenticated` on a helper whose only
-- callers are other definers buys nothing and opens a direct PostgREST route
-- to every tenant's data. Belt AND braces: the gate holds even if a future
-- migration re-grants it, and the missing grant means a caller never reaches
-- the gate in the first place.
create or replace function public.estimate_confidence_rating(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_org uuid := app_current_org();
  b project_estimate_basis%rowtype;
  v_score int;
  v_drivers jsonb := '[]'::jsonb;
  v_band text;
begin
  if auth.uid() is not null and v_caller_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if not exists (select 1 from development_cases dc
                  where dc.id = p_case_id
                    and (v_caller_org is null or dc.organization_id = v_caller_org)) then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select * into b from project_estimate_basis
   where development_case_id = p_case_id order by version desc limit 1;

  if not found then
    -- UNRATED IS NOT LOW. Absence of a finding is not a finding.
    return jsonb_build_object(
      'rating', null,
      'band', 'unrated',
      'basisVersion', null,
      'drivers', '[]'::jsonb,
      'refusal',
        'No estimate basis is recorded on this case, so this forecast is UNRATED — not LOW. LOW is a finding about a weak estimate; unrated is the absence of any finding, and a forecast shown without either is a number wearing a confidence it never earned. Record the eight-dimension estimate basis (spec II.7) to rate it.');
  end if;

  v_score := case b.estimate_class
    when 'class_1' then 3 when 'class_2' then 3
    when 'class_3' then 2
    else 1 end;
  v_drivers := v_drivers || to_jsonb(format(
    'Estimate class %s sets the starting band.', replace(b.estimate_class, '_', ' '))::text);

  if b.quantity_based_percent < 50 then
    v_score := v_score - 1;
    v_drivers := v_drivers || to_jsonb(format(
      'Only %s percent of the estimate is priced from measured quantities; the rest is factored from an analogue.',
      b.quantity_based_percent)::text);
  end if;
  if b.quotation_support in ('none','indicative') then
    v_score := v_score - 1;
    v_drivers := v_drivers || to_jsonb(format(
      'Vendor pricing support is "%s" (%s quotation(s)).', b.quotation_support,
      b.supporting_quotation_count)::text);
  end if;
  if b.scope_maturity in ('concept','feasibility') then
    v_score := v_score - 1;
    v_drivers := v_drivers || to_jsonb(format(
      'The scope this was priced against is at %s maturity.',
      replace(b.scope_maturity, '_', ' '))::text);
  end if;

  v_band := case when v_score >= 3 then 'high' when v_score = 2 then 'medium' else 'low' end;

  return jsonb_build_object(
    'rating', v_band,
    'band', v_band,
    'basisVersion', b.version,
    'basisRecordedAt', b.created_at,
    'estimateClass', b.estimate_class,
    'scopeMaturity', b.scope_maturity,
    'quantityBasedPercent', b.quantity_based_percent,
    'quotationSupport', b.quotation_support,
    'supportingQuotationCount', b.supporting_quotation_count,
    'escalationBasis', b.escalation_basis,
    'productivityBasis', b.productivity_basis,
    'exclusions', b.exclusions,
    'contingencyBasis', b.contingency_basis,
    'drivers', v_drivers,
    'mapping',
      'class 1-2 high, class 3 medium, class 4-5 low; one band down for each of: under half priced from measured quantities, vendor pricing no stronger than indicative, scope at concept or feasibility maturity. The band never rises above its class — nothing in the eight dimensions is evidence that an estimate is better than the class it was built to.',
    'refusal', null);
end
$$;

-- No EXECUTE for anyone. Its callers are get_case_estimate_basis,
-- get_case_earned_value and get_case_forecast_confidence, all SECURITY
-- DEFINER and all of which scope the case to the caller's org first.
revoke all on function public.estimate_confidence_rating(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The estimate basis read: the CURRENT record plus every superseded version.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_estimate_basis(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_current jsonb;
  v_history jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select to_jsonb(x) into v_current from (
    select b.id, b.version, b.estimate_class as "estimateClass",
           b.scope_maturity as "scopeMaturity",
           b.quantity_based_percent as "quantityBasedPercent",
           b.quotation_support as "quotationSupport",
           b.supporting_quotation_count as "supportingQuotationCount",
           b.escalation_basis as "escalationBasis",
           b.productivity_basis as "productivityBasis",
           b.exclusions, b.contingency_basis as "contingencyBasis",
           u.email as "preparedBy", b.created_at as "recordedAt"
    from project_estimate_basis b
    left join user_profiles u on u.id = b.prepared_by
    where b.development_case_id = c.id
    order by b.version desc limit 1
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'version', b.version, 'estimateClass', b.estimate_class,
           'scopeMaturity', b.scope_maturity, 'recordedAt', b.created_at,
           'preparedBy', u.email) order by b.version desc), '[]'::jsonb)
    into v_history
  from project_estimate_basis b
  left join user_profiles u on u.id = b.prepared_by
  where b.development_case_id = c.id;

  return jsonb_build_object(
    'caseId', c.id,
    'current', v_current,
    'versions', v_history,
    'confidence', estimate_confidence_rating(c.id),
    -- The eight dimensions are listed even when none is recorded, because a
    -- surface that shows nothing shows no obligation either.
    'dimensions', jsonb_build_array(
      'estimate_class', 'scope_maturity', 'quantity_based_percent', 'quotation_support',
      'escalation_basis', 'productivity_basis', 'exclusions', 'contingency_basis'));
end
$$;

revoke all on function public.get_case_estimate_basis(uuid) from public, anon, service_role;
grant execute on function public.get_case_estimate_basis(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- THE COMPUTE (D11.29). The rating is a calculation, so it records a run —
-- including when it refuses. A confidence that appears on a forecast with no
-- recorded derivation behind it is exactly the "silently confident" number
-- D5.17 exists to prevent.
-- ---------------------------------------------------------------------------
create or replace function public.compute_case_estimate_confidence(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  b project_estimate_basis%rowtype;
  v_rating jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_outputs jsonb;
  v_run uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'computing the estimate confidence requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_rating := estimate_confidence_rating(c.id);
  select * into b from project_estimate_basis
   where development_case_id = c.id order by version desc limit 1;

  if v_rating->>'refusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_rating->>'refusal');
  end if;
  if v_rating->>'rating' is null then
    v_outputs := null;
  else
    -- THE DRIVERS ARE AN OUTPUT, NOT A REFUSAL. A rating recorded without
    -- the reasons it landed where it did is a letter with no argument behind
    -- it, so they are recorded — but recording them as REFUSALS made
    -- `status = 'computed'` unreachable (the estimate-class driver is always
    -- present), which turns the run's own refusal signal into noise and
    -- makes a partial answer indistinguishable from a whole one in exactly
    -- the direction opposite to the failure this slice is written against.
    -- Only a band that FELL below its class carries a refusal, and it names
    -- which dimension pulled it down.
    if jsonb_array_length(coalesce(v_rating->'drivers', '[]'::jsonb)) > 1 then
      v_refusals := v_refusals || to_jsonb(format(
        'The confidence band is %s, one or more bands below the %s starting band: %s',
        upper(v_rating->>'band'), replace(v_rating->>'estimateClass', '_', ' '),
        (select string_agg(d #>> '{}', ' ')
           from jsonb_array_elements(v_rating->'drivers') with ordinality t(d, i)
          where i > 1))::text);
    end if;
    v_outputs := jsonb_build_object(
      'band', v_rating->'band',
      'drivers', coalesce(v_rating->'drivers', '[]'::jsonb),
      'basisVersion', v_rating->'basisVersion',
      'estimateClass', v_rating->'estimateClass',
      'scopeMaturity', v_rating->'scopeMaturity',
      'quantityBasedPercent', v_rating->'quantityBasedPercent',
      'quotationSupport', v_rating->'quotationSupport',
      'mapping', v_rating->'mapping');
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_estimate_confidence',
    'The estimate confidence band derived from the eight-dimension estimate basis (spec II.7): the estimate class sets the starting band and it falls one band for each of — under half priced from measured quantities, vendor pricing no stronger than indicative, scope at concept or feasibility maturity. The band never rises above its class, and no basis record means UNRATED rather than LOW.',
    jsonb_build_object(
      'basisVersion', v_rating->'basisVersion',
      'estimateClass', coalesce(v_rating->'estimateClass', 'null'::jsonb),
      'scopeMaturity', coalesce(v_rating->'scopeMaturity', 'null'::jsonb),
      'quantityBasedPercent', coalesce(v_rating->'quantityBasedPercent', 'null'::jsonb),
      'quotationSupport', coalesce(v_rating->'quotationSupport', 'null'::jsonb)),
    case when b.id is null then '[]'::jsonb
         else jsonb_build_array(jsonb_build_object('table', 'project_estimate_basis', 'id', b.id)) end,
    v_outputs,
    v_refusals);

  return v_rating || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_estimate_confidence'));
end
$$;

revoke all on function public.compute_case_estimate_confidence(uuid) from public, anon, service_role;
grant execute on function public.compute_case_estimate_confidence(uuid) to authenticated;
