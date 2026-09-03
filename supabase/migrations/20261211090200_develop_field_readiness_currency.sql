-- ============================================================================
-- Sync Develop — Slice 7B (part 3): the recorded evidence must still be true.
--   D7.05  release readiness checklist — the currency of what it recorded
--   D7.06  READY / NOT READY release verdict, §70 safe-to-start
--   D7.11  per-package itemized readiness — which element moved
--
-- ── RULING 22, AMENDED. WHY THE ONE VERDICT GAINS AN ARM AND NOT A TWIN ────
--
-- RULING 22 said field readiness reaches the release door through the ONE
-- channel that already exists — recorded constraints — and left
-- `sync_work_package_release_verdict` untouched. The first half of that is
-- still right. The second half was not survivable, and three adversarial
-- passes proved the same defect from three directions on the live database:
--
--   * a package is assessed, its constraints are cleared by a person, and then
--     `work_order_materials` moves to `short`. Nothing re-derives, nothing
--     expires, and every surface reads `ready_for_human` with `assessed: true`
--     and a date beside it. The release door releases. Recovery's start door,
--     on the SAME work order at the SAME instant, refuses — because it reads
--     the stores live;
--
--   * a second work order is added to the assessed package through the
--     product's own door. Five of its elements are blocked. The board carries
--     `workOrders: 2` from the verdict beside `workOrders: 1` from the recorded
--     run, states no disagreement, and reads READY;
--
--   * a store-derived blocker is set to `satisfied` by hand with a plausible
--     basis ("the parts are on the truck"), and the screen then prints a red
--     BLOCKED element with a green clearance underneath it and `canRelease:
--     true` at the top.
--
-- All three are the same fact: A RECORDED ASSESSMENT IS A SNAPSHOT, AND THE
-- SURFACES WERE PRESENTING IT AS A CURRENT POSITION. That is not a second
-- verdict's problem to solve — putting the check on the read surfaces alone
-- would break the six-state parity Slice 7A proved character for character,
-- and it would break it in the WORSE direction, with the screen refusing and
-- the door releasing. So the check goes where the one verdict already lives:
--
--   ONE PREDICATE, ONE MORE STATE. `sync_work_package_release_verdict` gains
--   a SEVENTH refusing state, `stale`. `release_work_package` refuses through
--   it and `get_case_work_packages`, `get_package_field_readiness` and
--   `get_execution_readiness_board` render its sentence verbatim, exactly as
--   they already do for the other six. A state that REFUSES is not a second
--   verdict; a second predicate that answered differently would be.
--
-- ── WHAT MAKES A PACKAGE STALE, AND WHY IT IS SCOPED TO ASSESSED ONES ──────
--
-- `sync_work_package_field_readiness_gaps` asks one question of the ONE
-- element predicate, per work order: is every element that would need
-- discharging still held by something open?
--
--   * a DERIVED element that is `blocked` or `unverifiable` with no OPEN
--     constraint against it — the store says the job is not ready and nothing
--     on this package is holding that fact;
--   * a DECLARED element with no constraint answering it for that work order
--     at all — nobody asked crew, access or predecessors about this job;
--   * a work order the predicate cannot read.
--
-- It runs ONLY where a `package_field_readiness` run has been recorded, and
-- only in the branch that would otherwise return `ready_for_human`. That is a
-- deliberate boundary, and it is the D7.06 residual restated rather than
-- silently widened: a package whose field readiness NOBODY EVER WALKED still
-- reaches `ready_for_human` on a person's own cleared constraints, exactly as
-- Slice 7A shipped it. Making an assessment MANDATORY before release is a
-- product decision belonging to whoever reopens D7.06 — it would refuse every
-- package Slice 7A's own transcript releases. What this file refuses is
-- narrower and not arguable: a package released against a RECORDED assessment
-- the stores no longer support. D7.06 stays 🟡 and says so.
--
-- ── AND THE TOGGLE THAT MADE IT WORSE ─────────────────────────────────────
--
-- `clear_package_constraint` refused hand-satisfaction for three constraint
-- KINDS (permit, isolation, asset_state) — the list Recovery has carried since
-- 2026-09-21, written when package constraints were only ever hand-recorded
-- declarations. Slice 7B introduced a new class those three kinds do not
-- cover: rows DERIVED from canonical stores. The kind list is kept exactly as
-- it is, and a PROVENANCE test is added beside it: a row whose truth comes
-- from a store is discharged by fixing the store, never by a toggle. The
-- migration's own smoke stated that rule in a comment and never tested it.
--
-- Canonical reuse: sync_field_readiness_elements,
-- sync_field_readiness_constraint_kind, restoration_constraints,
-- work_packages, work_package_work, work_orders, calculation_runs.
-- No new table, no new trigger, no new store.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE GAPS. Not a verdict — a list of facts the ONE verdict reads.
--
--    Revoked from every client role: like the verdict itself it carries no
--    session org filter and is only ever called from inside a definer that has
--    already established the tenant.
-- ---------------------------------------------------------------------------
create or replace function public.sync_work_package_field_readiness_gaps(
  p_package_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p work_packages%rowtype;
  m record;
  el record;
  v_ready jsonb;
  v_kind text;
  v_label text;
  v_gaps jsonb := '[]'::jsonb;
  v_checked int := 0;
begin
  select * into p from work_packages where id = p_package_id;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'work package not found',
      'gaps', '[]'::jsonb);
  end if;

  for m in
    select w.* from work_package_work k join work_orders w on w.id = k.work_order_id
     where k.work_package_id = p.id
     order by w.wo_number nulls last, w.id
  loop
    v_checked := v_checked + 1;
    v_label := coalesce(m.wo_number, m.id::text);
    v_ready := sync_field_readiness_elements(m.id, null);

    if not coalesce((v_ready->>'answered')::boolean, false) then
      v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
        'workOrderId', m.id, 'woNumber', m.wo_number,
        'element', 'all', 'label', 'Every element',
        'reason', 'unreadable',
        'detail', coalesce(v_ready->>'refusal', 'this work order could not be read'),
        'sentence', format('every element on work order %s is unreadable', v_label)));
      continue;
    end if;

    for el in
      select e->>'key' as elem_key, e->>'label' as elem_label,
             e->>'basisKind' as elem_basis, e->>'state' as elem_state,
             e->>'detail' as elem_detail
        from jsonb_array_elements(v_ready->'elements') e
    loop
      v_kind := sync_field_readiness_constraint_kind(el.elem_key);
      if v_kind is null then
        continue;
      end if;

      -- A STORE-DERIVED POSITION THAT NOTHING OPEN IS HOLDING. The store says
      -- this job is not ready; if no open constraint on the package carries
      -- that, the package's constraint set no longer describes the work.
      if el.elem_basis = 'derived' and el.elem_state in ('blocked', 'unverifiable') then
        if not exists (
          select 1 from restoration_constraints c
           where c.organization_id = p.organization_id
             and c.work_package_id = p.id
             and c.source_ref = format('awp-field-ready:derived:%s:%s', el.elem_key, m.id)
             and c.state in ('unknown', 'blocked'))
        then
          v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
            'workOrderId', m.id, 'woNumber', m.wo_number,
            'element', el.elem_key, 'label', el.elem_label,
            'reason', case el.elem_state
                        when 'blocked' then 'blocked_and_unheld'
                        else 'unanswerable_and_unheld' end,
            'detail', el.elem_detail,
            'sentence', format('%s on work order %s is %s and no open constraint holds it',
              el.elem_label, v_label, replace(el.elem_state, '_', ' '))));
        end if;

      -- A QUESTION NOBODY ASKED ABOUT THIS JOB. Crew, access and predecessors
      -- have no store, so the ONLY evidence is a constraint naming the work
      -- order. A job added to the package after the assessment has none.
      elsif el.elem_basis = 'declared' then
        if not exists (
          select 1 from restoration_constraints c
           where c.organization_id = p.organization_id
             and c.work_package_id = p.id
             and (c.source_ref = format('awp-field-ready:declared:%s:%s', el.elem_key, m.id)
                  or (coalesce(c.source_kind, '') <> 'derived'
                      and c.constraint_kind = v_kind
                      and c.work_order_id = m.id)))
        then
          v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
            'workOrderId', m.id, 'woNumber', m.wo_number,
            'element', el.elem_key, 'label', el.elem_label,
            'reason', 'never_asked',
            'detail', el.elem_detail,
            'sentence', format('%s has never been asked about work order %s',
              el.elem_label, v_label)));
        end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('answered', true, 'workOrders', v_checked,
    'gapCount', jsonb_array_length(v_gaps), 'gaps', v_gaps);
