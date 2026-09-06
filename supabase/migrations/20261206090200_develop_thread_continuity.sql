-- ============================================================================
-- Sync Develop Slice 5C — the digital thread, part 3:
--   D11.20  the continuity invariant — "the digital thread must never break"
--           (spec III.§26)
--
-- ── WHAT "BREAK" MEANS. THE DEFINITION EVERYTHING ELSE ENFORCES. ────────────
--
-- §26 says the thread "must never break" and does not define breaking, so this
-- file defines it, and the definition is deliberately narrow enough to be
-- ENFORCED rather than wide enough to be aspirational:
--
--   A BREAK is a state in which an object that WAS in the thread can no longer
--   be reached from the asset it hangs on, or in which the thread's own record
--   of itself is inconsistent. There are exactly four routes, and each one is
--   enforced at the database:
--
--   (1) ANCHOR LOSS. A thread object with no anchor, an anchor in another
--       tenant, or an anchor that has been deleted out from under it.
--       ENFORCED BY: `anchor_asset_id` NOT NULL (20261206090000);
--       the tenancy check in `enforce_thread_object_integrity`;
--       `enforce_asset_thread_anchor`, which refuses to delete an asset that
--       anchors LIVE thread objects, for every caller, service paths included;
--       `enforce_asset_thread_identity`, which refuses to MOVE an anchoring
--       asset to another organization — the same end state reached from the
--       asset's side rather than the object's, which the object-side check
--       alone cannot see; and the anchor-move guard, which refuses an anchor
--       that changes outside the recorded act or with nobody named on it.
--
--   (2) DANGLING LINK. A hop whose far end no longer exists, is retired, is in
--       another tenant, or is on another case.
--       ENFORCED BY: `enforce_thread_link_integrity` on INSERT and UPDATE —
--       both endpoints resolved, tenancy and case agreement checked, and a
--       LIVE link touching a RETIRED object refused outright.
--
--   (3) SILENT SEVERANCE. A DELETE of an object or a link, or an UPDATE that
--       re-points one, performed outside the recorded acts.
--       ENFORCED BY: DELETE refused on `thread_objects`, `thread_links`,
--       `thread_object_versions` and `thread_severances` for every caller;
--       TRUNCATE revoked and refused by statement triggers; the endpoint,
--       kind, ref and case columns immutable for every caller; and the status
--       columns movable only through the RPCs in this file.
--
--   (4) VERSION-CHAIN HOLE. Two authoritative versions of one object at once,
--       or a superseded version with no successor.
--       ENFORCED BY: the partial unique index `idx_thread_version_one_
--       authoritative` and the `thread_version_supersession` CHECK
--       (20261206090100).
--
-- ── WHERE A BREAK IS PERMITTED, AND WHAT MAKES IT NOT SILENT ────────────────
--
-- Three of these must sometimes be allowed, because the alternative is a
-- product that cannot delete a project or admit that a drawing was withdrawn.
-- Every one of those routes writes `thread_severances`:
--
--   object_retired     a person takes an object out of the thread, states why,
--                      and every live hop touching it is severed in the same
--                      transaction and counted.
--   link_severed       a person says one hop no longer holds, and states why.
--   object_reanchored  the object moves to a different asset; the ledger keeps
--                      the asset it used to hang from.
--   case_cascade       the development case was deleted. Permitted (refusing
--                      would make a case undeletable), recorded by the DELETE
--                      trigger on its way past.
--   asset_cascade      the anchoring asset was deleted and only RETIRED
--                      objects hung from it. A live object refuses the delete.
--                      ONE ledger row per affected development case, stamped
--                      with that case's id — a row written with a null case is
--                      recorded into a shape no read can return, which for the
--                      person looking afterwards is the same as silent.
--   canonical_cascade  the canonical row the object registered — its
--                      requirement or its acceptance test — was deleted, which
--                      happens when a capital project is. Refusing here would
--                      not protect the thread; it would make another family's
--                      table undeletable and report the reason as a sentence
--                      about digital-thread objects the operator never touched.
--
-- The one route that records nothing is the ORGANIZATION cascade, and that is
-- stated rather than hidden: when a tenant is deleted there is no reader left,
-- and a ledger row cannot be inserted against a foreign key that is going in
-- the same statement. `record_thread_severance` returns null there on purpose.
--
-- A recorded severance must also be READABLE, or the record is a formality.
-- The case-scoped read resolves its case first and so cannot return the
-- `case_cascade` rows — they exist because that case is gone — so the ledger
-- also has `get_org_thread_severances`, which resolves nothing and reports
-- `caseDeleted` on the rows whose case has been removed.
--
-- ── RULING 5C-R10 — CONTINUOUS IS NOT COMPLETE ─────────────────────────────
--
-- The invariant is NOT "every asset carries all ten kinds". That would either
-- be unsatisfiable (not every pump has a vendor document) or, far worse, would
-- teach an operator to invent one to clear a constraint. A thread that SKIPS
-- positions is legal and is REPORTED as a gap by `check_thread_continuity`.
--
-- The difference matters for D11.07: a skip is not a break, but it IS a gap,
-- and an impact traversal that meets one REFUSES rather than reporting the
-- subgraph it could reach as if it were the whole affected set.
--
-- ── RULING 5C-R11 — THE INVARIANT IS ENFORCED, AND ALSO REPORTED ────────────
--
-- `check_thread_continuity` is NOT the enforcement. Everything above is. The
-- report exists because a wall can only refuse the statements it sees, and
-- three things are outside that: rows written while triggers were disabled
-- (a superuser can), states that were legal when they were made and are gaps
-- now, and the D11.19 residual — requirements on the case that were never
-- registered in the CDE at all.
--
-- It therefore separates two lists, and the separation is the point:
--   `breaks` — states the walls say are impossible. A non-empty list here is
--              not a project problem, it is an INTEGRITY problem, and the read
--              says so in those words.
--   `gaps`   — states that are legal and incomplete. Chain skips, objects with
--              no released revision, requirements outside the CDE.
--
-- Reporting them in one list would let a real integrity failure hide among
-- forty missing vendor documents, which is how a broken invariant survives a
-- dashboard.
--
-- ── §70 ─────────────────────────────────────────────────────────────────────
--
-- Spec §70: no AI or system identity may sever a thread link. Retiring an
-- object severs every hop touching it and re-anchoring severs it from its
-- asset, so all three acts are the same act at different radii. Each refuses
-- the AI-operator identity AT THE DOOR (by role) and AT THE WALL (by the §70
-- triggers on `severed_by`, `retired_by` and `anchor_moved_by`, which fire for
-- every writer regardless of how the write arrived).
--
-- Canonical reuse: thread_objects, thread_links, thread_object_versions,
-- thread_severances, design_requirements, assets, audit_events,
-- security_events, app_current_org(), record_thread_severance.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Severing one hop.
-- ---------------------------------------------------------------------------
create or replace function public.sever_thread_link(
  p_link_id bigint,
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
  l thread_links%rowtype;
  up thread_objects%rowtype;
  dn thread_objects%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_severance bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'the AI-operator identity cannot sever a thread link (spec §70). Cutting the thread is a judgement about what no longer holds in the physical world, and the person who makes it is the person who will be asked why the downstream drawing was never updated.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'severing a digital-thread hop requires a planning, engineering or governance role');
  end if;
  select * into l from thread_links where id = p_link_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'thread link not found');
  end if;
  if l.status = 'severed' then
    return jsonb_build_object('error', 'this hop is already severed');
  end if;
  if length(v_reason) < 20 then
    return jsonb_build_object('error',
      'state why this hop no longer holds (20 characters minimum) — the reason is the whole of what survives a severance, and "the thread never broke silently" is only true if somebody can read why it broke');
  end if;
  select * into up from thread_objects where id = l.upstream_object_id;
  select * into dn from thread_objects where id = l.downstream_object_id;

  perform set_config('app.thread_sever_write', 'granted', true);
  update thread_links
     set status = 'severed',
         severance_reason = v_reason,
         severed_by = auth.uid(),
         severed_at = now()
   where id = l.id;
  perform set_config('app.thread_sever_write', '', true);

  v_severance := record_thread_severance(v_org, l.development_case_id,
    'link_severed', 'thread_link',
    format('%s → %s (%s)', up.object_ref, dn.object_ref, l.link_type),
    jsonb_build_object('link_id', l.id, 'link_type', l.link_type,
      'upstream_kind', up.object_kind, 'upstream_ref', up.object_ref,
      'downstream_kind', dn.object_kind, 'downstream_ref', dn.object_ref,
      'basis', l.basis),
    1, v_reason, auth.uid());

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'thread_link_severance', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', l.development_case_id, 'link_id', l.id,
      'severance_id', v_severance),
    jsonb_build_object('status', 'live', 'link_type', l.link_type,
      'upstream', up.object_ref, 'downstream', dn.object_ref),
    jsonb_build_object('status', 'severed', 'reason', v_reason,
      'severed_by', auth.uid()));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values (v_org, auth.uid(),
    (select coalesce(p.full_name, u.email) from auth.users u
       left join user_profiles p on p.id = u.id where u.id = auth.uid()),
    'admin_action', 'warning',
    format('Digital-thread hop %s → %s (%s) severed: %s',
      up.object_ref, dn.object_ref, l.link_type, v_reason));

  return jsonb_build_object(
    'link_id', l.id,
    'severance_id', v_severance,
    'upstreamRef', up.object_ref,
    'downstreamRef', dn.object_ref,
    'note', format('Severed and recorded. %s no longer reaches %s through this hop, and the continuity read will show that as a gap rather than pretending the thread still runs.',
      up.object_ref, dn.object_ref));
