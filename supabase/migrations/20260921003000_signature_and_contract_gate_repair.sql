-- ============================================================================
-- Five defects in the two governance gates shipped earlier on this branch.
--
-- An adversarial review of 20260921000000 and 20260921001000 against a real
-- PostgreSQL 16 cluster found that the direct-write path E4.06 closed is
-- genuinely closed — and that the machinery replacing it is not sound. Four of
-- the five findings are reachable today by any authenticated member of the
-- organisation. The fifth means the contract-gate strengthening that migration
-- 20260921000000 announced is not running at all.
--
-- 1. THE AUTHORITY CHECK FAILED OPEN ON A NULL ROLE.
--
--      if v_role is distinct from e.required_role
--         and v_role not in ('admin','ai_admin') then
--
--    With v_role NULL that is `TRUE and NULL` → NULL, the branch does not
--    fire, and the signature is written by an account with no role at all.
--    `user_profiles.role` is nullable with no CHECK. Reachability is
--    service-side only today, so this is latent — but it is the single
--    predicate the whole control rests on and it failed permissive. Same
--    three-valued-logic class `definerTenancy.test.ts` already documents.
--
-- 2. THE RPC SILENTLY OVERWROTE AN EXISTING SIGNATURE, AND AUDITED NOTHING.
--    `sign_engineering_review` never asked whether the row was already signed.
--    MissionControl only renders the form when it is not, but PostgREST does
--    not care and the function is granted to `authenticated`. A signature
--    could be re-attributed with no record that either act happened.
--
-- 3. RECLASSIFICATION STRIPPED THE SIGNATURE AND LEFT THE APPROVAL STANDING.
--    The clearing branch returned before any re-validation, and
--    `enforce_authority_limit` is BEFORE UPDATE **OF status**, so nothing
--    re-fired. Sign → approve → reclassify left an approved recommendation
--    with no engineering signature: a state the schema previously could not
--    represent, reachable by any org member.
--
-- 4. THE CONTROL WAS OPT-OUT BY THE PARTY IT CONSTRAINS. `change_class` sat
--    under the same `for all to authenticated` policy the signature columns
--    did, and `enforce_authority_limit` skips the engineering check entirely
--    when it is null. So E4.06 was not a gate a technician had to pass; it was
--    a flag a technician could clear. Pinned here the way 20260910090000 pins
--    `user_profiles.role` — the established idiom in this schema.
--
-- 5. THE CONTRACT GATE'S STRENGTHENING WAS NEVER IN THE ENFORCEMENT PATH.
--    20260921000000 added `contract_field_blank` and `contract_narrative_blank`
--    and rewrote `check_recommendation_contract` over them. But the live chain
--    is trg_recommendation_contract → enforce_recommendation_contract() →
--    recommendation_contract_gaps(NEW), and that last function — defined in
--    20260829093000 and never touched — still used plain `btrim(x) = ''`. A
--    row reading issue='TBD', rationale='n/a', consequence='none' was reported
--    NOT RELEASABLE by the preflight and approved by the trigger.
--
--    The comment on `contract_field_blank` says it was "placed here so the
--    release gate and the posture report cannot drift apart". They drifted in
--    the same migration that said so, in the fail-open direction.
--
-- Canonical reuse: recommendations, engineering_approval_rules,
-- security_events and its recorder shape from 00000000000018,
-- contract_field_blank/contract_narrative_blank from 20260921000000,
-- app_current_org(), user_profiles. No new table, no new grant.
--
-- NOTHING HERE IS A LOOSENING except the deliberate service-path exemption in
-- §1, which is argued in place and audited.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The provenance trigger: pin the class, keep approval and signature
--    consistent, and admit an audited service path.
--
-- ON THE SERVICE PATH. The previous version refused `postgres` and
-- `service_role` as well as clients. That reads stricter and is not: a holder
-- of the service key can `alter table ... disable trigger` in the same
-- breath, so refusing it bought no security while guaranteeing that any
-- restore, backfill or future migration touching these three columns aborts,
-- and leaving no way at all to correct a wrongly recorded signature. The
-- exemption is therefore `auth.uid() is null` — this schema's established
-- idiom (20260910090000, 20260825143000) — and every service-side signature
-- write lands in security_events so it is attributable rather than silent.
-- The customer-facing claim is unchanged and exact: no client can forge one.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_engineering_signature_provenance()
returns trigger
language plpgsql
-- SECURITY INVOKER on purpose: a DEFINER trigger reports its own owner as
-- current_user whoever fired it, which makes the client-role check below a
-- tautology that still reads like a check.
as $$
declare
  v_marker text := coalesce(
    current_setting('app.engineering_signature_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_changed boolean;
begin
  if tg_op = 'UPDATE' and new.change_class is distinct from old.change_class then
    -- (a) Immutable once the decision has been taken, for everyone. Otherwise
    --     sign → approve → reclassify yields an approved recommendation whose
    --     signature answered a different question, or none at all.
    if old.status in ('approved', 'released', 'scheduled') then
      raise exception
        'This recommendation is already %. Its engineering change class cannot be '
        'changed now: the approval was given against class %, and re-classifying '
        'underneath it would leave an approved change with no engineering basis. '
        'Withdraw the approval first.',
        old.status, coalesce(old.change_class, 'none')
        using errcode = 'check_violation';
    end if;

    -- (b) Never by a client. enforce_authority_limit skips the engineering
    --     check when change_class is null, so a writable change_class is an
    --     off switch on E4.06 held by the party E4.06 constrains.
    --
    --     RECORDED, THEN NEUTRALISED — the shape 20260910090000 uses for
    --     user_profiles.role, and for two reasons rather than consistency
    --     alone. `raise` would abort the transaction and take the audit row
    --     down with it, so a hard refusal here buys an error message at the
    --     price of the evidence. And the audit must be written through
    --     record_security_event(): this trigger is SECURITY INVOKER by design,
    --     so a direct insert runs as `authenticated` and is refused by
    --     security_events' own RLS — which is how the first cut of this
    --     migration failed, reporting an RLS violation on the audit table
    --     instead of the rule that was actually broken.
    if v_client then
      perform record_security_event(
        'access_denied',
        'Blocked client-side change of recommendations.change_class on '
          || old.id::text || ' — ' || coalesce(old.change_class, 'none')
          || ' to ' || coalesce(new.change_class, 'none')
          || '. Clearing the class disables the engineering sign-off requirement.',
        'critical');
      new.change_class := old.change_class;
      return new;
    end if;

    -- (c) Service-side, before approval: the sign-off was given about the old
    --     class, so it does not survive. Discarding a signature is itself an
    --     act worth seeing, and the early return used to skip the audit below.
    if old.engineering_signed_at is not null then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (old.organization_id, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Engineering signature on recommendation ' || old.id::text
           || ' discarded: change class moved ' || coalesce(old.change_class, 'none')
           || ' to ' || coalesce(new.change_class, 'none')
           || '. The sign-off answered a question about the old class.');
      new.engineering_signed_by := null;
      new.engineering_signed_at := null;
      new.engineering_note := null;
      return new;
    end if;
  end if;

  if tg_op = 'INSERT' then
    v_changed := new.engineering_signed_by is not null
              or new.engineering_signed_at is not null
              or nullif(btrim(coalesce(new.engineering_note, '')), '') is not null;
  else
    v_changed := new.engineering_signed_by is distinct from old.engineering_signed_by
              or new.engineering_signed_at is distinct from old.engineering_signed_at
              or new.engineering_note is distinct from old.engineering_note;
  end if;

  if not v_changed then
    return new;
  end if;

  -- The audited service path. Restores and backfills insert freely; an UPDATE
  -- that moves a signature is recorded, because that is the act worth seeing.
  if not v_client and current_user not in ('authenticated', 'anon') then
    if tg_op = 'UPDATE' then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (new.organization_id, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Engineering signature on recommendation ' || new.id::text
           || ' written by a service caller, bypassing sign_engineering_review(). '
           || 'Was ' || coalesce(old.engineering_signed_by::text, 'unsigned')
           || ', now ' || coalesce(new.engineering_signed_by::text, 'unsigned') || '.');
    end if;
    return new;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'Engineering sign-off cannot be written directly. Call '
      'sign_engineering_review(recommendation_id, note), which verifies the '
      'caller holds the discipline the change class requires and records the '
      'basis. A signature asserted by the party it is meant to constrain is '
      'not a signature.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end
$$;

drop trigger if exists trg_engineering_signature_provenance on public.recommendations;
create trigger trg_engineering_signature_provenance
  before insert or update on public.recommendations
  for each row execute function public.enforce_engineering_signature_provenance();

-- ---------------------------------------------------------------------------
-- 2. The sanctioned path: closed against a NULL role, closed against silent
--    re-signing, and audited either way.
-- ---------------------------------------------------------------------------
create or replace function public.sign_engineering_review(
  p_recommendation_id uuid,
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
  r recommendations%rowtype;
  e engineering_approval_rules%rowtype;
begin
  select role into v_role from user_profiles where id = auth.uid();

  select * into r from recommendations
  where id = p_recommendation_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'recommendation not found');
  end if;
  if r.change_class is null then
    return jsonb_build_object('error', 'this recommendation carries no engineering change class');
  end if;

  -- A signature is not overwritable. Re-attributing one silently is worse than
  -- refusing to, and the only correction path is now the audited service path.
  if r.engineering_signed_at is not null then
    return jsonb_build_object('error',
      format('already signed on %s. A signature is not overwritable: withdraw it '
             || 'before recording another, so both acts appear in the record.',
             to_char(r.engineering_signed_at, 'YYYY-MM-DD HH24:MI')));
  end if;

  select * into e from engineering_approval_rules
  where organization_id = v_org and change_class = r.change_class;
  if not found then
    return jsonb_build_object('error', 'no engineering rule for change class ' || r.change_class);
  end if;

  -- coalesce, NOT bare `not in`: a NULL role made this `TRUE and NULL` → NULL,
  -- the branch never fired, and an account with no role signed as an engineer.
  if coalesce(v_role, '') is distinct from e.required_role
     and coalesce(v_role, '') not in ('admin', 'ai_admin') then
    return jsonb_build_object('error',
      format('%s requires sign-off by the %s role', e.title, e.required_role));
  end if;
  if coalesce(length(trim(p_note)), 0) < 20 then
    return jsonb_build_object('error',
      'record the engineering basis for this sign-off (20 characters minimum)');
  end if;

  -- Local to this transaction. It cannot leak into the next statement on the
  -- same connection, which matters on a pooled PostgREST connection.
  perform set_config('app.engineering_signature_write', 'granted', true);

  update recommendations
  set engineering_signed_by = auth.uid(), engineering_signed_at = now(),
      engineering_note = trim(p_note)
  where id = p_recommendation_id;

  perform set_config('app.engineering_signature_write', '', true);

  -- Signing is an act of authority. It leaves a record whether or not anyone
  -- is watching the panel that shows it.
  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     'Engineering sign-off recorded on recommendation ' || p_recommendation_id::text
       || ' for change class ' || r.change_class || ' as role '
       || coalesce(v_role, 'none') || '.');

  return jsonb_build_object(
    'signed', p_recommendation_id,
    'change_class', r.change_class,
    'signed_by_role', v_role,
    'required_role', e.required_role
  );
end
$$;

revoke execute on function public.sign_engineering_review(uuid, text) from public;
grant execute on function public.sign_engineering_review(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Put the strengthened blank-checks into the path that actually enforces.
--
-- Identical field set, identical messages, identical order to 20260829093000.
-- The only change is what counts as present — which is the change
-- 20260921000000 claimed to have made and made only to the preflight.
-- ---------------------------------------------------------------------------
create or replace function public.recommendation_contract_gaps(r recommendations)
returns text[]
language sql immutable set search_path = public as $$
  select array_remove(array[
    case when r.asset_id is null
      then 'asset and functional location (C8.11)' end,
    case when public.contract_field_blank(r.issue)
      then 'current condition or problem (C8.12)' end,
    case when public.contract_field_blank(r.rationale)
      then 'evidence used (C8.13)' end,
    case when public.contract_field_blank(r.action)
      then 'recommended action (C8.16)' end,
    case when r.confidence is null
      then 'confidence and uncertainty (C8.19)' end,
    case when public.contract_narrative_blank(r.consequence_summary)
      then 'consequence — safety, environmental, production, financial (C8.15): approving without it is a judgement about cost with the benefit left blank' end,
    case when public.contract_narrative_blank(r.alternatives_considered)
      then 'alternatives considered (C8.17): without it an approver cannot tell a recommendation from the only idea anybody had' end,
    case when r.required_completion_date is null
      then 'required completion date (C8.18): "soon" is not schedulable and can never be overdue' end,
    case when public.contract_field_blank(r.required_approver_role)
      then 'required approver (C8.20): unstated, it defaults to whoever happens to be looking' end,
    case when public.contract_narrative_blank(r.verification_method)
      then 'verification method (C8.21): without it the loop never closes and this returns next year' end
  ], null);
$$;

notify pgrst, 'reload schema';
