-- ============================================================================
-- Sync Develop — Slice 7B: ONE field-readiness engine, two doors.
--   D7.05  work-package release readiness checklist (the CONFLICT, resolved)
--   D7.06  READY / NOT READY verdict, §70 safe-to-start
--   D7.11  per-package itemized constraint-free readiness
--   D7.12  field-ready package definition — the ten elements
--   D7.19  Workflow 4: execution readiness verdict
--
-- ── RULING 22 (Slice 7B). THE RULING COMES BEFORE THE SCHEMA. ───────────────
--
-- Slice 7B opened holding TWO live readiness doors keyed to the same work:
--
--   start_restoration_work            (20260921090000:604) — Sync Recovery's
--     per-item field-start gate. Refuses on: no released plan, the item not
--     being IN that released plan, any unresolved hard EXECUTION constraint,
--     unstaged materials, and an unconfirmed permit/isolation.
--
--   sync_work_package_release_verdict (20261210090100:934) — Slice 7A's ONE
--     package release predicate. Refuses on: cancelled, already released,
--     UNASSESSED, empty, parent unreleased, open hard constraints.
--
-- The question this slice had to answer first: does Recovery's verdict
-- generalize to packages, does the package verdict absorb the recovery path,
-- or do both consume one shared predicate?
--
-- **RULING: BOTH CONSUME ONE SHARED PREDICATE, and the predicate is anchored
-- on the WORK IDENTITY rather than on either grouping context.**
--
-- That falls straight out of RULING 19. `work_orders` is the work identity;
-- `restoration_event_work` and `work_package_work` are MEMBERSHIPS of that
-- identity in two operating contexts. "Is this work ready to be executed in
-- the field" is therefore a question about the WORK, and both doors have been
-- asking it about the very same rows — Recovery inline at line 620, and the
-- package path not at all, because Slice 7A could only see constraints
-- somebody had typed in by hand. So:
--
--   * `sync_field_readiness_elements(work_order_id, asset_id)` is THE
--     field-ready predicate (D7.12's ten elements, itemized, per work order).
--     It reads canonical stores and writes nothing.
--   * `start_restoration_work` is REDEFINED here to refuse THROUGH it, with
--     its historical blocking set (materials, permit/isolation) and its
--     refusal sentences preserved to the character. Its two inline element
--     checks are gone — not copied.
--   * `sync_work_package_release_verdict` is NOT TOUCHED. It stays THE single
--     release predicate exactly as 7A left it, and field readiness reaches it
--     through the ONE channel that already exists: recorded constraints
--     (20261211090100 derives them). Adding a second readiness arm to the
--     package door — or a second verdict beside it — is the defect this
--     programme has found in seven consecutive chunks and the defect 7A had
--     to delete from its own read path. There is still one verdict.
--
-- WHY NOT THE OTHER TWO ANSWERS, stated so a later reader can disagree with
-- the reasoning rather than guess at it:
--
--   * "start_restoration_work generalizes to packages" — it is a per-ITEM
--     START door underneath a RELEASED RECOVERY PLAN. Two of its five
--     refusals (a released plan exists; this item is in that plan) have no
--     meaning for a project work package, which has no restoration plan and
--     is not an event. Generalizing it would either drag Recovery's plan
--     model into project delivery or hollow those two refusals out for both.
--
--   * "sync_work_package_release_verdict absorbs the recovery path" — it
--     refuses on package chain, parent release, cancellation and emptiness,
--     none of which a restoration event has. Absorbing would mean minting a
--     work package for every restoration event: a fourth work store in all
--     but name (AGENTS invariant 8), and the thing RULING 19 refused.
--
-- What the two doors legitimately DO NOT share is which elements gate which
-- act. "May this crew start THIS job now, under a released recovery plan" and
-- "is this PACKAGE releasable to the field" are different questions and take
-- different blocking sets. That is policy, and it is now visible in one line
-- at each door instead of being buried in two implementations of the same
-- material rule. What they must not have two of is the ELEMENT RULES, and
-- after this file they do not.
--
-- ── RULING 22, AMENDED ON REVIEW. WHAT THE FIRST DRAFT GOT WRONG ───────────
--
-- The first draft of this file made the claim above and did not earn it. Three
-- corrections, each written here rather than in a commit message, because the
-- claim "the element rules exist once" is the whole of RULING 22:
--
--   (a) A THIRD material rule was still live and still gating this very door.
--       `refresh_restoration_readiness` (20261001090000:305) derives its own
--       `material`/`execution`/`is_hard` constraint per work order from
--       `work_order_materials`, with its own predicate and its own sentences —
--       and `start_restoration_work`'s hard-execution-constraint check does not
--       exclude `material`, so those rows gate the start. Two rules for one
--       fact, disagreeing live: the store said kitted and the shared predicate
--       said ready while the recovery-derived row still said blocked. That loop
--       is REDEFINED at the foot of this file to read the ONE predicate. Its
--       labour, resource and work-zone loops answer different questions and are
--       untouched.
--
--   (b) A JOB PLAN THE PREDICATE CANNOT READ was being reported as "no permit
--       is required". The plan lookup gained `organization_id = v_org` (the
--       historical count at 20260921090000:625 had no org filter), and the
--       permit count was then computed only inside that branch — so an
--       unreadable plan silently became `permits = 0`, `isolation =
--       not_applicable` and a start the old door refused. "I could not read
--       the plan" is now a REFUSAL of the whole payload, and both consumers
--       refuse through it. Separately, a work order with NO plan at all reports
--       isolation as `unverifiable` rather than `not_applicable`: nothing can
--       say whether a permit is required, and "not applicable" is a positive
--       finding this predicate has no store to make.
--
--   (c) THE MATERIALS REFUSAL IS NOT CHARACTER-IDENTICAL, and the first draft
--       said four times that it was. The ISOLATION sentence is byte-identical
--       to 20260921090000:628. The MATERIALS sentence now names the count and
--       ENDS with Recovery's original wording ('required materials are not
--       ready'), which is an extension rather than a preservation. That is a
--       deliberate improvement — a refusal a technician reads should say how
--       many lines — but it is stated as what it is, and pinned by an exact
--       string comparison in the transcript rather than by a substring match
--       that passes over the change it claims to guard.
--
-- A fourth correction lives in 20261211090200: the recorded evidence a package
-- is released on must still match the stores it was derived from.
--
-- ── D7.12: TEN ELEMENTS, SEVEN DERIVED AND THREE UNVERIFIABLE ──────────────
--
-- The register row says 7 of 10 have canonical objects. That is still true
-- and this file does not invent stores for the other three. It NAMES them:
--
--   DERIVED (a canonical store answers the question)
--     1 scope        job_plans via work_orders.job_plan_id
--     2 procedure    job_plan_steps
--     3 materials    work_order_materials
--     4 tools        job_plan_tools
--     5 permits      job_plan_permits
--     6 isolation    equipment_releases (isolation_confirmed, released)
--     7 quality      job_plan_checks (incl. is_hold_point)
--
--   UNVERIFIABLE (no canonical store — reported as `unverifiable`, NEVER as
--   ready, and dischargeable only as a DECLARED §28 constraint a named person
--   clears)
--     8  crew        work_orders.assignee is free text; member_competencies
--                    binds a competency to a PERSON, not to a job.
--     9  access      nothing records physical access to a work face for a
--                    work order.
--     10 predecessor nothing records work-order-level predecessors.
--
-- `unverifiable` is a THIRD answer, not a soft "ready". Spec §27's whole point
-- is that "nobody has checked" and "checked and clear" are different facts,
-- and the one thing a field-readiness engine must never do is report the
-- first as the second. An element with no store reports that it has no store.
--
-- Canonical reuse: work_orders, job_plans + job_plan_steps/tools/permits/
-- checks, work_order_materials, equipment_releases, restoration_event_work,
-- restoration_events, restoration_plan_versions, restoration_constraints,
-- app_current_org, recovery_role_allowed. No new table, no new store, no
-- second material rule and no second isolation rule.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE ELEMENT SHAPE, in one place.
--
--    Every element the predicate reports is built here, so a later element
--    cannot arrive with a different set of keys and quietly render blank on
--    the board.
-- ---------------------------------------------------------------------------
create or replace function public.sync_field_readiness_element(
  p_key text,
  p_label text,
  p_basis_kind text,
  p_state text,
  p_detail text,
  p_source text
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'key', p_key,
    'label', p_label,
    -- 'derived' — a canonical store answered it. 'declared' — nothing does,
    -- and only a person can.
    'basisKind', p_basis_kind,
    -- ready | blocked | not_applicable | unverifiable
    'state', p_state,
    'detail', p_detail,
    'source', p_source);
