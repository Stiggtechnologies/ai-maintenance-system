-- ============================================================================
-- Sync Develop Slice 3B — waivers against gate requirements (D3.19) and
-- expiry enforcement with no silent permanence (D3.20). Spec II.16.
--
-- OVERLAP-MAP RULING 15 IS BINDING: standard_site_variances IS the one
-- waiver model. This file GENERALIZES ITS SUBJECT (the Slice-1
-- stage_gate_reviews precedent: drop the narrowing NOT NULLs, add the new
-- subject columns, replace the invariant with a per-subject shape check
-- that keeps the old contract for old rows) — it does not build a third
-- waiver store beside standard_site_variances and design_requirements.
--
-- SPEC RULINGS THIS FILE TAKES (II.16 names the fields, not the mechanics):
--
--   * SUBJECT = A GATE REQUIREMENT OF THE CASE'S OWN FRAMEWORK: a
--     gate-scoped stage_gate_criteria row whose gate belongs to the case's
--     framework. Stage-scoped criteria (gate_id null) are the legacy
--     asset-lifecycle family and are not waivable here.
--   * RISK-ASSESSMENT LINK IS MANDATORY for gate-requirement waivers: II.16
--     lists "risk assessment" beside justification/approver/expiry, and a
--     waiver whose risk was never assessed is a gap wearing a signature.
--     The link lands on the ONE risks table (ruling: no parallel risk
--     store) and is load-bearing at BOTH doors: the shape check requires it
--     on every gate_requirement row (not just the request RPC), the FK is
--     ON DELETE RESTRICT (a risk anchoring a waiver is not silently
--     removable), and the decision fails CLOSED when the linked risk is
--     missing or carries no rated level — a ceiling that cannot be
--     verified is a refusal, never a skipped clause.
--   * APPROVER ROUTED THROUGH authority_limits (ruling 14 — the ONE
--     authority store): action_type gains 'gate_requirement_waiver', and
--     decide_gate_requirement_waiver is FAIL-CLOSED like sanction — no
--     ADOPTED delegation for the caller's role, no decision, administrators
--     included. Draft rows are seeded so the delegation EXISTS to be
--     adopted; drafts grant nothing.
--   * §70: THE AI-OPERATOR IDENTITY CANNOT APPROVE A WAIVER. Approving a
--     waiver suspends an enforcement rule, which is exactly the class of
--     determination §70 reserves to humans. ai_admin is refused BY NAME at
--     the decide RPC. (The legacy decide_standard_variance predates this
--     slice and is re-created below with the same refusal — narrowing an
--     approver set is the permitted direction.)
--   * EXPIRY IS NOT NULL — D3.20's documented hole closed. The column was
--     nullable (20260809140000:151) while only the request RPC refused
--     null, so a direct insert could mint a permanent exception. Backfill
--     first (requested_at + 2 years — the outer bound the governed path
--     could ever have granted, recorded here as the backfill basis), then
--     the column constraint every path obeys. The legit service paths
--     (restore, this backfill) write real timestamps and are not broken.
--   * ONE ACTIVE WAIVER PER (case, requirement): a partial unique index —
--     stacked approvals would make "which waiver covers this?" a judgement
--     call, and enforcement reads data, not judgement.
--   * WHAT AN ACTIVE WAIVER DOES — and stops doing — lives in the shared
--     predicate family (case_binding_gate_demands + record_case_gate_review,
--     re-created in 20261121090400): an APPROVED, UNEXPIRED waiver stands in
--     for the waived requirement at the act sites; the hourly sweep flips it
--     to 'expired' and every act site reverts to enforcement on the next
--     act. Auto-reversion is therefore structural — nothing re-arms by hand.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Subject generalization (the sgr_subject_present precedent).
-- ---------------------------------------------------------------------------
alter table public.standard_site_variances
  alter column standard_id drop not null,
  alter column site_id drop not null;

