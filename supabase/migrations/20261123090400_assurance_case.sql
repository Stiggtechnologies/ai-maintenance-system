-- ============================================================================
-- Sync Develop Slice 3D — the Assurance Case (D13.06, spec III.§44).
--
-- §44: "Assurance Case (claim, evidence, confidence, open issues, assumptions,
-- independent review — e.g. 'Facility can meet 97.5% availability')".
--
-- THE ONE DESIGN DECISION THAT MATTERS: the claim→evidence link is RECORDED,
-- never inferred. The tempting build is to take the case's success outcomes as
-- claims and its evidence items as support and join them on word overlap. That
-- screen would look complete on day one and be wrong on day two, because the
-- one thing an assurance case asserts is that a named human said "this
-- evidence supports this claim". So assurance_claim_evidence is a real table
-- with a real write path and a stated basis per link, and a claim with nothing
-- linked renders as "no evidence is linked to this claim" — which is the most
-- useful row on the screen, because it is the one that gets work done.
--
-- WHAT IS REUSED, NOT REBUILT (overlap-map rulings):
--   * confidence per evidence item is compute_evidence_confidence — the
--     D11.22 §46 composite, weights and all. No second arithmetic.
--   * the independent review is get_case_assurance_position — the D3.16
--     predicate carrying competency, conflicts and rank from Slice 3C.
--   * assumptions are risk_assumptions scoped to the case (ruling 5: the ONE
--     Assumption store). No assurance-case assumption table.
--   * open issues are the case's own unresolved risks, open gate conditions
--     and uncovered commitments — read from the shipped stores.
--   * a claim may POINT AT a recorded success outcome (D1.01) or a gate
--     requirement, so the eleven success dimensions become claims without
--     being copied.
--
-- SPEC AMBIGUITY RESOLVED (§44 says "confidence" for a claim; §46 defines
-- confidence only for an evidence item). RULING: NO AGGREGATE IS INVENTED.
-- The screen reports, per claim, the highest and the lowest supporting
-- evidence confidence and how many items were scored, and refuses a single
-- number. Combining independent evidence into one figure needs an
-- independence assumption nobody in this product has stated, and a claim
-- reading "0.71" would be believed. Highest and lowest are facts; 0.71 would
-- be a model.
--
-- SPEC AMBIGUITY RESOLVED (may the machine mark a claim supported?). RULING:
-- no. A claim's position is a human judgement with a stated basis, and the
-- AI-operator identity is refused by name at the RPC and at the persistence
-- boundary. §70 does not list "claim supported" explicitly, but "safety
-- barrier adequate" and "regulation satisfied" are exactly the sentences an
-- assurance case exists to state, and they are on the list.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Claims.
-- ---------------------------------------------------------------------------
create table if not exists public.assurance_case_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  claim_ref text not null check (btrim(claim_ref) <> ''),
  -- The sentence itself. "Facility can meet 97.5% availability."
  statement text not null check (length(btrim(statement)) >= 10),
  -- Where the claim comes from. A claim standing on nothing is legitimate
  -- (someone asserted it); a claim pretending to derive from a success
  -- outcome that does not exist is not, so the links are FKs.
  claim_type text not null check (claim_type in
    ('success_outcome','gate_requirement','regulatory','safety','standalone')),
  success_outcome_id uuid references development_success_outcomes(id) on delete set null,
  requirement_id bigint references stage_gate_criteria(id) on delete set null,
  owner_id uuid not null references user_profiles(id) on delete restrict,
  -- The human's position on the claim, and why. 'open' is the honest default:
  -- a claim nobody has ruled on has not been ruled on.
  claim_position text not null default 'open'
    check (claim_position in ('open','supported','refuted','withdrawn')),
  position_basis text,
  position_by uuid references auth.users(id),
  position_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (development_case_id, claim_ref),
  -- A typed claim names what it is typed against.
  constraint claim_type_link check (
    (claim_type <> 'success_outcome' or success_outcome_id is not null)
    and (claim_type <> 'gate_requirement' or requirement_id is not null)
  ),
  -- A position other than 'open' names its author and its basis.
  constraint claim_position_recorded check (
    claim_position = 'open'
    or (position_by is not null and position_at is not null
        and length(btrim(coalesce(position_basis, ''))) >= 20)
  )
);

