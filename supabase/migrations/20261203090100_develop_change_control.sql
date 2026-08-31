-- ============================================================================
-- Sync Develop Slice 4D (2 of 4) — THE CHANGE OBJECT AND WORKFLOW 3.
--
-- D5.27 (Change object with propagation chain, spec §21) and D5.30
-- (Workflow 3: change control, baseline-anchored, authority-routed, spec §37).
--
-- SPEC §21: "Change: id, baseline_id, proposed_change, reason, requester,
-- technical_effect, cost_effect, schedule_effect, risk_effect, status.
-- Propagation: Change -> Requirements -> Drawings -> Procurement -> Schedule
-- -> Cost -> Risk -> PM strategy -> Commissioning."
--
-- SPEC WORKFLOW 3: "Proposed change -> identify baseline -> dependencies ->
-- impacts -> risk reassessment -> cost/schedule impact -> required authority
-- -> decision -> propagate approved change."
--
-- THE RULING THIS FILE IS BUILT ON, AND WHY IT IS NOT A PARALLEL STORE.
-- The overlap map's verdict on D5.27/D5.30 is EXTEND: "the MOC-in-40-files
-- machinery (change-class gating, competence sign-off triggers, auto
-- re-review) is the foundation; add baseline anchoring, impact vector,
-- authority routing, propagation. A parallel change store is forbidden."
--
-- The MOC ENGINE is `engineering_approval_rules` (change_class -> the role
-- whose competence must sign) plus the enforcement idiom that reads it at the
-- moment of approval (20260809140000:461-560, still live inside
-- enforce_authority_limit). What that engine has never had is a SUBJECT of its
-- own: it gates the approval of a `recommendations` row — an asset
-- recommendation, with an asset_id and a maintenance action. A project change
-- against a cost baseline is not a maintenance recommendation, and forcing one
-- into that table would give every change an asset it does not have and every
-- recommendation a baseline it does not have.
--
-- So `project_changes` is the Change object §21 names, and it RIDES the
-- existing engine rather than forking it:
--   * its `change_class` must be a class in `engineering_approval_rules` for
--     this organization — the same vocabulary, the same table, extended with
--     the four project-delivery classes rather than twinned;
--   * its competence sign-off is that rule's `required_role`, checked by the
--     same 20260809140000 shape;
--   * a class with a rule cannot be APPROVED unsigned, enforced by trigger on
--     INSERT and UPDATE, exactly as enforce_authority_limit enforces it for
--     recommendations;
--   * its money authority comes from `authority_limits` with a new
--     action_type — the ONE authority store, ruling 14, no third store.
-- What is NEW is what the register said was missing and nothing in the
-- codebase had: the baseline anchor, the impact vector, the authority routing
-- and the propagation chain.
--
-- WHAT "PROPAGATE" HONESTLY MEANS HERE. Sync is not the system of record for
-- P6, for the estimate, or for the drawing register (spec §22, §77). It cannot
-- claim to have pushed a change into them. It CAN do two things truthfully:
--   (a) apply the hops it owns — the approved-change reference on post-baseline
--       scope attribution (20261130090400, which is the "changed without an
--       approved change request" signal, spec I.7), and the contingency
--       drawdown attributed to this change (20261203090000);
--   (b) carry every other hop as a NAMED, OUTSTANDING OBLIGATION that a human
--       closes with a note.
-- A propagation row that quietly marked itself done in a system Sync does not
-- own would be the most dangerous number in this slice: it would say a change
-- reached the schedule when nothing had reached the schedule.
--
-- §70. No AI or system identity may approve a change. The AI-operator identity
-- MAY raise one — proposing is not deciding, the 20261105090300 discipline —
-- and is refused by name at ASSESSMENT as well as at DECISION, because the
-- assessed cost effect is the number the authority routing is computed from:
-- an AI that could write the impact vector could route a $10M change to a
-- $50k approver.
--
-- Canonical reuse: engineering_approval_rules, authority_limits (+ its org-node
-- scope rule), development_baselines, project_scope_changes,
-- project_contingency_pools / contingency_ledger_entries, risks,
-- audit_events, security_events, record_calculation_run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE ONE AUTHORITY STORE gains change approval (ruling 14).
-- ---------------------------------------------------------------------------
alter table public.authority_limits
  drop constraint if exists authority_limits_action_type_check;
alter table public.authority_limits
  add constraint authority_limits_action_type_check
    check (action_type in ('general','sanction','regulatory_variance',
                           'gate_requirement_waiver','contingency_drawdown',
                           'change_approval'));

insert into authority_limits (organization_id, role_key, tier_label, action_type,
  max_commitment_usd, max_risk_level, escalates_to_role, basis)
select o.id, v.role_key, v.tier_label, 'change_approval',
       null, v.risk, v.escalates, v.basis
from organizations o
cross join (values
  ('maintenance_manager', 'Project manager', 'Medium', 'executive',
   'Proposed: changes whose cost effect sits inside the project manager''s delegation are decided there. The AMOUNT is deliberately null so the row cannot be adopted without the organization stating its own number — a null ceiling REFUSES approval, it does not permit an unlimited one.'),
  ('executive', 'Executive', 'High', 'board',
   'Proposed: changes above the project manager''s ceiling, or touching High residual risk, escalate to the executive layer. Placeholder pending the organization''s own delegation instrument.'),
  ('board', 'Board', 'Critical', null,
   'Proposed: the top of the change ladder. Placeholder pending the board charter.')
) as v(role_key, tier_label, risk, escalates, basis)
where not exists (
  select 1 from authority_limits al
  where al.organization_id = o.id and al.role_key = v.role_key
    and al.action_type = 'change_approval'
);

-- ---------------------------------------------------------------------------
-- 2. THE MOC ENGINE'S VOCABULARY grows the project-delivery classes.
--    Same table, same shape, same competence semantics as the four asset
--    classes seeded in 20260809140000. A second class table would be the
--    parallel store the overlap map forbids.
-- ---------------------------------------------------------------------------
insert into engineering_approval_rules (organization_id, change_class, title, required_role, basis)
select o.id, v.c, v.t, v.r, v.b
from organizations o
cross join (values
  ('project_scope_change', 'Change to approved project scope', 'reliability_engineer',
   'Proposed: added or removed scope changes what the asset will be and what it must be verified against. Engineering confirms the change is technically coherent before the commercial decision is taken.'),
  ('project_design_change', 'Change to an approved design basis', 'reliability_engineer',
   'Proposed: a design-basis change alters the requirements the asset is built and commissioned to. Competence sign-off precedes authority.'),
  ('project_schedule_change', 'Change to the approved schedule baseline', 'reliability_engineer',
   'Proposed: re-sequencing or re-dating approved work changes exposure between interventions and the constraints downstream work was planned against.'),
  ('project_cost_change', 'Change to the approved cost baseline', 'reliability_engineer',
   'Proposed: a cost-baseline change moves the number every earned-value metric on this project is measured against.')
) as v(c, t, r, b)
where not exists (
  select 1 from engineering_approval_rules e
  where e.organization_id = o.id and e.change_class = v.c
);

-- ---------------------------------------------------------------------------
-- 3. THE CHANGE OBJECT (§21).
-- ---------------------------------------------------------------------------
create table if not exists public.project_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  -- §21's `baseline_id`, and the answer to Workflow 3's "identify baseline".
  -- RESTRICT: a change outlives nothing — deleting the baseline it modifies
  -- would leave a change that changes nothing in particular.
  baseline_id uuid not null references development_baselines(id) on delete restrict,
  change_ref text not null check (btrim(change_ref) <> ''),
  -- The MOC engine's vocabulary. Enforced against engineering_approval_rules
  -- by trigger, not by a check constraint, because the classes are per
  -- organization.
  change_class text not null check (btrim(change_class) <> ''),
  proposed_change text not null check (length(btrim(proposed_change)) >= 20),
  reason text not null check (length(btrim(reason)) >= 20),
  requester_id uuid not null references auth.users(id),
  status text not null default 'proposed' check (status in
    ('proposed','assessed','approved','rejected','withdrawn','implemented')),

  -- ── the impact vector (§21), written by assess_project_change ──────────
  technical_effect text,
  cost_effect numeric,
  schedule_effect_days numeric,
  risk_effect text check (risk_effect is null or risk_effect in ('Low','Medium','High','Critical')),
  contingency_effect numeric,
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  impact_basis text,
  assessed_by uuid references auth.users(id),
  assessed_at timestamptz,

  -- ── the MOC competence sign-off, the 20260809140000 shape ──────────────
  competence_signed_by uuid references auth.users(id),
  competence_signed_at timestamptz,
  competence_note text,

  -- ── the decision and the authority it was taken under ──────────────────
  authority_limit_id uuid references authority_limits(id) on delete restrict,
  approver_id uuid references auth.users(id),
  approver_role text,
  approver_ceiling_usd numeric,
  decided_at timestamptz,
  decision_note text,
  implemented_by uuid references auth.users(id),
  implemented_at timestamptz,
  created_at timestamptz not null default now(),
  unique (development_case_id, change_ref),

  -- Every stated money and duration figure is finite. NaN and the infinities
  -- are legal numerics and would pass every ceiling test vacuously.
  constraint project_change_effects_finite check (
    (cost_effect is null or (cost_effect <> 'NaN'::numeric
       and cost_effect <> 'Infinity'::numeric and cost_effect <> '-Infinity'::numeric))
    and (schedule_effect_days is null or (schedule_effect_days <> 'NaN'::numeric
       and schedule_effect_days <> 'Infinity'::numeric and schedule_effect_days <> '-Infinity'::numeric))
    and (contingency_effect is null or (contingency_effect <> 'NaN'::numeric
       and contingency_effect <> 'Infinity'::numeric and contingency_effect <> '-Infinity'::numeric))
    and (approver_ceiling_usd is null or (approver_ceiling_usd <> 'NaN'::numeric
       and approver_ceiling_usd <> 'Infinity'::numeric and approver_ceiling_usd <> '-Infinity'::numeric))),
  -- An assessment is complete or it did not happen. A half-written impact
  -- vector is what lets a change be routed on a cost effect nobody stated.
  constraint project_change_assessment_complete check (
    assessed_at is null
    or (assessed_by is not null
        and cost_effect is not null
        and schedule_effect_days is not null
        and risk_effect is not null
        and currency is not null
        and coalesce(length(btrim(impact_basis)), 0) >= 20
        and coalesce(length(btrim(technical_effect)), 0) >= 10)),
  -- A decision names who took it, when, under which role, and why.
  constraint project_change_decision_complete check (
    decided_at is null
    or (approver_id is not null and btrim(coalesce(approver_role, '')) <> ''
        and coalesce(length(btrim(decision_note)), 0) >= 20)),
  -- The status and the record cannot drift apart.
  constraint project_change_status_record check (
    (status in ('approved','rejected') and decided_at is not null)
    or (status not in ('approved','rejected') and decided_at is null)
    or (status = 'implemented' and decided_at is not null)),
  constraint project_change_assessed_status check (
    status not in ('assessed','approved','implemented') or assessed_at is not null),
  constraint project_change_signed_pair check (
    (competence_signed_at is null) = (competence_signed_by is null)),
  constraint project_change_implemented_pair check (
    (implemented_at is null) = (implemented_by is null)
    and (implemented_at is null or status = 'implemented'))
);

