-- ============================================================================
-- Sync Develop Slice 3C — the regulatory approval chain as REAL OBJECTS
-- (D3.10, spec I.19): RegulatoryRequirement → Application → Information
-- request → Approval → Conditions → Project requirement.
--
-- WHAT EXISTS TODAY (register row D3.10, verified): nothing that is a chain.
-- The nearest thing is onboarding section s16 "Regulatory requirements"
-- (00000000000011:164) — one asset-scoped checklist row with a yes/no
-- answer. A checklist row cannot say WHICH permit, applied for WHEN, decided
-- by WHOM, WITH WHAT CONDITIONS, and it certainly cannot put those
-- conditions on the critical path. This file builds the chain and does NOT
-- fork the checklist: onboarding_requirements is untouched.
--
-- RULINGS THIS FILE TAKES (I.19 names the chain, not its mechanics):
--
--   * EACH LINK IS A ROW, NOT A STATUS COLUMN. Spec I.19's whole point is
--     "permits out of spreadsheets" — a single `permit_status` field is the
--     spreadsheet, re-implemented. Five tables, each with the acts that
--     move it, so the lead time between submission and decision is DATA.
--
--   * THE INFORMATION REQUEST IS FIRST-CLASS, because it is where permits
--     actually die. I.19 lists it explicitly; an information request with an
--     owner, a due date and a response is the difference between "the
--     regulator is slow" and "we have been sitting on RFI-3 for 40 days".
--
--   * PROVENANCE IS THE PLATFORM'S OWN LADDER. regulatory_requirements
--     carry source_authority from the SAME eight-tier vocabulary
--     (20261101090400) and are CONSTRAINED to the two tiers a regulator's
--     instrument can honestly occupy — LAW or REGULATION. A "regulatory
--     requirement" recorded at BEST_PRACTICE would be a category error that
--     the propagation in 20261122090200 would then push into engineering
--     with statutory weight it never had.
--
--   * AN APPROVAL IS NOT A SELF-DECLARATION. regulatory_approvals record a
--     decision made by an EXTERNAL authority, so the row names the deciding
--     authority and its instrument reference; and because "regulation
--     satisfied" is one of the seven §70 determinations, the AI-operator
--     identity cannot record an approval — backstopped on the table for
--     every writer, not only refused at the RPC.
--
--   * GRANTED_WITH_CONDITIONS MUST CARRY CONDITIONS. The D3.18 contract,
--     repeated because the shape is identical: a conditional grant whose
--     conditions exist only as prose in a PDF has no owner, no deadline and
--     no escalation. A DEFERRED constraint trigger enforces it at commit,
--     so the RPC and any raw path are held to the same rule.
--
--   * EXPIRY IS NOT NULL WHERE THE INSTRUMENT HAS ONE — and where it does
--     not, the row says so EXPLICITLY (perpetual boolean). D3.20's lesson:
--     a nullable expiry that only the RPC polices is a permanent exception
--     waiting to be minted directly.
--
--   * CONDITIONS ARE SHAPED LIKE gate_conditions ON PURPOSE (owner, due
--     date, evidence requirement, consequence-if-missed, all NOT NULL) so
--     the ONE escalation sweep can carry both without a second escalator
--     (ruling 15). The escalation itself lands in 20261122090200 with the
--     propagation it escalates.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. RegulatoryRequirement — the obligation to hold a permit at all.
-- ---------------------------------------------------------------------------
create table if not exists public.regulatory_requirements (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  requirement_ref text not null,
  regulator text not null check (btrim(regulator) <> ''),
  jurisdiction text not null check (btrim(jurisdiction) <> ''),
  -- The instrument: the act, regulation or directive that creates the duty.
  instrument text not null check (btrim(instrument) <> ''),
  permit_type text not null check (btrim(permit_type) <> ''),
  description text not null check (btrim(description) <> ''),
  -- The platform's own provenance ladder, narrowed (header ruling).
  source_authority text not null default 'REGULATION'
    check (source_authority in ('LAW','REGULATION')),
  -- What triggers the duty, and how long the regulator historically takes.
  trigger_condition text not null check (btrim(trigger_condition) <> ''),
  expected_lead_time_days int not null
    check (expected_lead_time_days > 0),
  -- The date the permit must be IN HAND for the project to proceed. This is
  -- what makes the chain a critical path rather than a register.
  required_by_date date,
  status text not null default 'identified'
    check (status in ('identified','applied','granted','refused','not_required','withdrawn')),
  not_required_basis text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  -- "Not required" is a determination and states its basis; the alternative
  -- is a permit quietly dismissed by dropdown.
  constraint rr_not_required_basis check (
    status <> 'not_required'
    or (not_required_basis is not null and btrim(not_required_basis) <> ''))
);