create index if not exists idx_assurance_claims_case
  on assurance_case_claims(organization_id, development_case_id, claim_position);

alter table public.assurance_case_claims enable row level security;
drop policy if exists assurance_case_claims_read on public.assurance_case_claims;
create policy assurance_case_claims_read on public.assurance_case_claims
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 2. The recorded link. Each one carries WHY this evidence bears on this
--    claim — the sentence the reviewer is accountable for.
-- ---------------------------------------------------------------------------
create table if not exists public.assurance_claim_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  claim_id uuid not null references assurance_case_claims(id) on delete cascade,
  evidence_id uuid not null references evidence_items(id) on delete cascade,
  basis text not null check (length(btrim(basis)) >= 10),
  -- Does this evidence support the claim or cut against it? An assurance case
  -- that can only hold supporting evidence is a marketing document.
  bearing text not null default 'supports'
    check (bearing in ('supports','contradicts','qualifies')),
  linked_by uuid not null references auth.users(id),
  linked_at timestamptz not null default now(),
  unique (claim_id, evidence_id)
);

create index if not exists idx_assurance_claim_evidence_claim
  on assurance_claim_evidence(organization_id, claim_id);

alter table public.assurance_claim_evidence enable row level security;
drop policy if exists assurance_claim_evidence_read on public.assurance_claim_evidence;
create policy assurance_claim_evidence_read on public.assurance_claim_evidence
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 3. THE §70 WALL, INSERT / UPDATE / DELETE on both tables.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_assurance_claim_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.assurance_claim_write', true), '');
  v_role text;
  v_actor uuid;
  v_evidence_count int;
begin
  if tg_op = 'DELETE' then
    -- Mid-cascade: a declared parent is already gone (the
    -- enforce_framework_immutability idiom, 20261101090100). Without this the
    -- `on delete cascade` on development_case_id promised a cleanup this
    -- branch forbade, so a case carrying one claim could not be deleted and
    -- the refusal offered advice — "withdraw it" — that cannot resolve a
    -- cascade.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id) then
      return old;
    end if;
    if v_marker <> 'granted' then
      raise exception
        'An assurance claim is not deleted: withdraw it (set_assurance_claim_position), which keeps '
        'the record that it was made and that somebody stopped standing behind it.'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if v_marker <> 'granted' then
    raise exception
      'Assurance claims are written through record_assurance_claim and set_assurance_claim_position, '
      'which record who made the claim, who ruled on it, and on what basis.'
      using errcode = 'insufficient_privilege';
  end if;

  -- §70. The position on a claim — "the facility can meet 97.5% availability",
  -- "the barrier is adequate" — is exactly the class of sentence the LLM never
  -- determines. Unconditional, service path included: a machine-attributed
  -- position is corrupt assurance data however it arrived.
  v_actor := coalesce(new.position_by, new.created_by);
  if new.claim_position <> 'open'
     and (tg_op = 'INSERT' or new.claim_position is distinct from old.claim_position
          or new.position_by is distinct from old.position_by) then
    select role into v_role from user_profiles where id = new.position_by;
    if coalesce(v_role, '') = 'ai_admin' then
      raise exception
        'A position on an assurance claim is a §70 human determination — the AI-operator identity '
        'assembles evidence and states confidence; it does not rule that a claim holds.'
        using errcode = 'check_violation';
    end if;
    -- FAIL CLOSED: 'supported' with nothing linked is the whole failure mode
    -- this table exists to prevent.
    if new.claim_position = 'supported' then
      select count(*) into v_evidence_count
      from assurance_claim_evidence e
      where e.claim_id = new.id and e.bearing in ('supports','qualifies');
      if v_evidence_count = 0 then
        raise exception
          'Claim "%" cannot be marked supported: no evidence is linked to it. A supported claim with '
          'no evidence behind it is the exact assertion an assurance case exists to make impossible.',
          new.claim_ref
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  if v_actor is null then
    raise exception 'An assurance claim names the human who made it.'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_assurance_claim_provenance() from public, anon, authenticated;