create index if not exists idx_project_change_case
  on project_changes(organization_id, development_case_id, status, created_at desc);
create index if not exists idx_project_change_baseline
  on project_changes(baseline_id);

alter table public.project_changes enable row level security;
drop policy if exists project_changes_read on public.project_changes;
create policy project_changes_read on public.project_changes
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: every mutation is a definer RPC.

comment on table public.project_changes is
  'D5.27/D5.30 (spec §21, Workflow 3): the Change object, anchored to the baseline it modifies, carrying the four-part impact vector, gated by the SAME engineering_approval_rules MOC engine that gates asset change classes, and routed to an approver by authority_limits.action_type = change_approval. Not a parallel change store: the class vocabulary, the competence sign-off and the authority ladder are all the existing ones.';

-- ---------------------------------------------------------------------------
-- 4. THE PROPAGATION CHAIN (§21's second sentence).
-- ---------------------------------------------------------------------------
create table if not exists public.project_change_propagation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  change_id uuid not null references project_changes(id) on delete cascade,
  target_kind text not null check (target_kind in
    ('scope','cost','schedule','contingency','requirement','risk','procurement','commissioning')),
  -- The row Sync can point at, WHEN it can point at one. Null is a real and
  -- reported state: "this change reaches the schedule, and nobody has said
  -- which activity".
  target_table text,
  target_id uuid,
  effect text not null check (length(btrim(effect)) >= 10),
  status text not null default 'pending'
    check (status in ('pending','applied','not_applicable','blocked')),
  -- Whether Sync OWNS this hop. Owned hops are applied by the system and can
  -- be proven; unowned hops are obligations a human closes with a note.
  sync_owned boolean not null default false,
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  close_note text,
  created_at timestamptz not null default now(),
  constraint change_propagation_closure check (
    (status = 'pending') = (closed_at is null)),
  constraint change_propagation_close_record check (
    closed_at is null
    or (closed_by is not null and coalesce(length(btrim(close_note)), 0) >= 10)),
  constraint change_propagation_target_pair check (
    (target_table is null) = (target_id is null))
);

create index if not exists idx_change_propagation_change
  on project_change_propagation(change_id, status);

alter table public.project_change_propagation enable row level security;
drop policy if exists change_propagation_read on public.project_change_propagation;
create policy change_propagation_read on public.project_change_propagation
  for select to authenticated using (organization_id = app_current_org());

comment on table public.project_change_propagation is
  'D5.27 (spec §21): one row per downstream object an approved change moves. `sync_owned` rows are applied by propagate_project_change and can be proven from the target record; the rest are NAMED OBLIGATIONS a human closes with a note, because Sync is not the system of record for P6, the estimate or the drawing register and must never report a change as having reached them when it has not.';

-- ---------------------------------------------------------------------------
-- 5. THE CONTINGENCY LEDGER learns the change cause (D5.19's second linked
--    class). Added here, in the file that creates the store it cites, so the
--    column and its subject arrive together.
-- ---------------------------------------------------------------------------
alter table public.contingency_ledger_entries
  add column if not exists cause_change_id uuid references project_changes(id) on delete restrict;

alter table public.contingency_ledger_entries
  drop constraint if exists contingency_entry_linked_change;
alter table public.contingency_ledger_entries
  add constraint contingency_entry_linked_change check (
    cause_class is distinct from 'approved_change' or cause_change_id is not null);

create index if not exists idx_contingency_entry_change
  on contingency_ledger_entries(cause_change_id) where cause_change_id is not null;