end
$$;

revoke all on function public.sever_thread_link(bigint, text) from public, anon;
grant execute on function public.sever_thread_link(bigint, text) to authenticated, service_role;

comment on function public.sever_thread_link(bigint, text) is
  'D11.20 / spec §26 + §70: the ONE recorded way to cut a hop of the digital thread. Refuses the AI-operator identity, demands a reason, writes thread_severances, audit_events and a warning security event. A severance is either refused or recorded — never quiet.';

-- ---------------------------------------------------------------------------
-- 2. Retiring an object — the same act at a larger radius.
-- ---------------------------------------------------------------------------
create or replace function public.retire_thread_object(
  p_object_id bigint,
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
  o thread_objects%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_links int := 0;
  v_authoritative text;
  v_severance bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'the AI-operator identity cannot retire a thread object (spec §70). Retiring severs every hop touching it, which is severing thread links at a larger radius.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'retiring a digital-thread object requires a planning, engineering or governance role');
  end if;
  select * into o from thread_objects where id = p_object_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'thread object not found');
  end if;
  if o.status = 'retired' then
    return jsonb_build_object('error', 'this object is already retired');
  end if;
  if length(v_reason) < 20 then
    return jsonb_build_object('error',
      'state why this object is out of the thread (20 characters minimum). Every hop touching it is about to be severed, and this sentence is what a reader will have instead of the hops.');
  end if;

  select version_label into v_authoritative from thread_object_versions
   where thread_object_id = o.id and status = 'authoritative';

  -- The hops go first, each one moved to `severed`, so no live link is ever
  -- left touching a retired object — which is D11.20's definition (2).
  perform set_config('app.thread_sever_write', 'granted', true);
  with cut as (
    update thread_links
       set status = 'severed',
           severance_reason = left('Object ' || o.object_ref || ' retired: ' || v_reason, 4000),
           severed_by = auth.uid(),
           severed_at = now()
     where organization_id = v_org
       and status = 'live'
       and (upstream_object_id = o.id or downstream_object_id = o.id)
    returning 1)
  select count(*)::int into v_links from cut;
  perform set_config('app.thread_sever_write', '', true);

  perform set_config('app.thread_retire_write', 'granted', true);
  update thread_objects
     set status = 'retired',
         retired_reason = v_reason,
         retired_by = auth.uid(),
         retired_at = now()
   where id = o.id;
  perform set_config('app.thread_retire_write', '', true);

  v_severance := record_thread_severance(v_org, o.development_case_id,
    'object_retired', 'thread_object',
    o.object_kind || ' ' || o.object_ref,
    jsonb_build_object('object_id', o.id, 'object_kind', o.object_kind,
      'object_ref', o.object_ref, 'title', o.title,
      'anchor_asset_id', o.anchor_asset_id,
      'authoritative_version', v_authoritative),
    v_links, v_reason, auth.uid());

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'thread_object_retirement', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', o.development_case_id, 'object_id', o.id,
      'object_ref', o.object_ref, 'severance_id', v_severance),
    jsonb_build_object('status', 'live', 'authoritative_version', v_authoritative),
    jsonb_build_object('status', 'retired', 'reason', v_reason,
      'links_severed', v_links, 'retired_by', auth.uid()));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values (v_org, auth.uid(),
    (select coalesce(p.full_name, u.email) from auth.users u
       left join user_profiles p on p.id = u.id where u.id = auth.uid()),
    'admin_action', 'warning',
    format('Digital-thread object %s %s retired, severing %s hop(s): %s',
      o.object_kind, o.object_ref, v_links, v_reason));

  return jsonb_build_object(
    'object_id', o.id,
    'severance_id', v_severance,
    'objectRef', o.object_ref,
    'linksSevered', v_links,
    'hadAuthoritativeVersion', v_authoritative is not null,
    'note', case when v_links = 0
      then 'Retired. It had no hops, so nothing else moved — but the retirement is still on the record, because an object that left the thread quietly is the thing §26 forbids.'
      else format('Retired, severing %s hop(s). Each severance carries this reason, and the continuity read now shows those routes as gaps rather than running through a retired object.', v_links) end);
