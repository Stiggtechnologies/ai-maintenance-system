#!/usr/bin/env bash
set -euo pipefail

# Keep the complete acceptance transcript as CI evidence. The lifecycle is an
# integration gate, not merely a pass/fail bit: when Postgres refuses a write we
# need the exact SQLSTATE/message to decide whether the contract or fixture is
# wrong. Disable errexit only around the pipeline so PIPESTATUS can preserve the
# real psql exit code after tee writes the artifact.
set +e
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL' 2>&1 | tee /tmp/ria-lifecycle.log
begin;

-- Synthetic-only acceptance fixture. Everything rolls back.
insert into public.organizations (id, name, industry)
values ('8a000000-0000-4000-8000-000000000001', 'Northstar Aggregate — Synthetic RIA Lifecycle', 'mining')
on conflict (id) do nothing;

insert into public.user_profiles (id, organization_id, email, full_name, role)
values
  ('8a000000-0000-4000-8000-000000000010', '11111111-1111-1111-1111-111111111111', 'ria-platform-admin@example.invalid', 'RIA Platform Admin', 'ai_admin'),
  ('8a000000-0000-4000-8000-000000000011', '11111111-1111-1111-1111-111111111111', 'ria-tenant-admin@example.invalid', 'RIA Tenant Admin', 'admin'),
  ('8a000000-0000-4000-8000-000000000012', '8a000000-0000-4000-8000-000000000001', 'ria-engineer@example.invalid', 'RIA Synthetic Engineer', 'reliability_engineer')
on conflict (id) do update
set organization_id = excluded.organization_id,
    role = excluded.role,
    email = excluded.email,
    full_name = excluded.full_name;

insert into public.pilot_intake_requests (
  id, status, name, email, company, role, industry, asset_scope,
  primary_pain, data_readiness, security_need, commercial_model,
  notification_status, source_path
) values (
  '8a000000-0000-4000-8000-000000000020', 'contacted', 'Northstar Reliability Lead',
  'lead@example.invalid', 'Northstar Aggregate — Synthetic', 'Reliability Manager', 'Mining',
  'Primary crushing train A', 'Repeated bearing-related downtime with incomplete failure coding',
  'Sanitized exports available', 'Governed transfer required',
  'Reliability Intelligence Assessment - Standard - US$35,000', 'sent', '/pilot/reliability'
) on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', '8a000000-0000-4000-8000-000000000010', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub','8a000000-0000-4000-8000-000000000010','role','authenticated')::text,
  true
);

-- ai_admin can see the activation directory and target an existing customer org.
DO $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.list_ria_activation_organizations()
  where id = '8a000000-0000-4000-8000-000000000001';
  if v_count <> 1 then
    raise exception 'RIA lifecycle smoke: ai_admin cannot resolve target organization';
  end if;
end $$;

select public.activate_ria_from_intake(
  '8a000000-0000-4000-8000-000000000020',
  '8a000000-0000-4000-8000-000000000001',
  'Primary crushing train A — 36 months',
  current_date + 49,
  'SOW-SYNTHETIC-2026-001'
) as assessment_id
\gset
select set_config('syncai.ria_smoke_assessment_id', :'assessment_id', true);

-- Repeating the same accepted conversion must return the exact same assessment.
DO $$
declare v_again uuid;
begin
  v_again := public.activate_ria_from_intake(
    '8a000000-0000-4000-8000-000000000020',
    '8a000000-0000-4000-8000-000000000001',
    'Primary crushing train A — 36 months',
    current_date + 49,
    'SOW-SYNTHETIC-2026-001'
  );
  if v_again <> current_setting('syncai.ria_smoke_assessment_id')::uuid then
    raise exception 'RIA lifecycle smoke: activation is not idempotent';
  end if;
end $$;

-- A tenant admin from another org must NOT inherit the platform admin's cross-org power.
select set_config('request.jwt.claim.sub', '8a000000-0000-4000-8000-000000000011', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub','8a000000-0000-4000-8000-000000000011','role','authenticated')::text,
  true
);
DO $$
begin
  begin
    perform public.activate_ria_from_intake(
      '8a000000-0000-4000-8000-000000000020',
      '8a000000-0000-4000-8000-000000000001',
      'Should be refused', null, 'PO-SHOULD-NOT-LAND'
    );
    raise exception 'RIA lifecycle smoke: cross-tenant tenant-admin activation was admitted';
  exception
    when insufficient_privilege then null;
  end;