-- ---------------------------------------------------------------------------
-- 6. THE WALLS. INSERT and UPDATE and DELETE, plus the statement-level
--    TRUNCATE guard (a row trigger never fires for TRUNCATE).
--
--    The MOC enforcement lives HERE rather than only in the RPC, for the
--    reason 20261005090300 recorded about enforce_authority_limit: a rule
--    checked only at a door is invisible to every other writer, and this table
--    has a service path.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_project_change_governance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  e engineering_approval_rules%rowtype;
  b development_baselines%rowtype;
  v_requester_role text;
  v_approver_role text;
  v_client boolean := auth.uid() is not null;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'project_changes records what was proposed against an approved baseline, who assessed it, who signed for competence and who approved it. Truncating it erases every such record in one statement, which the row-level guard cannot refuse.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not v_client then
      if exists (select 1 from organizations where id = old.organization_id) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values (old.organization_id, null, 'service (' || current_user || ')',
          'admin_action', 'critical',
          'Project change ' || old.change_ref || ' deleted by a service caller. '
            || 'Deleting a change removes the record of an approved modification to '
            || 'a baseline, and with it the authority it was approved under (D5.27).');
      end if;
      return old;
    end if;
    raise exception
      'a project change is not deleted — a change that should not proceed is WITHDRAWN or REJECTED, and both leave the record of what was proposed and by whom.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The baseline anchor must be a baseline OF THIS CASE. A change anchored to
  -- another case's baseline modifies a document this project does not own.
  select * into b from development_baselines
   where id = new.baseline_id and development_case_id = new.development_case_id
     and organization_id = new.organization_id;
  if not found then
    raise exception
      'a project change must be anchored to a baseline of its own development case (spec §21, Workflow 3 "identify baseline").'
      using errcode = 'check_violation';
  end if;
  if b.status = 'draft' then
    raise exception
      'baseline % is still a draft. A change modifies something that was FIXED; a draft baseline changes by being edited, and calling that a change request makes the change record meaningless.',
      b.id using errcode = 'check_violation';
  end if;
  -- 4D-R16 on the row. A change is only ever CREATED against a baseline in
  -- force; a baseline superseded later does not invalidate the changes already
  -- decided against it, so the check is on INSERT.
  if tg_op = 'INSERT' and b.status <> 'approved' then
    raise exception
      'baseline % is %. A change is raised against the baseline currently in force; a superseded baseline has already been replaced, and a change against it moves a document that no longer governs.',
      b.id, b.status using errcode = 'check_violation';
  end if;

  -- The MOC engine's vocabulary, enforced for every writer.
  select * into e from engineering_approval_rules
   where organization_id = new.organization_id and change_class = new.change_class;
  if not found then
    raise exception
      'change class "%" has no engineering approval rule in this organization. The class vocabulary is engineering_approval_rules (the MOC engine); a class outside it has no competence requirement attached and would be approved by nobody in particular.',
      new.change_class using errcode = 'check_violation';
  end if;

  select role into v_requester_role from user_profiles
   where id = new.requester_id and organization_id = new.organization_id;
  if v_requester_role is null then
    raise exception 'the requester of a project change must be a member of this organization'
      using errcode = 'check_violation';
  end if;

  -- §70 ON THE ROW, not only in the door (the 4C repair's R7a lesson): a
  -- service caller writing this table directly cannot mint an AI-approved
  -- change either. Covers INSERT and UPDATE, because an admitted service
  -- UPDATE that flipped approver_id would walk past an INSERT-only check.
  if new.approver_id is not null then
    select role into v_approver_role from user_profiles
     where id = new.approver_id and organization_id = new.organization_id;
    if v_approver_role is null then
      raise exception 'the approver of a project change must be a member of this organization'
        using errcode = 'check_violation';
    end if;
    if v_approver_role = 'ai_admin' then
      raise exception
        'this change decision is attributed to the AI-operator identity. Spec §70: no AI or system identity may approve a change. The AI may raise a change and explain its impact; a human decides it.'
        using errcode = 'check_violation';
    end if;
    -- §42 segregation of duties: REQUESTER != FINAL APPROVER.
    if new.approver_id = new.requester_id then
      raise exception
        'segregation of duties (spec §42): the requester of a change cannot be its final approver. Route the decision to somebody else, or escalate.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- THE MOC RULE: a class with an engineering rule cannot reach `approved`
  -- unsigned. This is 20260809140000's sentence, enforced on this table.
  if new.status = 'approved' and new.competence_signed_at is null then
    raise exception
      'Engineering approval: "%" requires sign-off by the % role before this change can be approved.',
      e.title, e.required_role using errcode = 'check_violation';
  end if;
  -- ...and the signer must actually hold that competence role.
  if new.competence_signed_by is not null then
    if not exists (select 1 from user_profiles up
                    where up.id = new.competence_signed_by
                      and up.organization_id = new.organization_id
                      and (up.role = e.required_role or up.role = 'admin')) then
      raise exception
        'Engineering approval: "%" must be signed by the % role; the recorded signer does not hold it.',
        e.title, e.required_role using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- The anchor, the class, the proposal and the requester are what the
    -- change IS. A change whose subject can be rewritten after approval is an
    -- approval of nothing in particular.
    if new.baseline_id is distinct from old.baseline_id
       or new.change_class is distinct from old.change_class
       or new.requester_id is distinct from old.requester_id
       or new.proposed_change is distinct from old.proposed_change then
      if v_client then
        raise exception
          'the baseline, class, proposal and requester of a change are fixed once it is raised. A different proposal is a NEW change request, so that the record still says what was actually decided.'
          using errcode = 'insufficient_privilege';
      elsif exists (select 1 from organizations where id = new.organization_id) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values (new.organization_id, null, 'service (' || current_user || ')',
          'admin_action', 'critical',
          'The subject of project change ' || new.change_ref || ' was rewritten by a '
            || 'service caller. What a change modifies is what its approval means (D5.27).');
      end if;
    end if;
    -- A decided change does not un-decide.
    --
    -- REVIEW REPAIR (4D-R17). This branch admitted the SERVICE path silently —
    -- it was the one branch of this trigger that wrote no security_events at
    -- all — and the consequence was authority laundering, not bookkeeping: an
    -- implemented, authority-approved change could be reset to `proposed` with
    -- `decided_at` and `approver_id` nulled, its impact vector re-assessed to a
    -- smaller cost effect (assess_project_change gates only on `decided_at`),
    -- and the change re-approved under a LOWER sync_change_authority ceiling —
    -- while a recorded contingency drawdown still carried `cause_change_id`
    -- pointing at what now read as a proposal. Un-deciding is therefore refused
    -- for EVERY caller, the service path included, exactly as the contingency
    -- ledger's money fields are.
    if old.decided_at is not null
       and (new.decided_at is distinct from old.decided_at
            or new.approver_id is distinct from old.approver_id
            or new.approver_role is distinct from old.approver_role
            or new.approver_ceiling_usd is distinct from old.approver_ceiling_usd
            or new.authority_limit_id is distinct from old.authority_limit_id
            or new.cost_effect is distinct from old.cost_effect
            or new.contingency_effect is distinct from old.contingency_effect
            or new.schedule_effect_days is distinct from old.schedule_effect_days
            or new.risk_effect is distinct from old.risk_effect
            or new.status not in ('approved','rejected','implemented')) then
      -- NO security_events ROW ON A REFUSING PATH (4D-R33).
      --
      -- A BEFORE trigger that inserts an audit row and then RAISES loses the
      -- insert: the exception aborts the statement and the row goes with it.
      -- Proven live — a service UPDATE refused here left security_events
      -- unchanged. An audit call that cannot survive its own refusal is dead
      -- code that reads, in review and in the register, as an audit trail. The
      -- REFUSAL is the enforcement and it is total; the rows that do land are
      -- the ADMITTED service writes, which is where an audit trail is the only
      -- thing standing between the product and a silent change.
      raise exception
        'this change has already been decided, and neither the decision nor the impact it was routed on may be rewritten by ANY caller, service paths included. A decided change that can be re-assessed and re-approved is a change that can be moved under a smaller ceiling than the one it was approved against. Raise a new change to reverse its effect.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.enforce_project_change_governance() from public, anon, authenticated;

drop trigger if exists trg_project_change_governance on public.project_changes;
create trigger trg_project_change_governance
  before insert or update or delete on public.project_changes
  for each row execute function public.enforce_project_change_governance();

drop trigger if exists trg_project_change_no_truncate on public.project_changes;
create trigger trg_project_change_no_truncate
  before truncate on public.project_changes
  for each statement execute function public.enforce_project_change_governance();

revoke truncate on table public.project_changes from anon, authenticated, service_role;
revoke truncate on table public.project_change_propagation from anon, authenticated, service_role;

create or replace function public.enforce_change_propagation_wall()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client boolean := auth.uid() is not null;
  v_org uuid;
  ch project_changes%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'project_change_propagation is the record of what an approved change still has to reach. Truncating it makes every outstanding obligation disappear in one statement and every change look fully propagated.'
      using errcode = 'insufficient_privilege';
  end if;

  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  if tg_op = 'DELETE' then
    if not v_client then
      if exists (select 1 from organizations where id = v_org) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values (v_org, null, 'service (' || current_user || ')',
          'admin_action', 'warning',
          'A change propagation obligation was deleted by a service caller. Deleting '
            || 'an outstanding hop is the cheapest way to make a change look fully '
            || 'propagated (D5.27).');
      end if;
      return old;
    end if;
    raise exception
      'a propagation obligation is not deleted — it is CLOSED as applied or as not applicable, with a note, so the record says what happened to it.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into ch from project_changes where id = new.change_id;
  if not found or ch.organization_id is distinct from new.organization_id then
    raise exception 'a propagation row must belong to a change in the same organization'
      using errcode = 'check_violation';
  end if;
  if new.closed_by is not null
     and not exists (select 1 from user_profiles up
                      where up.id = new.closed_by and up.organization_id = new.organization_id
                        and up.role <> 'ai_admin') then
    raise exception
      'closing a propagation obligation asserts that an approved change reached a downstream object. Spec §70 reserves that assertion to a human member of this organization.'
      using errcode = 'check_violation';
  end if;

  -- REVIEW REPAIR (4D-R18). UPDATE carried no immutability and no service
  -- audit, so a service caller could REOPEN every closed obligation, then
  -- forge a closure — `status='applied'`, a real manager as `closed_by`, a
  -- note — on all of them, INCLUDING the `contingency` hop that
  -- close_change_propagation reserves to "the record that proves it", with
  -- security_events unchanged. `implement_project_change`'s "nothing
  -- outstanding" gate then passed with nothing behind the claim.
  if tg_op = 'UPDATE' then
    -- A closed obligation does not reopen, and Sync-ownership does not flip:
    -- a Sync-owned hop is closed by proving it from the target record, and
    -- flipping the flag is how that proof requirement is escaped.
    if (old.closed_at is not null
        and (new.closed_at is null or new.status = 'pending'))
       or new.sync_owned is distinct from old.sync_owned
       or new.change_id is distinct from old.change_id
       or new.target_kind is distinct from old.target_kind
       or new.organization_id is distinct from old.organization_id then
      -- NO security_events ROW ON A REFUSING PATH (4D-R33).
      --
      -- A BEFORE trigger that inserts an audit row and then RAISES loses the
      -- insert: the exception aborts the statement and the row goes with it.
      -- Proven live — a service UPDATE refused here left security_events
      -- unchanged. An audit call that cannot survive its own refusal is dead
      -- code that reads, in review and in the register, as an audit trail. The
      -- REFUSAL is the enforcement and it is total; the rows that do land are
      -- the ADMITTED service writes, which is where an audit trail is the only
      -- thing standing between the product and a silent change.
      raise exception
        'a closed propagation obligation does not reopen, and whether Sync owns a hop is not editable — a Sync-owned hop is closed by the record that proves it, and flipping the flag is how that proof requirement is escaped. This is refused for every caller, service paths included.'
        using errcode = 'insufficient_privilege';
    end if;
    -- Anything else an admitted service caller writes is audited, because the
    -- closure of an obligation is the evidence behind "this change reached what
    -- it moves".
    if not v_client
       and (new.status is distinct from old.status
            or new.closed_by is distinct from old.closed_by
            or new.close_note is distinct from old.close_note)
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values (v_org, null, 'service (' || current_user || ')',
        'admin_action', 'critical',
        'Change propagation obligation ' || old.id || ' was closed or re-noted by a '
          || 'service caller rather than through close_change_propagation. The closure '
          || 'is the only evidence that an approved change reached a downstream object '
          || '(D5.27).');
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_change_propagation_wall() from public, anon, authenticated;

drop trigger if exists trg_change_propagation_wall on public.project_change_propagation;
create trigger trg_change_propagation_wall
  before insert or update or delete on public.project_change_propagation
  for each row execute function public.enforce_change_propagation_wall();

drop trigger if exists trg_change_propagation_no_truncate on public.project_change_propagation;
create trigger trg_change_propagation_no_truncate
  before truncate on public.project_change_propagation
  for each statement execute function public.enforce_change_propagation_wall();

-- ---------------------------------------------------------------------------
-- 7. THE CHANGE AUTHORITY SELECTION (R1/R2 of 20261203090000, restated for
--    change_approval). Same store, same org-node scope rule, same two
--    deliberate defaults: absence refuses, and a null ceiling refuses.
-- ---------------------------------------------------------------------------
create or replace function public.sync_change_authority(
  p_org uuid,
  p_role text,
  p_cost_effect numeric,
  p_risk_effect text,
  p_contingency_effect numeric default 0,
  p_currency text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l authority_limits%rowtype;
  -- 4D-R15. THE MAGNITUDE OF A CHANGE IS WHAT IT COMMITS, NOT ONLY WHAT IT
  --         ADDS TO THE ESTIMATE.
  --
  -- REVIEW REPAIR. Routing on `cost_effect` alone meant a change assessed with
  -- `cost_effect = 0` and `contingency_effect = 5,000,000` routed on magnitude
  -- 0 and was approvable under any adopted ceiling — and the change record then
  -- read "approved under Project manager, ceiling $250,000" for a decision
  -- committing $5M of the fund. Contingency IS owner capital; a change that
  -- spends it commits it just as surely as one that moves the baseline.
  v_magnitude numeric := abs(coalesce(p_cost_effect, 0))
                       + abs(coalesce(p_contingency_effect, 0));
begin
  select al.* into l
  from authority_limits al
  left join org_ancestry(p_org) anc on anc.node_id = al.org_node_id
  where al.organization_id = p_org
    and al.role_key = p_role
    and al.action_type = 'change_approval'
    and al.status = 'adopted'
    and (al.org_node_id is null or anc.node_id is not null)
  order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc
  limit 1;

  if not found then
    if exists (select 1 from authority_limits
                where organization_id = p_org and role_key = p_role
                  and action_type = 'change_approval' and status = 'adopted') then
      return jsonb_build_object('permitted', false, 'refusal', format(
        'Delegation of authority: every adopted change-approval delegation for %s is scoped to one organization node, and this case sits outside every such subtree. Escalate, or adopt a delegation covering this node.',
        p_role));
    end if;
    return jsonb_build_object('permitted', false, 'refusal', format(
      'Delegation of authority: no adopted change-approval delegation exists for %s in this organization. Approving a change moves an approved baseline and, through it, the numbers every controls report is measured against — it is not a default-permitted act. Adopt a change-approval delegation with a stated ceiling first.',
      p_role));
  end if;

  if l.max_commitment_usd is null then
    return jsonb_build_object('permitted', false, 'limitId', l.id, 'tierLabel', l.tier_label,
      'refusal', format(
      'Delegation of authority: the adopted %s change-approval delegation for %s states no money ceiling, so authority over a $%s change cannot be verified. A blank ceiling is an unfinished delegation, not an unlimited one — state it with set_authority_ceiling.',
      l.tier_label, p_role, v_magnitude));
  end if;

  -- 4D-R7, restated for change approval: the ceiling states its own currency
  -- and a change denominated in another one refuses rather than being compared
  -- across units Sync cannot convert between.
  if p_currency is not null
     and upper(btrim(p_currency)) is distinct from l.max_commitment_currency then
    return jsonb_build_object('permitted', false, 'limitId', l.id, 'tierLabel', l.tier_label,
      'ceiling', l.max_commitment_usd, 'ceilingCurrency', l.max_commitment_currency,
      'refusal', format(
      'Delegation of authority: this change is assessed in %s and the adopted %s change-approval ceiling for %s is stated in %s. Sync holds no exchange rate, so the two are not compared. State a %s ceiling on the delegation (set_authority_ceiling), or assess the change in %s.',
      upper(btrim(p_currency)), l.tier_label, p_role, l.max_commitment_currency,
      upper(btrim(p_currency)), l.max_commitment_currency));
  end if;

  if v_magnitude > l.max_commitment_usd then
    return jsonb_build_object('permitted', false, 'limitId', l.id, 'tierLabel', l.tier_label,
      'ceiling', l.max_commitment_usd, 'escalatesTo', l.escalates_to_role,
      'refusal', format(
      'Delegation of authority: a change committing $%s (cost effect plus contingency effect) exceeds the %s ceiling of $%s for %s. Escalate to %s.',
      v_magnitude, l.tier_label, l.max_commitment_usd, p_role,
      coalesce(l.escalates_to_role, 'the board')));
  end if;

  -- The risk dimension of the SAME ladder. §43's AuthorityRule is
  -- action_type + maximum_value + maximum_risk, and reading only the money
  -- half would let a Critical-risk change through on a small cost effect.
  if l.max_risk_level is not null and p_risk_effect is not null
     and risk_rank(p_risk_effect) > risk_rank(l.max_risk_level) then
    return jsonb_build_object('permitted', false, 'limitId', l.id, 'tierLabel', l.tier_label,
      'ceiling', l.max_commitment_usd, 'escalatesTo', l.escalates_to_role,
      'refusal', format(
      'Delegation of authority: a change with %s residual risk exceeds the %s risk ceiling of %s for %s. A small cost effect does not make a Critical-risk change a small decision. Escalate to %s.',
      p_risk_effect, l.tier_label, l.max_risk_level, p_role,
      coalesce(l.escalates_to_role, 'the board')));
  end if;

  return jsonb_build_object('permitted', true, 'limitId', l.id, 'tierLabel', l.tier_label,
    'ceiling', l.max_commitment_usd, 'ceilingCurrency', l.max_commitment_currency,
    'magnitude', v_magnitude, 'maxRisk', l.max_risk_level,
    'escalatesTo', l.escalates_to_role);
end
$$;

-- NOT CLIENT-CALLABLE, for the reason stated on sync_contingency_authority: it
-- takes an organization as an argument, so a direct client call would read
-- another tenant's adopted change delegation. Its callers are definers owned by
-- the migration role and pass an organization already resolved from the session.
revoke all on function public.sync_change_authority(uuid, text, numeric, text, numeric, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. WORKFLOW 3, STEP 1: raise. "Proposed change -> identify baseline".
--
--     ai_admin is ADMITTED here and refused at assessment and decision — the
--     20261105090300 discipline: the LLM frames the proposal, a human decides.
-- ---------------------------------------------------------------------------
create or replace function public.raise_project_change(
  p_case_id uuid,
  p_change jsonb
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
  v_ref text := btrim(coalesce(p_change->>'change_ref', ''));
  v_class text := btrim(coalesce(p_change->>'change_class', ''));
  v_baseline uuid;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'raising a change requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_baseline := sync_safe_uuid(p_change->>'baseline_id');
  if v_baseline is null then
    return jsonb_build_object('error',
      'name the baseline this change modifies. Workflow 3 begins "proposed change -> IDENTIFY BASELINE"; a change with no baseline changes nothing in particular and can be assessed against nothing.');
  end if;
  -- 4D-R16. A CHANGE IS ANCHORED TO A BASELINE THAT STILL GOVERNS.
  --
  -- REVIEW REPAIR. The row trigger refused only `draft`; the vocabulary is
  -- draft | approved | superseded, so a change could be raised, assessed,
  -- signed, approved and propagated against a document that had already been
  -- replaced. "A change modifies something that was FIXED" is only true while
  -- the thing it modifies is still the thing in force.
  if not exists (select 1 from development_baselines b
                  where b.id = v_baseline and b.development_case_id = c.id
                    and b.organization_id = v_org and b.status = 'approved') then
    return jsonb_build_object('error', format(
      'baseline %s is not an APPROVED baseline of this case. A change modifies a document that is currently in force: a draft baseline changes by being edited, and a superseded one has already been replaced — anchoring a change to either makes the change record meaningless.',
      v_baseline));
  end if;
  if v_ref = '' then
    return jsonb_build_object('error', 'give the change a reference');
  end if;
  if v_class = '' then
    return jsonb_build_object('error', format(
      'name the change class. The vocabulary is this organization''s engineering_approval_rules — the MOC engine — and it decides whose competence must sign: %s',
      coalesce((select string_agg(change_class, ', ' order by change_class)
                  from engineering_approval_rules where organization_id = v_org), 'none configured')));
  end if;
  if length(btrim(coalesce(p_change->>'proposed_change', ''))) < 20 then
    return jsonb_build_object('error', 'state the proposed change (20 characters minimum)');
  end if;
  if length(btrim(coalesce(p_change->>'reason', ''))) < 20 then
    return jsonb_build_object('error', 'state why the change is needed (20 characters minimum)');
  end if;
  if exists (select 1 from project_changes
              where development_case_id = c.id and change_ref = v_ref) then
    return jsonb_build_object('error', format('change %s already exists on this case', v_ref));
  end if;

  begin
    insert into project_changes
      (organization_id, development_case_id, baseline_id, change_ref, change_class,
       proposed_change, reason, requester_id)
    values (v_org, c.id, v_baseline, v_ref, v_class,
       btrim(p_change->>'proposed_change'), btrim(p_change->>'reason'), auth.uid())
    returning id into v_id;
  exception when check_violation or foreign_key_violation then
    return jsonb_build_object('error', sqlerrm);
  end;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_change', coalesce(v_role, 'system'),
    jsonb_build_object('case_id', c.id, 'change_id', v_id, 'change_ref', v_ref),
    null,
    jsonb_build_object('status', 'proposed', 'change_class', v_class,
      'baseline_id', v_baseline, 'requester_id', auth.uid()));

  return jsonb_build_object('change_id', v_id, 'change_ref', v_ref,
    'status', 'proposed', 'change_class', v_class, 'baseline_id', v_baseline);
end
$$;

revoke all on function public.raise_project_change(uuid, jsonb) from public, anon, service_role;
grant execute on function public.raise_project_change(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. WORKFLOW 3, STEPS 2-4: dependencies, impacts, risk reassessment,
--     cost/schedule impact. One act, because a half-written impact vector is
--     what lets a change be routed on a number nobody stated.
--
--     §70 REFUSES ai_admin HERE, not only at the decision. The assessed cost
--     effect is the number sync_change_authority routes on: an AI that could
--     write it could route a $10M change to a $50k approver, which is
--     approving the change by choosing who approves it.
--
--     THE PROPAGATION CHAIN IS BUILT HERE, from the impact vector plus the
--     assessor's named targets. A dimension that moves gets a row whether or
--     not a target is known; an unknown target is reported as unknown.
-- ---------------------------------------------------------------------------
create or replace function public.assess_project_change(
  p_change_id uuid,
  p_impact jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  ch project_changes%rowtype;
  v_cost numeric;
  v_days numeric;
  v_cont numeric;
  v_risk text := btrim(coalesce(p_impact->>'risk_effect', ''));
  v_currency text := upper(btrim(coalesce(p_impact->>'currency', 'CAD')));
  v_added int := 0;
  rec record;
  v_kind text;
  v_target uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'assessing a change writes the cost effect the approval authority is routed on. An AI that could write it could route a $10M change to a $50k approver, which is deciding the change by deciding who decides it. Spec §70: the AI may propose an assessment; a human records it.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'assessing a change requires a planning, engineering or governance role');
  end if;

  select * into ch from project_changes where id = p_change_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'project change not found');
  end if;
  if ch.decided_at is not null then
    return jsonb_build_object('error', format(
      'change %s was already %s; its impact assessment is what the decision was taken on and cannot be rewritten afterwards.',
      ch.change_ref, ch.status));
  end if;
  if ch.status = 'withdrawn' then
    return jsonb_build_object('error', format('change %s has been withdrawn', ch.change_ref));
  end if;

  v_cost := sync_finite_money(p_impact->>'cost_effect');
  if v_cost is null then
    return jsonb_build_object('error',
      'state the cost effect of this change as a finite number. Zero is a legitimate answer and a stated one; absent is not, because the approval authority is routed on this figure and an unstated cost routes to nobody.');
  end if;
  v_days := sync_finite_money(p_impact->>'schedule_effect_days');
  if v_days is null then
    return jsonb_build_object('error',
      'state the schedule effect in days as a finite number (zero if none). "Unknown" is a reason to finish the assessment, not to approve the change.');
  end if;
  v_cont := coalesce(sync_finite_money(p_impact->>'contingency_effect'), 0);
  if v_risk not in ('Low','Medium','High','Critical') then
    return jsonb_build_object('error',
      'state the residual risk effect of this change as Low, Medium, High or Critical. Workflow 3 has a risk-reassessment step and the authority ladder has a risk ceiling; without it a Critical-risk change routes on its cost effect alone.');
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('error', 'state the currency as a three-letter code');
  end if;
  if length(btrim(coalesce(p_impact->>'impact_basis', ''))) < 20 then
    return jsonb_build_object('error',
      'record the basis for this impact assessment (20 characters minimum) — what it was estimated from');
  end if;
  if length(btrim(coalesce(p_impact->>'technical_effect', ''))) < 10 then
    return jsonb_build_object('error',
      'state the technical effect of this change (spec §21 names it as part of the object)');
  end if;

  update project_changes set
    technical_effect = btrim(p_impact->>'technical_effect'),
    cost_effect = v_cost,
    schedule_effect_days = v_days,
    risk_effect = v_risk,
    contingency_effect = v_cont,
    currency = v_currency,
    impact_basis = btrim(p_impact->>'impact_basis'),
    assessed_by = auth.uid(),
    assessed_at = now(),
    status = 'assessed'
  where id = ch.id;

  -- THE PROPAGATION CHAIN. Rebuilt from scratch on re-assessment: a chain left
  -- over from a superseded impact vector would name obligations the current
  -- assessment does not create. Closed rows are preserved by refusing to
  -- rebuild once anything has been closed (below).
  if not exists (select 1 from project_change_propagation
                  where change_id = ch.id and closed_at is not null) then
    delete from project_change_propagation where change_id = ch.id;
  end if;

  -- The four dimensions this slice's own machinery can see move.
  if v_cost <> 0 and not exists (select 1 from project_change_propagation
                                  where change_id = ch.id and target_kind = 'cost') then
    insert into project_change_propagation
      (organization_id, change_id, target_kind, effect, sync_owned)
    values (v_org, ch.id, 'cost', format(
      'The approved cost baseline moves by %s %s. Sync is not the system of record for the estimate: this obligation is closed by whoever re-issues it, with a note.',
      v_cost, v_currency), false);
    v_added := v_added + 1;
  end if;
  if v_days <> 0 and not exists (select 1 from project_change_propagation
                                  where change_id = ch.id and target_kind = 'schedule') then
    insert into project_change_propagation
      (organization_id, change_id, target_kind, effect, sync_owned)
    values (v_org, ch.id, 'schedule', format(
      'The schedule moves by %s day(s). P6 remains the system of record (spec §22/§77), so Sync records the obligation and the re-import that satisfies it, never a schedule it wrote itself.',
      v_days), false);
    v_added := v_added + 1;
  end if;
  if v_cont <> 0 and not exists (select 1 from project_change_propagation
                                  where change_id = ch.id and target_kind = 'contingency') then
    insert into project_change_propagation
      (organization_id, change_id, target_kind, effect, sync_owned)
    values (v_org, ch.id, 'contingency', format(
      'Contingency moves by %s %s. Sync OWNS this hop: it is satisfied by a ledger drawdown attributed to this change (cause approved_change), and by nothing else.',
      v_cont, v_currency), true);
    v_added := v_added + 1;
  end if;
  if v_risk in ('High','Critical') and not exists (select 1 from project_change_propagation
                                                    where change_id = ch.id and target_kind = 'risk') then
    insert into project_change_propagation
      (organization_id, change_id, target_kind, effect, sync_owned)
    values (v_org, ch.id, 'risk', format(
      'Residual risk after this change is %s. Workflow 3''s risk-reassessment step is an obligation on the risk register, closed by whoever re-assesses the affected risk.',
      v_risk), false);
    v_added := v_added + 1;
  end if;

  -- The assessor's own named targets. A scope target is Sync-owned: the
  -- approved-change reference on post-baseline scope attribution is a column
  -- this product writes (20261130090400), and stamping it is what removes that
  -- addition from the "scope changed with no approved change request" signal.
  for rec in select value as t from jsonb_array_elements(coalesce(p_impact->'targets', '[]'::jsonb)) loop
    v_kind := lower(btrim(coalesce(rec.t->>'kind', '')));
    if v_kind not in ('scope','cost','schedule','contingency','requirement','risk',
                      'procurement','commissioning') then
      continue;
    end if;
    v_target := nullif(btrim(coalesce(rec.t->>'id', '')), '')::uuid;
    if v_kind = 'scope' and v_target is not null then
      if not exists (select 1 from project_scope_changes sc
                      where sc.id = v_target and sc.development_case_id = ch.development_case_id) then
        return jsonb_build_object('error', format(
          'scope target %s is not a post-baseline scope attribution on this case', v_target));
      end if;
      insert into project_change_propagation
        (organization_id, change_id, target_kind, target_table, target_id, effect, sync_owned)
      values (v_org, ch.id, 'scope', 'project_scope_changes', v_target,
        coalesce(nullif(btrim(coalesce(rec.t->>'effect', '')), ''),
                 'This change is the approved change request covering that scope addition.'), true);
      v_added := v_added + 1;
    else
      insert into project_change_propagation
        (organization_id, change_id, target_kind, target_table, target_id, effect, sync_owned)
      values (v_org, ch.id, v_kind, null, null,
        coalesce(nullif(btrim(coalesce(rec.t->>'effect', '')), ''),
                 'Named by the assessor as reached by this change.'), false);
      v_added := v_added + 1;
    end if;
  end loop;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_change', v_role,
    jsonb_build_object('case_id', ch.development_case_id, 'change_id', ch.id,
      'change_ref', ch.change_ref),
    jsonb_build_object('status', ch.status, 'cost_effect', ch.cost_effect,
      'schedule_effect_days', ch.schedule_effect_days, 'risk_effect', ch.risk_effect),
    jsonb_build_object('status', 'assessed', 'cost_effect', v_cost,
      'schedule_effect_days', v_days, 'risk_effect', v_risk,
      'contingency_effect', v_cont, 'assessed_by', auth.uid(),
      'propagation_rows', v_added));

  return jsonb_build_object('change_id', ch.id, 'change_ref', ch.change_ref,
    'status', 'assessed', 'cost_effect', v_cost, 'schedule_effect_days', v_days,
    'risk_effect', v_risk, 'contingency_effect', v_cont, 'currency', v_currency,
    'propagation_rows', (select count(*) from project_change_propagation where change_id = ch.id));
end
$$;

revoke all on function public.assess_project_change(uuid, jsonb) from public, anon, service_role;
grant execute on function public.assess_project_change(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. THE MOC COMPETENCE SIGN-OFF. `sign_engineering_review`'s shape
--     (20260809140000:478), re-aimed at the change object. Same rule table,
--     same role check, same 20-character basis.
-- ---------------------------------------------------------------------------
create or replace function public.sign_project_change_engineering(
  p_change_id uuid,
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
  ch project_changes%rowtype;
  e engineering_approval_rules%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'engineering sign-off is a competence attestation about a person''s qualification. Spec §70: an AI identity holds no competence and may not sign.');
  end if;
  select * into ch from project_changes where id = p_change_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'project change not found');
  end if;
  if ch.decided_at is not null then
    return jsonb_build_object('error', 'this change has already been decided');
  end if;
  select * into e from engineering_approval_rules
   where organization_id = v_org and change_class = ch.change_class;
  if not found then
    return jsonb_build_object('error',
      'no engineering rule for change class ' || ch.change_class);
  end if;
  if v_role is distinct from e.required_role and v_role <> 'admin' then
    return jsonb_build_object('error',
      format('%s requires sign-off by the %s role', e.title, e.required_role));
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error',
      'record the engineering basis for this sign-off (20 characters minimum)');
  end if;
  if ch.assessed_at is null then
    return jsonb_build_object('error',
      'sign off after the impact is assessed: the competence question is whether THIS technical effect is coherent, and there is no stated technical effect yet.');
  end if;

  update project_changes
     set competence_signed_by = auth.uid(), competence_signed_at = now(),
         competence_note = btrim(p_note)
   where id = ch.id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_change', v_role,
    jsonb_build_object('case_id', ch.development_case_id, 'change_id', ch.id,
      'change_ref', ch.change_ref, 'change_class', ch.change_class),
    jsonb_build_object('competence_signed_at', ch.competence_signed_at),
    jsonb_build_object('competence_signed_by', auth.uid(),
      'competence_signed_at', now(), 'required_role', e.required_role));

  return jsonb_build_object('change_id', ch.id, 'change_ref', ch.change_ref,
    'signed_by_role', v_role, 'rule', e.title);
end
$$;

revoke all on function public.sign_project_change_engineering(uuid, text) from public, anon, service_role;
grant execute on function public.sign_project_change_engineering(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. WORKFLOW 3, STEPS 5-6: required authority -> decision.
-- ---------------------------------------------------------------------------
create or replace function public.decide_project_change(
  p_change_id uuid,
  p_decision jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  ch project_changes%rowtype;
  v_outcome text := lower(btrim(coalesce(p_decision->>'outcome', '')));
  v_note text := btrim(coalesce(p_decision->>'note', ''));
  v_auth jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70, in the door as well as on the row.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'approving a change modifies an approved baseline and commits the cost effect it carries. Spec §70: no AI or system identity may approve a change. The AI may assemble the impact assessment; a human decides.');
  end if;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_outcome not in ('approved','rejected') then
    return jsonb_build_object('error', 'the outcome is approved or rejected');
  end if;
  if length(v_note) < 20 then
    return jsonb_build_object('error',
      'record the basis for this decision (20 characters minimum)');
  end if;

  select * into ch from project_changes where id = p_change_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'project change not found');
  end if;
  if ch.decided_at is not null then
    return jsonb_build_object('error', format(
      'change %s was already %s on %s', ch.change_ref, ch.status, ch.decided_at));
  end if;
  if ch.status = 'withdrawn' then
    return jsonb_build_object('error', 'this change has been withdrawn');
  end if;
  if ch.assessed_at is null then
    return jsonb_build_object('error',
      'this change has not been assessed. Workflow 3 routes the decision on the impact — a decision taken before the impact is stated is a decision about an unknown quantity.');
  end if;
  -- 4D-R16, second half. The anchor is re-checked AT THE DECISION, because a
  -- baseline can be superseded between raising a change and deciding it. A
  -- change approved against a superseded baseline would stamp its change_ref
  -- onto live post-baseline scope attribution — clearing the "changed with no
  -- approved change request" signal (spec I.7) on the authority of a document
  -- that no longer governs.
  if exists (select 1 from development_baselines b
              where b.id = ch.baseline_id and b.status = 'superseded') then
    return jsonb_build_object('error', format(
      'the baseline change %s is anchored to has been SUPERSEDED since the change was raised. A change modifies something that is currently FIXED; approving it now would move a document that no longer governs and stamp its reference onto attribution measured against a newer one. Raise the change again against the current baseline.',
      ch.change_ref));
  end if;
  -- §42, checked in the door as well as on the row so the refusal is a
  -- sentence rather than a constraint violation.
  if ch.requester_id = auth.uid() then
    return jsonb_build_object('error',
      'segregation of duties (spec §42): you raised this change, so you cannot be its final approver. Route it to somebody else, or escalate.');
  end if;

  -- The MOC engine's competence gate, quoted as a sentence before the trigger
  -- states it as an exception.
  if v_outcome = 'approved' and ch.competence_signed_at is null then
    return jsonb_build_object('error', format(
      'Engineering approval: "%s" requires sign-off by the %s role before this change can be approved (sign_project_change_engineering).',
      (select title from engineering_approval_rules
        where organization_id = v_org and change_class = ch.change_class),
      (select required_role from engineering_approval_rules
        where organization_id = v_org and change_class = ch.change_class)));
  end if;

  -- Authority is checked for an APPROVAL. A rejection commits nothing and
  -- needs no ceiling — but it still needs a role that could have approved,
  -- otherwise "rejected" becomes a way for anybody to close a change.
  v_auth := sync_change_authority(v_org, v_role, ch.cost_effect, ch.risk_effect,
                                  ch.contingency_effect, ch.currency);
  if (v_auth->>'permitted')::boolean is not true then
    return jsonb_build_object('error', v_auth->>'refusal',
      'ceiling', v_auth->'ceiling', 'tierLabel', v_auth->'tierLabel',
      'escalatesTo', v_auth->'escalatesTo');
  end if;

  update project_changes set
    status = v_outcome,
    authority_limit_id = (v_auth->>'limitId')::uuid,
    approver_id = auth.uid(),
    approver_role = v_role,
    approver_ceiling_usd = (v_auth->>'ceiling')::numeric,
    decided_at = now(),
    decision_note = v_note
  where id = ch.id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_change', v_role,
    jsonb_build_object('case_id', ch.development_case_id, 'change_id', ch.id,
      'change_ref', ch.change_ref, 'baseline_id', ch.baseline_id),
    jsonb_build_object('status', ch.status, 'decided_at', null),
    jsonb_build_object('status', v_outcome, 'approver_id', auth.uid(),
      'approver_role', v_role, 'ceiling', (v_auth->>'ceiling')::numeric,
      'tier_label', v_auth->>'tierLabel', 'cost_effect', ch.cost_effect,
      'schedule_effect_days', ch.schedule_effect_days, 'risk_effect', ch.risk_effect));

  return jsonb_build_object('change_id', ch.id, 'change_ref', ch.change_ref,
    'status', v_outcome, 'approved_under', v_auth->'tierLabel',
    'ceiling', v_auth->'ceiling',
    'outstanding_propagation', (select count(*) from project_change_propagation
                                 where change_id = ch.id and status = 'pending'));