end
$$;

revoke all on function public.retire_thread_object(bigint, text) from public, anon;
grant execute on function public.retire_thread_object(bigint, text) to authenticated, service_role;

comment on function public.retire_thread_object(bigint, text) is
  'D11.20 / spec §26 + §70: the ONE recorded way an object leaves the digital thread. Severs every live hop touching it in the same transaction (so no live link is ever left pointing at a retired object), records one severance carrying the count, and refuses the AI-operator identity.';

-- ---------------------------------------------------------------------------
-- 3. Moving the anchor.
-- ---------------------------------------------------------------------------
create or replace function public.reanchor_thread_object(
  p_object_id bigint,
  p_new_asset_id uuid,
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
  o thread_objects%rowtype;
  old_asset assets%rowtype;
  new_asset assets%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_severance bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'the AI-operator identity cannot move a thread object to a different asset (spec §70). The anchor is what the thread hangs from, and moving it is severing the object from one machine and attaching it to another.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'moving a digital-thread object to a different asset requires a planning, engineering or governance role');
  end if;
  select * into o from thread_objects where id = p_object_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'thread object not found');
  end if;
  if o.status = 'retired' then
    return jsonb_build_object('error',
      'that object is retired — it is out of the thread on the record, and re-anchoring it would put it back on a different asset without saying so');
  end if;
  if o.object_kind = 'installed_equipment' then
    return jsonb_build_object('error',
      'an `installed_equipment` object IS its asset. Re-anchoring it would make the object claim to be one machine and hang from another. Register a NEW installed-equipment object against the other asset, under the reference that machine actually carries — this one''s reference stays with this one, retired or not.');
  end if;
  select * into new_asset from assets where id = p_new_asset_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'that asset is not in this organization');
  end if;
  if new_asset.id = o.anchor_asset_id then
    return jsonb_build_object('error', 'this object already hangs from that asset');
  end if;
  if length(v_reason) < 20 then
    return jsonb_build_object('error',
      'state why the object belongs to a different asset (20 characters minimum) — the ledger keeps the asset it used to hang from, and this sentence is why it moved');
  end if;
  select * into old_asset from assets where id = o.anchor_asset_id;

  perform set_config('app.thread_reanchor_write', 'granted', true);
  update thread_objects
     set anchor_asset_id = new_asset.id,
         anchor_moved_by = auth.uid(),
         anchor_moved_at = now()
   where id = o.id;
  perform set_config('app.thread_reanchor_write', '', true);

  v_severance := record_thread_severance(v_org, o.development_case_id,
    'object_reanchored', 'thread_object',
    o.object_kind || ' ' || o.object_ref,
    jsonb_build_object('object_id', o.id, 'object_kind', o.object_kind,
      'object_ref', o.object_ref,
      'previous_anchor_asset_id', o.anchor_asset_id,
      'previous_anchor_asset_name', old_asset.name,
      'new_anchor_asset_id', new_asset.id,
      'new_anchor_asset_name', new_asset.name),
    0, v_reason, auth.uid());

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'thread_object_reanchor', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', o.development_case_id, 'object_id', o.id,
      'object_ref', o.object_ref, 'severance_id', v_severance),
    jsonb_build_object('anchor_asset_id', o.anchor_asset_id,
      'anchor_asset_name', old_asset.name),
    jsonb_build_object('anchor_asset_id', new_asset.id,
      'anchor_asset_name', new_asset.name, 'reason', v_reason,
      'anchor_moved_by', auth.uid()));

  -- The third §70 severance act gets the same security event as the other two.
  -- A monitor watching for thread cuts that saw sever_thread_link and
  -- retire_thread_object but not this one would be watching two of three doors.
  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values (v_org, auth.uid(),
    (select coalesce(p.full_name, u.email) from auth.users u
       left join user_profiles p on p.id = u.id where u.id = auth.uid()),
    'admin_action', 'warning',
    format('Digital-thread object %s %s moved from asset "%s" to "%s". %s',
      o.object_kind, o.object_ref,
      coalesce(old_asset.name, 'an asset that no longer exists'),
      new_asset.name, v_reason));

  return jsonb_build_object(
    'object_id', o.id,
    'severance_id', v_severance,
    'objectRef', o.object_ref,
    'previousAnchorAssetId', o.anchor_asset_id,
    'previousAnchorAssetName', old_asset.name,
    'anchorAssetId', new_asset.id,
    'anchorAssetName', new_asset.name,
    'note', format('Moved from "%s" to "%s", recorded. The ledger keeps the asset it used to hang from — an anchor that changed with no record is the break spec §26 forbids arriving as a one-line update.',
      coalesce(old_asset.name, 'an asset that no longer exists'), new_asset.name));
