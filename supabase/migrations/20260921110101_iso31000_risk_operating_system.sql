-- ============================================================================
-- SyncAI risk operating system — ISO 31000 principles, framework and process.
--
-- POSITIONING AND BOUNDARY
-- This is not a checklist module and does not claim certification. It makes
-- risk-informed decision-making executable inside the existing SyncAI loop.
-- Organization-specific criteria remain draft until an authorized human adopts
-- them. Safety-critical and operational actions remain human-approved.
--
-- CANONICAL REUSE
--   evidence_items  -> all evidence and source provenance
--   scenarios       -> treatment alternatives and trade-offs
--   recommendations -> selected treatments
--   approvals       -> treatment/decision approval workflow
--   decisions       -> decision record
--   work_orders     -> executable treatment work
--   verification_obligations -> outcome verification
--   learning_events -> outcome, failure and improvement feedback
--   risk_acceptances + authority_limits -> time-bounded residual acceptance
--   competencies + member_competencies -> qualification checks
--   industry profiles / asset hierarchy -> sector and asset context
--
-- New tables hold only concepts not already represented: context, criteria,
-- the universal risk object, controls, indicators, stakeholder views,
-- inter-risk connections, framework review and maturity. No parallel evidence,
-- recommendation, approval, work, decision, verification or audit store exists.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Context engine: enterprise -> business unit -> site -> mission -> system ->
-- asset -> decision/activity. Site and asset references reuse canonical IDs.
-- ---------------------------------------------------------------------------
create table if not exists risk_context_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  parent_id uuid references risk_context_nodes(id) on delete restrict,
  scope_kind text not null check (scope_kind in
    ('enterprise','business_unit','site','mission','system','asset','decision','activity')),
  site_id uuid references sites(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  name text not null,
  mission_or_service text,
  objectives jsonb not null default '[]'::jsonb,
  stakeholders jsonb not null default '[]'::jsonb,
  regulations jsonb not null default '[]'::jsonb,
  financial_constraints jsonb not null default '[]'::jsonb,
  safety_requirements jsonb not null default '[]'::jsonb,
  environmental_obligations jsonb not null default '[]'::jsonb,
  operating_limits jsonb not null default '[]'::jsonb,
  policies jsonb not null default '[]'::jsonb,
  dependencies jsonb not null default '[]'::jsonb,
  decision_authority jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','adopted','superseded')),
  version int not null default 1 check (version > 0),
  review_date date,
  created_by uuid references auth.users(id),
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(objectives) = 'array'),
  check (jsonb_typeof(stakeholders) = 'array'),
  check (jsonb_typeof(regulations) = 'array'),
  check (jsonb_typeof(decision_authority) = 'object')
);

create index if not exists idx_risk_context_parent
  on risk_context_nodes(organization_id, parent_id, scope_kind);
create index if not exists idx_risk_context_site
  on risk_context_nodes(organization_id, site_id) where site_id is not null;
create index if not exists idx_risk_context_asset
  on risk_context_nodes(organization_id, asset_id) where asset_id is not null;

-- ---------------------------------------------------------------------------
-- Criteria engine. JSON retains customer-defined labels and scales without
-- pretending every organization uses the same matrix. Adoption validates the
-- executable contract; draft profiles cannot authorize an evaluation.
-- ---------------------------------------------------------------------------
create table if not exists risk_criteria_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  context_id uuid references risk_context_nodes(id) on delete set null,
  name text not null,
  industry_code text,
  jurisdiction text,
  version int not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft','adopted','superseded')),
  consequence_dimensions jsonb not null default '[]'::jsonb,
  likelihood_scale jsonb not null default '[]'::jsonb,
  thresholds jsonb not null default '{}'::jsonb,
  scoring_weights jsonb not null default '{}'::jsonb,
  decision_thresholds jsonb not null default '{}'::jsonb,
  risk_capacity jsonb not null default '{}'::jsonb,
  aggregate_rules jsonb not null default '{}'::jsonb,
  time_factors jsonb not null default '{}'::jsonb,
  tolerance_statements jsonb not null default '[]'::jsonb,
  basis text not null,
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  superseded_by uuid references risk_criteria_profiles(id),
  review_date date,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(consequence_dimensions) = 'array'),
  check (jsonb_typeof(likelihood_scale) = 'array'),
  check (jsonb_typeof(thresholds) = 'object'),
  check (jsonb_typeof(scoring_weights) = 'object'),
  check (jsonb_typeof(decision_thresholds) = 'object'),
  check (jsonb_typeof(risk_capacity) = 'object'),
  check (jsonb_typeof(aggregate_rules) = 'object'),
  check (jsonb_typeof(time_factors) = 'object'),
  check (jsonb_typeof(tolerance_statements) = 'array')
);

create index if not exists idx_risk_criteria_active
  on risk_criteria_profiles(organization_id, context_id, status, version desc);

-- ---------------------------------------------------------------------------
-- Universal risk object. Risk source -> event -> consequences -> likelihood ->
-- controls, with uncertainty, connectivity, time, capacity and confidence kept
-- explicit. Scope fields are first-class because an undefined score is not a
-- decision assessment.
-- ---------------------------------------------------------------------------
create table if not exists risks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  context_id uuid references risk_context_nodes(id) on delete restrict,
  criteria_profile_id uuid references risk_criteria_profiles(id) on delete restrict,
  site_id uuid references sites(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  title text not null,
  kind text not null default 'threat' check (kind in ('threat','opportunity','both')),
  objective_at_risk text,
  risk_source text,
  event_description text,
  causes jsonb not null default '[]'::jsonb,
  consequences jsonb not null default '{}'::jsonb,
  likelihood numeric check (likelihood is null or likelihood >= 0),
  existing_controls_summary text,
  analysis_level text check (analysis_level is null or analysis_level in
    ('qualitative','semi_quantitative','quantitative')),
  analysis_method text,
  analysis_model_reference text,
  control_effectiveness numeric check (control_effectiveness is null or control_effectiveness between 0 and 100),
  uncertainty numeric check (uncertainty is null or uncertainty between 0 and 100),
  confidence numeric check (confidence is null or confidence between 0 and 100),
  complexity numeric check (complexity is null or complexity between 0 and 100),
  connectivity numeric check (connectivity is null or connectivity between 0 and 100),
  exposure numeric check (exposure is null or exposure between 0 and 100),
  capacity_load numeric check (capacity_load is null or capacity_load >= 0),
  risk_velocity numeric check (risk_velocity is null or risk_velocity between -100 and 100),
  time_to_unacceptable interval,
  inherent_risk_score numeric check (inherent_risk_score is null or inherent_risk_score between 0 and 100),
  current_risk_score numeric check (current_risk_score is null or current_risk_score between 0 and 100),
  residual_risk_score numeric check (residual_risk_score is null or residual_risk_score between 0 and 100),
  target_risk_score numeric check (target_risk_score is null or target_risk_score between 0 and 100),
  opportunity_score numeric check (opportunity_score is null or opportunity_score between 0 and 100),
  value_at_risk numeric check (value_at_risk is null or value_at_risk >= 0),
  value_currency text not null default 'USD',
  current_risk_level text check (current_risk_level is null or current_risk_level in
    ('Very Low','Low','Medium','High','Critical')),
  residual_risk_level text check (residual_risk_level is null or residual_risk_level in
    ('Very Low','Low','Medium','High','Critical')),
  target_risk_level text check (target_risk_level is null or target_risk_level in
    ('Very Low','Low','Medium','High','Critical')),
  decision_action text check (decision_action is null or decision_action in
    ('ACCEPT','MONITOR','INVESTIGATE','TREAT','ESCALATE','STOP')),
  risk_owner_id uuid references user_profiles(id) on delete set null,
  decision_owner_id uuid references user_profiles(id) on delete set null,
  stakeholders jsonb not null default '[]'::jsonb,
  escalation_threshold text,
  review_date date,
  -- Scope discipline: what decision, objective, boundary, horizon and owner?
  scope_decision text,
  scope_expected_outcome text,
  scope_inclusions jsonb not null default '[]'::jsonb,
  scope_exclusions jsonb not null default '[]'::jsonb,
  time_horizon text,
  location_scope text,
  resource_scope jsonb not null default '[]'::jsonb,
  responsibility_scope jsonb not null default '[]'::jsonb,
  relationship_scope jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  biases jsonb not null default '[]'::jsonb,
  bias_review_complete boolean not null default false,
  method_limitations jsonb not null default '[]'::jsonb,
  data_quality text,
  value_of_information jsonb not null default '{}'::jsonb,
  reporting_profile jsonb not null default '{}'::jsonb,
  information_sensitivity text not null default 'internal' check (information_sensitivity in
    ('public','internal','confidential','restricted')),
  status text not null default 'draft' check (status in
    ('draft','identified','analyzed','evaluated','treatment_active','monitoring','closed','archived')),
  source_kind text not null default 'human' check (source_kind in
    ('human','agent','integration','legacy_provisional')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(causes) = 'array'),
  check (jsonb_typeof(consequences) = 'object'),
  check (jsonb_typeof(stakeholders) = 'array'),
  check (jsonb_typeof(scope_inclusions) = 'array'),
  check (jsonb_typeof(scope_exclusions) = 'array'),
  check (jsonb_typeof(assumptions) = 'array'),
  check (jsonb_typeof(biases) = 'array'),
  check (jsonb_typeof(method_limitations) = 'array'),
  check (jsonb_typeof(value_of_information) = 'object'),
  check (jsonb_typeof(reporting_profile) = 'object')
);

create index if not exists idx_risks_portfolio
  on risks(organization_id, status, current_risk_score desc);
create index if not exists idx_risks_owner
  on risks(organization_id, risk_owner_id, review_date);
create index if not exists idx_risks_context
  on risks(organization_id, context_id, current_risk_level);
create index if not exists idx_risks_asset
  on risks(organization_id, asset_id) where asset_id is not null;

-- ---------------------------------------------------------------------------
-- Control effectiveness: reusable controls, risk links and test history.
-- Risk control tests are not the platform audit log; material actions are also
-- written to canonical audit_events by controlled RPCs below.
-- ---------------------------------------------------------------------------
create table if not exists risk_controls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  context_id uuid references risk_context_nodes(id) on delete set null,
  name text not null,
  control_type text not null check (control_type in
    ('preventive','detective','mitigative','recovery','governance')),
  intended_effect text not null,
  control_owner_id uuid references user_profiles(id) on delete set null,
  required_competency_id bigint references competencies(id) on delete set null,
  assurance_method text,
  test_frequency_days int check (test_frequency_days is null or test_frequency_days > 0),
  design_status text not null default 'draft' check (design_status in
    ('draft','implemented','retired')),
  effectiveness_rating text not null default 'unknown' check (effectiveness_rating in
    ('unknown','effective','partial','weak','ineffective')),
  effectiveness_score numeric check (effectiveness_score is null or effectiveness_score between 0 and 100),
  effectiveness_confidence numeric check (effectiveness_confidence is null or effectiveness_confidence between 0 and 100),
  trend text not null default 'unknown' check (trend in
    ('unknown','improving','stable','declining')),
  last_tested_at timestamptz,
  next_test_due date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists risk_control_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  risk_id uuid not null references risks(id) on delete cascade,
  control_id uuid not null references risk_controls(id) on delete cascade,
  intended_modifier text not null check (intended_modifier in
    ('likelihood','consequence','exposure','detectability','recovery','uncertainty')),
  claimed_reduction numeric check (claimed_reduction is null or claimed_reduction between 0 and 100),
  evidence_basis text,
  created_at timestamptz not null default now(),
  unique (risk_id, control_id)
);

create table if not exists risk_control_tests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  control_id uuid not null references risk_controls(id) on delete cascade,
  test_method text not null,
  result text not null check (result in ('passed','failed','inconclusive','not_exercised')),
  intended_effect_observed boolean,
  failures_despite_control int not null default 0 check (failures_despite_control >= 0),
  evidence_item_id uuid references evidence_items(id) on delete set null,
  note text not null,
  tested_by uuid references auth.users(id),
  tested_at timestamptz not null default now()
);

create index if not exists idx_risk_controls_due
  on risk_controls(organization_id, next_test_due) where design_status = 'implemented';
create index if not exists idx_risk_control_links_risk
  on risk_control_links(organization_id, risk_id);
create index if not exists idx_risk_control_tests_recent
  on risk_control_tests(organization_id, control_id, tested_at desc);

-- ---------------------------------------------------------------------------
-- Dynamic monitoring and leading indicators. Observations preserve history;
-- indicator state is a cache of the latest value for the live cockpit.
-- ---------------------------------------------------------------------------
create table if not exists risk_indicators (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  risk_id uuid not null references risks(id) on delete cascade,
  sensor_id uuid references sensors(id) on delete set null,
  name text not null,
  source_system text not null,
  signal_key text,
  unit text,
  direction text not null default 'higher_is_worse' check (direction in
    ('higher_is_worse','lower_is_worse','outside_band','state_change')),
  thresholds jsonb not null default '{}'::jsonb,
  current_value numeric,
  previous_value numeric,
  current_state text not null default 'unknown' check (current_state in
    ('unknown','normal','warning','critical')),
  observed_at timestamptz,
  refresh_interval_minutes int check (refresh_interval_minutes is null or refresh_interval_minutes > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(thresholds) = 'object')
);

create table if not exists risk_indicator_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  indicator_id uuid not null references risk_indicators(id) on delete cascade,
  evidence_item_id uuid references evidence_items(id) on delete set null,
  value numeric not null,
  state text not null check (state in ('normal','warning','critical')),
  data_quality text not null default 'good',
  source_reference text,
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_risk_indicators_risk
  on risk_indicators(organization_id, risk_id, active);
create index if not exists idx_risk_indicator_obs
  on risk_indicator_observations(organization_id, indicator_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- Inclusive consultation, divergent views and stakeholder perception.
-- Rows are append-only through the RPC: disagreement is resolved by adding a
-- resolution, never by overwriting the opinion that existed at decision time.
-- ---------------------------------------------------------------------------
create table if not exists risk_stakeholder_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  risk_id uuid not null references risks(id) on delete cascade,
  stakeholder_user_id uuid references user_profiles(id) on delete set null,
  stakeholder_name text not null,
  stakeholder_role text,
  view_kind text not null default 'technical' check (view_kind in
    ('technical','operational','financial','stakeholder_concern','oversight')),
  perceived_likelihood numeric check (perceived_likelihood is null or perceived_likelihood >= 0),
  perceived_consequence numeric check (perceived_consequence is null or perceived_consequence >= 0),
  concern_level text check (concern_level is null or concern_level in
    ('low','medium','high','critical')),
  rationale text not null,
  assumptions jsonb not null default '[]'::jsonb,
  information_to_resolve text,
  status text not null default 'open' check (status in ('open','resolved','withdrawn')),
  resolved_by_view_id uuid references risk_stakeholder_views(id),
  recorded_at timestamptz not null default now(),
  check (jsonb_typeof(assumptions) = 'array')
);

create index if not exists idx_risk_views_open
  on risk_stakeholder_views(organization_id, risk_id, status);

-- ---------------------------------------------------------------------------
-- Connectivity, cascading effects, combinations and common dependencies.
-- ---------------------------------------------------------------------------
create table if not exists risk_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_risk_id uuid not null references risks(id) on delete cascade,
  target_risk_id uuid not null references risks(id) on delete cascade,
  relationship text not null check (relationship in
    ('causes','amplifies','cascades_to','common_dependency','common_control','opportunity_tradeoff','sequence')),
  dependency_key text,
  strength numeric check (strength is null or strength between 0 and 100),
  rationale text not null,
  created_at timestamptz not null default now(),
  check (source_risk_id <> target_risk_id),
  unique (source_risk_id, target_risk_id, relationship)
);

create index if not exists idx_risk_links_source
  on risk_links(organization_id, source_risk_id);
create index if not exists idx_risk_links_target
  on risk_links(organization_id, target_risk_id);

-- ---------------------------------------------------------------------------
-- Framework effectiveness, adaptation and maturity (principles/framework/
-- process). This is second-order assurance: is the management system working?
-- ---------------------------------------------------------------------------
create table if not exists risk_framework_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  context_id uuid references risk_context_nodes(id) on delete set null,
  trigger_type text not null check (trigger_type in
    ('scheduled','regulation_change','organizational_restructure','acquisition','new_technology',
     'new_asset_type','weather_change','supply_chain_deterioration','workforce_loss',
     'major_incident','new_operating_regime')),
  trigger_detail text not null,
  material boolean not null,
  criteria_review_required boolean not null default false,
  framework_suitable boolean,
  framework_effective boolean,
  findings jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open','reviewed','closed')),
  owner_id uuid references user_profiles(id) on delete set null,
  due_date date,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(findings) = 'array'),
  check (jsonb_typeof(actions) = 'array')
);

create table if not exists risk_maturity_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  context_id uuid references risk_context_nodes(id) on delete set null,
  principle_scores jsonb not null,
  framework_scores jsonb not null,
  process_scores jsonb not null,
  maturity_level int not null check (maturity_level between 0 and 5),
  gaps jsonb not null default '[]'::jsonb,
  roadmap jsonb not null default '[]'::jsonb,
  evidence_summary text not null,
  assessed_by uuid references auth.users(id),
  assessed_at timestamptz not null default now(),
  next_review date,
  check (jsonb_typeof(principle_scores) = 'object'),
  check (jsonb_typeof(framework_scores) = 'object'),
  check (jsonb_typeof(process_scores) = 'object'),
  check (jsonb_typeof(gaps) = 'array'),
  check (jsonb_typeof(roadmap) = 'array')
);

create index if not exists idx_risk_framework_open
  on risk_framework_reviews(organization_id, status, due_date);
create index if not exists idx_risk_maturity_recent
  on risk_maturity_assessments(organization_id, assessed_at desc);