end
$$;

revoke all on function public.decide_project_change(uuid, jsonb) from public, anon, service_role;
grant execute on function public.decide_project_change(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. WORKFLOW 3, STEP 7: "propagate approved change".
--
--     Applies ONLY the hops Sync owns, and proves each from the target record:
--       * scope — stamps the approved-change reference on the post-baseline
--         attribution, which is what removes that addition from the "scope
--         changed with no approved change request" signal (spec I.7). Written
--         under 20261130090400's own `app.scope_change_write` marker, so the
--         §70 wall on that column sees a governed act rather than a raw
--         update.
--       * contingency — closes ONLY when a ledger drawdown attributed to this
--         change exists. It cannot make the drawdown: that is authority-gated
--         money and it has its own approver.
--     Everything else stays outstanding until a human closes it with a note.
-- ---------------------------------------------------------------------------
create or replace function public.propagate_project_change(p_change_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  ch project_changes%rowtype;
  rec record;
  v_applied int := 0;
  v_blocked jsonb := '[]'::jsonb;
  v_drawn numeric;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'propagating a change asserts that an approved modification reached the objects it modifies. Spec §70 reserves that assertion to a human.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'propagating a change requires a planning, engineering or governance role');
  end if;
  select * into ch from project_changes where id = p_change_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'project change not found');
  end if;
  if ch.status not in ('approved','implemented') then
    return jsonb_build_object('error', format(
      'change %s is %s. Only an APPROVED change propagates — propagating a proposal would push an undecided modification into the records everything else is measured against.',
      ch.change_ref, ch.status));
  end if;

  for rec in select * from project_change_propagation
              where change_id = ch.id and status = 'pending' and sync_owned
              order by created_at loop
    if rec.target_kind = 'scope' and rec.target_id is not null then
      -- 20261130090400's marker: the approved-change columns are §70-walled
      -- against every writer, and this is the governed path.
      perform set_config('app.scope_change_write', 'granted', true);
      update project_scope_changes
         set approved_change_ref = ch.change_ref,
             approved_change_recorded_by = auth.uid(),
             approved_change_recorded_at = now()
       where id = rec.target_id and development_case_id = ch.development_case_id;
      perform set_config('app.scope_change_write', '', true);
      update project_change_propagation
         set status = 'applied', closed_by = auth.uid(), closed_at = now(),
             close_note = format('Approved change %s stamped onto the post-baseline scope attribution; it no longer counts as growth without an approved change request.', ch.change_ref)
       where id = rec.id;
      v_applied := v_applied + 1;

    elsif rec.target_kind = 'contingency' then
      select coalesce(sum(e.amount), 0) into v_drawn
        from contingency_ledger_entries e
       where e.cause_change_id = ch.id and e.entry_type = 'drawdown';
      if v_drawn > 0 then
        update project_change_propagation
           set status = 'applied', closed_by = auth.uid(), closed_at = now(),
               close_note = format('Contingency drawdown of $%s attributed to this change is recorded in the ledger.', v_drawn)
         where id = rec.id;
        v_applied := v_applied + 1;
      else
        v_blocked := v_blocked || to_jsonb(format(
          'contingency: this change carries a contingency effect of %s, and no ledger drawdown is attributed to it yet. Propagation cannot draw the money — that is an authority-gated act with its own approver (draw_down_contingency, cause approved_change).',
          ch.contingency_effect)::text);
      end if;
    end if;
  end loop;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_change_propagation', v_role,
    jsonb_build_object('case_id', ch.development_case_id, 'change_id', ch.id,
      'change_ref', ch.change_ref),
    null,
    jsonb_build_object('applied', v_applied,
      'outstanding', (select count(*) from project_change_propagation
                       where change_id = ch.id and status = 'pending')));

  return jsonb_build_object('change_id', ch.id, 'change_ref', ch.change_ref,
    'applied', v_applied, 'blocked', v_blocked,
    'outstanding', (select count(*) from project_change_propagation
                     where change_id = ch.id and status = 'pending'),
    'outstandingDetail', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'targetKind', p.target_kind, 'effect', p.effect,
        'syncOwned', p.sync_owned) order by p.created_at)
      from project_change_propagation p
      where p.change_id = ch.id and p.status = 'pending'), '[]'::jsonb));