drop trigger if exists trg_assurance_claim_provenance on public.assurance_case_claims;
create trigger trg_assurance_claim_provenance
  before insert or update or delete on public.assurance_case_claims
  for each row execute function public.enforce_assurance_claim_provenance();

create or replace function public.enforce_assurance_claim_evidence_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.assurance_claim_write', true), '');
  c assurance_case_claims%rowtype;
  e evidence_items%rowtype;
begin
  if tg_op = 'DELETE' then
    -- Mid-cascade, as above.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from assurance_case_claims where id = old.claim_id)
       or not exists (select 1 from evidence_items where id = old.evidence_id) then
      return old;
    end if;
    if v_marker <> 'granted' then
      raise exception
        'An evidence link is not deleted directly: unlink_assurance_claim_evidence records who removed '
        'it, because removing the support under a supported claim is a governance act.'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if v_marker <> 'granted' then
    raise exception
      'Assurance evidence links are written through link_assurance_claim_evidence, which records the '
      'basis on which this evidence is said to bear on this claim.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into c from assurance_case_claims where id = new.claim_id;
  select * into e from evidence_items where id = new.evidence_id;
  if c.id is null or e.id is null
     or c.organization_id <> new.organization_id
     or e.organization_id <> new.organization_id then
    raise exception 'An evidence link joins a claim and an evidence item of its own organization.'
      using errcode = 'check_violation';
  end if;
  -- The evidence must belong to the case the claim is about. Borrowing
  -- another project's evidence without saying so is the applicability failure
  -- §46's A factor exists to grade, and it is not a link this table makes.
  if e.development_case_id is distinct from c.development_case_id then
    raise exception
      'Evidence % belongs to a different development case than claim "%". Record it against this case '
      '(record_case_evidence) if it genuinely bears on it — an assurance case does not silently borrow.',
      e.id, c.claim_ref
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_assurance_claim_evidence_provenance() from public, anon, authenticated;

drop trigger if exists trg_assurance_claim_evidence_provenance on public.assurance_claim_evidence;
create trigger trg_assurance_claim_evidence_provenance
  before insert or update or delete on public.assurance_claim_evidence
  for each row execute function public.enforce_assurance_claim_evidence_provenance();