end
$$;

revoke all on function public.reanchor_thread_object(bigint, uuid, text) from public, anon;
grant execute on function public.reanchor_thread_object(bigint, uuid, text)
  to authenticated, service_role;

comment on function public.reanchor_thread_object(bigint, uuid, text) is
  'D11.19/D11.20: the ONE recorded way a thread object changes the asset it hangs from. Records the previous anchor in thread_severances, refuses the AI-operator identity, and refuses to move an `installed_equipment` object — that object IS its asset.';

-- ---------------------------------------------------------------------------
-- 4. THE INVARIANT, REPORTED (ruling 5C-R11).
-- ---------------------------------------------------------------------------
create or replace function public.check_thread_continuity(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_org uuid := app_current_org();
  c development_cases%rowtype;
  v_org uuid;
  v_objects int;
  v_live int;
  v_retired int;
  v_links int;
  v_live_links int;
  v_severed_links int;
  v_breaks jsonb := '[]'::jsonb;
  v_gaps jsonb := '[]'::jsonb;
  v_row record;
  v_n int;
  v_reqs_total int;
  v_reqs_registered int;
  v_severances int;
begin
  -- THE CLOSED GATE, deliberately, and NOT the wider service-read convention
  -- this repository carries in ten merged migrations
  -- (`auth.uid() is not null and app_current_org() is null` → forbidden, then a
  -- case lookup that degenerates to `true` for a null-uid caller). Every other
  -- read in this slice uses the closed form, and this one returns break details
  -- carrying object kinds and references verbatim — so under the wider gate a
  -- service key naming any case id reads that tenant's thread structure. The
  -- convention is not worth an intra-slice hole in the one read that describes
  -- where a thread is broken.
  if v_caller_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id
    and organization_id = v_caller_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  v_org := c.organization_id;

  select
    count(*)::int,
    count(*) filter (where status = 'live')::int,
    count(*) filter (where status = 'retired')::int
    into v_objects, v_live, v_retired
  from thread_objects where organization_id = v_org and development_case_id = c.id;

  select count(*)::int into v_reqs_total
    from design_requirements d
   where d.organization_id = v_org and d.development_case_id = c.id;
  select count(distinct t.requirement_id)::int into v_reqs_registered
    from thread_objects t
   where t.organization_id = v_org and t.development_case_id = c.id
     and t.requirement_id is not null;

  -- ── THE EMPTY-THREAD REFUSAL ─────────────────────────────────────────────
  -- An unmapped thread has no broken links for the same reason an unmapped
  -- plant has no single points of failure, and both read as good news.
  if v_objects = 0 then
    return jsonb_build_object(
      'caseId', c.id,
      'refused', true,
      'intact', null,
      'objectCount', 0,
      'requirementCount', v_reqs_total,
      'requirementsRegistered', 0,
      'breaks', '[]'::jsonb,
      'gaps', '[]'::jsonb,
      'refusal',
        format('No object on this case is registered in the Common Data Environment, so there is no thread to check. This is a REFUSAL, not a clean bill: "0 breaks, 0 dangling links, 0 version holes" over an empty register is indistinguishable from a perfectly maintained thread, and it would be read as one. %s',
          case when v_reqs_total > 0
            then format('This case has %s requirement(s) and none of them is in the CDE — register them first (spec II.2).', v_reqs_total)
            else 'This case has no requirements either.' end));
  end if;

  select count(*)::int,
         count(*) filter (where status = 'live')::int,
         count(*) filter (where status = 'severed')::int
    into v_links, v_live_links, v_severed_links
  from thread_links where organization_id = v_org and development_case_id = c.id;

  select count(*)::int into v_severances
    from thread_severances where organization_id = v_org and development_case_id = c.id;

  -- ── BREAKS: states the walls say cannot exist. ───────────────────────────
  -- (1) ANCHOR LOSS — an anchor that is missing or in another tenant.
  for v_row in
    select t.id, t.object_kind, t.object_ref, t.anchor_asset_id
      from thread_objects t
      left join assets a
        on a.id = t.anchor_asset_id and a.organization_id = t.organization_id
     where t.development_case_id = c.id and a.id is null
     order by t.object_ref
  loop
    v_breaks := v_breaks || jsonb_build_object(
      'kind', 'anchor_loss',
      'objectId', v_row.id,
      'objectRef', v_row.object_ref,
      'detail', format('%s %s names anchor asset %s, which does not exist in this organization. Every wall in this slice refuses that state, so finding one means a row reached the table with the triggers disabled.',
        v_row.object_kind, v_row.object_ref, v_row.anchor_asset_id));
  end loop;

  -- (2) DANGLING LINK — a live hop touching a retired object.
  for v_row in
    select l.id, l.link_type, up.object_ref up_ref, up.status up_status,
           dn.object_ref dn_ref, dn.status dn_status
      from thread_links l
      join thread_objects up on up.id = l.upstream_object_id
      join thread_objects dn on dn.id = l.downstream_object_id
     where l.development_case_id = c.id
       and l.status = 'live'
       and (up.status = 'retired' or dn.status = 'retired')
     order by l.id
  loop
    v_breaks := v_breaks || jsonb_build_object(
      'kind', 'dangling_link',
      'linkId', v_row.id,
      'detail', format('The live hop %s → %s (%s) touches a retired object (%s). retire_thread_object severs every hop it touches in the same transaction, so this state means a status column was moved outside it.',
        v_row.up_ref, v_row.dn_ref, v_row.link_type,
        case when v_row.up_status = 'retired' then v_row.up_ref else v_row.dn_ref end));
  end loop;

  -- (2b) A live hop that runs BACKWARD along the chain.
  for v_row in
    select l.id, l.link_type, up.object_kind up_kind, up.object_ref up_ref,
           dn.object_kind dn_kind, dn.object_ref dn_ref
      from thread_links l
      join thread_objects up on up.id = l.upstream_object_id
      join thread_objects dn on dn.id = l.downstream_object_id
     where l.development_case_id = c.id
       and l.status = 'live'
       and coalesce(sync_thread_chain_position(dn.object_kind), -1)
           <= coalesce(sync_thread_chain_position(up.object_kind), 999)
     order by l.id
  loop
    v_breaks := v_breaks || jsonb_build_object(
      'kind', 'backward_link',
      'linkId', v_row.id,
      'detail', format('The hop %s (%s) → %s (%s) runs against the spec II.2 chain. Every downstream-impact answer computed over it is wrong in the most convincing possible way.',
        v_row.up_ref, v_row.up_kind, v_row.dn_ref, v_row.dn_kind));
  end loop;

  -- (4) VERSION-CHAIN HOLE — more than one authoritative revision, or a
  --     superseded revision with no successor.
  for v_row in
    select t.object_ref, count(*)::int n
      from thread_object_versions v
      join thread_objects t on t.id = v.thread_object_id
     where t.development_case_id = c.id and v.status = 'authoritative'
     group by t.id, t.object_ref
    having count(*) > 1
     order by t.object_ref
  loop
    v_breaks := v_breaks || jsonb_build_object(
      'kind', 'multiple_authoritative_versions',
      'objectRef', v_row.object_ref,
      'detail', format('%s has %s revisions marked authoritative at once. The partial unique index refuses that, so this row set predates it or was written around it — and until it is resolved nobody can say which sheet is current.',
        v_row.object_ref, v_row.n));
  end loop;

  select count(*)::int into v_n
    from thread_object_versions v
    join thread_objects t on t.id = v.thread_object_id
   where t.development_case_id = c.id
     and v.status = 'superseded' and v.superseded_by_version_id is null;
  if coalesce(v_n, 0) > 0 then
    v_breaks := v_breaks || jsonb_build_object(
      'kind', 'version_chain_hole',
      'count', v_n,
      'detail', format('%s superseded revision(s) name nothing that superseded them. The supersession chain has a hole, so "what replaced this" has no answer.', v_n));
  end if;

  -- (4b) THE POINTER THAT DOES NOT POINT BACK. Ruling 5C-R7's reason for
  --      holding two pointers is that the chain must be walkable from either
  --      end; a one-way pair reads as intact from the end that has its pointer
  --      and as a dead end from the other, which is worse than a hole because
  --      nothing looks wrong. Only `superseded_by_version_id` has a CHECK
  --      behind it, so the reciprocity is asserted everywhere and tested here.
  select count(*)::int into v_n
    from thread_object_versions v
    join thread_objects t on t.id = v.thread_object_id
   where t.development_case_id = c.id
     and ((v.superseded_by_version_id is not null
           and not exists (select 1 from thread_object_versions w
                            where w.id = v.superseded_by_version_id
                              and w.supersedes_version_id = v.id))
       or (v.supersedes_version_id is not null
           and not exists (select 1 from thread_object_versions w
                            where w.id = v.supersedes_version_id
                              and w.superseded_by_version_id = v.id)));
  if coalesce(v_n, 0) > 0 then
    v_breaks := v_breaks || jsonb_build_object(
      'kind', 'one_way_supersession',
      'count', v_n,
      'detail', format('%s revision(s) carry a supersession pointer that is not answered from the other end. declare_thread_version_authoritative writes both in one transaction, so a one-way pair means a row was written around it — and "what replaced this" and "what did this replace" now disagree about the same pair of revisions.', v_n));
  end if;

  -- ── GAPS: legal, and incomplete (ruling 5C-R10). ────────────────────────
  -- A live object with no released revision.
  for v_row in
    select t.id, t.object_kind, t.object_ref,
           (select count(*) from thread_object_versions v
             where v.thread_object_id = t.id and v.status = 'draft')::int drafts
      from thread_objects t
     where t.development_case_id = c.id and t.status = 'live'
       and not exists (select 1 from thread_object_versions v
                        where v.thread_object_id = t.id and v.status = 'authoritative')
     order by t.object_ref
  loop
    v_gaps := v_gaps || jsonb_build_object(
      'kind', 'no_authoritative_version',
      'objectId', v_row.id,
      'objectRef', v_row.object_ref,
      'draftCount', v_row.drafts,
      'detail', case when v_row.drafts > 0
        then format('%s %s has %s recorded revision(s) and none released. Anyone working from one is working from a sheet the project has not stood behind.',
          v_row.object_kind, v_row.object_ref, v_row.drafts)
        else format('%s %s has no revision recorded at all, so nothing downstream of it can be said to be current.',
          v_row.object_kind, v_row.object_ref) end);
  end loop;

  -- A RETIRED object that still carries a released revision. Legal:
  -- `retire_thread_object` severs the hops and records the severance, and it
  -- deliberately does not touch the version rows — there is no `withdrawn`
  -- status to move them to, and inventing one would let a retirement rewrite
  -- what was released. But the state is a trap for a reader: the object is out
  -- of the thread and its last revision still says `authoritative` in the
  -- table. `resolve_thread_authoritative_version` refuses to present it as
  -- current; this reports the same fact at case scale so it is visible without
  -- opening each object.
  for v_row in
    select t.object_kind, t.object_ref, v.version_label
      from thread_objects t
      join thread_object_versions v
        on v.thread_object_id = t.id and v.status = 'authoritative'
     where t.development_case_id = c.id and t.status = 'retired'
     order by t.object_ref
  loop
    v_gaps := v_gaps || jsonb_build_object(
      'kind', 'retired_object_holds_released_version',
      'objectRef', v_row.object_ref,
      'versionLabel', v_row.version_label,
      'detail', format('%s %s is RETIRED and revision "%s" is still marked authoritative on it. Retiring an object does not withdraw what was released, so the row stays — but nothing on this case is current at that object, and anybody reading the version table directly would conclude otherwise.',
        v_row.object_kind, v_row.object_ref, v_row.version_label));
  end loop;

  -- A live hop that skips chain positions. Legal (ruling 5C-R10), reported.
  for v_row in
    select l.id, up.object_kind up_kind, up.object_ref up_ref,
           dn.object_kind dn_kind, dn.object_ref dn_ref,
           (sync_thread_chain_position(dn.object_kind)
            - sync_thread_chain_position(up.object_kind) - 1) skipped
      from thread_links l
      join thread_objects up on up.id = l.upstream_object_id
      join thread_objects dn on dn.id = l.downstream_object_id
     where l.development_case_id = c.id and l.status = 'live'
       and sync_thread_chain_position(dn.object_kind)
           - sync_thread_chain_position(up.object_kind) > 1
     order by l.id
  loop
    v_gaps := v_gaps || jsonb_build_object(
      'kind', 'chain_skip',
      'linkId', v_row.id,
      'skipped', v_row.skipped,
      'detail', format('%s → %s skips %s chain position(s). Legal — not every asset has a vendor document — but an impact traversal that meets this hop REFUSES rather than reporting what it could reach as the whole affected set.',
        v_row.up_ref, v_row.dn_ref, v_row.skipped));
  end loop;

  -- A live object with no hop at all: registered and connected to nothing.
  for v_row in
    select t.id, t.object_kind, t.object_ref
      from thread_objects t
     where t.development_case_id = c.id and t.status = 'live'
       and not exists (select 1 from thread_links l
                        where l.status = 'live'
                          and (l.upstream_object_id = t.id or l.downstream_object_id = t.id))
     order by t.object_ref
  loop
    v_gaps := v_gaps || jsonb_build_object(
      'kind', 'isolated_object',
      'objectId', v_row.id,
      'objectRef', v_row.object_ref,
      'detail', format('%s %s is registered in the CDE and joined to nothing. It is anchored, so it is not broken — but it is not in the thread either, and no change anywhere will ever produce a receipt for it.',
        v_row.object_kind, v_row.object_ref));
  end loop;

  -- The D11.19 residual: requirements on this case that were never registered.
  if v_reqs_total > coalesce(v_reqs_registered, 0) then
    v_gaps := v_gaps || jsonb_build_object(
      'kind', 'requirements_outside_cde',
      'count', v_reqs_total - coalesce(v_reqs_registered, 0),
      'detail', format('%s of this case''s %s requirement(s) are not registered in the CDE. A requirement can only enter the thread once the asset it lands on is known (D11.19 ruling 5C-R2), so this number is the honest cost of that rule — stated, never counted as threaded.',
        v_reqs_total - coalesce(v_reqs_registered, 0), v_reqs_total));
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'refused', false,
    -- INTACT is about `breaks` only. A thread with forty missing vendor
    -- documents is incomplete, not broken, and conflating them is how a real
    -- integrity failure hides in a dashboard (ruling 5C-R11).
    'intact', jsonb_array_length(v_breaks) = 0,
    'objectCount', v_objects,
    'liveObjects', v_live,
    'retiredObjects', v_retired,
    'linkCount', v_links,
    'liveLinks', v_live_links,
    'severedLinks', v_severed_links,
    'severanceCount', v_severances,
    'requirementCount', v_reqs_total,
    'requirementsRegistered', coalesce(v_reqs_registered, 0),
    'breaks', v_breaks,
    'gaps', v_gaps,
    'note', case when jsonb_array_length(v_breaks) = 0
      then 'No break found. Every object resolves to one asset, every live hop runs forward between two live objects, and no object has two current revisions. Gaps below are places the thread is INCOMPLETE, which is a different thing and is not counted against the invariant.'
      else 'BREAKS FOUND. Each one is a state the database walls refuse, so a row reached a table around them — treat this as an integrity incident, not a project backlog item.' end);
