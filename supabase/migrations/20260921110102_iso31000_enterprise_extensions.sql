-- ============================================================================
-- SyncAI ISO 31000 enterprise extensions
--
-- Closes the remaining architecture gaps without duplicating SyncAI's
-- canonical evidence, scenario, recommendation, approval, decision, work,
-- verification, learning, authority or audit contracts.
-- ============================================================================

-- First-class objectives retain hierarchy, ownership and measurable intent.
create table if not exists risk_objectives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  supersedes_id uuid references risk_objectives(id) on delete restrict,
  parent_id uuid references risk_objectives(id) on delete restrict,
  context_id uuid references risk_context_nodes(id) on delete set null,
  owner_id uuid references user_profiles(id) on delete set null,
  objective_level text not null check (objective_level in
    ('enterprise','business_unit','site','system','asset','project','task')),
  description text not null,
  target text not null,
  measurement text not null,
  timeframe text not null,
  tolerance text not null,
  status text not null default 'draft' check (status in ('draft','adopted','superseded','retired')),
  version int not null default 1 check (version > 0),
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  review_date date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_risk_objectives_hierarchy
  on risk_objectives(organization_id,parent_id,objective_level,status);

-- Internal and external stakeholder directory. Views remain append-only in
-- risk_stakeholder_views; this table stores enduring consultation needs.
create table if not exists risk_stakeholders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  context_id uuid references risk_context_nodes(id) on delete set null,
  user_id uuid references user_profiles(id) on delete set null,
  stakeholder_type text not null check (stakeholder_type in ('internal','external')),
  name text not null,
  external_organization text,
  role_or_relationship text not null,
  interests jsonb not null default '[]'::jsonb,
  expectations jsonb not null default '[]'::jsonb,
  influence text check (influence is null or influence in ('low','medium','high','critical')),
  communication_requirements jsonb not null default '{}'::jsonb,
  maximum_information_sensitivity text not null default 'internal' check
    (maximum_information_sensitivity in ('public','internal','confidential','restricted')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(interests)='array'),
  check (jsonb_typeof(expectations)='array'),
  check (jsonb_typeof(communication_requirements)='object')
);

-- Obligations are distinct from risk: law, regulation, standards, contracts,
-- OEM requirements, policy and voluntary commitments constrain decisions.
create table if not exists risk_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  supersedes_id uuid references risk_obligations(id) on delete restrict,
  context_id uuid references risk_context_nodes(id) on delete set null,
  source_type text not null check (source_type in
    ('law','regulation','company_standard','engineering_standard','contract',
     'oem_requirement','policy','voluntary_commitment')),
  source_reference text not null,
  jurisdiction text,
  applicable_scope text not null,
  responsible_role text not null,
  requirement text not null,
  effective_date date,
  expiry_date date,
  status text not null default 'draft' check (status in ('draft','adopted','superseded','expired')),
  version int not null default 1 check (version > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expiry_date is null or effective_date is null or expiry_date > effective_date)
);
create table if not exists risk_obligation_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  risk_id uuid not null references risks(id) on delete cascade,
  obligation_id uuid not null references risk_obligations(id) on delete cascade,
  applicability text not null,
  created_at timestamptz not null default now(),
  unique(risk_id,obligation_id)
);

-- Machine-readable identification and analysis records. The summary fields on
-- risks remain useful projections; these records preserve source/consequence
-- identity and likelihood method lineage.
create table if not exists risk_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  risk_id uuid not null references risks(id) on delete cascade,
  description text not null,
  source_type text not null,
  controllability text not null check (controllability in ('controllable','influenceable','external','unknown')),
  related_asset_ids jsonb not null default '[]'::jsonb,
  related_processes jsonb not null default '[]'::jsonb,
  evidence_item_id uuid references evidence_items(id) on delete set null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(related_asset_ids)='array'),
  check (jsonb_typeof(related_processes)='array')
);
create table if not exists risk_consequences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  risk_id uuid not null references risks(id) on delete cascade,
  dimension text not null check (dimension in
    ('safety','environment','production','financial','regulatory','asset_integrity',
     'reputation','customer','cybersecurity')),
  description text not null,
  magnitude numeric,
  time_horizon text,
  effect_type text not null check (effect_type in ('direct','indirect','cascading')),
  affected_objective_ids jsonb not null default '[]'::jsonb,
  evidence_item_id uuid references evidence_items(id) on delete set null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(affected_objective_ids)='array')
);

create table if not exists risk_assumptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  risk_id uuid not null references risks(id) on delete cascade,
  statement text not null,
  owner_id uuid not null references user_profiles(id) on delete restrict,
  confidence numeric not null check (confidence between 0 and 100),
  valid_from date not null default current_date,
  valid_until date,
  trigger_for_review text not null,
  status text not null default 'active' check
    (status in ('active','invalidated','expired','superseded')),
  invalidated_by uuid references auth.users(id),
  invalidated_at timestamptz,
  invalidation_reason text,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);
create table if not exists risk_assumption_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  assumption_id uuid not null references risk_assumptions(id) on delete cascade,
  subject_type text not null check (subject_type in
    ('risk','decision','scenario','control','objective','work_order')),
  subject_id uuid not null,
  created_at timestamptz not null default now(),
  unique(assumption_id,subject_type,subject_id)
);

create table if not exists risk_likelihood_estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  risk_id uuid not null references risks(id) on delete cascade,
  method text not null check (method in
    ('expert_judgement','frequency','probability','weibull','monte_carlo','bayesian',
     'historical_analogue','condition_model','event_tree')),
  estimate numeric not null check (estimate >= 0),
  interval_lower numeric,
  interval_upper numeric,
  data_source text not null,
  sample_size int check (sample_size is null or sample_size >= 0),
  model_reference text,
  confidence numeric not null check (confidence between 0 and 100),
  evidence_item_id uuid references evidence_items(id) on delete set null,
  assumptions jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (interval_lower is null or interval_upper is null or interval_lower <= interval_upper),
  check (jsonb_typeof(assumptions)='array')
);

-- Validated event scenarios form a reusable library; stress tests retain the
-- exact set, correlations and adopted capacity used at decision time.
create table if not exists risk_event_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  context_id uuid references risk_context_nodes(id) on delete set null,
  risk_id uuid references risks(id) on delete cascade,
  name text not null,
  is_template boolean not null default false,
  initiating_event text not null,
  causes jsonb not null default '[]'::jsonb,
  conditions jsonb not null default '[]'::jsonb,
  dependencies jsonb not null default '[]'::jsonb,
  escalation_paths jsonb not null default '[]'::jsonb,
  possible_consequences jsonb not null default '[]'::jsonb,
  evidence_basis text not null,
  status text not null default 'draft' check (status in ('draft','validated','retired')),
  validated_by uuid references auth.users(id),
  validated_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(causes)='array'),
  check (jsonb_typeof(conditions)='array'),
  check (jsonb_typeof(dependencies)='array'),
  check (jsonb_typeof(escalation_paths)='array'),
  check (jsonb_typeof(possible_consequences)='array')
);
create table if not exists risk_stress_tests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  context_id uuid references risk_context_nodes(id) on delete set null,
  objective_id uuid references risk_objectives(id) on delete set null,
  mode text not null check (mode in ('stress','reverse_stress')),
  name text not null,
  risk_ids jsonb not null,
  scenario_ids jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  correlations jsonb not null default '[]'::jsonb,
  capacity_limit numeric not null check (capacity_limit between 0 and 100),
  combined_exposure numeric not null check (combined_exposure between 0 and 100),
  threshold_breached boolean not null,
  reverse_stress_risk_ids jsonb not null default '[]'::jsonb,
  contributions jsonb not null default '[]'::jsonb,
  methodology text not null,
  status text not null default 'diagnostic' check (status in ('diagnostic','reviewed','adopted')),
  run_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(risk_ids)='array'),
  check (jsonb_typeof(scenario_ids)='array'),
  check (jsonb_typeof(assumptions)='array'),
  check (jsonb_typeof(correlations)='array'),
  check (jsonb_typeof(reverse_stress_risk_ids)='array'),
  check (jsonb_typeof(contributions)='array')
);

-- Treatment execution still uses canonical scenarios/recommendations/work;
-- only dependency edges and readiness metadata are added here.
create table if not exists risk_treatment_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  scenario_id uuid not null references scenarios(id) on delete cascade,
  depends_on_scenario_id uuid not null references scenarios(id) on delete cascade,
  dependency_type text not null check (dependency_type in
    ('finish_to_start','start_to_start','finish_to_finish','resource','approval','evidence')),
  lag_days numeric not null default 0 check (lag_days >= 0),
  critical boolean not null default false,
  rationale text not null,
  created_at timestamptz not null default now(),
  check (scenario_id <> depends_on_scenario_id),
  unique(scenario_id,depends_on_scenario_id,dependency_type)
);

create table if not exists risk_challenges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  risk_id uuid not null references risks(id) on delete cascade,
  subject_type text not null check (subject_type in
    ('risk_rating','assumption','control','treatment','decision','acceptance')),
  subject_id uuid,
  challenged_field text not null,
  rationale text not null,
  evidence_item_ids jsonb not null default '[]'::jsonb,
  requested_information text,
  status text not null default 'open' check (status in ('open','upheld','rejected','withdrawn')),
  challenged_by uuid not null references auth.users(id),
  resolved_by uuid references auth.users(id),
  resolution text,
  resolution_evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (jsonb_typeof(evidence_item_ids)='array'),
  check (jsonb_typeof(resolution_evidence)='array')
);

create table if not exists risk_assurance_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  risk_id uuid references risks(id) on delete cascade,
  subject_type text not null check (subject_type in ('risk','control','scenario','decision','acceptance')),
  subject_id uuid not null,
  assurance_level text not null check (assurance_level in ('line_1','line_2','independent')),
  subject_owner_id uuid references auth.users(id),
  reviewer_id uuid not null references auth.users(id),
  scope text not null,
  conclusion text check (conclusion is null or conclusion in
    ('acceptable','acceptable_with_actions','not_acceptable','inconclusive')),
  findings jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  evidence_item_ids jsonb not null default '[]'::jsonb,
  status text not null default 'planned' check (status in ('planned','in_progress','completed','superseded')),
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (assurance_level <> 'independent' or reviewer_id <> subject_owner_id),
  check (jsonb_typeof(findings)='array'),
  check (jsonb_typeof(actions)='array'),
  check (jsonb_typeof(evidence_item_ids)='array')
);

create table if not exists risk_communications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  risk_id uuid not null references risks(id) on delete cascade,
  stakeholder_id uuid references risk_stakeholders(id) on delete set null,
  audience text not null check (audience in
    ('technician','supervisor','manager','executive','board','oversight','external')),
  channel text not null,
  message text not null,
  decision_or_action text not null,
  accountable_owner text not null,
  sensitivity text not null check (sensitivity in ('public','internal','confidential','restricted')),
  cost numeric check (cost is null or cost >= 0),
  comprehension_status text not null default 'not_checked' check
    (comprehension_status in ('not_checked','confirmed','clarification_required')),
  feedback text,
  communicated_by uuid references auth.users(id),
  communicated_at timestamptz not null default now()
);

-- Learning remains canonical in learning_events. These records assess whether
-- a lesson applies elsewhere and require target review before adoption.
create table if not exists risk_learning_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  learning_event_id uuid not null references learning_events(id) on delete cascade,
  target_context_id uuid references risk_context_nodes(id) on delete set null,
  target_site_id uuid references sites(id) on delete set null,
  target_asset_class text,
  applicability text not null check (applicability in ('candidate','applicable','not_applicable','adaptation_required')),
  rationale text not null,
  adaptation_required text,
  evidence_item_ids jsonb not null default '[]'::jsonb,
  status text not null default 'proposed' check (status in ('proposed','reviewed','adopted','rejected')),
  proposed_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (target_context_id is not null or target_site_id is not null or target_asset_class is not null),
  check (jsonb_typeof(evidence_item_ids)='array')
);

-- Extend canonical contracts instead of creating competing lifecycle stores.
alter table risks
  add column if not exists objective_id uuid references risk_objectives(id) on delete set null,
  add column if not exists reassessment_required boolean not null default false,
  add column if not exists reassessment_reason text,
  add column if not exists context_changed_at timestamptz;
alter table risks drop constraint if exists risks_status_check;
alter table risks add constraint risks_status_check check (status in
  ('draft','discovered','validating','identified','analyzing','analyzed','evaluated',
   'decision_required','treatment_planned','treatment_active','monitoring','accepted',
   'context_changed','reassessment','closed','archived'));

alter table decisions
  add column if not exists reassessment_required boolean not null default false,
  add column if not exists reassessment_reason text,
  add column if not exists decision_value numeric,
  add column if not exists decision_currency text;

alter table scenarios
  add column if not exists sequence_no int,
  add column if not exists duration_days numeric,
  add column if not exists constraints jsonb not null default '[]'::jsonb,
  add column if not exists contingency text,
  add column if not exists monitoring_plan text,
  add column if not exists performance_measure text,
  add column if not exists funding_status text,
  add column if not exists parts_status text,
  add column if not exists time_window_ready boolean not null default false;

alter table learning_events
  add column if not exists outcome_attribution text,
  add column if not exists attribution_confidence numeric check
    (attribution_confidence is null or attribution_confidence between 0 and 100),
  add column if not exists context_effects jsonb not null default '[]'::jsonb,
  add column if not exists transfer_candidate boolean not null default false;

alter table authority_limits
  add column if not exists jurisdictions jsonb not null default '[]'::jsonb,
  add column if not exists asset_criticality_levels jsonb not null default '[]'::jsonb,
  add column if not exists max_decision_value numeric check
    (max_decision_value is null or max_decision_value >= 0),
  add column if not exists independent_assurance_above_level text check
    (independent_assurance_above_level is null or independent_assurance_above_level in
      ('Low','Medium','High','Critical'));

alter table risk_controls drop constraint if exists risk_controls_control_type_check;
alter table risk_controls add constraint risk_controls_control_type_check check (control_type in
  ('engineered','preventive','detective','procedural','administrative','mitigative',
   'recovery','compensating','governance'));
alter table risk_controls drop constraint if exists risk_controls_temporary_expiry;
alter table risk_controls drop constraint if exists risk_controls_dates;
alter table risk_controls
  add column if not exists lifecycle_kind text not null default 'permanent' check
    (lifecycle_kind in ('temporary','permanent','compensating')),
  add column if not exists criticality text not null default 'noncritical' check
    (criticality in ('noncritical','important','critical')),
  add column if not exists failure_modes jsonb not null default '[]'::jsonb,
  add column if not exists predecessor_control_id uuid references risk_controls(id) on delete set null,
  add column if not exists replaces_control_id uuid references risk_controls(id) on delete set null,
  add column if not exists effective_from date,
  add column if not exists expires_on date,
  add column if not exists sunset_action text,
  add constraint risk_controls_temporary_expiry check
    (lifecycle_kind <> 'temporary' or (expires_on is not null and coalesce(btrim(sunset_action),'')<>'')),
  add constraint risk_controls_dates check
    (expires_on is null or effective_from is null or expires_on > effective_from);

-- ---------------------------------------------------------------------------
-- Tenant isolation and sensitivity-aware reads
-- ---------------------------------------------------------------------------
create or replace function public.can_read_risk(p_risk_id uuid)
returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from risks r
    left join user_profiles me on me.id=auth.uid() and me.organization_id=r.organization_id
    where r.id=p_risk_id and r.organization_id=app_current_org() and (
      r.information_sensitivity in ('public','internal')
      or r.risk_owner_id=auth.uid() or r.decision_owner_id=auth.uid()
      or exists(select 1 from risk_stakeholder_views sv
        where sv.risk_id=r.id and sv.organization_id=r.organization_id
          and sv.stakeholder_user_id=auth.uid())
      or (r.information_sensitivity='confidential' and me.role in
        ('admin','ai_admin','executive','maintenance_manager','reliability_engineer'))
      or (r.information_sensitivity='restricted' and me.role in
        ('admin','ai_admin','executive'))
    )
  );
$$;
grant execute on function public.can_read_risk(uuid) to authenticated,service_role;

create or replace function public.can_read_risk_set(p_risk_ids jsonb)
returns boolean
language sql stable security definer set search_path=public as $$
  select jsonb_typeof(coalesce(p_risk_ids,'[]'::jsonb))='array' and not exists(
    select 1 from jsonb_array_elements_text(coalesce(p_risk_ids,'[]'::jsonb)) item
    where not can_read_risk(item.value::uuid)
  );
$$;
grant execute on function public.can_read_risk_set(jsonb) to authenticated,service_role;