-- ---------------------------------------------------------------------------
-- 4. The write paths.
-- ---------------------------------------------------------------------------
create or replace function public.record_assurance_claim(
  p_case_id uuid,
  p_claim jsonb
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
  v_type text := btrim(coalesce(p_claim->>'claim_type', 'standalone'));
  v_ref text := btrim(coalesce(p_claim->>'claim_ref', ''));
  v_statement text := btrim(coalesce(p_claim->>'statement', ''));
  -- sync_text_as_* (20261122090000 §0), never a bare cast, and note WHERE the
  -- problem was: these initialisers run before the first line of the body, so
  -- `"owner_id": "not-a-uuid"` raised `invalid input syntax for type uuid` at
  -- the caller before any validation could name the field. The helpers return
  -- NULL for unparseable text and the raw text is kept beside them so the
  -- refusal can quote what was actually sent (record_case_assurance_review's
  -- shape, 20261122090000).
  v_owner uuid := sync_text_as_uuid(nullif(p_claim->>'owner_id',''));
  v_outcome uuid := sync_text_as_uuid(nullif(p_claim->>'success_outcome_id',''));
  v_req bigint := sync_text_as_bigint(nullif(p_claim->>'requirement_id',''));
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if nullif(p_claim->>'owner_id','') is not null and v_owner is null then
    return jsonb_build_object('error',
      format('owner_id is not a user id: %s', p_claim->>'owner_id'));
  end if;
  if nullif(p_claim->>'success_outcome_id','') is not null and v_outcome is null then
    return jsonb_build_object('error',
      format('success_outcome_id is not a recorded outcome id: %s', p_claim->>'success_outcome_id'));
  end if;
  if nullif(p_claim->>'requirement_id','') is not null and v_req is null then
    return jsonb_build_object('error',
      format('requirement_id is not a gate requirement id: %s', p_claim->>'requirement_id'));
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording an assurance claim requires a governance, engineering or planning role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_ref = '' then
    return jsonb_build_object('error', 'the claim needs a reference (e.g. "C-01") so it can be cited');
  end if;
  if length(v_statement) < 10 then
    return jsonb_build_object('error',
      'state the claim as a sentence somebody could disagree with (10 characters minimum) — "availability" is a topic, "the facility can meet 97.5% availability" is a claim');
  end if;
  if v_type not in ('success_outcome','gate_requirement','regulatory','safety','standalone') then
    return jsonb_build_object('error',
      'claim_type must be success_outcome, gate_requirement, regulatory, safety or standalone');
  end if;
  if v_owner is null or not exists (
    select 1 from user_profiles where id = v_owner and organization_id = v_org) then
    return jsonb_build_object('error',
      'every claim names an owner who is a member of this organization — a claim nobody owns is nobody''s to defend');
  end if;
  if v_type = 'success_outcome' then
    if v_outcome is null or not exists (
      select 1 from development_success_outcomes o
      join development_success_contracts sc on sc.id = o.contract_id
      where o.id = v_outcome and sc.development_case_id = c.id and sc.organization_id = v_org) then
      return jsonb_build_object('error',
        'a success-outcome claim names a recorded success outcome of THIS case''s success contract');
    end if;
  else
    v_outcome := null;
  end if;
  if v_type = 'gate_requirement' then
    if v_req is null or not exists (
      select 1 from stage_gate_criteria sc
      join stage_gates g on g.id = sc.gate_id
      where sc.id = v_req and sc.organization_id = v_org and g.framework_id = c.framework_id) then
      return jsonb_build_object('error',
        'a gate-requirement claim names a requirement of a gate in this case''s governing framework');
    end if;
  else
    v_req := null;
  end if;
  if exists (select 1 from assurance_case_claims
             where development_case_id = c.id and claim_ref = v_ref) then
    return jsonb_build_object('error',
      format('claim reference "%s" is already used on this case — references are how claims get cited, so they are unique', v_ref));
  end if;

  perform set_config('app.assurance_claim_write', 'granted', true);
  insert into assurance_case_claims
    (organization_id, development_case_id, claim_ref, statement, claim_type,
     success_outcome_id, requirement_id, owner_id, created_by)
  values
    (v_org, c.id, v_ref, v_statement, v_type, v_outcome, v_req, v_owner, auth.uid())
  returning id into v_id;
  perform set_config('app.assurance_claim_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, new_state)
  values (v_org, 'assurance_claim', coalesce(v_role, 'unknown'),
    jsonb_build_object('claim_id', v_id, 'case_id', c.id, 'claim_ref', v_ref,
      'claim_type', v_type, 'owner_id', v_owner),
    jsonb_build_object('position', 'open'));

  return jsonb_build_object('claim_id', v_id, 'claim_ref', v_ref, 'position', 'open');
end
$$;

revoke all on function public.record_assurance_claim(uuid, jsonb) from public, anon;
grant execute on function public.record_assurance_claim(uuid, jsonb) to authenticated;

create or replace function public.link_assurance_claim_evidence(
  p_claim_id uuid,
  p_evidence_id uuid,
  p_basis text,
  p_bearing text default 'supports'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c assurance_case_claims%rowtype;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'linking evidence to a claim requires a governance, engineering or planning role');
  end if;
  select * into c from assurance_case_claims where id = p_claim_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'assurance claim not found');
  end if;
  if c.claim_position = 'withdrawn' then
    return jsonb_build_object('error', 'this claim has been withdrawn — evidence is not linked to a claim nobody is making');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 10 then
    return jsonb_build_object('error',
      'state HOW this evidence bears on this claim (10 characters minimum) — the link, not the evidence, is what a reviewer checks');
  end if;
  if coalesce(p_bearing, '') not in ('supports','contradicts','qualifies') then
    return jsonb_build_object('error', 'bearing must be supports, contradicts or qualifies');
  end if;
  -- THE RISK LADDER, APPLIED BY HAND. evidence_items carries risk_id and the
  -- policy evidence_items_risk_sensitive (`risk_id is null or
  -- can_read_risk(risk_id)`); this function is SECURITY DEFINER, so that policy
  -- does not run and the check below was a bare org test. The read
  -- (get_case_assurance_case) is SECURITY INVOKER and DOES apply the policy, so
  -- a link made through this door to evidence the linker could not read
  -- produced a claim rendering "position: supported" and "it is an assertion"
  -- at the same time. can_read_risk resolves against the JWT claims, so it
  -- answers for the caller even here. Same refusal sentence as "not found":
  -- a linker who may not read the item should not learn it exists.
  if not exists (
    select 1 from evidence_items e
    where e.id = p_evidence_id and e.organization_id = v_org
      and (e.risk_id is null or can_read_risk(e.risk_id))) then
    return jsonb_build_object('error', 'evidence item not found in this organization');
  end if;
  if exists (select 1 from assurance_claim_evidence
             where claim_id = c.id and evidence_id = p_evidence_id) then
    return jsonb_build_object('error',
      'that evidence is already linked to this claim — unlink it first to restate the basis');
  end if;

  perform set_config('app.assurance_claim_write', 'granted', true);
  insert into assurance_claim_evidence
    (organization_id, claim_id, evidence_id, basis, bearing, linked_by)
  values (v_org, c.id, p_evidence_id, btrim(p_basis), p_bearing, auth.uid())
  returning id into v_id;
  perform set_config('app.assurance_claim_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, new_state)
  values (v_org, 'assurance_claim_evidence', coalesce(v_role, 'unknown'),
    jsonb_build_object('link_id', v_id, 'claim_id', c.id, 'claim_ref', c.claim_ref,
      'evidence_id', p_evidence_id, 'bearing', p_bearing),
    jsonb_build_object('bearing', p_bearing, 'linked_by', auth.uid()));

  return jsonb_build_object('link_id', v_id, 'claim_id', c.id, 'bearing', p_bearing);
end
$$;

revoke all on function public.link_assurance_claim_evidence(uuid, uuid, text, text) from public, anon;
grant execute on function public.link_assurance_claim_evidence(uuid, uuid, text, text) to authenticated;

create or replace function public.unlink_assurance_claim_evidence(
  p_link_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  l assurance_claim_evidence%rowtype;
  c assurance_case_claims%rowtype;
  v_remaining int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'removing evidence from a claim requires a governance or engineering role');
  end if;
  select * into l from assurance_claim_evidence where id = p_link_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evidence link not found');
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    return jsonb_build_object('error', 'state why this evidence no longer bears on the claim (10 characters minimum)');
  end if;
  select * into c from assurance_case_claims where id = l.claim_id;
  -- FAIL CLOSED: removing the last supporting link under a SUPPORTED claim
  -- would leave the claim asserting itself. Reopen it first, deliberately.
  if c.claim_position = 'supported' and l.bearing in ('supports','qualifies') then
    select count(*) into v_remaining
    from assurance_claim_evidence e
    where e.claim_id = c.id and e.id <> l.id and e.bearing in ('supports','qualifies');
    if v_remaining = 0 then
      return jsonb_build_object('error',
        format('claim "%s" is marked supported and this is the last evidence behind it. Reopen the claim first (set_assurance_claim_position, open) — removing the support silently would leave the claim standing on nothing.', c.claim_ref));
    end if;
  end if;

  perform set_config('app.assurance_claim_write', 'granted', true);
  delete from assurance_claim_evidence where id = l.id;
  perform set_config('app.assurance_claim_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'assurance_claim_evidence', coalesce(v_role, 'unknown'),
    jsonb_build_object('link_id', l.id, 'claim_id', l.claim_id, 'reason', btrim(p_reason)),
    jsonb_build_object('evidence_id', l.evidence_id, 'bearing', l.bearing, 'basis', l.basis),
    null);

  return jsonb_build_object('link_id', l.id, 'removed', true);
end
$$;

revoke all on function public.unlink_assurance_claim_evidence(uuid, text) from public, anon;
grant execute on function public.unlink_assurance_claim_evidence(uuid, text) to authenticated;

create or replace function public.set_assurance_claim_position(
  p_claim_id uuid,
  p_position text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c assurance_case_claims%rowtype;
  v_support int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  -- §70, named before the role gate so the refusal says what it is.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'ruling on an assurance claim is a §70 human determination — the AI-operator identity assembles evidence and states confidence; it does not decide that a claim holds');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error',
      'ruling on an assurance claim requires a governance or engineering role');
  end if;
  select * into c from assurance_case_claims where id = p_claim_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'assurance claim not found');
  end if;
  if p_position not in ('open','supported','refuted','withdrawn') then
    return jsonb_build_object('error', 'position must be open, supported, refuted or withdrawn');
  end if;
  if p_position <> 'open' and coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object('error',
      'state the basis for this position (20 characters minimum) — a claim ruled on without a reason is an assertion with a badge');
  end if;
  if p_position = 'supported' then
    select count(*) into v_support
    from assurance_claim_evidence e
    where e.claim_id = c.id and e.bearing in ('supports','qualifies');
    if v_support = 0 then
      return jsonb_build_object('error',
        format('claim "%s" has no evidence linked to it, so it cannot be marked supported — link the evidence and state how it bears on the claim (link_assurance_claim_evidence)', c.claim_ref));
    end if;
  end if;

  perform set_config('app.assurance_claim_write', 'granted', true);
  update assurance_case_claims
  set claim_position = p_position,
      position_basis = case when p_position = 'open' then null else btrim(p_basis) end,
      position_by = case when p_position = 'open' then null else auth.uid() end,
      position_at = case when p_position = 'open' then null else now() end
  where id = c.id;
  perform set_config('app.assurance_claim_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'assurance_claim', coalesce(v_role, 'unknown'),
    jsonb_build_object('claim_id', c.id, 'claim_ref', c.claim_ref,
      'case_id', c.development_case_id, 'basis', btrim(coalesce(p_basis, ''))),
    jsonb_build_object('position', c.claim_position, 'position_by', c.position_by),
    jsonb_build_object('position', p_position, 'position_by', auth.uid()));

  return jsonb_build_object('claim_id', c.id, 'position', p_position);
