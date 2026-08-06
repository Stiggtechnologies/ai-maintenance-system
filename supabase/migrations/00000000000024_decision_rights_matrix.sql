-- ============================================================================
-- Decision-rights matrix as governed policy-as-code (capability register C5.23)
-- and the consequential-recommendation contract fields (C5.24, C8.15, C8.17,
-- C8.18, C8.20, C8.21).
--
-- The enterprise-OS specification defines three tiers of decision rights:
-- automatically permitted, approval required, never autonomous. Until now the
-- "never" tier was satisfied mostly by ABSENCE of capability (no write path
-- exists to control systems). This migration converts the matrix from
-- convention to versioned, queryable policy that the canonical runtime and
-- future connectors MUST consult, so the boundary survives the arrival of
-- real integrations.
--
-- Additive only: no existing approval-authority behavior (migrations 22/23)
-- is modified; check_decision_right() layers on top of it.
-- ============================================================================

create table if not exists decision_rights (
  id uuid primary key default gen_random_uuid(),
  right_key text not null unique,
  tier text not null check (tier in ('auto', 'approval', 'never')),
  title text not null,
  description text not null,
  -- How the right is currently enforced. 'capability_absent' is an honest
  -- state: the action is impossible today because no code path exists.
  -- It must be upgraded to 'enforced' before any connector makes the
  -- action possible.
  enforcement text not null default 'policy'
    check (enforcement in ('enforced', 'policy', 'capability_absent')),
  required_authority text,          -- role that must approve (approval tier)
  register_ref text not null,       -- capability-register ID, e.g. 'C5.04'
  version int not null default 1,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table decision_rights enable row level security;

-- The matrix is platform policy: readable by every authenticated user,
-- writable by nobody through the API (changes arrive via migration only).
drop policy if exists decision_rights_read on decision_rights;
create policy decision_rights_read on decision_rights
  for select to authenticated using (true);

insert into decision_rights (right_key, tier, title, description, enforcement, required_authority, register_ref) values
  -- ── Automatically permitted ────────────────────────────────────────────
  ('clean_classify_wo_data','auto','Clean and classify work-order data','Normalize, code, and classify work-order and event data.','enforced',null,'C5.01'),
  ('draft_job_plans','auto','Draft job plans','Produce draft job plans for human review; drafts carry no execution authority.','enforced',null,'C5.02'),
  ('identify_missing_materials_docs','auto','Identify missing materials or documentation','Flag missing materials, documents, or data quality gaps.','enforced',null,'C5.03'),
  ('produce_schedule_options','auto','Produce weekly schedule options','Generate candidate schedules as options only; releasing a schedule is a human act.','policy',null,'C5.04'),
  ('calculate_kpis','auto','Calculate RAM and maintenance KPIs','Compute KPIs with lineage from governed data.','enforced',null,'C5.05'),
  ('detect_duplicate_notifications','auto','Detect duplicate notifications','Detect and propose merges of duplicate notifications; merging requires confirmation.','policy',null,'C5.06'),
  ('flag_repeat_failures','auto','Flag repeat failures and bad actors','Identify repeat failures and rank bad actors from coded history.','enforced',null,'C5.07'),
  ('recommend_inspection_review','auto','Recommend inspections or engineering review','Raise inspection or engineering-review recommendations.','enforced',null,'C5.08'),
  ('generate_meeting_packs','auto','Generate meeting packs and shift handovers','Assemble briefing, meeting, and handover documents.','policy',null,'C5.09'),
  -- ── Approval required ──────────────────────────────────────────────────
  ('change_pm_interval','approval','Change PM intervals','Any change to a preventive-maintenance interval or strategy requires accountable approval.','enforced','reliability_engineer','C5.10'),
  ('defer_critical_work','approval','Defer critical work','Deferral of safety- or production-critical work requires approval with documented risk.','enforced','maintenance_manager','C5.11'),
  ('change_operating_limits','approval','Change equipment operating limits','Operating-limit changes require engineering approval; limits are approved-source-only.','enforced','reliability_engineer','C5.12'),
  ('repair_vs_replace','approval','Approve major repair versus replacement decisions','Major repair/replace decisions require approval with lifecycle justification.','enforced','maintenance_manager','C5.13'),
  ('alter_safety_procedures','approval','Alter safety-critical procedures','Changes to safety-critical procedures require designated safety authority.','capability_absent','admin','C5.14'),
  ('release_turnaround_scope','approval','Release turnaround scope','Turnaround scope release requires accountable approval.','capability_absent','maintenance_manager','C5.15'),
  ('commit_expenditure','approval','Commit significant expenditures','Material financial commitments require budget-holder approval.','capability_absent','executive','C5.16'),
  ('schedule_safety_critical_work','approval','Create or reschedule safety-critical work','Safety-critical work creation/rescheduling requires human approval.','enforced','maintenance_manager','C5.17'),
  -- ── Never autonomous ───────────────────────────────────────────────────
  ('bypass_protective_systems','never','Bypass protective systems','The platform must never bypass, and must refuse to recommend bypassing without authority, any protective system.','capability_absent',null,'C5.18'),
  ('override_permits_isolations','never','Override permits or isolations','Permits and isolations are inviolable by the platform.','capability_absent',null,'C5.19'),
  ('suppress_safety_alarms','never','Suppress safety alarms','Safety alarms must never be suppressed by the platform.','capability_absent',null,'C5.20'),
  ('return_to_service','never','Return equipment to service without authorized verification','Return-to-service is exclusively a verified human authority.','capability_absent',null,'C5.21'),
  ('trade_safety_for_production','never','Trade safety or environmental compliance for production','No optimization may trade mandatory safety or environmental compliance for production.','enforced',null,'C5.22')
on conflict (right_key) do nothing;

-- ----------------------------------------------------------------------------
-- Runtime gate. Callers (canonical runtime, future connectors) MUST consult
-- this before performing a governed action. 'never' always denies. 'approval'
-- reports the required authority; the caller must hold a matching approval.
-- Unknown keys DENY (fail-closed).
-- ----------------------------------------------------------------------------
create or replace function public.check_decision_right(p_right_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r decision_rights%rowtype;
begin
  select * into r from decision_rights where right_key = p_right_key;
  if not found then
    return jsonb_build_object('allowed', false, 'tier', null,
      'reason', 'unknown decision right — denied (fail-closed)');
  end if;
  if r.tier = 'never' then
    return jsonb_build_object('allowed', false, 'tier', 'never',
      'reason', r.title || ' is never autonomous', 'register_ref', r.register_ref);
  end if;
  if r.tier = 'approval' then
    return jsonb_build_object('allowed', false, 'tier', 'approval',
      'requires_authority', r.required_authority,
      'reason', r.title || ' requires accountable human approval',
      'register_ref', r.register_ref);
  end if;
  return jsonb_build_object('allowed', true, 'tier', 'auto',
    'register_ref', r.register_ref);
end
$$;

grant execute on function public.check_decision_right(text) to authenticated;

-- ----------------------------------------------------------------------------
-- Consequential-recommendation contract (spec §8): the fields every
-- consequential recommendation must carry. Additive, nullable — the loop and
-- UI populate them going forward; enforcement tightens as producers upgrade.
-- ----------------------------------------------------------------------------
alter table recommendations add column if not exists consequence_summary text;
alter table recommendations add column if not exists alternatives_considered text;
alter table recommendations add column if not exists required_completion_date date;
alter table recommendations add column if not exists required_approver_role text;
alter table recommendations add column if not exists verification_method text;