create unique index if not exists idx_regulatory_requirements_ref
  on regulatory_requirements(organization_id, requirement_ref);
create index if not exists idx_regulatory_requirements_case
  on regulatory_requirements(organization_id, development_case_id, status);

alter table public.regulatory_requirements enable row level security;
drop policy if exists regulatory_requirements_read on public.regulatory_requirements;
create policy regulatory_requirements_read on public.regulatory_requirements
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 2. Application — what was actually submitted, and when.
-- ---------------------------------------------------------------------------
create table if not exists public.regulatory_applications (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  requirement_id bigint not null references regulatory_requirements(id) on delete cascade,
  application_ref text not null,
  submitted_at timestamptz,
  submitted_by uuid references auth.users(id),
  scope_description text not null check (btrim(scope_description) <> ''),
  status text not null default 'draft'
    check (status in ('draft','submitted','information_requested','decided','withdrawn')),
  withdrawn_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  -- A submitted application has a submission record. The clock the whole
  -- critical path runs on starts here, so it is not optional.
  constraint ra_submitted_recorded check (
    status = 'draft'
    or status = 'withdrawn'
    or (submitted_at is not null and submitted_by is not null)),
  constraint ra_withdrawn_reasoned check (
    status <> 'withdrawn'
    or (withdrawn_reason is not null and btrim(withdrawn_reason) <> ''))
);

create unique index if not exists idx_regulatory_applications_ref
  on regulatory_applications(organization_id, application_ref);
create index if not exists idx_regulatory_applications_requirement
  on regulatory_applications(requirement_id, status);

alter table public.regulatory_applications enable row level security;
drop policy if exists regulatory_applications_read on public.regulatory_applications;
create policy regulatory_applications_read on public.regulatory_applications
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 3. Information request — the link I.19 names and spreadsheets lose.
-- ---------------------------------------------------------------------------
create table if not exists public.regulatory_information_requests (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  application_id bigint not null references regulatory_applications(id) on delete cascade,
  request_ref text not null,
  requested_at date not null,
  response_due date not null,
  request_detail text not null check (btrim(request_detail) <> ''),
  owner_id uuid not null references auth.users(id),
  responded_at timestamptz,
  responded_by uuid references auth.users(id),
  response_evidence_id uuid references evidence_items(id) on delete set null,
  status text not null default 'open'
    check (status in ('open','responded','overdue','withdrawn')),
  breached_at timestamptz,
  created_at timestamptz not null default now(),
  constraint rir_response_recorded check (
    status <> 'responded'
    or (responded_at is not null and responded_by is not null
        and response_evidence_id is not null)),
  constraint rir_due_after_request check (response_due >= requested_at)
);

create unique index if not exists idx_reg_info_requests_ref
  on regulatory_information_requests(organization_id, request_ref);
create index if not exists idx_reg_info_requests_open
  on regulatory_information_requests(organization_id, status, response_due)
  where status in ('open','overdue');

alter table public.regulatory_information_requests enable row level security;
drop policy if exists regulatory_information_requests_read on public.regulatory_information_requests;
create policy regulatory_information_requests_read on public.regulatory_information_requests
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 4. Approval — the external authority's decision.
-- ---------------------------------------------------------------------------
create table if not exists public.regulatory_approvals (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  application_id bigint not null references regulatory_applications(id) on delete cascade,
  permit_number text not null check (btrim(permit_number) <> ''),
  -- The DECIDING authority, named. Not "us".
  deciding_authority text not null check (btrim(deciding_authority) <> ''),
  decision text not null
    check (decision in ('granted','granted_with_conditions','refused')),
  decision_date date not null,
  effective_from date,
  expires_at date,
  -- An instrument with no expiry says so; it does not leave the column null
  -- and hope (the D3.20 lesson, applied at authoring time).
  perpetual boolean not null default false,
  refusal_reason text,
  -- The recorded human who entered the decision into the system. §70: never
  -- the AI-operator identity (trigger below).
  recorded_by uuid references auth.users(id),
  document_id uuid references kb_intake_documents(id) on delete set null,
  status text not null default 'active'
    check (status in ('active','expired','revoked','superseded')),
  revoked_reason text,
  created_at timestamptz not null default now(),
  constraint rap_expiry_stated check (
    decision = 'refused'
    or perpetual = true
    or expires_at is not null),
  constraint rap_perpetual_has_no_expiry check (
    perpetual = false or expires_at is null),
  constraint rap_refusal_reasoned check (
    decision <> 'refused'
    or (refusal_reason is not null and btrim(refusal_reason) <> '')),
  constraint rap_revoked_reasoned check (
    status <> 'revoked'
    or (revoked_reason is not null and btrim(revoked_reason) <> '')),
  constraint rap_effective_before_expiry check (
    expires_at is null or effective_from is null or expires_at >= effective_from)
);