$$;

revoke all on function public.sync_field_readiness_element(text, text, text, text, text, text)
  from public, anon;
grant execute on function public.sync_field_readiness_element(text, text, text, text, text, text)
  to authenticated, service_role;

comment on function public.sync_field_readiness_element(text, text, text, text, text, text) is
  'D7.12: the shape of one field-ready element. `basisKind` says whether a canonical store answered the question (derived) or whether nothing does and only a person can (declared); `state` is ready, blocked, not_applicable or unverifiable — and unverifiable is a third answer, never a soft ready.';

-- ---------------------------------------------------------------------------
-- 1b. THE TEN KEYS, NAMED ONCE.
--
--     A door states its gate as a list of keys. A key that is not an element
--     matches nothing, so a door whose policy carries a typo refuses NOTHING
--     while looking armed — the same failure shape `enforce_awp_act_is_human`
--     names in its own refusal ("a wall bound to a column that does not exist
--     admits everything while looking installed", 20261210090000:355). This
--     list is what a gate is checked against, and the transcript checks it
--     against the payload the predicate actually returns.
-- ---------------------------------------------------------------------------
create or replace function public.sync_field_readiness_element_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['scope', 'procedure', 'materials', 'tools', 'permits',
               'isolation', 'quality', 'crew', 'access', 'predecessor']::text[];
$$;

revoke all on function public.sync_field_readiness_element_keys() from public, anon;
grant execute on function public.sync_field_readiness_element_keys() to authenticated, service_role;

comment on function public.sync_field_readiness_element_keys() is
  'D7.12: the ten §27 field-ready element keys, in the order sync_field_readiness_elements reports them. Named once so a door''s gate policy can be CHECKED against it rather than silently matching nothing.';

-- ---------------------------------------------------------------------------
-- 2. THE ONE FIELD-READY PREDICATE (D7.12, RULING 22).
--
--    STABLE and read-only. It reads canonical stores and reports; it records
--    nothing, refuses nothing on the caller's behalf, and takes no view on
--    which elements gate which act — that is the DOOR's policy, stated at the
--    door, in one line each.
--
--    TENANCY BY CONSTRUCTION. It resolves the organization from the work
--    order row itself and filters every sub-query by that, so it cannot be
--    made to read across tenants by the caller passing a foreign id — and it
--    is revoked from every client role besides, because it carries no
--    session-derived org filter and is only ever called from inside a definer
--    that has already established the tenant (the shape
--    sync_work_package_release_verdict established in 7A).
--
--    p_asset_id EXISTS FOR RECOVERY, and it is the one place the two doors
--    genuinely differ on FACT rather than on policy: start_restoration_work
--    has always looked for the isolation release against the RESTORATION
--    EVENT'S asset (20260921090000:626), not the work order's. Passing it in
--    keeps that behaviour identical to the character instead of silently
--    re-pointing a live permit gate at a different asset while claiming to
--    have changed nothing.
-- ---------------------------------------------------------------------------
create or replace function public.sync_field_readiness_elements(
  p_work_order_id uuid,
  p_asset_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  w work_orders%rowtype;
  jp job_plans%rowtype;
  v_org uuid;
  v_asset uuid;
  v_label text;
  v_has_plan boolean := false;
  v_steps int := 0;
  v_tools int := 0;
  v_permits int := 0;
  v_checks int := 0;
  v_holds int := 0;
  v_mat_lines int := 0;
  v_mat_open int := 0;
  v_release equipment_releases%rowtype;
  v_isolated boolean := false;
  v_elements jsonb := '[]'::jsonb;
  v_state text;
  v_detail text;
begin
  select * into w from work_orders where id = p_work_order_id;
  if not found then
    return jsonb_build_object('answered', false,
      'refusal', 'work order not found', 'elements', '[]'::jsonb);
  end if;
  v_org := w.organization_id;
  v_asset := coalesce(p_asset_id, w.asset_id);
  v_label := coalesce(w.wo_number, w.id::text);

  -- A PLAN THAT CANNOT BE READ IS A NON-ANSWER, NOT A CLEAN ONE. The org
  -- filter here is a tightening on the historical count (20260921090000:625
  -- had none), and a tightening that fell through to `permits = 0` would have
  -- DISARMED the permit/isolation gate: the old door refused an unconfirmed
  -- isolation on such a work order and the first draft of this one started it,
  -- reporting `permits_required: 0`. So the predicate refuses the whole
  -- payload, and both doors refuse through the refusal.
  if w.job_plan_id is not null then
    select * into jp from job_plans where id = w.job_plan_id and organization_id = v_org;
    v_has_plan := found;
    if not v_has_plan then
      return jsonb_build_object('answered', false,
        'refusal', format('Work order %s names a job plan that cannot be read in its own organization, so no scope, tool, permit or acceptance position exists for it. Reading that as "nothing is required" would disarm the permit and isolation gate on a job nobody can see the plan for.', v_label),
        'workOrderId', w.id, 'elements', '[]'::jsonb);
    end if;
  end if;
  if v_has_plan then
    select count(*) into v_steps from job_plan_steps where job_plan_id = jp.id;
    select count(*) into v_tools from job_plan_tools where job_plan_id = jp.id;
    select count(*) into v_permits from job_plan_permits where job_plan_id = jp.id;
    select count(*) filter (where true), count(*) filter (where is_hold_point)
      into v_checks, v_holds
      from job_plan_checks where job_plan_id = jp.id;
  end if;

  select count(*) filter (where true),
         count(*) filter (where status in ('requested', 'short'))
    into v_mat_lines, v_mat_open
    from work_order_materials
   where organization_id = v_org and work_order_id = w.id;

  if v_permits > 0 then
    select * into v_release from equipment_releases r
     where r.organization_id = v_org
       and r.asset_id = v_asset
       and (r.work_order_id = w.id or r.work_order_id is null)
       and r.status = 'released'
       and r.isolation_confirmed
     order by r.released_at desc
     limit 1;
    v_isolated := found;
  end if;

  -- ── 1. SCOPE. The approved engineering deliverable the crew executes from.
  if not v_has_plan then
    v_state := 'blocked';
    v_detail := format('Work order %s has no job plan attached, so there is no approved scope for a crew to execute.', v_label);
  elsif jp.status <> 'adopted' then
    v_state := 'blocked';
    v_detail := format('Job plan %s v%s is %s, not adopted. A draft or superseded plan is not approved scope.',
      jp.plan_key, jp.version, jp.status);
  else
    v_state := 'ready';
    v_detail := format('Job plan %s v%s is adopted.', jp.plan_key, jp.version);
  end if;
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_element(
    'scope', 'Approved scope', 'derived', v_state, v_detail, 'job_plans'));

  -- ── 2. PROCEDURE.
  if not v_has_plan then
    v_state := 'blocked';
    v_detail := format('Work order %s has no job plan attached, so no procedure steps exist.', v_label);
  elsif v_steps = 0 then
    v_state := 'blocked';
    v_detail := format('Job plan %s carries no steps. A plan with no procedure tells the crew nothing.', jp.plan_key);
  else
    v_state := 'ready';
    v_detail := format('%s procedure step(s) recorded on job plan %s.', v_steps, jp.plan_key);
  end if;
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_element(
    'procedure', 'Procedure steps', 'derived', v_state, v_detail, 'job_plan_steps'));

  -- ── 3. MATERIALS. The rule Recovery has enforced since 2026-09-21, stated
  --      ONCE, here. Zero demand lines is NOT APPLICABLE and not "ready":
  --      nothing was ordered, so nothing can be short — the same reading
  --      refresh_restoration_readiness takes (20261001090000:305).
  if v_mat_lines = 0 then
    v_state := 'not_applicable';
    v_detail := format('No material demand is recorded for work order %s.', v_label);
  elsif v_mat_open > 0 then
    v_state := 'blocked';
    v_detail := format('%s of %s material line(s) on work order %s remain requested or short — required materials are not ready.',
      v_mat_open, v_mat_lines, v_label);
  else
    v_state := 'ready';
    v_detail := 'Every recorded material line is reserved, kitted, issued or cancelled.';
  end if;
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_element(
    'materials', 'Materials staged', 'derived', v_state, v_detail, 'work_order_materials'));

  -- ── 4. TOOLS.
  if not v_has_plan then
    v_state := 'blocked';
    v_detail := format('Work order %s has no job plan attached, so no tool list exists.', v_label);
  elsif v_tools = 0 then
    v_state := 'not_applicable';
    v_detail := format('Job plan %s lists no special tools.', jp.plan_key);
  else
    v_state := 'ready';
    v_detail := format('%s tool(s) listed on job plan %s.', v_tools, jp.plan_key);
  end if;
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_element(
    'tools', 'Tools and equipment', 'derived', v_state, v_detail, 'job_plan_tools'));

  -- ── 5. PERMITS IDENTIFIED. Distinct from isolation: the permit is the
  --      authorisation, the isolation is the physical state it authorises —
  --      the distinction job_plan_permits states in its own comment.
  if not v_has_plan then
    v_state := 'blocked';
    v_detail := format('Work order %s has no job plan attached, so no permit requirement has been identified.', v_label);
  elsif v_permits = 0 then
    v_state := 'not_applicable';
    v_detail := format('Job plan %s identifies no permit requirement.', jp.plan_key);
  else
    v_state := 'ready';
    v_detail := format('%s permit requirement(s) identified on job plan %s.', v_permits, jp.plan_key);
  end if;
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_element(
    'permits', 'Permits identified', 'derived', v_state, v_detail, 'job_plan_permits'));

  -- ── 6. ISOLATION. THE BLOCKED SENTENCE IS RECOVERY'S OWN, to the character
  --      (20260921090000:628) — this is the rule moving, not a paraphrase of
  --      it appearing somewhere else while the original stays put.
  --
  --      NO PLAN IS NOT "NO PERMIT REQUIRED". `not_applicable` is a positive
  --      finding from a canonical store, and with no plan attached there is no
  --      store to make it: nothing says whether this job needs a permit. That
  --      is `unverifiable` — the third answer — and it reports the absence
  --      rather than a false clearance on the safety element. It does not
  --      widen Recovery's gate, because `unverifiable` blocks no door; it
  --      stops the screen from saying a permit position was established when
  --      nothing established one, and the package assessor records it as a
  --      question for a person.
  if not v_has_plan then
    v_state := 'unverifiable';
    v_detail := format('Work order %s has no job plan attached, so nothing identifies whether a permit and an isolation are required for it. That is not the same finding as "no permit is required".', v_label);
  elsif v_permits = 0 then
    v_state := 'not_applicable';
    v_detail := format('Job plan %s identifies no permit, so no isolation is required for it.', jp.plan_key);
  elsif v_isolated then
    v_state := 'ready';
    v_detail := format('Equipment release recorded on %s confirms active isolation.',
      v_release.released_at::date);
  else
    v_state := 'blocked';
    v_detail := 'job plan requires permit/isolation; canonical equipment release does not confirm active isolation';
  end if;
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_element(
    'isolation', 'Isolation confirmed', 'derived', v_state, v_detail, 'equipment_releases'));

  -- ── 7. QUALITY / HOLD POINTS.
  if not v_has_plan then
    v_state := 'blocked';
    v_detail := format('Work order %s has no job plan attached, so no acceptance check is defined.', v_label);
  elsif v_checks = 0 then
    v_state := 'not_applicable';
    v_detail := format('Job plan %s defines no acceptance check.', jp.plan_key);
  else
    v_state := 'ready';
    v_detail := format('%s acceptance check(s) defined on job plan %s, %s of them hold points.',
      v_checks, jp.plan_key, v_holds);
  end if;
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_element(
    'quality', 'Acceptance checks', 'derived', v_state, v_detail, 'job_plan_checks'));

  -- ── 8-10. THE THREE WITH NO CANONICAL OBJECT. Reported as UNVERIFIABLE and
  --         never as ready. Each says WHY nothing can answer it and which §28
  --         constraint a person discharges it as, so this row stays honest
  --         about its own coverage instead of counting ten and covering seven.
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_element(
    'crew', 'Crew assigned and competent', 'declared', 'unverifiable',
    'No canonical store binds a competency-verified crew to a work order: work_orders.assignee is free text and member_competencies binds a competency to a PERSON, not to a job. This element is discharged only as a LABOUR constraint a named person clears.',
    'none'));
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_element(
    'access', 'Access to the work face', 'declared', 'unverifiable',
    'No canonical store records physical access to a work face for a work order. Recovery derives a work-zone interference constraint BETWEEN two restoration items from work_zone_relationships, which is a different question. This element is discharged only as an ACCESS or SCAFFOLD constraint a named person clears.',
    'none'));
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_element(
    'predecessor', 'Predecessors complete', 'declared', 'unverifiable',
    'No canonical store records work-order-level predecessors. The AWP chain records a PACKAGE parent, which sync_work_package_release_verdict already refuses on, and Recovery records sequence_no within one event; neither says which JOB must finish before this one. This element is discharged only as a PREDECESSOR constraint a named person clears.',
    'none'));

  return jsonb_build_object(
    'answered', true,
    'workOrderId', w.id,
    'woNumber', w.wo_number,
    'title', w.title,
    'assetId', v_asset,
    'jobPlanId', case when v_has_plan then jp.id end,
    'permitsRequired', v_permits,
    'elements', v_elements,
    'ready', (select count(*) from jsonb_array_elements(v_elements) e where e->>'state' = 'ready'),
    'blocked', (select count(*) from jsonb_array_elements(v_elements) e where e->>'state' = 'blocked'),
    'notApplicable', (select count(*) from jsonb_array_elements(v_elements) e where e->>'state' = 'not_applicable'),
    'unverifiable', (select count(*) from jsonb_array_elements(v_elements) e where e->>'state' = 'unverifiable'),
    'basis', 'The ten §27 field-ready elements for one work order, read from the canonical stores that hold them. Seven are derived; three have no canonical object and say so rather than defaulting to ready.');