-- ---------------------------------------------------------------------------
-- Connect the universal risk object to the existing operating loop. These are
-- additive foreign keys, never replacement models.
-- ---------------------------------------------------------------------------
alter table evidence_items
  add column if not exists risk_id uuid references risks(id) on delete cascade,
  add column if not exists signal_kind text,
  add column if not exists source_reference text,
  add column if not exists provenance jsonb not null default '{}'::jsonb;

alter table scenarios
  add column if not exists risk_id uuid references risks(id) on delete cascade,
  add column if not exists treatment_strategy text,
  add column if not exists expected_residual_risk numeric,
  add column if not exists introduced_risks jsonb not null default '[]'::jsonb,
  add column if not exists expected_risk_reduction numeric,
  add column if not exists confidence numeric,
  add column if not exists required_resources jsonb not null default '[]'::jsonb,
  add column if not exists available_resources jsonb not null default '[]'::jsonb,
  add column if not exists required_competencies jsonb not null default '[]'::jsonb,
  add column if not exists executable boolean not null default false,
  add column if not exists readiness_gaps jsonb not null default '[]'::jsonb;

alter table scenarios
  add column if not exists asset_life_impact text,
  add column if not exists objective_tradeoffs jsonb not null default '{}'::jsonb;

alter table recommendations
  add column if not exists risk_id uuid references risks(id) on delete set null,
  add column if not exists raised_by uuid references auth.users(id) on delete set null,
  add column if not exists treatment_strategy text,
  add column if not exists treatment_owner_id uuid references user_profiles(id) on delete set null,
  add column if not exists original_risk_score numeric,
  add column if not exists expected_residual_risk_score numeric,
  add column if not exists target_risk_score numeric,
  add column if not exists new_risks_introduced jsonb not null default '[]'::jsonb,
  add column if not exists net_risk_change numeric,
  add column if not exists resource_readiness jsonb not null default '{}'::jsonb;

alter table approvals
  add column if not exists risk_id uuid references risks(id) on delete set null,
  add column if not exists decision_id uuid references decisions(id) on delete set null;

alter table decisions
  add column if not exists risk_id uuid references risks(id) on delete set null,
  add column if not exists risk_decision_action text,
  add column if not exists residual_risk_level text,
  add column if not exists acceptance_expires_at timestamptz,
  add column if not exists reassessment_trigger text;

alter table work_orders
  add column if not exists risk_id uuid references risks(id) on delete set null;

alter table learning_events
  add column if not exists risk_id uuid references risks(id) on delete set null;

create index if not exists idx_evidence_risk on evidence_items(organization_id, risk_id);
create index if not exists idx_scenarios_risk on scenarios(organization_id, risk_id);
create index if not exists idx_recommendations_risk on recommendations(organization_id, risk_id);
create index if not exists idx_decisions_risk on decisions(organization_id, risk_id);
create index if not exists idx_work_orders_risk on work_orders(organization_id, risk_id);
create index if not exists idx_learning_risk on learning_events(organization_id, risk_id);

-- Residual risk uses the existing acceptance model and delegation ladder.
alter table risk_acceptances
  drop constraint if exists risk_acceptances_subject_type_check;
alter table risk_acceptances
  add constraint risk_acceptances_subject_type_check
  check (subject_type in ('recommendation','asset','site','standard','risk'));
alter table risk_acceptances
  add column if not exists reassessment_trigger text;
alter table risk_acceptances drop constraint if exists risk_acceptance_trigger_required;
alter table risk_acceptances
  add constraint risk_acceptance_trigger_required
    check (subject_type <> 'risk' or coalesce(btrim(reassessment_trigger),'') <> '');

-- Extend the canonical authority and competency models instead of creating a
-- risk-only delegation ladder. Empty arrays mean the adopted limit applies to
-- every risk kind and carries no additional competency requirement.
alter table authority_limits
  add column if not exists risk_kinds jsonb not null default '[]'::jsonb,
  add column if not exists required_competency_keys jsonb not null default '[]'::jsonb,
  add column if not exists max_exposure numeric check (max_exposure is null or max_exposure between 0 and 100);

alter table workforce_members
  add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists idx_workforce_member_user
  on workforce_members(organization_id, user_id) where user_id is not null;

-- Extend the existing recommendation contract in place: an enterprise risk
-- treatment can be scoped to an adopted context even when no single asset is
-- the right functional location. All other canonical release fields remain
-- mandatory.
create or replace function check_recommendation_contract(p_recommendation_id uuid)
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
  where id=p_recommendation_id and organization_id=app_current_org();
  if not found then
    return query select false,array['(not found)']::text[],0::numeric,
      'No such recommendation in this organization.'::text;
    return;
  end if;
  if r.asset_id is not null or (
    r.risk_id is not null and exists(
      select 1 from risks x where x.id=r.risk_id and x.organization_id=r.organization_id
        and x.context_id is not null
    )
  ) then v_present:=v_present+1;
  else v_missing:=array_append(v_missing,
    'asset/functional location or governed risk context (C8.11)'); end if;
  if coalesce(btrim(r.issue),'')<>'' then v_present:=v_present+1;
    else v_missing:=array_append(v_missing,'current condition or problem (C8.12)'); end if;
  if coalesce(btrim(r.rationale),'')<>'' then v_present:=v_present+1;
    else v_missing:=array_append(v_missing,'evidence used (C8.13)'); end if;
  if coalesce(btrim(r.action),'')<>'' then v_present:=v_present+1;
    else v_missing:=array_append(v_missing,'recommended action (C8.16)'); end if;
  if r.confidence is not null then v_present:=v_present+1;
    else v_missing:=array_append(v_missing,'confidence and uncertainty (C8.19)'); end if;
  if coalesce(btrim(r.consequence_summary),'')<>'' then v_present:=v_present+1;
    else v_missing:=array_append(v_missing,'consequence — safety, environmental, production, financial (C8.15)'); end if;
  if coalesce(btrim(r.alternatives_considered),'')<>'' then v_present:=v_present+1;
    else v_missing:=array_append(v_missing,'alternatives considered (C8.17)'); end if;
  if r.required_completion_date is not null then v_present:=v_present+1;
    else v_missing:=array_append(v_missing,'required completion date (C8.18)'); end if;
  if coalesce(btrim(r.required_approver_role),'')<>'' then v_present:=v_present+1;
    else v_missing:=array_append(v_missing,'required approver (C8.20)'); end if;
  if coalesce(btrim(r.verification_method),'')<>'' then v_present:=v_present+1;
    else v_missing:=array_append(v_missing,'verification method (C8.21)'); end if;
  if coalesce(btrim(r.impact),'')<>'' then v_present:=v_present+1; end if;
  return query select array_length(v_missing,1) is null,v_missing,
    round(v_present::numeric/v_total,2),
    case when array_length(v_missing,1) is null then
      'Contract complete. Every field an approver needs is present.'::text
    else format('NOT RELEASABLE — %s required field(s) missing. Completeness is %s%%; release remains binary.',
      array_length(v_missing,1),round(100.0*v_present/v_total)) end;
end;
$$;
grant execute on function check_recommendation_contract(uuid) to authenticated, service_role;

create or replace function get_recommendation_contract_posture()
returns table (
  register text,label text,blocking boolean,populated bigint,total bigint,share numeric
)
language sql stable security definer set search_path = public as $$
  with r as (select * from recommendations where organization_id=app_current_org()),
  t as (select count(*) n from r)
  select v.reg,v.lab,v.blk,v.pop,t.n,
    case when t.n>0 then round(v.pop::numeric/t.n,3) else 0 end
  from t,lateral(values
    ('C8.11','Asset/functional location or governed risk context',true,
      (select count(*) from r where asset_id is not null or
        (risk_id is not null and exists(select 1 from risks x where x.id=r.risk_id and x.context_id is not null)))),
    ('C8.12','Current condition or problem',true,(select count(*) from r where coalesce(btrim(issue),'')<>'')),
    ('C8.13','Evidence used',true,(select count(*) from r where coalesce(btrim(rationale),'')<>'')),
    ('C8.15','Consequence: safety, environmental, production, financial',true,(select count(*) from r where coalesce(btrim(consequence_summary),'')<>'')),
    ('C8.16','Recommended action',true,(select count(*) from r where coalesce(btrim(action),'')<>'')),
    ('C8.17','Alternative actions considered',true,(select count(*) from r where coalesce(btrim(alternatives_considered),'')<>'')),
    ('C8.18','Required completion date',true,(select count(*) from r where required_completion_date is not null)),
    ('C8.19','Confidence and uncertainty',true,(select count(*) from r where confidence is not null)),
    ('C8.20','Required human approval (named authority)',true,(select count(*) from r where coalesce(btrim(required_approver_role),'')<>'')),
    ('C8.21','Method for verifying effectiveness',true,(select count(*) from r where coalesce(btrim(verification_method),'')<>''))
  ) as v(reg,lab,blk,pop)
  order by 6,1;
$$;
grant execute on function get_recommendation_contract_posture() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: all new records are tenant-scoped. Writes occur through controlled RPCs
-- so validation, role checks and canonical audit events cannot be skipped.
-- ---------------------------------------------------------------------------
alter table risk_context_nodes enable row level security;
drop policy if exists risk_context_nodes_org_read on risk_context_nodes;
create policy risk_context_nodes_org_read on risk_context_nodes
  for select to authenticated using (organization_id = app_current_org());

alter table risk_criteria_profiles enable row level security;
drop policy if exists risk_criteria_profiles_org_read on risk_criteria_profiles;
create policy risk_criteria_profiles_org_read on risk_criteria_profiles
  for select to authenticated using (organization_id = app_current_org());

alter table risks enable row level security;
drop policy if exists risks_org_read on risks;
create policy risks_org_read on risks
  for select to authenticated using (organization_id = app_current_org());

alter table risk_controls enable row level security;
drop policy if exists risk_controls_org_read on risk_controls;
create policy risk_controls_org_read on risk_controls
  for select to authenticated using (organization_id = app_current_org());

alter table risk_control_links enable row level security;
drop policy if exists risk_control_links_org_read on risk_control_links;
create policy risk_control_links_org_read on risk_control_links
  for select to authenticated using (organization_id = app_current_org());

alter table risk_control_tests enable row level security;
drop policy if exists risk_control_tests_org_read on risk_control_tests;
create policy risk_control_tests_org_read on risk_control_tests
  for select to authenticated using (organization_id = app_current_org());

alter table risk_indicators enable row level security;
drop policy if exists risk_indicators_org_read on risk_indicators;
create policy risk_indicators_org_read on risk_indicators
  for select to authenticated using (organization_id = app_current_org());

alter table risk_indicator_observations enable row level security;
drop policy if exists risk_indicator_observations_org_read on risk_indicator_observations;
create policy risk_indicator_observations_org_read on risk_indicator_observations
  for select to authenticated using (organization_id = app_current_org());

alter table risk_stakeholder_views enable row level security;
drop policy if exists risk_stakeholder_views_org_read on risk_stakeholder_views;
create policy risk_stakeholder_views_org_read on risk_stakeholder_views
  for select to authenticated using (organization_id = app_current_org());

alter table risk_links enable row level security;
drop policy if exists risk_links_org_read on risk_links;
create policy risk_links_org_read on risk_links
  for select to authenticated using (organization_id = app_current_org());

alter table risk_framework_reviews enable row level security;
drop policy if exists risk_framework_reviews_org_read on risk_framework_reviews;
create policy risk_framework_reviews_org_read on risk_framework_reviews
  for select to authenticated using (organization_id = app_current_org());

alter table risk_maturity_assessments enable row level security;
drop policy if exists risk_maturity_assessments_org_read on risk_maturity_assessments;
create policy risk_maturity_assessments_org_read on risk_maturity_assessments
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Universal risk contract and state gate.
-- ---------------------------------------------------------------------------
create or replace function public.risk_contract_gaps(p_risk risks)
returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_gaps text[] := '{}';
  v_criteria_status text;
begin
  if coalesce(btrim(p_risk.objective_at_risk),'') = '' then
    v_gaps := array_append(v_gaps, 'objective_at_risk');
  end if;
  if coalesce(btrim(p_risk.risk_source),'') = '' then
    v_gaps := array_append(v_gaps, 'risk_source');
  end if;
  if coalesce(btrim(p_risk.event_description),'') = '' then
    v_gaps := array_append(v_gaps, 'event_description');
  end if;
  if p_risk.context_id is null or not exists(
    select 1 from risk_context_nodes c where c.id=p_risk.context_id
      and c.organization_id=p_risk.organization_id
  ) then v_gaps := array_append(v_gaps, 'context_id'); end if;
  if p_risk.site_id is not null and not exists(
    select 1 from sites s where s.id=p_risk.site_id
      and s.organization_id=p_risk.organization_id
  ) then v_gaps := array_append(v_gaps, 'site_id'); end if;
  if p_risk.asset_id is not null and not exists(
    select 1 from assets a where a.id=p_risk.asset_id
      and a.organization_id=p_risk.organization_id
  ) then v_gaps := array_append(v_gaps, 'asset_id'); end if;
  if p_risk.risk_owner_id is null or not exists(
    select 1 from user_profiles u where u.id=p_risk.risk_owner_id
      and u.organization_id=p_risk.organization_id
  ) then v_gaps := array_append(v_gaps, 'risk_owner_id'); end if;
  if p_risk.decision_owner_id is null or not exists(
    select 1 from user_profiles u where u.id=p_risk.decision_owner_id
      and u.organization_id=p_risk.organization_id
  ) then v_gaps := array_append(v_gaps, 'decision_owner_id'); end if;
  if p_risk.criteria_profile_id is null then
    v_gaps := array_append(v_gaps, 'criteria_profile_id');
  elsif not exists(
    select 1 from risk_criteria_profiles c where c.id=p_risk.criteria_profile_id
      and c.organization_id=p_risk.organization_id
  ) then
    v_gaps := array_append(v_gaps, 'criteria_profile_id');
  end if;
  if coalesce(btrim(p_risk.scope_decision),'') = '' then
    v_gaps := array_append(v_gaps, 'scope_decision');
  end if;
  if coalesce(btrim(p_risk.scope_expected_outcome),'') = '' then
    v_gaps := array_append(v_gaps, 'scope_expected_outcome');
  end if;
  if jsonb_array_length(p_risk.scope_inclusions) = 0 then
    v_gaps := array_append(v_gaps, 'scope_inclusions');
  end if;
  if jsonb_array_length(p_risk.scope_exclusions) = 0 then
    v_gaps := array_append(v_gaps, 'scope_exclusions');
  end if;
  if coalesce(btrim(p_risk.time_horizon),'') = '' then
    v_gaps := array_append(v_gaps, 'time_horizon');
  end if;
  if coalesce(btrim(p_risk.location_scope),'') = '' then
    v_gaps := array_append(v_gaps, 'location_scope');
  end if;
  if jsonb_array_length(p_risk.resource_scope) = 0 then
    v_gaps := array_append(v_gaps, 'resource_scope');
  end if;
  if jsonb_array_length(p_risk.responsibility_scope) = 0 then
    v_gaps := array_append(v_gaps, 'responsibility_scope');
  end if;
  if jsonb_array_length(p_risk.relationship_scope) = 0 then
    v_gaps := array_append(v_gaps, 'relationship_scope');
  end if;
  if jsonb_array_length(p_risk.assumptions) = 0 then
    v_gaps := array_append(v_gaps, 'assumptions');
  end if;
  if not p_risk.bias_review_complete then
    v_gaps := array_append(v_gaps, 'bias_review_complete');
  end if;
  if coalesce(btrim(p_risk.data_quality),'') = '' then
    v_gaps := array_append(v_gaps, 'data_quality');
  end if;
  if jsonb_array_length(p_risk.method_limitations) = 0 then
    v_gaps := array_append(v_gaps, 'method_limitations');
  end if;
  if not (p_risk.reporting_profile ?& array['audiences','frequency','method','timeliness','cost_limit']) then
    v_gaps := array_append(v_gaps, 'reporting_profile');
  end if;

  if p_risk.status in ('analyzed','evaluated','treatment_active','monitoring','closed') then
    if p_risk.analysis_level is null then v_gaps := array_append(v_gaps, 'analysis_level'); end if;
    if coalesce(btrim(p_risk.analysis_method),'') = '' then
      v_gaps := array_append(v_gaps, 'analysis_method');
    end if;
    if p_risk.likelihood is null then v_gaps := array_append(v_gaps, 'likelihood'); end if;
    if p_risk.consequences = '{}'::jsonb then v_gaps := array_append(v_gaps, 'consequences'); end if;
    if p_risk.control_effectiveness is null then
      v_gaps := array_append(v_gaps, 'control_effectiveness');
    end if;
    if p_risk.uncertainty is null then v_gaps := array_append(v_gaps, 'uncertainty'); end if;
    if p_risk.confidence is null then v_gaps := array_append(v_gaps, 'confidence'); end if;
  end if;

  if p_risk.status in ('evaluated','treatment_active','monitoring','closed') then
    select status into v_criteria_status from risk_criteria_profiles
    where id = p_risk.criteria_profile_id and organization_id = p_risk.organization_id;
    if v_criteria_status is distinct from 'adopted' then
      v_gaps := array_append(v_gaps, 'adopted criteria profile');
    end if;
    if p_risk.current_risk_score is null then
      v_gaps := array_append(v_gaps, 'current_risk_score');
    end if;
    if p_risk.current_risk_level is null then
      v_gaps := array_append(v_gaps, 'current_risk_level');
    end if;
    if p_risk.decision_action is null then
      v_gaps := array_append(v_gaps, 'decision_action');
    end if;
  end if;

  if p_risk.status in ('monitoring','closed') then
    if p_risk.residual_risk_score is null then
      v_gaps := array_append(v_gaps, 'residual_risk_score');
    end if;
    if p_risk.residual_risk_level is null then
      v_gaps := array_append(v_gaps, 'residual_risk_level');
    end if;
    if p_risk.review_date is null then v_gaps := array_append(v_gaps, 'review_date'); end if;
    if coalesce(btrim(p_risk.escalation_threshold),'') = '' then
      v_gaps := array_append(v_gaps, 'escalation_threshold');
    end if;
  end if;

  if p_risk.status = 'closed' then
    if exists (
      select 1 from recommendations r
      left join verification_obligations v on v.recommendation_id = r.id
      where r.risk_id = p_risk.id
        and r.status in ('approved','released','scheduled','completed')
        and (v.id is null or v.status <> 'completed')
    ) then
      v_gaps := array_append(v_gaps, 'completed treatment verification');
    end if;
    if p_risk.decision_action = 'ACCEPT' and not exists (
      select 1 from risk_acceptances ra
      where ra.organization_id = p_risk.organization_id
        and ra.subject_type = 'risk' and ra.subject_id = p_risk.id
        and ra.status = 'active' and ra.expires_at > now()
    ) then
      v_gaps := array_append(v_gaps, 'active residual risk acceptance');
    end if;
  end if;

  return v_gaps;
