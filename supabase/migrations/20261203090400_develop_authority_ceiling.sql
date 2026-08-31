-- ============================================================================
-- Sync Develop Slice 4D (5 of 5) — THE MONEY CEILING ITSELF.
--
-- REVIEW REPAIR. Slice 4D is the change that turns `authority_limits` from a
-- table that gates a recommendation into a table that gates SPENDING: it adds
-- the `contingency_drawdown` and `change_approval` action types, and
-- `sync_contingency_authority` reads `max_commitment_usd` as the sole
-- quantitative gate on drawing owner capital out of a project fund. Three
-- things about that store were acceptable while it governed recommendations
-- and are not acceptable now that it governs money. Each is fixed here rather
-- than named as a residual, because each one is reachable and each one moves
-- money:
--
--   4D-R29. THE CEILING HAD NO AUTHORING SURFACE AT ALL. `adopt_authority_limit`
--       takes no amount; `authority_limits` has only a read policy; the 4D
--       seeds deliberately leave `max_commitment_usd` null and R2 makes a null
--       ceiling REFUSE. So out of the box every drawdown refused for ever, the
--       refusal's own remediation ("record max_commitment_usd on the
--       delegation") was impossible through the product, and the CI smoke had
--       to set it with a raw psql UPDATE. The one number standing between a
--       delegated role and the whole fund was authored entirely outside every
--       wall this slice builds. `state_authority_ceiling` is that door.
--
--   4D-R30. THE CEILING HAD NO WALL AND NO AUDIT. `authority_limits` carried
--       zero triggers. The pool and the ledger were both hardened against
--       exactly this class in 20261203090000 ("a superuser UPDATE moved a pool
--       from $1M to $9M with every trigger firing") — and the THIRD number in
--       the same arithmetic was unguarded: `update authority_limits set
--       max_commitment_usd = 250000000` succeeded with security_events and
--       audit_events both unchanged, and a drawdown taken under the silently
--       raised ceiling was then recorded on an IMMUTABLE ledger quoting that
--       ceiling as if it had been checked.
--
--   4D-R31. §70: THE AI IDENTITY COULD ADOPT THE MONEY LADDER.
--       `adopt_authority_limit` admits `role in ('admin','ai_admin','executive')`.
--       4D refuses `ai_admin` at every door and on every row it owns — and then
--       let the AI identity adopt the very instrument that decides who may
--       spend. Because adoption supersedes the currently-adopted row for the
--       same (role_key, action_type, org_node_id), the AI could also retire a
--       live money ladder by adopting a null-ceiling draft. Spec §70 says no AI
--       or system identity may commit funds or approve a change; choosing who
--       may is the same act one level up.
--
--   4D-R32. SELF-ADOPTION. An executive could adopt a ceiling for their own
--       `role_key` and then spend under it. That is a delegation nobody
--       delegated. Adopting or re-stating the ceiling of the role you hold is
--       refused for the money action types.
--
-- Nothing here forks the authority family: same table, same selection rule,
-- same adoption verb. The overlap-map ruling is that baseline-anchored change
-- control rides the EXISTING machinery, and the money ceiling is part of it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE WALL (4D-R30). Covers INSERT, UPDATE and DELETE, and TRUNCATE at
--    statement level because a row trigger never fires for TRUNCATE.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_authority_limit_wall()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The dual-caller gate is auth.uid(), NOT current_user: inside a SECURITY
  -- DEFINER function current_user is the function OWNER, so a membership test
  -- against the authenticated/anon role names is dead code that never fires
  -- (20261130090700 repaired thirteen of them).
  v_client boolean := auth.uid() is not null;
  v_org uuid;
  v_money boolean;
  v_slice4d boolean;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'authority_limits is the delegation instrument every contingency drawdown and every change approval is checked against. Truncating it removes every stated ceiling in one statement — after which R1 refuses every act, and the record of what anybody was ever permitted to commit is gone.'
      using errcode = 'insufficient_privilege';
  end if;

  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  -- §70 and the service audit cover EVERY delegation that commits capital.
  v_money := coalesce(
    case when tg_op = 'DELETE' then old.action_type else new.action_type end, '')
    in ('contingency_drawdown','change_approval','sanction');
  -- The STRUCTURAL walls (no un-adoption, no deletion of an adopted row) are
  -- NEW obligations and are scoped to the action types Slice 4D introduces.
  -- `sanction` is §41's instrument, adopted and reset by transcripts that
  -- predate this slice; retroactively freezing its lifecycle is a governance
  -- decision about §41, not about 4D, and belongs to whoever owns that area.
  -- RESIDUAL, named rather than silently assumed: an adopted SANCTION or
  -- gate-requirement-waiver ladder can still have its ceiling rewritten or be
  -- returned to draft by a SERVICE caller. Those instruments are adopted and
  -- reset by §41/§43 transcripts that predate this slice and depend on that
  -- behaviour; freezing them is a change to those areas, and it is recorded
  -- here as an open gap rather than closed by editing their transcripts.
  -- Slice 4D's own two action types are frozen.
  v_slice4d := coalesce(
    case when tg_op = 'DELETE' then old.action_type else new.action_type end, '')
    in ('contingency_drawdown','change_approval');

  -- An ADOPTED money ladder is not edited in place. Its ceiling, its role, its
  -- action type and its scope are what a recorded spend was checked against,
  -- and a ledger entry quoting a ceiling that was raised afterwards is a
  -- fabricated authority. A new number is a NEW draft, adopted — which
  -- supersedes rather than rewrites, so the history stays readable.
  if tg_op = 'UPDATE'
     and v_slice4d
     and old.status = 'adopted'
     and (new.max_commitment_usd is distinct from old.max_commitment_usd
          or new.max_commitment_currency is distinct from old.max_commitment_currency
          or new.max_risk_level is distinct from old.max_risk_level
          or new.role_key is distinct from old.role_key
          or new.action_type is distinct from old.action_type
          or new.org_node_id is distinct from old.org_node_id
          or new.organization_id is distinct from old.organization_id) then
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
      'the ceiling, role, action type and scope of an ADOPTED delegation cannot be rewritten by ANY caller, service paths included. Every recorded drawdown and every approved change quotes the ceiling it was checked against; a ceiling that can move afterwards makes all of them unfalsifiable. State a new ceiling as a new draft and adopt it — adoption supersedes, it does not overwrite.'
      using errcode = 'insufficient_privilege';
  end if;

  -- AN ADOPTED MONEY DELEGATION DOES NOT UN-ADOPT. The only status it may
  -- leave `adopted` for is `superseded`, which is what adopting a replacement
  -- does — and which leaves the history readable. Silently returning a live
  -- ladder to `draft` would retire the instrument every recorded spend was
  -- checked against while leaving those spends quoting it.
  if tg_op = 'UPDATE' and v_slice4d
     and old.status = 'adopted' and new.status not in ('adopted','superseded') then
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
      'an adopted delegation of spending authority is SUPERSEDED by adopting a replacement, never returned to draft. Recorded drawdowns and approvals quote the instrument they were checked against; un-adopting it in place leaves them citing an authority the organization no longer holds.'
      using errcode = 'insufficient_privilege';
  end if;

  -- A money delegation that has ever been ADOPTED is never deleted: recorded
  -- spends reference the row they were checked against. A pure DRAFT enforces
  -- nothing, grants nothing and can be referenced by nothing, so removing one
  -- is admitted (and, from a service caller, audited).
  if tg_op = 'DELETE' then
    if v_slice4d and (old.status <> 'draft' or old.adopted_by is not null) then
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
        'a delegation covering money (contingency drawdown, change approval or sanction) that has been adopted is not deleted — recorded spends and approvals reference the row they were checked against, and removing it detaches every one of them from the authority it claimed. Supersede it instead.'
        using errcode = 'insufficient_privilege';
    end if;
    if v_money and not v_client and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values (v_org, null, 'service (' || current_user || ')',
        'admin_action', 'warning',
        'A DRAFT money delegation (' || old.action_type || ', role ' || old.role_key
          || ') was deleted by a service caller. A draft enforces nothing and is '
          || 'referenced by nothing, so this is admitted and recorded.');
    end if;
    return old;
  end if;

  -- §70 ON THE ROW (4D-R31). Not only in adopt_authority_limit's door.
  if v_money and new.adopted_by is not null
     and exists (select 1 from user_profiles up
                  where up.id = new.adopted_by and up.role = 'ai_admin') then
    raise exception
      'this delegation of spending authority is adopted by the AI-operator identity. Spec §70 forbids an AI or system identity from committing funds or approving a change; choosing who may do so is the same act one level up.'
      using errcode = 'check_violation';
  end if;

  -- A stated ceiling is finite and non-negative, whoever writes it. NaN and the
  -- infinities are legal numerics and pass every inequality vacuously.
  if new.max_commitment_usd is not null
     and (new.max_commitment_usd < 0
          or new.max_commitment_usd = 'NaN'::numeric
          or new.max_commitment_usd = 'Infinity'::numeric
          or new.max_commitment_usd = '-Infinity'::numeric) then
    raise exception
      'a delegation ceiling must be a finite amount of at least zero. NaN and infinity are legal numeric values in Postgres and would pass every ceiling test vacuously — a ceiling of NaN is not an unlimited delegation, it is an unusable one.'
      using errcode = 'check_violation';
  end if;

  if not v_client and v_money and exists (select 1 from organizations where id = v_org) then
    insert into security_events
      (organization_id, actor_id, actor_label, event_type, severity, detail)
    values (v_org, null, 'service (' || current_user || ')',
      'admin_action', 'warning',
      'A delegation covering money was ' || lower(tg_op) || 'd by a service caller ('
        || new.action_type || ', role ' || new.role_key || '). This is the instrument '
        || 'every contingency drawdown and change approval is checked against (D5.18/D5.30).');
  end if;

  return new;
end
$$;

revoke all on function public.enforce_authority_limit_wall() from public, anon, authenticated;

drop trigger if exists trg_authority_limit_wall on public.authority_limits;
create trigger trg_authority_limit_wall
  before insert or update or delete on public.authority_limits
  for each row execute function public.enforce_authority_limit_wall();

drop trigger if exists trg_authority_limit_no_truncate on public.authority_limits;
create trigger trg_authority_limit_no_truncate
  before truncate on public.authority_limits
  for each statement execute function public.enforce_authority_limit_wall();

revoke truncate on table public.authority_limits from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. ADOPTION, HARDENED (4D-R31 + 4D-R32). Re-issued from its 20261121090500
--    definition with the §70 and self-adoption refusals added and the audit
--    trail it never had. The scope-keyed supersession rule (D3.32) is carried
--    forward verbatim.
-- ---------------------------------------------------------------------------
create or replace function public.adopt_authority_limit(
  p_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l authority_limits%rowtype;
  v_role text;
  v_money boolean;
  v_superseded int;
begin
  select role into v_role from user_profiles where id = auth.uid();
  -- Adopting a delegation of authority is itself an act of authority.
  if v_role not in ('admin', 'ai_admin', 'executive') then
    return jsonb_build_object('error',
      'adopting a delegation-of-authority limit requires an executive or administrator');
  end if;

  select * into l from authority_limits
  where id = p_id and organization_id = app_current_org();
  if not found then
    return jsonb_build_object('error', 'limit not found');
  end if;

  -- §70 covers every delegation that commits capital, sanction included.
  v_money := l.action_type in ('contingency_drawdown','change_approval','sanction');
  -- The self-adoption and stated-ceiling rules are NEW obligations and are
  -- scoped to the action types Slice 4D introduces. Widening them to `sanction`
  -- would retroactively invalidate the adopted sanction delegation every
  -- pre-4D transcript rests on, which is a different decision from this one and
  -- belongs to whoever owns §41.

  -- 4D-R31. §70 at the door as well as on the row.
  if v_money and v_role = 'ai_admin' then
    return jsonb_build_object('error', format(
      'adopting a %s delegation decides who may commit the owner''s capital. Spec §70 forbids an AI or system identity from committing funds or approving a change, and choosing who may do so is the same act one level up. The AI may prepare the delegation instrument and its basis; a human executive or administrator adopts it.',
      l.action_type));
  end if;
  -- 4D-R32. You do not delegate to yourself.
  if l.action_type in ('contingency_drawdown','change_approval')
     and l.role_key = v_role then
    return jsonb_build_object('error', format(
      'this delegation grants %s the authority to commit funds, and %s is the role you hold. Adopting your own ceiling is not a delegation — nobody delegated it. Route it to another executive or an administrator.',
      l.role_key, v_role));
  end if;
  if l.status <> 'draft' then
    return jsonb_build_object('error', 'only drafts can be adopted');
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    return jsonb_build_object('error',
      'state the delegation instrument this limit comes from (10 characters minimum)');
  end if;
  -- R2, enforced at adoption rather than only at the act: adopting a money
  -- ladder with no stated ceiling installs an instrument that refuses every
  -- drawdown, which reads to the organization as the feature being broken.
  if l.action_type in ('contingency_drawdown','change_approval')
     and l.max_commitment_usd is null then
    return jsonb_build_object('error', format(
      'this %s delegation states no money ceiling. A blank ceiling on a fund is an unfinished delegation, not an unlimited one, and adopting it would install an instrument under which every drawdown refuses. State the ceiling first (state_authority_ceiling).',
      l.action_type));
  end if;

  update authority_limits
  set status = 'superseded', superseded_by = l.id
  where organization_id = l.organization_id and role_key = l.role_key
    and action_type = l.action_type
    -- D3.32 (20261121090500, marked insertion): a node-scoped delegation
    -- supersedes its own scope only — adopting a site limit must not
    -- silently retire the org-wide one, nor the reverse.
    and org_node_id is not distinct from l.org_node_id
    and status = 'adopted';
  get diagnostics v_superseded = row_count;

  update authority_limits
  set status = 'adopted', adopted_by = auth.uid(), adopted_at = now(),
      basis = basis || ' | Adopted: ' || trim(p_note)
  where id = l.id;

  -- The audit trail adoption never had. Who now holds what authority, and what
  -- it replaced, is exactly the kind of act audit_events exists for.
  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (l.organization_id, 'authority_limit', coalesce(v_role, 'system'),
    jsonb_build_object('limit_id', l.id, 'action_type', l.action_type,
      'role_key', l.role_key, 'org_node_id', l.org_node_id,
      'superseded_count', v_superseded),
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'adopted', 'adopted_by', auth.uid(),
      'max_commitment', l.max_commitment_usd,
      'max_commitment_currency', l.max_commitment_currency,
      'max_risk_level', l.max_risk_level, 'note', trim(p_note)));

  return jsonb_build_object('adopted', l.id, 'role_key', l.role_key,
    'action_type', l.action_type, 'ceiling', l.max_commitment_usd,
    'ceilingCurrency', l.max_commitment_currency, 'superseded', v_superseded);
end
$$;

revoke all on function public.adopt_authority_limit(uuid, text) from public, anon, service_role;
grant execute on function public.adopt_authority_limit(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE CEILING-STATING DOOR (4D-R29).
--
--    States the money ceiling and its CURRENCY on a DRAFT delegation. Never on
--    an adopted one: the wall above refuses that for every caller, and it is
--    refused here as a sentence rather than reaching the exception. A changed
--    ceiling is a new draft, and `draft_authority_ceiling` mints one from an
--    adopted row so the organization can raise or lower a live delegation
--    without a DBA.
-- ---------------------------------------------------------------------------
create or replace function public.state_authority_ceiling(
  p_id uuid,
  p_ceiling jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  l authority_limits%rowtype;
  v_amount numeric;
  v_currency text := upper(btrim(coalesce(p_ceiling->>'currency', 'USD')));
  v_basis text := btrim(coalesce(p_ceiling->>'basis', ''));
  v_risk text := nullif(btrim(coalesce(p_ceiling->>'max_risk_level', '')), '');
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'stating how much a role may commit is stating how much of the owner''s capital an individual may spend without further approval. Spec §70 forbids an AI or system identity from making that determination. The AI may propose a ceiling and its basis; a human executive or administrator states it.');
  end if;
  if coalesce(v_role, '') not in ('admin','executive') then
    return jsonb_build_object('error',
      'stating a delegation ceiling requires an executive or administrator');
  end if;

  select * into l from authority_limits where id = p_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'delegation not found');
  end if;
  if l.status <> 'draft' then
    return jsonb_build_object('error', format(
      'delegation %s is %s. A ceiling is stated on a DRAFT and then adopted: every recorded drawdown and approval quotes the ceiling it was checked against, so an adopted ceiling that could be edited would make all of them unfalsifiable. Draft a replacement (draft_authority_ceiling) and adopt it — adoption supersedes.',
      l.id, l.status));
  end if;
  -- 4D-R32 at this door too: you do not state your own spending ceiling.
  if l.action_type in ('contingency_drawdown','change_approval')
     and l.role_key = v_role then
    return jsonb_build_object('error', format(
      'this delegation grants %s the authority to commit funds, and %s is the role you hold. Stating your own ceiling is not a delegation. Route it to another executive or an administrator.',
      l.role_key, v_role));
  end if;

  v_amount := sync_finite_money(p_ceiling->>'max_commitment');
  if v_amount is null or v_amount < 0 then
    return jsonb_build_object('error', format(
      'the ceiling is %s; it must be a finite amount of at least zero. NaN and infinity are legal numeric values in Postgres and pass every ceiling test vacuously, so they are refused before the number reaches the delegation.',
      coalesce(nullif(btrim(coalesce(p_ceiling->>'max_commitment', '')), ''), 'absent')));
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('error',
      'state the currency of the ceiling as a three-letter code (for example CAD). A ceiling is an amount IN a currency: Sync holds no exchange rate and refuses to compare a fund in one currency to a ceiling in another.');
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object('error',
      'record the delegation instrument this ceiling comes from (20 characters minimum). A number with no stated instrument behind it is not a delegation, it is a preference.');
  end if;
  if v_risk is not null and v_risk not in ('Low','Medium','High','Critical') then
    return jsonb_build_object('error',
      'the risk ceiling is one of Low, Medium, High, Critical');
  end if;

  update authority_limits
     set max_commitment_usd = v_amount,
         max_commitment_currency = v_currency,
         max_risk_level = coalesce(v_risk, max_risk_level),
         basis = basis || ' | Ceiling stated: ' || v_basis
   where id = l.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'authority_limit', v_role,
    jsonb_build_object('limit_id', l.id, 'action_type', l.action_type,
      'role_key', l.role_key),
    jsonb_build_object('max_commitment', l.max_commitment_usd,
      'max_commitment_currency', l.max_commitment_currency,
      'max_risk_level', l.max_risk_level, 'status', l.status),
    jsonb_build_object('max_commitment', v_amount,
      'max_commitment_currency', v_currency,
      'max_risk_level', coalesce(v_risk, l.max_risk_level),
      'status', 'draft', 'basis', v_basis));

  return jsonb_build_object('limit_id', l.id, 'action_type', l.action_type,
    'role_key', l.role_key, 'ceiling', v_amount, 'currency', v_currency,
    'maxRiskLevel', coalesce(v_risk, l.max_risk_level), 'status', 'draft',
    'next', 'adopt_authority_limit');