alter table public.standard_site_variances
  add column if not exists subject_type text not null default 'standard',
  add column if not exists requirement_id bigint references stage_gate_criteria(id) on delete cascade,
  add column if not exists development_case_id uuid references development_cases(id) on delete cascade,
  -- ON DELETE RESTRICT, deliberately: the risk assessment is a MANDATORY
  -- field of the waiver (header ruling), so a risk that anchors one cannot
  -- vanish and quietly take the decision-time ceiling check with it.
  add column if not exists risk_id uuid references risks(id) on delete restrict;

alter table public.standard_site_variances
  drop constraint if exists ssv_subject_type_allowed,
  drop constraint if exists ssv_subject_shape;
alter table public.standard_site_variances
  add constraint ssv_subject_type_allowed
    check (subject_type in ('standard','gate_requirement'));
-- The old contract holds for old rows; the new subject states its own.
alter table public.standard_site_variances
  add constraint ssv_subject_shape check (
    (subject_type = 'standard'
      and standard_id is not null and site_id is not null
      and requirement_id is null and development_case_id is null)
    or
    (subject_type = 'gate_requirement'
      and requirement_id is not null and development_case_id is not null
      and risk_id is not null
      and standard_id is null and site_id is null)
  );

-- ---------------------------------------------------------------------------
-- 2. D3.20: expiry becomes NOT NULL. Backfill basis in the header ruling.
-- ---------------------------------------------------------------------------
update public.standard_site_variances
set expires_at = requested_at + interval '2 years'
where expires_at is null;

alter table public.standard_site_variances
  alter column expires_at set not null;

-- One ACTIVE waiver per gate requirement per case.
create unique index if not exists idx_ssv_one_active_requirement_waiver
  on standard_site_variances(development_case_id, requirement_id)
  where subject_type = 'gate_requirement' and status = 'approved';

create index if not exists idx_ssv_case_requirement
  on standard_site_variances(organization_id, development_case_id, requirement_id, status)
  where subject_type = 'gate_requirement';

-- ---------------------------------------------------------------------------
-- 3. The ONE authority store gains the waiver delegation (ruling 14; the
--    20261101090500 action_type precedent, extended not twinned).
-- ---------------------------------------------------------------------------
alter table public.authority_limits
  drop constraint if exists authority_limits_action_type_check;
alter table public.authority_limits
  add constraint authority_limits_action_type_check
    check (action_type in ('general','sanction','regulatory_variance','gate_requirement_waiver'));

-- D3.32 (spec §41): org-node scope on the ONE store, landed HERE so every
-- act site that selects an adopted ladder (waiver decide below, accept_risk
-- 20261121090300, sanction 20261121090400, the general approval trigger
-- 20261121090500) can consult the SAME scope rule from its first
-- definition. The selection semantics are one sentence, stated once and
-- repeated verbatim at each site: an adopted ladder applies to an act only
-- when its org_node_id is null (org-wide) or is the act organization or an
-- ancestor of it (the act sits inside the scoped subtree); among applicable
-- rows the most SPECIFIC scope wins (deepest matching node, then org-wide),
-- newest version breaking ties; and when adopted rows exist but NONE covers
-- the act, the act is REFUSED by name — scoping never silently disarms a
-- ladder and never silently falls back past one.
alter table public.authority_limits
  add column if not exists org_node_id uuid references organizations(id) on delete restrict;

create index if not exists idx_authority_limits_node
  on authority_limits(organization_id, org_node_id) where org_node_id is not null;

comment on column public.authority_limits.org_node_id is
  'D3.32 / spec §41: site/BU scope on the five-level org tree. Null = the whole organization. Selection at every act site takes the most specific ADOPTED scope covering the act''s organization (subtree containment via org_ancestry); adopted rows that cover no act-site refuse by name rather than falling back; adoption supersedes per scope (20261121090500).';

-- Draft delegation rows so the right EXISTS to be adopted (the 20260808210000
-- seed discipline: drafts enforce nothing and grant nothing).
insert into authority_limits (organization_id, role_key, tier_label, action_type,
  max_commitment_usd, max_risk_level, escalates_to_role, basis)
