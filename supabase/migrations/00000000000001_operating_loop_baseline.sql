-- ============================================================================
-- SyncAI Operating-Loop Baseline
-- ----------------------------------------------------------------------------
-- Consolidated, self-contained schema for the core buyer-value loop:
--   Mission Control → AI Recommendation → Evidence → Scenario → Approval
--   → Work Action → Decision → Value Realization → Learning Loop
--
-- This baseline replaces the broken legacy migration chain (archived under
-- supabase/_legacy_migrations) for local development + demo. Tables already
-- present in a deployed environment are guarded with CREATE TABLE IF NOT EXISTS
-- so promotion is additive and non-destructive.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Tenancy + identity
-- ----------------------------------------------------------------------------
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text default 'oil_sands',
  created_at timestamptz not null default now()
);

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  location text,
  created_at timestamptz not null default now()
);

create table if not exists user_profiles (
  id uuid primary key,
  organization_id uuid references organizations(id) on delete set null,
  email text,
  full_name text,
  role text default 'reliability_engineer',
  created_at timestamptz not null default now()
);

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text
);

create table if not exists user_role_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  user_id uuid references user_profiles(id) on delete cascade,
  role_id uuid references roles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists raci_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  decision_type text not null,
  accountable text,
  responsible text,
  consulted text,
  informed text
);

-- ----------------------------------------------------------------------------
-- Assets + telemetry
-- ----------------------------------------------------------------------------
create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  tag text,
  name text not null,
  asset_class text,
  criticality text default 'medium',     -- critical | high | medium | low
  status text default 'healthy',          -- healthy | watch | critical
  health_score int default 100,
  risk_score int default 0,
  area text,
  system text,
  manufacturer text,
  model text,
  serial_number text,
  installed_date date,
  created_at timestamptz not null default now()
);

create table if not exists components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  name text not null,
  type text,
  created_at timestamptz not null default now()
);