end
$$;

revoke all on function public.sync_field_readiness_elements(uuid, uuid)
  from public, anon, authenticated;

comment on function public.sync_field_readiness_elements(uuid, uuid) is
  'D7.12 / RULING 22: THE field-ready predicate for one work order — the ten §27 elements, itemized, seven derived from canonical stores and three reported UNVERIFIABLE because no store answers them. Read-only and policy-free: it says what each element is, and each DOOR states which elements gate it. Consumed by start_restoration_work (Recovery) and assess_package_field_readiness (AWP), so the material rule and the permit/isolation rule exist once. Revoked from clients — it carries no session org filter and is only called from inside a definer that established the tenant.';

-- ---------------------------------------------------------------------------
-- 3. THE BLOCKING SUBSET, so a door names its policy instead of writing a
--    rule. `p_gate_keys` is the door's policy — WHICH elements stop this act —
--    and the returned refusal is the element's own sentence, not a second
--    one written at the door.
--
--    `not_applicable` and `unverifiable` are NOT blockers here, and that is
--    deliberate rather than lenient: `not_applicable` is a positive finding
--    from a canonical store, and `unverifiable` is discharged through the
--    CONSTRAINT store by a person, which is where the package door already
--    refuses (RULING 22). A door that blocked on `unverifiable` would refuse
--    every job in this repository forever, which is a gate nobody can pass
--    and therefore a gate that gets deleted.
--
--    IT FAILS CLOSED, and the first draft did not. A filter over an empty
--    array, a mistyped key, or a payload the predicate REFUSED to answer all
--    returned `[]` — three separate ways for a door to admit while looking
--    armed. Each of those is a programming fault at the door rather than a
--    condition in the data, so each RAISES rather than returning a refusal
--    nobody would read. This is the same posture `enforce_awp_act_is_human`
--    took when it refused to be installed against a column that does not
--    exist.
-- ---------------------------------------------------------------------------
create or replace function public.sync_field_readiness_blockers(
  p_elements jsonb,
  p_gate_keys text[]
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_unknown text[];
begin
  if not coalesce((p_elements->>'answered')::boolean, false) then
    raise exception
      'sync_field_readiness_blockers was handed a payload the field-readiness predicate did not answer (%). A door that read that as "nothing blocks" would admit the very work nobody could look at.',
      coalesce(p_elements->>'refusal', 'no refusal stated')
      using errcode = 'check_violation';
  end if;
  if p_gate_keys is null or cardinality(p_gate_keys) = 0 then
    raise exception
      'a door with an empty field-readiness gate refuses nothing while looking armed — name the elements that stop this act'
      using errcode = 'check_violation';
  end if;
  select array_agg(k) into v_unknown
    from unnest(p_gate_keys) as k
   where not (k = any (sync_field_readiness_element_keys()));
  if v_unknown is not null then
    raise exception
      'field-readiness gate names %, which is not one of the ten elements — a gate naming it would match nothing and pass everything',
      array_to_string(v_unknown, ', ')
      using errcode = 'check_violation';
  end if;

  return (
    select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_elements->'elements', '[]'::jsonb))
           with ordinality as t(e, ord)
     where e->>'state' = 'blocked'
       and (e->>'key') = any (p_gate_keys));