end
$$;

revoke all on function public.set_assurance_claim_position(uuid, text, text) from public, anon;
grant execute on function public.set_assurance_claim_position(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4b. THE LINK COUNT, DEFINER, so the invoker read below can say how many
--     links it is NOT showing.
--
--     get_case_assurance_case is SECURITY INVOKER on purpose — the risk ladder
--     must apply to the evidence it renders — which means a reader below a
--     linked item's ladder position sees the claim with that item silently
--     absent. Silently is the problem: "supporting 0" and "supporting 2" look
--     identical to someone who cannot see the difference. This counts the links
--     without disclosing anything about them, so the read can report a
--     withheld count and the reviewer knows to ask.
-- ---------------------------------------------------------------------------
create or replace function public.assurance_claim_link_total(p_claim_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_n int;
begin
  if v_org is null then
    return 0;
  end if;
  select count(*) into v_n
  from assurance_claim_evidence l
  where l.claim_id = p_claim_id and l.organization_id = v_org;
  return coalesce(v_n, 0);
end
$$;

revoke all on function public.assurance_claim_link_total(uuid) from public, anon;
grant execute on function public.assurance_claim_link_total(uuid) to authenticated;

comment on function public.assurance_claim_link_total(uuid) is
  'D13.06: how many evidence links a claim carries in total, so the SECURITY INVOKER assurance read can report the number it is withholding under the risk-sensitivity ladder rather than rendering a shorter list that looks complete.';

-- ---------------------------------------------------------------------------
-- 5. THE SCREEN'S ONE QUERY.
--
--    SECURITY INVOKER, so the risk-sensitivity ladder applies to the open
--    issues drawn from the risk register — the same reason get_gate_readiness
--    is invoker. Sub-answers come from definer helpers granted to
--    authenticated (compute_evidence_confidence, get_case_assurance_position,
--    get_case_commitment_coverage), which is the shipped pattern.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_assurance_case(p_case_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_claims jsonb := '[]'::jsonb;
  rec record;
  v_evidence jsonb;
  v_scored numeric[];
  v_ungraded int;
  v_supporting int;
  v_contradicting int;
  v_withheld int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  for rec in
    select cl.* from assurance_case_claims cl
    where cl.organization_id = v_org and cl.development_case_id = c.id
    order by cl.claim_ref
  loop
    v_scored := '{}';
    v_ungraded := 0;
    select coalesce(jsonb_agg(jsonb_build_object(
        'linkId', l.id,
        'evidenceId', e.id,
        'bearing', l.bearing,
        'basis', l.basis,
        'linkedAt', l.linked_at,
        'linkedBy', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = l.linked_by),
        'evidenceClass', e.evidence_class,
        'verificationStatus', e.verification_status,
        'description', e.description,
        'sourceSystem', e.source_system,
        'observedAt', e.ts,
        -- The §46 composite, or the named refusal. Never a substituted default.
        'confidence', compute_evidence_confidence(e.id))
        order by l.linked_at), '[]'::jsonb)
    into v_evidence
    from assurance_claim_evidence l
    join evidence_items e on e.id = l.evidence_id
    where l.claim_id = rec.id and l.organization_id = v_org;

    -- Aggregated with FILTER, not array_remove(..., null): removing NULLs by
    -- comparing them to NULL removes nothing, and the count would then be an
    -- array length including every item the §46 computation refused.
    select array_agg((x->'confidence'->>'evidenceConfidence')::numeric)
             filter (where x->'confidence' ? 'evidenceConfidence'),
           count(*) filter (where not (x->'confidence' ? 'evidenceConfidence'))
    into v_scored, v_ungraded
    from jsonb_array_elements(v_evidence) x
    where x->>'bearing' in ('supports','qualifies');

    -- Counted ONCE, here, and used everywhere below. The first version's
    -- "none scored" sentence formatted with jsonb_array_length(v_evidence) —
    -- EVERY link — while calling them "supporting item(s)", so a claim with
    -- three CONTRADICTING links and nothing supporting it was described to the
    -- reviewer as having three supporting items, on the one screen whose
    -- header promises that contradicting evidence is a first-class link.
    select count(*) filter (where x->>'bearing' in ('supports','qualifies')),
           count(*) filter (where x->>'bearing' = 'contradicts')
    into v_supporting, v_contradicting
    from jsonb_array_elements(v_evidence) x;
    -- Links this reader is not being shown, under the risk ladder.
    v_withheld := greatest(
      assurance_claim_link_total(rec.id) - jsonb_array_length(v_evidence), 0);

    v_claims := v_claims || jsonb_build_array(jsonb_build_object(
      'id', rec.id,
      'claimRef', rec.claim_ref,
      'statement', rec.statement,
      'claimType', rec.claim_type,
      'successOutcomeId', rec.success_outcome_id,
      'requirementId', rec.requirement_id,
      'owner', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = rec.owner_id),
      'position', rec.claim_position,
      'positionBasis', rec.position_basis,
      'positionAt', rec.position_at,
      'positionBy', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = rec.position_by),
      'evidence', v_evidence,
      'supportingCount', v_supporting,
      'contradictingCount', v_contradicting,
      'withheldCount', v_withheld,
      -- NO AGGREGATE (see header ruling): the spread and the refusal count,
      -- never one number standing for the claim.
      'confidence', jsonb_build_object(
        'scoredCount', coalesce(array_length(v_scored, 1), 0),
        'unscoredCount', coalesce(v_ungraded, 0),
        'highest', (select max(v) from unnest(coalesce(v_scored, '{}')) v),
        'lowest', (select min(v) from unnest(coalesce(v_scored, '{}')) v),
        'statement', (case
          when jsonb_array_length(v_evidence) = 0
            then 'No evidence is linked to this claim. Nothing supports it and nothing contradicts it — it is an assertion.'
          when v_supporting = 0
            then format('Nothing supports this claim: the %s item(s) linked to it are contradicting. There is no evidence confidence to report, because §46 confidence is computed over the evidence a claim RESTS on.', v_contradicting)
          when coalesce(array_length(v_scored, 1), 0) = 0
            then format('%s supporting item(s) linked, none scored: evidence confidence (spec §46) needs graded quality and applicability and an adopted weight set. Grade them and the number appears.', v_supporting)
          else format('%s of %s supporting item(s) carry an evidence confidence; no single number is combined from them, because combining independent evidence needs an independence assumption this product has not stated.',
                      coalesce(array_length(v_scored, 1), 0),
                      coalesce(array_length(v_scored, 1), 0) + coalesce(v_ungraded, 0))
          end)
          -- Never silently short. A reader below a linked item's ladder
          -- position sees the claim without it; they are told so.
          || case when v_withheld > 0
               then format(' A further %s linked item(s) are not shown to you: they are bound to a risk you may not read.', v_withheld)
               else '' end
          || case when v_contradicting > 0 and v_supporting > 0
               then format(' %s item(s) contradict it.', v_contradicting)
               else '' end)));
  end loop;

  return jsonb_build_object(
    'caseId', c.id,
    'caseTitle', c.title,
    'claims', v_claims,
    'claimCount', jsonb_array_length(v_claims),
    -- §44 "independent review": the D3.16 predicate, competency and conflicts
    -- included, at case scope (no gate named).
    'independentReview', get_case_assurance_position(c.id, null),
    -- §44 "assumptions": the ONE assumption store, scoped to this case.
    'assumptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'statement', a.statement, 'status', a.status,
        'confidence', a.confidence, 'validUntil', a.valid_until,
        'triggerForReview', a.trigger_for_review,
        'invalidationReason', a.invalidation_reason,
        'owner', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = a.owner_id))
        order by case a.status when 'invalidated' then 0 when 'expired' then 1 else 2 end, a.created_at desc)
      from risk_assumptions a
      where a.organization_id = v_org and a.development_case_id = c.id), '[]'::jsonb),
    -- §44 "open issues": the case's own unresolved matters, from the shipped
    -- stores. Risks come through the read policy, so a member who may not see
    -- a confidential risk does not see it here either.
    'openIssues', jsonb_build_object(
      'risks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'title', r.title, 'level', r.current_risk_level, 'status', r.status)
          order by case r.current_risk_level when 'Critical' then 0 else 1 end, r.title)
        from risks r
        where r.organization_id = v_org and r.development_case_id = c.id
          and r.current_risk_level in ('High','Critical')
          and r.status not in ('closed','archived','accepted')), '[]'::jsonb),
      'conditions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', gc.id, 'description', gc.description, 'dueDate', gc.due_date,
          'overdue', gc.due_date < current_date)
          order by gc.due_date)
        from gate_conditions gc
        join stage_gate_reviews rv on rv.id = gc.review_id
        where gc.organization_id = v_org and rv.development_case_id = c.id
          and gc.status = 'open'), '[]'::jsonb),
      'uncoveredCommitments',
        coalesce(get_case_commitment_coverage(c.id)->'uncoveredCommitments', '[]'::jsonb)),
    'evidenceConfidenceProfile', get_case_evidence_confidence(c.id)->'profile');
end
$$;

revoke all on function public.get_case_assurance_case(uuid) from public, anon;
grant execute on function public.get_case_assurance_case(uuid) to authenticated;

comment on function public.get_case_assurance_case(uuid) is
  'D13.06 / spec §44: claim → evidence → confidence for one development case, plus assumptions (the ONE assumption store), open issues (the shipped risk/condition/commitment stores) and the independent review (get_case_assurance_position). No confidence aggregate is invented; the spread and the unscored count are reported instead.';

notify pgrst, 'reload schema';