end $$;

-- Switch to the customer Reliability Engineer. From here on every write is
-- current-tenant only and uses the public Feature contracts.
select set_config('request.jwt.claim.sub', '8a000000-0000-4000-8000-000000000012', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub','8a000000-0000-4000-8000-000000000012','role','authenticated')::text,
  true
);

-- Upload metadata through the tenant RLS path. The Data Room owns real object
-- upload/profiling; this synthetic source only supplies a traceable evidence row.
insert into public.ria_data_sources (
  assessment_id, organization_id, category, file_name, object_path,
  mime_type, status, quality_grade, notes, uploaded_by
) values (
  :'assessment_id'::uuid,
  '8a000000-0000-4000-8000-000000000001',
  'work_orders', 'northstar_work_orders_synthetic.csv',
  '8a000000-0000-4000-8000-000000000001/' || :'assessment_id' || '/northstar_work_orders_synthetic.csv',
  'text/csv', 'profiled', 'partial', 'Synthetic acceptance evidence only',
  '8a000000-0000-4000-8000-000000000012'
) returning id as source_id
\gset
select set_config('syncai.ria_smoke_source_id', :'source_id', true);

select public.upsert_ria_baseline_metric(
  :'assessment_id'::uuid,
  'repeat_event_count', 'Repeat bearing-coded events', '7', 'events',
  'Count completed work orders in the bounded period after alias normalization.',
  'Primary crushing train A; 36-month bounded assessment scope.',
  array['work_order_id','asset_id','complete_date','short_text'],
  'Dealer records not yet joined; event count is not an MTBF denominator.',
  'partially_supported', array[:'source_id'::uuid]
) as metric_id
\gset

select public.create_ria_criticality_draft(
  :'assessment_id'::uuid, 'CR-A', 'Primary Crusher Train A', 'high',
  'Production consequence is material; safety consequence requires customer confirmation.'
) as criticality_id
\gset
select public.approve_ria_criticality_item(:'criticality_id'::uuid);

select public.create_ria_finding_draft(
  :'assessment_id'::uuid,
  'Repeat bearing-related interventions require mechanism discrimination',
  'Seven bearing-coded work orders exist in the bounded export; the coding alone does not prove one causal mechanism.',
  'high', 'medium', 'partially_supported',
  'Do not change protection settings or authorize bearing replacement from work-order coding alone.',
  jsonb_build_array(jsonb_build_object(
    'data_source_id', :'source_id',
    'record_reference', 'Synthetic WO rows 1-7',
    'note', 'Seven coded interventions; mechanism not established',
    'provenance', 'Synthetic customer-safe acceptance fixture',
    'confidence', 'medium'
  ))
) as finding_id
\gset
select set_config('syncai.ria_smoke_finding_id', :'finding_id', true);

-- Invalid/foreign evidence must be refused before a definer write can persist it.
DO $$
begin
  begin
    perform public.create_ria_finding_draft(
      current_setting('syncai.ria_smoke_assessment_id')::uuid,
      'Should fail', 'Should fail', 'low', 'low', 'unsupported',
      'No action',
      jsonb_build_array(jsonb_build_object('data_source_id','ffffffff-ffff-4fff-8fff-ffffffffffff'))
    );
    raise exception 'RIA lifecycle smoke: foreign evidence source was admitted';
  exception
    when foreign_key_violation then null;
  end;
end $$;

select public.create_ria_opportunity_draft(
  :'assessment_id'::uuid, :'finding_id'::uuid,
  'Controlled startup and post-trip evidence capture', 'high',
  'Mechanism discrimination reduces the risk of irreversible action based on ambiguous coding.',
  'medium', 'Run governed startup/post-trip inspection and evidence capture before replacement decision.',
  'Reliability Engineer', 25000, 90000, 'USD',
  'Scenario range from avoided diagnostic/rework exposure; not booked savings.',
  'Synthetic assessment assumptions — customer validation required',
  'One avoided repeat intervention; excludes production-loss claims until operating denominator is validated.',
  'low'
) as opportunity_id
\gset