create or replace function public.can_read_risk_subject(
  p_subject_type text,p_subject_id uuid,p_risk_id uuid default null
)
returns boolean
language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=app_current_org();
begin
  if p_risk_id is not null then return can_read_risk(p_risk_id); end if;
  if p_subject_type='risk' then return can_read_risk(p_subject_id); end if;
  if p_subject_type='control' then return exists(
    select 1 from risk_controls c where c.id=p_subject_id and c.organization_id=v_org and (
      not exists(select 1 from risk_control_links l where l.control_id=c.id)
      or exists(select 1 from risk_control_links l where l.control_id=c.id and can_read_risk(l.risk_id))));
  end if;
  if p_subject_type='scenario' then return exists(
    select 1 from scenarios s where s.id=p_subject_id and s.organization_id=v_org
      and (s.risk_id is null or can_read_risk(s.risk_id)));
  end if;
  if p_subject_type='decision' then return exists(
    select 1 from decisions d where d.id=p_subject_id and d.organization_id=v_org
      and (d.risk_id is null or can_read_risk(d.risk_id)));
  end if;
  if p_subject_type='acceptance' then return exists(
    select 1 from risk_acceptances a where a.id=p_subject_id and a.organization_id=v_org
      and (a.subject_type<>'risk' or can_read_risk(a.subject_id)));
  end if;
  return false;
end;
$$;
grant execute on function public.can_read_risk_subject(text,uuid,uuid) to authenticated,service_role;

drop policy if exists risks_org_read on risks;
drop policy if exists risks_sensitive_read on risks;
create policy risks_sensitive_read on risks
  for select to authenticated using (can_read_risk(id));

drop policy if exists risk_control_links_org_read on risk_control_links;
drop policy if exists risk_control_links_sensitive_read on risk_control_links;
create policy risk_control_links_sensitive_read on risk_control_links
  for select to authenticated using
    (organization_id=app_current_org() and can_read_risk(risk_id));
drop policy if exists risk_indicators_org_read on risk_indicators;
drop policy if exists risk_indicators_sensitive_read on risk_indicators;
create policy risk_indicators_sensitive_read on risk_indicators
  for select to authenticated using
    (organization_id=app_current_org() and can_read_risk(risk_id));
drop policy if exists risk_stakeholder_views_org_read on risk_stakeholder_views;
drop policy if exists risk_stakeholder_views_sensitive_read on risk_stakeholder_views;
create policy risk_stakeholder_views_sensitive_read on risk_stakeholder_views
  for select to authenticated using
    (organization_id=app_current_org() and can_read_risk(risk_id));
drop policy if exists risk_links_org_read on risk_links;
drop policy if exists risk_links_sensitive_read on risk_links;
create policy risk_links_sensitive_read on risk_links
  for select to authenticated using
    (organization_id=app_current_org() and
      can_read_risk(source_risk_id) and can_read_risk(target_risk_id));

alter table risk_objectives enable row level security;
drop policy if exists risk_objectives_org_read on risk_objectives;
create policy risk_objectives_org_read on risk_objectives
  for select to authenticated using (organization_id=app_current_org());
alter table risk_stakeholders enable row level security;
drop policy if exists risk_stakeholders_org_read on risk_stakeholders;
create policy risk_stakeholders_org_read on risk_stakeholders
  for select to authenticated using (organization_id=app_current_org());
alter table risk_obligations enable row level security;
drop policy if exists risk_obligations_org_read on risk_obligations;
create policy risk_obligations_org_read on risk_obligations
  for select to authenticated using (organization_id=app_current_org());
alter table risk_obligation_links enable row level security;
drop policy if exists risk_obligation_links_org_read on risk_obligation_links;
create policy risk_obligation_links_org_read on risk_obligation_links
  for select to authenticated using
    (organization_id=app_current_org() and can_read_risk(risk_id));
alter table risk_sources enable row level security;
drop policy if exists risk_sources_org_read on risk_sources;
create policy risk_sources_org_read on risk_sources
  for select to authenticated using
    (organization_id=app_current_org() and can_read_risk(risk_id));
alter table risk_consequences enable row level security;
drop policy if exists risk_consequences_org_read on risk_consequences;
create policy risk_consequences_org_read on risk_consequences
  for select to authenticated using
    (organization_id=app_current_org() and can_read_risk(risk_id));
alter table risk_assumptions enable row level security;
drop policy if exists risk_assumptions_org_read on risk_assumptions;
create policy risk_assumptions_org_read on risk_assumptions
  for select to authenticated using
    (organization_id=app_current_org() and can_read_risk(risk_id));
alter table risk_assumption_dependencies enable row level security;
drop policy if exists risk_assumption_dependencies_org_read on risk_assumption_dependencies;
create policy risk_assumption_dependencies_org_read on risk_assumption_dependencies
  for select to authenticated using (organization_id=app_current_org() and exists(
    select 1 from risk_assumptions a where a.id=assumption_id and can_read_risk(a.risk_id)));
alter table risk_likelihood_estimates enable row level security;
drop policy if exists risk_likelihood_estimates_org_read on risk_likelihood_estimates;
create policy risk_likelihood_estimates_org_read on risk_likelihood_estimates
  for select to authenticated using
    (organization_id=app_current_org() and can_read_risk(risk_id));
alter table risk_event_scenarios enable row level security;
drop policy if exists risk_event_scenarios_org_read on risk_event_scenarios;
create policy risk_event_scenarios_org_read on risk_event_scenarios
  for select to authenticated using
    (organization_id=app_current_org() and (risk_id is null or can_read_risk(risk_id)));
alter table risk_stress_tests enable row level security;
drop policy if exists risk_stress_tests_org_read on risk_stress_tests;
create policy risk_stress_tests_org_read on risk_stress_tests
  for select to authenticated using
    (organization_id=app_current_org() and can_read_risk_set(risk_ids));
alter table risk_treatment_dependencies enable row level security;
drop policy if exists risk_treatment_dependencies_org_read on risk_treatment_dependencies;
create policy risk_treatment_dependencies_org_read on risk_treatment_dependencies
  for select to authenticated using (organization_id=app_current_org() and
    exists(select 1 from scenarios s where s.id=scenario_id
      and (s.risk_id is null or can_read_risk(s.risk_id))) and
    exists(select 1 from scenarios s where s.id=depends_on_scenario_id
      and (s.risk_id is null or can_read_risk(s.risk_id))));
alter table risk_challenges enable row level security;
drop policy if exists risk_challenges_org_read on risk_challenges;
create policy risk_challenges_org_read on risk_challenges
  for select to authenticated using
    (organization_id=app_current_org() and can_read_risk(risk_id));
alter table risk_assurance_reviews enable row level security;
drop policy if exists risk_assurance_reviews_org_read on risk_assurance_reviews;
create policy risk_assurance_reviews_org_read on risk_assurance_reviews
  for select to authenticated using
    (organization_id=app_current_org() and can_read_risk_subject(subject_type,subject_id,risk_id));
alter table risk_communications enable row level security;
drop policy if exists risk_communications_org_read on risk_communications;
create policy risk_communications_org_read on risk_communications
  for select to authenticated using
    (organization_id=app_current_org() and can_read_risk(risk_id));
alter table risk_learning_transfers enable row level security;
drop policy if exists risk_learning_transfers_org_read on risk_learning_transfers;
create policy risk_learning_transfers_org_read on risk_learning_transfers
  for select to authenticated using (organization_id=app_current_org() and exists(
    select 1 from learning_events l where l.id=learning_event_id
      and (l.risk_id is null or can_read_risk(l.risk_id))));

-- ---------------------------------------------------------------------------
-- Controlled lifecycle, automatic reassessment propagation and expiry
-- ---------------------------------------------------------------------------
create or replace function public.mark_risk_reassessment(p_risk_id uuid,p_reason text)
returns void
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org();
begin
  if coalesce(length(btrim(p_reason)),0)<5 then
    raise exception 'reassessment reason is required';
  end if;
  update risks set reassessment_required=true,reassessment_reason=btrim(p_reason),
    context_changed_at=now(),
    status=case when status in ('closed','archived') then status else 'context_changed' end,
    decision_action=case when status in ('closed','archived') then decision_action else 'INVESTIGATE' end,
    updated_at=now()
  where id=p_risk_id and organization_id=v_org;
  update decisions set reassessment_required=true,reassessment_reason=btrim(p_reason)
  where risk_id=p_risk_id and organization_id=v_org and approval_status='approved';
end;
$$;
revoke execute on function public.mark_risk_reassessment(uuid,text) from public,anon,authenticated;

create or replace function public.propagate_risk_context_change()
returns trigger
language plpgsql security definer set search_path=public as $$
declare item record;
begin
  if old.status='adopted' and (
    old.mission_or_service is distinct from new.mission_or_service or
    old.objectives is distinct from new.objectives or
    old.regulations is distinct from new.regulations or
    old.operating_limits is distinct from new.operating_limits or
    old.dependencies is distinct from new.dependencies or
    old.decision_authority is distinct from new.decision_authority
  ) then
    for item in select id from risks where context_id=new.id and organization_id=new.organization_id loop
      perform mark_risk_reassessment(item.id,'Adopted context changed: '||new.name);
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_propagate_risk_context_change on risk_context_nodes;
create trigger trg_propagate_risk_context_change after update on risk_context_nodes
  for each row execute function public.propagate_risk_context_change();

create or replace function public.propagate_risk_objective_change()
returns trigger
language plpgsql security definer set search_path=public as $$
declare item record;
begin
  if old.status='adopted' and (
    old.description is distinct from new.description or old.target is distinct from new.target or
    old.measurement is distinct from new.measurement or old.tolerance is distinct from new.tolerance or
    old.timeframe is distinct from new.timeframe
  ) then
    for item in select id from risks where objective_id=new.id and organization_id=new.organization_id loop
      perform mark_risk_reassessment(item.id,'Adopted objective changed: '||new.description);
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_propagate_risk_objective_change on risk_objectives;
create trigger trg_propagate_risk_objective_change after update on risk_objectives
  for each row execute function public.propagate_risk_objective_change();

create or replace function public.propagate_risk_obligation_change()
returns trigger
language plpgsql security definer set search_path=public as $$
declare item record;
begin
  if old.status='adopted' and (
    old.requirement is distinct from new.requirement or old.status is distinct from new.status or
    old.expiry_date is distinct from new.expiry_date
  ) then
    for item in select risk_id id from risk_obligation_links
      where obligation_id=new.id and organization_id=new.organization_id loop
      perform mark_risk_reassessment(item.id,'Applicable obligation changed: '||new.source_reference);
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_propagate_risk_obligation_change on risk_obligations;
create trigger trg_propagate_risk_obligation_change after update on risk_obligations
  for each row execute function public.propagate_risk_obligation_change();

create or replace function public.refresh_risk_governance_state()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org();
  v_assumptions int:=0;
  v_controls int:=0;
  v_acceptances int:=0;
  assumption_item record;
  control_item record;
  risk_item record;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  for assumption_item in update risk_assumptions set status='expired'
    where organization_id=v_org and status='active' and valid_until<current_date
    returning risk_id,statement loop
    v_assumptions:=v_assumptions+1;
    perform mark_risk_reassessment(assumption_item.risk_id,'Assumption expired: '||assumption_item.statement);
  end loop;
  for control_item in update risk_controls set design_status='retired',updated_at=now()
    where organization_id=v_org and lifecycle_kind in ('temporary','compensating')
      and design_status='implemented' and expires_on<current_date
    returning id,name loop
    v_controls:=v_controls+1;
    for risk_item in select rcl.risk_id id from risk_control_links rcl
      where rcl.control_id=control_item.id and rcl.organization_id=v_org loop
      perform mark_risk_reassessment(risk_item.id,'Temporary control expired: '||control_item.name);
    end loop;
  end loop;
  update risk_acceptances set status='expired'
  where organization_id=v_org and status='active' and expires_at<now();
  get diagnostics v_acceptances=row_count;
  return jsonb_build_object('expired_assumptions',v_assumptions,
    'retired_temporary_controls',v_controls,'expired_acceptances',v_acceptances);
end;
$$;
grant execute on function public.refresh_risk_governance_state() to authenticated,service_role;

create or replace function public.transition_risk_lifecycle(
  p_risk_id uuid,p_next_status text,p_reason text
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org();
  v_role text;
  r risks%rowtype;
  v_allowed boolean:=false;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden');
  end if;
  select * into r from risks where id=p_risk_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  if coalesce(length(btrim(p_reason)),0)<10 then
    return jsonb_build_object('error','record the lifecycle transition basis');
  end if;
  v_allowed:=case r.status
    when 'draft' then p_next_status in ('discovered','validating','identified')
    when 'discovered' then p_next_status in ('validating','identified','draft')
    when 'validating' then p_next_status in ('identified','draft')
    when 'identified' then p_next_status in ('analyzing','analyzed')
    when 'analyzing' then p_next_status in ('analyzed','identified')
    when 'analyzed' then p_next_status in ('evaluated','reassessment')
    when 'evaluated' then p_next_status in ('decision_required','monitoring','treatment_planned')
    when 'decision_required' then p_next_status in ('treatment_planned','accepted','monitoring','analyzed')
    when 'treatment_planned' then p_next_status in ('treatment_active','decision_required')
    when 'treatment_active' then p_next_status in ('monitoring','reassessment')
    when 'monitoring' then p_next_status in ('accepted','closed','context_changed','reassessment')
    when 'accepted' then p_next_status in ('monitoring','closed','context_changed','reassessment')
    when 'context_changed' then p_next_status='reassessment'
    when 'reassessment' then p_next_status in ('identified','analyzing','analyzed')
    when 'closed' then p_next_status='reassessment'
    else false end;
  if p_next_status='archived' and v_role in ('admin','ai_admin') then v_allowed:=true; end if;
  if not v_allowed then return jsonb_build_object('error','invalid lifecycle transition',
    'current_status',r.status,'requested_status',p_next_status); end if;
  update risks set status=p_next_status,
    reassessment_required=case when p_next_status in ('identified','analyzing','analyzed') then false else reassessment_required end,
    reassessment_reason=case when p_next_status in ('identified','analyzing','analyzed') then null else reassessment_reason end,
    updated_at=now() where id=r.id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_lifecycle',v_role,jsonb_build_object('risk_id',r.id,
    'from',r.status,'to',p_next_status,'reason',btrim(p_reason)));
  return jsonb_build_object('risk_id',r.id,'previous_status',r.status,'status',p_next_status);
