-- ============================================================================
-- Sync Develop Slice 1 — the ONE evidence model (D11.17 / D11.18, overlap-map
-- ruling 3).
--
-- Ruling 3 is binding here: `evidence_items` (00000000000001:178, already
-- extended by the ROS at 20260921110101:441) IS the canonical evidence store
-- — AGENTS.md invariant 3, one evidence model. This file adds the spec §9
-- typed columns TO it. The `ria_*` evidence grades stay assessment-scoped
-- consumers and `recovery_field_evidence` stays field capture feeding it;
-- neither is touched. A new Evidence table is forbidden and none is created.
--
-- What lands on evidence_items:
--   * evidence_class — the eight §9 provenance classes (MEASURED, INSPECTED,
--     CALCULATED, TESTED, DOCUMENTED, HISTORICAL, EXPERT_JUDGEMENT,
--     AI_INFERENCE). NULLABLE, deliberately: the pre-existing rows were
--     recorded before the classification existed, and inventing a class for
--     them would be fabricated provenance (register standing constraint 1).
--     They render as "unclassified"; new writes through record_case_evidence
--     must state a class.
--   * verification_status ('unverified' | 'verified' | 'rejected') with the
--     recorded human verification beside it: verified_by, verified_at,
--     verification_method, verification_note.
--   * revision, applicability (spec §9), document_id → kb_intake_documents
--     (C2.15 ✅ — the ONE document intake rail; no second upload path),
--     development_case_id → development_cases (the Develop binding gate
--     criteria consume).
--
-- THE SPEC'S HARDEST RULE SHIPS HERE, IN THE SAME MIGRATION (D11.18,
-- Invariant lane): "An AI inference must never silently become verified
-- evidence." Two independent layers enforce it:
--
--   1. A named CHECK — a row cannot BE verified without verified_by,
--      verified_at and a non-blank verification_method. True for every
--      class: a "verified" flag with no verifier is the same defect the
--      register's demotion history is made of.
--   2. enforce_evidence_verification_provenance, a BEFORE trigger in the
--      post-fix engineering-signature idiom (20261005090300, copied from the
--      #282 repair, not from the spec): SECURITY INVOKER; transaction-local
--      marker set only by verify_evidence_item; client writes to the
--      verification columns refused with a pointer to the sanctioned path;
--      the SERVICE path admitted AND audited for insert, update and delete
--      (an unaudited service UPDATE flipping one row to 'verified' — or a
--      DELETE erasing a verified row — is exactly the "silently" this rule
--      exists to kill); BEFORE DELETE returns OLD; NULL-safe throughout.
--      For AI_INFERENCE specifically the incomplete-record refusal fires for
--      EVERY caller, marker or service included, mirroring the D3.15
--      promotion-invariant posture (20261101090400): a restore re-INSERTs
--      complete rows and passes; nothing passes without the recorded human.
--
-- Verification itself is a HUMAN act: verify_evidence_item refuses the
-- ai_admin identity by name. The LLM prepares and explains; it does not
-- verify (spec §70 posture applied to evidence).
--
-- Existing writers are untouched by construction: ingest_risk_evidence,
-- record_risk_value_of_information, persist_inspection_recommendation and the
-- demo seed insert rows that never carry verification state, so the trigger's
-- v_changed gate passes them through unchanged.
--
-- RLS: the restrictive case-scoped write policy copies the ROS's own
-- sensitivity idiom verbatim (20260921110102:1515 — "risk-linked mutations
-- remain security-definer RPC-only"): case-linked evidence arrives through
-- the RPC, while legacy non-case writes continue exactly as before.
-- ============================================================================

alter table public.evidence_items
  add column if not exists evidence_class text
    check (evidence_class is null or evidence_class in
      ('MEASURED','INSPECTED','CALCULATED','TESTED','DOCUMENTED',
       'HISTORICAL','EXPERT_JUDGEMENT','AI_INFERENCE')),
  add column if not exists verification_status text not null default 'unverified'
    check (verification_status in ('unverified','verified','rejected')),
  add column if not exists verified_by uuid references auth.users(id),
  add column if not exists verified_at timestamptz,
  add column if not exists verification_method text,
  add column if not exists verification_note text,
  add column if not exists revision text,
  add column if not exists applicability text,
  add column if not exists document_id uuid references kb_intake_documents(id) on delete set null,
  add column if not exists development_case_id uuid references development_cases(id) on delete set null;

-- A verification determination that names nobody is not a determination.
-- Both terminal states carry who/when/how — 'rejected' is as much a recorded
-- human judgement as 'verified'.
alter table public.evidence_items
  drop constraint if exists evidence_verification_recorded;
alter table public.evidence_items
  add constraint evidence_verification_recorded check (
    verification_status = 'unverified'
    or (verified_by is not null
        and verified_at is not null
        and btrim(coalesce(verification_method, '')) <> '')
  );

create index if not exists idx_evidence_case
  on evidence_items(organization_id, development_case_id)
  where development_case_id is not null;
create index if not exists idx_evidence_verification
  on evidence_items(organization_id, verification_status)
  where verification_status <> 'unverified';

-- Case-linked evidence writes are definer-RPC-only (the ROS restrictive
-- idiom, 20260921110102). Reads stay org-wide; the risk-sensitivity
-- restrictive policy continues to apply independently. Three per-command
-- restrictive policies rather than one `for all` (the established
-- `_ext_no_ins/upd/del` shape, 20260920002000): a `for all ... using(true)
-- with check(<link> is null)` guards only the NEW row, so a client can still
-- clear a non-null link — `UPDATE ... SET development_case_id = NULL` passes
-- the check and silently severs the row from the case its gates were judged
-- against, unaudited. Splitting the guard closes that: INSERT refuses a client
-- writing a case-linked row; UPDATE and DELETE refuse a client TOUCHING a
-- case-linked row at all (the `using (development_case_id is null)` makes the
-- linked row invisible to a client mutation), so unlink, re-point and delete
-- are all definer-RPC-only. SELECT carries no restrictive policy here, so the
-- workspace read (SECURITY INVOKER) still sees case evidence; FK cascades
-- bypass RLS, so `on delete set null` from a removed case is unaffected.
drop policy if exists evidence_items_case_scoped on public.evidence_items;
create policy evidence_items_case_scoped on public.evidence_items as restrictive
  for insert to authenticated
  with check (development_case_id is null);
drop policy if exists evidence_items_case_no_upd on public.evidence_items;
create policy evidence_items_case_no_upd on public.evidence_items as restrictive
  for update to authenticated
  using (development_case_id is null)
  with check (development_case_id is null);
drop policy if exists evidence_items_case_no_del on public.evidence_items;
create policy evidence_items_case_no_del on public.evidence_items as restrictive
  for delete to authenticated
  using (development_case_id is null);

-- ---------------------------------------------------------------------------
-- The verification provenance trigger (D11.18). SECURITY INVOKER on purpose:
-- a DEFINER trigger reports its own owner as current_user whoever fired it,
-- which would make the client-role check a tautology (20261005090100).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_evidence_verification_provenance()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.evidence_verification_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_changed boolean;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
begin
  if tg_op = 'INSERT' then
    v_changed := new.verification_status <> 'unverified'
              or new.verified_by is not null
              or new.verified_at is not null
              or nullif(btrim(coalesce(new.verification_method, '')), '') is not null
              or nullif(btrim(coalesce(new.verification_note, '')), '') is not null;
  elsif tg_op = 'DELETE' then
    -- Deleting a verified row erases the record of the verification.
    v_changed := old.verification_status = 'verified';
  else
    v_changed := new.verification_status is distinct from old.verification_status
              or new.verified_by is distinct from old.verified_by
              or new.verified_at is distinct from old.verified_at
              or new.verification_method is distinct from old.verification_method
              or new.verification_note is distinct from old.verification_note;
  end if;

  if not v_changed then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- THE HARDEST RULE, FOR EVERY CALLER — marker and service included, the
  -- D3.15 promotion-invariant posture: an AI_INFERENCE row never reaches
  -- 'verified' without the recorded human (who, when, method). A restore
  -- re-INSERTs complete rows and passes; nothing passes incomplete. The
  -- named CHECK above backs this for all classes; this branch exists so the
  -- AI-specific rule is refused with its own name.
  if tg_op in ('INSERT','UPDATE')
     and new.evidence_class = 'AI_INFERENCE'
     and new.verification_status = 'verified'
     and (new.verified_by is null
          or new.verified_at is null
          or btrim(coalesce(new.verification_method, '')) = '') then
    raise exception
      'An AI inference never silently becomes verified evidence (spec §9, D11.18): '
      'verified status on an AI_INFERENCE row requires the recorded human '
      'verification — verified_by, verified_at and verification_method.'
      using errcode = 'check_violation';
  end if;

  -- Audited service path: admitted for every operation, audited for every
  -- operation (20261005090300 §1's argument — refusing the service key buys
  -- nothing; a holder can disable the trigger, so the honest posture is
  -- admit-and-record). The org-exists guard keeps organization teardown from
  -- inserting an audit row that references the organization being removed.
  if not v_client and current_user not in ('authenticated', 'anon') then
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         case tg_op
           when 'INSERT' then
             'Evidence item ' || new.id::text
               || ' inserted already carrying verification state by a service caller, '
               || 'bypassing verify_evidence_item(). Status '
               || coalesce(new.verification_status, 'none') || '.'
           when 'DELETE' then
             'Verified evidence item ' || old.id::text
               || ' deleted by a service caller — the verification record it carried is erased.'
           else
             'Verification state on evidence item ' || new.id::text
               || ' written by a service caller, bypassing verify_evidence_item(). Was '
               || coalesce(old.verification_status, 'none') || ', now '
               || coalesce(new.verification_status, 'none') || '.'
         end);
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'Evidence verification is a recorded human determination. It cannot be written '
      'directly: call verify_evidence_item(evidence_id, method, ...), which records '
      'who verified, when, and by what method. A verification asserted by an '
      'unchecked write is not a verification.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_evidence_verification_provenance on public.evidence_items;
create trigger trg_evidence_verification_provenance
  before insert or update or delete on public.evidence_items
  for each row execute function public.enforce_evidence_verification_provenance();

revoke all on function public.enforce_evidence_verification_provenance() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Provenance-laundering guard (D11.18, the second layer). The verification
-- trigger above refuses an AI_INFERENCE row reaching 'verified' without the
-- recorded human — but it decides on evidence_class AT THE INSTANT a
-- verification column moves. evidence_class itself must therefore be frozen
-- ONCE a determination is recorded, or the guard is defeated sideways:
--
--     class MEASURED, unverified  ->  verify_evidence_item() records a human
--     (who believes it MEASURED)  ->  UPDATE evidence_class = 'AI_INFERENCE'
--
-- leaves an AI_INFERENCE row 'verified' that no human ever examined AS an AI
-- inference — the exact silent verification the rule exists to kill. A
-- SEPARATE BEFORE UPDATE trigger (deliberately not folded into the
-- verification trigger, so that trigger's AI-check-before-service ordering
-- contract stays byte-identical): SECURITY INVOKER; a class change on a
-- verified or rejected row is refused for clients (real or RLS-bypassed) and
-- admitted-AND-audited for the true service path; a class correction while the
-- row is still 'unverified', and every non-class edit, pass straight through.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_evidence_class_immutability()
returns trigger
language plpgsql
as $$
declare
  v_client boolean := auth.uid() is not null;
  v_org uuid := new.organization_id;
begin
  -- Frozen only once a human determination exists, and only when the class
  -- actually moves. Everything else — inserts, corrections while unverified,
  -- verification writes, non-class edits — is none of this trigger's business.
  if new.evidence_class is not distinct from old.evidence_class
     or old.verification_status = 'unverified' then
    return new;
  end if;

  -- True service path (auth.uid() null, not the authenticated/anon roles):
  -- admitted AND audited, the same posture the sibling trigger takes — a key
  -- holder can disable the trigger, so the honest answer is admit-and-record,
  -- never a refusal that buys nothing.
  if not v_client and current_user not in ('authenticated', 'anon') then
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Evidence item ' || new.id::text || ' reclassified '
           || coalesce(old.evidence_class, 'unclassified') || ' -> '
           || coalesce(new.evidence_class, 'unclassified')
           || ' by a service caller after it was ' || old.verification_status
           || ' — the provenance class the human determination was recorded '
           || 'against has been changed.');
    end if;
    return new;
  end if;

  raise exception
    'Evidence class is frozen once a determination is recorded (spec §9, D11.18): '
    'this item is % and its provenance class cannot be changed. Reclassifying a '
    'verified item would launder an AI inference into verified evidence no human '
    'examined as one — record a NEW evidence item if the basis changed.',
    old.verification_status
    using errcode = 'check_violation';
