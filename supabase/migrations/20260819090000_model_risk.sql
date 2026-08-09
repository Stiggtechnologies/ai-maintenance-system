-- ============================================================================
-- AI safety, cybersecurity and model risk (register E5.03, E5.07–E5.11,
-- E5.14, E5.15).
--
-- Everything built in this programme rests on numbers this platform produces:
-- health scores, risk scores, recommended intervals, allocated availabilities.
-- This slice is the platform's governance of itself, and its central finding
-- is uncomfortable and true.
--
-- A SCORE WITH NO RECORDED OUTCOME IS UNFALSIFIABLE.
--
-- The platform emits a health score of 30 for an asset. Did about 30% of the
-- assets scored 30 actually fail? Without an outcome recorded against the
-- prediction, that question has no answer — the score can never be shown
-- wrong, which is not the same as being right, and it is the state most
-- deployed models live in permanently. model_predictions exists to make the
-- question answerable, and assessCalibration REFUSES to report a Brier score
-- until it is.
--
-- THE REGISTER FINDING THAT MATTERS (E5.10). Not how many models are approved,
-- but whether anything runs UNAPPROVED AND WITHOUT A HUMAN IN THE LOOP. That
-- combination should not exist and is the easiest to acquire by accident, so
-- it is counted on its own rather than folded into a total.
--
-- OFFLINE AND MANUAL FALLBACK (E5.14, E5.15) ARE NOT AN IT CONCERN. A
-- maintenance system that becomes a single point of failure FOR MAINTENANCE
-- has inverted its own purpose. The procedures table records what the site
-- does when this platform is unavailable, and whether anyone has ever tested
-- that it works.
--
-- Canonical reuse: ai_agents from the operating-loop baseline, assets,
-- work_orders, security audit tables, app_current_org(). Additive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- E5.10 — the approved-model register
-- ---------------------------------------------------------------------------
create table if not exists model_register (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  model_key text not null,
  version text not null,
  model_kind text not null check (model_kind in
    ('statistical', 'rule_based', 'machine_learning', 'llm', 'hybrid')),
  purpose text not null,
  approved_for text[] not null default '{}',
  -- Null means unapproved. Unapproved is allowed; unapproved AND autonomous
  -- is the combination the review flags.
  approved_on date,
  approved_by uuid references auth.users(id) on delete set null,
  review_due date,
  -- Whether a human must confirm before the output is acted on.
  human_in_loop boolean not null default true,
  -- Where the calculation is verified. For this platform's own engines that
  -- is a test file, and naming it is the point of E5.09.
  verification_reference text,
  limitations text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_modelreg_key
  on model_register(organization_id, model_key, version);

alter table model_register enable row level security;
drop policy if exists modelreg_read on model_register;
create policy modelreg_read on model_register
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E5.08 / E5.11 — predictions, and what actually happened
-- ---------------------------------------------------------------------------
create table if not exists model_predictions (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  model_key text not null,
  model_version text,
  subject_asset_id uuid references assets(id) on delete cascade,
  predicted_at timestamptz not null default now(),
  -- The prediction as a probability, so calibration is meaningful. A 0–100
  -- health score is converted at the point it is recorded, not here.
  predicted_probability numeric check (predicted_probability >= 0 and predicted_probability <= 1),
  -- The window the prediction was about. Without it "did it fail?" is
  -- unanswerable, because everything fails eventually.
  horizon_days int check (horizon_days > 0),
  -- Null until the horizon passes and someone records what happened.
  outcome boolean,
  outcome_recorded_at timestamptz,
  outcome_work_order_id uuid references work_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  check (outcome is null or outcome_recorded_at is not null)
);

create index if not exists idx_mpred_model
  on model_predictions(organization_id, model_key, predicted_at desc);
create index if not exists idx_mpred_open
  on model_predictions(organization_id, model_key) where outcome is null;

alter table model_predictions enable row level security;
drop policy if exists mpred_read on model_predictions;
create policy mpred_read on model_predictions
  for select to authenticated using (organization_id = app_current_org());

-- Distribution snapshots, for drift between a reference period and now.
create table if not exists model_input_snapshots (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  model_key text not null,
  feature text not null,
  snapshot_label text not null,
  taken_on date not null default current_date,
  -- bucket -> count
  distribution jsonb not null,
  is_reference boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_msnap
  on model_input_snapshots(organization_id, model_key, feature, taken_on desc);

alter table model_input_snapshots enable row level security;
drop policy if exists msnap_read on model_input_snapshots;
create policy msnap_read on model_input_snapshots
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E5.03 — network zoning, E5.07 — data-loss prevention
-- ---------------------------------------------------------------------------
create table if not exists network_zones (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  zone_key text not null,
  label text not null,
  purdue_level int check (purdue_level between 0 and 5),
  -- What may cross out of this zone, and by what route.
  egress_permitted boolean not null default false,
  egress_route text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_nz_key
  on network_zones(organization_id, zone_key);

create table if not exists connector_zone_assignments (
  connector_key text not null,
  zone_id bigint not null references network_zones(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  primary key (organization_id, connector_key)
);

create table if not exists data_egress_rules (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  destination text not null,
  destination_kind text not null check (destination_kind in
    ('llm_gateway', 'analytics', 'vendor_support', 'regulator', 'corporate_it', 'other')),
  data_class text not null check (data_class in
    ('operational', 'personal', 'commercial', 'safety_critical', 'security_sensitive')),
  permitted boolean not null default false,
  redaction_required boolean not null default false,
  basis text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  -- Permitting an egress with no stated basis is a decision nobody owns.
  check (not permitted or (basis is not null and btrim(basis) <> ''))
);

create unique index if not exists idx_egress_pair
  on data_egress_rules(organization_id, destination, data_class);

alter table network_zones enable row level security;
alter table connector_zone_assignments enable row level security;
alter table data_egress_rules enable row level security;
drop policy if exists nz_read on network_zones;
create policy nz_read on network_zones
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists cza_read on connector_zone_assignments;
create policy cza_read on connector_zone_assignments
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists egress_read on data_egress_rules;
create policy egress_read on data_egress_rules
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E5.14 / E5.15 — what the site does when this platform is not there
-- ---------------------------------------------------------------------------
create table if not exists continuity_procedures (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  procedure_key text not null,
  title text not null,
  scenario text not null check (scenario in
    ('platform_unavailable', 'connectivity_lost', 'data_corruption',
     'model_withdrawn', 'security_incident', 'vendor_failure')),
  -- The manual process that replaces the automated one.
  manual_fallback text not null,
  -- How long the site can run on the fallback before it stops being viable.
  viable_for_hours numeric check (viable_for_hours > 0),
  document_reference text,
  -- An untested continuity procedure is a document, not a capability.
  last_tested_on date,
  test_outcome text check (test_outcome in ('successful', 'partial', 'failed')),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_cont_key
  on continuity_procedures(organization_id, procedure_key);

alter table continuity_procedures enable row level security;
drop policy if exists cont_read on continuity_procedures;
create policy cont_read on continuity_procedures
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
drop function if exists get_model_risk_posture();
create or replace function get_model_risk_posture()
returns table (
  models_registered bigint,
  models_approved bigint,
  models_autonomous_unapproved bigint,
  reviews_overdue bigint,
  predictions_total bigint,
  predictions_with_outcome bigint,
  models_with_no_outcomes bigint,
  egress_rules bigint,
  egress_permitted_no_redaction bigint,
  continuity_procedures bigint,
  continuity_untested bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  m as (
    select count(*)::bigint n,
           count(*) filter (where approved_on is not null)::bigint approved,
           count(*) filter (where approved_on is null and not human_in_loop)::bigint danger,
           count(*) filter (where review_due is not null and review_due < current_date)::bigint overdue
    from model_register where organization_id = (select id from org)
  ),
  p as (
    select count(*)::bigint n,
           count(*) filter (where outcome is not null)::bigint with_outcome
    from model_predictions where organization_id = (select id from org)
  ),
  nooc as (
    select count(*)::bigint n from (
      select model_key from model_predictions
      where organization_id = (select id from org)
      group by model_key having count(*) filter (where outcome is not null) = 0
    ) x
  ),
  e as (
    select count(*)::bigint n,
           count(*) filter (where permitted and not redaction_required
                              and data_class in ('personal','safety_critical','security_sensitive'))::bigint risky
    from data_egress_rules where organization_id = (select id from org)
  ),
  c as (
    select count(*)::bigint n,
           count(*) filter (where last_tested_on is null)::bigint untested
    from continuity_procedures where organization_id = (select id from org)
  )
  select m.n, m.approved, m.danger, m.overdue, p.n, p.with_outcome, nooc.n,
         e.n, e.risky, c.n, c.untested,
    case
      when m.n = 0 then
        'No models are registered. This platform makes recommendations from calculations it has not '
        || 'written down anywhere, which means it cannot say what it is running or who approved it.'
      else
        m.n || ' model(s) registered, ' || m.approved || ' approved.'
    end
    || case when m.danger > 0 then ' ' || m.danger
            || ' run UNAPPROVED AND WITHOUT A HUMAN IN THE LOOP — the combination that should not exist.'
            else '' end
    || case
         when p.n = 0 then
           ' No predictions are being recorded, so nothing this platform outputs can be checked against '
           || 'what happened. Every score it produces is currently unfalsifiable.'
         when p.with_outcome = 0 then
           ' ' || p.n || ' prediction(s) recorded and NONE has an outcome against it. These scores cannot '
           || 'be shown wrong, which is not the same as being right.'
         else
           ' ' || p.with_outcome || ' of ' || p.n || ' prediction(s) have a recorded outcome, so calibration '
           || 'is measurable for ' || (case when nooc.n = 0 then 'every model' else 'some models' end) || '.'
       end
    || case when e.risky > 0 then ' ' || e.risky
            || ' egress rule(s) permit personal, safety-critical or security-sensitive data to leave '
            || 'WITHOUT redaction.' else '' end
    || case when c.n = 0 then
              ' No continuity procedure is recorded for this platform being unavailable — a maintenance '
              || 'system with no manual fallback has become a single point of failure for maintenance.'
            when c.untested > 0 then ' ' || c.untested || ' of ' || c.n
              || ' continuity procedure(s) have never been tested; an untested procedure is a document, '
              || 'not a capability.'
            else '' end
  from m, p, nooc, e, c;
$$;

grant execute on function get_model_risk_posture() to authenticated;

create or replace function get_model_register()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'modelKey', model_key, 'version', version, 'modelKind', model_kind,
    'purpose', purpose, 'approvedFor', approved_for,
    'approvedOn', approved_on, 'reviewDue', review_due,
    'humanInLoop', human_in_loop,
    'verificationReference', verification_reference,
    'limitations', limitations) order by model_key, version), '[]'::jsonb)
  from model_register where organization_id = app_current_org();
$$;

grant execute on function get_model_register() to authenticated;

create or replace function get_model_predictions(p_model_key text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'predicted', predicted_probability, 'outcome', outcome)), '[]'::jsonb)
  from model_predictions
  where organization_id = app_current_org()
    and model_key = p_model_key
    and predicted_probability is not null;
$$;

grant execute on function get_model_predictions(text) to authenticated;

notify pgrst, 'reload schema';