end;
$$;
grant execute on function public.transition_risk_lifecycle(uuid,text,text) to authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Objective, stakeholder, obligation and first-class analysis commands
-- ---------------------------------------------------------------------------
create or replace function public.upsert_risk_objective(p_objective jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org();
  v_role text;
  v_id uuid:=nullif(p_objective->>'id','')::uuid;
  v_owner uuid:=nullif(p_objective->>'owner_id','')::uuid;
  v_parent uuid:=nullif(p_objective->>'parent_id','')::uuid;
  v_context uuid:=nullif(p_objective->>'context_id','')::uuid;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden');
  end if;
  if coalesce(length(btrim(p_objective->>'description')),0)<5 or
     coalesce(length(btrim(p_objective->>'target')),0)<2 or
     coalesce(length(btrim(p_objective->>'measurement')),0)<2 or
     coalesce(length(btrim(p_objective->>'timeframe')),0)<2 or
     coalesce(length(btrim(p_objective->>'tolerance')),0)<2 then
    return jsonb_build_object('error','objective, target, measure, timeframe and tolerance are required');
  end if;
  if p_objective->>'objective_level' not in
    ('enterprise','business_unit','site','system','asset','project','task') then
    return jsonb_build_object('error','invalid objective level');
  end if;
  if v_owner is null or not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then
    return jsonb_build_object('error','objective owner not found in this organization');
  end if;
  if v_parent is not null and not exists(select 1 from risk_objectives where id=v_parent and organization_id=v_org) then
    return jsonb_build_object('error','parent objective not found in this organization');
  end if;
  if v_context is not null and not exists(select 1 from risk_context_nodes where id=v_context and organization_id=v_org) then
    return jsonb_build_object('error','context not found in this organization');
  end if;
  if v_id is null then
    insert into risk_objectives(organization_id,parent_id,context_id,owner_id,objective_level,
      description,target,measurement,timeframe,tolerance,review_date,created_by)
    values(v_org,v_parent,v_context,v_owner,p_objective->>'objective_level',
      btrim(p_objective->>'description'),btrim(p_objective->>'target'),
      btrim(p_objective->>'measurement'),btrim(p_objective->>'timeframe'),
      btrim(p_objective->>'tolerance'),nullif(p_objective->>'review_date','')::date,auth.uid())
    returning id into v_id;
  else
    update risk_objectives set parent_id=v_parent,context_id=v_context,owner_id=v_owner,
      objective_level=p_objective->>'objective_level',description=btrim(p_objective->>'description'),
      target=btrim(p_objective->>'target'),measurement=btrim(p_objective->>'measurement'),
      timeframe=btrim(p_objective->>'timeframe'),tolerance=btrim(p_objective->>'tolerance'),
      review_date=nullif(p_objective->>'review_date','')::date,updated_at=now()
    where id=v_id and organization_id=v_org and status='draft';
    if not found then return jsonb_build_object('error','only a draft objective in this organization can be edited'); end if;
  end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_objective',v_role,jsonb_build_object('objective_id',v_id,'status','draft'));
  return jsonb_build_object('objective_id',v_id,'status','draft');
end;
$$;
grant execute on function public.upsert_risk_objective(jsonb) to authenticated,service_role;

create or replace function public.adopt_risk_objective(p_objective_id uuid,p_note text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_role text; v_previous uuid; item record;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive') then return jsonb_build_object('error','forbidden'); end if;
  if coalesce(length(btrim(p_note)),0)<10 then return jsonb_build_object('error','record the adoption basis'); end if;
  update risk_objectives set status='adopted',adopted_by=auth.uid(),adopted_at=now(),updated_at=now()
  where id=p_objective_id and organization_id=v_org and status='draft'
  returning supersedes_id into v_previous;
  if not found then return jsonb_build_object('error','draft objective not found'); end if;
  if v_previous is not null then
    update risk_objectives set status='superseded',updated_at=now()
      where id=v_previous and organization_id=v_org and status='adopted';
    for item in update risks set objective_id=p_objective_id,
        objective_at_risk=(select description from risk_objectives where id=p_objective_id),updated_at=now()
      where organization_id=v_org and objective_id=v_previous returning id loop
      perform mark_risk_reassessment(item.id,'A successor version of the governing objective was adopted');
    end loop;
  end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_objective_adoption',v_role,jsonb_build_object('objective_id',p_objective_id,'note',btrim(p_note)));
  return jsonb_build_object('objective_id',p_objective_id,'status','adopted');
end;
$$;
grant execute on function public.adopt_risk_objective(uuid,text) to authenticated,service_role;

create or replace function public.create_risk_objective_version(
  p_objective_id uuid,p_changes jsonb,p_reason text
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; current_objective risk_objectives%rowtype; v_id uuid;
  v_owner uuid; v_parent uuid; v_context uuid; v_level text;
  v_description text; v_target text; v_measurement text; v_timeframe text; v_tolerance text;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  if coalesce(length(btrim(p_reason)),0)<10 then
    return jsonb_build_object('error','record why a new objective version is required'); end if;
  select * into current_objective from risk_objectives
    where id=p_objective_id and organization_id=v_org and status='adopted';
  if not found then return jsonb_build_object('error','adopted objective not found'); end if;
  if exists(select 1 from risk_objectives where supersedes_id=current_objective.id and status='draft') then
    return jsonb_build_object('error','a draft successor already exists'); end if;
  v_owner:=coalesce(nullif(p_changes->>'owner_id','')::uuid,current_objective.owner_id);
  v_parent:=case when p_changes ? 'parent_id' then nullif(p_changes->>'parent_id','')::uuid else current_objective.parent_id end;
  v_context:=case when p_changes ? 'context_id' then nullif(p_changes->>'context_id','')::uuid else current_objective.context_id end;
  v_level:=coalesce(nullif(p_changes->>'objective_level',''),current_objective.objective_level);
  v_description:=coalesce(nullif(btrim(p_changes->>'description'),''),current_objective.description);
  v_target:=coalesce(nullif(btrim(p_changes->>'target'),''),current_objective.target);
  v_measurement:=coalesce(nullif(btrim(p_changes->>'measurement'),''),current_objective.measurement);
  v_timeframe:=coalesce(nullif(btrim(p_changes->>'timeframe'),''),current_objective.timeframe);
  v_tolerance:=coalesce(nullif(btrim(p_changes->>'tolerance'),''),current_objective.tolerance);
  if v_level not in ('enterprise','business_unit','site','system','asset','project','task') or
     length(v_description)<5 or length(v_target)<2 or length(v_measurement)<2 or
     length(v_timeframe)<2 or length(v_tolerance)<2 then
    return jsonb_build_object('error','the successor objective is incomplete'); end if;
  if v_owner is null or not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then
    return jsonb_build_object('error','objective owner not found in this organization'); end if;
  if v_parent is not null and not exists(select 1 from risk_objectives where id=v_parent and organization_id=v_org) then
    return jsonb_build_object('error','parent objective not found in this organization'); end if;
  if v_context is not null and not exists(select 1 from risk_context_nodes where id=v_context and organization_id=v_org) then
    return jsonb_build_object('error','context not found in this organization'); end if;
  insert into risk_objectives(organization_id,supersedes_id,parent_id,context_id,owner_id,objective_level,
    description,target,measurement,timeframe,tolerance,version,review_date,created_by)
  values(v_org,current_objective.id,v_parent,v_context,v_owner,v_level,v_description,v_target,v_measurement,
    v_timeframe,v_tolerance,current_objective.version+1,
    case when p_changes ? 'review_date' then nullif(p_changes->>'review_date','')::date else current_objective.review_date end,
    auth.uid()) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_objective_version',v_role,jsonb_build_object('objective_id',v_id,
    'supersedes_id',current_objective.id,'version',current_objective.version+1,'reason',btrim(p_reason)));
  return jsonb_build_object('objective_id',v_id,'status','draft','version',current_objective.version+1,
    'supersedes_id',current_objective.id);
end;
$$;
grant execute on function public.create_risk_objective_version(uuid,jsonb,text) to authenticated,service_role;

create or replace function public.link_risk_objective(p_risk_id uuid,p_objective_id uuid)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_description text;
begin
  if not exists(select 1 from risks where id=p_risk_id and organization_id=v_org) then
    return jsonb_build_object('error','risk not found in this organization'); end if;
  select description into v_description from risk_objectives
    where id=p_objective_id and organization_id=v_org and status='adopted';
  if not found then return jsonb_build_object('error','adopted objective not found in this organization'); end if;
  update risks set objective_id=p_objective_id,objective_at_risk=v_description,updated_at=now()
    where id=p_risk_id and organization_id=v_org;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_objective_link',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('risk_id',p_risk_id,'objective_id',p_objective_id));
  return jsonb_build_object('risk_id',p_risk_id,'objective_id',p_objective_id);
end;
$$;
grant execute on function public.link_risk_objective(uuid,uuid) to authenticated,service_role;

create or replace function public.upsert_risk_stakeholder(p_stakeholder jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; v_id uuid:=nullif(p_stakeholder->>'id','')::uuid;
  v_context uuid:=nullif(p_stakeholder->>'context_id','')::uuid;
  v_user uuid:=nullif(p_stakeholder->>'user_id','')::uuid;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  if p_stakeholder->>'stakeholder_type' not in ('internal','external') or
     coalesce(length(btrim(p_stakeholder->>'name')),0)<2 or
     coalesce(length(btrim(p_stakeholder->>'role_or_relationship')),0)<2 then
    return jsonb_build_object('error','stakeholder type, name and relationship are required');
  end if;
  if v_context is not null and not exists(select 1 from risk_context_nodes where id=v_context and organization_id=v_org) then
    return jsonb_build_object('error','context not found in this organization'); end if;
  if v_user is not null and not exists(select 1 from user_profiles where id=v_user and organization_id=v_org) then
    return jsonb_build_object('error','stakeholder user not found in this organization'); end if;
  if v_id is null then
    insert into risk_stakeholders(organization_id,context_id,user_id,stakeholder_type,name,
      external_organization,role_or_relationship,interests,expectations,influence,
      communication_requirements,maximum_information_sensitivity)
    values(v_org,v_context,v_user,p_stakeholder->>'stakeholder_type',btrim(p_stakeholder->>'name'),
      nullif(btrim(p_stakeholder->>'external_organization'),''),btrim(p_stakeholder->>'role_or_relationship'),
      coalesce(p_stakeholder->'interests','[]'::jsonb),coalesce(p_stakeholder->'expectations','[]'::jsonb),
      nullif(p_stakeholder->>'influence',''),coalesce(p_stakeholder->'communication_requirements','{}'::jsonb),
      coalesce(p_stakeholder->>'maximum_information_sensitivity','internal')) returning id into v_id;
  else
    update risk_stakeholders set context_id=v_context,user_id=v_user,
      stakeholder_type=p_stakeholder->>'stakeholder_type',name=btrim(p_stakeholder->>'name'),
      external_organization=nullif(btrim(p_stakeholder->>'external_organization'),''),
      role_or_relationship=btrim(p_stakeholder->>'role_or_relationship'),
      interests=coalesce(p_stakeholder->'interests','[]'::jsonb),
      expectations=coalesce(p_stakeholder->'expectations','[]'::jsonb),
      influence=nullif(p_stakeholder->>'influence',''),
      communication_requirements=coalesce(p_stakeholder->'communication_requirements','{}'::jsonb),
      maximum_information_sensitivity=coalesce(p_stakeholder->>'maximum_information_sensitivity','internal'),
      active=coalesce((p_stakeholder->>'active')::boolean,true)
    where id=v_id and organization_id=v_org;
    if not found then return jsonb_build_object('error','stakeholder not found in this organization'); end if;
  end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_stakeholder',v_role,jsonb_build_object('stakeholder_id',v_id));
  return jsonb_build_object('stakeholder_id',v_id);
end;
$$;
grant execute on function public.upsert_risk_stakeholder(jsonb) to authenticated,service_role;

create or replace function public.record_risk_obligation(p_obligation jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_role text; v_id uuid; v_context uuid:=nullif(p_obligation->>'context_id','')::uuid;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  if p_obligation->>'source_type' not in
    ('law','regulation','company_standard','engineering_standard','contract','oem_requirement','policy','voluntary_commitment') then
    return jsonb_build_object('error','invalid obligation source type'); end if;
  if coalesce(length(btrim(p_obligation->>'source_reference')),0)<2 or
     coalesce(length(btrim(p_obligation->>'requirement')),0)<10 or
     coalesce(length(btrim(p_obligation->>'applicable_scope')),0)<3 or
     coalesce(length(btrim(p_obligation->>'responsible_role')),0)<2 then
    return jsonb_build_object('error','source, requirement, scope and responsible role are required'); end if;
  if v_context is not null and not exists(select 1 from risk_context_nodes where id=v_context and organization_id=v_org) then
    return jsonb_build_object('error','context not found in this organization'); end if;
  insert into risk_obligations(organization_id,context_id,source_type,source_reference,jurisdiction,
    applicable_scope,responsible_role,requirement,effective_date,expiry_date,created_by)
  values(v_org,v_context,p_obligation->>'source_type',btrim(p_obligation->>'source_reference'),
    nullif(btrim(p_obligation->>'jurisdiction'),''),btrim(p_obligation->>'applicable_scope'),
    btrim(p_obligation->>'responsible_role'),btrim(p_obligation->>'requirement'),
    nullif(p_obligation->>'effective_date','')::date,nullif(p_obligation->>'expiry_date','')::date,auth.uid())
  returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_obligation',v_role,jsonb_build_object('obligation_id',v_id,'status','draft'));
  return jsonb_build_object('obligation_id',v_id,'status','draft');
end;
$$;
grant execute on function public.record_risk_obligation(jsonb) to authenticated,service_role;

create or replace function public.adopt_risk_obligation(p_obligation_id uuid,p_note text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_role text; v_previous uuid;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive') then return jsonb_build_object('error','forbidden'); end if;
  if coalesce(length(btrim(p_note)),0)<10 then return jsonb_build_object('error','record the adoption basis'); end if;
  update risk_obligations set status='adopted',updated_at=now()
    where id=p_obligation_id and organization_id=v_org and status='draft'
    returning supersedes_id into v_previous;
  if not found then return jsonb_build_object('error','draft obligation not found'); end if;
  if v_previous is not null then
    insert into risk_obligation_links(organization_id,risk_id,obligation_id,applicability)
      select organization_id,risk_id,p_obligation_id,applicability from risk_obligation_links
      where organization_id=v_org and obligation_id=v_previous on conflict do nothing;
    update risk_obligations set status='superseded',updated_at=now()
      where id=v_previous and organization_id=v_org and status='adopted';
  end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_obligation_adoption',v_role,jsonb_build_object('obligation_id',p_obligation_id,'note',btrim(p_note)));
  return jsonb_build_object('obligation_id',p_obligation_id,'status','adopted');
end;
$$;
grant execute on function public.adopt_risk_obligation(uuid,text) to authenticated,service_role;

create or replace function public.create_risk_obligation_version(
  p_obligation_id uuid,p_changes jsonb,p_reason text
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; current_obligation risk_obligations%rowtype; v_id uuid;
  v_context uuid; v_type text; v_reference text; v_scope text; v_responsible text; v_requirement text;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  if coalesce(length(btrim(p_reason)),0)<10 then
    return jsonb_build_object('error','record why a new obligation version is required'); end if;
  select * into current_obligation from risk_obligations
    where id=p_obligation_id and organization_id=v_org and status='adopted';
  if not found then return jsonb_build_object('error','adopted obligation not found'); end if;
  if exists(select 1 from risk_obligations where supersedes_id=current_obligation.id and status='draft') then
    return jsonb_build_object('error','a draft successor already exists'); end if;
  v_context:=case when p_changes ? 'context_id' then nullif(p_changes->>'context_id','')::uuid else current_obligation.context_id end;
  v_type:=coalesce(nullif(p_changes->>'source_type',''),current_obligation.source_type);
  v_reference:=coalesce(nullif(btrim(p_changes->>'source_reference'),''),current_obligation.source_reference);
  v_scope:=coalesce(nullif(btrim(p_changes->>'applicable_scope'),''),current_obligation.applicable_scope);
  v_responsible:=coalesce(nullif(btrim(p_changes->>'responsible_role'),''),current_obligation.responsible_role);
  v_requirement:=coalesce(nullif(btrim(p_changes->>'requirement'),''),current_obligation.requirement);
  if v_type not in ('law','regulation','company_standard','engineering_standard','contract',
      'oem_requirement','policy','voluntary_commitment') or length(v_reference)<2 or
      length(v_scope)<3 or length(v_responsible)<2 or length(v_requirement)<10 then
    return jsonb_build_object('error','the successor obligation is incomplete'); end if;
  if v_context is not null and not exists(select 1 from risk_context_nodes where id=v_context and organization_id=v_org) then
    return jsonb_build_object('error','context not found in this organization'); end if;
  insert into risk_obligations(organization_id,supersedes_id,context_id,source_type,source_reference,
    jurisdiction,applicable_scope,responsible_role,requirement,effective_date,expiry_date,version,created_by)
  values(v_org,current_obligation.id,v_context,v_type,v_reference,
    case when p_changes ? 'jurisdiction' then nullif(btrim(p_changes->>'jurisdiction'),'') else current_obligation.jurisdiction end,
    v_scope,v_responsible,v_requirement,
    case when p_changes ? 'effective_date' then nullif(p_changes->>'effective_date','')::date else current_obligation.effective_date end,
    case when p_changes ? 'expiry_date' then nullif(p_changes->>'expiry_date','')::date else current_obligation.expiry_date end,
    current_obligation.version+1,auth.uid()) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_obligation_version',v_role,jsonb_build_object('obligation_id',v_id,
    'supersedes_id',current_obligation.id,'version',current_obligation.version+1,'reason',btrim(p_reason)));
  return jsonb_build_object('obligation_id',v_id,'status','draft','version',current_obligation.version+1,
    'supersedes_id',current_obligation.id);
end;
$$;
grant execute on function public.create_risk_obligation_version(uuid,jsonb,text) to authenticated,service_role;

create or replace function public.link_risk_obligation(p_risk_id uuid,p_obligation_id uuid,p_applicability text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_id uuid;
begin
  if not exists(select 1 from risks where id=p_risk_id and organization_id=v_org) then
    return jsonb_build_object('error','risk not found in this organization'); end if;
  if not exists(select 1 from risk_obligations where id=p_obligation_id and organization_id=v_org and status='adopted') then
    return jsonb_build_object('error','adopted obligation not found in this organization'); end if;
  if coalesce(length(btrim(p_applicability)),0)<5 then return jsonb_build_object('error','record why the obligation applies'); end if;
  insert into risk_obligation_links(organization_id,risk_id,obligation_id,applicability)
  values(v_org,p_risk_id,p_obligation_id,btrim(p_applicability))
  on conflict(risk_id,obligation_id) do update set applicability=excluded.applicability
  returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_obligation_link',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('risk_id',p_risk_id,'obligation_id',p_obligation_id));
  return jsonb_build_object('link_id',v_id);
end;
$$;
grant execute on function public.link_risk_obligation(uuid,uuid,text) to authenticated,service_role;

create or replace function public.record_risk_assumption(p_risk_id uuid,p_assumption jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; v_id uuid;
  v_owner uuid:=nullif(p_assumption->>'owner_id','')::uuid;
  v_dependency_exists boolean;
  dep jsonb;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  if not exists(select 1 from risks where id=p_risk_id and organization_id=v_org) then
    return jsonb_build_object('error','risk not found in this organization'); end if;
  if v_owner is null or not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then
    return jsonb_build_object('error','assumption owner not found in this organization'); end if;
  if coalesce(length(btrim(p_assumption->>'statement')),0)<10 or
     coalesce(length(btrim(p_assumption->>'trigger_for_review')),0)<10 then
    return jsonb_build_object('error','assumption and measurable review trigger are required'); end if;
  for dep in select value from jsonb_array_elements(coalesce(p_assumption->'dependencies','[]'::jsonb)) loop
    if dep->>'subject_type' not in ('risk','decision','scenario','control','objective','work_order') or
       nullif(dep->>'subject_id','') is null then
      return jsonb_build_object('error','invalid assumption dependency');
    end if;
    begin
      v_dependency_exists:=false;
      if dep->>'subject_type'='risk' then
        select exists(select 1 from risks where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='decision' then
        select exists(select 1 from decisions where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='scenario' then
        select exists(select 1 from scenarios where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='control' then
        select exists(select 1 from risk_controls where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='objective' then
        select exists(select 1 from risk_objectives where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='work_order' then
        select exists(select 1 from work_orders where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      end if;
      if not v_dependency_exists then
        return jsonb_build_object('error','assumption dependency not found in this organization');
      end if;
    exception when invalid_text_representation then
      return jsonb_build_object('error','invalid assumption dependency identifier');
    end;
  end loop;
  insert into risk_assumptions(organization_id,risk_id,statement,owner_id,confidence,
    valid_from,valid_until,trigger_for_review)
  values(v_org,p_risk_id,btrim(p_assumption->>'statement'),v_owner,
    coalesce((p_assumption->>'confidence')::numeric,0),
    coalesce(nullif(p_assumption->>'valid_from','')::date,current_date),
    nullif(p_assumption->>'valid_until','')::date,btrim(p_assumption->>'trigger_for_review'))
  returning id into v_id;
  insert into risk_assumption_dependencies(organization_id,assumption_id,subject_type,subject_id)
  values(v_org,v_id,'risk',p_risk_id);
  for dep in select value from jsonb_array_elements(coalesce(p_assumption->'dependencies','[]'::jsonb)) loop
    insert into risk_assumption_dependencies(organization_id,assumption_id,subject_type,subject_id)
    values(v_org,v_id,dep->>'subject_type',(dep->>'subject_id')::uuid) on conflict do nothing;
  end loop;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_assumption',v_role,jsonb_build_object('risk_id',p_risk_id,'assumption_id',v_id));
  return jsonb_build_object('assumption_id',v_id,'status','active');
end;
$$;
grant execute on function public.record_risk_assumption(uuid,jsonb) to authenticated,service_role;

create or replace function public.invalidate_risk_assumption(p_assumption_id uuid,p_reason text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; a risk_assumptions%rowtype;
  dep record; linked record; v_dep_risk uuid;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  select * into a from risk_assumptions where id=p_assumption_id and organization_id=v_org and status='active';
  if not found then return jsonb_build_object('error','active assumption not found'); end if;
  if a.owner_id<>auth.uid() and v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  if coalesce(length(btrim(p_reason)),0)<10 then return jsonb_build_object('error','record why the assumption is invalid'); end if;
  update risk_assumptions set status='invalidated',invalidated_by=auth.uid(),invalidated_at=now(),
    invalidation_reason=btrim(p_reason) where id=a.id;
  for dep in select * from risk_assumption_dependencies where assumption_id=a.id loop
    if dep.subject_type='risk' then perform mark_risk_reassessment(dep.subject_id,'Assumption invalidated: '||a.statement); end if;
    if dep.subject_type='decision' then update decisions set reassessment_required=true,
      reassessment_reason='Assumption invalidated: '||a.statement
      where id=dep.subject_id and organization_id=v_org; end if;
    if dep.subject_type='scenario' then
      select risk_id into v_dep_risk from scenarios where id=dep.subject_id and organization_id=v_org;
      if v_dep_risk is not null then perform mark_risk_reassessment(v_dep_risk,'Dependent scenario assumption invalidated: '||a.statement); end if;
    end if;
    if dep.subject_type='control' then
      for linked in select risk_id from risk_control_links where control_id=dep.subject_id and organization_id=v_org loop
        perform mark_risk_reassessment(linked.risk_id,'Dependent control assumption invalidated: '||a.statement);
      end loop;
    end if;
    if dep.subject_type='objective' then
      for linked in select id risk_id from risks where objective_id=dep.subject_id and organization_id=v_org loop
        perform mark_risk_reassessment(linked.risk_id,'Dependent objective assumption invalidated: '||a.statement);
      end loop;
    end if;
    if dep.subject_type='work_order' then
      select coalesce(w.risk_id,rec.risk_id) into v_dep_risk from work_orders w
        left join recommendations rec on rec.id=w.recommendation_id
        where w.id=dep.subject_id and w.organization_id=v_org;
      if v_dep_risk is not null then perform mark_risk_reassessment(v_dep_risk,'Dependent work assumption invalidated: '||a.statement); end if;
    end if;
  end loop;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_assumption_invalidated',v_role,jsonb_build_object('assumption_id',a.id,'reason',btrim(p_reason)));
  return jsonb_build_object('assumption_id',a.id,'status','invalidated','reassessment_required',true);
end;
$$;
grant execute on function public.invalidate_risk_assumption(uuid,text) to authenticated,service_role;

create or replace function public.record_risk_analysis_element(
  p_risk_id uuid,p_kind text,p_element jsonb
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_id uuid; v_evidence uuid:=nullif(p_element->>'evidence_item_id','')::uuid;
begin
  if not exists(select 1 from risks where id=p_risk_id and organization_id=v_org) then
    return jsonb_build_object('error','risk not found in this organization'); end if;
  if v_evidence is not null and not exists(select 1 from evidence_items where id=v_evidence and organization_id=v_org) then
    return jsonb_build_object('error','evidence not found in this organization'); end if;
  if p_kind='source' then
    if coalesce(length(btrim(p_element->>'description')),0)<5 or
       coalesce(length(btrim(p_element->>'source_type')),0)<2 or
       p_element->>'controllability' not in ('controllable','influenceable','external','unknown') then
      return jsonb_build_object('error','source description, type and controllability are required'); end if;
    if exists(select 1 from jsonb_array_elements_text(coalesce(p_element->'related_asset_ids','[]'::jsonb)) x
      left join assets a on a.id=x.value::uuid and a.organization_id=v_org where a.id is null) then
      return jsonb_build_object('error','one or more related assets are outside this organization'); end if;
    insert into risk_sources(organization_id,risk_id,description,source_type,controllability,
      related_asset_ids,related_processes,evidence_item_id)
    values(v_org,p_risk_id,btrim(p_element->>'description'),btrim(p_element->>'source_type'),
      p_element->>'controllability',coalesce(p_element->'related_asset_ids','[]'::jsonb),
      coalesce(p_element->'related_processes','[]'::jsonb),v_evidence) returning id into v_id;
  elsif p_kind='consequence' then
    if p_element->>'dimension' not in
      ('safety','environment','production','financial','regulatory','asset_integrity','reputation','customer','cybersecurity') or
       coalesce(length(btrim(p_element->>'description')),0)<5 or
       p_element->>'effect_type' not in ('direct','indirect','cascading') then
      return jsonb_build_object('error','valid consequence dimension, description and effect type are required'); end if;
    if exists(select 1 from jsonb_array_elements_text(coalesce(p_element->'affected_objective_ids','[]'::jsonb)) x
      left join risk_objectives o on o.id=x.value::uuid and o.organization_id=v_org where o.id is null) then
      return jsonb_build_object('error','one or more affected objectives are outside this organization'); end if;
    insert into risk_consequences(organization_id,risk_id,dimension,description,magnitude,time_horizon,
      effect_type,affected_objective_ids,evidence_item_id)
    values(v_org,p_risk_id,p_element->>'dimension',btrim(p_element->>'description'),
      nullif(p_element->>'magnitude','')::numeric,nullif(btrim(p_element->>'time_horizon'),''),
      p_element->>'effect_type',coalesce(p_element->'affected_objective_ids','[]'::jsonb),v_evidence)
    returning id into v_id;
  else return jsonb_build_object('error','analysis element kind must be source or consequence');
  end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_analysis_element',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('risk_id',p_risk_id,'kind',p_kind,'element_id',v_id));
  return jsonb_build_object('element_id',v_id,'kind',p_kind);
end;
$$;
grant execute on function public.record_risk_analysis_element(uuid,text,jsonb) to authenticated,service_role;

create or replace function public.record_risk_likelihood_estimate(p_risk_id uuid,p_estimate jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_id uuid; v_evidence uuid:=nullif(p_estimate->>'evidence_item_id','')::uuid;
begin
  if not exists(select 1 from risks where id=p_risk_id and organization_id=v_org) then
    return jsonb_build_object('error','risk not found in this organization'); end if;
  if p_estimate->>'method' not in
    ('expert_judgement','frequency','probability','weibull','monte_carlo','bayesian','historical_analogue','condition_model','event_tree') then
    return jsonb_build_object('error','invalid likelihood method'); end if;
  if nullif(p_estimate->>'estimate','') is null or coalesce(length(btrim(p_estimate->>'data_source')),0)<3 then
    return jsonb_build_object('error','likelihood estimate and data source are required'); end if;
  if v_evidence is not null and not exists(select 1 from evidence_items where id=v_evidence and organization_id=v_org) then
    return jsonb_build_object('error','evidence not found in this organization'); end if;
  insert into risk_likelihood_estimates(organization_id,risk_id,method,estimate,interval_lower,
    interval_upper,data_source,sample_size,model_reference,confidence,evidence_item_id,assumptions,created_by)
  values(v_org,p_risk_id,p_estimate->>'method',(p_estimate->>'estimate')::numeric,
    nullif(p_estimate->>'interval_lower','')::numeric,nullif(p_estimate->>'interval_upper','')::numeric,
    btrim(p_estimate->>'data_source'),nullif(p_estimate->>'sample_size','')::int,
    nullif(btrim(p_estimate->>'model_reference'),''),coalesce((p_estimate->>'confidence')::numeric,0),
    v_evidence,coalesce(p_estimate->'assumptions','[]'::jsonb),auth.uid()) returning id into v_id;
  update risks set likelihood=(p_estimate->>'estimate')::numeric,
    analysis_method=p_estimate->>'method',analysis_model_reference=nullif(btrim(p_estimate->>'model_reference'),''),
    confidence=coalesce((p_estimate->>'confidence')::numeric,confidence),updated_at=now() where id=p_risk_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_likelihood_estimate',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('risk_id',p_risk_id,'estimate_id',v_id,'method',p_estimate->>'method'));
  return jsonb_build_object('estimate_id',v_id,'method',p_estimate->>'method');
end;
$$;
grant execute on function public.record_risk_likelihood_estimate(uuid,jsonb) to authenticated,service_role;

create or replace function public.record_risk_event_scenario(p_scenario jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; v_id uuid;
  v_risk uuid:=nullif(p_scenario->>'risk_id','')::uuid;
  v_context uuid:=nullif(p_scenario->>'context_id','')::uuid;
  v_status text:=coalesce(p_scenario->>'status','draft');
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  if v_risk is not null and not exists(select 1 from risks where id=v_risk and organization_id=v_org) then
    return jsonb_build_object('error','risk not found in this organization'); end if;
  if v_context is not null and not exists(select 1 from risk_context_nodes where id=v_context and organization_id=v_org) then
    return jsonb_build_object('error','context not found in this organization'); end if;
  if coalesce((p_scenario->>'is_template')::boolean,false) and v_context is null then
    return jsonb_build_object('error','scenario templates require a governed context'); end if;
  if v_status='validated' and v_role not in ('admin','ai_admin','executive','reliability_engineer') then
    return jsonb_build_object('error','scenario validation requires independent technical authority'); end if;
  if coalesce(length(btrim(p_scenario->>'name')),0)<3 or
     coalesce(length(btrim(p_scenario->>'initiating_event')),0)<5 or
     coalesce(length(btrim(p_scenario->>'evidence_basis')),0)<10 then
    return jsonb_build_object('error','scenario name, initiating event and evidence basis are required'); end if;
  insert into risk_event_scenarios(organization_id,context_id,risk_id,name,is_template,initiating_event,
    causes,conditions,dependencies,escalation_paths,possible_consequences,evidence_basis,status,
    validated_by,validated_at,created_by)
  values(v_org,v_context,v_risk,btrim(p_scenario->>'name'),coalesce((p_scenario->>'is_template')::boolean,false),
    btrim(p_scenario->>'initiating_event'),coalesce(p_scenario->'causes','[]'::jsonb),
    coalesce(p_scenario->'conditions','[]'::jsonb),coalesce(p_scenario->'dependencies','[]'::jsonb),
    coalesce(p_scenario->'escalation_paths','[]'::jsonb),coalesce(p_scenario->'possible_consequences','[]'::jsonb),
    btrim(p_scenario->>'evidence_basis'),v_status,
    case when v_status='validated' then auth.uid() end,case when v_status='validated' then now() end,auth.uid())
  returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_event_scenario',v_role,jsonb_build_object('scenario_id',v_id,'risk_id',v_risk,'status',v_status));
  return jsonb_build_object('scenario_id',v_id,'status',v_status);
end;
$$;
grant execute on function public.record_risk_event_scenario(jsonb) to authenticated,service_role;

create or replace function public.record_risk_stress_test(p_test jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; v_id uuid;
  v_context uuid:=nullif(p_test->>'context_id','')::uuid;
  v_objective uuid:=nullif(p_test->>'objective_id','')::uuid;
  v_capacity numeric:=nullif(p_test->>'capacity_limit','')::numeric;
  v_independent numeric:=0; v_uplift numeric:=0; v_combined numeric:=0;
  v_contributions jsonb:='[]'::jsonb; v_correlations jsonb:='[]'::jsonb;
  v_reverse jsonb:='[]'::jsonb; v_remaining numeric:=1; v_threshold numeric;
  v_status text:=coalesce(p_test->>'status','diagnostic'); item record;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  if p_test->>'mode' not in ('stress','reverse_stress') then return jsonb_build_object('error','invalid stress-test mode'); end if;
  if coalesce(length(btrim(p_test->>'name')),0)<5 or jsonb_array_length(coalesce(p_test->'risk_ids','[]'::jsonb))=0 then
    return jsonb_build_object('error','stress-test name and risks are required'); end if;
  if v_context is not null and not exists(select 1 from risk_context_nodes where id=v_context and organization_id=v_org) then
    return jsonb_build_object('error','context not found in this organization'); end if;
  if v_objective is not null and not exists(select 1 from risk_objectives where id=v_objective and organization_id=v_org) then
    return jsonb_build_object('error','objective not found in this organization'); end if;
  if v_status in ('reviewed','adopted') and v_role not in ('admin','ai_admin','executive') then
    return jsonb_build_object('error','leadership review is required for a non-diagnostic stress result'); end if;
  if exists(
    select 1 from (select distinct value::uuid id from jsonb_array_elements_text(p_test->'risk_ids')) x
    left join risks r on r.id=x.id and r.organization_id=v_org where r.id is null
  ) then return jsonb_build_object('error','one or more risks are outside this organization'); end if;
  if exists(
    select 1 from (select distinct value::uuid id from jsonb_array_elements_text(
      coalesce(p_test->'scenario_ids','[]'::jsonb))) x
    left join risk_event_scenarios s on s.id=x.id and s.organization_id=v_org where s.id is null
  ) then return jsonb_build_object('error','one or more event scenarios are outside this organization'); end if;
  if v_capacity is null then
    select nullif(c.risk_capacity->>'capacity_limit','')::numeric into v_capacity
    from risk_criteria_profiles c where c.organization_id=v_org and c.status='adopted'
      and (v_context is null or c.context_id=v_context) order by c.version desc limit 1;
  end if;
  v_capacity:=coalesce(v_capacity,100);
  if v_capacity<0 or v_capacity>100 then return jsonb_build_object('error','capacity limit must be between zero and 100'); end if;
  with ids as (select distinct value::uuid id from jsonb_array_elements_text(p_test->'risk_ids')),
  positions as (select r.id,r.title,coalesce(r.current_risk_score,r.exposure,0)::numeric score
    from ids join risks r using(id) where r.organization_id=v_org)
  select coalesce(jsonb_agg(jsonb_build_object('risk_id',id,'title',title,'exposure',score)
      order by score desc),'[]'::jsonb),
    case when bool_or(score>=100) then 100
      else 100*(1-exp(sum(ln(greatest(1-score/100,0.000001))))) end
  into v_contributions,v_independent from positions;
  with ids as (select distinct value::uuid id from jsonb_array_elements_text(p_test->'risk_ids')),
  pairs as (
    select l.id,l.source_risk_id,l.target_risk_id,l.relationship,l.dependency_key,
      coalesce(l.strength,50) strength,
      least(coalesce(a.current_risk_score,a.exposure,0),coalesce(b.current_risk_score,b.exposure,0)) base
    from risk_links l join ids ia on ia.id=l.source_risk_id join ids ib on ib.id=l.target_risk_id
    join risks a on a.id=l.source_risk_id join risks b on b.id=l.target_risk_id
    where l.organization_id=v_org and l.relationship in ('common_dependency','amplifies','cascades_to','sequence')
  )
  select coalesce(sum(base*strength/100*0.1),0),
    coalesce(jsonb_agg(jsonb_build_object('link_id',id,'source_risk_id',source_risk_id,
      'target_risk_id',target_risk_id,'relationship',relationship,'dependency_key',dependency_key,
      'strength',strength)),'[]'::jsonb)
  into v_uplift,v_correlations from pairs;
  v_combined:=least(100,v_independent+v_uplift);
  v_threshold:=coalesce(nullif(p_test->>'reverse_stress_threshold','')::numeric,v_capacity);
  for item in
    with ids as (select distinct value::uuid id from jsonb_array_elements_text(p_test->'risk_ids'))
    select r.id,coalesce(r.current_risk_score,r.exposure,0)::numeric score
    from ids join risks r using(id) where r.organization_id=v_org order by score desc
  loop
    v_reverse:=v_reverse||to_jsonb(item.id);
    v_remaining:=v_remaining*(1-item.score/100);
    exit when 100*(1-v_remaining)>=v_threshold;
  end loop;
  if v_combined<v_threshold then v_reverse:='[]'::jsonb; end if;
  insert into risk_stress_tests(organization_id,context_id,objective_id,mode,name,risk_ids,
    scenario_ids,assumptions,correlations,capacity_limit,combined_exposure,threshold_breached,
    reverse_stress_risk_ids,contributions,methodology,status,run_by,reviewed_by)
  values(v_org,v_context,v_objective,p_test->>'mode',btrim(p_test->>'name'),
    (select jsonb_agg(id) from (select distinct value::uuid id from jsonb_array_elements_text(p_test->'risk_ids')) d),
    coalesce(p_test->'scenario_ids','[]'::jsonb),coalesce(p_test->'assumptions','[]'::jsonb),v_correlations,
    v_capacity,v_combined,v_combined>v_capacity,v_reverse,v_contributions,
    'Deduplicated complement aggregation plus one bounded uplift per recorded dependency edge; reverse stress uses descending exposure until the adopted threshold is crossed.',
    v_status,auth.uid(),case when v_status in ('reviewed','adopted') then auth.uid() end) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_stress_test',v_role,jsonb_build_object('stress_test_id',v_id,'mode',p_test->>'mode',
    'combined_exposure',v_combined,'capacity_limit',v_capacity,'threshold_breached',v_combined>v_capacity));
  return jsonb_build_object('stress_test_id',v_id,'combined_exposure',v_combined,
    'independent_exposure',v_independent,'correlation_uplift',v_uplift,
    'capacity_limit',v_capacity,'within_capacity',v_combined<=v_capacity,
    'reverse_stress_risk_ids',v_reverse,'status',v_status);
end;
$$;
grant execute on function public.record_risk_stress_test(jsonb) to authenticated,service_role;

create or replace function public.link_risk_treatment_dependency(p_dependency jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_id uuid;
  v_scenario uuid:=nullif(p_dependency->>'scenario_id','')::uuid;
  v_depends uuid:=nullif(p_dependency->>'depends_on_scenario_id','')::uuid;
begin
  if v_scenario=v_depends then return jsonb_build_object('error','a treatment cannot depend on itself'); end if;
  if not exists(select 1 from scenarios where id=v_scenario and organization_id=v_org and risk_id is not null) or
     not exists(select 1 from scenarios where id=v_depends and organization_id=v_org and risk_id is not null) then
    return jsonb_build_object('error','both treatment scenarios must belong to this organization'); end if;
  if not exists(select 1 from scenarios a join scenarios b on b.id=v_depends
    where a.id=v_scenario and a.risk_id=b.risk_id and a.organization_id=v_org) then
    return jsonb_build_object('error','treatment dependencies must belong to the same risk'); end if;
  if p_dependency->>'dependency_type' not in
    ('finish_to_start','start_to_start','finish_to_finish','resource','approval','evidence') or
     coalesce(length(btrim(p_dependency->>'rationale')),0)<5 then
    return jsonb_build_object('error','valid dependency type and rationale are required'); end if;
  if exists(
    with recursive chain(id) as (
      select depends_on_scenario_id from risk_treatment_dependencies where scenario_id=v_depends and organization_id=v_org
      union
      select d.depends_on_scenario_id from risk_treatment_dependencies d join chain c on c.id=d.scenario_id
      where d.organization_id=v_org
    ) select 1 from chain where id=v_scenario
  ) then return jsonb_build_object('error','treatment dependency would create a cycle'); end if;
  insert into risk_treatment_dependencies(organization_id,scenario_id,depends_on_scenario_id,
    dependency_type,lag_days,critical,rationale)
  values(v_org,v_scenario,v_depends,p_dependency->>'dependency_type',
    coalesce((p_dependency->>'lag_days')::numeric,0),coalesce((p_dependency->>'critical')::boolean,false),
    btrim(p_dependency->>'rationale')) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_treatment_dependency',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('dependency_id',v_id,'scenario_id',v_scenario,'depends_on',v_depends));
  return jsonb_build_object('dependency_id',v_id);
end;
$$;
grant execute on function public.link_risk_treatment_dependency(jsonb) to authenticated,service_role;

create or replace function public.configure_risk_control_lifecycle(p_control_id uuid,p_config jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text;
  v_lifecycle text:=coalesce(p_config->>'lifecycle_kind','permanent');
  v_predecessor uuid:=nullif(p_config->>'predecessor_control_id','')::uuid;
  v_replaces uuid:=nullif(p_config->>'replaces_control_id','')::uuid;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  if not exists(select 1 from risk_controls where id=p_control_id and organization_id=v_org) then
    return jsonb_build_object('error','control not found in this organization'); end if;
  if v_lifecycle not in ('temporary','permanent','compensating') then return jsonb_build_object('error','invalid control lifecycle'); end if;
  if v_lifecycle='temporary' and (nullif(p_config->>'expires_on','') is null or
      coalesce(length(btrim(p_config->>'sunset_action')),0)<5) then
    return jsonb_build_object('error','temporary controls require expiry and sunset action'); end if;
  if v_predecessor is not null and not exists(select 1 from risk_controls where id=v_predecessor and organization_id=v_org) then
    return jsonb_build_object('error','predecessor control not found in this organization'); end if;
  if v_replaces is not null and not exists(select 1 from risk_controls where id=v_replaces and organization_id=v_org) then
    return jsonb_build_object('error','replaced control not found in this organization'); end if;
  update risk_controls set lifecycle_kind=v_lifecycle,
    criticality=coalesce(p_config->>'criticality','noncritical'),
    failure_modes=coalesce(p_config->'failure_modes','[]'::jsonb),
    predecessor_control_id=v_predecessor,replaces_control_id=v_replaces,
    effective_from=nullif(p_config->>'effective_from','')::date,
    expires_on=nullif(p_config->>'expires_on','')::date,
    sunset_action=nullif(btrim(p_config->>'sunset_action'),''),updated_at=now()
  where id=p_control_id and organization_id=v_org;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_control_lifecycle',v_role,jsonb_build_object('control_id',p_control_id,
    'lifecycle_kind',v_lifecycle,'expires_on',p_config->>'expires_on'));
  return jsonb_build_object('control_id',p_control_id,'lifecycle_kind',v_lifecycle);
end;
$$;
grant execute on function public.configure_risk_control_lifecycle(uuid,jsonb) to authenticated,service_role;

-- Risk-linked rows in canonical tables inherit the risk sensitivity boundary.
-- Direct authenticated writes may continue for legacy non-risk records, while
-- risk-linked mutations remain security-definer RPC-only.
drop policy if exists evidence_items_risk_sensitive on evidence_items;
create policy evidence_items_risk_sensitive on evidence_items as restrictive
  for all to authenticated using (risk_id is null or can_read_risk(risk_id))
  with check (risk_id is null);
drop policy if exists scenarios_risk_sensitive on scenarios;
create policy scenarios_risk_sensitive on scenarios as restrictive
  for all to authenticated using (risk_id is null or can_read_risk(risk_id))
  with check (risk_id is null);
drop policy if exists recommendations_risk_sensitive on recommendations;
create policy recommendations_risk_sensitive on recommendations as restrictive
  for all to authenticated using (risk_id is null or can_read_risk(risk_id))
  with check (risk_id is null);
drop policy if exists approvals_risk_sensitive on approvals;
create policy approvals_risk_sensitive on approvals as restrictive
  for all to authenticated using (risk_id is null or can_read_risk(risk_id))
  with check (risk_id is null);
drop policy if exists decisions_risk_sensitive on decisions;
create policy decisions_risk_sensitive on decisions as restrictive
  for all to authenticated using (risk_id is null or can_read_risk(risk_id))
  with check (risk_id is null);
drop policy if exists work_orders_risk_sensitive on work_orders;
create policy work_orders_risk_sensitive on work_orders as restrictive
  for all to authenticated using (risk_id is null or can_read_risk(risk_id))
  with check (risk_id is null);
drop policy if exists learning_events_risk_sensitive on learning_events;
create policy learning_events_risk_sensitive on learning_events as restrictive
  for all to authenticated using (risk_id is null or can_read_risk(risk_id))
  with check (risk_id is null);

-- ---------------------------------------------------------------------------
-- Formal dissent, independent assurance, communication and learning transfer
-- ---------------------------------------------------------------------------
create or replace function public.record_risk_challenge(p_challenge jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_id uuid; v_risk uuid:=nullif(p_challenge->>'risk_id','')::uuid;
  v_subject uuid:=nullif(p_challenge->>'subject_id','')::uuid; v_subject_exists boolean:=false;
begin
  if not exists(select 1 from risks where id=v_risk and organization_id=v_org) then
    return jsonb_build_object('error','risk not found in this organization'); end if;
  if p_challenge->>'subject_type' not in ('risk_rating','assumption','control','treatment','decision','acceptance') or
     coalesce(length(btrim(p_challenge->>'challenged_field')),0)<2 or
     coalesce(length(btrim(p_challenge->>'rationale')),0)<20 then
    return jsonb_build_object('error','challenge subject, field and evidence-based rationale are required'); end if;
  if p_challenge->>'subject_type'='risk_rating' then v_subject:=coalesce(v_subject,v_risk); end if;
  if v_subject is null then return jsonb_build_object('error','challenge subject record is required'); end if;
  if p_challenge->>'subject_type'='risk_rating' then
    select exists(select 1 from risks where id=v_subject and organization_id=v_org) into v_subject_exists;
  elsif p_challenge->>'subject_type'='assumption' then
    select exists(select 1 from risk_assumptions where id=v_subject and organization_id=v_org and risk_id=v_risk) into v_subject_exists;
  elsif p_challenge->>'subject_type'='control' then
    select exists(select 1 from risk_controls c join risk_control_links l on l.control_id=c.id
      where c.id=v_subject and c.organization_id=v_org and l.risk_id=v_risk) into v_subject_exists;
  elsif p_challenge->>'subject_type'='treatment' then
    select exists(select 1 from scenarios where id=v_subject and organization_id=v_org and risk_id=v_risk) into v_subject_exists;
  elsif p_challenge->>'subject_type'='decision' then
    select exists(select 1 from decisions where id=v_subject and organization_id=v_org and risk_id=v_risk) into v_subject_exists;
  elsif p_challenge->>'subject_type'='acceptance' then
    select exists(select 1 from risk_acceptances where id=v_subject and organization_id=v_org
      and subject_type='risk' and subject_id=v_risk) into v_subject_exists;
  end if;
  if not v_subject_exists then return jsonb_build_object('error','challenge subject not found on this risk'); end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_challenge->'evidence_item_ids','[]'::jsonb)) x
    left join evidence_items e on e.id=x.value::uuid and e.organization_id=v_org where e.id is null) then
    return jsonb_build_object('error','one or more challenge evidence items are outside this organization'); end if;
  insert into risk_challenges(organization_id,risk_id,subject_type,subject_id,challenged_field,
    rationale,evidence_item_ids,requested_information,challenged_by)
  values(v_org,v_risk,p_challenge->>'subject_type',v_subject,
    btrim(p_challenge->>'challenged_field'),btrim(p_challenge->>'rationale'),
    coalesce(p_challenge->'evidence_item_ids','[]'::jsonb),
    nullif(btrim(p_challenge->>'requested_information'),''),auth.uid()) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_challenge',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('challenge_id',v_id,'risk_id',v_risk,'subject_type',p_challenge->>'subject_type'));
  return jsonb_build_object('challenge_id',v_id,'status','open');
end;
$$;
grant execute on function public.record_risk_challenge(jsonb) to authenticated,service_role;

create or replace function public.resolve_risk_challenge(p_challenge_id uuid,p_outcome text,p_resolution jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_role text; c risk_challenges%rowtype;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  select * into c from risk_challenges where id=p_challenge_id and organization_id=v_org and status='open';
  if not found then return jsonb_build_object('error','open challenge not found'); end if;
  if c.challenged_by=auth.uid() then return jsonb_build_object('error','segregation of duties: a challenger cannot resolve their own challenge'); end if;
  if p_outcome not in ('upheld','rejected','withdrawn') or
     coalesce(length(btrim(p_resolution->>'resolution')),0)<20 then
    return jsonb_build_object('error','outcome and evidence-based resolution are required'); end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_resolution->'evidence_item_ids','[]'::jsonb)) x
    left join evidence_items e on e.id=x.value::uuid and e.organization_id=v_org where e.id is null) then
    return jsonb_build_object('error','one or more resolution evidence items are outside this organization'); end if;
  update risk_challenges set status=p_outcome,resolved_by=auth.uid(),
    resolution=btrim(p_resolution->>'resolution'),
    resolution_evidence=coalesce(p_resolution->'evidence_item_ids','[]'::jsonb),resolved_at=now()
  where id=c.id;
  if p_outcome='upheld' then perform mark_risk_reassessment(c.risk_id,'Challenge upheld: '||c.challenged_field); end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_challenge_resolution',v_role,jsonb_build_object('challenge_id',c.id,
    'risk_id',c.risk_id,'outcome',p_outcome));
  return jsonb_build_object('challenge_id',c.id,'status',p_outcome,
    'reassessment_required',p_outcome='upheld');
end;
$$;
grant execute on function public.resolve_risk_challenge(uuid,text,jsonb) to authenticated,service_role;

create or replace function public.record_risk_assurance_review(p_review jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; v_id uuid;
  v_risk uuid:=nullif(p_review->>'risk_id','')::uuid;
  v_subject uuid:=nullif(p_review->>'subject_id','')::uuid;
  v_owner uuid:=nullif(p_review->>'subject_owner_id','')::uuid;
  v_status text:=coalesce(p_review->>'status','planned');
  v_subject_exists boolean:=false;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  if v_risk is not null and not exists(select 1 from risks where id=v_risk and organization_id=v_org) then
    return jsonb_build_object('error','risk not found in this organization'); end if;
  if p_review->>'subject_type' not in ('risk','control','scenario','decision','acceptance') or v_subject is null or
     p_review->>'assurance_level' not in ('line_1','line_2','independent') or
     coalesce(length(btrim(p_review->>'scope')),0)<10 then
    return jsonb_build_object('error','assurance subject, level and scope are required'); end if;
  if v_owner is not null and not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then
    return jsonb_build_object('error','subject owner not found in this organization'); end if;
  if p_review->>'subject_type'='risk' then
    select exists(select 1 from risks where id=v_subject and organization_id=v_org) into v_subject_exists;
  elsif p_review->>'subject_type'='control' then
    select exists(select 1 from risk_controls c where c.id=v_subject and c.organization_id=v_org and
      (v_risk is null or exists(select 1 from risk_control_links l where l.control_id=c.id and l.risk_id=v_risk)))
      into v_subject_exists;
  elsif p_review->>'subject_type'='scenario' then
    select exists(select 1 from scenarios where id=v_subject and organization_id=v_org
      and (v_risk is null or risk_id=v_risk)) into v_subject_exists;
  elsif p_review->>'subject_type'='decision' then
    select exists(select 1 from decisions where id=v_subject and organization_id=v_org
      and (v_risk is null or risk_id=v_risk)) into v_subject_exists;
  elsif p_review->>'subject_type'='acceptance' then
    select exists(select 1 from risk_acceptances where id=v_subject and organization_id=v_org
      and (v_risk is null or (subject_type='risk' and subject_id=v_risk))) into v_subject_exists;
  end if;
  if not v_subject_exists then
    return jsonb_build_object('error','assurance subject not found in this organization'); end if;
  if p_review->>'subject_type'='risk' then
    if v_risk is not null and v_risk<>v_subject then
      return jsonb_build_object('error','assurance risk and subject do not match'); end if;
    v_risk:=v_subject;
  end if;
  if p_review->>'assurance_level'='independent' and v_owner=auth.uid() then
    return jsonb_build_object('error','segregation of duties: independent reviewer cannot own the subject'); end if;
  if v_status='completed' and (p_review->>'conclusion' not in
      ('acceptable','acceptable_with_actions','not_acceptable','inconclusive') or
      jsonb_array_length(coalesce(p_review->'evidence_item_ids','[]'::jsonb))=0) then
    return jsonb_build_object('error','completed assurance requires a conclusion and evidence'); end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_review->'evidence_item_ids','[]'::jsonb)) x
    left join evidence_items e on e.id=x.value::uuid and e.organization_id=v_org where e.id is null) then
    return jsonb_build_object('error','one or more assurance evidence items are outside this organization'); end if;
  insert into risk_assurance_reviews(organization_id,risk_id,subject_type,subject_id,assurance_level,
    subject_owner_id,reviewer_id,scope,conclusion,findings,actions,evidence_item_ids,status,due_date,completed_at)
  values(v_org,v_risk,p_review->>'subject_type',v_subject,p_review->>'assurance_level',v_owner,auth.uid(),
    btrim(p_review->>'scope'),nullif(p_review->>'conclusion',''),coalesce(p_review->'findings','[]'::jsonb),
    coalesce(p_review->'actions','[]'::jsonb),coalesce(p_review->'evidence_item_ids','[]'::jsonb),v_status,
    nullif(p_review->>'due_date','')::date,case when v_status='completed' then now() end) returning id into v_id;
  if v_status='completed' and p_review->>'conclusion'='not_acceptable' and v_risk is not null then
    perform mark_risk_reassessment(v_risk,'Independent assurance found the subject unacceptable'); end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_assurance_review',v_role,jsonb_build_object('review_id',v_id,'risk_id',v_risk,
    'assurance_level',p_review->>'assurance_level','status',v_status));
  return jsonb_build_object('review_id',v_id,'status',v_status);
end;
$$;
grant execute on function public.record_risk_assurance_review(jsonb) to authenticated,service_role;

create or replace function public.record_risk_communication(p_communication jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_id uuid; v_risk uuid:=nullif(p_communication->>'risk_id','')::uuid;
  v_stakeholder uuid:=nullif(p_communication->>'stakeholder_id','')::uuid;
  v_max text; v_sensitivity text:=coalesce(p_communication->>'sensitivity','internal');
  v_rank int; v_max_rank int;
begin
  if not can_read_risk(v_risk) then return jsonb_build_object('error','risk not available to this user'); end if;
  if p_communication->>'audience' not in
    ('technician','supervisor','manager','executive','board','oversight','external') or
     coalesce(length(btrim(p_communication->>'channel')),0)<2 or
     coalesce(length(btrim(p_communication->>'message')),0)<20 or
     coalesce(length(btrim(p_communication->>'decision_or_action')),0)<5 or
     coalesce(length(btrim(p_communication->>'accountable_owner')),0)<2 then
    return jsonb_build_object('error','audience, understandable message, action and owner are required'); end if;
  if v_stakeholder is not null then
    select maximum_information_sensitivity into v_max from risk_stakeholders
      where id=v_stakeholder and organization_id=v_org and active;
    if not found then return jsonb_build_object('error','stakeholder not found in this organization'); end if;
    v_rank:=case v_sensitivity when 'public' then 1 when 'internal' then 2 when 'confidential' then 3 when 'restricted' then 4 else 99 end;
    v_max_rank:=case v_max when 'public' then 1 when 'internal' then 2 when 'confidential' then 3 when 'restricted' then 4 else 0 end;
    if v_rank>v_max_rank then return jsonb_build_object('error','message sensitivity exceeds stakeholder access'); end if;
  elsif p_communication->>'audience'='external' then
    return jsonb_build_object('error','external communication requires a governed stakeholder');
  end if;
  insert into risk_communications(organization_id,risk_id,stakeholder_id,audience,channel,message,
    decision_or_action,accountable_owner,sensitivity,cost,comprehension_status,feedback,communicated_by)
  values(v_org,v_risk,v_stakeholder,p_communication->>'audience',btrim(p_communication->>'channel'),
    btrim(p_communication->>'message'),btrim(p_communication->>'decision_or_action'),
    btrim(p_communication->>'accountable_owner'),v_sensitivity,nullif(p_communication->>'cost','')::numeric,
    coalesce(p_communication->>'comprehension_status','not_checked'),nullif(btrim(p_communication->>'feedback'),''),auth.uid())
  returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_communication',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('communication_id',v_id,'risk_id',v_risk,'audience',p_communication->>'audience',
      'sensitivity',v_sensitivity));
  return jsonb_build_object('communication_id',v_id);
end;
$$;
grant execute on function public.record_risk_communication(jsonb) to authenticated,service_role;

create or replace function public.record_risk_learning_transfer(p_transfer jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_id uuid;
  v_learning uuid:=nullif(p_transfer->>'learning_event_id','')::uuid;
  v_context uuid:=nullif(p_transfer->>'target_context_id','')::uuid;
  v_site uuid:=nullif(p_transfer->>'target_site_id','')::uuid;
begin
  if not exists(select 1 from learning_events where id=v_learning and organization_id=v_org) then
    return jsonb_build_object('error','learning event not found in this organization'); end if;
  if v_context is not null and not exists(select 1 from risk_context_nodes where id=v_context and organization_id=v_org) then
    return jsonb_build_object('error','target context not found in this organization'); end if;
  if v_site is not null and not exists(select 1 from sites where id=v_site and organization_id=v_org) then
    return jsonb_build_object('error','target site not found in this organization'); end if;
  if v_context is null and v_site is null and coalesce(length(btrim(p_transfer->>'target_asset_class')),0)<2 then
    return jsonb_build_object('error','learning transfer requires a target'); end if;
  if p_transfer->>'applicability' not in ('candidate','applicable','not_applicable','adaptation_required') or
     coalesce(length(btrim(p_transfer->>'rationale')),0)<20 then
    return jsonb_build_object('error','applicability and evidence-based rationale are required'); end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_transfer->'evidence_item_ids','[]'::jsonb)) x
    left join evidence_items e on e.id=x.value::uuid and e.organization_id=v_org where e.id is null) then
    return jsonb_build_object('error','one or more learning evidence items are outside this organization'); end if;
  insert into risk_learning_transfers(organization_id,learning_event_id,target_context_id,target_site_id,
    target_asset_class,applicability,rationale,adaptation_required,evidence_item_ids,status,proposed_by)
  values(v_org,v_learning,v_context,v_site,nullif(btrim(p_transfer->>'target_asset_class'),''),
    p_transfer->>'applicability',btrim(p_transfer->>'rationale'),
    nullif(btrim(p_transfer->>'adaptation_required'),''),coalesce(p_transfer->'evidence_item_ids','[]'::jsonb),
    'proposed',auth.uid()) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_learning_transfer',coalesce((select role from user_profiles where id=auth.uid()),'unknown'),
    jsonb_build_object('transfer_id',v_id,'learning_event_id',v_learning,'status','proposed'));
  return jsonb_build_object('transfer_id',v_id,'status','proposed');