end
$$;

revoke all on function public.sync_work_package_field_readiness_gaps(bigint)
  from public, anon, authenticated, service_role;

comment on function public.sync_work_package_field_readiness_gaps(bigint) is
  'D7.05/D7.06 (RULING 22, amended): where a work package''s RECORDED constraint set no longer describes what the canonical stores say about its work — a derived element blocked or unanswerable with nothing open holding it, a declared element nobody ever asked about a job, or a work order the predicate cannot read. States no verdict: sync_work_package_release_verdict reads it, in one place.';

-- ---------------------------------------------------------------------------
-- 2. THE ONE RELEASE VERDICT, WITH A SEVENTH STATE.
--
--    Byte-for-byte 20261210090100:934 apart from the `stale` arm, which sits
--    AFTER the open-constraint arm (an open constraint is the more actionable
--    sentence and keeps its place) and BEFORE `ready_for_human`.
-- ---------------------------------------------------------------------------
create or replace function public.sync_work_package_release_verdict(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p work_packages%rowtype;
  parent work_packages%rowtype;
  v_total int;
  v_open_hard int;
  v_work int;
  v_open jsonb;
  v_run record;
  v_gaps jsonb;
  v_gap_count int;
begin
  select * into p from work_packages where id = p_package_id;
  if not found then
    return jsonb_build_object('verdict', 'not_found', 'canRelease', false,
      'reason', 'work package not found');
  end if;

  select count(*) filter (where true),
         count(*) filter (where is_hard and state in ('unknown', 'blocked'))
    into v_total, v_open_hard
    from restoration_constraints
   where work_package_id = p.id;
  select count(*) into v_work from work_package_work where work_package_id = p.id;

  if p.status = 'cancelled' then
    return jsonb_build_object('verdict', 'cancelled', 'canRelease', false,
      'packageCode', p.package_code, 'constraintsRecorded', v_total,
      'openHard', v_open_hard, 'workOrders', v_work,
      'reason', format('CANCELLED — work package %s was withdrawn%s. A cancelled work package is not released.',
        p.package_code,
        case when p.released_at is not null
          then format(' after being released on %s', p.released_at::date) else '' end));
  end if;

  if p.released_at is not null then
    return jsonb_build_object('verdict', 'released', 'canRelease', false,
      'packageCode', p.package_code, 'constraintsRecorded', v_total,
      'openHard', v_open_hard, 'workOrders', v_work,
      'reason', format('RELEASED on %s — every hard constraint recorded against work package %s was cleared and a named person said so. It is not released again.',
        p.released_at::date, p.package_code));
  end if;

  if v_total = 0 then
    return jsonb_build_object('verdict', 'unassessed', 'canRelease', false,
      'packageCode', p.package_code, 'constraintsRecorded', 0,
      'openHard', 0, 'workOrders', v_work,
      'reason', format('UNASSESSED — no constraint has been recorded against work package %s. That is not "constraint-free": reporting zero open constraints for a package nobody assessed is the reading spec §27 exists to prevent. Record its drawing, material, access, labour, crane, permit, isolation, scaffold, predecessor and inspection position first.',
        p.package_code));
  end if;

  if v_work = 0 then
    return jsonb_build_object('verdict', 'empty', 'canRelease', false,
      'packageCode', p.package_code, 'constraintsRecorded', v_total,
      'openHard', v_open_hard, 'workOrders', 0,
      'reason', format('NOT READY — work package %s contains no work orders; releasing an empty package tells a crew to start nothing and reports progress for it.',
        p.package_code));
  end if;

  if p.parent_package_id is not null then
    select * into parent from work_packages where id = p.parent_package_id;
    if parent.released_at is null then
      return jsonb_build_object('verdict', 'parent_unreleased', 'canRelease', false,
        'packageCode', p.package_code, 'constraintsRecorded', v_total,
        'openHard', v_open_hard, 'workOrders', v_work,
        'reason', format('NOT READY — work package %s hangs from %s (%s), which is not released. Releasing this package would release work whose predecessors nobody has cleared.',
          p.package_code, parent.package_code, parent.package_type));
    end if;
  end if;

  if v_open_hard > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'constraint_id', x.id, 'kind', x.constraint_kind, 'state', x.state,
             'description', x.description, 'owner_role', x.owner_role,
             'required_by', x.required_by, 'expected_clear_date', x.expected_clear_date)
             order by x.constraint_kind, x.id), '[]'::jsonb)
      into v_open
      from restoration_constraints x
     where x.work_package_id = p.id
       and x.is_hard and x.state in ('unknown', 'blocked');
    return jsonb_build_object('verdict', 'not_ready', 'canRelease', false,
      'packageCode', p.package_code, 'constraintsRecorded', v_total,
      'openHard', v_open_hard, 'workOrders', v_work, 'openConstraints', v_open,
      'reason', format('NOT READY: %s hard constraint(s) on work package %s are unknown or blocked. A package is released when its constraints are cleared, not when somebody needs the progress.',
        v_open_hard, p.package_code));
  end if;

  -- ── THE SEVENTH STATE (RULING 22, amended). Only where an assessment was
  --    RECORDED, because only then is there a claim of currency to falsify.
  select r.id, r.computed_at into v_run
    from calculation_runs r
   where r.organization_id = p.organization_id
     and r.calculation_key = 'package_field_readiness'
     and r.status = 'computed'
     and (r.inputs->>'workPackageId') = p.id::text
   order by r.computed_at desc
   limit 1;

  if v_run.id is not null then
    v_gaps := sync_work_package_field_readiness_gaps(p.id);
    v_gap_count := coalesce((v_gaps->>'gapCount')::int, 0);
    if v_gap_count > 0 then
      return jsonb_build_object('verdict', 'stale', 'canRelease', false,
        'packageCode', p.package_code, 'constraintsRecorded', v_total,
        'openHard', 0, 'workOrders', v_work,
        'fieldReadinessGaps', v_gaps->'gaps',
        'reason', format('NOT READY — work package %s was field-assessed on %s and its recorded constraint set no longer describes the work: %s%s. Releasing against evidence the canonical stores have moved past is releasing against an assessment nobody made. Re-assess it.',
          p.package_code, v_run.computed_at::date,
          (select string_agg(g->>'sentence', '; ' order by ord)
             from jsonb_array_elements(v_gaps->'gaps') with ordinality as t(g, ord)
            where ord <= 3),
          case when v_gap_count > 3
            then format(' (and %s more)', v_gap_count - 3) else '' end));
    end if;
  end if;

  return jsonb_build_object('verdict', 'ready_for_human', 'canRelease', true,
    'packageCode', p.package_code, 'constraintsRecorded', v_total,
    'openHard', 0, 'workOrders', v_work,
    'reason', format('Every hard constraint recorded against work package %s is cleared, it contains %s work order(s)%s. Release is a §70 human act and has not been performed.',
      p.package_code, v_work,
      case when p.parent_package_id is not null
        then ' and its parent is released' else ' and it is the head of its chain' end));