select public.create_ria_decision_draft(
  :'assessment_id'::uuid, :'finding_id'::uuid,
  'Approve controlled evidence-capture plan before irreversible bearing intervention?',
  'Approve evidence capture; defer setpoint changes and bearing replacement pending discriminating evidence.',
  'Seven coded events are present; causal mechanism remains unresolved.',
  'Dealer/OEM history and controlled post-trip inspection evidence are missing.',
  'Maintenance Manager',
  'No protection-setting change, no bypass, and no irreversible replacement authorization.',
  'Review captured evidence and mechanism confidence at the next decision gate.',
  current_date + 14
) as decision_id
\gset

select public.create_ria_action_draft(
  :'assessment_id'::uuid, :'finding_id'::uuid, 'day_30',
  'Capture controlled startup and post-trip evidence on the next qualifying event.',
  'Reliability Engineer', current_date + 30,
  'Evidence package complete with timestamps, inspection observations, and source references.',
  'Maintenance Manager',
  'Execute under site procedures; no protection-setting or operating-limit changes.'
) as action_id
\gset
select set_config('syncai.ria_smoke_action_id', :'action_id', true);

-- The high-severity action must stay pending approval and not masquerade as executable.
DO $$
declare v_state text;
begin
  select approval_state into v_state
  from public.ria_actions
  where id = current_setting('syncai.ria_smoke_action_id')::uuid;
  if v_state <> 'pending' then
    raise exception 'RIA lifecycle smoke: high-severity action did not remain pending approval';
  end if;
end $$;

-- With evidence + authority/decision in place, the existing publication gate
-- can now be satisfied by the human reviewer.
select public.publish_ria_finding(:'finding_id'::uuid);

select public.transition_ria_assessment_phase(:'assessment_id'::uuid, 'analysis');
select public.transition_ria_assessment_phase(:'assessment_id'::uuid, 'customer_review');
select public.transition_ria_assessment_phase(:'assessment_id'::uuid, 'verification');

select public.record_ria_verification(
  :'assessment_id'::uuid, 'day_30', 'Evidence-capture completion',
  'No controlled package at assessment start',
  'Controlled synthetic acceptance package recorded',
  'Compare required evidence fields against the approved action verification metric.',
  array[:'source_id'::uuid], 'partially_supported'
) as verification_id
\gset

select public.transition_ria_assessment_phase(:'assessment_id'::uuid, 'complete');

DO $$
declare
  v_status text;
  v_lead_assessment uuid;
  v_findings integer;
  v_links integer;
  v_verifications integer;
  v_assessment uuid := current_setting('syncai.ria_smoke_assessment_id')::uuid;
  v_finding uuid := current_setting('syncai.ria_smoke_finding_id')::uuid;
begin
  select status into v_status from public.ria_assessments where id = v_assessment;
  select ria_assessment_id into v_lead_assessment
    from public.pilot_intake_requests
   where id = '8a000000-0000-4000-8000-000000000020';
  select count(*) into v_findings from public.ria_findings
    where assessment_id = v_assessment and review_state = 'published';
  select count(*) into v_links from public.ria_finding_evidence
    where finding_id = v_finding;
  select count(*) into v_verifications from public.ria_verifications
    where assessment_id = v_assessment and status <> 'pending';

  if v_status <> 'complete' then raise exception 'RIA lifecycle smoke: assessment did not complete'; end if;
  if v_lead_assessment <> v_assessment then raise exception 'RIA lifecycle smoke: lead provenance lost'; end if;
  if v_findings <> 1 then raise exception 'RIA lifecycle smoke: published finding missing'; end if;
  if v_links <> 1 then raise exception 'RIA lifecycle smoke: evidence link missing'; end if;
  if v_verifications <> 1 then raise exception 'RIA lifecycle smoke: verification conclusion missing'; end if;
end $$;

reset role;
rollback;
SQL
psql_status=${PIPESTATUS[0]}
set -e
if [ "$psql_status" -ne 0 ]; then
  echo "RIA lifecycle smoke failed with psql exit code $psql_status; transcript: /tmp/ria-lifecycle.log" >&2
  exit "$psql_status"
fi

echo "RIA lifecycle smoke passed: lead → activation → evidence → analysis → decision → action → verification → complete"