end;
$$;
grant execute on function public.record_risk_learning_transfer(jsonb) to authenticated,service_role;

create or replace function public.decide_risk_learning_transfer(p_transfer_id uuid,p_adopt boolean,p_note text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_role text; t risk_learning_transfers%rowtype;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  select * into t from risk_learning_transfers where id=p_transfer_id and organization_id=v_org and status='proposed';
  if not found then return jsonb_build_object('error','proposed learning transfer not found'); end if;
  if t.proposed_by=auth.uid() then return jsonb_build_object('error','segregation of duties: proposer cannot adopt their own learning transfer'); end if;
  if coalesce(length(btrim(p_note)),0)<10 then return jsonb_build_object('error','record the transfer review basis'); end if;
  if p_adopt and t.applicability not in ('applicable','adaptation_required') then
    return jsonb_build_object('error','only applicable or adaptation-required learning may be adopted'); end if;
  update risk_learning_transfers set status=case when p_adopt then 'adopted' else 'rejected' end,
    reviewed_by=auth.uid(),reviewed_at=now(),rationale=rationale||' | Review: '||btrim(p_note)
  where id=t.id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_learning_transfer_decision',v_role,jsonb_build_object('transfer_id',t.id,'adopted',p_adopt));
  return jsonb_build_object('transfer_id',t.id,'status',case when p_adopt then 'adopted' else 'rejected' end);
end;
$$;
grant execute on function public.decide_risk_learning_transfer(uuid,boolean,text) to authenticated,service_role;

create or replace function public.record_risk_outcome_attribution(p_learning_event_id uuid,p_attribution jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_role text; e learning_events%rowtype;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  select * into e from learning_events where id=p_learning_event_id and organization_id=v_org and risk_id is not null;
  if not found then return jsonb_build_object('error','risk learning event not found in this organization'); end if;
  if coalesce(length(btrim(p_attribution->>'outcome_attribution')),0)<20 or
     nullif(p_attribution->>'attribution_confidence','') is null then
    return jsonb_build_object('error','outcome attribution and confidence are required'); end if;
  update learning_events set outcome_attribution=btrim(p_attribution->>'outcome_attribution'),
    attribution_confidence=(p_attribution->>'attribution_confidence')::numeric,
    context_effects=coalesce(p_attribution->'context_effects','[]'::jsonb),
    transfer_candidate=coalesce((p_attribution->>'transfer_candidate')::boolean,false)
  where id=e.id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_outcome_attribution',v_role,jsonb_build_object('learning_event_id',e.id,
    'risk_id',e.risk_id,'confidence',(p_attribution->>'attribution_confidence')::numeric));
  return jsonb_build_object('learning_event_id',e.id,'attributed',true);