end
$$;

revoke all on function public.check_thread_continuity(uuid) from public, anon;
grant execute on function public.check_thread_continuity(uuid) to authenticated, service_role;

comment on function public.check_thread_continuity(uuid) is
  'D11.20 / spec §26 "the digital thread must never break": reports the invariant the walls enforce, separating BREAKS (states the database refuses — an integrity incident) from GAPS (legal incompleteness). REFUSES over an empty CDE rather than reporting zero breaks, which reads as a maintained thread.';

-- ---------------------------------------------------------------------------
-- 5. The severance ledger, read.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_thread_severances(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_rows jsonb;
  v_total int;
  v_objects int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select count(*)::int into v_objects
    from thread_objects where organization_id = v_org and development_case_id = c.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'route', s.route,
      'subjectKind', s.subject_kind,
      'subjectRef', s.subject_ref,
      'snapshot', s.subject_snapshot,
      'linksSevered', s.links_severed,
      'reason', s.reason,
      'severedAt', s.severed_at,
      'severedBy', coalesce(u.full_name, u.email, s.severed_by::text),
      -- BY THE ROUTE, never by whether an actor column happens to be filled.
      -- Both cascade routes pass auth.uid() — the person who deleted the case
      -- or the asset is signed in — so `severed_by is not null` would report a
      -- cascade as a decision somebody took, under a route label that says
      -- "Case deleted" two words away.
      'byAPerson', s.route in ('object_retired', 'link_severed', 'object_reanchored'))
      order by s.severed_at desc, s.id desc), '[]'::jsonb),
    count(*)::int
    into v_rows, v_total
  from thread_severances s
  left join user_profiles u on u.id = s.severed_by and u.organization_id = v_org
  where s.organization_id = v_org and s.development_case_id = c.id;

  return jsonb_build_object(
    'caseId', c.id,
    -- REFUSAL over a case with no thread. "Nothing has ever been severed" is
    -- good news about a thread that EXISTS; over an empty CDE it is the same
    -- sentence a perfectly maintained thread produces, which is the plausible
    -- zero every other read in this slice refuses.
    'refused', v_objects = 0,
    'refusal', case when v_objects = 0
      then 'No object on this case is registered in the Common Data Environment, so there is no thread to sever and nothing has been. That is not "every hop still holds" — there are no hops.'
      else null end,
    'objectCount', v_objects,
    'total', case when v_objects = 0 then null else v_total end,
    'severances', v_rows,
    'note', 'Every place this case''s digital thread was allowed to come apart, and why. The ROUTE says whether it was a decision somebody took or a cascade; a cascade names whoever held the session, which is not the same as somebody deciding.');
