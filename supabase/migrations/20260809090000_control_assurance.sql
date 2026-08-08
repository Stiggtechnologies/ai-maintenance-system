-- ============================================================================
-- Control assurance (capability register E4.05, E4.08, E4.10).
--
-- The platform now enforces several controls in the database — the safety-gate
-- veto (slice 6), the delegation-of-authority ceiling (slice 9), taxonomy
-- adoption (slice 4), schedule release (slice 5). Nothing, however, ever
-- CHECKED that they still work. A control nobody tests is a control nobody
-- can rely on, and "we have a trigger" is not audit evidence.
--
-- This slice adds three things:
--
--   E4.05 SEGREGATION OF DUTIES, enforced rather than documented. The human
--         who raises a recommendation may not be the human who approves it,
--         and the human who clears a safety gate may not be the human who
--         then approves the work. Both refused by trigger.
--
--   E4.10 INTERNAL AUDITING that actually exercises the controls. Rather than
--         asserting the triggers exist, run_control_audit() ATTEMPTS the
--         forbidden action inside a savepoint and records whether it was
--         refused, then rolls the attempt back. The evidence is behavioural,
--         not declarative — and it is the same evidence a SOC 2 or ISO 27001
--         auditor asks for under "control operating effectiveness".
--
--   E4.08 RECORDS RETENTION as a stated policy with a live position, and
--         legal hold. It REPORTS what falls outside policy; it never deletes.
--         Automated destruction of operating records is not a decision a
--         maintenance platform should make on a schedule.
--
-- Canonical reuse: recommendations, recommendation_screenings, work_orders,
-- audit_events, user_profiles, app_current_org(). Additive.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- E4.05 — Segregation of duties, enforced
-- ----------------------------------------------------------------------------
alter table recommendations
  add column if not exists raised_by uuid references auth.users(id),
  add column if not exists approved_by uuid references auth.users(id);

comment on column recommendations.raised_by is
  'The human who raised this recommendation, when a human did. Agent-raised recommendations leave it null — an agent cannot approve, so no separation is at stake.';

create or replace function public.enforce_segregation_of_duties()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_attester uuid;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;
  if v_actor is null then
    return new;   -- service-role and migration paths are audited separately
  end if;

  -- A human may not approve their own proposal.
  if new.raised_by is not null and new.raised_by = v_actor then
    raise exception
      'Segregation of duties: you raised recommendation % and cannot also approve it. Route it to another approver.',
      new.id using errcode = 'check_violation';
  end if;

  -- Nor may the person who cleared the safety gate approve the work it gated.
  select gatekeeper_attested_by into v_attester
  from recommendation_screenings
  where recommendation_id = new.id and requires_gatekeeper
  order by screened_at desc limit 1;

  if v_attester is not null and v_attester = v_actor then
    raise exception
      'Segregation of duties: you cleared the safety gate on recommendation % and cannot also approve it. The gatekeeper and the approver must be different people.',
      new.id using errcode = 'check_violation';
  end if;

  new.approved_by := v_actor;
  return new;
end
$$;

drop trigger if exists trg_enforce_segregation_of_duties on recommendations;
create trigger trg_enforce_segregation_of_duties
  before update of status on recommendations
  for each row execute function public.enforce_segregation_of_duties();

-- ----------------------------------------------------------------------------
-- E4.08 — Records retention: stated policy, live position, legal hold
-- ----------------------------------------------------------------------------
create table if not exists retention_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  record_class text not null,
  table_name text not null,
  timestamp_column text not null,
  retain_years numeric not null,
  basis text not null,               -- WHY this period; never left implicit
  legal_hold boolean not null default false,
  legal_hold_reason text,
  status text not null default 'draft'
    check (status in ('draft', 'adopted', 'superseded')),
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  register_ref text not null default 'E4.08',
  created_at timestamptz not null default now(),
  unique (organization_id, record_class, status)
);

alter table retention_policies enable row level security;

drop policy if exists retention_policies_org_read on retention_policies;
create policy retention_policies_org_read on retention_policies
  for select to authenticated using (organization_id = app_current_org());

-- Seeded as DRAFTS for the same reason authority limits are: a retention
-- period is a legal and regulatory determination the operator makes, not one
-- a vendor makes for them. The stated basis says where each number came from.
insert into retention_policies (organization_id, record_class, table_name,
  timestamp_column, retain_years, basis)