create unique index if not exists idx_regulatory_approvals_permit
  on regulatory_approvals(organization_id, permit_number);
create index if not exists idx_regulatory_approvals_application
  on regulatory_approvals(application_id, status);
create index if not exists idx_regulatory_approvals_expiry
  on regulatory_approvals(organization_id, status, expires_at)
  where status = 'active' and expires_at is not null;

alter table public.regulatory_approvals enable row level security;
drop policy if exists regulatory_approvals_read on public.regulatory_approvals;
create policy regulatory_approvals_read on public.regulatory_approvals
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 5. Conditions — the reason this chain exists. Shaped like gate_conditions
--    (D3.18) so the ONE sweep escalates both.
--
--    obligation_domain is I.19's own list: "engineering, construction,
--    operating procedures, monitoring, reporting". Nothing added, nothing
--    dropped — the propagation in 20261122090200 routes on exactly these
--    five, and an unroutable sixth would be a condition with nowhere to go.
-- ---------------------------------------------------------------------------
create table if not exists public.regulatory_conditions (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  approval_id bigint not null references regulatory_approvals(id) on delete cascade,
  condition_ref text not null,
  description text not null check (btrim(description) <> ''),
  obligation_domain text not null check (obligation_domain in
    ('engineering','construction','operating_procedure','monitoring','reporting')),
  -- Born complete: the D3.18 contract, verbatim.
  owner_id uuid not null references auth.users(id),
  due_date date not null,
  evidence_requirement text not null check (btrim(evidence_requirement) <> ''),
  consequence_if_missed text not null check (btrim(consequence_if_missed) <> ''),
  -- A condition that recurs for the life of the permit (monitoring,
  -- reporting) is not discharged once; it is discharged every period.
  recurrence text not null default 'one_time'
    check (recurrence in ('one_time','monthly','quarterly','annual')),
  status text not null default 'open'
    check (status in ('open','satisfied','missed','superseded')),
  -- The propagation targets (20261122090200). Recorded ON the condition so
  -- "where did this land?" is answered by the row, not by a join guess.
  propagated_requirement_id bigint references design_requirements(id) on delete set null,
  propagated_work_order_id uuid references work_orders(id) on delete set null,
  propagated_at timestamptz,
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  closure_evidence_id uuid references evidence_items(id) on delete set null,
  closure_note text,
  breached_at timestamptz,
  created_at timestamptz not null default now(),
  constraint rc_closure_complete check (
    status <> 'satisfied'
    or (closure_evidence_id is not null and closed_by is not null and closed_at is not null))
);

create unique index if not exists idx_regulatory_conditions_ref
  on regulatory_conditions(organization_id, condition_ref);
create index if not exists idx_regulatory_conditions_approval
  on regulatory_conditions(approval_id, status);
create index if not exists idx_regulatory_conditions_open_due
  on regulatory_conditions(organization_id, status, due_date)
  where status in ('open','missed');

alter table public.regulatory_conditions enable row level security;
drop policy if exists regulatory_conditions_read on public.regulatory_conditions;
create policy regulatory_conditions_read on public.regulatory_conditions
  for select to authenticated using (organization_id = app_current_org());

comment on table public.regulatory_conditions is
  'D3.10/D3.11 / spec I.19: the conditions attached to a regulatory approval, born complete (owner, due date, evidence requirement, consequence-if-missed) on the D3.18 gate_conditions contract, and routed by obligation_domain into engineering/construction (design_requirements) or operations (work_orders) by propagate_regulatory_conditions (20261122090200). Overdue conditions escalate through the ONE governance sweep.';

-- No client write policy on any of the five: every mutation is a definer RPC
-- below. Stated here so the absence is a decision, not an oversight.