select o.id, v.role_key, v.tier_label, 'gate_requirement_waiver',
       null, v.risk, v.escalates, v.basis
from organizations o
cross join (values
  ('executive', 'Executive', 'High', 'board',
   'Proposed: waiving a gate requirement suspends an enforcement rule for one case, so it sits with the executive layer by default. Placeholder pending the organization''s own delegation instrument; adopt (adopt_authority_limit) before any waiver can be decided.'),
  ('board', 'Board', 'Critical', null,
   'Proposed: waivers touching Critical-risk requirements are reserved upward. Placeholder pending the board charter; adopt before use.')
) as v(role_key, tier_label, risk, escalates, basis)
where not exists (
  select 1 from authority_limits al
  where al.organization_id = o.id and al.role_key = v.role_key
    and al.action_type = 'gate_requirement_waiver'
);

-- ---------------------------------------------------------------------------
-- 4. The request act. Requesting decides nothing, so the role bar matches
--    request_standard_variance (any member); every refusal names what is
--    missing.
-- ---------------------------------------------------------------------------
create or replace function public.request_gate_requirement_waiver(
  p_case_id uuid,
  p_requirement_id bigint,
  p_justification text,
  p_compensating_controls text,
  p_risk_id uuid,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  sc stage_gate_criteria%rowtype;
  v_gate stage_gates%rowtype;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'a waiver is not requestable on a ' || c.status || ' case');
  end if;
  select * into sc from stage_gate_criteria
  where id = p_requirement_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate requirement not found in this organization');
  end if;
  if sc.gate_id is null then
    return jsonb_build_object('error',
      'that criterion is stage-scoped (asset lifecycle family) — a case waiver names a gate-scoped requirement of the case''s framework');
  end if;
  select * into v_gate from stage_gates where id = sc.gate_id;
  if c.framework_id is null or v_gate.framework_id <> c.framework_id then
    return jsonb_build_object('error',
      'that requirement does not belong to this case''s framework — a waiver binds a case to one of its own gate requirements');
  end if;
  if coalesce(length(btrim(p_justification)), 0) < 20 then
    return jsonb_build_object('error',
      'a waiver request must state why the requirement cannot be met (20 characters minimum)');
  end if;
  if coalesce(length(btrim(p_compensating_controls)), 0) < 20 then
    return jsonb_build_object('error',
      'state the compensating controls. A waiver without them is not a waiver, it is a gap');
  end if;
  -- II.16 lists risk assessment as a field of the waiver, not an option.
  if p_risk_id is null then
    return jsonb_build_object('error',
      'a gate-requirement waiver names the risk assessment covering what is being waived (spec II.16) — record the risk on the one risks register and link it here');
  end if;
  if not exists (select 1 from risks where id = p_risk_id and organization_id = v_org) then
    return jsonb_build_object('error', 'that risk is not on this organization''s risk register');
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    return jsonb_build_object('error',
      'a waiver must expire. A permanent exception is a design decision nobody took (spec II.16)');
  end if;
  if p_expires_at > now() + interval '2 years' then
    return jsonb_build_object('error',
      'a waiver may not run beyond two years without re-examining the requirement itself');
  end if;
  if exists (
    select 1 from standard_site_variances w
    where w.development_case_id = c.id and w.requirement_id = sc.id
      and w.subject_type = 'gate_requirement' and w.status = 'approved'
      and w.expires_at > now()
  ) then
    return jsonb_build_object('error',
      'an active approved waiver already covers this requirement for this case — one waiver at a time, so enforcement always reads one answer');
  end if;

  insert into standard_site_variances (organization_id, subject_type,
    requirement_id, development_case_id, risk_id,
    justification, compensating_controls, requested_by, expires_at)
  values (v_org, 'gate_requirement', sc.id, c.id, p_risk_id,
    btrim(p_justification), btrim(p_compensating_controls), auth.uid(), p_expires_at)
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data, new_state)
  values (v_org, 'gate_requirement_waiver',
    coalesce((select role from user_profiles where id = auth.uid()), 'unknown'),
    jsonb_build_object('waiver_id', v_id, 'action', 'requested',
      'case_id', c.id, 'requirement_id', sc.id, 'criterion', sc.criterion,
      'risk_id', p_risk_id, 'expires_at', p_expires_at),
    jsonb_build_object('status', 'pending', 'expires_at', p_expires_at,
      'requirement_id', sc.id, 'development_case_id', c.id));

  return jsonb_build_object('waiver_id', v_id, 'status', 'pending',
    'requirement_id', sc.id, 'expires_at', p_expires_at);