end
$$;

revoke all on function public.propagate_project_change(uuid) from public, anon, service_role;
grant execute on function public.propagate_project_change(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Closing an obligation Sync does not own. A human states that the change
--     reached the estimate, the schedule or the drawing register, and signs
--     the statement — because the alternative is a system that reports
--     propagation it never observed.
-- ---------------------------------------------------------------------------
create or replace function public.close_change_propagation(
  p_propagation_id uuid,
  p_close jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  pr project_change_propagation%rowtype;
  ch project_changes%rowtype;
  v_outcome text := lower(btrim(coalesce(p_close->>'outcome', '')));
  v_note text := btrim(coalesce(p_close->>'note', ''));
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'closing a propagation obligation asserts that an approved change reached a downstream object. Spec §70 reserves that assertion to a human.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'closing a propagation obligation requires a planning, engineering or governance role');
  end if;
  if v_outcome not in ('applied','not_applicable','blocked') then
    return jsonb_build_object('error',
      'the outcome is applied, not_applicable or blocked');
  end if;
  if length(v_note) < 10 then
    return jsonb_build_object('error',
      'record what happened to this obligation (10 characters minimum) — an obligation closed with no note is indistinguishable from one nobody looked at');
  end if;

  select * into pr from project_change_propagation
   where id = p_propagation_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'propagation obligation not found');
  end if;
  if pr.status <> 'pending' then
    return jsonb_build_object('error', format(
      'this obligation was already closed as %s', pr.status));
  end if;
  select * into ch from project_changes where id = pr.change_id;
  if ch.status not in ('approved','implemented') then
    return jsonb_build_object('error', format(
      'change %s is %s; its propagation obligations cannot be closed before it is approved.',
      ch.change_ref, ch.status));
  end if;
  -- The Sync-owned hops are closed by evidence, not by assertion.
  if pr.sync_owned and v_outcome = 'applied' then
    return jsonb_build_object('error',
      'this hop is one Sync owns: it is closed by the record that proves it (propagate_project_change stamps the scope attribution; a ledger drawdown attributed to this change closes the contingency hop). Asserting it by hand would be the one propagation claim in this file with nothing behind it.');
  end if;

  update project_change_propagation
     set status = v_outcome, closed_by = auth.uid(), closed_at = now(), close_note = v_note
   where id = pr.id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_change_propagation', v_role,
    jsonb_build_object('change_id', ch.id, 'change_ref', ch.change_ref,
      'propagation_id', pr.id, 'target_kind', pr.target_kind),
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', v_outcome, 'closed_by', auth.uid(), 'note', v_note));

  return jsonb_build_object('propagation_id', pr.id, 'status', v_outcome,
    'outstanding', (select count(*) from project_change_propagation
                     where change_id = ch.id and status = 'pending'));
end
$$;

revoke all on function public.close_change_propagation(uuid, jsonb) from public, anon, service_role;
grant execute on function public.close_change_propagation(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. A change is IMPLEMENTED only when nothing it moves is still outstanding.
--     This is the one place the chain does work rather than describing it: a
--     change cannot be marked done while an obligation it created is open.
-- ---------------------------------------------------------------------------
create or replace function public.implement_project_change(p_change_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  ch project_changes%rowtype;
  v_open int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'declaring a change implemented asserts that every object it modifies now carries it. Spec §70 reserves that assertion to a human.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'declaring a change implemented requires a planning, engineering or governance role');
  end if;
  select * into ch from project_changes where id = p_change_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'project change not found');
  end if;
  if ch.status <> 'approved' then
    return jsonb_build_object('error', format(
      'change %s is %s; only an approved change can be implemented.', ch.change_ref, ch.status));
  end if;
  select count(*) into v_open from project_change_propagation
   where change_id = ch.id and status = 'pending';
  if v_open > 0 then
    return jsonb_build_object('error', format(
      'change %s still has %s propagation obligation(s) outstanding. A change marked implemented while something it moves has not moved is the claim this chain exists to prevent.',
      ch.change_ref, v_open),
      'outstanding', coalesce((select jsonb_agg(jsonb_build_object(
          'targetKind', p.target_kind, 'effect', p.effect, 'syncOwned', p.sync_owned)
        order by p.created_at)
        from project_change_propagation p
        where p.change_id = ch.id and p.status = 'pending'), '[]'::jsonb));
  end if;

  update project_changes
     set status = 'implemented', implemented_by = auth.uid(), implemented_at = now()
   where id = ch.id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_change', v_role,
    jsonb_build_object('case_id', ch.development_case_id, 'change_id', ch.id,
      'change_ref', ch.change_ref),
    jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'implemented', 'implemented_by', auth.uid()));

  return jsonb_build_object('change_id', ch.id, 'change_ref', ch.change_ref,
    'status', 'implemented');