-- ---------------------------------------------------------------------------
-- 6. §70 backstop on the approval row itself — "regulation satisfied" is one
--    of the seven determinations reserved to humans, and an approval record
--    IS the assertion that a regulator has been satisfied. Unconditional:
--    corrupt provenance is refused for clients and the service path alike,
--    on INSERT and on UPDATE (a re-pointed recorded_by is the same act with
--    a different verb).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_regulatory_approval_human_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.recorded_by is not distinct from old.recorded_by then
    return new;
  end if;
  if new.recorded_by is null then
    raise exception
      'A regulatory approval records WHO entered the authority''s decision — an approval nobody stands behind is not a record (spec I.19).'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from user_profiles up
             where up.id = new.recorded_by and up.role = 'ai_admin') then
    raise exception
      'Spec §70: "regulation satisfied" is a determination reserved to authorized humans. The AI-operator identity cannot stand as the recorder of a regulatory approval.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_regulatory_approval_human_record() from public, anon, authenticated;

drop trigger if exists trg_regulatory_approval_human_record on public.regulatory_approvals;
create trigger trg_regulatory_approval_human_record
  before insert or update on public.regulatory_approvals
  for each row execute function public.enforce_regulatory_approval_human_record();

-- ---------------------------------------------------------------------------
-- 7. A conditional grant carries conditions — enforced at COMMIT for every
--    writer (the D3.18 deferred-constraint idiom: the approval row is
--    inserted before its condition children inside one governed transaction).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_conditional_approval_has_conditions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.decision = 'granted_with_conditions'
     and not exists (select 1 from regulatory_conditions rc where rc.approval_id = new.id) then
    raise exception
      'An approval granted WITH CONDITIONS carries at least one first-class condition '
      '(owner, due date, evidence requirement, consequence-if-missed, obligation domain — spec I.19). '
      'Conditions that live only in the permit PDF have no owner, no deadline and no escalation, '
      'which is the exact failure this chain exists to end.'
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;

revoke all on function public.enforce_conditional_approval_has_conditions() from public, anon, authenticated;

drop trigger if exists trg_conditional_approval_has_conditions on public.regulatory_approvals;
create constraint trigger trg_conditional_approval_has_conditions
  after insert or update on public.regulatory_approvals
  deferrable initially deferred
  for each row execute function public.enforce_conditional_approval_has_conditions();

-- ---------------------------------------------------------------------------
-- 7b. PROVENANCE BACKSTOP FOR THE WHOLE REGULATORY FAMILY — the treatment
--     `stakeholder_commitments` already gets in 20261122090000, applied to
--     the five tables that carry the permit chain. The first draft of this
--     file addressed CLIENTS only ("no client write policy on any of the
--     five") and left two holes a service caller walked straight through:
--
--       * a whole permit could be DELETED with zero ledger — and because
--         regulatory_conditions.approval_id cascades, every condition and
--         every gate blocker went with it, leaving a live "PERMIT LAPSED"
--         security_event pointing at an approval that no longer exists;
--       * an expiry date could be re-written and a due date pushed out with
--         no audit_events row and no security_events row, silencing the
--         sweep.
--
--     House law is "every enforcement trigger covers INSERT and UPDATE, and
--     DELETE where an act can be dodged by deletion". Deleting a permit is
--     precisely dodging `expire_governance_instruments` by deletion, so
--     DELETE is covered here. Clients are refused outright (they have no
--     write policy either, so this is belt and braces); the service path is
--     admitted AND recorded, which is the whole difference between an
--     unrecorded change and a recorded one.
--
--     No act in this family deletes a row: a permit that no longer
--     authorizes anything is 'expired' or 'revoked', which keeps its
--     conditions, its history and its escalations.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_regulatory_chain_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.regulatory_chain_write', true), '');
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
         'admin_action',
         case when tg_op = 'DELETE' then 'critical' else 'warning' end,
         'Regulatory chain row ' || tg_table_name || ' ' || v_id || ' written by a '
           || 'service caller (' || lower(tg_op) || '), bypassing the permit-chain acts '
           || '(record_regulatory_requirement / submit_regulatory_application / '
           || 'record_regulatory_information_request / respond_regulatory_information_request / '
           || 'record_regulatory_approval / close_regulatory_condition / '
           || 'propagate_regulatory_conditions / the escalation sweep).');
    end if;
  elsif v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'The regulatory approval chain is recorded, decided, discharged and escalated only '
      'through its governed acts. A permit condition any client can edit or delete is not '
      'a condition of an authorization — spec I.19.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