select o.id, v.rc, v.tbl, v.col, v.yrs, v.basis
from organizations o
cross join (values
  ('Work-order history', 'work_orders', 'created_at', 7::numeric,
   'Proposed: equipment maintenance history commonly retained for the asset''s service life plus a claims window. Confirm against the operator''s records-retention schedule and any pressure-equipment or mine-safety obligation before adoption.'),
  ('Decision and approval trail', 'recommendations', 'created_at', 7::numeric,
   'Proposed: aligned to the work-order history it authorizes, so a decision and the work it produced never fall out of scope at different times.'),
  ('Safety screening records', 'recommendation_screenings', 'screened_at', 10::numeric,
   'Proposed: longer than the general trail because safety determinations are commonly discoverable well after the work. Confirm against jurisdiction.'),
  ('Board packs', 'board_packs', 'prepared_at', 10::numeric,
   'Proposed: corporate-records retention typically exceeds operational retention. Confirm against the corporate secretary''s schedule.'),
  ('Security audit events', 'audit_events', 'event_time', 2::numeric,
   'Proposed: SOC 2 commonly expects at least one full observation window of audit logging, with 12 months a frequent minimum; two years covers a window plus the audit that examines it.')
) as v(rc, tbl, col, yrs, basis)
where not exists (
  select 1 from retention_policies rp
  where rp.organization_id = o.id and rp.record_class = v.rc
);

create or replace function public.get_retention_position()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  p record;
  v_total bigint;
  v_beyond bigint;
  v_oldest timestamptz;
  v_rows jsonb := '[]'::jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  for p in
    select * from retention_policies
    where organization_id = v_org and status in ('draft', 'adopted')
    order by record_class
  loop
    execute format(
      'select count(*), count(*) filter (where %I < now() - make_interval(years => $1)), min(%I) from %I where organization_id = $2',
      p.timestamp_column, p.timestamp_column, p.table_name)
    into v_total, v_beyond, v_oldest
    using floor(p.retain_years)::int, v_org;

    v_rows := v_rows || jsonb_build_object(
      'record_class', p.record_class,
      'table_name', p.table_name,
      'retain_years', p.retain_years,
      'status', p.status,
      'legal_hold', p.legal_hold,
      'legal_hold_reason', p.legal_hold_reason,
      'records', v_total,
      'beyond_policy', v_beyond,
      'oldest_record', v_oldest,
      'basis', p.basis,
      -- Naming the action rather than taking it. Destruction of operating
      -- records is a human decision with legal consequences.
      'disposition', case
        when p.legal_hold then 'Under legal hold — nothing may be destroyed'
        when p.status = 'draft' then 'Policy is a draft — no disposition until adopted'
        when v_beyond > 0 then 'Eligible for review; disposition requires a human decision'
        else 'Within policy' end);
  end loop;

  return jsonb_build_object(
    'policies', v_rows,
    'note', 'This function reports the retention position. It never deletes: automated destruction of operating records is not a decision this platform makes on a schedule.');
end
$$;

grant execute on function public.get_retention_position() to authenticated;

-- ----------------------------------------------------------------------------
-- E4.10 — Internal auditing that exercises the controls
-- ----------------------------------------------------------------------------
create table if not exists control_audit_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_at timestamptz not null default now(),
  run_by uuid references auth.users(id),
  tests_run int not null,
  tests_passed int not null,
  results jsonb not null,
  register_ref text not null default 'E4.10'
);

create index if not exists idx_control_audit_runs_recent
  on control_audit_runs(organization_id, run_at desc);

alter table control_audit_runs enable row level security;

drop policy if exists control_audit_runs_read on control_audit_runs;
create policy control_audit_runs_read on control_audit_runs
  for select to authenticated using (organization_id = app_current_org());