end
$$;

revoke all on function public.implement_project_change(uuid) from public, anon, service_role;
grant execute on function public.implement_project_change(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 15. THE CONTINGENCY DOOR gains its second linked cause.
--
--     Re-created from its 20261203090000 definition with ONE marked change:
--     the `approved_change` branch, which was refused there because the store
--     it cites did not yet exist. Everything else is byte-identical, and the
--     ACL is restated because a file that re-created the body and stayed
--     silent about the grants would leave the closed posture resting on a
--     migration nobody reads any more.
-- ---------------------------------------------------------------------------
create or replace function public.draw_down_contingency(
  p_pool_id uuid,
  p_draw jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p project_contingency_pools%rowtype;
  v_amount numeric;
  v_cause text := lower(btrim(coalesce(p_draw->>'cause_class', '')));
  v_justification text := btrim(coalesce(p_draw->>'justification', ''));
  v_risk uuid;
  v_change uuid;
  ch project_changes%rowtype;
  v_remaining numeric;
  v_drawn_for_change numeric := 0;
  v_auth jsonb;
  v_entry uuid;
  v_no int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'drawing down contingency spends owner capital. Spec §70: no AI or system identity may commit funds, approve a change or close a decision. The AI may prepare the case for a drawdown — the cause, the amount, the evidence — and a human approves it.');
  end if;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  -- 4D-R12/R13, as in 20261203090000: the role floor and the row lock.
  if v_role not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', format(
      'drawing down contingency requires a planning, engineering or governance role; %s is not one. A delegation ladder adopted against a role that cannot even report what the fund has spent is a delegation to nobody in particular.',
      v_role));
  end if;

  select * into p from project_contingency_pools
   where id = p_pool_id and organization_id = v_org
   for update;
  if not found then
    return jsonb_build_object('error', 'contingency pool not found');
  end if;
  if p.status <> 'open' then
    return jsonb_build_object('error', format(
      'contingency pool %s is closed; a closed fund cannot be drawn on.', p.pool_ref));
  end if;

  v_amount := sync_finite_money(p_draw->>'amount');
  if v_amount is null then
    return jsonb_build_object('error', format(
      'the drawdown amount is %s; it must be a finite number. NaN and infinity are legal numeric values in Postgres and would pass every ceiling and balance test vacuously, so they are refused before either is applied.',
      coalesce(nullif(btrim(coalesce(p_draw->>'amount', '')), ''), 'absent')));
  end if;
  if v_amount <= 0 then
    return jsonb_build_object('error', format(
      'the drawdown amount is %s; a drawdown must be greater than zero. Returning money to the fund is a RELEASE against the drawdown it reverses (release_contingency), not a negative drawdown — a negative drawdown would be an unaudited credit.',
      v_amount));
  end if;

  if length(v_justification) < 20 then
    return jsonb_build_object('error',
      'record why this money is being drawn (20 characters minimum). Spec II.8''s whole point is that contingency consumption is explicable line by line.');
  end if;

  if v_cause = '' then
    return jsonb_build_object('error',
      'name the cause of this drawdown. Spec II.8 reports consumption BY CAUSE ("$7M scope maturation, $4M market escalation, $3M construction productivity, $4M realized risk"), and a drawdown with no cause makes that report a guess. Classes: realized_risk, approved_change, scope_maturation, market_escalation, productivity, estimate_error.');
  end if;
  if v_cause = 'unattributed' then
    return jsonb_build_object('error',
      'a drawdown cannot be recorded as unattributed. The report carries an "unattributed" bucket so that a spend which somehow arrives without a cause is SHOWN rather than dropped from the total — it is not a class you may choose. Name the cause, or do not spend the money yet.');
  end if;
  if v_cause not in ('realized_risk','approved_change','scope_maturation',
                     'market_escalation','productivity','estimate_error') then
    return jsonb_build_object('error', format(
      '"%s" is not a contingency cause class. The vocabulary is the spec''s own: realized_risk, approved_change, scope_maturation, market_escalation, productivity, estimate_error.',
      v_cause));
  end if;
  if v_cause = 'realized_risk' then
    v_risk := sync_safe_uuid(p_draw->>'risk_id');
    if v_risk is null then
      return jsonb_build_object('error',
        'a realized-risk drawdown must cite the risk that was realized. Spec II.8 names "risk event" as part of the record, and the risk register is where risks live — a drawdown that says "a risk happened" without saying which is unattributed with a label on it.');
    end if;
    if not exists (select 1 from risks r where r.id = v_risk and r.organization_id = v_org) then
      return jsonb_build_object('error',
        'the cited risk is not in this organization''s risk register');
    end if;
  end if;
  -- ── THE MARKED CHANGE (20261203090100) ────────────────────────────────
  -- An approved-change drawdown cites the change it funds, and the change
  -- must be APPROVED: a drawdown against a proposal spends money on a
  -- decision nobody has taken. §42 rides along — the person who RAISED the
  -- change cannot be the one who draws the money for it, or the requester
  -- funds their own request.
  if v_cause = 'approved_change' then
    v_change := sync_safe_uuid(p_draw->>'change_id');
    if v_change is null then
      return jsonb_build_object('error',
        'an approved-change drawdown must cite the change it funds. Spec II.8 records the event behind each drawdown, and "a change happened" without saying which is unattributed with a label on it.');
    end if;
    select * into ch from project_changes
     where id = v_change and organization_id = v_org
       and development_case_id = p.development_case_id;
    if not found then
      return jsonb_build_object('error',
        'the cited change is not a change on this case');
    end if;
    if ch.status not in ('approved','implemented') then
      return jsonb_build_object('error', format(
        'change %s is %s. Contingency funds an APPROVED change; drawing against a proposal spends money on a decision nobody has taken.',
        ch.change_ref, ch.status));
    end if;
    if ch.requester_id = auth.uid() then
      return jsonb_build_object('error', format(
        'segregation of duties (spec §42): you raised change %s, so you cannot also approve the contingency drawdown that funds it.',
        ch.change_ref));
    end if;
    -- 4D-R19. THE DRAW CANNOT EXCEED WHAT THE CHANGE WAS APPROVED TO COMMIT.
    --
    -- REVIEW REPAIR. The approved-change branch never compared the amount to
    -- `ch.contingency_effect`, so a change assessed at $100k could fund a $700k
    -- drawdown while propagate_project_change closed the contingency obligation
    -- on `v_drawn > 0` alone. The assessed contingency effect is the figure the
    -- approver's ceiling was checked against (4D-R15); drawing past it spends
    -- money under an authority nobody granted.
    if coalesce(ch.contingency_effect, 0) <= 0 then
      return jsonb_build_object('error', format(
        'change %s was assessed with no contingency effect, so there is no approved contingency commitment to draw against. Re-assess the change with the contingency it requires — the assessed figure is what the approver''s ceiling was checked against.',
        ch.change_ref));
    end if;
    if upper(btrim(coalesce(ch.currency, p.currency))) is distinct from p.currency then
      return jsonb_build_object('error', format(
        'change %s is assessed in %s and fund %s is held in %s. Sync holds no exchange rate, so a draw against this change cannot be checked against the contingency it was approved to commit.',
        ch.change_ref, ch.currency, p.pool_ref, p.currency));
    end if;
    select coalesce(sum(e.amount) filter (where e.entry_type = 'drawdown'), 0)
         - coalesce(sum(e.amount) filter (where e.entry_type = 'release'), 0)
      into v_drawn_for_change
    from contingency_ledger_entries e
    where e.cause_change_id = ch.id;
    if v_drawn_for_change + v_amount > ch.contingency_effect then
      return jsonb_build_object('error', format(
        'change %s was approved committing $%s of contingency and $%s has already been drawn against it, so a further $%s would exceed the approved commitment by $%s. The assessed contingency effect is the figure the approver''s ceiling was checked against; drawing past it spends money under an authority nobody granted. Re-assess and re-approve the change for the larger amount.',
        ch.change_ref, ch.contingency_effect, v_drawn_for_change, v_amount,
        v_drawn_for_change + v_amount - ch.contingency_effect));
    end if;
  end if;

  v_remaining := sync_contingency_remaining(p.id);
  if v_amount > v_remaining then
    return jsonb_build_object('error', format(
      'this drawdown of $%s exceeds what remains in %s: $%s of the original $%s. A contingency fund cannot go negative — the overspend is a cost overrun and belongs in the forecast, not in a fund that no longer holds the money.',
      v_amount, p.pool_ref, v_remaining, p.original_amount));
  end if;

  v_auth := sync_contingency_authority(v_org, v_role, v_amount, p.currency, p.id, auth.uid());
  if (v_auth->>'permitted')::boolean is not true then
    return jsonb_build_object('error', v_auth->>'refusal',
      'ceiling', v_auth->'ceiling', 'tierLabel', v_auth->'tierLabel',
      'alreadyCommitted', v_auth->'alreadyCommitted',
      'escalatesTo', v_auth->'escalatesTo');
  end if;

  select coalesce(max(entry_no), 0) + 1 into v_no
    from contingency_ledger_entries where pool_id = p.id;

  insert into contingency_ledger_entries
    (organization_id, development_case_id, pool_id, entry_no, entry_type, amount,
     cause_class, cause_risk_id, cause_change_id, cause_note, justification,
     authority_limit_id, approver_id, approver_role, approver_ceiling_usd,
     balance_after, recorded_by)
  values (v_org, p.development_case_id, p.id, v_no, 'drawdown', v_amount,
     v_cause, v_risk, v_change, nullif(btrim(coalesce(p_draw->>'cause_note', '')), ''),
     v_justification,
     (v_auth->>'limitId')::uuid, auth.uid(), v_role, (v_auth->>'ceiling')::numeric,
     v_remaining - v_amount, auth.uid())
  returning id into v_entry;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'contingency_drawdown', v_role,
    jsonb_build_object('case_id', p.development_case_id, 'pool_id', p.id,
      'entry_id', v_entry, 'cause_class', v_cause, 'risk_id', v_risk,
      'change_id', v_change),
    jsonb_build_object('remaining', v_remaining),
    jsonb_build_object('amount', v_amount, 'remaining', v_remaining - v_amount,
      'cause_class', v_cause, 'approver_id', auth.uid(), 'approver_role', v_role,
      'ceiling', (v_auth->>'ceiling')::numeric, 'tier_label', v_auth->>'tierLabel'));

  return jsonb_build_object('entry_id', v_entry, 'entry_no', v_no,
    'amount', v_amount, 'cause_class', v_cause, 'change_id', v_change,
    'remaining', v_remaining - v_amount, 'currency', p.currency,
    'approved_under', v_auth->'tierLabel', 'ceiling', v_auth->'ceiling');