revoke all on function public.enforce_regulatory_chain_provenance() from public, anon, authenticated;

drop trigger if exists trg_regulatory_requirement_provenance on public.regulatory_requirements;
create trigger trg_regulatory_requirement_provenance
  before insert or update or delete on public.regulatory_requirements
  for each row execute function public.enforce_regulatory_chain_provenance();

drop trigger if exists trg_regulatory_application_provenance on public.regulatory_applications;
create trigger trg_regulatory_application_provenance
  before insert or update or delete on public.regulatory_applications
  for each row execute function public.enforce_regulatory_chain_provenance();

drop trigger if exists trg_regulatory_rfi_provenance on public.regulatory_information_requests;
create trigger trg_regulatory_rfi_provenance
  before insert or update or delete on public.regulatory_information_requests
  for each row execute function public.enforce_regulatory_chain_provenance();

-- Named so it sorts AFTER trg_regulatory_approval_human_record: the §70
-- recorder wall speaks before the provenance wall, so a service write with an
-- AI recorder is refused for the reason that actually matters.
drop trigger if exists trg_regulatory_approval_provenance on public.regulatory_approvals;
create trigger trg_regulatory_approval_provenance
  before insert or update or delete on public.regulatory_approvals
  for each row execute function public.enforce_regulatory_chain_provenance();

drop trigger if exists trg_regulatory_condition_provenance on public.regulatory_conditions;
create trigger trg_regulatory_condition_provenance
  before insert or update or delete on public.regulatory_conditions
  for each row execute function public.enforce_regulatory_chain_provenance();

-- ---------------------------------------------------------------------------
-- 7c. The conditional-grant invariant, re-asserted from the CHILD side.
--     `trg_conditional_approval_has_conditions` is a constraint trigger on
--     the PARENT, so deleting the last condition of a granted_with_conditions
--     approval left the invariant violated with nothing to re-check it — the
--     "DELETE where an act can be dodged by deletion" rule applied to the
--     wrong table. This one fires on the condition row and asks the parent's
--     question again.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_condition_delete_keeps_grant_honest()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from regulatory_approvals ap
    where ap.id = old.approval_id
      and ap.decision = 'granted_with_conditions'
      and not exists (select 1 from regulatory_conditions rc where rc.approval_id = ap.id))
  then
    raise exception
      'Removing this condition would leave permit % granted WITH CONDITIONS and carrying none. '
      'A conditional grant whose conditions have all been deleted asserts an authorization the '
      'regulator did not give (spec I.19).',
      (select permit_number from regulatory_approvals where id = old.approval_id)
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;

revoke all on function public.enforce_condition_delete_keeps_grant_honest() from public, anon, authenticated;

drop trigger if exists trg_condition_delete_keeps_grant_honest on public.regulatory_conditions;
create constraint trigger trg_condition_delete_keeps_grant_honest
  after delete on public.regulatory_conditions
  deferrable initially deferred
  for each row execute function public.enforce_condition_delete_keeps_grant_honest();

-- ---------------------------------------------------------------------------
-- 8. Shared helper: the case a chain row belongs to, resolved through the
--    chain. Stated once so every act site scopes identically.
-- ---------------------------------------------------------------------------
create or replace function public.regulatory_condition_case(p_condition_id bigint)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  -- ORG-SCOPED. A definer helper granted to `authenticated` with no tenancy
  -- predicate is a cross-tenant read however small its return value: ids are
  -- sequential, so a foreign tenant could enumerate which condition ids exist
  -- and map them to this organization's case UUIDs. Every other definer in
  -- this slice checks the organization; this one did not.
  select rr.development_case_id
  from regulatory_conditions rc
  join regulatory_approvals ap on ap.id = rc.approval_id
  join regulatory_applications a on a.id = ap.application_id
  join regulatory_requirements rr on rr.id = a.requirement_id
  join development_cases c on c.id = rr.development_case_id
  where rc.id = p_condition_id
    and rc.organization_id = app_current_org()
    and c.organization_id = app_current_org()
$$;