-- The audit ATTEMPTS each forbidden action inside a savepoint and records
-- whether the database refused it. A control that has silently stopped firing
-- fails here loudly, which is the entire point — the previous state of the
-- world was that a dropped trigger would have gone unnoticed indefinitely.
create or replace function public.run_control_audit()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_results jsonb := '[]'::jsonb;
  v_run uuid;
  v_pass int := 0;
  v_total int := 0;
  v_id uuid;
  v_ok boolean;
  v_skipped int := 0;
  v_detail text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('admin', 'ai_admin', 'executive') then
    return jsonb_build_object('error',
      'running the control audit requires an executive or administrator');
  end if;

  -- ── Test 1: the safety gate refuses approval without gatekeeper clearance
  v_total := v_total + 1;
  v_ok := false;
  select r.id into v_id
  from recommendations r
  join recommendation_screenings s on s.recommendation_id = r.id
  where r.organization_id = v_org and r.status <> 'approved'
    and s.requires_gatekeeper and s.gatekeeper_attested_at is null
  limit 1;
  if v_id is null then
    v_detail := 'Not exercised: no un-cleared gated recommendation exists to test against.';
  else
    begin
      update recommendations set status = 'approved' where id = v_id;
      -- Reaching here means the control did NOT fire. Unwind the probe with a
      -- distinct error class so the handlers below can tell the two apart.
      v_detail := 'FAILED: approval was allowed without gatekeeper clearance.';
      raise exception using errcode = 'P0001', message = 'probe unwind';
    exception
      when check_violation then
        v_ok := true;
        v_detail := 'Refused as designed: gatekeeper clearance is required before approval.';
      when raise_exception then
        null;   -- our own unwind; v_detail already records the failure
    end;
  end if;
  if v_ok then v_pass := v_pass + 1;
  elsif v_id is null then v_skipped := v_skipped + 1; end if;
  v_results := v_results || jsonb_build_object(
    'control', 'Safety gatekeeper veto', 'register_ref', 'C1.11/C8.24',
    'exercised', v_id is not null, 'passed', v_ok, 'detail', v_detail);
  v_detail := null;

  -- ── Test 2: the delegation-of-authority ceiling refuses over-limit approval
  v_total := v_total + 1;
  v_ok := false;
  -- Deliberately NOT claimed as passed. The ceiling exempts administrators, so
  -- an administrator running the audit cannot exercise it — and reporting an
  -- unexercised control as green is exactly the dishonesty this audit exists to
  -- prevent. Exercising it requires a delegated-role approval in the period.
  if not exists (select 1 from authority_limits
                 where organization_id = v_org and status = 'adopted'
                   and max_commitment_usd is not null) then
    v_detail := 'Not exercised: no adopted monetary ceiling. Draft limits enforce nothing, by design (E4.03).';
  else
    v_detail := 'Not exercised here: the ceiling exempts administrators, so the account running this audit cannot trip it. Evidence comes from delegated-role approvals — see recommendations.authority_cleared_by.';
  end if;
  v_skipped := v_skipped + 1;
  v_results := v_results || jsonb_build_object(
    'control', 'Delegation-of-authority ceiling', 'register_ref', 'E4.03',
    'exercised', false, 'passed', null, 'detail', v_detail);

  -- ── Test 3: an attested board pack cannot be edited
  v_total := v_total + 1;
  v_ok := false;
  select id into v_id from board_packs
  where organization_id = v_org and status = 'attested' limit 1;
  if v_id is null then
    v_detail := 'Not exercised: no attested board pack exists to test against.';
  else
    begin
      update board_packs set kpi_snapshot = '[]'::jsonb where id = v_id;
      v_detail := 'FAILED: an attested board pack was editable.';
      raise exception using errcode = 'P0001', message = 'probe unwind';
    exception
      when check_violation then
        v_ok := true;
        v_detail := 'Refused as designed: an attested pack is the board''s record and is immutable.';
      when raise_exception then
        null;
    end;
  end if;
  if v_ok then v_pass := v_pass + 1;
  elsif v_id is null then v_skipped := v_skipped + 1; end if;
  v_results := v_results || jsonb_build_object(
    'control', 'Board-pack immutability', 'register_ref', 'E4.12',
    'exercised', v_id is not null,
    -- An unexercised control is NOT a failed one. Reporting it as failed is as
    -- dishonest as reporting it as passed; both hide that nothing was tested.
    'passed', case when v_id is null then null else to_jsonb(v_ok) end,
    'detail', v_detail);
  v_detail := null;

  -- ── Test 4: every enforced control still has its trigger attached
  v_total := v_total + 1;
  select count(*) = 4 into v_ok
  from pg_trigger
  where not tgisinternal and tgname in (
    'trg_enforce_safety_gate', 'trg_enforce_authority_limit',
    'trg_enforce_segregation_of_duties', 'trg_protect_attested_board_pack');
  v_detail := case when v_ok
    then 'All four enforcement triggers are attached.'
    else 'FAILED: an enforcement trigger is missing — a control has silently stopped firing.' end;
  if v_ok then v_pass := v_pass + 1; end if;
  v_results := v_results || jsonb_build_object(
    'control', 'Enforcement triggers present', 'register_ref', 'E4.10',
    'exercised', true, 'passed', v_ok, 'detail', v_detail);

  -- ── Test 5: decision rights claiming enforcement have a live consumer
  v_total := v_total + 1;
  -- Scoped to the approval and never tiers deliberately. For an AUTO right,
  -- 'enforced' means the platform actually performs the action; for an
  -- APPROVAL or NEVER right it means a code path REFUSES it, and that claim is
  -- the one that can silently become false.
  select count(*) = 0 into v_ok
  from decision_rights dr
  where dr.enforcement = 'enforced'
    and dr.tier in ('approval', 'never')
    and not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and pg_get_functiondef(p.oid) like '%' || dr.right_key || '%'
        and p.proname <> 'check_decision_right');
  v_detail := case when v_ok
    then 'Every approval- and never-tier right marked enforced is consulted by a function that can refuse.'
    else 'A right is marked enforced but no function refuses it — the claim outruns the code.' end;
  if v_ok then v_pass := v_pass + 1; end if;
  v_results := v_results || jsonb_build_object(
    'control', 'Decision rights are honestly labelled', 'register_ref', 'C1.14',
    'exercised', true, 'passed', v_ok, 'detail', v_detail);

  -- ── Test 6: tenant isolation — no org-scoped governance table without RLS
  v_total := v_total + 1;
  select count(*) = 0 into v_ok
  from pg_tables t
  where t.schemaname = 'public'
    and t.tablename in ('recommendations', 'board_packs', 'authority_limits',
      'retention_policies', 'control_audit_runs', 'recommendation_screenings',
      'taxonomy_definitions', 'schedule_options')
    and not t.rowsecurity;
  v_detail := case when v_ok
    then 'Row-level security is enabled on every governance table.'
    else 'FAILED: a governance table is missing row-level security.' end;
  if v_ok then v_pass := v_pass + 1; end if;
  v_results := v_results || jsonb_build_object(
    'control', 'Tenant isolation on governance tables', 'register_ref', 'E5.02',
    'exercised', true, 'passed', v_ok, 'detail', v_detail);

  insert into control_audit_runs (organization_id, run_by, tests_run, tests_passed, results)
  values (v_org, auth.uid(), v_total, v_pass, v_results)
  returning id into v_run;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'control_audit', coalesce(v_role, 'unknown'),
    jsonb_build_object('run_id', v_run, 'passed', v_pass, 'of', v_total));

  return jsonb_build_object('run_id', v_run, 'tests_run', v_total,
    'tests_passed', v_pass, 'tests_not_exercised', v_skipped,
    'results', v_results);