end
$$;

revoke all on function public.sync_work_package_release_verdict(bigint)
  from public, anon, authenticated, service_role;

comment on function public.sync_work_package_release_verdict(bigint) is
  'D7.06/D7.11: THE release verdict for one §27 work package — cancelled, released, unassessed, empty, parent_unreleased, not_ready, STALE or ready_for_human, with the sentence a person reads. ONE predicate (the Slice 3C shape): release_work_package refuses through it and every read renders its reason verbatim, so the screen cannot say "cleared, awaiting a signature" about a package the door will refuse. `stale` is Slice 7B''s amendment: a package whose RECORDED field-readiness assessment the canonical stores have moved past is refused rather than released against evidence nobody re-checked. Revoked from clients — it carries no org filter of its own and is only ever called from inside a definer that has already established the tenant.';

-- ---------------------------------------------------------------------------
-- 3. A STORE-DERIVED TRUTH IS NOT DISCHARGED BY A TOGGLE.
--
--    Byte-for-byte 20261210090100:807 apart from the provenance guard, which
--    sits AFTER the kind guard so permit, isolation and asset-state keep
--    Recovery's own refusal sentence word for word.
--
--    `not_applicable` is refused alongside `satisfied`, and for the same
--    reason: both remove the row from the open set, and a store-derived
--    position that the store still asserts is not made inapplicable by
--    somebody saying so. DECLARED rows — crew, access, predecessors — stay
--    clearable, because a person's answer is their ONLY discharge path.
-- ---------------------------------------------------------------------------
create or replace function public.clear_package_constraint(
  p_constraint_id uuid,
  p_state text,
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
  c restoration_constraints%rowtype;
  p work_packages%rowtype;
  v_basis text := nullif(btrim(coalesce(p_basis, '')), '');
  v_prev jsonb;
  v_element text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- ai_admin is absent from this list AND refused by the §70 wall on
  -- verified_by. Two doors, because the role list is policy and the wall is
  -- enforcement: a later edit to one is not an edit to the other.
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer', 'planner', 'supervisor') then
    return jsonb_build_object('error',
      'closing a constraint requires a planning, engineering, supervisory or governance role — and spec §70 reserves it for a person');
  end if;
  if p_state not in ('unknown', 'satisfied', 'blocked', 'not_applicable') then
    return jsonb_build_object('error',
      'state must be unknown, satisfied, blocked or not_applicable');
  end if;
  select * into c from restoration_constraints
   where id = p_constraint_id and organization_id = v_org and work_package_id is not null;
  if not found then
    return jsonb_build_object('error', 'package constraint not found');
  end if;
  select * into p from work_packages where id = c.work_package_id;
  if p.released_at is not null then
    return jsonb_build_object('error',
      format('work package %s was released on %s against this constraint set', p.package_code, p.released_at::date));
  end if;
  -- PRESERVED VERBATIM from set_restoration_constraint_state
  -- (20260921090000:398). Permit, isolation and asset-state truth comes from
  -- the canonical operating and release controls, not from a toggle — and the
  -- project path gets no exemption Recovery does not have.
  if p_state = 'satisfied' and c.constraint_kind in ('permit', 'isolation', 'asset_state') then
    return jsonb_build_object('error',
      'permit/isolation/asset-state truth must come from canonical operating and release controls, not a work-package toggle');
  end if;
  -- AND THE SAME RULE BY PROVENANCE (Slice 7B). A row the field-readiness
  -- assessment DERIVED from a canonical store carries that store's answer, not
  -- a judgement — so it is discharged by fixing what the store says and
  -- re-assessing, exactly as the material shortage in the transcript is. The
  -- three kinds above are a subset of this class and keep their own sentence.
  if p_state in ('satisfied', 'not_applicable')
     and c.source_ref like 'awp-field-ready:derived:%' then
    v_element := split_part(c.source_ref, ':', 3);
    return jsonb_build_object('error',
      format('the %s position on this work order is DERIVED from a canonical store, so it is not discharged by a toggle — change what the store says and re-assess the package. A constraint raised from evidence cannot be closed by an opinion about the evidence.',
        v_element));
  end if;
  if p_state in ('satisfied', 'not_applicable') and (v_basis is null or length(v_basis) < 10) then
    return jsonb_build_object('error',
      'evidence or basis is required to clear a constraint (10 characters minimum)');
  end if;

  v_prev := jsonb_build_object('state', c.state, 'verified_by', c.verified_by,
    'verified_at', c.verified_at, 'basis', c.basis);

  perform set_config('app.package_constraint_write', 'granted', true);
  update restoration_constraints
     set state = p_state,
         basis = coalesce(v_basis, basis),
         verified_by = case when p_state in ('satisfied', 'not_applicable') then auth.uid() end,
         verified_at = case when p_state in ('satisfied', 'not_applicable') then now() end
   where id = c.id;
  perform set_config('app.package_constraint_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'work_package_constraint', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'work_package_id', p.id,
      'package_code', p.package_code, 'constraint_id', c.id, 'action', 'state_set'),
    v_prev,
    jsonb_build_object('state', p_state, 'verified_by',
      case when p_state in ('satisfied', 'not_applicable') then auth.uid() end,
      'basis', coalesce(v_basis, c.basis)));

  return jsonb_build_object('constraint_id', c.id, 'state', p_state,
    'package_code', p.package_code);