revoke all on function public.regulatory_condition_case(bigint) from public, anon;
grant execute on function public.regulatory_condition_case(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. The acts. Each is org-scoped, role-checked, audited with prev/new state.
-- ---------------------------------------------------------------------------
create or replace function public.record_regulatory_requirement(
  p_case_id uuid,
  p_requirement jsonb
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
  v_ref text := nullif(btrim(coalesce(p_requirement->>'requirement_ref','')), '');
  v_tier text := coalesce(nullif(btrim(coalesce(p_requirement->>'source_authority','')), ''), 'REGULATION');
  -- Raw text beside the parsed value (20261122090000 section 0): a cast in a
  -- DECLARE executes before the first guard, so a malformed field must arrive
  -- as NULL and be refused BY NAME rather than raising a raw 22P02.
  v_lead_raw text := nullif(btrim(coalesce(p_requirement->>'expected_lead_time_days','')), '');
  v_lead int := sync_text_as_int(v_lead_raw);
  v_required_by_raw text := nullif(btrim(coalesce(p_requirement->>'required_by_date','')), '');
  v_required_by date := sync_text_as_date(v_required_by_raw);
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'recording a regulatory requirement requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_ref is null then
    return jsonb_build_object('error', 'a regulatory requirement carries a reference (requirement_ref, e.g. REG-01)');
  end if;
  if v_tier not in ('LAW','REGULATION') then
    return jsonb_build_object('error',
      'source_authority for a regulatory requirement is LAW or REGULATION — a statutory duty recorded at a lower tier would carry weight it does not have into engineering (spec provenance ladder)');
  end if;
  if coalesce(btrim(p_requirement->>'regulator'), '') = ''
     or coalesce(btrim(p_requirement->>'jurisdiction'), '') = ''
     or coalesce(btrim(p_requirement->>'instrument'), '') = ''
     or coalesce(btrim(p_requirement->>'permit_type'), '') = '' then
    return jsonb_build_object('error',
      'name the regulator, the jurisdiction, the instrument that creates the duty and the permit type — a requirement missing any of them cannot be applied for');
  end if;
  if coalesce(length(btrim(coalesce(p_requirement->>'description',''))), 0) < 10 then
    return jsonb_build_object('error', 'state what the requirement demands (10 characters minimum)');
  end if;
  if coalesce(btrim(p_requirement->>'trigger_condition'), '') = '' then
    return jsonb_build_object('error',
      'state what triggers this duty — a permit whose trigger is unrecorded is one nobody knows to start');
  end if;
  if v_lead_raw is not null and v_lead is null then
    return jsonb_build_object('error',
      format('expected_lead_time_days must be a whole number of days — "%s" is not one', v_lead_raw));
  end if;
  if v_required_by_raw is not null and v_required_by is null then
    return jsonb_build_object('error',
      format('required_by_date must be a date (YYYY-MM-DD) — "%s" is not one', v_required_by_raw));
  end if;
  if v_lead is null or v_lead <= 0 then
    return jsonb_build_object('error',
      'state the expected regulator lead time in days (a positive number) — without it the permit cannot sit on the critical path, which is the whole point of spec I.19');
  end if;
  if exists (select 1 from regulatory_requirements r
             where r.organization_id = v_org and r.requirement_ref = v_ref) then
    return jsonb_build_object('error',
      format('regulatory requirement reference "%s" already exists in this organization', v_ref));
  end if;

  perform set_config('app.regulatory_chain_write', 'granted', true);
  insert into regulatory_requirements (
    organization_id, development_case_id, requirement_ref, regulator, jurisdiction,
    instrument, permit_type, description, source_authority, trigger_condition,
    expected_lead_time_days, required_by_date, created_by)
  values (
    v_org, c.id, v_ref, btrim(p_requirement->>'regulator'),
    btrim(p_requirement->>'jurisdiction'), btrim(p_requirement->>'instrument'),
    btrim(p_requirement->>'permit_type'), btrim(p_requirement->>'description'),
    v_tier, btrim(p_requirement->>'trigger_condition'), v_lead,
    v_required_by, auth.uid())
  returning id into v_id;
  perform set_config('app.regulatory_chain_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'regulatory_requirement', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'requirement_id', v_id, 'action', 'identified',
      'requirement_ref', v_ref, 'regulator', btrim(p_requirement->>'regulator'),
      'source_authority', v_tier),
    null,
    jsonb_build_object('status', 'identified', 'source_authority', v_tier,
      'expected_lead_time_days', v_lead));

  return jsonb_build_object('requirement_id', v_id, 'case_id', c.id,
    'requirement_ref', v_ref, 'status', 'identified');
end
$$;

revoke all on function public.record_regulatory_requirement(uuid, jsonb) from public, anon;
grant execute on function public.record_regulatory_requirement(uuid, jsonb) to authenticated, service_role;

-- Submitting an application moves the requirement to 'applied' in the SAME
-- transaction: a chain whose links can disagree about where it stands is the
-- spreadsheet again.
create or replace function public.submit_regulatory_application(
  p_requirement_id bigint,
  p_application jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  r regulatory_requirements%rowtype;
  v_ref text := nullif(btrim(coalesce(p_application->>'application_ref','')), '');
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'submitting a regulatory application requires a planning, engineering or governance role');
  end if;
  select * into r from regulatory_requirements
  where id = p_requirement_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'regulatory requirement not found');
  end if;
  if r.status in ('not_required','withdrawn') then
    return jsonb_build_object('error',
      format('this requirement is %s — record a new requirement rather than applying against a closed one', r.status));
  end if;
  if v_ref is null then
    return jsonb_build_object('error', 'an application carries the reference the regulator will use (application_ref)');
  end if;
  if coalesce(length(btrim(coalesce(p_application->>'scope_description',''))), 0) < 10 then
    return jsonb_build_object('error', 'state what the application covers (10 characters minimum)');
  end if;
  if exists (select 1 from regulatory_applications a
             where a.organization_id = v_org and a.application_ref = v_ref) then
    return jsonb_build_object('error',
      format('application reference "%s" already exists in this organization', v_ref));
  end if;

  perform set_config('app.regulatory_chain_write', 'granted', true);
  insert into regulatory_applications (
    organization_id, requirement_id, application_ref, submitted_at, submitted_by,
    scope_description, status, created_by)
  values (
    v_org, r.id, v_ref, now(), auth.uid(),
    btrim(p_application->>'scope_description'), 'submitted', auth.uid())
  returning id into v_id;

  update regulatory_requirements set status = 'applied' where id = r.id;
  perform set_config('app.regulatory_chain_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'regulatory_application', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', r.development_case_id, 'application_id', v_id,
      'action', 'submitted', 'application_ref', v_ref, 'requirement_id', r.id,
      'expected_decision_by', (current_date + r.expected_lead_time_days)),
    jsonb_build_object('requirement_status', r.status),
    jsonb_build_object('requirement_status', 'applied', 'application_status', 'submitted'));

  return jsonb_build_object('application_id', v_id, 'application_ref', v_ref,
    'requirement_id', r.id, 'status', 'submitted',
    'expected_decision_by', (current_date + r.expected_lead_time_days));