end
$$;

revoke all on function public.draw_down_contingency(uuid, jsonb) from public, anon, service_role;
grant execute on function public.draw_down_contingency(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 15b. THE RELEASE, RE-ISSUED (4D-R20).
--
--     REVIEW REPAIR. `release_contingency` copies the drawdown's cause_class
--     into the reversing entry but was written in 20261203090000, BEFORE this
--     file added `cause_change_id` and the constraint
--     `contingency_entry_linked_change` (cause_class 'approved_change' requires
--     a change subject). The result: a drawdown made against an approved change
--     could NEVER be released — the only reversal path in the whole feature
--     raised a raw 23514 with the full failing row (every id, the amount, the
--     approver) instead of a refusal sentence. The file's own R6 says "a spend
--     made in error is REVERSED by a release entry"; for one of the six cause
--     classes that sentence was false. `draw_down_contingency` was re-issued
--     here to set the column; its reversal is re-issued beside it for the same
--     reason.
-- ---------------------------------------------------------------------------
create or replace function public.release_contingency(
  p_entry_id uuid,
  p_release jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  d contingency_ledger_entries%rowtype;
  p project_contingency_pools%rowtype;
  v_amount numeric;
  v_released numeric;
  v_auth jsonb;
  v_remaining numeric;
  v_entry uuid;
  v_no int;
  v_justification text := btrim(coalesce(p_release->>'justification', ''));
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'releasing contingency changes what remains available to spend. Spec §70: no AI or system identity may commit or uncommit owner funds.');
  end if;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  -- 4D-R12, the same floor as the drawdown: a release changes what everybody
  -- else may still spend from the fund.
  if v_role not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', format(
      'releasing contingency requires a planning, engineering or governance role; %s is not one.',
      v_role));
  end if;

  select * into d from contingency_ledger_entries
   where id = p_entry_id and organization_id = v_org and entry_type = 'drawdown';
  if not found then
    return jsonb_build_object('error', 'contingency drawdown not found');
  end if;
  select * into p from project_contingency_pools where id = d.pool_id for update;
  if p.status <> 'open' then
    return jsonb_build_object('error', format(
      'contingency pool %s is closed.', p.pool_ref));
  end if;

  v_amount := sync_finite_money(p_release->>'amount');
  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('error', format(
      'the release amount is %s; it must be a finite amount greater than zero.',
      coalesce(nullif(btrim(coalesce(p_release->>'amount', '')), ''), 'absent')));
  end if;
  if length(v_justification) < 20 then
    return jsonb_build_object('error',
      'record why this money is being returned to the fund (20 characters minimum)');
  end if;

  select coalesce(sum(amount), 0) into v_released from contingency_ledger_entries
   where reverses_entry_id = d.id and entry_type = 'release';
  if v_amount > d.amount - v_released then
    return jsonb_build_object('error', format(
      'this release of $%s exceeds the un-released part of drawdown #%s: $%s of $%s has already been returned. Releasing more than was taken would credit the fund with money it never held.',
      v_amount, d.entry_no, v_released, d.amount));
  end if;

  -- A release RETURNS money, so it is checked against the ladder and its
  -- currency but NOT against the cumulative commitment: giving headroom back
  -- cannot itself require headroom.
  v_auth := sync_contingency_authority(v_org, v_role, v_amount, p.currency);
  if (v_auth->>'permitted')::boolean is not true then
    return jsonb_build_object('error', v_auth->>'refusal',
      'ceiling', v_auth->'ceiling', 'tierLabel', v_auth->'tierLabel');
  end if;

  v_remaining := sync_contingency_remaining(p.id);
  select coalesce(max(entry_no), 0) + 1 into v_no
    from contingency_ledger_entries where pool_id = p.id;

  insert into contingency_ledger_entries
    (organization_id, development_case_id, pool_id, entry_no, entry_type, amount,
     cause_class, cause_risk_id, cause_change_id, justification, authority_limit_id,
     approver_id, approver_role, approver_ceiling_usd, balance_after,
     reverses_entry_id, recorded_by)
  values (v_org, p.development_case_id, p.id, v_no, 'release', v_amount,
     d.cause_class, d.cause_risk_id, d.cause_change_id, v_justification,
     (v_auth->>'limitId')::uuid,
     auth.uid(), v_role, (v_auth->>'ceiling')::numeric, v_remaining + v_amount,
     d.id, auth.uid())
  returning id into v_entry;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'contingency_release', v_role,
    jsonb_build_object('case_id', p.development_case_id, 'pool_id', p.id,
      'entry_id', v_entry, 'reverses_entry_id', d.id),
    jsonb_build_object('remaining', v_remaining, 'drawdown_amount', d.amount,
      'already_released', v_released),
    jsonb_build_object('amount', v_amount, 'remaining', v_remaining + v_amount,
      'approver_id', auth.uid(), 'approver_role', v_role));

  return jsonb_build_object('entry_id', v_entry, 'entry_no', v_no,
    'amount', v_amount, 'reverses_entry_no', d.entry_no,
    'remaining', v_remaining + v_amount, 'currency', p.currency);
end
$$;