end
$$;

drop trigger if exists trg_evidence_class_immutability on public.evidence_items;
create trigger trg_evidence_class_immutability
  before update on public.evidence_items
  for each row execute function public.enforce_evidence_class_immutability();

revoke all on function public.enforce_evidence_class_immutability() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Case evidence intake — the ONE store gains a case-scoped write path,
-- mirroring ingest_risk_evidence (20260921110101:1433) with the §9 typed
-- fields. Any org member may RECORD evidence (capture is not a governed
-- determination — verification is); the class is mandatory here because this
-- path exists after the classification does.
-- ---------------------------------------------------------------------------
create or replace function public.record_case_evidence(
  p_case_id uuid,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_id uuid;
  v_class text := p_evidence->>'evidence_class';
  v_document uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_class is null or v_class not in
     ('MEASURED','INSPECTED','CALCULATED','TESTED','DOCUMENTED',
      'HISTORICAL','EXPERT_JUDGEMENT','AI_INFERENCE') then
    return jsonb_build_object('error',
      'evidence_class must be one of the eight §9 provenance classes (MEASURED, INSPECTED, CALCULATED, TESTED, DOCUMENTED, HISTORICAL, EXPERT_JUDGEMENT, AI_INFERENCE)');
  end if;
  if coalesce(length(btrim(p_evidence->>'description')), 0) < 10 then
    return jsonb_build_object('error', 'evidence states what it evidences (10 characters minimum)');
  end if;
  if coalesce(btrim(p_evidence->>'source_system'), '') = '' then
    return jsonb_build_object('error', 'source system is required — evidence without a source is an assertion');
  end if;
  v_document := nullif(p_evidence->>'document_id','')::uuid;
  if v_document is not null and not exists (
    select 1 from kb_intake_documents d
    where d.id = v_document and d.organization_id = v_org
  ) then
    return jsonb_build_object('error',
      'document not found in this organization''s intake register — ingest it through the knowledge-base intake first (kb_ingest_document)');
  end if;

  insert into evidence_items (
    organization_id, development_case_id, source_system, evidence_type,
    description, data_quality, ts, signal_kind, source_reference, provenance,
    evidence_class, revision, applicability, document_id
  ) values (
    v_org, c.id, btrim(p_evidence->>'source_system'),
    coalesce(nullif(btrim(coalesce(p_evidence->>'evidence_type','')), ''), lower(v_class)),
    btrim(p_evidence->>'description'),
    coalesce(nullif(btrim(coalesce(p_evidence->>'data_quality','')), ''), 'unknown'),
    coalesce(nullif(p_evidence->>'observed_at','')::timestamptz, now()),
    'development_case',
    nullif(btrim(coalesce(p_evidence->>'source_reference','')), ''),
    coalesce(p_evidence->'provenance', '{}'::jsonb),
    v_class,
    nullif(btrim(coalesce(p_evidence->>'revision','')), ''),
    nullif(btrim(coalesce(p_evidence->>'applicability','')), ''),
    v_document
  ) returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_evidence',
    coalesce((select role from user_profiles where id = auth.uid()), 'unknown'),
    jsonb_build_object('case_id', c.id, 'evidence_id', v_id,
      'evidence_class', v_class, 'document_id', v_document));

  return jsonb_build_object('evidence_id', v_id, 'case_id', c.id,
    'evidence_class', v_class, 'verification_status', 'unverified');