end
$$;

revoke all on function public.state_authority_ceiling(uuid, jsonb) from public, anon, service_role;
grant execute on function public.state_authority_ceiling(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. DRAFTING A REPLACEMENT. Copies an existing delegation into a new DRAFT so
--    a live ceiling can be raised or lowered through the product. The draft
--    enforces nothing and grants nothing until it is adopted, and adoption
--    supersedes the row it replaces rather than editing it.
-- ---------------------------------------------------------------------------
create or replace function public.draft_authority_ceiling(
  p_id uuid,
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
  l authority_limits%rowtype;
  v_new uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'drafting a delegation of spending authority is the first step of stating who may commit the owner''s capital. Spec §70 reserves that to a human.');
  end if;
  if coalesce(v_role, '') not in ('admin','executive') then
    return jsonb_build_object('error',
      'drafting a delegation requires an executive or administrator');
  end if;
  if length(btrim(coalesce(p_note, ''))) < 20 then
    return jsonb_build_object('error',
      'state why this delegation is being redrafted (20 characters minimum)');
  end if;

  select * into l from authority_limits where id = p_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'delegation not found');
  end if;
  if exists (select 1 from authority_limits d
              where d.organization_id = v_org and d.role_key = l.role_key
                and d.action_type = l.action_type
                and d.org_node_id is not distinct from l.org_node_id
                and d.status = 'draft') then
    return jsonb_build_object('error',
      'a draft already exists for this role, action type and scope. State its ceiling and adopt it, rather than accumulating drafts nobody can tell apart.');
  end if;

  insert into authority_limits
    (organization_id, role_key, tier_label, action_type, org_node_id,
     max_commitment_usd, max_commitment_currency, max_risk_level,
     escalates_to_role, basis, status)
  values (l.organization_id, l.role_key, l.tier_label, l.action_type, l.org_node_id,
     null, l.max_commitment_currency, l.max_risk_level,
     l.escalates_to_role,
     'Redrafted from ' || l.id || ': ' || btrim(p_note), 'draft')
  returning id into v_new;

  return jsonb_build_object('draft_id', v_new, 'from', l.id,
    'role_key', l.role_key, 'action_type', l.action_type,
    'next', 'state_authority_ceiling');