end
$$;

revoke all on function public.clear_package_constraint(uuid, text, text) from public, anon;
grant execute on function public.clear_package_constraint(uuid, text, text) to authenticated;

comment on function public.clear_package_constraint(uuid, text, text) is
  'D7.18 / §70: sets a package constraint''s state. Satisfied requires a verifier (the 2026-09-21 table CHECK) and that verifier must be a PERSON (the §70 wall on verified_by). Permit, isolation and asset-state constraints still cannot be satisfied by hand — Recovery''s rule, preserved rather than exempted — and neither can any row the field-readiness assessment DERIVED from a canonical store: that truth is changed in the store and re-assessed, never toggled here.';

-- ---------------------------------------------------------------------------
-- 4. TENANCY BY GRANT, STATED TRUTHFULLY.
--
--    `sync_field_readiness_elements` said in its own comment that it was
--    revoked from clients, and it was revoked from `public`, `anon` and
--    `authenticated` only — Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE
--    on every new public function to `service_role` as well, so a
--    service-role caller could read any work order's readiness with no org
--    check. No escalation (service_role bypasses RLS anyway), but a stated
--    invariant that is false is worth less than no statement at all.
-- ---------------------------------------------------------------------------
revoke all on function public.sync_field_readiness_elements(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. THE CASE READ, CARRYING PROVENANCE.
--
--    Byte-for-byte 20261210090200:585 apart from two added fields on each
--    constraint item. Slice 7A's own comment set the standard this satisfies:
--    "Offering the control and letting the server refuse would teach the user
--    that the refusal is arbitrary" (src/lib/develop/workPackaging.ts:186).
--    Slice 7B introduced a class of constraint the client could not tell apart
--    — rows DERIVED from a canonical store — so the client was offering
--    "Verify satisfied" on rows the door now refuses. It says which is which.
--
--    The verdict this read renders is still taken VERBATIM and still stated
--    nowhere else: only the item shape changed.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_work_packages(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_packages jsonb;
  v_count int;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'development case not found');
  end if;

  select count(*) into v_count from work_packages
   where organization_id = v_org and development_case_id = c.id;
  if v_count = 0 then
    return jsonb_build_object('answered', false, 'caseId', c.id,
      'refusal', 'No work package has been recorded on this case. The AWP chain (spec II.4) starts with an ENGINEERING package; nothing below it can be recorded until one exists.',
      'chain', jsonb_build_array('engineering', 'procurement', 'construction', 'installation', 'commissioning'));
  end if;

  select coalesce(jsonb_agg(x order by x->>'level', x->>'packageCode'), '[]'::jsonb)
    into v_packages
    from (
      select jsonb_build_object(
        'packageId', p.id,
        'packageCode', p.package_code,
        'title', p.title,
        'packageType', p.package_type,
        'level', sync_awp_level(p.package_type),
        -- THE FACT, NOT THE RULE. `parentType` was computed from
        -- sync_awp_parent_type(p.package_type) — the type the parent OUGHT to
        -- be — while the parent row was joined and only its code read. That
        -- read could not report a mismatch under any circumstances: it
        -- rendered any broken chain as a well-typed one, printing "under
        -- QA-P1 (procurement)" over a QA-P1 that is engineering. The
        -- prescribed type is still reported, beside the actual one, plus an
        -- explicit divergence flag — so this surface can say the chain is
        -- wrong instead of being structurally unable to.
        'parentType', parent.package_type,
        'parentTypeExpected', sync_awp_parent_type(p.package_type),
        'parentTypeDiverges',
          p.parent_package_id is not null
          and parent.package_type is distinct from sync_awp_parent_type(p.package_type),
        'parentPackageId', p.parent_package_id,
        'parentPackageCode', parent.package_code,
        'area', p.area,
        'wbsCode', wbs.wbs_code,
        'scope', p.scope,
        'requiredBy', p.required_by,
        'status', p.status,
        'releasedAt', p.released_at,
        'releaseNote', p.release_note,
        'releasedBy', rel.email,
        'workOrders', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'workOrderId', w.id,
                   'woNumber', w.wo_number,
                   'title', w.title,
                   -- FROM work_orders, the one place this lives.
                   'executionStatus', w.status,
                   'basis', m.assignment_basis)
                   order by w.wo_number nulls last, w.id)
            from work_package_work m
            join work_orders w on w.id = m.work_order_id
           where m.work_package_id = p.id), '[]'::jsonb),
        'constraints', jsonb_build_object(
          -- Both counts come from the ONE verdict predicate rather than being
          -- re-typed here, so "recorded" and "openHard" on the screen are the
          -- same two numbers the release door refuses on.
          'recorded', (v.verdict->>'constraintsRecorded')::int,
          'openHard', (v.verdict->>'openHard')::int,
          'satisfied', (select count(*) from restoration_constraints x
                         where x.work_package_id = p.id and x.state = 'satisfied'),
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'constraintId', x.id,
                     'kind', x.constraint_kind,
                     'state', x.state,
                     'isHard', x.is_hard,
                     'description', x.description,
                     'ownerRole', x.owner_role,
                     'requiredBy', x.required_by,
                     'expectedClearDate', x.expected_clear_date,
                     'probabilityOfClearance', x.probability_of_clearance,
                     'scheduleImpactDays', x.schedule_impact_days,
                     'verifiedAt', x.verified_at,
                     -- PROVENANCE, so the screen can offer the control the
                     -- server will accept. `clear_package_constraint` refuses
                     -- a hand clearance on a row the field-readiness
                     -- assessment DERIVED from a canonical store
                     -- (20261211090200), and a button that is always refused
                     -- teaches the reader that the refusal is arbitrary.
                     'sourceKind', x.source_kind,
                     'sourceRef', x.source_ref)
                     order by x.state, x.constraint_kind, x.id)
              from restoration_constraints x
             where x.work_package_id = p.id), '[]'::jsonb)),
        -- THE READINESS SENTENCE A PERSON ACTS ON, taken VERBATIM from
        -- sync_work_package_release_verdict — the same function
        -- release_work_package refuses through. The first draft of this read
        -- re-implemented the verdict inline over two of the door's five
        -- conditions, so a package with no work orders, a package under an
        -- unreleased parent and a cancelled package all rendered as "Every
        -- hard constraint is cleared; release is a §70 human act and has not
        -- been performed" while the door refused them. See section 6 of
        -- 20261210090100 for the ruling; there is one verdict.
        'readiness', v.verdict->>'reason',
        'readinessVerdict', v.verdict->>'verdict',
        'canRelease', (v.verdict->>'canRelease')::boolean) as x
        from work_packages p
        left join work_packages parent on parent.id = p.parent_package_id
        left join project_wbs_elements wbs on wbs.id = p.wbs_element_id
        left join user_profiles rel on rel.id = p.released_by
        cross join lateral (select sync_work_package_release_verdict(p.id) as verdict) v
       where p.organization_id = v_org and p.development_case_id = c.id) s;

  return jsonb_build_object('answered', true, 'caseId', c.id,
    'packageCount', v_count, 'packages', v_packages,
    'chain', jsonb_build_array('engineering', 'procurement', 'construction', 'installation', 'commissioning'),
    'basis', 'The case''s AWP packages with their typed chain, the work orders they REFERENCE (execution status read from work_orders, which is where it lives) and their §28 constraint position.');
end
$$;

revoke all on function public.get_case_work_packages(uuid) from public, anon;
grant execute on function public.get_case_work_packages(uuid) to authenticated;