end
$$;

revoke all on function public.sync_field_readiness_blockers(jsonb, text[]) from public, anon;
grant execute on function public.sync_field_readiness_blockers(jsonb, text[]) to authenticated, service_role;

comment on function public.sync_field_readiness_blockers(jsonb, text[]) is
  'RULING 22: the blocked elements from a sync_field_readiness_elements payload, filtered to the keys a given door gates on. The door states its POLICY (which keys) and this returns the element''s own sentence — so no door restates a readiness rule. FAILS CLOSED: an unanswered payload, an empty gate or a key that is not one of the ten RAISES, because each of those returned "no blockers" from a gate that looked armed.';

-- ---------------------------------------------------------------------------
-- 4. RECOVERY'S DOOR, REFUSING THROUGH THE SHARED PREDICATE.
--
--    THIS IS THE RULING, IN CODE. Everything else about
--    start_restoration_work is preserved verbatim from 20260921090000:604 —
--    the role list (which admits ai_admin, and this file does not change
--    Recovery's authority envelope under a §27 header, exactly as RULING 20
--    declined to), the startability check, the released-plan check, the
--    plan-membership check and the hard-execution-constraint check. What is
--    gone is the pair of INLINE ELEMENT CHECKS: the material rule and the
--    permit/isolation rule now live in sync_field_readiness_elements and are
--    read from there.
--
--    THE REFUSAL SENTENCES, STATED AS THEY ACTUALLY ARE. The ISOLATION
--    refusal is byte-identical to 20260921090000:628 — 'job plan requires
--    permit/isolation; canonical equipment release does not confirm active
--    isolation'. The MATERIALS refusal is NOT: it now reads '<n> of <m>
--    material line(s) on work order <label> remain requested or short —
--    required materials are not ready.', which ENDS with the historical
--    sentence and adds the count in front of it. That is an extension, made
--    deliberately because a technician reading a refusal should be told how
--    many lines are short — and it is written down here as an extension
--    rather than described as a preservation, because the first draft of this
--    file claimed character-identity in four places and a substring assertion
--    let the claim stand. The transcript now compares both strings by EQUALITY.
--
--    THE BLOCKING SET IS RECOVERY'S HISTORICAL ONE — materials and isolation,
--    and no more. The other eight elements are REPORTED in the return payload
--    (a supervisor can now see that the job has no adopted plan) and gate
--    nothing here, because widening a live gate is not a generalization: it
--    is a different product decision wearing one's clothes, and it belongs to
--    whoever owns Recovery's start contract.
-- ---------------------------------------------------------------------------
create or replace function public.start_restoration_work(p_event_work_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  ew restoration_event_work%rowtype;
  e restoration_events%rowtype;
  w work_orders%rowtype;
  p restoration_plan_versions%rowtype;
  v_ready jsonb;
  v_blockers jsonb;
  v_permits int;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['technician','supervisor','maintenance_manager','admin','ai_admin']) then
    return jsonb_build_object('error','field-start authority denied'); end if;
  select * into ew from restoration_event_work where id=p_event_work_id and organization_id=v_org;
  if not found or ew.plan_state<>'included' or ew.execution_status not in ('not_started','blocked') then
    return jsonb_build_object('error','work is not startable'); end if;
  select * into e from restoration_events where id=ew.event_id and organization_id=v_org;
  select * into w from work_orders where id=ew.work_order_id and organization_id=v_org;
  select * into p from restoration_plan_versions where event_id=e.id and organization_id=v_org and status='released' order by version desc limit 1;
  if not found then return jsonb_build_object('error','no released plan exists'); end if;
  if not exists(select 1 from jsonb_array_elements(p.schedule) s cross join lateral jsonb_array_elements(s->'tasks') t where t->>'event_work_id'=ew.id::text) then
    return jsonb_build_object('error','scope item is not in the currently released plan'); end if;
  if exists(select 1 from restoration_constraints where organization_id=v_org and event_id=e.id and phase='execution' and is_hard
    and state<>'satisfied' and constraint_kind not in ('permit','isolation','asset_state') and (event_work_id is null or event_work_id=ew.id)) then
    return jsonb_build_object('error','unresolved hard execution constraint blocks work'); end if;

  -- THE ONE PREDICATE. The event's asset is passed because that is the asset
  -- this door has always looked for the isolation release against.
  v_ready := public.sync_field_readiness_elements(w.id, e.asset_id);
  -- A NON-ANSWER IS A REFUSAL, NOT A CLEAN BILL. The predicate has an explicit
  -- 'answered' channel and the first draft read past it: an unreadable work
  -- order or job plan produced an empty element list, which the blocker filter
  -- turned into "nothing blocks" and the door then STARTED the work, handing
  -- the caller ten elements rendered as zero.
  if not coalesce((v_ready->>'answered')::boolean, false) then
    return jsonb_build_object('error', v_ready->>'refusal');
  end if;
  v_permits := coalesce((v_ready->>'permitsRequired')::int, 0);
  -- RECOVERY'S POLICY, IN ONE LINE: materials and isolation stop a start.
  v_blockers := public.sync_field_readiness_blockers(v_ready, array['materials','isolation']);
  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object(
      'error', v_blockers->0->>'detail',
      'element', v_blockers->0->>'key',
      'blockedElements', v_blockers,
      'fieldReadiness', v_ready->'elements');
  end if;

  update restoration_event_work set execution_status='in_progress',updated_at=now() where id=ew.id;
  update restoration_events set status='executing',updated_at=now() where id=e.id;
  update work_orders set status='in_progress' where id=w.id;
  return jsonb_build_object('ok',true,'work_order_id',w.id,'permits_required',v_permits,
    'fieldReadiness', v_ready->'elements');