end;
$$;
grant execute on function public.record_risk_outcome_attribution(uuid,jsonb) to authenticated,service_role;

-- Extended authority dimensions remain draft until the canonical authority
-- profile is adopted through its existing approval path.
create or replace function public.configure_risk_authority_scope(p_authority_limit_id uuid,p_scope jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_role text; l authority_limits%rowtype;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive') then return jsonb_build_object('error','forbidden'); end if;
  select * into l from authority_limits where id=p_authority_limit_id and organization_id=v_org and status='draft';
  if not found then return jsonb_build_object('error','draft authority limit not found'); end if;
  if p_scope->>'independent_assurance_above_level' is not null and
     p_scope->>'independent_assurance_above_level' not in ('Low','Medium','High','Critical') then
    return jsonb_build_object('error','invalid independent assurance threshold'); end if;
  update authority_limits set jurisdictions=coalesce(p_scope->'jurisdictions','[]'::jsonb),
    asset_criticality_levels=coalesce(p_scope->'asset_criticality_levels','[]'::jsonb),
    max_decision_value=nullif(p_scope->>'max_decision_value','')::numeric,
    independent_assurance_above_level=nullif(p_scope->>'independent_assurance_above_level','')
  where id=l.id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_authority_scope',v_role,jsonb_build_object('authority_limit_id',l.id,
    'jurisdictions',coalesce(p_scope->'jurisdictions','[]'::jsonb),
    'asset_criticality_levels',coalesce(p_scope->'asset_criticality_levels','[]'::jsonb)));
  return jsonb_build_object('authority_limit_id',l.id,'status','draft');