end
$$;

revoke all on function public.request_gate_requirement_waiver(uuid, bigint, text, text, uuid, timestamptz) from public, anon;
grant execute on function public.request_gate_requirement_waiver(uuid, bigint, text, text, uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The decision. FAIL-CLOSED on the adopted waiver delegation; requester
--    cannot decide their own request; the AI-operator identity is refused by
--    name (§70). Audit carries previous/new state and names the authority
--    row exercised (D11.31).
-- ---------------------------------------------------------------------------
create or replace function public.decide_gate_requirement_waiver(
  p_waiver_id uuid,
  p_approve boolean,
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
  w standard_site_variances%rowtype;
  sc stage_gate_criteria%rowtype;
  l authority_limits%rowtype;
  r risks%rowtype;
  v_slot standard_site_variances%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'approving or rejecting a waiver suspends an enforcement rule — a §70 human determination the AI-operator identity cannot record');
  end if;
  select * into w from standard_site_variances
  where id = p_waiver_id and organization_id = v_org and subject_type = 'gate_requirement';
  if not found then
    return jsonb_build_object('error', 'gate-requirement waiver not found');
  end if;
  if w.status <> 'pending' then
    return jsonb_build_object('error', 'this waiver is already ' || w.status);
  end if;
  if w.requested_by is not null and w.requested_by = auth.uid() then
    return jsonb_build_object('error',
      'segregation of duties: you requested this waiver and cannot also decide it');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 10 then
    return jsonb_build_object('error', 'record the reasoning for this decision (10 characters minimum)');
  end if;

  -- FAIL-CLOSED delegation (the sanction posture): the right to waive exists
  -- only where the organization has adopted it for this role — and, D3.32,
  -- only where the adopted scope COVERS the act (the 20261121090100 §3
  -- selection rule: most specific covering scope wins, adopted-but-covering-
  -- nothing refuses by name, scoping never silently disarms or falls back).
  select al.* into l
  from authority_limits al
  left join org_ancestry(v_org) anc on anc.node_id = al.org_node_id
  where al.organization_id = v_org and al.role_key = coalesce(v_role, '')
    and al.action_type = 'gate_requirement_waiver' and al.status = 'adopted'
    and (al.org_node_id is null or anc.node_id is not null)
  order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc
  limit 1;
  if not found then
    if exists (select 1 from authority_limits
               where organization_id = v_org and role_key = coalesce(v_role, '')
                 and action_type = 'gate_requirement_waiver' and status = 'adopted') then
      return jsonb_build_object('error',
        format('every ADOPTED gate-requirement-waiver delegation for the %s role is scoped to one organization node whose subtree does not cover this case''s organization. Adopt a delegation covering this node, or escalate.',
               coalesce(v_role, 'none')));
    end if;
    return jsonb_build_object('error',
      format('no ADOPTED gate-requirement-waiver authority exists for the %s role in this organization. Waivers are decided under the delegation-of-authority ladder: adopt the delegation (adopt_authority_limit) from your governance instrument first.',
             coalesce(v_role, 'none')));
  end if;

  -- The delegation may cap the risk level a role can waive over. The risk
  -- link is load-bearing HERE, not only at request time: an approval whose
  -- ceiling cannot be verified — link severed, risk row gone, or risk never
  -- rated — fails CLOSED with the missing thing named (refusal-first; the
  -- non-finite-numeric door discipline applied to a rating).
  if p_approve then
    if w.risk_id is null then
      return jsonb_build_object('error',
        'this waiver no longer carries its linked risk assessment (spec II.16 makes the link mandatory) — re-link the risk on the register before any approval');
    end if;
    select * into r from risks where id = w.risk_id;
    if r.id is null then
      return jsonb_build_object('error',
        'the risk assessment this waiver names no longer exists on the register — the risk-level ceiling cannot be verified, so the approval is refused (record the risk again and re-request)');
    end if;
    if l.max_risk_level is not null then
      if r.current_risk_level is null or risk_rank(r.current_risk_level) = 0 then
        return jsonb_build_object('error',
          format('the linked risk carries no rated level, so the %s waiver ceiling of %s cannot be verified against it — rate the risk (current_risk_level) before this waiver can be approved',
                 l.tier_label, l.max_risk_level));
      end if;
      if risk_rank(r.current_risk_level) > risk_rank(l.max_risk_level) then
        return jsonb_build_object('error',
          format('%s risk exceeds the %s waiver ceiling of %s for your role. Escalate to %s.',
                 r.current_risk_level, l.tier_label, l.max_risk_level,
                 coalesce(l.escalates_to_role, 'the board')));
      end if;
    end if;
  end if;

  select * into sc from stage_gate_criteria where id = w.requirement_id;

  -- D3.20: a lapsed-but-unswept predecessor is expired AT THE ACT. Its
  -- status still reads 'approved' until the hourly sweep, so it holds the
  -- one-active-waiver index slot; without this, a legitimate renewal inside
  -- that window would die on a raw duplicate-key error instead of a named
  -- outcome. The flip is the sweep's own transition, taken early and
  -- recorded the same way (the sweep's not-exists audit guard then skips
  -- it — one reversion record, whoever wrote it first).
  if p_approve then
    for v_slot in
      select * from standard_site_variances
      where development_case_id = w.development_case_id
        and requirement_id = w.requirement_id
        and subject_type = 'gate_requirement' and status = 'approved'
        and expires_at <= now() and id <> w.id
    loop
      update standard_site_variances set status = 'expired' where id = v_slot.id;
      insert into audit_events (organization_id, entity_type, actor, event_data,
        previous_state, new_state)
      values (v_org, 'gate_requirement_waiver', coalesce(v_role, 'unknown'),
        jsonb_build_object('waiver_id', v_slot.id, 'action', 'expired',
          'case_id', v_slot.development_case_id, 'requirement_id', v_slot.requirement_id,
          'expired_at', v_slot.expires_at, 'recorded_at', 'waiver_decision'),
        jsonb_build_object('status', 'approved'),
        jsonb_build_object('status', 'expired'));
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'system (act-time expiry)',
         'admin_action', 'warning',
         format('Gate-requirement waiver expired for case %s, requirement "%s" — ENFORCEMENT REVERTED: the requirement binds again at every gate, advance and sanction from this moment. Recorded at the successor waiver''s decision, ahead of the hourly sweep.',
                v_slot.development_case_id, coalesce(sc.criterion, v_slot.requirement_id::text)));
    end loop;
    -- Anything still approved for this slot is genuinely unexpired: refuse
    -- by name rather than letting the unique index answer with a 23505.
    if exists (
      select 1 from standard_site_variances a
      where a.development_case_id = w.development_case_id
        and a.requirement_id = w.requirement_id
        and a.subject_type = 'gate_requirement' and a.status = 'approved'
        and a.id <> w.id
    ) then
      return jsonb_build_object('error',
        'an active approved waiver already covers this requirement for this case — one waiver at a time, so enforcement always reads one answer');
    end if;
  end if;

  update standard_site_variances
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), decision_note = btrim(p_note)
  where id = w.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state, approval_reference)
  values (v_org, 'gate_requirement_waiver', coalesce(v_role, 'unknown'),
    jsonb_build_object('waiver_id', w.id,
      'action', case when p_approve then 'approved' else 'rejected' end,
      'case_id', w.development_case_id, 'requirement_id', w.requirement_id,
      'criterion', sc.criterion, 'risk_id', w.risk_id,
      'expires_at', w.expires_at,
      'approval_reference_table', 'authority_limits'),
    jsonb_build_object('status', w.status, 'decided_by', w.decided_by,
      'decided_at', w.decided_at, 'decision_note', w.decision_note),
    jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end,
      'decided_by', auth.uid(), 'decided_at', now(), 'decision_note', btrim(p_note)),
    l.id);

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Gate-requirement waiver %s for case %s, requirement "%s", by role %s under the %s delegation. Expires %s — enforcement reverts at expiry.',
            case when p_approve then 'APPROVED' else 'rejected' end,
            w.development_case_id, coalesce(sc.criterion, w.requirement_id::text),
            coalesce(v_role, 'none'), l.tier_label,
            to_char(w.expires_at, 'YYYY-MM-DD HH24:MI')));

  return jsonb_build_object('waiver_id', w.id,
    'status', case when p_approve then 'approved' else 'rejected' end,
    'expires_at', w.expires_at);
