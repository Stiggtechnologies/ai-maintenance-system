-- E4.06 — a producer for recommendations.change_class.
--
-- The engineering gate in enforce_authority_limit already refuses approval
-- while a classified recommendation is unsigned, and sign_engineering_review
-- is already the only writer of the signature columns. Both were idle:
-- enforce_engineering_signature_provenance pins change_class against every
-- client UPDATE, and no function assigned it, so the approval branch never
-- fired.
--
-- Canonical reuse: recommendations, engineering_approval_rules,
-- enforce_engineering_signature_provenance, audit_events, security_events,
-- app_current_org(), user_profiles. No new table, queue, or approval model.
-- The rule text is not adopted here and no threshold is invented.
--
-- Classification is a named-human act. It records which existing rule applies.
-- It does not sign, approve, change an interval or limit, substitute a
-- material, or authorize work. ai_admin is refused by name.

create or replace function public.enforce_engineering_signature_provenance()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(
    current_setting('app.engineering_signature_write', true), '');
  v_class_marker text := coalesce(
    current_setting('app.engineering_class_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_class_granted boolean := v_class_marker = 'granted'
    and current_user not in ('authenticated', 'anon');
  v_changed boolean;
begin
  -- Snapshot the statement's signature write BEFORE this trigger rewrites
  -- anything. A later clear, performed because the class moved, is this
  -- trigger's own act and must not be judged as a forged signature.
  if tg_op = 'INSERT' then
    v_changed := new.engineering_signed_by is not null
              or new.engineering_signed_at is not null
              or nullif(btrim(coalesce(new.engineering_note, '')), '') is not null;
  else
    v_changed := new.engineering_signed_by is distinct from old.engineering_signed_by
              or new.engineering_signed_at is distinct from old.engineering_signed_at
              or new.engineering_note is distinct from old.engineering_note;
  end if;

  if tg_op = 'INSERT'
     and new.change_class is not null
     and v_client
     and not v_class_granted then
    perform record_security_event(
      'access_denied',
      'Blocked client-side assignment of recommendations.change_class on insert. '
        || 'Call classify_recommendation_change(recommendation_id, change_class, basis), '
        || 'which checks the caller holds the discipline the rule names.',
      'critical');
    new.change_class := null;
  end if;

  if tg_op = 'UPDATE' and new.change_class is distinct from old.change_class then
    if old.status in ('approved', 'released', 'scheduled') then
      raise exception
        'This recommendation is already %. Its engineering change class cannot be '
        'changed now: the approval was given against class %, and re-classifying '
        'underneath it would leave an approved change with no engineering basis. '
        'Withdraw the approval first.',
        old.status, coalesce(old.change_class, 'none')
        using errcode = 'check_violation';
    end if;

    if v_class_granted then
      -- The sanctioned classifier may move the class. A signature recorded
      -- against the previous class does not survive that move, unless this
      -- same statement is itself a signature write (that path is judged below).
      if old.engineering_signed_at is not null and not v_changed then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values
          (old.organization_id, auth.uid(), 'classify_recommendation_change',
           'admin_action', 'warning',
           'Engineering signature on recommendation ' || old.id::text
             || ' discarded: change class moved ' || coalesce(old.change_class, 'none')
             || ' to ' || coalesce(new.change_class, 'none')
             || '. The sign-off answered a question about the old class.');
        new.engineering_signed_by := null;
        new.engineering_signed_at := null;
        new.engineering_note := null;
      end if;
    elsif v_client then
      perform record_security_event(
        'access_denied',
        'Blocked client-side change of recommendations.change_class on '
          || old.id::text || ' — ' || coalesce(old.change_class, 'none')
          || ' to ' || coalesce(new.change_class, 'none')
          || '. Clearing the class disables the engineering sign-off requirement.',
        'critical');
      -- A statement that also writes a signature must still reach the refusal
      -- below. Returning here would persist that signature after the class pin.
      new.change_class := old.change_class;
      if not v_changed then
        return new;
      end if;
    elsif old.engineering_signed_at is not null then
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

comment on function public.enforce_engineering_signature_provenance() is
  'Pins recommendation engineering signatures and change classes. A client write is refused or neutralised. classify_recommendation_change is the only client path that may set the class, via a transaction-local marker.';

create or replace function public.classify_recommendation_change(
  p_recommendation_id uuid,
  p_change_class text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  r public.recommendations%rowtype;
  e public.engineering_approval_rules%rowtype;
  v_class text := btrim(coalesce(p_change_class, ''));
  v_basis text := btrim(coalesce(p_basis, ''));
  v_written text;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'authentication required');
  end if;

  select role into v_role
  from public.user_profiles
  where id = auth.uid() and organization_id = v_org;

  if coalesce(v_role, '') = '' then
    return jsonb_build_object('error', 'named tenant member required');
  end if;
  if v_role = 'ai_admin' then
    return jsonb_build_object(
      'error',
      'the AI-operator identity cannot classify an engineering change'
    );
  end if;

  select * into r
  from public.recommendations
  where id = p_recommendation_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'recommendation not found');
  end if;

  if r.status in ('approved', 'released', 'scheduled') then
    return jsonb_build_object(
      'error',
      'this recommendation is already ' || r.status
        || ' and its engineering change class cannot be changed'
    );
  end if;

  if v_class = '' or length(v_basis) < 20 then
    return jsonb_build_object(
      'error',
      'name the engineering change class and record why it applies (20 characters minimum)'
    );
  end if;

  select * into e
  from public.engineering_approval_rules
  where organization_id = v_org
    and change_class = v_class
    and status is distinct from 'superseded';
  if not found then
    return jsonb_build_object(
      'error',
      'no engineering rule for change class ' || v_class
    );
  end if;

  -- The discipline the rule names classifies the change. Admin may classify
  -- because the existing signature path already admits that role. ai_admin
  -- was refused above and is not an admin bypass.
  if coalesce(v_role, '') is distinct from e.required_role
     and coalesce(v_role, '') is distinct from 'admin' then
    return jsonb_build_object(
      'error',
      format('%s is classified by the %s role', e.title, e.required_role)
    );
  end if;

  if r.change_class is not distinct from v_class then
    return jsonb_build_object(
      'recommendation_id', r.id,
      'change_class', r.change_class,
      'required_role', e.required_role,
      'rule_status', e.status,
      'classified_by_role', v_role,
      'unchanged', true
    );
  end if;

  perform set_config('app.engineering_class_write', 'granted', true);

  update public.recommendations
  set change_class = v_class
  where id = r.id and organization_id = v_org;
  if not found then
    perform set_config('app.engineering_class_write', '', true);
    return jsonb_build_object('error', 'recommendation not found');
  end if;

  perform set_config('app.engineering_class_write', '', true);

  select change_class into v_written
  from public.recommendations
  where id = r.id and organization_id = v_org;
  if v_written is distinct from v_class then
    return jsonb_build_object(
      'error',
      'engineering change class was not recorded'
    );
  end if;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data
  ) values (
    v_org,
    'engineering_change_classification',
    v_role,
    jsonb_build_object(
      'recommendation_id', r.id,
      'from_class', r.change_class,
      'change_class', v_class,
      'required_role', e.required_role,
      'rule_status', e.status,
      'basis', v_basis,
      'classified_by', auth.uid(),
      'signature_cleared', r.engineering_signed_at is not null
    )
  );

  return jsonb_build_object(
    'recommendation_id', r.id,
    'change_class', v_class,
    'required_role', e.required_role,
    'rule_status', e.status,
    'classified_by_role', v_role,
    'unchanged', false,
    'signature_cleared', r.engineering_signed_at is not null
  );
end
$$;

revoke all on function public.classify_recommendation_change(uuid, text, text)
  from public, anon;
grant execute on function public.classify_recommendation_change(uuid, text, text)
  to authenticated;

comment on function public.classify_recommendation_change(uuid, text, text) is
  'Assigns recommendations.change_class from an existing engineering approval rule. Named-human, same-tenant, and role-checked. Does not sign or approve.';

notify pgrst, 'reload schema';