end;
$$;
grant execute on function public.configure_risk_authority_scope(uuid,jsonb) to authenticated,service_role;

alter table decisions add column if not exists raised_by uuid references auth.users(id) default auth.uid();

create or replace function public.enforce_extended_risk_decision_authority()
returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; r risks%rowtype; c risk_criteria_profiles%rowtype;
  l authority_limits%rowtype; v_criticality text; v_value numeric;
begin
  if new.risk_id is null or new.approval_status<>'approved' or old.approval_status='approved' then return new; end if;
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  select * into r from risks where id=new.risk_id and organization_id=v_org;
  select * into c from risk_criteria_profiles where id=r.criteria_profile_id and organization_id=v_org;
  select * into l from authority_limits where organization_id=v_org and role_key=v_role and status='adopted'
    order by version desc limit 1;
  if not found then raise exception 'extended authority: adopted authority limit not found'; end if;
  if jsonb_array_length(l.jurisdictions)>0 and
     (c.jurisdiction is null or not (l.jurisdictions ? c.jurisdiction)) then
    raise exception 'extended authority: jurisdiction is outside the approver scope'; end if;
  if r.asset_id is not null then select criticality into v_criticality from assets where id=r.asset_id and organization_id=v_org; end if;
  if jsonb_array_length(l.asset_criticality_levels)>0 and
     (v_criticality is null or not (l.asset_criticality_levels ? v_criticality)) then
    raise exception 'extended authority: asset criticality is outside the approver scope'; end if;
  v_value:=coalesce(new.decision_value,r.value_at_risk,0);
  if l.max_decision_value is not null and v_value>l.max_decision_value then
    raise exception 'extended authority: decision value exceeds the approver ceiling'; end if;
  if l.independent_assurance_above_level is not null and
     risk_rank(r.current_risk_level)>=risk_rank(l.independent_assurance_above_level) then
    if new.raised_by=auth.uid() then
      raise exception 'segregation of duties: the decision proposer cannot approve at this assurance level'; end if;
    if not exists(select 1 from risk_assurance_reviews ar where ar.organization_id=v_org
      and ar.risk_id=r.id and ar.assurance_level='independent' and ar.status='completed'
      and ar.conclusion in ('acceptable','acceptable_with_actions')) then
      raise exception 'extended authority: completed independent assurance is required'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_extended_risk_decision_authority on decisions;
create trigger trg_extended_risk_decision_authority before update of approval_status on decisions
  for each row execute function public.enforce_extended_risk_decision_authority();

create or replace function public.enforce_extended_risk_acceptance_authority()
returns trigger
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_role text; r risks%rowtype; c risk_criteria_profiles%rowtype;
  l authority_limits%rowtype; v_criticality text;
begin
  if new.subject_type<>'risk' then return new; end if;
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  select * into r from risks where id=new.subject_id and organization_id=v_org;
  select * into c from risk_criteria_profiles where id=r.criteria_profile_id and organization_id=v_org;
  select * into l from authority_limits where organization_id=v_org and role_key=v_role and status='adopted'
    order by version desc limit 1;
  if jsonb_array_length(l.jurisdictions)>0 and
     (c.jurisdiction is null or not (l.jurisdictions ? c.jurisdiction)) then
    raise exception 'extended authority: jurisdiction is outside the accepting authority scope'; end if;
  if r.asset_id is not null then select criticality into v_criticality from assets where id=r.asset_id and organization_id=v_org; end if;
  if jsonb_array_length(l.asset_criticality_levels)>0 and
     (v_criticality is null or not (l.asset_criticality_levels ? v_criticality)) then
    raise exception 'extended authority: asset criticality is outside the accepting authority scope'; end if;
  if l.max_decision_value is not null and coalesce(r.value_at_risk,0)>l.max_decision_value then
    raise exception 'extended authority: accepted value exceeds the authority ceiling'; end if;
  if l.independent_assurance_above_level is not null and
     risk_rank(new.risk_level)>=risk_rank(l.independent_assurance_above_level) then
    if not exists(select 1 from risk_assurance_reviews ar where ar.organization_id=v_org
      and ar.risk_id=r.id and ar.assurance_level='independent' and ar.status='completed'
      and ar.reviewer_id<>new.accepted_by
      and ar.conclusion in ('acceptable','acceptable_with_actions')) then
      raise exception 'extended authority: independent assurance by a different person is required for acceptance'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_extended_risk_acceptance_authority on risk_acceptances;
create trigger trg_extended_risk_acceptance_authority before insert on risk_acceptances
  for each row execute function public.enforce_extended_risk_acceptance_authority();