end
$$;

revoke all on function public.decide_gate_requirement_waiver(uuid, boolean, text) from public, anon;
grant execute on function public.decide_gate_requirement_waiver(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. decide_standard_variance, re-created from its 20260809140000 definition
--    with exactly THREE changes (all marked or commented in place): the
--    ai_admin identity no longer rides the admin bypass and is refused by
--    name (§70 — approving a waiver is a human determination; narrowing an
--    approver set is the permitted direction), gate-requirement rows are
--    redirected to their own authority-routed decision RPC (the
--    subject_type <> 'standard' branch), and the audit row now carries
--    previous/new state (D11.31). Everything else is byte-identical.
-- ---------------------------------------------------------------------------
create or replace function public.decide_standard_variance(
  p_variance_id uuid,
  p_approve boolean,
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
  r standard_site_variances%rowtype;
  s governance_standards%rowtype;
begin
  select role into v_role from user_profiles where id = auth.uid();

  -- D3.19 (20261121090100, marked insertion): §70 — the AI-operator identity
  -- cannot approve a waiver. Previously ai_admin rode the admin bypass.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'approving or rejecting a variance suspends a standard — a §70 human determination the AI-operator identity cannot record');
  end if;

  select * into r from standard_site_variances
  where id = p_variance_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'variance not found');
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('error', 'this variance is already ' || r.status);
  end if;
  -- Gate-requirement waivers are decided through their own authority-routed
  -- act; this legacy path decides standard variances only.
  if r.subject_type <> 'standard' then
    return jsonb_build_object('error',
      'this is a gate-requirement waiver — decide it through decide_gate_requirement_waiver, which routes the approver through the adopted authority ladder');
  end if;

  select * into s from governance_standards where id = r.standard_id;

  -- The standard names its own variance authority. Nobody else may grant one.
  if v_role is distinct from s.variance_approver_role
     and v_role not in ('admin') then
    return jsonb_build_object('error',
      format('granting a variance to "%s" requires the %s role',
        s.title, s.variance_approver_role));
  end if;

  -- Nor may the requester decide their own request.
  if r.requested_by is not null and r.requested_by = auth.uid() then
    return jsonb_build_object('error',
      'segregation of duties: you requested this variance and cannot also decide it');
  end if;

  if coalesce(length(trim(p_note)), 0) < 10 then
    return jsonb_build_object('error', 'record the reasoning for this decision');
  end if;

  update standard_site_variances
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note)
  where id = p_variance_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'standard_variance', coalesce(v_role, 'unknown'),
    jsonb_build_object('variance_id', p_variance_id, 'standard', s.standard_key,
      'approved', p_approve),
    jsonb_build_object('status', r.status, 'decided_by', r.decided_by,
      'decided_at', r.decided_at),
    jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end,
      'decided_by', auth.uid(), 'decided_at', now()));

  return jsonb_build_object('variance_id', p_variance_id,
    'status', case when p_approve then 'approved' else 'rejected' end);
end
$$;

revoke all on function public.decide_standard_variance(uuid, boolean, text) from public, anon;
grant execute on function public.decide_standard_variance(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