end
$$;

revoke all on function public.submit_regulatory_application(bigint, jsonb) from public, anon;
grant execute on function public.submit_regulatory_application(bigint, jsonb) to authenticated, service_role;

create or replace function public.record_regulatory_information_request(
  p_application_id bigint,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  a regulatory_applications%rowtype;
  v_ref text := nullif(btrim(coalesce(p_request->>'request_ref','')), '');
  -- Raw text beside the parsed value (20261122090000 section 0).
  v_owner_raw text := nullif(btrim(coalesce(p_request->>'owner_id','')), '');
  v_owner uuid := sync_text_as_uuid(v_owner_raw);
  v_requested_raw text := nullif(btrim(coalesce(p_request->>'requested_at','')), '');
  v_requested date := coalesce(sync_text_as_date(v_requested_raw), current_date);
  v_due_raw text := nullif(btrim(coalesce(p_request->>'response_due','')), '');
  v_due date := sync_text_as_date(v_due_raw);
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'recording an information request requires a planning, engineering or governance role');
  end if;
  select * into a from regulatory_applications
  where id = p_application_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'regulatory application not found');
  end if;
  if a.status in ('draft','withdrawn') then
    return jsonb_build_object('error',
      format('this application is %s — a regulator does not raise information requests against it', a.status));
  end if;
  if v_ref is null then
    return jsonb_build_object('error', 'an information request carries the regulator''s reference (request_ref)');
  end if;
  if coalesce(length(btrim(coalesce(p_request->>'request_detail',''))), 0) < 10 then
    return jsonb_build_object('error', 'state what the regulator asked for (10 characters minimum)');
  end if;
  if v_owner_raw is not null and v_owner is null then
    return jsonb_build_object('error',
      format('owner_id must be a user id (uuid) — "%s" is not one', v_owner_raw));
  end if;
  if v_requested_raw is not null and v_requested is null then
    return jsonb_build_object('error',
      format('requested_at must be a date (YYYY-MM-DD) — "%s" is not one', v_requested_raw));
  end if;
  if v_due_raw is not null and v_due is null then
    return jsonb_build_object('error',
      format('response_due must be a date (YYYY-MM-DD) — "%s" is not one', v_due_raw));
  end if;
  if v_owner is null or not exists (
    select 1 from user_profiles where id = v_owner and organization_id = v_org) then
    return jsonb_build_object('error',
      'an information request has a named owner in this organization — the unowned RFI is where permits die');
  end if;
  if v_due is null then
    return jsonb_build_object('error',
      'state the response due date — an RFI with no deadline never becomes overdue and never escalates');
  end if;
  if v_due < v_requested then
    return jsonb_build_object('error', 'the response due date cannot precede the request date');
  end if;
  if exists (select 1 from regulatory_information_requests q
             where q.organization_id = v_org and q.request_ref = v_ref) then
    return jsonb_build_object('error',
      format('information request reference "%s" already exists in this organization', v_ref));
  end if;

  perform set_config('app.regulatory_chain_write', 'granted', true);
  insert into regulatory_information_requests (
    organization_id, application_id, request_ref, requested_at, response_due,
    request_detail, owner_id)
  values (
    v_org, a.id, v_ref, v_requested, v_due, btrim(p_request->>'request_detail'), v_owner)
  returning id into v_id;

  update regulatory_applications set status = 'information_requested'
  where id = a.id and status = 'submitted';
  perform set_config('app.regulatory_chain_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'regulatory_information_request', coalesce(v_role, 'unknown'),
    jsonb_build_object('application_id', a.id, 'request_id', v_id, 'action', 'raised',
      'request_ref', v_ref, 'owner_id', v_owner, 'response_due', v_due),
    jsonb_build_object('application_status', a.status),
    jsonb_build_object('application_status', 'information_requested', 'request_status', 'open'));

  return jsonb_build_object('request_id', v_id, 'request_ref', v_ref,
    'application_id', a.id, 'status', 'open', 'response_due', v_due);