-- ---------------------------------------------------------------------------
-- Enterprise architecture and dedicated decision-operation projections
-- ---------------------------------------------------------------------------
create or replace function public.get_sensitive_risk_operating_cockpit()
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_base jsonb; v_risks jsonb; v_aggregate jsonb;
  v_breakdown jsonb; v_effectiveness jsonb; v_capacity numeric:=0; v_combined numeric:=0;
  v_total int:=0; v_visible int:=0;
  v_realized int:=0; v_overdue int:=0; v_control_failures int:=0; v_overdue_reviews int:=0;
  v_overturned int:=0; v_accept_exceeded int:=0; v_verified int:=0; v_verified_effective int:=0;
  v_decisions int:=0; v_decisions_with_risk int:=0; v_emerging int:=0;
  v_cycle numeric; v_risk_to_action numeric; v_index numeric; v_treatment_rate numeric;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  v_base:=get_risk_operating_cockpit();
  select count(*) into v_total from risks where organization_id=v_org and status<>'archived';
  select count(*) into v_visible from risks where organization_id=v_org and status<>'archived' and can_read_risk(id);
  select coalesce(jsonb_agg(item order by item->>'title'),'[]'::jsonb) into v_risks
  from jsonb_array_elements(coalesce(v_base->'risks','[]'::jsonb)) item
  where can_read_risk((item->>'id')::uuid);
  select coalesce(nullif(c.risk_capacity->>'capacity_limit','')::numeric,0) into v_capacity
  from risk_criteria_profiles c where c.organization_id=v_org and c.status='adopted'
  order by c.version desc limit 1;
  with visible as (
    select coalesce(current_risk_score,exposure,0)::numeric score from risks
    where organization_id=v_org and status not in ('closed','archived') and can_read_risk(id)
  ) select case when count(*)=0 then 0 when bool_or(score>=100) then 100
      else 100*(1-exp(sum(ln(greatest(1-score/100,0.000001))))) end
    into v_combined from visible;
  select jsonb_build_object(
    'individual_exposure',coalesce(sum(coalesce(r.current_risk_score,r.exposure,0)),0),
    'combined_exposure',round(coalesce(v_combined,0),1),
    'open_risks',count(*),
    'connections',(select count(*) from risk_links l where l.organization_id=v_org
      and can_read_risk(l.source_risk_id) and can_read_risk(l.target_risk_id)),
    'common_dependencies',coalesce((select jsonb_agg(jsonb_build_object('dependency_key',dependency_key,'risks',n))
      from (select dependency_key,count(distinct source_risk_id)+count(distinct target_risk_id) n
        from risk_links where organization_id=v_org and dependency_key is not null
          and can_read_risk(source_risk_id) and can_read_risk(target_risk_id)
        group by dependency_key) q),'[]'::jsonb),
    'capacity_limit',coalesce(v_capacity,0),
    'committed_capacity',round(coalesce(v_combined,0),1),
    'capacity_remaining',greatest(coalesce(v_capacity,0)-coalesce(v_combined,0),0),
    'within_capacity',coalesce(v_combined,0)<=coalesce(v_capacity,0),
    'restricted_records_excluded',v_total-v_visible,
    'basis','Sensitivity-filtered complement aggregation; restricted records outside the caller authority are excluded.'
  ) into v_aggregate from risks r where r.organization_id=v_org
    and r.status not in ('closed','archived') and can_read_risk(r.id);
  select jsonb_build_object(
    'value_at_risk_by_currency',coalesce((select jsonb_agg(jsonb_build_object('currency',value_currency,'value_at_risk',value))
      from (select value_currency,round(sum(coalesce(value_at_risk,0)),2) value from risks
        where organization_id=v_org and status<>'archived' and can_read_risk(id) group by value_currency) q),'[]'::jsonb),
    'risk_reduction_achieved',coalesce((select round(sum(greatest(coalesce(inherent_risk_score,0)-coalesce(current_risk_score,0),0)),1)
      from risks where organization_id=v_org and status<>'archived' and can_read_risk(id)),0),
    'accepted_risks',(select count(*) from risk_acceptances a where a.organization_id=v_org and a.subject_type='risk'
      and a.status='active' and can_read_risk(a.subject_id)),
    'by_site',coalesce((select jsonb_agg(jsonb_build_object('site',site,'risks',risks,'exposure',exposure))
      from (select coalesce(s.name,'Unassigned') site,count(*) risks,round(sum(coalesce(r.current_risk_score,0)),1) exposure
        from risks r left join sites s on s.id=r.site_id where r.organization_id=v_org and r.status<>'archived'
          and can_read_risk(r.id) group by s.name) q),'[]'::jsonb),
    'by_objective',coalesce((select jsonb_agg(jsonb_build_object('objective',objective,'risks',risks,'exposure',exposure))
      from (select objective_at_risk objective,count(*) risks,round(sum(coalesce(current_risk_score,0)),1) exposure
        from risks where organization_id=v_org and status<>'archived' and can_read_risk(id)
        group by objective_at_risk) q),'[]'::jsonb),
    'restricted_records_excluded',v_total-v_visible
  ) into v_breakdown;
  select count(*) filter(where event_type='risk_realized'),
    count(*) filter(where event_type in ('risk_treatment_failed','risk_treatment_inconclusive')),
    count(*) filter(where event_type='emerging_risk_detected')
  into v_realized,v_overturned,v_emerging from learning_events l
  where l.organization_id=v_org and l.risk_id is not null and can_read_risk(l.risk_id);
  select count(*) into v_overdue from recommendations rec where rec.organization_id=v_org
    and rec.risk_id is not null and rec.required_completion_date<current_date
    and rec.status not in ('completed','rejected','dismissed') and can_read_risk(rec.risk_id);
  select count(distinct t.id) into v_control_failures from risk_control_tests t
    join risk_control_links l on l.control_id=t.control_id where t.organization_id=v_org
    and (t.result='failed' or t.failures_despite_control>0) and can_read_risk(l.risk_id);
  select count(*) into v_overdue_reviews from risks where organization_id=v_org
    and review_date<current_date and status not in ('closed','archived') and can_read_risk(id);
  select count(*) into v_accept_exceeded from risk_acceptances a join risks r on r.id=a.subject_id
    where a.organization_id=v_org and a.subject_type='risk' and a.status='active' and a.expires_at>now()
      and risk_rank(r.current_risk_level)>risk_rank(a.risk_level) and can_read_risk(r.id);
  select count(*),count(*) filter(where v.result='achieved') into v_verified,v_verified_effective
    from verification_obligations v join recommendations rec on rec.id=v.recommendation_id
    where v.organization_id=v_org and rec.risk_id is not null and v.status='completed'
      and can_read_risk(rec.risk_id);
  select count(*),count(*) filter(where d.risk_id is not null),
    avg(extract(epoch from (d.created_at-r.created_at))/3600.0) filter(where d.risk_id is not null)
  into v_decisions,v_decisions_with_risk,v_cycle from decisions d left join risks r on r.id=d.risk_id
    where d.organization_id=v_org and (d.risk_id is null or can_read_risk(d.risk_id));
  select avg(extract(epoch from (started.started_at-r.created_at))/3600.0)
  into v_risk_to_action from risks r join lateral (
    select min(w.created_at) started_at from recommendations rec join work_orders w on w.recommendation_id=rec.id
    where rec.risk_id=r.id and w.organization_id=v_org and w.status in ('in_progress','completed')
  ) started on started.started_at is not null
  where r.organization_id=v_org and can_read_risk(r.id);
  if v_verified>0 then v_treatment_rate:=100.0*v_verified_effective/v_verified; end if;
  if v_verified>0 and v_decisions>0 then
    v_index:=greatest(0,least(100,50.0*v_verified_effective/v_verified+
      50.0*v_decisions_with_risk/v_decisions-
      least(30,v_realized*5+v_control_failures*3+v_accept_exceeded*10)));
  end if;
  select jsonb_build_object(
    'effectiveness_index',round(v_index,1),
    'risks_realized_despite_controls',v_realized,
    'overdue_treatments',v_overdue,
    'repeated_control_failures',v_control_failures,
    'overdue_risk_reviews',v_overdue_reviews,
    'decisions_overturned_or_treatments_failed',v_overturned,
    'accepted_risks_above_acceptance',v_accept_exceeded,
    'treatments_verified',v_verified,
    'treatments_verified_effective',v_verified_effective,
    'treatment_effectiveness_rate',round(v_treatment_rate,1),
    'significant_decisions_total',v_decisions,
    'significant_decisions_with_risk_assessment',v_decisions_with_risk,
    'emerging_risks_detected',v_emerging,
    'average_decision_cycle_hours',round(v_cycle,1),
    'average_risk_to_action_cycle_hours',round(v_risk_to_action,1),
    'basis',case when v_index is null then
      'Insufficient visible verified outcomes and decisions to calculate an effectiveness index.'
      else 'Sensitivity-filtered verified treatment and risk-supported decision rates, penalized by visible realized risk, control failure and exceeded acceptance.' end,
    'restricted_records_excluded',v_total-v_visible
  ) into v_effectiveness;
  return jsonb_set(jsonb_set(jsonb_set(jsonb_set(v_base,'{risks}',v_risks),
    '{aggregate}',v_aggregate),'{portfolio_breakdown}',v_breakdown),'{effectiveness}',v_effectiveness);
end;
$$;
grant execute on function public.get_sensitive_risk_operating_cockpit() to authenticated,service_role;
revoke execute on function public.get_sensitive_risk_operating_cockpit() from public, anon;

create or replace function public.get_risk_enterprise_architecture()
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  return jsonb_build_object(
    'objectives',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc)
      from risk_objectives o where o.organization_id=v_org),'[]'::jsonb),
    'stakeholders',coalesce((select jsonb_agg(to_jsonb(s) order by s.name)
      from risk_stakeholders s where s.organization_id=v_org and s.active),'[]'::jsonb),
    'obligations',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc)
      from risk_obligations o where o.organization_id=v_org),'[]'::jsonb),
    'assumptions',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from risk_assumptions a where a.organization_id=v_org and can_read_risk(a.risk_id)),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc)
      from risk_sources s where s.organization_id=v_org and can_read_risk(s.risk_id)),'[]'::jsonb),
    'consequences',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc)
      from risk_consequences c where c.organization_id=v_org and can_read_risk(c.risk_id)),'[]'::jsonb),
    'likelihood_estimates',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc)
      from risk_likelihood_estimates l where l.organization_id=v_org and can_read_risk(l.risk_id)),'[]'::jsonb),
    'event_scenarios',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc)
      from risk_event_scenarios s where s.organization_id=v_org and (s.risk_id is null or can_read_risk(s.risk_id))),'[]'::jsonb)
  ) || jsonb_build_object(
    'stress_tests',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc)
      from risk_stress_tests t where t.organization_id=v_org and can_read_risk_set(t.risk_ids)),'[]'::jsonb),
    'treatment_dependencies',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc)
      from risk_treatment_dependencies d where d.organization_id=v_org
        and exists(select 1 from scenarios s where s.id=d.scenario_id
          and (s.risk_id is null or can_read_risk(s.risk_id)))
        and exists(select 1 from scenarios s where s.id=d.depends_on_scenario_id
          and (s.risk_id is null or can_read_risk(s.risk_id)))),'[]'::jsonb),
    'challenges',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc)
      from risk_challenges c where c.organization_id=v_org and can_read_risk(c.risk_id)),'[]'::jsonb),
    'assurance_reviews',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from risk_assurance_reviews a where a.organization_id=v_org
        and can_read_risk_subject(a.subject_type,a.subject_id,a.risk_id)),'[]'::jsonb),
    'communications',coalesce((select jsonb_agg(to_jsonb(c) order by c.communicated_at desc)
      from risk_communications c where c.organization_id=v_org and can_read_risk(c.risk_id)),'[]'::jsonb),
    'learning_transfers',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc)
      from risk_learning_transfers t join learning_events l on l.id=t.learning_event_id
      where t.organization_id=v_org and (l.risk_id is null or can_read_risk(l.risk_id))),'[]'::jsonb),
    'reassessment_queue',coalesce((select jsonb_agg(jsonb_build_object('risk_id',r.id,'title',r.title,
      'reason',r.reassessment_reason,'status',r.status) order by r.updated_at desc)
      from risks r where r.organization_id=v_org and r.reassessment_required and can_read_risk(r.id)),'[]'::jsonb),
    'expiring_controls',coalesce((select jsonb_agg(jsonb_build_object('control_id',c.id,'name',c.name,
      'lifecycle_kind',c.lifecycle_kind,'expires_on',c.expires_on,'sunset_action',c.sunset_action)
      order by c.expires_on) from risk_controls c where c.organization_id=v_org
      and c.lifecycle_kind in ('temporary','compensating') and c.design_status='implemented'
      and exists(select 1 from risk_control_links l where l.control_id=c.id and can_read_risk(l.risk_id))),'[]'::jsonb),
    'learning_events',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc)
      from learning_events l where l.organization_id=v_org and l.risk_id is not null
        and can_read_risk(l.risk_id)),'[]'::jsonb),
    'integrations',coalesce((select jsonb_agg(to_jsonb(i) order by i.name)
      from integrations i where i.organization_id=v_org),'[]'::jsonb),
    'agents',coalesce((select jsonb_agg(to_jsonb(a) order by a.name)
      from ai_agents a where a.organization_id=v_org),'[]'::jsonb)
  );
end;
$$;
grant execute on function public.get_risk_enterprise_architecture() to authenticated,service_role;

create or replace function public.get_risk_decision_operations()
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text;
  v_actions numeric:=0; v_overdue numeric:=0; v_learning numeric:=0; v_misses numeric:=0;
  v_controls numeric:=0; v_overrides numeric:=0; v_reviews numeric:=0; v_late numeric:=0;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select count(*),count(*) filter(where required_completion_date<current_date and status not in ('approved','rejected','dismissed'))
    into v_actions,v_overdue from recommendations where organization_id=v_org and risk_id is not null
      and can_read_risk(risk_id);
  select count(*),count(*) filter(where event_type in ('risk_treatment_failed','risk_realized','false_negative'))
    into v_learning,v_misses from learning_events where organization_id=v_org and risk_id is not null
      and can_read_risk(risk_id);
  select count(distinct c.id) into v_controls from risk_controls c join risk_control_links l on l.control_id=c.id
    where c.organization_id=v_org and c.design_status='implemented' and can_read_risk(l.risk_id);
  select count(*) into v_overrides from audit_events where organization_id=v_org and entity_type='risk_control_override';
  select count(*),count(*) filter(where review_date<current_date and status not in ('closed','archived'))
    into v_reviews,v_late from risks where organization_id=v_org and can_read_risk(id);
  return jsonb_build_object(
    'my_decisions',coalesce((select jsonb_agg(jsonb_build_object(
      'decision_id',d.id,'risk_id',r.id,'risk_title',r.title,'objective',r.objective_at_risk,
      'action',d.risk_decision_action,'exposure',r.current_risk_score,'value_at_risk',r.value_at_risk,
      'currency',r.value_currency,'confidence',d.confidence_score,'created_at',d.created_at,
      'required_role',a.owner_role,'approval_status',d.approval_status) order by d.created_at)
      from decisions d join risks r on r.id=d.risk_id
      left join approvals a on a.decision_id=d.id and a.organization_id=v_org
      where d.organization_id=v_org and d.risk_id is not null and can_read_risk(r.id)
        and d.approval_status='pending' and (a.owner_role=v_role or v_role in ('admin','ai_admin','executive'))),'[]'::jsonb),
    'treatment_portfolio',coalesce((select jsonb_agg(jsonb_build_object(
      'recommendation_id',rec.id,'risk_id',r.id,'risk_title',r.title,'action',rec.action,
      'status',rec.status,'cost',rec.estimated_cost_usd,'original_risk',rec.original_risk_score,
      'expected_residual_risk',rec.expected_residual_risk_score,'net_risk_change',rec.net_risk_change,
      'readiness',rec.resource_readiness,'owner_id',rec.treatment_owner_id,
      'required_date',rec.required_completion_date) order by rec.required_completion_date)
      from recommendations rec join risks r on r.id=rec.risk_id
      where rec.organization_id=v_org and can_read_risk(r.id)),'[]'::jsonb),
    'emerging_risks',coalesce((select jsonb_agg(jsonb_build_object(
      'risk_id',r.id,'title',r.title,'objective',r.objective_at_risk,'score',r.current_risk_score,
      'velocity',r.risk_velocity,'status',r.status,'source_kind',r.source_kind,
      'critical_indicators',(select count(*) from risk_indicators i where i.risk_id=r.id and i.current_state='critical'))
      order by r.risk_velocity desc nulls last)
      from risks r where r.organization_id=v_org and can_read_risk(r.id) and r.status not in ('closed','archived')
        and (r.risk_velocity>0 or r.status in ('discovered','context_changed','reassessment') or exists(
          select 1 from risk_indicators i where i.risk_id=r.id and i.current_state in ('warning','critical')))),'[]'::jsonb)
  ) || jsonb_build_object(
    'decision_history',coalesce((select jsonb_agg(jsonb_build_object(
      'decision_id',d.id,'risk_id',r.id,'risk_title',r.title,'action',d.risk_decision_action,
      'status',d.approval_status,'rationale',d.rationale,'actor',d.human_actor,'created_at',d.created_at,
      'outcome_status',d.outcome_status,'reassessment_required',d.reassessment_required)
      order by d.created_at desc)
      from decisions d join risks r on r.id=d.risk_id where d.organization_id=v_org
        and d.risk_id is not null and can_read_risk(r.id)),'[]'::jsonb),
    'board_evidence_pack',jsonb_build_object(
      'open_challenges',(select count(*) from risk_challenges where organization_id=v_org and status='open'
        and can_read_risk(risk_id)),
      'independent_assurance_completed',(select count(*) from risk_assurance_reviews
        where organization_id=v_org and assurance_level='independent' and status='completed'
          and (risk_id is null or can_read_risk(risk_id))),
      'reassessment_required',(select count(*) from risks where organization_id=v_org and reassessment_required
        and can_read_risk(id)),
      'temporary_controls_expiring',(select count(distinct c.id) from risk_controls c
        join risk_control_links l on l.control_id=c.id where c.organization_id=v_org
        and c.lifecycle_kind in ('temporary','compensating') and c.expires_on<=current_date+30
        and c.design_status='implemented' and can_read_risk(l.risk_id)),
      'learning_transfers_pending',(select count(*) from risk_learning_transfers t
        join learning_events l on l.id=t.learning_event_id where t.organization_id=v_org and t.status='proposed'
          and (l.risk_id is null or can_read_risk(l.risk_id)))),
    'culture_signals',jsonb_build_array(
      jsonb_build_object('key','overdue_actions','rate',case when v_actions>0 then v_overdue/v_actions else null end,
        'count',v_overdue,'evidence_only',true),
      jsonb_build_object('key','optimism_or_treatment_miss','rate',case when v_learning>0 then v_misses/v_learning else null end,
        'count',v_misses,'evidence_only',true),
      jsonb_build_object('key','control_override','rate',case when v_controls>0 then v_overrides/v_controls else null end,
        'count',v_overrides,'evidence_only',true),
      jsonb_build_object('key','late_risk_review','rate',case when v_reviews>0 then v_late/v_reviews else null end,
        'count',v_late,'evidence_only',true))
  );