end
$$;

grant execute on function public.run_control_audit() to authenticated;

create or replace function public.get_control_assurance()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();

  return jsonb_build_object(
    'role', v_role,
    'can_run', v_role in ('admin', 'ai_admin', 'executive'),
    'latest_run', (
      select jsonb_build_object('run_at', run_at, 'tests_run', tests_run,
        'tests_passed', tests_passed, 'results', results)
      from control_audit_runs
      where organization_id = v_org
      order by run_at desc limit 1),
    'retention', get_retention_position());
end
$$;

grant execute on function public.get_control_assurance() to authenticated;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- Honesty correction found BY the audit above, on its first run.
--
-- Five approval-tier rights and one never-tier right were labelled 'enforced'
-- while no code path could refuse them. The label was aspirational. Two
-- corrections, in opposite directions:
--
--   * The five approval-tier rights are demoted to 'policy'. The matrix states
--     the rule and the platform cannot yet perform the action at all — there
--     is no writeback connector — so nothing refuses it because nothing
--     attempts it. 'policy' is what that actually is.
--
--   * 'trade_safety_for_production' is genuinely wired instead of demoted. The
--     safety gate IS its enforcement; it simply never referenced the right.
--     enforce_safety_gate now consults it, so the never-tier prohibition and
--     the trigger that implements it are the same fact in two places rather
--     than two claims that could drift apart.
-- ----------------------------------------------------------------------------
update decision_rights
set enforcement = 'policy'
where right_key in ('change_operating_limits', 'change_pm_interval',
  'defer_critical_work', 'repair_vs_replace', 'schedule_safety_critical_work')
  and enforcement = 'enforced';

create or replace function public.enforce_safety_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s recommendation_screenings%rowtype;
  v_right jsonb;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  select * into s from recommendation_screenings
  where recommendation_id = new.id;

  if found and s.requires_gatekeeper and s.gatekeeper_attested_at is null then
    -- The never-tier right this trigger exists to enforce. check_decision_right
    -- is fail-closed and returns false for a 'never' right, so this is the
    -- prohibition and its implementation stated once rather than twice.
    v_right := check_decision_right('trade_safety_for_production');
    raise exception
      'Safety gate: recommendation % affects % and requires gatekeeper clearance before approval. Decision right trade_safety_for_production is %-tier, allowed=%.',
      new.id, s.dimensions_hit, v_right->>'tier', v_right->>'allowed'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

notify pgrst, 'reload schema';