revoke all on function public.release_contingency(uuid, jsonb) from public, anon, service_role;
grant execute on function public.release_contingency(uuid, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 16. THE READ (D5.27 + D5.30).
-- ---------------------------------------------------------------------------
create or replace function public.get_case_change_control(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_changes jsonb := '[]'::jsonb;
  v_role text;
  v_authority jsonb;
  v_classes jsonb;
  v_refusal text;
  v_unapproved int;
  v_approved int;
  v_open_obligations int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', ch.id, 'changeRef', ch.change_ref, 'changeClass', ch.change_class,
      'classTitle', e.title, 'requiredSignerRole', e.required_role,
      'baselineId', ch.baseline_id, 'baselineType', b.baseline_type,
      'baselineVersion', b.version, 'baselineStatus', b.status,
      'proposedChange', ch.proposed_change, 'reason', ch.reason,
      'requester', (select email from user_profiles up where up.id = ch.requester_id),
      'status', ch.status,
      'impact', case when ch.assessed_at is null then null else jsonb_build_object(
        'technicalEffect', ch.technical_effect,
        'costEffect', ch.cost_effect,
        'scheduleEffectDays', ch.schedule_effect_days,
        'riskEffect', ch.risk_effect,
        'contingencyEffect', ch.contingency_effect,
        'currency', ch.currency,
        'basis', ch.impact_basis,
        'assessedBy', (select email from user_profiles up where up.id = ch.assessed_by),
        'assessedAt', ch.assessed_at) end,
      -- A change with no assessment says so. A null impact block rendered as
      -- blanks would read as "no impact", which is the opposite claim.
      'impactRefusal', case when ch.assessed_at is null then
        'This change has not been assessed. Its cost, schedule and risk effects are UNKNOWN, which is a different fact from zero — and it cannot be decided, because the approval authority is routed on the cost effect.' end,
      'competenceSignedAt', ch.competence_signed_at,
      'competenceSignedBy', (select email from user_profiles up where up.id = ch.competence_signed_by),
      'competenceNote', ch.competence_note,
      'competenceRefusal', case when ch.competence_signed_at is null then
        format('"%s" requires competence sign-off by the %s role before it can be approved (the MOC engine, engineering_approval_rules).', e.title, e.required_role) end,
      'approver', (select email from user_profiles up where up.id = ch.approver_id),
      'approverRole', ch.approver_role,
      'approverCeiling', ch.approver_ceiling_usd,
      'tierLabel', al.tier_label,
      'decidedAt', ch.decided_at, 'decisionNote', ch.decision_note,
      'implementedAt', ch.implemented_at,
      'createdAt', ch.created_at,
      'propagation', coalesce((select jsonb_agg(jsonb_build_object(
          'id', pp.id, 'targetKind', pp.target_kind, 'targetTable', pp.target_table,
          'targetId', pp.target_id, 'effect', pp.effect, 'status', pp.status,
          'syncOwned', pp.sync_owned, 'closeNote', pp.close_note,
          'closedBy', (select email from user_profiles up where up.id = pp.closed_by),
          'closedAt', pp.closed_at) order by pp.created_at)
        from project_change_propagation pp where pp.change_id = ch.id), '[]'::jsonb),
      'propagationOutstanding', (select count(*) from project_change_propagation pp
                                  where pp.change_id = ch.id and pp.status = 'pending'),
      'contingencyDrawn', coalesce((select sum(le.amount) from contingency_ledger_entries le
                                     where le.cause_change_id = ch.id
                                       and le.entry_type = 'drawdown'), 0))
      order by ch.created_at desc), '[]'::jsonb)
    into v_changes
  from project_changes ch
  join development_baselines b on b.id = ch.baseline_id
  left join engineering_approval_rules e
    on e.organization_id = ch.organization_id and e.change_class = ch.change_class
  left join authority_limits al on al.id = ch.authority_limit_id
  where ch.development_case_id = c.id;

  select count(*) filter (where value->>'status' in ('proposed','assessed')),
         count(*) filter (where value->>'status' in ('approved','implemented'))
    into v_unapproved, v_approved
  from jsonb_array_elements(v_changes);

  select coalesce(sum((value->>'propagationOutstanding')::int), 0) into v_open_obligations
  from jsonb_array_elements(v_changes);

  if jsonb_array_length(v_changes) = 0 then
    v_refusal :=
      'No change has been raised against a baseline on this case. That is a fact about the change register, not a statement that the project has not changed: post-baseline scope growth with no approved change request (get_case_scope_growth) is the signal for the second question, and it is reported there.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'changeClass', e.change_class, 'title', e.title,
      'requiredRole', e.required_role, 'basis', e.basis) order by e.change_class), '[]'::jsonb)
    into v_classes
  from engineering_approval_rules e where e.organization_id = v_org;

  v_authority := case when v_role is null then null
                 else sync_change_authority(v_org, v_role, 0, null) end;

  return jsonb_build_object(
    'caseId', c.id,
    'changes', v_changes,
    'changeCount', jsonb_array_length(v_changes),
    'undecidedCount', v_unapproved,
    'approvedCount', v_approved,
    'outstandingObligations', v_open_obligations,
    'classes', v_classes,
    'authority', v_authority,
    'callerRole', v_role,
    'refusal', v_refusal,
    'notInThisSlice', jsonb_build_array(
      'The §21 propagation chain names Requirements, Drawings, Procurement and Commissioning as downstream objects. Sync owns the scope-attribution and contingency hops and applies them; the rest are carried as NAMED OBLIGATIONS a human closes, because Sync is not the system of record for P6, the estimate or the drawing register and a hop it marked applied there would be a claim with nothing behind it.'));
end
$$;

revoke all on function public.get_case_change_control(uuid) from public, anon, service_role;
grant execute on function public.get_case_change_control(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 17. THE CALCULATION (D5.30 + D11.29): the aggregate change position, with
--     lineage. REFUSAL-FIRST: an empty change register REFUSES rather than
--     reporting "$0 of approved change", which a reader would take as a
--     project that has not changed.
-- ---------------------------------------------------------------------------
create or replace function public.compute_case_change_control(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_read jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_outputs jsonb;
  v_run uuid;
  v_approved_cost numeric;
  v_approved_days numeric;
  v_unassessed int;
  v_unsigned int;
  v_open int;
  v_currencies text[];
  v_currency text;
  v_mixed boolean := false;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'recording the aggregate change position states how much approved change a project is carrying and how much of it has reached the objects it moves. Spec §70 forbids an AI or system identity from making that determination. The AI may read get_case_change_control, which records nothing.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'reporting the change position requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_read := get_case_change_control(c.id);
  if v_read ? 'error' then return v_read; end if;

  if v_read->>'refusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_read->>'refusal');
  end if;

  select coalesce(sum((value->'impact'->>'costEffect')::numeric)
                    filter (where value->>'status' in ('approved','implemented')), 0),
         coalesce(sum((value->'impact'->>'scheduleEffectDays')::numeric)
                    filter (where value->>'status' in ('approved','implemented')), 0),
         count(*) filter (where value->>'impactRefusal' is not null),
         count(*) filter (where value->>'competenceSignedAt' is null
                            and value->>'status' not in ('rejected','withdrawn')),
         coalesce(sum((value->>'propagationOutstanding')::int)
                    filter (where value->>'status' in ('approved','implemented')), 0)
    into v_approved_cost, v_approved_days, v_unassessed, v_unsigned, v_open
  from jsonb_array_elements(v_read->'changes');

  -- 4D-R14, restated for change control. `approvedCostEffect` summed
  -- `cost_effect` across changes that each carry their OWN currency, and the
  -- recorded output object carried no currency key at all — so a CAD 100,000
  -- change beside a USD 100,000 one recorded "approvedCostEffect: 200000" in a
  -- unit that does not exist. The days total is currency-free and survives; the
  -- money totals are WITHHELD and named.
  select array_agg(distinct value->'impact'->>'currency' order by value->'impact'->>'currency')
    into v_currencies
  from jsonb_array_elements(v_read->'changes')
  where value->'impact'->>'currency' is not null
    and value->>'status' in ('approved','implemented');
  v_currency := case when coalesce(array_length(v_currencies, 1), 0) = 1
                     then v_currencies[1] end;
  v_mixed := coalesce(array_length(v_currencies, 1), 0) > 1;
  if v_mixed then
    v_refusals := v_refusals || to_jsonb(format(
      'The approved changes on this case are assessed in %s different currencies (%s), so there is no approved cost effect to publish: adding %s produces a number in no currency at all. Each change''s own cost effect and currency are exact and are shown per change; the totals in money are withheld rather than summed under one arbitrary label. The schedule effect in days is currency-free and is published.',
      array_length(v_currencies, 1), array_to_string(v_currencies, ', '),
      array_to_string(v_currencies, ' to '))::text);
  end if;

  if v_unassessed > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      '%s change(s) carry NO impact assessment, so their cost and schedule effects are unknown and are excluded from the totals below rather than counted as zero. An unassessed change cannot be decided either — the approval authority is routed on the cost effect.',
      v_unassessed)::text);
  end if;
  if v_unsigned > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      '%s live change(s) have no engineering competence sign-off. Under the MOC engine (engineering_approval_rules) none of them can be approved, whatever their cost effect.',
      v_unsigned)::text);
  end if;
  if v_open > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      '%s propagation obligation(s) on APPROVED changes are still outstanding. The approved cost and schedule effects below are therefore what was DECIDED, not what has reached the estimate and the schedule — the two are different numbers and this report will not merge them.',
      v_open)::text);
  end if;

  if (v_read->>'changeCount')::int = 0 then
    v_outputs := null;
  else
    v_outputs := jsonb_build_object(
      'changeCount', v_read->'changeCount',
      'approvedCount', v_read->'approvedCount',
      'undecidedCount', v_read->'undecidedCount',
      'approvedCostEffect', case when v_mixed then null else v_approved_cost end,
      'approvedScheduleEffectDays', v_approved_days,
      'currency', v_currency,
      'unassessedCount', v_unassessed,
      'unsignedCount', v_unsigned,
      'outstandingObligations', v_open,
      'propagationComplete', v_open = 0,
      'contingencyDrawnAgainstChange', case when v_mixed then null else coalesce((
        select sum(le.amount) from contingency_ledger_entries le
        join project_changes pc on pc.id = le.cause_change_id
        where pc.development_case_id = c.id and le.entry_type = 'drawdown'), 0) end);
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_change_control',
    'The aggregate change position of this case (spec §21/§37, Workflow 3): how much approved change it is carrying in money and days, how much of that change has actually reached the objects it modifies, and what is blocking the rest. Changes with no impact assessment are EXCLUDED from the totals and named, never counted as zero effect; changes with no engineering competence sign-off are named as unapprovable under the MOC engine; and an approved change with outstanding propagation is reported as decided-but-not-propagated rather than merged into one figure. An empty change register refuses rather than reporting "$0 of approved change".',
    jsonb_build_object(
      'changeCount', v_read->'changeCount',
      'approvedCount', v_read->'approvedCount',
      -- Counts cannot see a REVISED impact vector or a closed obligation.
      'changeDigest', coalesce((
        select md5(string_agg(ch.id::text || '~' || ch.status
                              || '~' || coalesce(ch.cost_effect::text, '-')
                              || '~' || coalesce(ch.schedule_effect_days::text, '-')
                              || '~' || coalesce(ch.risk_effect, '-')
                              || '~' || coalesce(ch.competence_signed_at::text, '-'),
                              '|' order by ch.created_at, ch.id))
          from project_changes ch where ch.development_case_id = c.id), 'empty'),
      'propagationDigest', coalesce((
        select md5(string_agg(pp.id::text || '~' || pp.status, '|' order by pp.created_at, pp.id))
          from project_change_propagation pp
          join project_changes ch on ch.id = pp.change_id
         where ch.development_case_id = c.id), 'empty')),
    coalesce((select jsonb_agg(jsonb_build_object('table', 'project_changes', 'id', ch.id))
                from project_changes ch where ch.development_case_id = c.id), '[]'::jsonb),
    v_outputs,
    v_refusals);

  return v_read || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_change_control'));
end
$$;

revoke all on function public.compute_case_change_control(uuid) from public, anon, service_role;
grant execute on function public.compute_case_change_control(uuid) to authenticated;
