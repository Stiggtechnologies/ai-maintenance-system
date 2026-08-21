-- ============================================================================
-- E4.06 — the engineering signature stops being forgeable.
--
-- WHAT WAS ACTUALLY WRONG.
--
-- 20260809140000 built the engineering-approval control properly: four seeded
-- rules, a required discipline per change class, `sign_engineering_review()`
-- that checks the caller holds that discipline and demands a 20-character
-- basis, and a trigger that refuses approval of a classed recommendation
-- while `engineering_signed_at` is null.
--
-- Then it put `engineering_signed_by`, `engineering_signed_at` and
-- `engineering_note` on `recommendations`, a table governed by
--
--   create policy recommendations_org_rw on recommendations
--     for all to authenticated
--     using (organization_id = app_current_org())
--     with check (organization_id = app_current_org())   -- 00000000000001:488
--
-- The only narrowing since (20260912123000) is restrictive against `board` and
-- `supervisor` alone. So every other role — planner, technician, operator,
-- executive — could satisfy the entire control with one PostgREST call:
--
--   PATCH /rest/v1/recommendations?id=eq.<id>
--   { "engineering_signed_by": "<own uid>", "engineering_signed_at": "now()" }
--
-- No discipline check, no basis, no audit of who actually assessed it. And
-- `sign_engineering_review` has ZERO callers anywhere in the application, so
-- the forged path was not merely available — it was the ONLY path. A control
-- that can be satisfied by asserting its own output is not a control.
--
-- WHY A TRIGGER AND NOT A POLICY.
--
-- This has to compare the new signature against the old one, and RLS cannot:
-- `USING` sees OLD, `WITH CHECK` sees NEW, and no policy sees both. Column
-- privileges cannot express it either — revoking UPDATE on the three columns
-- from `authenticated` would also block the definer RPC, which runs as its
-- owner but would still need the grant re-plumbed, and it would silently allow
-- an INSERT that arrives pre-signed.
--
-- HOW THE LEGITIMATE PATH IS DISTINGUISHED.
--
-- Two conditions, both required:
--
--   1. a transaction-local marker that ONLY sign_engineering_review() sets,
--      via set_config(..., is_local => true), so it cannot outlive the
--      statement that set it; and
--   2. `current_user` is not one of the PostgREST client roles. Inside a
--      SECURITY DEFINER function current_user is the function's owner, and on
--      a REST request it is `authenticated` or `anon`.
--
-- The trigger function is deliberately SECURITY INVOKER. A DEFINER trigger
-- would report its own owner as current_user no matter who fired it, which
-- would quietly turn condition 2 into a tautology. It needs no privileges of
-- its own: it reads NEW and OLD and raises.
--
-- Condition 1 alone would rest on `set_config` being unreachable from a REST
-- client; condition 2 alone would trust any definer function in the schema,
-- present or future, not to touch these columns. Together, a forgery needs
-- both a role the client does not have and a marker only one function sets.
--
-- AND THE SIGNATURE NO LONGER SURVIVES A RECLASSIFICATION.
--
-- `sign_engineering_review` validates the caller's discipline against the
-- recommendation's change_class AT THE MOMENT OF SIGNING. Nothing stopped the
-- class being changed afterwards, so a reliability engineer's signature on a
-- `pm_interval_change` silently became a signature on whatever it was moved
-- to. The trigger now clears the signature when the class changes, which is
-- the honest outcome: the sign-off was given for a different question.
--
-- Canonical reuse: recommendations, engineering_approval_rules,
-- sign_engineering_review(), app_current_org(), user_profiles. No new table.
-- Additive: nothing is granted, one path is removed and the sanctioned one is
-- left intact.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The provenance trigger.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_engineering_signature_provenance()
returns trigger
language plpgsql
-- SECURITY INVOKER on purpose: see the header. current_user must reflect who
-- is really writing, not who owns this function.
as $$
declare
  v_marker text := coalesce(
    current_setting('app.engineering_signature_write', true), '');
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_changed := new.engineering_signed_by is not null
              or new.engineering_signed_at is not null
              or nullif(btrim(coalesce(new.engineering_note, '')), '') is not null;
  else
    -- A reclassification invalidates the sign-off rather than inheriting it:
    -- the discipline check was answered about the OLD class.
    if new.change_class is distinct from old.change_class
       and old.engineering_signed_at is not null
       and v_marker <> 'granted' then
      new.engineering_signed_by := null;
      new.engineering_signed_at := null;
      new.engineering_note := null;
      return new;
    end if;

    v_changed := new.engineering_signed_by is distinct from old.engineering_signed_by
              or new.engineering_signed_at is distinct from old.engineering_signed_at
              or new.engineering_note is distinct from old.engineering_note;
  end if;

  if not v_changed then
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
-- 2. The sanctioned path, unchanged in its checks, now marking itself.
--
-- Identical authority logic to 20260809140000: the caller's role must be the
-- discipline the change class names (admin and ai_admin excepted, as that
-- migration decided), and the basis must be at least 20 characters. The only
-- additions are the marker the trigger looks for, and returning the signing
-- role so a caller can render who signed rather than assume.
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

  select * into e from engineering_approval_rules
  where organization_id = v_org and change_class = r.change_class;
  if not found then
    return jsonb_build_object('error', 'no engineering rule for change class ' || r.change_class);
  end if;
  if v_role is distinct from e.required_role and v_role not in ('admin', 'ai_admin') then
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

  return jsonb_build_object(
    'signed', p_recommendation_id,
    'change_class', r.change_class,
    'signed_by_role', v_role,
    'required_role', e.required_role
  );
end
$$;

grant execute on function public.sign_engineering_review(uuid, text) to authenticated;

-- The trigger must be reachable by whoever fires it, and it is SECURITY
-- INVOKER — but trigger functions are executed by the system rather than
-- called, so no grant is required. Left explicit so a reader does not add one.

notify pgrst, 'reload schema';