end
$$;

revoke all on function public.start_restoration_work(uuid) from public, anon;
grant execute on function public.start_restoration_work(uuid) to authenticated;

comment on function public.start_restoration_work(uuid) is
  'Sync Recovery''s per-item field-start gate, REFUSING THROUGH the shared field-readiness predicate (RULING 22, Slice 7B). Its plan, membership and hard-execution-constraint refusals are Recovery''s own and unchanged; its material and permit/isolation refusals now come from sync_field_readiness_elements, which is the same predicate the AWP path assesses a package with — so the rule that decides whether materials are staged exists once. The BLOCKING SET is 20260921090000''s exactly (materials and isolation, and no more); of the two refusal sentences the isolation one is byte-identical and the materials one now names the count and ends with the historical wording. A payload the predicate could not answer is a REFUSAL here, never an empty blocker list. The other eight elements are reported, not gated.';

-- ---------------------------------------------------------------------------
-- 5. THE THIRD CONSUMER — and the reason RULING 22's central claim was false
--    when this file was first written.
--
--    `refresh_restoration_readiness` (20261001090000:305) held a SECOND
--    material rule: its own reading of `work_order_materials`, its own zero-
--    demand handling and its own sentences, written as `material` /
--    `execution` / `is_hard` constraint rows against the restoration event.
--    `start_restoration_work`'s hard-execution-constraint check excludes only
--    permit, isolation and asset_state — so those rows GATE THE VERY DOOR this
--    slice routed through the shared predicate, and the two disagreed live:
--    the store said kitted, the predicate said ready, and the recovery-derived
--    row still said blocked, refusing the start with a sentence that named no
--    element at all.
--
--    So the material loop is redefined to READ THE ONE PREDICATE. Everything
--    else about this function is preserved verbatim: the role list, the
--    labour loop, the resource loop, the work-zone loop, the delete scope
--    (`recovery-v2:%`), the source_ref keys, the description shape, the owner
--    role, and the verified_by/verified_at stamping this function has always
--    done on a satisfied derived row. The element STATE maps onto the
--    constraint state exactly as the old inline rule did — ready→satisfied,
--    blocked→blocked, no demand→not_applicable — and the BASIS is now the
--    element's own sentence, so the two surfaces cannot drift apart again.
--
--    NOT CHANGED HERE, and named rather than fixed quietly: this function
--    stamps `verified_by = auth.uid()` on a satisfied derived row and its role
--    list admits `ai_admin`, so on the EVENT anchor a machine can still author
--    a satisfied constraint. That is Recovery's authority envelope from
--    2026-10-01, not this slice's, and RULING 20 and RULING 22 both declined
--    to change Recovery's envelope under a §27 header. The PACKAGE anchor is
--    walled (20261210090100) and stays walled.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_restoration_readiness(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); e restoration_events%rowtype; r record; s record; v_state text; v_basis text; v_cap numeric; v_count int:=0; v_block int:=0; v_unknown int:=0; v_ready jsonb; v_element jsonb;
begin
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','readiness authority denied'); end if;
  select * into e from restoration_events where id=p_event_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','event not found'); end if;
  delete from restoration_constraints where organization_id=v_org and event_id=e.id and source_kind='derived' and source_ref like 'recovery-v2:%';

  for r in select coalesce(nullif(trim(t.craft),''),'Unassigned') craft,sum(coalesce(t.estimated_hours,0)) required_hours from restoration_event_work ew join work_order_tasks t on t.work_order_id=ew.work_order_id where ew.organization_id=v_org and ew.event_id=e.id and ew.plan_state='included' and ew.execution_status<>'complete' group by coalesce(nullif(trim(t.craft),''),'Unassigned') loop
    select sum(c.weekly_hours) into v_cap from craft_capacity c where c.organization_id=v_org and c.craft=r.craft and c.effective_from<=current_date and (c.site_id=e.site_id or c.site_id is null);
    if v_cap is null then v_state:='unknown'; v_basis:='No current craft capacity is recorded; capacity is not inferred from headcount.';
    elsif r.required_hours<=v_cap then v_state:='satisfied'; v_basis:=format('%s h required against %s h recorded weekly capacity for %s.',round(r.required_hours,1),round(v_cap,1),r.craft);
    else v_state:='blocked'; v_basis:=format('%s h required exceeds %s h recorded weekly capacity for %s.',round(r.required_hours,1),round(v_cap,1),r.craft); end if;
    insert into restoration_constraints(organization_id,event_id,constraint_kind,phase,is_hard,state,description,basis,source_kind,source_ref,owner_role,verified_by,verified_at)
    values(v_org,e.id,'labour','planning',true,v_state,'Labour readiness — '||r.craft,v_basis,'derived','recovery-v2:labour:'||r.craft,'planner',case when v_state='satisfied' then auth.uid() end,case when v_state='satisfied' then now() end);
    v_count:=v_count+1; if v_state='blocked' then v_block:=v_block+1; elsif v_state='unknown' then v_unknown:=v_unknown+1; end if;
  end loop;

  -- THE ONE MATERIAL RULE, read rather than restated (RULING 22, amended).
  for r in select ew.id event_work_id,w.id work_order_id,coalesce(w.wo_number,w.id::text) label from restoration_event_work ew join work_orders w on w.id=ew.work_order_id where ew.organization_id=v_org and ew.event_id=e.id and ew.plan_state='included' and ew.execution_status<>'complete' loop
    v_ready := public.sync_field_readiness_elements(r.work_order_id, e.asset_id);
    if not coalesce((v_ready->>'answered')::boolean,false) then
      -- A work order the predicate cannot read is an UNKNOWN question for a
      -- person, never a silently skipped one: a readiness refresh that omitted
      -- it would report "no material blocker" over work nobody could look at.
      v_state:='unknown'; v_basis:=coalesce(v_ready->>'refusal','The field-readiness predicate could not answer for this work order.');
    else
      select el into v_element from jsonb_array_elements(v_ready->'elements') el where el->>'key'='materials';
      v_basis := v_element->>'detail';
      v_state := case v_element->>'state' when 'ready' then 'satisfied' when 'blocked' then 'blocked' when 'not_applicable' then 'not_applicable' else 'unknown' end;
    end if;
    insert into restoration_constraints(organization_id,event_id,event_work_id,constraint_kind,phase,is_hard,state,description,basis,source_kind,source_ref,owner_role,verified_by,verified_at)
    values(v_org,e.id,r.event_work_id,'material','execution',true,v_state,'Material readiness — '||r.label,v_basis,'derived','recovery-v2:material:'||r.work_order_id::text,'planner',case when v_state='satisfied' then auth.uid() end,case when v_state='satisfied' then now() end);
    v_count:=v_count+1; if v_state='blocked' then v_block:=v_block+1; elsif v_state='unknown' then v_unknown:=v_unknown+1; end if;
  end loop;

  for r in select * from restoration_resource_requirements where organization_id=v_org and event_id=e.id loop
    select * into s from operational_constraint_signals x where x.organization_id=v_org and x.signal_kind=r.resource_kind and x.signal_key=r.resource_key and (x.site_id is null or x.site_id=e.site_id) and (x.asset_id is null or x.asset_id=e.asset_id) and x.observed_at<=now() order by x.observed_at desc limit 1;
    if not found or s.valid_until<now() then v_state:='unknown'; v_basis:='No fresh evidence is available for this required resource.';
    elsif s.state='available' then v_state:='satisfied'; v_basis:=s.basis;
    elsif s.state='unavailable' then v_state:='blocked'; v_basis:=s.basis;
    else v_state:='unknown'; v_basis:=s.basis; end if;
    insert into restoration_constraints(organization_id,event_id,event_work_id,constraint_kind,phase,is_hard,state,description,basis,source_kind,source_ref,owner_role,verified_by,verified_at)
    values(v_org,e.id,r.event_work_id,case r.resource_kind when 'bay' then 'bay' when 'crane' then 'crane' when 'tooling' then 'tooling' when 'vendor' then 'vendor' when 'weather' then 'weather' when 'production' then 'production' else 'other' end,r.phase,r.is_hard,v_state,initcap(r.resource_kind)||' readiness — '||r.resource_key,v_basis,'derived','recovery-v2:resource:'||r.id::text,case r.resource_kind when 'production' then 'operator' else 'planner' end,case when v_state='satisfied' then auth.uid() end,case when v_state='satisfied' then s.observed_at end);
    v_count:=v_count+1; if v_state='blocked' and r.is_hard then v_block:=v_block+1; elsif v_state='unknown' and r.is_hard then v_unknown:=v_unknown+1; end if;
  end loop;

  for r in select a.id a_id,b.id b_id,a.work_zone zone_a,b.work_zone zone_b,a.sequence_no from restoration_event_work a join restoration_event_work b on b.event_id=a.event_id and b.id>a.id and b.sequence_no=a.sequence_no where a.organization_id=v_org and a.event_id=e.id and a.plan_state='included' and b.plan_state='included' and a.execution_status<>'complete' and b.execution_status<>'complete' and a.concurrency_rule='verified_parallel' and b.concurrency_rule='verified_parallel' loop
    if r.zone_a is null or r.zone_b is null then v_state:='unknown'; v_basis:='Parallel work has no complete physical work-zone assignment; interference cannot be assessed.';
    elsif exists(select 1 from work_zone_relationships z where z.organization_id=v_org and (z.site_id=e.site_id or z.site_id is null) and z.zone_a=least(r.zone_a,r.zone_b) and z.zone_b=greatest(r.zone_a,r.zone_b) and z.parallel_allowed) then v_state:='satisfied'; select z.basis into v_basis from work_zone_relationships z where z.organization_id=v_org and (z.site_id=e.site_id or z.site_id is null) and z.zone_a=least(r.zone_a,r.zone_b) and z.zone_b=greatest(r.zone_a,r.zone_b) and z.parallel_allowed order by (z.site_id is not null) desc limit 1;
    else v_state:='blocked'; v_basis:='No verified physical relationship permits these work zones to execute in parallel.'; end if;
    insert into restoration_constraints(organization_id,event_id,constraint_kind,phase,is_hard,state,description,basis,source_kind,source_ref,owner_role,verified_by,verified_at)
    values(v_org,e.id,'work_zone','planning',true,v_state,'Physical interference — sequence '||r.sequence_no||' ('||coalesce(r.zone_a,'?')||' / '||coalesce(r.zone_b,'?')||')',v_basis,'derived','recovery-v2:zone:'||r.a_id::text||':'||r.b_id::text,'planner',case when v_state='satisfied' then auth.uid() end,case when v_state='satisfied' then now() end);
    v_count:=v_count+1; if v_state='blocked' then v_block:=v_block+1; elsif v_state='unknown' then v_unknown:=v_unknown+1; end if;
  end loop;

  return jsonb_build_object('ok',true,'constraints_refreshed',v_count,'hard_blocked',v_block,'hard_unknown',v_unknown,'ready_for_optimization',v_block=0 and v_unknown=0,'policy','Fresh evidence resolves gates; missing or stale evidence remains unknown.');
end $$;

revoke all on function public.refresh_restoration_readiness(uuid) from public, anon;
grant execute on function public.refresh_restoration_readiness(uuid) to authenticated;

comment on function public.refresh_restoration_readiness(uuid) is
  'Sync Recovery''s derived readiness refresh, with its MATERIAL loop reading the one field-readiness predicate (RULING 22, Slice 7B) instead of holding a second reading of work_order_materials. Its labour, resource and work-zone loops answer different questions and are unchanged, as are its delete scope, its source_ref keys and its authority envelope.';