create table if not exists sensors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  name text not null,
  signal_type text,
  unit text,
  last_value numeric,
  threshold numeric,
  status text default 'normal',           -- normal | warning | alarm
  trend text default 'stable',            -- up | down | stable
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- AI workforce
-- ----------------------------------------------------------------------------
create table if not exists ai_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  key text,
  name text not null,
  category text,
  status text default 'active',           -- active | idle | paused | error
  autonomy_mode text default 'advisory',  -- advisory | conditional | controlled
  current_task text,
  recommendations_generated int default 0,
  actions_executed int default 0,
  approvals_pending int default 0,
  confidence int default 80,
  supervisor text,
  last_action text,
  last_action_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid references ai_agents(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  status text default 'completed',        -- running | completed | failed
  summary text,
  confidence int default 80,
  started_at timestamptz default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Recommendations + evidence + scenarios
-- ----------------------------------------------------------------------------
create table if not exists recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  agent_id uuid references ai_agents(id) on delete set null,
  title text not null,
  issue text,
  action text,
  impact text,
  confidence int default 80,
  urgency text default 'advisory',        -- critical | action | advisory
  status text default 'pending',          -- pending | approved | rejected | dismissed | escalated | modified
  approval_required text,
  accountable text,
  responsible text,
  consulted text,
  informed text,
  financial_impact text,
  risk_impact text default 'Medium',
  rationale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists evidence_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  recommendation_id uuid references recommendations(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  source_system text,
  evidence_type text,
  description text,
  confidence_contribution int default 0,
  data_quality text default 'good',
  related_asset text,
  ts timestamptz default now(),
  created_at timestamptz not null default now()
);

create table if not exists scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  recommendation_id uuid references recommendations(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  key text not null,                      -- execute_now | defer_7 | defer_14 | run_to_failure | replace_asset | repair_asset
  label text not null,
  cost numeric default 0,
  downtime_impact text,
  production_impact text,
  safety_risk text,
  environmental_risk text,
  financial_exposure text,
  mission_readiness_impact text,
  recommended boolean default false,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Governance: approvals + decisions
-- ----------------------------------------------------------------------------
create table if not exists work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  recommendation_id uuid references recommendations(id) on delete set null,
  wo_number text,
  title text not null,
  description text,
  status text default 'pending',          -- pending | approval | scheduled | in_progress | blocked | critical | completed
  priority text default 'medium',         -- critical | high | medium | low
  type text default 'ai_generated',       -- ai_generated | human_created
  assignee text,
  scheduled_date text,
  estimated_hours numeric default 0,
  parts_ready boolean default false,
  risk_score int default 0,
  financial_exposure text,
  production_impact text default 'Low',
  safety_flag boolean default false,
  approval_required boolean default false,
  created_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  recommendation_id uuid references recommendations(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete set null,
  status text default 'required',         -- required | approved | rejected | pending
  owner_role text,
  approver text,
  reason text,
  consequence_of_wrong text,
  required_validation text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  recommendation_id uuid references recommendations(id) on delete set null,
  agent_id uuid references ai_agents(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  decision_type text,                     -- pm_strategy | work_order | part_purchase | deferral | shutdown | onboarding_gate
  action_taken text,
  approval_status text default 'pending', -- pending | approved | rejected | autonomous
  autonomy_mode text default 'advisory',
  confidence_score int default 80,
  human_actor text,
  rationale text,
  outcome_status text default 'open',     -- open | executed | verified | reverted
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Value + learning
-- ----------------------------------------------------------------------------
create table if not exists value_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  recommendation_id uuid references recommendations(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  metric_type text not null,              -- downtime_avoided | maintenance_cost_savings | avoided_production_loss | risk_exposure_reduced | recommendations_accepted | autonomous_actions_executed | projected_annualized_value
  label text,
  value numeric default 0,
  unit text,                              -- usd | hours | percent | count
  status text default 'verified',         -- projected | verified | baseline_pending_validation
  period text,
  created_at timestamptz not null default now()
);

create table if not exists learning_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  recommendation_id uuid references recommendations(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  event_type text not null,               -- recommendation_accepted | recommendation_rejected | work_completed | false_positive | false_negative | lesson_learned | model_confidence
  title text,
  detail text,
  expected_value numeric,
  verified_value numeric,
  model_confidence int,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Cowork Studio + artifacts
-- ----------------------------------------------------------------------------
create table if not exists cowork_workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  title text not null,
  objective text,
  status text default 'active',           -- active | completed | draft
  agents text[] default '{}',
  progress int default 0,
  artifacts int default 0,
  next_action text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cowork_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  workspace_id uuid references cowork_workspaces(id) on delete cascade,
  agent text,
  role text default 'agent',              -- agent | user
  message text,
  confidence int,
  created_at timestamptz not null default now()
);

create table if not exists artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  workspace_id uuid references cowork_workspaces(id) on delete cascade,
  recommendation_id uuid references recommendations(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  type text,
  title text,
  content text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Integrations
-- ----------------------------------------------------------------------------
create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  category text,
  status text default 'connected',        -- connected | degraded | disconnected
  last_sync timestamptz,
  records_synced int default 0,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Asset onboarding persistence (consumed by assetOnboardingPersistence.ts)
-- ----------------------------------------------------------------------------
create table if not exists asset_onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id text unique not null,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id text,
  asset_class text,
  mode text,
  source text,
  status text,
  current_step text,
  completion_score int default 0,
  reliability_readiness text,
  readiness_message text,
  missing_fields jsonb default '[]',
  assumptions jsonb default '[]',
  recommendations jsonb default '[]',
  approval_required jsonb default '[]',
  session_payload jsonb,
  created_by uuid,
  created_by_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists asset_onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  organization_id uuid not null references organizations(id) on delete cascade,
  step_id text, step_name text, completion_status text,
  completion_score int, confidence_score int, source text,
  required_fields jsonb, optional_fields jsonb, validation_rules jsonb, outputs jsonb,
  answer text, step_payload jsonb, last_updated timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists asset_profiles_reliability (
  id uuid primary key default gen_random_uuid(),
  session_id text unique not null,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id text,
  identity jsonb, hierarchy jsonb, functional_definition jsonb, operating_context jsonb,
  criticality jsonb, existing_maintenance jsonb, condition_monitoring jsonb, spares jsonb,
  reliability_baseline jsonb, fracas_readiness jsonb, risk_safeguards jsonb, lifecycle jsonb,
  created_at timestamptz not null default now()
);

create table if not exists asset_failure_mode_libraries (
  id uuid primary key default gen_random_uuid(),
  session_id text, organization_id uuid not null references organizations(id) on delete cascade,
  asset_id text, failure_mode text, failure_mechanism text, cause text, effect text,
  detection_method text, consequence text, current_controls text, recommended_controls text,
  source text, created_at timestamptz not null default now()
);

create table if not exists asset_maintenance_strategy_recommendations (
  id uuid primary key default gen_random_uuid(),
  session_id text, organization_id uuid not null references organizations(id) on delete cascade,
  asset_id text, recommendation text, failure_mode_addressed text, risk_reduced text,
  evidence_used jsonb, assumptions jsonb, confidence text, required_approval text,
  implementation_work_order text, status text, created_at timestamptz not null default now()
);

create table if not exists asset_onboarding_evidence_items (
  id uuid primary key default gen_random_uuid(),
  session_id text, organization_id uuid not null references organizations(id) on delete cascade,
  asset_id text, evidence_type text, title text, source_reference text, confidence text,
  notes text, payload jsonb, created_by uuid, created_at timestamptz not null default now()
);

create table if not exists recommendation_approval_workflows (
  id uuid primary key default gen_random_uuid(),
  session_id text, organization_id uuid not null references organizations(id) on delete cascade,
  asset_id text, approval_reason text, owner_role text, status text,
  consequence_of_being_wrong text, required_validation text,
  created_at timestamptz not null default now()
);

create table if not exists asset_onboarding_exports (
  id uuid primary key default gen_random_uuid(),
  session_id text, organization_id uuid not null references organizations(id) on delete cascade,
  asset_id text, export_type text, filename text, mime_type text, content text,
  created_by uuid, created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Helpful indexes
-- ----------------------------------------------------------------------------
create index if not exists idx_assets_org on assets(organization_id);
create index if not exists idx_recs_org_status on recommendations(organization_id, status);
create index if not exists idx_recs_asset on recommendations(asset_id);
create index if not exists idx_evidence_rec on evidence_items(recommendation_id);
create index if not exists idx_scenarios_rec on scenarios(recommendation_id);
create index if not exists idx_work_orders_org on work_orders(organization_id);
create index if not exists idx_decisions_org on decisions(organization_id);
create index if not exists idx_value_org on value_metrics(organization_id);
create index if not exists idx_learning_org on learning_events(organization_id);
create index if not exists idx_cowork_msgs_ws on cowork_messages(workspace_id);
create index if not exists idx_agent_runs_org on agent_runs(organization_id);

-- ----------------------------------------------------------------------------
-- Row Level Security — org-scoped, authenticated
-- ----------------------------------------------------------------------------
create or replace function app_current_org()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.user_profiles where id = auth.uid()
$$;

do $$
declare
  t text;
  org_scoped text[] := array[
    'sites','roles','user_role_assignments','raci_assignments','assets','components',
    'sensors','ai_agents','agent_runs','recommendations','evidence_items','scenarios',
    'work_orders','approvals','decisions','value_metrics','learning_events',
    'cowork_workspaces','cowork_messages','artifacts','integrations',
    'asset_onboarding_sessions','asset_onboarding_steps','asset_profiles_reliability',
    'asset_failure_mode_libraries','asset_maintenance_strategy_recommendations',
    'asset_onboarding_evidence_items','recommendation_approval_workflows','asset_onboarding_exports'
  ];
begin
  foreach t in array org_scoped loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_org_rw', t);
    execute format(
      'create policy %I on %I for all to authenticated using (organization_id = app_current_org()) with check (organization_id = app_current_org())',
      t || '_org_rw', t
    );
  end loop;
end $$;

-- organizations: readable by members
alter table organizations enable row level security;
drop policy if exists organizations_member_read on organizations;
create policy organizations_member_read on organizations
  for select to authenticated using (id = app_current_org());

-- user_profiles: a user sees self + org peers
alter table user_profiles enable row level security;
drop policy if exists user_profiles_self_or_org on user_profiles;
create policy user_profiles_self_or_org on user_profiles
  for select to authenticated using (id = auth.uid() or organization_id = app_current_org());
drop policy if exists user_profiles_self_update on user_profiles;
create policy user_profiles_self_update on user_profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ----------------------------------------------------------------------------
-- App-shell compatibility (columns + RPC the existing shell expects)
-- ----------------------------------------------------------------------------
alter table roles add column if not exists code text;
alter table roles add column if not exists level int default 1;
alter table sites add column if not exists code text;

-- Used by the app shell to resolve the signed-in user's org + role context.
create or replace function get_current_user_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'organization_id', (select organization_id from public.user_profiles where id = auth.uid()),
    'role', (select role from public.user_profiles where id = auth.uid())
  )
$$;
grant execute on function get_current_user_context() to authenticated, anon;