end;
$$;

create or replace function public.enforce_risk_contract()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_gaps text[];
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.status in ('identified','analyzed','evaluated','treatment_active','monitoring','closed') then
    v_gaps := public.risk_contract_gaps(new);
    if array_length(v_gaps, 1) > 0 then
      raise exception 'Risk cannot move to % — contract gaps: %',
        new.status, array_to_string(v_gaps, '; ')
        using errcode = 'check_violation';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_enforce_risk_contract on risks;
create trigger trg_enforce_risk_contract
  before insert or update of status on risks
  for each row execute function public.enforce_risk_contract();

-- ---------------------------------------------------------------------------
-- Context and criteria configuration. Adoption is reserved to accountable
-- leadership and records the decision in the canonical audit log.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_risk_context(p_context jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_id uuid;
  v_parent risk_context_nodes%rowtype;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_org is null or v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden');
  end if;
  if coalesce(btrim(p_context->>'name'),'') = '' then
    return jsonb_build_object('error','context name is required');
  end if;
  if coalesce(p_context->>'scope_kind','') not in
    ('enterprise','business_unit','site','mission','system','asset','decision','activity') then
    return jsonb_build_object('error','invalid scope_kind');
  end if;
  if p_context ? 'parent_id' and nullif(p_context->>'parent_id','') is not null then
    select * into v_parent from risk_context_nodes
    where id = (p_context->>'parent_id')::uuid and organization_id = v_org;
    if not found then return jsonb_build_object('error','parent context not found in this organization'); end if;
  end if;
  if nullif(p_context->>'site_id','') is not null and not exists (
    select 1 from sites where id=(p_context->>'site_id')::uuid and organization_id=v_org
  ) then return jsonb_build_object('error','site not found in this organization'); end if;
  if nullif(p_context->>'asset_id','') is not null and not exists (
    select 1 from assets where id=(p_context->>'asset_id')::uuid and organization_id=v_org
  ) then return jsonb_build_object('error','asset not found in this organization'); end if;

  insert into risk_context_nodes (
    organization_id, parent_id, scope_kind, site_id, asset_id, name,
    mission_or_service, objectives, stakeholders, regulations,
    financial_constraints, safety_requirements, environmental_obligations,
    operating_limits, policies, dependencies, decision_authority, created_by
  ) values (
    v_org, nullif(p_context->>'parent_id','')::uuid, p_context->>'scope_kind',
    nullif(p_context->>'site_id','')::uuid, nullif(p_context->>'asset_id','')::uuid,
    btrim(p_context->>'name'), nullif(btrim(p_context->>'mission_or_service'),''),
    coalesce(p_context->'objectives','[]'::jsonb), coalesce(p_context->'stakeholders','[]'::jsonb),
    coalesce(p_context->'regulations','[]'::jsonb), coalesce(p_context->'financial_constraints','[]'::jsonb),
    coalesce(p_context->'safety_requirements','[]'::jsonb), coalesce(p_context->'environmental_obligations','[]'::jsonb),
    coalesce(p_context->'operating_limits','[]'::jsonb), coalesce(p_context->'policies','[]'::jsonb),
    coalesce(p_context->'dependencies','[]'::jsonb), coalesce(p_context->'decision_authority','{}'::jsonb), auth.uid()
  ) returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'risk_context', v_role,
    jsonb_build_object('context_id',v_id,'scope_kind',p_context->>'scope_kind','status','draft'));
  return jsonb_build_object('context_id',v_id,'status','draft',
    'note','Context remains draft until explicitly adopted.');
end;
$$;
grant execute on function public.upsert_risk_context(jsonb) to authenticated, service_role;