end
$$;

revoke all on function public.draft_authority_ceiling(uuid, text) from public, anon, service_role;
grant execute on function public.draft_authority_ceiling(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE READ. The delegations this caller's organization holds, so a screen
--    can state a ceiling instead of a DBA doing it. Org-scoped from the
--    session — it takes NO organization argument, which is the shape
--    definerTenancy.test.ts requires of anything client-callable.
-- ---------------------------------------------------------------------------
create or replace function public.get_authority_delegations(p_action_type text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_rows jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', al.id, 'roleKey', al.role_key, 'tierLabel', al.tier_label,
      'actionType', al.action_type, 'status', al.status,
      'orgNodeId', al.org_node_id, 'version', al.version,
      'maxCommitment', al.max_commitment_usd,
      'maxCommitmentCurrency', al.max_commitment_currency,
      'maxRiskLevel', al.max_risk_level,
      'escalatesToRole', al.escalates_to_role,
      'basis', al.basis,
      'adoptedBy', (select email from user_profiles up where up.id = al.adopted_by),
      'adoptedAt', al.adopted_at,
      'isMyRole', al.role_key = v_role,
      -- Refusal-first: a delegation with no stated ceiling is not an unlimited
      -- one, and the screen says which it is.
      'ceilingRefusal', case when al.max_commitment_usd is null then
        'This delegation states no money ceiling. Under R2 a blank ceiling REFUSES every act it governs — it is an unfinished delegation, not an unlimited one. State the ceiling before adopting it.' end,
      'selfAdoptionRefusal', case
        when al.action_type in ('contingency_drawdown','change_approval')
             and al.role_key = v_role then
        'This delegation grants the role you hold. You may not state or adopt your own spending ceiling — nobody delegated it. Route it to another executive or an administrator.' end)
      order by al.action_type, al.role_key, al.version desc), '[]'::jsonb)
    into v_rows
  from authority_limits al
  where al.organization_id = v_org
    and (p_action_type is null or al.action_type = p_action_type);

  return jsonb_build_object(
    'delegations', v_rows,
    'callerRole', v_role,
    'canState', v_role in ('admin','executive'),
    'refusal', case when jsonb_array_length(v_rows) = 0 then
      'This organization holds no delegation of authority of this kind. Until one is adopted with a stated ceiling, every contingency drawdown and every change approval REFUSES: "nobody has said how much you may spend" is not permission to spend.' end,
    'note',
      'A ceiling is stated on a DRAFT and then adopted. An adopted delegation is never edited: every recorded drawdown and every approved change quotes the ceiling it was checked against, so a ceiling that could move afterwards would make all of them unfalsifiable. Redraft and adopt — adoption supersedes.');
end
$$;

revoke all on function public.get_authority_delegations(text) from public, anon, service_role;
grant execute on function public.get_authority_delegations(text) to authenticated;