end
$$;

revoke all on function public.get_case_thread_severances(uuid) from public, anon;
grant execute on function public.get_case_thread_severances(uuid) to authenticated, service_role;

comment on function public.get_case_thread_severances(uuid) is
  'D11.20: the case''s severance ledger. Append-only, TRUNCATE-refused, and the place a permitted break in the digital thread is visible after the fact. REFUSES over a case with no registered CDE rather than reporting that nothing has been severed. Rows whose case has since been DELETED are unreachable here by construction — get_org_thread_severances is the read for those.';

-- ---------------------------------------------------------------------------
-- 6. The ledger at TENANT scope — the only read a case cascade survives.
--
--    `get_case_thread_severances` starts by resolving the development case and
--    refusing if it is gone. That is right for a case-scoped read and it makes
--    the `case_cascade` route STRUCTURALLY UNREADABLE: those rows are written
--    precisely because the case was deleted, so the read that would show them
--    refuses on the row's own subject. Recorded-but-unreadable is
--    indistinguishable from silent for the person who has to find out what
--    happened, and D11.20's contract is that a permitted break is visible
--    afterwards.
--
--    So the ledger also has a tenant-scoped read, which resolves nothing and
--    therefore loses nothing: it reports each row's case id, that case's title
--    when it still exists, and `caseDeleted` when it does not.
-- ---------------------------------------------------------------------------
create or replace function public.get_org_thread_severances(p_limit int default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_rows jsonb;
  v_total int;
  v_orphaned int;
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select count(*)::int,
         count(*) filter (
           where s.development_case_id is null
              or not exists (select 1 from development_cases dc
                              where dc.id = s.development_case_id))::int
    into v_total, v_orphaned
    from thread_severances s
   where s.organization_id = v_org;

  select coalesce(jsonb_agg(q.r order by q.severed_at desc, q.id desc), '[]'::jsonb)
    into v_rows
  from (
    select s.id, s.severed_at,
           jsonb_build_object(
             'id', s.id,
             'route', s.route,
             'caseId', s.development_case_id,
             'caseTitle', dc.title,
             'caseDeleted', s.development_case_id is not null and dc.id is null,
             'subjectKind', s.subject_kind,
             'subjectRef', s.subject_ref,
             'snapshot', s.subject_snapshot,
             'linksSevered', s.links_severed,
             'reason', s.reason,
             'severedAt', s.severed_at,
             'severedBy', coalesce(u.full_name, u.email, s.severed_by::text),
             'byAPerson', s.route in ('object_retired', 'link_severed', 'object_reanchored')) r
      from thread_severances s
      left join development_cases dc
        on dc.id = s.development_case_id and dc.organization_id = v_org
      left join user_profiles u on u.id = s.severed_by and u.organization_id = v_org
     where s.organization_id = v_org
     order by s.severed_at desc, s.id desc
     limit v_limit) q;

  return jsonb_build_object(
    'total', v_total,
    'returned', jsonb_array_length(v_rows),
    'limit', v_limit,
    'orphaned', v_orphaned,
    'severances', v_rows,
    'note', case when v_orphaned > 0
      then format('%s of these %s severance(s) belong to a development case that no longer exists. Those are the case cascades: the ledger kept SNAPSHOTS rather than foreign keys precisely so they would survive the deletion that produced them, and this is the read that can still see them.', v_orphaned, v_total)
      else 'Every severance in this tenant, newest first. The ROUTE says whether it was a decision somebody took or a cascade.' end);
end
$$;

revoke all on function public.get_org_thread_severances(int) from public, anon;
grant execute on function public.get_org_thread_severances(int) to authenticated, service_role;

comment on function public.get_org_thread_severances(int) is
  'D11.20: the tenant''s whole severance ledger, including the rows whose development case has since been deleted — the `case_cascade` route, which the case-scoped read cannot reach because it refuses on the very case that is gone. Recorded-but-unreadable is indistinguishable from silent, and D11.20 forbids silent.';

notify pgrst, 'reload schema';