end;
$$;
grant execute on function public.get_risk_decision_operations() to authenticated,service_role;

-- Existing connector and agent registries are extended in place. Credentials
-- remain in the platform's secret/connector layer; these rows contain only
-- approved mappings and operating boundaries.
alter table integrations
  add column if not exists risk_connector_kind text check (risk_connector_kind is null or risk_connector_kind in
    ('sap_eam','maximo','oracle_eam','historian','scada','mes','dispatch','condition_monitoring',
     'engineering_documents','inspection','financial_erp','workforce','inventory','supplier')),
  add column if not exists risk_signal_mapping jsonb not null default '{}'::jsonb,
  add column if not exists risk_evidence_mapping jsonb not null default '{}'::jsonb,
  add column if not exists risk_work_mapping jsonb not null default '{}'::jsonb,
  add column if not exists risk_direction text check (risk_direction is null or risk_direction in
    ('inbound','outbound','bidirectional')),
  add column if not exists risk_binding_approved boolean not null default false,
  add column if not exists risk_binding_approved_by uuid references auth.users(id),
  add column if not exists risk_binding_approved_at timestamptz;

create or replace function public.configure_risk_integration_binding(p_integration_id uuid,p_binding jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_role text; v_approve boolean:=coalesce((p_binding->>'approve')::boolean,false);
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin') then return jsonb_build_object('error','forbidden'); end if;
  if not exists(select 1 from integrations where id=p_integration_id and organization_id=v_org) then
    return jsonb_build_object('error','integration not found in this organization'); end if;
  if p_binding->>'connector_kind' not in
    ('sap_eam','maximo','oracle_eam','historian','scada','mes','dispatch','condition_monitoring',
     'engineering_documents','inspection','financial_erp','workforce','inventory','supplier') or
     p_binding->>'direction' not in ('inbound','outbound','bidirectional') then
    return jsonb_build_object('error','valid connector kind and direction are required'); end if;
  if v_approve and (jsonb_typeof(coalesce(p_binding->'evidence_mapping','{}'::jsonb))<>'object' or
      jsonb_typeof(coalesce(p_binding->'signal_mapping','{}'::jsonb))<>'object' or
      coalesce(length(btrim(p_binding->>'approval_basis')),0)<10) then
    return jsonb_build_object('error','approved bindings require mappings and an approval basis'); end if;
  update integrations set risk_connector_kind=p_binding->>'connector_kind',
    risk_signal_mapping=coalesce(p_binding->'signal_mapping','{}'::jsonb),
    risk_evidence_mapping=coalesce(p_binding->'evidence_mapping','{}'::jsonb),
    risk_work_mapping=coalesce(p_binding->'work_mapping','{}'::jsonb),
    risk_direction=p_binding->>'direction',risk_binding_approved=v_approve,
    risk_binding_approved_by=case when v_approve then auth.uid() end,
    risk_binding_approved_at=case when v_approve then now() end
  where id=p_integration_id and organization_id=v_org;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_integration_binding',v_role,jsonb_build_object('integration_id',p_integration_id,
    'connector_kind',p_binding->>'connector_kind','direction',p_binding->>'direction',
    'approved',v_approve,'approval_basis',p_binding->>'approval_basis'));
  return jsonb_build_object('integration_id',p_integration_id,'approved',v_approve);
end;
$$;
grant execute on function public.configure_risk_integration_binding(uuid,jsonb) to authenticated,service_role;

alter table ai_agents drop constraint if exists ai_agents_no_risk_authority;
alter table ai_agents
  add column if not exists risk_engine_key text check (risk_engine_key is null or risk_engine_key in
    ('context','criteria','identification','analysis','evaluation','treatment','execution',
     'assurance','monitoring','learning','governance','evidence')),
  add column if not exists risk_evidence_only boolean not null default true,
  add column if not exists risk_may_approve boolean not null default false,
  add column if not exists risk_may_accept boolean not null default false,
  add column if not exists risk_charter jsonb not null default '{}'::jsonb check
    (jsonb_typeof(risk_charter)='object'),
  add constraint ai_agents_no_risk_authority check (not risk_may_approve and not risk_may_accept);

update ai_agents set risk_charter=jsonb_build_object(
  'purpose','Advisory support for the '||risk_engine_key||' risk engine',
  'triggers','[]'::jsonb,'outputs','[]'::jsonb,
  'guardrails',jsonb_build_array('Use governed evidence and adopted criteria',
    'Expose uncertainty and limitations','Never approve work or accept risk',
    'Route consequential decisions to accountable humans'))
where risk_engine_key is not null and risk_charter='{}'::jsonb;

create or replace function public.provision_risk_advisory_agents()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; item record; v_id uuid;
  v_agents jsonb:='[]'::jsonb;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin') then return jsonb_build_object('error','forbidden'); end if;
  for item in select * from (values
    ('sync-risk-context','Sync Context Agent','context','Maintains objective, context, stakeholder and obligation gaps.',
      jsonb_build_array('context change','objective review','obligation review'),
      jsonb_build_array('draft context gap','objective traceability gap','obligation applicability gap')),
    ('sync-risk-discovery','Sync Risk Discovery Agent','identification','Finds threats, opportunities, near misses and weak signals.',
      jsonb_build_array('new evidence','indicator anomaly','context change'),
      jsonb_build_array('candidate risk','weak-signal cluster','evidence gap')),
    ('sync-risk-evidence','Sync Evidence Agent','evidence','Builds provenance-preserving evidence packs and quality assessments.',
      jsonb_build_array('assessment requested','decision pending','assurance review'),
      jsonb_build_array('evidence pack','quality finding','missing evidence')),
    ('sync-risk-analysis','Sync Risk Analysis Agent','analysis','Applies the selected governed analysis method and exposes uncertainty.',
      jsonb_build_array('analysis requested','new measurement','assumption changed'),
      jsonb_build_array('analysis result','confidence interval','model limitation')),
    ('sync-risk-treatment','Sync Treatment Agent','treatment','Compares treatment alternatives, trade-offs, residual and introduced risk.',
      jsonb_build_array('treatment required','control failure','decision request'),
      jsonb_build_array('treatment options','readiness gaps','residual risk estimate')),
    ('sync-risk-decision','Sync Decision Agent','evaluation','Prepares decision evidence and authority routing without deciding.',
      jsonb_build_array('evaluation complete','threshold breach','approval requested'),
      jsonb_build_array('recommended action','authority gap','approval route')),
    ('sync-risk-assurance','Sync Control Assurance Agent','assurance','Evaluates control design, implementation, performance and evidence.',
      jsonb_build_array('test due','control failure','independent review'),
      jsonb_build_array('assurance finding','control effectiveness','corrective action proposal')),
    ('sync-risk-monitoring','Sync Monitoring Agent','monitoring','Watches indicators, velocity, thresholds, expiries and context changes.',
      jsonb_build_array('signal received','review due','temporary control nearing expiry'),
      jsonb_build_array('monitoring alert','reassessment proposal','emerging risk signal')),
    ('sync-risk-learning','Sync Learning Agent','learning','Attributes outcomes and proposes transferable learning.',
      jsonb_build_array('outcome recorded','treatment verified','risk realized'),
      jsonb_build_array('outcome attribution draft','learning event','transfer proposal')),
    ('sync-risk-governance','Sync Governance Agent','governance','Monitors framework health, authority, segregation and expected behavior.',
      jsonb_build_array('framework review due','authority exception','culture signal'),
      jsonb_build_array('framework health finding','governance exception','board evidence draft'))
  ) as charter(agent_key,agent_name,engine_key,purpose,triggers,outputs) loop
    select id into v_id from ai_agents where organization_id=v_org and key=item.agent_key
      order by created_at limit 1;
    if v_id is null then
      insert into ai_agents(organization_id,key,name,category,status,autonomy_mode,risk_engine_key,
        risk_evidence_only,risk_may_approve,risk_may_accept,risk_charter)
      values(v_org,item.agent_key,item.agent_name,'risk','active','advisory',item.engine_key,
        true,false,false,jsonb_build_object('purpose',item.purpose,'triggers',item.triggers,
          'outputs',item.outputs,'guardrails',jsonb_build_array(
            'Use governed evidence and adopted criteria','Expose uncertainty and limitations',
            'Never approve work or accept risk','Route consequential decisions to accountable humans')))
      returning id into v_id;
    else
      update ai_agents set name=item.agent_name,category='risk',status='active',autonomy_mode='advisory',
        risk_engine_key=item.engine_key,risk_evidence_only=true,risk_may_approve=false,risk_may_accept=false,
        risk_charter=jsonb_build_object('purpose',item.purpose,'triggers',item.triggers,
          'outputs',item.outputs,'guardrails',jsonb_build_array(
            'Use governed evidence and adopted criteria','Expose uncertainty and limitations',
            'Never approve work or accept risk','Route consequential decisions to accountable humans'))
      where id=v_id;
    end if;
    v_agents:=v_agents||jsonb_build_array(jsonb_build_object('agent_id',v_id,'key',item.agent_key,
      'name',item.agent_name,'engine_key',item.engine_key,'advisory',true));
  end loop;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_agent_provisioning',v_role,jsonb_build_object('agents',v_agents,
    'may_approve',false,'may_accept',false));
  return jsonb_build_object('agents',v_agents,'count',jsonb_array_length(v_agents),
    'evidence_only',true,'may_approve',false,'may_accept',false);
end;
$$;
grant execute on function public.provision_risk_advisory_agents() to authenticated,service_role;

create or replace function public.configure_risk_agent_binding(p_agent_id uuid,p_engine_key text,p_basis text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_role text;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin') then return jsonb_build_object('error','forbidden'); end if;
  if p_engine_key not in ('context','criteria','identification','analysis','evaluation','treatment','execution',
    'assurance','monitoring','learning','governance','evidence') then
    return jsonb_build_object('error','invalid risk engine'); end if;
  if coalesce(length(btrim(p_basis)),0)<10 then return jsonb_build_object('error','record the agent binding basis'); end if;
  update ai_agents set risk_engine_key=p_engine_key,risk_evidence_only=true,
    risk_may_approve=false,risk_may_accept=false,autonomy_mode='advisory',
    risk_charter=jsonb_build_object('purpose',btrim(p_basis),'triggers','[]'::jsonb,
      'outputs',jsonb_build_array('evidence-grounded advisory work product'),
      'guardrails',jsonb_build_array('Use governed evidence and adopted criteria',
        'Expose uncertainty and limitations','Never approve work or accept risk',
        'Route consequential decisions to accountable humans'))
  where id=p_agent_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','agent not found in this organization'); end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_agent_binding',v_role,jsonb_build_object('agent_id',p_agent_id,
    'engine_key',p_engine_key,'basis',btrim(p_basis),'may_approve',false,'may_accept',false));
  return jsonb_build_object('agent_id',p_agent_id,'engine_key',p_engine_key,
    'evidence_only',true,'may_approve',false,'may_accept',false);
end;
$$;
grant execute on function public.configure_risk_agent_binding(uuid,text,text) to authenticated,service_role;

-- Public and anonymous callers cannot execute the governed mutation surface.
revoke execute on function public.upsert_risk_objective(jsonb) from public, anon;
revoke execute on function public.adopt_risk_objective(uuid,text) from public, anon;
revoke execute on function public.link_risk_objective(uuid,uuid) from public, anon;
revoke execute on function public.upsert_risk_stakeholder(jsonb) from public, anon;
revoke execute on function public.record_risk_obligation(jsonb) from public, anon;
revoke execute on function public.adopt_risk_obligation(uuid,text) from public, anon;
revoke execute on function public.link_risk_obligation(uuid,uuid,text) from public, anon;
revoke execute on function public.record_risk_assumption(uuid,jsonb) from public, anon;
revoke execute on function public.create_risk_objective_version(uuid,jsonb,text) from public, anon;
revoke execute on function public.create_risk_obligation_version(uuid,jsonb,text) from public, anon;
revoke execute on function public.invalidate_risk_assumption(uuid,text) from public, anon;
revoke execute on function public.record_risk_analysis_element(uuid,text,jsonb) from public, anon;
revoke execute on function public.record_risk_likelihood_estimate(uuid,jsonb) from public, anon;
revoke execute on function public.record_risk_event_scenario(jsonb) from public, anon;
revoke execute on function public.record_risk_stress_test(jsonb) from public, anon;
revoke execute on function public.link_risk_treatment_dependency(jsonb) from public, anon;
revoke execute on function public.configure_risk_control_lifecycle(uuid,jsonb) from public, anon;
revoke execute on function public.record_risk_challenge(jsonb) from public, anon;
revoke execute on function public.resolve_risk_challenge(uuid,text,jsonb) from public, anon;
revoke execute on function public.record_risk_assurance_review(jsonb) from public, anon;
revoke execute on function public.record_risk_communication(jsonb) from public, anon;
revoke execute on function public.record_risk_learning_transfer(jsonb) from public, anon;
revoke execute on function public.decide_risk_learning_transfer(uuid,boolean,text) from public, anon;
revoke execute on function public.record_risk_outcome_attribution(uuid,jsonb) from public, anon;
revoke execute on function public.configure_risk_authority_scope(uuid,jsonb) from public, anon;
revoke execute on function public.configure_risk_integration_binding(uuid,jsonb) from public, anon;
revoke execute on function public.configure_risk_agent_binding(uuid,text,text) from public, anon;
revoke execute on function public.provision_risk_advisory_agents() from public, anon;
revoke execute on function public.transition_risk_lifecycle(uuid,text,text) from public, anon;
revoke execute on function public.refresh_risk_governance_state() from public, anon;
revoke execute on function public.can_read_risk(uuid) from public, anon;
revoke execute on function public.can_read_risk_set(jsonb) from public, anon;
revoke execute on function public.can_read_risk_subject(text,uuid,uuid) from public, anon;
grant execute on function public.can_read_risk(uuid) to authenticated, service_role;
grant execute on function public.can_read_risk_set(jsonb) to authenticated, service_role;
grant execute on function public.can_read_risk_subject(text,uuid,uuid) to authenticated, service_role;
revoke execute on function public.propagate_risk_context_change() from public, anon, authenticated;
revoke execute on function public.propagate_risk_objective_change() from public, anon, authenticated;
revoke execute on function public.propagate_risk_obligation_change() from public, anon, authenticated;
revoke execute on function public.enforce_extended_risk_decision_authority() from public, anon, authenticated;
revoke execute on function public.enforce_extended_risk_acceptance_authority() from public, anon, authenticated;
revoke execute on function public.get_risk_enterprise_architecture() from public, anon;
revoke execute on function public.get_risk_decision_operations() from public, anon;

notify pgrst,'reload schema';