end
$$;

revoke all on function public.record_regulatory_information_request(bigint, jsonb) from public, anon;
grant execute on function public.record_regulatory_information_request(bigint, jsonb) to authenticated, service_role;

-- Responding to an RFI is evidence-gated for the same reason closing a gate
-- condition is: "we answered it" is an assertion until the response exists
-- as a recorded artefact of the case.
create or replace function public.respond_regulatory_information_request(
  p_request_id bigint,
  p_evidence_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  q regulatory_information_requests%rowtype;
  ev evidence_items%rowtype;
  v_case uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'responding to an information request requires a planning, engineering or governance role');
  end if;
  select * into q from regulatory_information_requests
  where id = p_request_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'information request not found');
  end if;
  if q.status = 'responded' then
    return jsonb_build_object('error', 'this information request is already answered — a response is not overwritable');
  end if;
  if p_evidence_id is null then
    return jsonb_build_object('error',
      format('answering RFI %s requires the response as recorded evidence — record it (record_case_evidence) and link it here', q.request_ref));
  end if;
  select rr.development_case_id into v_case
  from regulatory_applications a
  join regulatory_requirements rr on rr.id = a.requirement_id
  where a.id = q.application_id;
  select * into ev from evidence_items where id = p_evidence_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evidence item not found in this organization');
  end if;
  if ev.development_case_id is distinct from v_case then
    return jsonb_build_object('error',
      'that evidence item is not recorded against this permit''s case — one case''s evidence cannot answer another case''s regulator');
  end if;

  perform set_config('app.regulatory_chain_write', 'granted', true);
  update regulatory_information_requests
  set status = 'responded', responded_at = now(), responded_by = auth.uid(),
      response_evidence_id = ev.id
  where id = q.id;
  perform set_config('app.regulatory_chain_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'regulatory_information_request', coalesce(v_role, 'unknown'),
    jsonb_build_object('request_id', q.id, 'action', 'responded',
      'request_ref', q.request_ref, 'case_id', v_case, 'evidence_id', ev.id,
      'was_overdue', q.breached_at is not null),
    jsonb_build_object('status', q.status, 'breached_at', q.breached_at),
    jsonb_build_object('status', 'responded', 'responded_by', auth.uid(),
      'response_evidence_id', ev.id, 'breached_at', q.breached_at));

  return jsonb_build_object('request_id', q.id, 'status', 'responded',
    'answered_late', q.breached_at is not null);
end
$$;

revoke all on function public.respond_regulatory_information_request(bigint, uuid) from public, anon;
grant execute on function public.respond_regulatory_information_request(bigint, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