create or replace function public.adopt_risk_context(p_context_id uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid:=app_current_org(); v_role text; c risk_context_nodes%rowtype;
begin
  select role into v_role from user_profiles where id=auth.uid();
  if v_role not in ('admin','ai_admin','executive') then
    return jsonb_build_object('error','adopting organizational context requires an executive or administrator');
  end if;
  select * into c from risk_context_nodes where id=p_context_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','context not found'); end if;
  if c.status<>'draft' then return jsonb_build_object('error','only draft context can be adopted'); end if;
  if jsonb_array_length(c.objectives)=0 or jsonb_array_length(c.stakeholders)=0
     or c.decision_authority='{}'::jsonb or coalesce(length(btrim(p_note)),0)<20 then
    return jsonb_build_object('error','objectives, stakeholders, decision authority and substantive adoption note are required');
  end if;
  update risk_context_nodes set status='adopted',adopted_by=auth.uid(),adopted_at=now(),
    updated_at=now() where id=c.id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_context',v_role,jsonb_build_object('context_id',c.id,'status','adopted','note',btrim(p_note)));
  return jsonb_build_object('context_id',c.id,'status','adopted');
end;
$$;
grant execute on function public.adopt_risk_context(uuid, text) to authenticated, service_role;

create or replace function public.update_risk_criteria_draft(p_criteria_id uuid, p_config jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid:=app_current_org(); v_role text; c risk_criteria_profiles%rowtype;
begin
  select role into v_role from user_profiles where id=auth.uid();
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden');
  end if;
  select * into c from risk_criteria_profiles where id=p_criteria_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','criteria profile not found'); end if;
  if c.status<>'draft' then return jsonb_build_object('error','adopted criteria are immutable; create a new version'); end if;
  update risk_criteria_profiles set
    consequence_dimensions=coalesce(p_config->'consequence_dimensions',consequence_dimensions),
    likelihood_scale=coalesce(p_config->'likelihood_scale',likelihood_scale),
    thresholds=coalesce(p_config->'thresholds',thresholds),
    scoring_weights=coalesce(p_config->'scoring_weights',scoring_weights),
    decision_thresholds=coalesce(p_config->'decision_thresholds',decision_thresholds),
    risk_capacity=coalesce(p_config->'risk_capacity',risk_capacity),
    aggregate_rules=coalesce(p_config->'aggregate_rules',aggregate_rules),
    time_factors=coalesce(p_config->'time_factors',time_factors),
    tolerance_statements=coalesce(p_config->'tolerance_statements',tolerance_statements),
    jurisdiction=coalesce(nullif(p_config->>'jurisdiction',''),jurisdiction),
    review_date=coalesce(nullif(p_config->>'review_date','')::date,review_date),
    basis=case when coalesce(btrim(p_config->>'basis'),'')<>'' then btrim(p_config->>'basis') else basis end
  where id=c.id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_criteria',v_role,jsonb_build_object('criteria_id',c.id,'status','draft','action','configured'));
  return jsonb_build_object('criteria_id',c.id,'status','draft','adoption_required',true);
end;
$$;
grant execute on function public.update_risk_criteria_draft(uuid, jsonb) to authenticated, service_role;

create or replace function public.adopt_risk_criteria(p_criteria_id uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c risk_criteria_profiles%rowtype;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('admin','ai_admin','executive') then
    return jsonb_build_object('error','adopting risk criteria requires an executive or administrator');
  end if;
  select * into c from risk_criteria_profiles
  where id = p_criteria_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','criteria profile not found'); end if;
  if c.status <> 'draft' then return jsonb_build_object('error','only draft criteria can be adopted'); end if;
  if coalesce(length(btrim(p_note)),0) < 20 then
    return jsonb_build_object('error','record the authority and basis for adoption (20 characters minimum)');
  end if;
  if jsonb_array_length(c.consequence_dimensions) = 0
     or jsonb_array_length(c.likelihood_scale) = 0
     or not (c.thresholds ?& array['low','medium','high','critical'])
     or not (c.decision_thresholds ?& array['accept','monitor','investigate','treat','escalate'])
     or not (c.scoring_weights ?& array['inherent','exposure','uncertainty','connectivity','velocity','capacity'])
     or not (c.risk_capacity ? 'capacity_limit') then
    return jsonb_build_object('error',
      'criteria are not executable: dimensions, likelihood, thresholds, decision thresholds, weights and capacity are required');
  end if;

  update risk_criteria_profiles set status = 'superseded', superseded_by = c.id
  where organization_id = v_org and name = c.name and status = 'adopted';
  update risk_criteria_profiles set status = 'adopted', adopted_by = auth.uid(),
    adopted_at = now(), basis = basis || ' | Adoption: ' || btrim(p_note)
  where id = c.id;
  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'risk_criteria', v_role,
    jsonb_build_object('criteria_id',c.id,'version',c.version,'status','adopted'));
  return jsonb_build_object('criteria_id',c.id,'status','adopted','version',c.version);
end;
$$;
grant execute on function public.adopt_risk_criteria(uuid, text) to authenticated, service_role;

create or replace function public.create_risk_criteria_version(
  p_source_id uuid,
  p_name text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid:=app_current_org();
  v_role text;
  c risk_criteria_profiles%rowtype;
  v_id uuid;
  v_version int;
begin
  select role into v_role from user_profiles where id=auth.uid();
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden');
  end if;
  select * into c from risk_criteria_profiles where id=p_source_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','source criteria profile not found'); end if;
  select coalesce(max(version),0)+1 into v_version from risk_criteria_profiles
  where organization_id=v_org and name=coalesce(nullif(btrim(p_name),''),c.name);
  insert into risk_criteria_profiles (
    organization_id,context_id,name,industry_code,jurisdiction,version,status,
    consequence_dimensions,likelihood_scale,thresholds,scoring_weights,
    decision_thresholds,risk_capacity,aggregate_rules,time_factors,
    tolerance_statements,basis,review_date
  ) values (
    v_org,c.context_id,coalesce(nullif(btrim(p_name),''),c.name),c.industry_code,
    c.jurisdiction,v_version,'draft',c.consequence_dimensions,c.likelihood_scale,
    c.thresholds,c.scoring_weights,c.decision_thresholds,c.risk_capacity,
    c.aggregate_rules,c.time_factors,c.tolerance_statements,
    c.basis || format(' | Draft v%s created from v%s; re-adoption required.',v_version,c.version),
    c.review_date
  ) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_criteria',v_role,jsonb_build_object('criteria_id',v_id,
    'source_id',c.id,'version',v_version,'status','draft'));
  return jsonb_build_object('criteria_id',v_id,'version',v_version,'status','draft',
    'adoption_required',true);
end;
$$;
grant execute on function public.create_risk_criteria_version(uuid, text) to authenticated, service_role;

create or replace function public.configure_risk_authority_requirements(
  p_authority_limit_id uuid,
  p_config jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid:=app_current_org();
  v_role text;
  l authority_limits%rowtype;
begin
  select role into v_role from user_profiles where id=auth.uid();
  if v_role not in ('admin','ai_admin','executive') then
    return jsonb_build_object('error','risk authority requirements require executive or administrator configuration');
  end if;
  select * into l from authority_limits where id=p_authority_limit_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','authority limit not found'); end if;
  if l.status<>'draft' then
    return jsonb_build_object('error','adopted authority is immutable; configure a new draft version');
  end if;
  if jsonb_typeof(coalesce(p_config->'risk_kinds','[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_config->'required_competency_keys','[]'::jsonb))<>'array' then
    return jsonb_build_object('error','risk kinds and competency keys must be arrays');
  end if;
  update authority_limits set
    risk_kinds=coalesce(p_config->'risk_kinds',risk_kinds),
    required_competency_keys=coalesce(p_config->'required_competency_keys',required_competency_keys),
    max_exposure=coalesce(nullif(p_config->>'max_exposure','')::numeric,max_exposure),
    basis=case when coalesce(btrim(p_config->>'basis'),'')<>''
      then btrim(p_config->>'basis') else basis end
  where id=l.id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'authority_limit',v_role,jsonb_build_object('authority_limit_id',l.id,
    'action','risk_requirements_configured','status','draft'));
  return jsonb_build_object('authority_limit_id',l.id,'status','draft',
    'adoption_required',true);
end;
$$;
grant execute on function public.configure_risk_authority_requirements(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ISO 31000 implementation copilot. It produces draft configuration and an
-- evidence-bound roadmap; it never adopts policy on the customer's behalf.
-- ---------------------------------------------------------------------------
create or replace function public.start_iso31000_implementation(p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_context uuid;
  v_criteria uuid;
  v_missing text[] := '{}';
  v_roadmap jsonb;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden');
  end if;
  if jsonb_array_length(coalesce(p_answers->'objectives','[]'::jsonb)) = 0 then v_missing := array_append(v_missing,'objectives'); end if;
  if jsonb_array_length(coalesce(p_answers->'critical_services','[]'::jsonb)) = 0 then v_missing := array_append(v_missing,'critical_services'); end if;
  if jsonb_array_length(coalesce(p_answers->'stakeholders','[]'::jsonb)) = 0 then v_missing := array_append(v_missing,'stakeholders'); end if;
  if coalesce(btrim(p_answers->>'risk_owner_role'),'') = '' then v_missing := array_append(v_missing,'risk_owner_role'); end if;
  if coalesce(btrim(p_answers->>'acceptance_authority'),'') = '' then v_missing := array_append(v_missing,'acceptance_authority'); end if;
  if jsonb_array_length(coalesce(p_answers->'decision_points','[]'::jsonb)) = 0 then v_missing := array_append(v_missing,'decision_points'); end if;
  if array_length(v_missing,1) > 0 then
    return jsonb_build_object('error','implementation discovery is incomplete','missing',v_missing);
  end if;

  insert into risk_context_nodes (
    organization_id, scope_kind, name, mission_or_service, objectives,
    stakeholders, regulations, dependencies, decision_authority, status, created_by
  ) select v_org, 'enterprise', o.name || ' enterprise risk context',
    array_to_string(array(select jsonb_array_elements_text(coalesce(p_answers->'critical_services','[]'::jsonb))), '; '),
    p_answers->'objectives', p_answers->'stakeholders', coalesce(p_answers->'obligations','[]'::jsonb),
    coalesce(p_answers->'dependencies','[]'::jsonb),
    jsonb_build_object('risk_owner_role',p_answers->>'risk_owner_role',
      'acceptance_authority',p_answers->>'acceptance_authority',
      'escalation_thresholds',coalesce(p_answers->'escalation_thresholds','{}'::jsonb)),
    'draft', auth.uid()
  from organizations o where o.id = v_org
  returning id into v_context;

  insert into risk_criteria_profiles (
    organization_id, context_id, name, industry_code, status,
    consequence_dimensions, likelihood_scale, thresholds, scoring_weights,
    decision_thresholds, risk_capacity, aggregate_rules, time_factors,
    tolerance_statements, basis
  ) values (
    v_org, v_context, 'ISO 31000 implementation draft', p_answers->>'industry_code', 'draft',
    coalesce(p_answers->'consequence_dimensions','[]'::jsonb),
    coalesce(p_answers->'likelihood_scale','[]'::jsonb),
    coalesce(p_answers->'thresholds','{}'::jsonb),
    coalesce(p_answers->'scoring_weights','{}'::jsonb),
    coalesce(p_answers->'decision_thresholds','{}'::jsonb),
    coalesce(p_answers->'risk_capacity','{}'::jsonb),
    coalesce(p_answers->'aggregate_rules','{}'::jsonb),
    coalesce(p_answers->'time_factors','{}'::jsonb),
    coalesce(p_answers->'risk_tolerances','[]'::jsonb),
    'Generated from implementation discovery. DRAFT: customer governance, domain and legal review required before adoption.'
  ) returning id into v_criteria;

  v_roadmap := jsonb_build_array(
    jsonb_build_object('phase','Current-state assessment','status','ready','output','Captured objectives, services, stakeholders, obligations and existing systems'),
    jsonb_build_object('phase','Gap assessment','status','ready','output','Compare principles, framework and process against recorded evidence'),
    jsonb_build_object('phase','Implementation roadmap','status','ready','output','Prioritize governance, criteria, embedded decision points and integrations'),
    jsonb_build_object('phase','Configuration','status','draft','output','Review context and criteria drafts; no policy is auto-adopted'),
    jsonb_build_object('phase','Workflow deployment','status','blocked','output','Requires approved criteria, named owners and authority limits'),
    jsonb_build_object('phase','Monitoring','status','blocked','output','Bind live indicators and reassessment triggers'),
    jsonb_build_object('phase','Improvement','status','blocked','output','Verify outcomes, review framework effectiveness and learn')
  );
  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'iso31000_implementation', v_role,
    jsonb_build_object('context_id',v_context,'criteria_id',v_criteria,'status','draft'));
  return jsonb_build_object('context_id',v_context,'criteria_id',v_criteria,
    'current_state',p_answers,'gap_assessment','Pending evidence-based maturity assessment',
    'roadmap',v_roadmap,'configuration_status','draft');
end;
$$;
grant execute on function public.start_iso31000_implementation(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Create a scoped risk assessment. JSON input keeps the connector contract
-- stable as sources expand. The status starts draft or identified only.
-- ---------------------------------------------------------------------------
create or replace function public.create_risk_assessment(p_assessment jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_context risk_context_nodes%rowtype;
  v_criteria risk_criteria_profiles%rowtype;
  v_id uuid;
  v_risk risks%rowtype;
  v_gaps text[];
  v_status text := coalesce(p_assessment->>'status','draft');
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if v_status not in ('draft','identified') then
    return jsonb_build_object('error','new assessments may start only as draft or identified');
  end if;
  select * into v_context from risk_context_nodes
  where id = nullif(p_assessment->>'context_id','')::uuid and organization_id = v_org;
  if not found then return jsonb_build_object('error','context not found in this organization'); end if;
  select * into v_criteria from risk_criteria_profiles
  where id = nullif(p_assessment->>'criteria_profile_id','')::uuid and organization_id = v_org;
  if not found then return jsonb_build_object('error','criteria profile not found in this organization'); end if;
  if nullif(p_assessment->>'site_id','') is not null and not exists(
    select 1 from sites where id=(p_assessment->>'site_id')::uuid and organization_id=v_org
  ) then return jsonb_build_object('error','site not found in this organization'); end if;
  if nullif(p_assessment->>'asset_id','') is not null and not exists(
    select 1 from assets where id=(p_assessment->>'asset_id')::uuid and organization_id=v_org
  ) then return jsonb_build_object('error','asset not found in this organization'); end if;
  if nullif(p_assessment->>'risk_owner_id','') is not null and not exists(
    select 1 from user_profiles where id=(p_assessment->>'risk_owner_id')::uuid and organization_id=v_org
  ) then return jsonb_build_object('error','risk owner not found in this organization'); end if;
  if nullif(p_assessment->>'decision_owner_id','') is not null and not exists(
    select 1 from user_profiles where id=(p_assessment->>'decision_owner_id')::uuid and organization_id=v_org
  ) then return jsonb_build_object('error','decision owner not found in this organization'); end if;
  if coalesce(btrim(p_assessment->>'title'),'') = '' then
    return jsonb_build_object('error','title is required');
  end if;

  insert into risks (
    organization_id, context_id, criteria_profile_id, site_id, asset_id, title,
    kind, objective_at_risk, risk_source, event_description, causes, consequences,
    likelihood, existing_controls_summary, analysis_level, analysis_method,
    analysis_model_reference, control_effectiveness, uncertainty, confidence,
    complexity, connectivity, exposure, capacity_load, risk_velocity,
    time_to_unacceptable, inherent_risk_score, current_risk_score,
    residual_risk_score, target_risk_score, opportunity_score, value_at_risk,
    value_currency,
    current_risk_level, residual_risk_level, target_risk_level, decision_action,
    risk_owner_id, decision_owner_id, stakeholders, escalation_threshold,
    review_date, scope_decision, scope_expected_outcome, scope_inclusions,
    scope_exclusions, time_horizon, location_scope, resource_scope,
    responsibility_scope, relationship_scope, assumptions, biases,
    bias_review_complete, method_limitations, data_quality, reporting_profile,
    information_sensitivity, status, source_kind, created_by
  ) values (
    v_org, v_context.id, v_criteria.id,
    nullif(p_assessment->>'site_id','')::uuid, nullif(p_assessment->>'asset_id','')::uuid,
    btrim(p_assessment->>'title'), coalesce(p_assessment->>'kind','threat'),
    nullif(btrim(p_assessment->>'objective_at_risk'),''), nullif(btrim(p_assessment->>'risk_source'),''),
    nullif(btrim(p_assessment->>'event_description'),''), coalesce(p_assessment->'causes','[]'::jsonb),
    coalesce(p_assessment->'consequences','{}'::jsonb), nullif(p_assessment->>'likelihood','')::numeric,
    nullif(btrim(p_assessment->>'existing_controls_summary'),''), p_assessment->>'analysis_level',
    nullif(btrim(p_assessment->>'analysis_method'),''), nullif(btrim(p_assessment->>'analysis_model_reference'),''),
    nullif(p_assessment->>'control_effectiveness','')::numeric, nullif(p_assessment->>'uncertainty','')::numeric,
    nullif(p_assessment->>'confidence','')::numeric, nullif(p_assessment->>'complexity','')::numeric,
    nullif(p_assessment->>'connectivity','')::numeric, nullif(p_assessment->>'exposure','')::numeric,
    nullif(p_assessment->>'capacity_load','')::numeric, nullif(p_assessment->>'risk_velocity','')::numeric,
    nullif(p_assessment->>'time_to_unacceptable','')::interval,
    nullif(p_assessment->>'inherent_risk_score','')::numeric, nullif(p_assessment->>'current_risk_score','')::numeric,
    nullif(p_assessment->>'residual_risk_score','')::numeric, nullif(p_assessment->>'target_risk_score','')::numeric,
    nullif(p_assessment->>'opportunity_score','')::numeric,
    nullif(p_assessment->>'value_at_risk','')::numeric,
    coalesce(nullif(p_assessment->>'value_currency',''),'USD'), p_assessment->>'current_risk_level',
    p_assessment->>'residual_risk_level', p_assessment->>'target_risk_level', p_assessment->>'decision_action',
    nullif(p_assessment->>'risk_owner_id','')::uuid, nullif(p_assessment->>'decision_owner_id','')::uuid,
    coalesce(p_assessment->'stakeholders','[]'::jsonb), nullif(btrim(p_assessment->>'escalation_threshold'),''),
    nullif(p_assessment->>'review_date','')::date, nullif(btrim(p_assessment->>'scope_decision'),''),
    nullif(btrim(p_assessment->>'scope_expected_outcome'),''), coalesce(p_assessment->'scope_inclusions','[]'::jsonb),
    coalesce(p_assessment->'scope_exclusions','[]'::jsonb), nullif(btrim(p_assessment->>'time_horizon'),''),
    nullif(btrim(p_assessment->>'location_scope'),''), coalesce(p_assessment->'resource_scope','[]'::jsonb),
    coalesce(p_assessment->'responsibility_scope','[]'::jsonb), coalesce(p_assessment->'relationship_scope','[]'::jsonb),
    coalesce(p_assessment->'assumptions','[]'::jsonb), coalesce(p_assessment->'biases','[]'::jsonb),
    coalesce((p_assessment->>'bias_review_complete')::boolean,false),
    coalesce(p_assessment->'method_limitations','[]'::jsonb),
    nullif(btrim(p_assessment->>'data_quality'),''),
    coalesce(p_assessment->'reporting_profile','{}'::jsonb),
    coalesce(p_assessment->>'information_sensitivity','internal'),
    'draft', coalesce(p_assessment->>'source_kind','human'), auth.uid()
  ) returning id into v_id;

  select * into v_risk from risks where id = v_id;
  v_gaps := public.risk_contract_gaps(v_risk);
  if v_status = 'identified' then
    if array_length(v_gaps,1) > 0 then
      return jsonb_build_object('risk_id',v_id,'status','draft','gaps',v_gaps,
        'note','Saved as draft because the identification contract is incomplete.');
    end if;
    update risks set status = 'identified', updated_at = now() where id = v_id;
  end if;
  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'risk_assessment', coalesce((select role from user_profiles where id = auth.uid()),'unknown'),
    jsonb_build_object('risk_id',v_id,'requested_status',v_status,'actual_status',
      case when v_status = 'identified' and array_length(v_gaps,1) is null then 'identified' else 'draft' end,
      'gaps',coalesce(to_jsonb(v_gaps),'[]'::jsonb)));
  return jsonb_build_object('risk_id',v_id,'status',
    case when v_status = 'identified' and array_length(v_gaps,1) is null then 'identified' else 'draft' end,
    'gaps',coalesce(to_jsonb(v_gaps),'[]'::jsonb));
end;
$$;
grant execute on function public.create_risk_assessment(jsonb) to authenticated, service_role;

-- Analysis may use configured draft criteria for a clearly diagnostic result;
-- only adopted criteria can authorize the later evaluation decision.
create or replace function public.record_risk_analysis(p_risk_id uuid, p_analysis jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid:=app_current_org();
  r risks%rowtype;
  c risk_criteria_profiles%rowtype;
  v_max_likelihood numeric;
  v_peak numeric;
  v_likelihood numeric;
  v_control numeric;
  v_uncertainty numeric;
  v_confidence numeric;
  v_complexity numeric;
  v_connectivity numeric;
  v_exposure numeric;
  v_capacity numeric;
  v_velocity numeric;
  v_days numeric;
  v_time_pressure numeric;
  v_inherent numeric;
  v_controlled numeric;
  v_current numeric;
  v_opportunity numeric;
  v_level text;
  v_action text;
  v_gaps text[];
begin
  select * into r from risks where id=p_risk_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  select * into c from risk_criteria_profiles where id=r.criteria_profile_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','criteria profile not found'); end if;
  if jsonb_array_length(c.likelihood_scale)=0 or c.thresholds='{}'::jsonb
     or not (c.scoring_weights ?& array['inherent','exposure','uncertainty','connectivity','velocity','capacity']) then
    return jsonb_build_object('error','criteria must be configured before analysis; adoption is required before evaluation');
  end if;
  if coalesce(p_analysis->>'analysis_level','') not in ('qualitative','semi_quantitative','quantitative')
     or coalesce(btrim(p_analysis->>'analysis_method'),'')='' then
    return jsonb_build_object('error','analysis level and method are required');
  end if;
  if jsonb_typeof(coalesce(p_analysis->'consequences','{}'::jsonb))<>'object'
     or p_analysis->'consequences'='{}'::jsonb then
    return jsonb_build_object('error','consequence scores by dimension are required');
  end if;
  select max(case when jsonb_typeof(x)='number' then (x#>>'{}')::numeric
    else nullif(x->>'score','')::numeric end)
  into v_max_likelihood from jsonb_array_elements(c.likelihood_scale) x;
  select max(value::numeric) into v_peak
  from jsonb_each_text(p_analysis->'consequences');
  v_likelihood:=nullif(p_analysis->>'likelihood','')::numeric;
  v_control:=nullif(p_analysis->>'control_effectiveness','')::numeric;
  v_uncertainty:=nullif(p_analysis->>'uncertainty','')::numeric;
  v_confidence:=nullif(p_analysis->>'confidence','')::numeric;
  v_complexity:=nullif(p_analysis->>'complexity','')::numeric;
  v_connectivity:=nullif(p_analysis->>'connectivity','')::numeric;
  v_exposure:=nullif(p_analysis->>'exposure','')::numeric;
  v_capacity:=nullif(p_analysis->>'capacity_load','')::numeric;
  v_velocity:=nullif(p_analysis->>'velocity','')::numeric;
  v_days:=nullif(p_analysis->>'time_to_unacceptable_days','')::numeric;
  if v_likelihood is null or v_peak is null or v_control is null or v_uncertainty is null
     or v_confidence is null or v_complexity is null or v_connectivity is null
     or v_exposure is null or v_capacity is null or v_velocity is null then
    return jsonb_build_object('error','likelihood, control effectiveness, uncertainty, confidence, complexity, connectivity, exposure, capacity and velocity are required');
  end if;
  if v_max_likelihood is null or v_max_likelihood<=0 then
    return jsonb_build_object('error','likelihood scale has no numeric maximum');
  end if;
  v_time_pressure:=case when v_days is null then 0 when v_days<=0 then 100
    else greatest(0,100*(1-least(v_days,365)/365)) end;
  v_inherent:=least(100,greatest(0,100*(v_likelihood/v_max_likelihood)*(v_peak/5)));
  v_controlled:=v_inherent*(1-least(100,greatest(0,v_control))/100);
  v_current:=least(100,greatest(0,
    v_controlled*coalesce((c.scoring_weights->>'inherent')::numeric,0)+
    v_exposure*coalesce((c.scoring_weights->>'exposure')::numeric,0)+
    v_uncertainty*coalesce((c.scoring_weights->>'uncertainty')::numeric,0)+
    ((v_complexity+v_connectivity)/2)*coalesce((c.scoring_weights->>'connectivity')::numeric,0)+
    greatest(0,v_velocity)*coalesce((c.scoring_weights->>'velocity')::numeric,0)+
    v_capacity*coalesce((c.scoring_weights->>'capacity')::numeric,0)+
    v_time_pressure*coalesce((c.time_factors->>'weight')::numeric,0)));
  v_opportunity:=case when r.kind='threat' then 0 else
    least(100,greatest(0,coalesce((p_analysis->>'opportunity_value')::numeric,0)
      *v_confidence/100*(0.5+v_exposure/200))) end;
  v_level:=case
    when v_current>=(c.thresholds->>'critical')::numeric then 'Critical'
    when v_current>=(c.thresholds->>'high')::numeric then 'High'
    when v_current>=(c.thresholds->>'medium')::numeric then 'Medium'
    when v_current>=(c.thresholds->>'low')::numeric then 'Low'
    else 'Very Low' end;
  v_action:=case when c.status<>'adopted' then 'INVESTIGATE'
    when v_current>=95 then 'STOP'
    when v_current>=(c.decision_thresholds->>'escalate')::numeric then 'ESCALATE'
    when v_current>=(c.decision_thresholds->>'treat')::numeric then 'TREAT'
    when v_current>=(c.decision_thresholds->>'investigate')::numeric then 'INVESTIGATE'
    when v_current>=(c.decision_thresholds->>'monitor')::numeric then 'MONITOR'
    else 'ACCEPT' end;
  r.status:='analyzed'; r.analysis_level:=p_analysis->>'analysis_level';
  r.analysis_method:=p_analysis->>'analysis_method'; r.likelihood:=v_likelihood;
  r.consequences:=p_analysis->'consequences'; r.control_effectiveness:=v_control;
  r.uncertainty:=v_uncertainty; r.confidence:=v_confidence; r.complexity:=v_complexity;
  r.connectivity:=v_connectivity; r.exposure:=v_exposure; r.capacity_load:=v_capacity;
  r.risk_velocity:=v_velocity; r.inherent_risk_score:=v_inherent;
  r.current_risk_score:=v_current; r.current_risk_level:=v_level; r.decision_action:=v_action;
  v_gaps:=public.risk_contract_gaps(r);
  if array_length(v_gaps,1)>0 then
    return jsonb_build_object('error','risk contract incomplete','gaps',v_gaps);
  end if;
  update risks set analysis_level=p_analysis->>'analysis_level',analysis_method=p_analysis->>'analysis_method',
    analysis_model_reference=nullif(p_analysis->>'analysis_model_reference',''),
    likelihood=v_likelihood,consequences=p_analysis->'consequences',control_effectiveness=v_control,
    uncertainty=v_uncertainty,confidence=v_confidence,complexity=v_complexity,
    connectivity=v_connectivity,exposure=v_exposure,capacity_load=v_capacity,risk_velocity=v_velocity,
    time_to_unacceptable=case when v_days is null then null else make_interval(days=>round(v_days)::int) end,
    inherent_risk_score=round(v_inherent,1),current_risk_score=round(v_current,1),
    opportunity_score=round(v_opportunity,1),current_risk_level=v_level,decision_action=v_action,
    status='analyzed',updated_at=now() where id=r.id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_analysis',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('risk_id',r.id,'method',p_analysis->>'analysis_method','score',round(v_current,1),
      'level',v_level,'recommended_action',v_action,'criteria_status',c.status));
  return jsonb_build_object('risk_id',r.id,'status','analyzed','inherent_score',round(v_inherent,1),
    'current_score',round(v_current,1),'opportunity_score',round(v_opportunity,1),
    'level',v_level,'recommended_action',v_action,'authoritative',c.status='adopted');
end;
$$;
grant execute on function public.record_risk_analysis(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Evidence ingestion adapter. Every source lands in canonical evidence_items;
-- provenance and data quality stay attached to the assertion they support.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_risk_evidence(p_risk_id uuid, p_evidence jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  r risks%rowtype;
  v_id uuid;
  v_kind text := coalesce(p_evidence->>'signal_kind','other');
begin
  select * into r from risks where id = p_risk_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  if v_kind not in (
    'work_order','reliability_history','condition_monitoring','process_historian',
    'inspection','audit','incident','near_miss','engineering_change','supplier',
    'regulatory','production_loss','weather','market','workforce','cyber','other'
  ) then return jsonb_build_object('error','unsupported signal_kind'); end if;
  if coalesce(btrim(p_evidence->>'description'),'') = '' then
    return jsonb_build_object('error','evidence description is required');
  end if;
  if coalesce(btrim(p_evidence->>'source_system'),'') = '' then
    return jsonb_build_object('error','source system is required');
  end if;

  insert into evidence_items (
    organization_id, risk_id, asset_id, source_system, evidence_type,
    description, confidence_contribution, data_quality, related_asset, ts,
    signal_kind, source_reference, provenance
  ) values (
    v_org, r.id, r.asset_id, btrim(p_evidence->>'source_system'),
    coalesce(p_evidence->>'evidence_type',v_kind), btrim(p_evidence->>'description'),
    coalesce((p_evidence->>'confidence_contribution')::int,0),
    coalesce(p_evidence->>'data_quality','unknown'), p_evidence->>'related_asset',
    coalesce((p_evidence->>'observed_at')::timestamptz,now()), v_kind,
    p_evidence->>'source_reference', coalesce(p_evidence->'provenance','{}'::jsonb)
  ) returning id into v_id;
  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'risk_evidence', coalesce((select role from user_profiles where id = auth.uid()),'unknown'),
    jsonb_build_object('risk_id',r.id,'evidence_id',v_id,'signal_kind',v_kind));
  return jsonb_build_object('evidence_id',v_id,'risk_id',r.id);
end;
$$;
grant execute on function public.ingest_risk_evidence(uuid, jsonb) to authenticated, service_role;

-- Value of information is recorded on the risk and as canonical evidence. It
-- may recommend further enquiry but never purchases, approves or executes it.
create or replace function public.record_risk_value_of_information(
  p_risk_id uuid,
  p_analysis jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid:=app_current_org();
  r risks%rowtype;
  v_information_cost numeric;
  v_decision_cost numeric;
  v_uncertainty_reduction numeric;
  v_change_probability numeric;
  v_expected numeric;
  v_net numeric;
  v_recommendation text;
  v_evidence uuid;
  v_result jsonb;
begin
  select * into r from risks where id=p_risk_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  v_information_cost:=nullif(p_analysis->>'information_cost','')::numeric;
  v_decision_cost:=nullif(p_analysis->>'decision_cost_if_wrong','')::numeric;
  v_uncertainty_reduction:=nullif(p_analysis->>'uncertainty_reduction','')::numeric;
  v_change_probability:=nullif(p_analysis->>'probability_decision_changes','')::numeric;
  if v_information_cost is null or v_decision_cost is null or
     v_uncertainty_reduction is null or v_change_probability is null or
     v_information_cost<0 or v_decision_cost<0 or
     v_uncertainty_reduction not between 0 and 1 or
     v_change_probability not between 0 and 1 then
    return jsonb_build_object('error','costs must be non-negative and probability inputs must be between 0 and 1');
  end if;
  if coalesce(length(btrim(p_analysis->>'information_action')),0)<10 then
    return jsonb_build_object('error','describe the inspection, test or enquiry being valued');
  end if;
  v_expected:=v_decision_cost*v_uncertainty_reduction*v_change_probability;
  v_net:=v_expected-v_information_cost;
  v_recommendation:=case when v_net>0 then 'GATHER_INFORMATION'
    else 'DECIDE_WITH_CURRENT_INFORMATION' end;
  v_result:=jsonb_build_object(
    'information_action',btrim(p_analysis->>'information_action'),
    'information_cost',v_information_cost,'decision_cost_if_wrong',v_decision_cost,
    'uncertainty_reduction',v_uncertainty_reduction,
    'probability_decision_changes',v_change_probability,
    'expected_value',round(v_expected,2),'net_value',round(v_net,2),
    'recommendation',v_recommendation,'currency',coalesce(p_analysis->>'currency',r.value_currency),
    'recorded_at',now(),'human_decision_required',true);
  update risks set value_of_information=v_result,updated_at=now() where id=r.id;
  insert into evidence_items(organization_id,risk_id,asset_id,source_system,evidence_type,
    description,confidence_contribution,data_quality,ts,signal_kind,source_reference,provenance)
  values(v_org,r.id,r.asset_id,'risk_operating_system','value_of_information',
    format('%s: expected information value %s, net %s. %s',v_recommendation,
      round(v_expected,2),round(v_net,2),btrim(p_analysis->>'information_action')),
    0,coalesce(r.data_quality,'unknown'),now(),'value_of_information',null,
    jsonb_build_object('calculation',v_result)) returning id into v_evidence;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_value_of_information',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('risk_id',r.id,'evidence_id',v_evidence,'result',v_result));
  return v_result || jsonb_build_object('evidence_id',v_evidence);
end;
$$;
grant execute on function public.record_risk_value_of_information(uuid, jsonb) to authenticated, service_role;

-- Control and indicator configuration are explicit governed actions. New
-- controls begin with UNKNOWN effectiveness; new indicators begin UNKNOWN and
-- cannot approve or accept a risk through their observations.
create or replace function public.configure_risk_control(
  p_risk_id uuid,
  p_control jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid:=app_current_org();
  v_role text;
  r risks%rowtype;
  v_id uuid;
  v_link uuid;
  v_owner uuid:=nullif(p_control->>'control_owner_id','')::uuid;
  v_competency bigint:=nullif(p_control->>'required_competency_id','')::bigint;
begin
  select role into v_role from user_profiles where id=auth.uid();
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden');
  end if;
  select * into r from risks where id=p_risk_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  if coalesce(btrim(p_control->>'name'),'')='' or
     coalesce(length(btrim(p_control->>'intended_effect')),0)<10 then
    return jsonb_build_object('error','control name and intended modifying effect are required');
  end if;
  if coalesce(p_control->>'control_type','') not in
    ('preventive','detective','mitigative','recovery','governance') then
    return jsonb_build_object('error','invalid control type');
  end if;
  if coalesce(p_control->>'intended_modifier','') not in
    ('likelihood','consequence','exposure','detectability','recovery','uncertainty') then
    return jsonb_build_object('error','invalid intended modifier');
  end if;
  if v_owner is null or not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then
    return jsonb_build_object('error','a named control owner in this organization is required');
  end if;
  if v_competency is not null and not exists(
    select 1 from competencies where id=v_competency and organization_id=v_org
  ) then return jsonb_build_object('error','required competency is outside this organization'); end if;
  insert into risk_controls(organization_id,context_id,name,control_type,intended_effect,
    control_owner_id,required_competency_id,assurance_method,test_frequency_days,
    design_status,effectiveness_rating,effectiveness_confidence)
  values(v_org,r.context_id,btrim(p_control->>'name'),p_control->>'control_type',
    btrim(p_control->>'intended_effect'),v_owner,v_competency,
    nullif(btrim(p_control->>'assurance_method'),''),
    nullif(p_control->>'test_frequency_days','')::int,
    coalesce(p_control->>'design_status','draft'),'unknown',0)
  returning id into v_id;
  insert into risk_control_links(organization_id,risk_id,control_id,intended_modifier,
    claimed_reduction,evidence_basis)
  values(v_org,r.id,v_id,p_control->>'intended_modifier',
    nullif(p_control->>'claimed_reduction','')::numeric,
    nullif(btrim(p_control->>'evidence_basis'),'')) returning id into v_link;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_control',v_role,jsonb_build_object('risk_id',r.id,'control_id',v_id,
    'link_id',v_link,'effectiveness','unknown'));
  return jsonb_build_object('control_id',v_id,'link_id',v_link,'effectiveness','unknown',
    'test_required',true);
end;
$$;
grant execute on function public.configure_risk_control(uuid, jsonb) to authenticated, service_role;

create or replace function public.configure_risk_indicator(
  p_risk_id uuid,
  p_indicator jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid:=app_current_org();
  v_role text;
  r risks%rowtype;
  v_id uuid;
  v_sensor uuid:=nullif(p_indicator->>'sensor_id','')::uuid;
  v_direction text:=coalesce(p_indicator->>'direction','higher_is_worse');
  v_thresholds jsonb:=coalesce(p_indicator->'thresholds','{}'::jsonb);
begin
  select role into v_role from user_profiles where id=auth.uid();
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden');
  end if;
  select * into r from risks where id=p_risk_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  if coalesce(btrim(p_indicator->>'name'),'')='' or coalesce(btrim(p_indicator->>'source_system'),'')='' then
    return jsonb_build_object('error','indicator name and source system are required');
  end if;
  if v_direction not in ('higher_is_worse','lower_is_worse','outside_band','state_change') then
    return jsonb_build_object('error','invalid indicator direction');
  end if;
  if v_direction in ('higher_is_worse','lower_is_worse') and not
     (v_thresholds ?& array['warning','critical']) then
    return jsonb_build_object('error','warning and critical thresholds are required');
  end if;
  if v_direction='outside_band' and not (v_thresholds ?& array['low','high']) then
    return jsonb_build_object('error','low and high thresholds are required');
  end if;
  if v_sensor is not null and not exists(
    select 1 from sensors where id=v_sensor and organization_id=v_org
  ) then return jsonb_build_object('error','sensor not found in this organization'); end if;
  insert into risk_indicators(organization_id,risk_id,sensor_id,name,source_system,
    signal_key,unit,direction,thresholds,refresh_interval_minutes,current_state,active)
  values(v_org,r.id,v_sensor,btrim(p_indicator->>'name'),btrim(p_indicator->>'source_system'),
    nullif(btrim(p_indicator->>'signal_key'),''),nullif(btrim(p_indicator->>'unit'),''),
    v_direction,v_thresholds,nullif(p_indicator->>'refresh_interval_minutes','')::int,
    'unknown',true) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_indicator',v_role,jsonb_build_object('risk_id',r.id,
    'indicator_id',v_id,'direction',v_direction,'thresholds',v_thresholds));
  return jsonb_build_object('indicator_id',v_id,'state','unknown','observation_required',true);
end;
$$;
grant execute on function public.configure_risk_indicator(uuid, jsonb) to authenticated, service_role;

create or replace function public.link_risks(
  p_source_risk_id uuid,
  p_target_risk_id uuid,
  p_relationship text,
  p_dependency_key text,
  p_strength numeric,
  p_rationale text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid:=app_current_org(); v_id uuid;
begin
  if p_source_risk_id=p_target_risk_id then return jsonb_build_object('error','a risk cannot link to itself'); end if;
  if p_relationship not in ('causes','amplifies','cascades_to','common_dependency',
    'common_control','opportunity_tradeoff','sequence') then
    return jsonb_build_object('error','invalid risk relationship');
  end if;
  if not exists(select 1 from risks where id=p_source_risk_id and organization_id=v_org)
     or not exists(select 1 from risks where id=p_target_risk_id and organization_id=v_org) then
    return jsonb_build_object('error','both risks must exist in this organization');
  end if;
  if coalesce(length(btrim(p_rationale)),0)<10 then
    return jsonb_build_object('error','record the causal or dependency basis');
  end if;
  insert into risk_links(organization_id,source_risk_id,target_risk_id,relationship,
    dependency_key,strength,rationale)
  values(v_org,p_source_risk_id,p_target_risk_id,p_relationship,
    nullif(btrim(p_dependency_key),''),p_strength,btrim(p_rationale))
  on conflict(source_risk_id,target_risk_id,relationship) do update set
    dependency_key=excluded.dependency_key,strength=excluded.strength,
    rationale=excluded.rationale
  returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_link',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('link_id',v_id,'source_risk_id',p_source_risk_id,
      'target_risk_id',p_target_risk_id,'relationship',p_relationship));
  return jsonb_build_object('link_id',v_id,'relationship',p_relationship);
end;
$$;
grant execute on function public.link_risks(uuid, uuid, text, text, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Communication, consultation and explicit disagreement capture.
-- ---------------------------------------------------------------------------
create or replace function public.record_stakeholder_view(p_risk_id uuid, p_view jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  r risks%rowtype;
  v_id uuid;
  v_l_min numeric;
  v_l_max numeric;
  v_c_min numeric;
  v_c_max numeric;
begin
  select * into r from risks where id = p_risk_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  if coalesce(btrim(p_view->>'stakeholder_name'),'') = ''
     or coalesce(length(btrim(p_view->>'rationale')),0) < 10 then
    return jsonb_build_object('error','stakeholder name and substantive rationale are required');
  end if;
  if nullif(p_view->>'stakeholder_user_id','') is not null and not exists(
    select 1 from user_profiles where id=(p_view->>'stakeholder_user_id')::uuid
      and organization_id=v_org
  ) then return jsonb_build_object('error','stakeholder user not found in this organization'); end if;
  insert into risk_stakeholder_views (
    organization_id, risk_id, stakeholder_user_id, stakeholder_name,
    stakeholder_role, view_kind, perceived_likelihood, perceived_consequence,
    concern_level, rationale, assumptions, information_to_resolve
  ) values (
    v_org, r.id, nullif(p_view->>'stakeholder_user_id','')::uuid,
    btrim(p_view->>'stakeholder_name'), p_view->>'stakeholder_role',
    coalesce(p_view->>'view_kind','technical'),
    nullif(p_view->>'perceived_likelihood','')::numeric,
    nullif(p_view->>'perceived_consequence','')::numeric,
    p_view->>'concern_level', btrim(p_view->>'rationale'),
    coalesce(p_view->'assumptions','[]'::jsonb), p_view->>'information_to_resolve'
  ) returning id into v_id;

  select min(perceived_likelihood), max(perceived_likelihood),
         min(perceived_consequence), max(perceived_consequence)
  into v_l_min, v_l_max, v_c_min, v_c_max
  from risk_stakeholder_views
  where risk_id = r.id and status = 'open';
  return jsonb_build_object('view_id',v_id,
    'material_disagreement', coalesce(v_l_max-v_l_min,0) >= 2 or coalesce(v_c_max-v_c_min,0) >= 2,
    'likelihood_spread',coalesce(v_l_max-v_l_min,0),
    'consequence_spread',coalesce(v_c_max-v_c_min,0),
    'resolution_question','What additional information would resolve this disagreement?');
end;
$$;
grant execute on function public.record_stakeholder_view(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Dynamic indicator observation. Automation may update exposure and recommend
-- MONITOR/TREAT/ESCALATE/STOP; it never records ACCEPT or approves anything.
-- ---------------------------------------------------------------------------
create or replace function public.record_risk_indicator_observation(
  p_indicator_id uuid,
  p_value numeric,
  p_observed_at timestamptz,
  p_data_quality text default 'good',
  p_source_reference text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  i risk_indicators%rowtype;
  r risks%rowtype;
  c risk_criteria_profiles%rowtype;
  v_state text := 'normal';
  v_warning numeric;
  v_critical numeric;
  v_low numeric;
  v_high numeric;
  v_delta numeric := 0;
  v_score numeric;
  v_level text;
  v_action text;
  v_evidence uuid;
  v_observation uuid;
begin
  select * into i from risk_indicators
  where id = p_indicator_id and organization_id = v_org and active;
  if not found then return jsonb_build_object('error','active indicator not found'); end if;
  select * into r from risks where id = i.risk_id and organization_id = v_org;
  select * into c from risk_criteria_profiles where id = r.criteria_profile_id;

  v_warning := nullif(i.thresholds->>'warning','')::numeric;
  v_critical := nullif(i.thresholds->>'critical','')::numeric;
  v_low := nullif(i.thresholds->>'low','')::numeric;
  v_high := nullif(i.thresholds->>'high','')::numeric;
  if i.direction = 'higher_is_worse' then
    if v_critical is not null and p_value >= v_critical then v_state := 'critical';
    elsif v_warning is not null and p_value >= v_warning then v_state := 'warning'; end if;
  elsif i.direction = 'lower_is_worse' then
    if v_critical is not null and p_value <= v_critical then v_state := 'critical';
    elsif v_warning is not null and p_value <= v_warning then v_state := 'warning'; end if;
  elsif i.direction = 'outside_band' then
    if v_low is not null and v_high is not null and (p_value < v_low or p_value > v_high) then
      v_state := 'critical';
    end if;
  elsif i.direction = 'state_change' and i.current_value is not null and p_value is distinct from i.current_value then
    v_state := 'warning';
  end if;

  insert into evidence_items (
    organization_id, risk_id, asset_id, source_system, evidence_type,
    description, confidence_contribution, data_quality, ts, signal_kind,
    source_reference, provenance
  ) values (
    v_org, r.id, r.asset_id, i.source_system, 'risk_indicator',
    format('%s = %s %s (%s)',i.name,p_value,coalesce(i.unit,''),v_state),
    case v_state when 'critical' then 10 when 'warning' then 5 else 0 end,
    p_data_quality, coalesce(p_observed_at,now()), 'condition_monitoring',
    p_source_reference, jsonb_build_object('indicator_id',i.id,'signal_key',i.signal_key)
  ) returning id into v_evidence;
  insert into risk_indicator_observations (
    organization_id, indicator_id, evidence_item_id, value, state,
    data_quality, source_reference, observed_at
  ) values (
    v_org, i.id, v_evidence, p_value, v_state, p_data_quality,
    p_source_reference, coalesce(p_observed_at,now())
  ) returning id into v_observation;

  update risk_indicators set previous_value = current_value, current_value = p_value,
    current_state = v_state, observed_at = coalesce(p_observed_at,now()) where id = i.id;

  -- A bounded signal contribution; the adopted criteria still define level
  -- thresholds. Normal readings do not silently erase accepted residual risk.
  v_delta := case v_state when 'critical' then 10 when 'warning' then 5 else 0 end;
  v_score := least(100, greatest(coalesce(r.residual_risk_score,0), coalesce(r.current_risk_score,0) + v_delta));
  if c.status = 'adopted' then
    v_level := case
      when v_score >= coalesce((c.thresholds->>'critical')::numeric,101) then 'Critical'
      when v_score >= coalesce((c.thresholds->>'high')::numeric,101) then 'High'
      when v_score >= coalesce((c.thresholds->>'medium')::numeric,101) then 'Medium'
      when v_score >= coalesce((c.thresholds->>'low')::numeric,101) then 'Low'
      else 'Very Low' end;
  else
    v_level := r.current_risk_level;
  end if;
  v_action := case
    when v_state = 'critical' and v_score >= 95 then 'STOP'
    when v_state = 'critical' then 'ESCALATE'
    when v_state = 'warning' then 'TREAT'
    else coalesce(nullif(r.decision_action,'ACCEPT'),'MONITOR') end;
  update risks set
    current_risk_score = v_score,
    current_risk_level = v_level,
    risk_velocity = case when i.current_value is null or i.current_value = 0 then 0
      else least(100,greatest(-100,100 * (p_value-i.current_value) / abs(i.current_value))) end,
    decision_action = case when v_action = 'ACCEPT' then 'MONITOR' else v_action end,
    updated_at = now()
  where id = r.id;

  if v_state in ('warning','critical') then
    insert into learning_events (organization_id, risk_id, asset_id, event_type, title, detail, model_confidence)
    values (v_org,r.id,r.asset_id,'emerging_risk_detected',
      format('%s indicator %s',i.name,v_state),
      format('%s moved to %s at %s %s. Risk re-evaluated; no decision was approved or accepted automatically.',
        i.name,v_state,p_value,coalesce(i.unit,'')),r.confidence::int);
  end if;
  return jsonb_build_object('observation_id',v_observation,'evidence_id',v_evidence,
    'state',v_state,'current_risk_score',v_score,'current_risk_level',v_level,
    'recommended_action',v_action,'human_decision_required',true);
end;
$$;
grant execute on function public.record_risk_indicator_observation(uuid, numeric, timestamptz, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Control testing: operating effect, not document existence.
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
begin
  select * into c from risk_controls where id = p_control_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','control not found in this organization'); end if;
  if coalesce(p_test->>'result','') not in ('passed','failed','inconclusive','not_exercised') then
    return jsonb_build_object('error','invalid test result');
  end if;
  if coalesce(length(btrim(p_test->>'note')),0) < 10 then
    return jsonb_build_object('error','record what was tested and observed');
  end if;
  insert into risk_control_tests (
    organization_id, control_id, test_method, result, intended_effect_observed,
    failures_despite_control, evidence_item_id, note, tested_by, tested_at
  ) values (
    v_org,c.id,btrim(p_test->>'test_method'),p_test->>'result',
    nullif(p_test->>'intended_effect_observed','')::boolean,
    coalesce((p_test->>'failures_despite_control')::int,0),
    nullif(p_test->>'evidence_item_id','')::uuid,btrim(p_test->>'note'),auth.uid(),
    coalesce((p_test->>'tested_at')::timestamptz,now())
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
    jsonb_build_object('control_id',c.id,'test_id',v_id,'rating',v_rating,'score',v_score));
  return jsonb_build_object('test_id',v_id,'rating',v_rating,'score',v_score,
    'trend',v_trend,'confidence',least(100,v_total*20));
end;
$$;
grant execute on function public.record_risk_control_test(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Treatment orchestrator. Every alternative is a canonical scenario. Selecting
-- one creates a canonical recommendation and approval; no work order is created
-- and nothing is approved until the existing governance chain releases it.
-- ---------------------------------------------------------------------------
create or replace function public.create_risk_treatment(
  p_risk_id uuid,
  p_option jsonb,
  p_select boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  r risks%rowtype;
  v_scenario uuid;
  v_rec uuid;
  v_approval uuid;
  v_strategy text := p_option->>'strategy';
  v_required jsonb := coalesce(p_option->'required_resources','[]'::jsonb);
  v_available jsonb := coalesce(p_option->'available_resources','[]'::jsonb);
  v_competencies jsonb := coalesce(p_option->'required_competencies','[]'::jsonb);
  v_missing jsonb := '[]'::jsonb;
  v_executable boolean := true;
  v_residual numeric;
  v_introduced numeric;
  v_net numeric;
  item text;
begin
  select * into r from risks where id = p_risk_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  if v_strategy not in ('avoid','pursue_opportunity','remove_source','change_likelihood',
    'change_consequence','share','retain') then
    return jsonb_build_object('error','invalid ISO 31000 treatment strategy');
  end if;
  if coalesce(btrim(p_option->>'label'),'') = '' then
    return jsonb_build_object('error','treatment label is required');
  end if;
  v_residual := nullif(p_option->>'residual_risk','')::numeric;
  v_introduced := coalesce(nullif(p_option->>'introduced_risk','')::numeric,0);
  if v_residual is null then return jsonb_build_object('error','expected residual risk is required'); end if;
  if not (p_option ? 'introduced_risks') then
    return jsonb_build_object('error','introduced_risks must be assessed, even when the answer is an empty array');
  end if;

  for item in select jsonb_array_elements_text(v_required) loop
    if not (v_available ? item) then
      v_missing := v_missing || jsonb_build_array('resource: ' || item);
      v_executable := false;
    end if;
  end loop;
  -- Competency requirements name the canonical competency key. At least one
  -- active workforce member must hold each key; identity is not guessed.
  for item in select jsonb_array_elements_text(v_competencies) loop
    if not exists (
      select 1 from competencies c
      join member_competencies mc on mc.competency_id = c.id
      join workforce_members wm on wm.id = mc.member_id and wm.active
      where c.organization_id = v_org and c.competency_key = item
        and (mc.expires_on is null or mc.expires_on >= current_date)
    ) then
      v_missing := v_missing || jsonb_build_array('competency: ' || item);
      v_executable := false;
    end if;
  end loop;
  v_net := coalesce(r.current_risk_score,0) - v_residual - v_introduced;

  insert into scenarios (
    organization_id, risk_id, asset_id, key, label, cost, downtime_impact,
    production_impact, safety_risk, environmental_risk, financial_exposure,
    mission_readiness_impact, recommended, treatment_strategy,
    expected_residual_risk, introduced_risks, expected_risk_reduction,
    confidence, required_resources, available_resources,
    required_competencies, executable, readiness_gaps, asset_life_impact,
    objective_tradeoffs
  ) values (
    v_org,r.id,r.asset_id,coalesce(p_option->>'key',v_strategy),btrim(p_option->>'label'),
    coalesce((p_option->>'cost')::numeric,0),p_option->>'downtime_impact',
    p_option->>'production_impact',p_option->>'safety_risk',p_option->>'environmental_risk',
    p_option->>'financial_exposure',p_option->>'mission_readiness_impact',p_select,
    v_strategy,v_residual,coalesce(p_option->'introduced_risks','[]'::jsonb),v_net,
    nullif(p_option->>'confidence','')::numeric,v_required,v_available,
    v_competencies,v_executable,v_missing,p_option->>'asset_life_impact',
    coalesce(p_option->'objective_tradeoffs','{}'::jsonb)
  ) returning id into v_scenario;

  if p_select then
    if not v_executable then
      return jsonb_build_object('scenario_id',v_scenario,'selected',false,
        'error','treatment is not executable','readiness_gaps',v_missing);
    end if;
    if coalesce(length(btrim(p_option->>'rationale')),0) < 20
       or coalesce(btrim(p_option->>'consequence_summary'),'') = ''
       or coalesce(btrim(p_option->>'alternatives_considered'),'') = ''
       or nullif(p_option->>'required_completion_date','') is null
       or coalesce(btrim(p_option->>'required_approver_role'),'') = ''
       or coalesce(btrim(p_option->>'verification_method'),'') = ''
       or nullif(p_option->>'treatment_owner_id','') is null
       or not exists(select 1 from user_profiles where
         id=(p_option->>'treatment_owner_id')::uuid and organization_id=v_org) then
      return jsonb_build_object('scenario_id',v_scenario,'selected',false,
        'error','selected treatment lacks the canonical recommendation contract or named treatment owner');
    end if;
    insert into recommendations (
      organization_id, risk_id, asset_id, title, issue, action, impact,
      confidence, urgency, status, approval_required, accountable, responsible,
      consulted, informed, financial_impact, risk_impact, rationale,
      consequence_summary, alternatives_considered, required_completion_date,
      required_approver_role, verification_method, estimated_cost_usd,
      treatment_strategy, treatment_owner_id, original_risk_score,
      expected_residual_risk_score, target_risk_score, new_risks_introduced,
      net_risk_change, resource_readiness, raised_by
    ) values (
      v_org,r.id,r.asset_id,btrim(p_option->>'label'),r.event_description,
      coalesce(p_option->>'action',p_option->>'label'),p_option->>'impact',
      coalesce((p_option->>'confidence')::int,round(coalesce(r.confidence,0))::int),
      case when r.current_risk_level in ('Critical','High') then 'critical' else 'action' end,
      'pending',p_option->>'required_approver_role',
      coalesce((select full_name from user_profiles where id=r.risk_owner_id),'Named risk owner'),
      coalesce((select full_name from user_profiles where id=(p_option->>'treatment_owner_id')::uuid),'Named treatment owner'),
      array_to_string(array(select jsonb_array_elements_text(r.stakeholders)),', '),
      p_option->>'informed',p_option->>'financial_exposure',coalesce(r.current_risk_level,'Medium'),
      btrim(p_option->>'rationale'),btrim(p_option->>'consequence_summary'),
      btrim(p_option->>'alternatives_considered'),(p_option->>'required_completion_date')::date,
      p_option->>'required_approver_role',p_option->>'verification_method',
      coalesce((p_option->>'cost')::numeric,0),v_strategy,
      (p_option->>'treatment_owner_id')::uuid,r.current_risk_score,v_residual,
      coalesce(nullif(p_option->>'target_risk','')::numeric,r.target_risk_score),
      coalesce(p_option->'introduced_risks','[]'::jsonb),v_net,
      jsonb_build_object('executable',v_executable,'gaps',v_missing),auth.uid()
    ) returning id into v_rec;
    insert into approvals (
      organization_id,risk_id,recommendation_id,status,owner_role,reason,
      consequence_of_wrong,required_validation
    ) values (
      v_org,r.id,v_rec,'required',p_option->>'required_approver_role',
      'Human approval required before risk treatment becomes executable work.',
      p_option->>'consequence_summary',p_option->>'verification_method'
    ) returning id into v_approval;
    update risks set status = 'treatment_active',updated_at=now() where id=r.id;
  end if;
  insert into audit_events (organization_id,entity_type,actor,event_data)
  values (v_org,'risk_treatment',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('risk_id',r.id,'scenario_id',v_scenario,'selected',p_select,
      'recommendation_id',v_rec,'approval_id',v_approval,'executable',v_executable));
  return jsonb_build_object('scenario_id',v_scenario,'selected',p_select,
    'executable',v_executable,'readiness_gaps',v_missing,
    'recommendation_id',v_rec,'approval_id',v_approval,'net_risk_change',v_net,
    'human_approval_required',p_select);
end;
$$;
grant execute on function public.create_risk_treatment(uuid, jsonb, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Risk evaluation -> canonical decision. This records a pending decision and
-- its explanation. ACCEPT still requires the acceptance RPC below.
-- ---------------------------------------------------------------------------
create or replace function public.record_risk_decision(
  p_risk_id uuid,
  p_action text,
  p_rationale text,
  p_residual_risk_score numeric default null,
  p_residual_risk_level text default null,
  p_review_date date default null,
  p_reassessment_trigger text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  r risks%rowtype;
  c risk_criteria_profiles%rowtype;
  v_decision uuid;
  v_gaps text[];
  v_required_role text;
begin
  select * into r from risks where id=p_risk_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  select * into c from risk_criteria_profiles where id=r.criteria_profile_id and organization_id=v_org;
  if c.status <> 'adopted' then
    return jsonb_build_object('error','risk evaluation requires an adopted criteria profile');
  end if;
  if p_action not in ('ACCEPT','MONITOR','INVESTIGATE','TREAT','ESCALATE','STOP') then
    return jsonb_build_object('error','invalid risk decision');
  end if;
  if coalesce(length(btrim(p_rationale)),0) < 20 then
    return jsonb_build_object('error','record the evidence and trade-off behind this decision');
  end if;
  if p_action in ('ACCEPT','MONITOR') and
     (p_residual_risk_score is null or p_residual_risk_level is null
      or p_review_date is null or coalesce(btrim(p_reassessment_trigger),'')='') then
    return jsonb_build_object('error',
      'accept/monitor requires residual risk, review date and reassessment trigger');
  end if;
  select role_key into v_required_role
  from authority_limits
  where organization_id=v_org and status='adopted'
    and max_risk_level is not null
    and risk_rank(max_risk_level)>=risk_rank(r.current_risk_level)
    and (max_exposure is null or max_exposure>=coalesce(r.exposure,0))
    and (jsonb_array_length(risk_kinds)=0 or risk_kinds ? r.kind)
  order by risk_rank(max_risk_level),coalesce(max_commitment_usd,1e18) limit 1;
  if v_required_role is null then
    return jsonb_build_object('error',
      'no adopted authority limit covers this risk level; leadership must adopt the decision authority or escalate explicitly');
  end if;

  r.status := 'evaluated';
  r.decision_action := p_action;
  r.residual_risk_score := coalesce(p_residual_risk_score,r.residual_risk_score);
  r.residual_risk_level := coalesce(p_residual_risk_level,r.residual_risk_level);
  r.review_date := coalesce(p_review_date,r.review_date);
  r.escalation_threshold := coalesce(p_reassessment_trigger,r.escalation_threshold);
  v_gaps := public.risk_contract_gaps(r);
  if array_length(v_gaps,1)>0 then
    return jsonb_build_object('error','risk contract incomplete','gaps',v_gaps);
  end if;

  update risks set decision_action=p_action,
    residual_risk_score=coalesce(p_residual_risk_score,residual_risk_score),
    residual_risk_level=coalesce(p_residual_risk_level,residual_risk_level),
    review_date=coalesce(p_review_date,review_date),
    escalation_threshold=coalesce(p_reassessment_trigger,escalation_threshold),
    status='evaluated',updated_at=now()
  where id=r.id;
  insert into decisions (
    organization_id,risk_id,asset_id,decision_type,action_taken,
    approval_status,autonomy_mode,confidence_score,human_actor,rationale,
    outcome_status,risk_decision_action,residual_risk_level,
    reassessment_trigger
  ) values (
    v_org,r.id,r.asset_id,'risk_evaluation',p_action,'pending','advisory',
    round(coalesce(r.confidence,0))::int,
    coalesce((select full_name from user_profiles where id=auth.uid()),auth.uid()::text),
    btrim(p_rationale),'open',p_action,p_residual_risk_level,p_reassessment_trigger
  ) returning id into v_decision;
  insert into approvals (
    organization_id,risk_id,decision_id,status,owner_role,reason,
    consequence_of_wrong,required_validation
  ) values (
    v_org,r.id,v_decision,'required',
    v_required_role,
    'Risk decision requires accountable human approval.',
    r.event_description,
    coalesce(p_reassessment_trigger,'Review evidence and criteria before decision.')
  );
  insert into audit_events (organization_id,entity_type,actor,event_data)
  values (v_org,'risk_decision',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('risk_id',r.id,'decision_id',v_decision,'action',p_action,
      'approval_status','pending'));
  return jsonb_build_object('decision_id',v_decision,'action',p_action,
    'approval_status','pending','human_approval_required',true,
    'acceptance_required',p_action='ACCEPT');
end;
$$;
grant execute on function public.record_risk_decision(uuid, text, text, numeric, text, date, text) to authenticated, service_role;

create or replace function public.decide_risk_decision(
  p_decision_id uuid,
  p_approve boolean,
  p_note text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid:=app_current_org();
  v_role text;
  d decisions%rowtype;
  r risks%rowtype;
  a approvals%rowtype;
  l authority_limits%rowtype;
  v_missing text[]:='{}';
  item text;
begin
  select role into v_role from user_profiles where id=auth.uid();
  select * into d from decisions where id=p_decision_id and organization_id=v_org
    and risk_id is not null and approval_status='pending';
  if not found then return jsonb_build_object('error','pending risk decision not found'); end if;
  select * into r from risks where id=d.risk_id and organization_id=v_org;
  select * into a from approvals where decision_id=d.id and organization_id=v_org
    and status in ('required','pending') order by created_at desc limit 1;
  if not found then return jsonb_build_object('error','canonical approval record not found'); end if;
  if coalesce(length(btrim(p_note)),0)<10 then
    return jsonb_build_object('error','record the approval or rejection basis');
  end if;
  select * into l from authority_limits where organization_id=v_org and role_key=v_role
    and status='adopted' order by version desc limit 1;
  if not found then v_missing:=array_append(v_missing,'adopted authority limit');
  else
    if l.max_risk_level is not null and risk_rank(r.current_risk_level)>risk_rank(l.max_risk_level) then
      v_missing:=array_append(v_missing,'risk level exceeds role ceiling'); end if;
    if l.max_exposure is not null and coalesce(r.exposure,0)>l.max_exposure then
      v_missing:=array_append(v_missing,'exposure exceeds role ceiling'); end if;
    if jsonb_array_length(l.risk_kinds)>0 and not (l.risk_kinds ? r.kind) then
      v_missing:=array_append(v_missing,'role is not authorized for this risk kind'); end if;
    for item in select jsonb_array_elements_text(l.required_competency_keys) loop
      if not exists(
        select 1 from workforce_members wm
        join member_competencies mc on mc.member_id=wm.id
        join competencies c on c.id=mc.competency_id
        where wm.organization_id=v_org and wm.user_id=auth.uid() and wm.active
          and c.competency_key=item
          and (mc.expires_on is null or mc.expires_on>=current_date)
      ) then v_missing:=array_append(v_missing,'competency: '||item); end if;
    end loop;
  end if;
  if p_approve and array_length(v_missing,1)>0 then
    return jsonb_build_object('error','approver is not qualified','gaps',v_missing,
      'required_role',a.owner_role);
  end if;
  update decisions set approval_status=case when p_approve then 'approved' else 'rejected' end,
    human_actor=auth.uid()::text,rationale=coalesce(rationale,'')||' | Human decision: '||btrim(p_note),
    outcome_status=case when p_approve then 'executed' else 'reverted' end
  where id=d.id;
  update approvals set status=case when p_approve then 'approved' else 'rejected' end,
    approver=auth.uid()::text,reason=coalesce(reason,'')||' '||btrim(p_note),decided_at=now()
  where id=a.id;
  if not p_approve then
    update risks set decision_action='INVESTIGATE',status='analyzed',updated_at=now() where id=r.id;
  elsif d.risk_decision_action='MONITOR' then
    update risks set status='monitoring',updated_at=now() where id=r.id;
  end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_decision',v_role,jsonb_build_object('risk_id',r.id,'decision_id',d.id,
    'approved',p_approve,'note',btrim(p_note),'authority_limit_id',l.id));
  return jsonb_build_object('decision_id',d.id,'approved',p_approve,
    'risk_status',case when not p_approve then 'analyzed'
      when d.risk_decision_action='MONITOR' then 'monitoring' else r.status end,
    'residual_acceptance_required',p_approve and d.risk_decision_action='ACCEPT');
end;
$$;
grant execute on function public.decide_risk_decision(uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Risk-specific overload of the existing risk acceptance model. The original
-- six-argument function remains for recommendation/asset/site/standard. This
-- overload adds the mandatory reassessment trigger for universal risks.
-- ---------------------------------------------------------------------------
create or replace function public.accept_risk(
  p_subject_type text,
  p_subject_id uuid,
  p_risk_level text,
  p_rationale text,
  p_compensating_controls text,
  p_expires_at timestamptz,
  p_reassessment_trigger text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  l authority_limits%rowtype;
  r risks%rowtype;
  v_id uuid;
  v_missing text[]:='{}';
  item text;
begin
  if p_subject_type <> 'risk' then
    return jsonb_build_object('error','the seven-argument acceptance contract is for subject_type risk');
  end if;
  select * into r from risks where id=p_subject_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  select role into v_role from user_profiles where id=auth.uid();
  if v_role is null then return jsonb_build_object('error','forbidden'); end if;
  if risk_rank(p_risk_level)=0 then return jsonb_build_object('error','invalid risk level'); end if;
  if coalesce(length(btrim(p_rationale)),0)<20 then
    return jsonb_build_object('error','state why the residual risk is acceptable');
  end if;
  if coalesce(length(btrim(p_compensating_controls)),0)<20 then
    return jsonb_build_object('error','state the compensating controls');
  end if;
  if coalesce(length(btrim(p_reassessment_trigger)),0)<10 then
    return jsonb_build_object('error','record a measurable reassessment trigger');
  end if;
  if p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '1 year' then
    return jsonb_build_object('error','acceptance must expire in the future and within one year');
  end if;
  if r.residual_risk_level is null or risk_rank(p_risk_level)<risk_rank(r.residual_risk_level) then
    return jsonb_build_object('error','acceptance level cannot understate recorded residual risk');
  end if;
  select * into l from authority_limits where organization_id=v_org
    and role_key=v_role and status='adopted' order by version desc limit 1;
  if not found then
    return jsonb_build_object('error','no adopted authority limit exists for your role');
  end if;
  if l.max_risk_level is not null and risk_rank(p_risk_level)>risk_rank(l.max_risk_level) then
    return jsonb_build_object('error',format('%s risk exceeds the %s ceiling of %s for your role. Escalate to %s.',
      p_risk_level,l.tier_label,l.max_risk_level,coalesce(l.escalates_to_role,'the board')));
  end if;
  if l.max_exposure is not null and coalesce(r.exposure,0)>l.max_exposure then
    return jsonb_build_object('error','risk exposure exceeds the adopted ceiling for your role');
  end if;
  if jsonb_array_length(l.risk_kinds)>0 and not (l.risk_kinds ? r.kind) then
    return jsonb_build_object('error','your adopted authority does not cover this risk kind');
  end if;
  for item in select jsonb_array_elements_text(l.required_competency_keys) loop
    if not exists(
      select 1 from workforce_members wm
      join member_competencies mc on mc.member_id=wm.id
      join competencies c on c.id=mc.competency_id
      where wm.organization_id=v_org and wm.user_id=auth.uid() and wm.active
        and c.competency_key=item
        and (mc.expires_on is null or mc.expires_on>=current_date)
    ) then v_missing:=array_append(v_missing,'competency: '||item); end if;
  end loop;
  if array_length(v_missing,1)>0 then
    return jsonb_build_object('error','acceptor is not qualified','gaps',v_missing);
  end if;
  insert into risk_acceptances (
    organization_id,subject_type,subject_id,risk_level,rationale,
    compensating_controls,accepted_by,accepted_role,expires_at,review_at,
    reassessment_trigger
  ) values (
    v_org,'risk',r.id,p_risk_level,btrim(p_rationale),btrim(p_compensating_controls),
    auth.uid(),v_role,p_expires_at,least(p_expires_at-interval '30 days',
      coalesce(r.review_date::timestamptz,p_expires_at-interval '30 days')),
    btrim(p_reassessment_trigger)
  ) returning id into v_id;
  update risks set decision_action='ACCEPT',status='monitoring',
    escalation_threshold=btrim(p_reassessment_trigger),
    review_date=least(coalesce(review_date,p_expires_at::date),(p_expires_at-interval '30 days')::date),
    updated_at=now() where id=r.id;
  update decisions set approval_status='approved',human_actor=auth.uid()::text,
    acceptance_expires_at=p_expires_at,reassessment_trigger=btrim(p_reassessment_trigger)
  where risk_id=r.id and risk_decision_action='ACCEPT' and approval_status='pending';
  update approvals set status='approved',approver=auth.uid()::text,decided_at=now(),
    reason=coalesce(reason,'') || ' Residual risk acceptance ' || v_id::text || ' recorded.'
  where risk_id=r.id and status in ('required','pending');
  insert into audit_events (organization_id,entity_type,actor,event_data)
  values (v_org,'risk_acceptance',v_role,jsonb_build_object('acceptance_id',v_id,
    'risk_id',r.id,'risk_level',p_risk_level,'expires_at',p_expires_at,
    'reassessment_trigger',p_reassessment_trigger,'authority_limit_id',l.id));
  return jsonb_build_object('acceptance_id',v_id,'risk_id',r.id,
    'expires_at',p_expires_at,'review_at',least(p_expires_at-interval '30 days',
      coalesce(r.review_date::timestamptz,p_expires_at-interval '30 days')),
    'ceiling_checked',true,'authority_limit_id',l.id);
end;
$$;
grant execute on function public.accept_risk(text, uuid, text, text, text, timestamptz, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Outcome -> learning -> updated risk. Outcomes never disappear into a closed
-- recommendation; failed or inconclusive treatments reopen the decision.
-- ---------------------------------------------------------------------------
create or replace function public.record_risk_outcome(p_risk_id uuid, p_outcome jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  r risks%rowtype;
  v_result text := p_outcome->>'result';
  v_event uuid;
  v_score numeric;
  v_level text;
begin
  select * into r from risks where id=p_risk_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  if v_result not in ('achieved','not_achieved','inconclusive','risk_realized','opportunity_realized') then
    return jsonb_build_object('error','invalid outcome result');
  end if;
  if coalesce(length(btrim(p_outcome->>'measurement')),0)<20 then
    return jsonb_build_object('error','record what was measured, against what and when');
  end if;
  v_score := coalesce(nullif(p_outcome->>'observed_risk_score','')::numeric,r.current_risk_score);
  v_level := coalesce(nullif(p_outcome->>'observed_risk_level',''),r.current_risk_level);
  insert into learning_events (
    organization_id,risk_id,asset_id,event_type,title,detail,
    expected_value,verified_value,model_confidence
  ) values (
    v_org,r.id,r.asset_id,
    case v_result when 'not_achieved' then 'risk_treatment_failed'
      when 'inconclusive' then 'risk_treatment_inconclusive'
      when 'risk_realized' then 'risk_realized'
      when 'opportunity_realized' then 'opportunity_realized'
      else 'risk_treatment_verified' end,
    format('%s: %s',r.title,replace(v_result,'_',' ')),btrim(p_outcome->>'measurement'),
    r.target_risk_score,v_score,r.confidence::int
  ) returning id into v_event;
  update risks set current_risk_score=v_score,current_risk_level=v_level,
    residual_risk_score=case when v_result='achieved' then v_score else residual_risk_score end,
    residual_risk_level=case when v_result='achieved' then v_level else residual_risk_level end,
    decision_action=case when v_result in ('not_achieved','inconclusive','risk_realized') then 'INVESTIGATE'
      else coalesce(nullif(decision_action,'STOP'),'MONITOR') end,
    status=case when v_result in ('not_achieved','inconclusive','risk_realized') then 'analyzed'
      else 'monitoring' end,
    review_date=coalesce(nullif(p_outcome->>'next_review','')::date,current_date+30),
    updated_at=now()
  where id=r.id;
  insert into audit_events (organization_id,entity_type,actor,event_data)
  values (v_org,'risk_outcome',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('risk_id',r.id,'learning_event_id',v_event,'result',v_result,
      'observed_risk_score',v_score,'observed_risk_level',v_level));
  return jsonb_build_object('learning_event_id',v_event,'result',v_result,
    'risk_status',case when v_result in ('not_achieved','inconclusive','risk_realized') then 'analyzed' else 'monitoring' end,
    'decision_action',case when v_result in ('not_achieved','inconclusive','risk_realized') then 'INVESTIGATE' else 'MONITOR' end);
end;
$$;
grant execute on function public.record_risk_outcome(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Adaptation and maturity recording. Scores are evidence supplied by the
-- assessor; SyncAI records the basis and does not self-certify.
-- ---------------------------------------------------------------------------
create or replace function public.record_risk_maturity_assessment(p_assessment jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_id uuid;
  v_level int;
begin
  select role into v_role from user_profiles where id=auth.uid();
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden');
  end if;
  v_level := nullif(p_assessment->>'maturity_level','')::int;
  if v_level is null or v_level not between 0 and 5 then
    return jsonb_build_object('error','maturity_level must be 0 through 5');
  end if;
  if coalesce(length(btrim(p_assessment->>'evidence_summary')),0)<20 then
    return jsonb_build_object('error','maturity requires an evidence summary');
  end if;
  if nullif(p_assessment->>'context_id','') is not null and not exists(
    select 1 from risk_context_nodes where id=(p_assessment->>'context_id')::uuid
      and organization_id=v_org
  ) then return jsonb_build_object('error','context not found in this organization'); end if;
  insert into risk_maturity_assessments (
    organization_id,context_id,principle_scores,framework_scores,process_scores,
    maturity_level,gaps,roadmap,evidence_summary,assessed_by,next_review
  ) values (
    v_org,nullif(p_assessment->>'context_id','')::uuid,
    coalesce(p_assessment->'principle_scores','{}'::jsonb),
    coalesce(p_assessment->'framework_scores','{}'::jsonb),
    coalesce(p_assessment->'process_scores','{}'::jsonb),v_level,
    coalesce(p_assessment->'gaps','[]'::jsonb),coalesce(p_assessment->'roadmap','[]'::jsonb),
    btrim(p_assessment->>'evidence_summary'),auth.uid(),nullif(p_assessment->>'next_review','')::date
  ) returning id into v_id;
  insert into audit_events (organization_id,entity_type,actor,event_data)
  values (v_org,'risk_maturity_assessment',v_role,
    jsonb_build_object('assessment_id',v_id,'maturity_level',v_level));
  return jsonb_build_object('assessment_id',v_id,'maturity_level',v_level,
    'claim','implementation maturity assessment, not certification');
end;
$$;
grant execute on function public.record_risk_maturity_assessment(jsonb) to authenticated, service_role;

create or replace function public.record_risk_framework_review(p_review jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_id uuid;
begin
  select role into v_role from user_profiles where id=auth.uid();
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden');
  end if;
  if coalesce(p_review->>'trigger_type','') not in
    ('scheduled','regulation_change','organizational_restructure','acquisition','new_technology',
     'new_asset_type','weather_change','supply_chain_deterioration','workforce_loss',
     'major_incident','new_operating_regime') then
    return jsonb_build_object('error','invalid framework adaptation trigger');
  end if;
  if coalesce(length(btrim(p_review->>'trigger_detail')),0)<10 then
    return jsonb_build_object('error','describe the context change');
  end if;
  if nullif(p_review->>'context_id','') is not null and not exists(
    select 1 from risk_context_nodes where id=(p_review->>'context_id')::uuid
      and organization_id=v_org
  ) then return jsonb_build_object('error','context not found in this organization'); end if;
  if nullif(p_review->>'owner_id','') is not null and not exists(
    select 1 from user_profiles where id=(p_review->>'owner_id')::uuid
      and organization_id=v_org
  ) then return jsonb_build_object('error','owner not found in this organization'); end if;
  insert into risk_framework_reviews (
    organization_id,context_id,trigger_type,trigger_detail,material,
    criteria_review_required,findings,actions,owner_id,due_date
  ) values (
    v_org,nullif(p_review->>'context_id','')::uuid,p_review->>'trigger_type',
    btrim(p_review->>'trigger_detail'),coalesce((p_review->>'material')::boolean,false),
    coalesce((p_review->>'material')::boolean,false),coalesce(p_review->'findings','[]'::jsonb),
    coalesce(p_review->'actions','[]'::jsonb),nullif(p_review->>'owner_id','')::uuid,
    nullif(p_review->>'due_date','')::date
  ) returning id into v_id;
  insert into audit_events (organization_id,entity_type,actor,event_data)
  values (v_org,'risk_framework_review',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('review_id',v_id,'trigger_type',p_review->>'trigger_type',
      'material',coalesce((p_review->>'material')::boolean,false)));
  return jsonb_build_object('review_id',v_id,
    'criteria_review_required',coalesce((p_review->>'material')::boolean,false));
end;
$$;
grant execute on function public.record_risk_framework_review(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Aggregate exposure: combinations, sequences, common dependencies and the
-- organization's adopted capacity. Individual green rows cannot hide a red
-- portfolio state.
-- ---------------------------------------------------------------------------
create or replace function public.get_aggregate_risk_exposure(p_context_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_individual numeric;
  v_count int;
  v_connections int;
  v_common int;
  v_capacity numeric;
  v_committed numeric;
  v_combined numeric;
  v_dependencies jsonb;
begin
  select coalesce(sum(current_risk_score),0),count(*)
  into v_individual,v_count
  from risks
  where organization_id=v_org and status not in ('closed','archived')
    and (p_context_id is null or context_id=p_context_id);
  select count(*),count(*) filter (where relationship='common_dependency')
  into v_connections,v_common
  from risk_links l
  where l.organization_id=v_org
    and exists (select 1 from risks r where r.id=l.source_risk_id
      and (p_context_id is null or r.context_id=p_context_id));
  select coalesce((risk_capacity->>'capacity_limit')::numeric,100),
         coalesce((risk_capacity->>'current_committed_capacity')::numeric,0)
  into v_capacity,v_committed
  from risk_criteria_profiles
  where organization_id=v_org and status='adopted'
    and (p_context_id is null or context_id=p_context_id)
  order by version desc limit 1;
  v_capacity := coalesce(v_capacity,100);
  v_committed := coalesce(v_committed,0);
  v_combined := v_individual + greatest(v_count-1,0)*5 + v_connections*3 + v_common*7 + v_committed;
  select coalesce(jsonb_agg(jsonb_build_object(
    'dependency_key',dependency_key,'risks',risk_count) order by risk_count desc),'[]'::jsonb)
  into v_dependencies
  from (
    select dependency_key,count(distinct source_risk_id)+count(distinct target_risk_id) risk_count
    from risk_links where organization_id=v_org and relationship='common_dependency'
      and dependency_key is not null group by dependency_key having count(*)>0
  ) q;
  return jsonb_build_object(
    'individual_exposure',round(v_individual,1),
    'combined_exposure',round(v_combined,1),
    'open_risks',v_count,'connections',v_connections,
    'common_dependencies',v_dependencies,'capacity_limit',v_capacity,
    'committed_capacity',v_committed,'capacity_remaining',round(v_capacity-v_combined,1),
    'within_capacity',v_combined<=v_capacity,
    'basis','Combined exposure includes individual scores, concurrency, recorded links/common dependencies and adopted capacity. Scores are not treated as independent.');
end;
$$;
grant execute on function public.get_aggregate_risk_exposure(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Framework effectiveness metrics. Null denominators stay null: absence of
-- activity is not silently converted into 100% effectiveness.
-- ---------------------------------------------------------------------------
create or replace function public.get_risk_management_effectiveness()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_realized int;
  v_overdue int;
  v_control_failures int;
  v_overdue_reviews int;
  v_overturned int;
  v_accept_exceeded int;
  v_verified int;
  v_verified_effective int;
  v_decisions int;
  v_decisions_with_risk int;
  v_emerging int;
  v_cycle numeric;
  v_index numeric;
begin
  select count(*) filter (where event_type='risk_realized'),
         count(*) filter (where event_type in ('risk_treatment_failed','risk_treatment_inconclusive')),
         count(*) filter (where event_type='emerging_risk_detected')
  into v_realized,v_overturned,v_emerging
  from learning_events where organization_id=v_org and risk_id is not null;
  select count(*) into v_overdue from recommendations
  where organization_id=v_org and risk_id is not null
    and required_completion_date<current_date
    and status not in ('completed','rejected','dismissed');
  select count(*) into v_control_failures from risk_control_tests
  where organization_id=v_org and (result='failed' or failures_despite_control>0);
  select count(*) into v_overdue_reviews from risks
  where organization_id=v_org and review_date<current_date and status not in ('closed','archived');
  select count(*) into v_accept_exceeded
  from risk_acceptances a join risks r on r.id=a.subject_id
  where a.organization_id=v_org and a.subject_type='risk' and a.status='active'
    and a.expires_at>now() and risk_rank(r.current_risk_level)>risk_rank(a.risk_level);
  select count(*),count(*) filter (where v.result='achieved')
  into v_verified,v_verified_effective
  from verification_obligations v join recommendations r on r.id=v.recommendation_id
  where v.organization_id=v_org and r.risk_id is not null and v.status='completed';
  select count(*),count(*) filter (where risk_id is not null),
         avg(extract(epoch from (d.created_at-r.created_at))/3600.0) filter (where d.risk_id is not null)
  into v_decisions,v_decisions_with_risk,v_cycle
  from decisions d left join risks r on r.id=d.risk_id
  where d.organization_id=v_org;

  -- The index uses only measurable positive rates. If there is no evidence to
  -- form a denominator it remains null rather than reading as perfect.
  if v_verified>0 and v_decisions>0 then
    v_index := greatest(0,least(100,
      50.0*v_verified_effective/v_verified +
      50.0*v_decisions_with_risk/v_decisions -
      least(30,v_realized*5+v_control_failures*3+v_accept_exceeded*10)));
  else v_index := null;
  end if;
  return jsonb_build_object(
    'effectiveness_index',round(v_index,1),
    'risks_realized_despite_controls',v_realized,
    'overdue_treatments',v_overdue,
    'repeated_control_failures',v_control_failures,
    'overdue_risk_reviews',v_overdue_reviews,
    'decisions_overturned_or_treatments_failed',v_overturned,
    'accepted_risks_above_acceptance',v_accept_exceeded,
    'treatments_verified',v_verified,
    'treatments_verified_effective',v_verified_effective,
    'significant_decisions_total',v_decisions,
    'significant_decisions_with_risk_assessment',v_decisions_with_risk,
    'emerging_risks_detected',v_emerging,
    'average_decision_cycle_hours',round(v_cycle,1),
    'basis',case when v_index is null then
      'Insufficient verified outcomes and decisions to calculate an effectiveness index.'
      else 'Index combines verified treatment effectiveness and risk-supported decisions, penalized by realized risk, control failure and exceeded acceptance.' end);
end;
$$;
grant execute on function public.get_risk_management_effectiveness() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audience-specific reporting. Same underlying object, minimum information for
-- the decision level. Oversight can inspect but never execute operational work.
-- ---------------------------------------------------------------------------
create or replace function public.get_risk_audience_view(p_risk_id uuid, p_audience text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  r risks%rowtype;
  v_actions jsonb;
  v_controls jsonb;
  v_evidence jsonb;
  v_acceptance jsonb;
begin
  select role into v_role from user_profiles where id=auth.uid();
  select * into r from risks where id=p_risk_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','risk not found'); end if;
  if p_audience not in ('technician','supervisor','manager','executive','board','oversight') then
    return jsonb_build_object('error','invalid audience');
  end if;
  if p_audience in ('board','oversight') and v_role not in ('admin','ai_admin','executive') then
    return jsonb_build_object('error','board and oversight views require executive or administrator access');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'title',w.title,'status',w.status,
    'assignee',w.assignee,'scheduled_date',w.scheduled_date) order by w.created_at),'[]'::jsonb)
  into v_actions from work_orders w where w.risk_id=r.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'owner',u.full_name,
    'effectiveness',c.effectiveness_rating,'trend',c.trend,'next_test_due',c.next_test_due)),'[]'::jsonb)
  into v_controls from risk_control_links l join risk_controls c on c.id=l.control_id
  left join user_profiles u on u.id=c.control_owner_id where l.risk_id=r.id;
  select jsonb_build_object('count',count(*),'average_quality',mode() within group(order by data_quality),
    'latest',max(ts)) into v_evidence from evidence_items where risk_id=r.id;
  select jsonb_build_object('risk_level',risk_level,'accepted_role',accepted_role,
    'expires_at',expires_at,'review_at',review_at,'reassessment_trigger',reassessment_trigger)
  into v_acceptance from risk_acceptances where organization_id=v_org
    and subject_type='risk' and subject_id=r.id and status='active' and expires_at>now()
  order by accepted_at desc limit 1;

  if p_audience='technician' then
    return jsonb_build_object('audience',p_audience,'primary_question',
      'What do I need to do and what evidence must I record?','risk_id',r.id,
      'objective',r.objective_at_risk,'actions',v_actions,'escalation_threshold',r.escalation_threshold,
      'reporting_profile',r.reporting_profile,'information_sensitivity',r.information_sensitivity,
      'can_execute',true);
  elsif p_audience in ('board','oversight') then
    return jsonb_build_object('audience',p_audience,'primary_question',
      case when p_audience='board' then 'Is enterprise risk within acceptable bounds?'
      else 'Is management identifying, treating, accepting and reporting risk appropriately?' end,
      'risk_id',r.id,'objective',r.objective_at_risk,'current_risk_level',r.current_risk_level,
      'residual_risk_level',r.residual_risk_level,'control_assurance',v_controls,
      'evidence_position',v_evidence,'acceptance',v_acceptance,
      'reporting_profile',r.reporting_profile,'information_sensitivity',r.information_sensitivity,
      'can_execute',false);
  else
    return jsonb_build_object('audience',p_audience,'primary_question',
      case when p_audience='supervisor' then 'What threatens safe execution on this shift?'
        when p_audience='manager' then 'Which decision, owner or resource is required?'
        else 'Which objective is exposed and what trade-off needs authority?' end,
      'risk_id',r.id,'objective',r.objective_at_risk,'event',r.event_description,
      'current_risk_level',r.current_risk_level,'decision_action',r.decision_action,
      'actions',v_actions,'controls',v_controls,'evidence_position',v_evidence,
      'acceptance',v_acceptance,'reporting_profile',r.reporting_profile,
      'information_sensitivity',r.information_sensitivity,'can_execute',true);
  end if;
end;
$$;
grant execute on function public.get_risk_audience_view(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Leadership cockpit: live risks, velocity, controls, treatments, acceptance,
-- objective/site exposure, maturity, context changes and framework effectiveness.
-- ---------------------------------------------------------------------------
create or replace function public.get_risk_operating_cockpit()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_risks jsonb;
  v_contexts jsonb;
  v_criteria jsonb;
  v_maturity jsonb;
  v_reviews jsonb;
  v_aggregate jsonb;
  v_effectiveness jsonb;
  v_breakdown jsonb;
  v_authority jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'title',r.title,'kind',r.kind,'objective',r.objective_at_risk,
    'risk_source',r.risk_source,'event',r.event_description,'causes',r.causes,
    'consequences',r.consequences,'likelihood',r.likelihood,
    'analysis_level',r.analysis_level,'analysis_method',r.analysis_method,
    'control_effectiveness',r.control_effectiveness,'uncertainty',r.uncertainty,
    'confidence',r.confidence,'complexity',r.complexity,'connectivity',r.connectivity,
    'exposure',r.exposure,'capacity_load',r.capacity_load,'velocity',r.risk_velocity,
    'time_to_unacceptable',r.time_to_unacceptable,
    'inherent_risk_score',r.inherent_risk_score,'current_risk_score',r.current_risk_score,
    'residual_risk_score',r.residual_risk_score,'target_risk_score',r.target_risk_score,
    'current_risk_level',r.current_risk_level,'residual_risk_level',r.residual_risk_level,
    'target_risk_level',r.target_risk_level,'opportunity_score',r.opportunity_score,
    'value_at_risk',r.value_at_risk,'value_currency',r.value_currency,
    'decision_action',r.decision_action,'status',r.status,'review_date',r.review_date,
    'escalation_threshold',r.escalation_threshold,'data_quality',r.data_quality,
    'assumptions',r.assumptions,'biases',r.biases,
    'bias_review_complete',r.bias_review_complete,
    'method_limitations',r.method_limitations,
    'value_of_information',r.value_of_information,
    'reporting_profile',r.reporting_profile
    ) || jsonb_build_object(
    'context',jsonb_build_object('id',c.id,'name',c.name,'kind',c.scope_kind),
    'site',case when s.id is null then null else jsonb_build_object('id',s.id,'name',s.name) end,
    'asset',case when a.id is null then null else jsonb_build_object('id',a.id,'name',a.name,'tag',a.tag) end,
    'risk_owner',case when ro.id is null then null else jsonb_build_object('id',ro.id,'name',ro.full_name,'role',ro.role) end,
    'decision_owner',case when dco.id is null then null else jsonb_build_object('id',dco.id,'name',dco.full_name,'role',dco.role) end,
    'evidence',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'source',e.source_system,
      'type',e.signal_kind,'description',e.description,'quality',e.data_quality,'observed_at',e.ts)
      order by e.ts desc),'[]'::jsonb) from evidence_items e where e.risk_id=r.id),
    'controls',(select coalesce(jsonb_agg(jsonb_build_object('id',ct.id,'name',ct.name,
      'type',ct.control_type,'owner',cu.full_name,'effectiveness',ct.effectiveness_rating,
      'score',ct.effectiveness_score,'trend',ct.trend,'next_test_due',ct.next_test_due)),'[]'::jsonb)
      from risk_control_links cl join risk_controls ct on ct.id=cl.control_id
      left join user_profiles cu on cu.id=ct.control_owner_id where cl.risk_id=r.id),
    'indicators',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,
      'source',i.source_system,'unit',i.unit,'value',i.current_value,'state',i.current_state,
      'observed_at',i.observed_at,'thresholds',i.thresholds)),'[]'::jsonb)
      from risk_indicators i where i.risk_id=r.id and i.active),
    'stakeholder_views',(select coalesce(jsonb_agg(jsonb_build_object('id',sv.id,
      'stakeholder',sv.stakeholder_name,'role',sv.stakeholder_role,'kind',sv.view_kind,
      'likelihood',sv.perceived_likelihood,'consequence',sv.perceived_consequence,
      'concern',sv.concern_level,'rationale',sv.rationale,'status',sv.status)
      order by sv.recorded_at),'[]'::jsonb) from risk_stakeholder_views sv where sv.risk_id=r.id),
    'treatments',(select coalesce(jsonb_agg(jsonb_build_object('id',sc.id,'label',sc.label,
      'strategy',sc.treatment_strategy,'cost',sc.cost,'downtime',sc.downtime_impact,
      'residual_risk',sc.expected_residual_risk,'introduced_risks',sc.introduced_risks,
      'net_risk_change',sc.expected_risk_reduction,'confidence',sc.confidence,
      'asset_life_impact',sc.asset_life_impact,
      'objective_tradeoffs',sc.objective_tradeoffs,
      'executable',sc.executable,'readiness_gaps',sc.readiness_gaps,'selected',sc.recommended)
      order by sc.recommended desc,sc.expected_risk_reduction desc),'[]'::jsonb)
      from scenarios sc where sc.risk_id=r.id),
    'acceptance',(select jsonb_build_object('id',ra.id,'level',ra.risk_level,
      'accepted_role',ra.accepted_role,'expires_at',ra.expires_at,'review_at',ra.review_at,
      'reassessment_trigger',ra.reassessment_trigger) from risk_acceptances ra
      where ra.organization_id=v_org and ra.subject_type='risk' and ra.subject_id=r.id
        and ra.status='active' and ra.expires_at>now() order by ra.accepted_at desc limit 1)
    ,'pending_decisions',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',d.id,'action',d.risk_decision_action,'rationale',d.rationale,
      'created_at',d.created_at,'approval_id',ap.id,'required_role',ap.owner_role,
      'status',ap.status) order by d.created_at desc),'[]'::jsonb)
      from decisions d left join approvals ap on ap.decision_id=d.id
      where d.risk_id=r.id and d.approval_status='pending')
    ,'links',(select coalesce(jsonb_agg(jsonb_build_object('id',rl.id,
      'direction',case when rl.source_risk_id=r.id then 'outbound' else 'inbound' end,
      'related_risk_id',case when rl.source_risk_id=r.id then rl.target_risk_id else rl.source_risk_id end,
      'relationship',rl.relationship,'dependency_key',rl.dependency_key,
      'strength',rl.strength,'rationale',rl.rationale)),'[]'::jsonb)
      from risk_links rl where rl.source_risk_id=r.id or rl.target_risk_id=r.id)
  ) order by r.current_risk_score desc nulls last,r.created_at desc),'[]'::jsonb)
  into v_risks
  from risks r
  left join risk_context_nodes c on c.id=r.context_id
  left join sites s on s.id=r.site_id
  left join assets a on a.id=r.asset_id
  left join user_profiles ro on ro.id=r.risk_owner_id
  left join user_profiles dco on dco.id=r.decision_owner_id
  where r.organization_id=v_org and r.status<>'archived';

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'parent_id',parent_id,'kind',scope_kind,
    'name',name,'mission',mission_or_service,'objectives',objectives,'stakeholders',stakeholders,
    'regulations',regulations,'financial_constraints',financial_constraints,
    'safety_requirements',safety_requirements,
    'environmental_obligations',environmental_obligations,
    'operating_limits',operating_limits,'policies',policies,
    'dependencies',dependencies,'authority',decision_authority,
    'status',status,'review_date',review_date) order by scope_kind,name),'[]'::jsonb)
  into v_contexts from risk_context_nodes where organization_id=v_org and status<>'superseded';
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'context_id',context_id,'name',name,
    'industry_code',industry_code,'jurisdiction',jurisdiction,'version',version,'status',status,
    'dimensions',consequence_dimensions,'likelihood_scale',likelihood_scale,
    'thresholds',thresholds,'decision_thresholds',decision_thresholds,'capacity',risk_capacity,
    'basis',basis,'review_date',review_date) order by status,version desc),'[]'::jsonb)
  into v_criteria from risk_criteria_profiles where organization_id=v_org and status<>'superseded';
  select jsonb_build_object('id',id,'level',maturity_level,'principles',principle_scores,
    'framework',framework_scores,'process',process_scores,'gaps',gaps,'roadmap',roadmap,
    'evidence_summary',evidence_summary,'assessed_at',assessed_at,'next_review',next_review)
  into v_maturity from risk_maturity_assessments where organization_id=v_org
  order by assessed_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'trigger_type',trigger_type,
    'detail',trigger_detail,'material',material,'criteria_review_required',criteria_review_required,
    'framework_suitable',framework_suitable,'framework_effective',framework_effective,
    'findings',findings,'actions',actions,'status',status,'due_date',due_date)
    order by created_at desc),'[]'::jsonb)
  into v_reviews from risk_framework_reviews where organization_id=v_org and status<>'closed';
  v_aggregate := public.get_aggregate_risk_exposure(null);
  v_effectiveness := public.get_risk_management_effectiveness();
  select jsonb_build_object(
    'value_at_risk_by_currency',(select coalesce(jsonb_agg(to_jsonb(q)
      order by q.value_at_risk desc),'[]'::jsonb) from (
        select value_currency currency,coalesce(sum(value_at_risk),0) value_at_risk
        from risks where organization_id=v_org and status not in ('closed','archived')
          and value_at_risk is not null
        group by value_currency
      ) q),
    'risk_reduction_achieved',coalesce(sum(greatest(coalesce(inherent_risk_score,current_risk_score,0)-
      coalesce(residual_risk_score,current_risk_score,0),0)),0),
    'accepted_risks',(select count(*) from risk_acceptances ra where ra.organization_id=v_org
      and ra.subject_type='risk' and ra.status='active' and ra.expires_at>now()),
    'by_site',(select coalesce(jsonb_agg(to_jsonb(q) order by q.exposure desc),'[]'::jsonb)
      from (select coalesce(s.name,'Enterprise / unassigned') site,
        count(*) risks,round(coalesce(sum(r2.current_risk_score),0),1) exposure
        from risks r2 left join sites s on s.id=r2.site_id
        where r2.organization_id=v_org and r2.status not in ('closed','archived')
        group by coalesce(s.name,'Enterprise / unassigned')) q),
    'by_objective',(select coalesce(jsonb_agg(to_jsonb(q) order by q.exposure desc),'[]'::jsonb)
      from (select objective_at_risk objective,count(*) risks,
        round(coalesce(sum(current_risk_score),0),1) exposure
        from risks where organization_id=v_org and status not in ('closed','archived')
        group by objective_at_risk) q)
  ) into v_breakdown from risks where organization_id=v_org and status<>'archived';
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'role',role_key,
    'tier',tier_label,'max_risk_level',max_risk_level,'max_exposure',max_exposure,
    'risk_kinds',risk_kinds,'required_competencies',required_competency_keys,
    'escalates_to_role',escalates_to_role,'status',status,'version',version,'basis',basis)
    order by status,role_key,version desc),'[]'::jsonb)
  into v_authority from authority_limits where organization_id=v_org and status<>'superseded';
  return jsonb_build_object('generated_at',now(),'risks',v_risks,'contexts',v_contexts,
    'criteria',v_criteria,'maturity',v_maturity,'framework_reviews',v_reviews,
    'aggregate',v_aggregate,'effectiveness',v_effectiveness,
    'portfolio_breakdown',v_breakdown,'authority_profiles',v_authority,
    'positioning','Risk-informed operating system aligned to ISO 31000 principles, framework and process; not a certification claim.');