end
$$;

revoke all on function public.record_case_evidence(uuid, jsonb) from public, anon;
grant execute on function public.record_case_evidence(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The sanctioned verification path. Roles: governance/engineering. The
-- ai_admin identity is refused BY NAME — a human verifies; the LLM prepares.
-- A terminal status is not overwritable: re-examination of changed reality is
-- a NEW evidence item, not a rewrite of what was determined.
-- ---------------------------------------------------------------------------
create or replace function public.verify_evidence_item(
  p_evidence_id uuid,
  p_method text,
  p_outcome text default 'verified',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  e evidence_items%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    if coalesce(v_role, '') = 'ai_admin' then
      return jsonb_build_object('error',
        'evidence verification is a recorded human determination — the AI-operator identity cannot verify evidence');
    end if;
    return jsonb_build_object('error', 'verifying evidence requires a governance or engineering role');
  end if;
  select * into e from evidence_items where id = p_evidence_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evidence item not found');
  end if;
  if e.verification_status <> 'unverified' then
    return jsonb_build_object('error',
      format('this evidence is already %s — a verification determination is not overwritable; record a new evidence item if the basis changed', e.verification_status));
  end if;
  if p_outcome not in ('verified','rejected') then
    return jsonb_build_object('error', 'outcome must be verified or rejected');
  end if;
  if coalesce(length(btrim(p_method)), 0) < 5 then
    return jsonb_build_object('error',
      'state the verification method — how this evidence was checked (5 characters minimum)');
  end if;

  -- The sanctioned write. Local marker: cannot outlive this transaction.
  perform set_config('app.evidence_verification_write', 'granted', true);

  update evidence_items
  set verification_status = p_outcome,
      verified_by = auth.uid(),
      verified_at = now(),
      verification_method = btrim(p_method),
      verification_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = e.id;

  perform set_config('app.evidence_verification_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'evidence_verification', coalesce(v_role, 'unknown'),
    jsonb_build_object('evidence_id', e.id, 'outcome', p_outcome,
      'method', btrim(p_method), 'evidence_class', e.evidence_class,
      'case_id', e.development_case_id, 'risk_id', e.risk_id));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Evidence %s %s (%s) by role %s, method: %s.',
            e.id, p_outcome, coalesce(e.evidence_class, 'unclassified'),
            coalesce(v_role, 'none'), btrim(p_method)));

  return jsonb_build_object('evidence_id', e.id,
    'verification_status', p_outcome, 'verified_by', auth.uid());
end
$$;

revoke all on function public.verify_evidence_item(uuid, text, text, text) from public, anon;
grant execute on function public.verify_evidence_item(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