end;
$$;
grant execute on function public.get_risk_operating_cockpit() to authenticated, service_role;

-- PostgreSQL grants function execution to PUBLIC by default. Keep these
-- tenant-scoped contracts callable only by authenticated users (and the
-- service role, which bypasses ordinary grants by deployment policy).
revoke execute on function public.upsert_risk_context(jsonb) from public, anon;
revoke execute on function public.adopt_risk_context(uuid,text) from public, anon;
revoke execute on function public.update_risk_criteria_draft(uuid,jsonb) from public, anon;
revoke execute on function public.adopt_risk_criteria(uuid,text) from public, anon;
revoke execute on function public.create_risk_criteria_version(uuid,text) from public, anon;
revoke execute on function public.configure_risk_authority_requirements(uuid,jsonb) from public, anon;
revoke execute on function public.start_iso31000_implementation(jsonb) from public, anon;
revoke execute on function public.create_risk_assessment(jsonb) from public, anon;
revoke execute on function public.record_risk_analysis(uuid,jsonb) from public, anon;
revoke execute on function public.ingest_risk_evidence(uuid,jsonb) from public, anon;
revoke execute on function public.record_risk_value_of_information(uuid,jsonb) from public, anon;
revoke execute on function public.configure_risk_control(uuid,jsonb) from public, anon;
revoke execute on function public.configure_risk_indicator(uuid,jsonb) from public, anon;
revoke execute on function public.link_risks(uuid,uuid,text,text,numeric,text) from public, anon;
revoke execute on function public.record_stakeholder_view(uuid,jsonb) from public, anon;
revoke execute on function public.record_risk_indicator_observation(uuid,numeric,timestamptz,text,text) from public, anon;
revoke execute on function public.record_risk_control_test(uuid,jsonb) from public, anon;
revoke execute on function public.create_risk_treatment(uuid,jsonb,boolean) from public, anon;
revoke execute on function public.record_risk_decision(uuid,text,text,numeric,text,date,text) from public, anon;
revoke execute on function public.decide_risk_decision(uuid,boolean,text) from public, anon;
revoke execute on function public.accept_risk(text,uuid,text,text,text,timestamptz,text) from public, anon;
revoke execute on function public.record_risk_outcome(uuid,jsonb) from public, anon;
revoke execute on function public.record_risk_maturity_assessment(jsonb) from public, anon;
revoke execute on function public.record_risk_framework_review(jsonb) from public, anon;
revoke execute on function public.get_aggregate_risk_exposure(uuid) from public, anon;
revoke execute on function public.get_risk_management_effectiveness() from public, anon;
revoke execute on function public.get_risk_audience_view(uuid,text) from public, anon;
revoke execute on function public.get_risk_operating_cockpit() from public, anon;
revoke execute on function public.check_recommendation_contract(uuid) from public, anon;
revoke execute on function public.get_recommendation_contract_posture() from public, anon;
revoke execute on function public.risk_contract_gaps(public.risks) from public, anon, authenticated;
revoke execute on function public.enforce_risk_contract() from public, anon, authenticated;

notify pgrst, 'reload schema';
