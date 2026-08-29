-- ============================================================================
-- Sync Develop Slice 4A — scope traceability gap detection (D5.02, spec I.6).
--
-- THE ROW'S OWN STANDARD: "the system DETECTS where that chain is broken
-- rather than rendering a tidy tree that hides gaps." So this is not a
-- prettier tree view. It is a deterministic report of every place the chain
-- does not join, in BOTH directions, and it names the deferred links rather
-- than pretending the chain ends where the build stopped.
--
-- ONE PREDICATE, SEVERAL SITES — the 20261122090000 shape, applied again.
-- get_case_scope_traceability is the only implementation of "what is
-- broken". It is consumed by:
--     * the case controls read (get_case_controls, 20261130090600),
--     * the Integrated Controls surface, which renders its arrays verbatim,
--     * compute_case_scope_growth (20261130090600), which records the gaps
--       it hit as REFUSALS on the calculation run.
-- Nothing re-implements "uncovered": what the screen shows and what the
-- calculation refuses over cannot drift, because they are the same rows.
--
-- It therefore has to work for a system caller with no JWT as well as for a
-- client, which is the dual-caller shape get_case_commitment_coverage
-- established: a client is confined to its own tenant; a definer caller has
-- already resolved the case inside a tenant and reads through it; a caller
-- holding a JWT but no organization is refused.
--
-- THE DISCRIMINATOR IS auth.uid(), NOT current_user. Inside a SECURITY
-- DEFINER owned by postgres, current_user IS postgres — a guard written as
-- `current_user in ('authenticated','anon')` can never fire, so a JWT holder
-- with no user_profiles row fell straight through to a query whose org
-- filter that same NULL organization had switched off, and read any case in
-- the database. auth.uid() distinguishes the two callers honestly: a JWT
-- with no organization is refused; no JWT at all is the definer caller.
--
-- THE SEVEN GAPS, and why each is a gap rather than a preference:
--   FORWARD (something upstream leads nowhere)
--     1. need → no requirement      a need nothing implements is a need the
--                                   project is not actually delivering.
--     2. requirement → no WBS       spec I.6's own example: "Requirement
--                                   R-184 does not appear in the WBS."
--     3. WBS → no control account   scope with no cost collection point and
--                                   no accountable person.
--   REVERSE (something downstream came from nowhere — orphans)
--     4. requirement → no need      a requirement nobody traced to a need is
--                                   how scope arrives without being asked
--                                   for.
--     5. WBS → no requirement       an element delivering nothing anybody
--                                   required.
--     6. schedule activity → no WBS spec I.6's own example: "14 schedule
--                                   activities have no authorized scope."
--                                   Both imported and locally authored
--                                   activities are counted; the origin is
--                                   reported per row, because an uncoded P6
--                                   activity and an uncoded Sync-authored
--                                   one are different conversations.
--     7. cost line → no control account
--                                   money outside every roll-up point.
--
--   And the two links this slice deliberately does not build — work package
--   and contract (20261130090000, ruling 2) — are returned as NAMED
--   deferrals with the slice that owns them, so a reader sees a hole in the
--   chain rather than a chain that appears complete because the missing
--   parts were never mentioned.
--
-- NO COMPLETENESS PERCENTAGE IS INVENTED. Where a denominator is zero the
-- report returns NULL, not 100% and not 0% — the get_gate_readiness rule for
-- 0/0, applied to traceability. "There is no chain yet" and "the chain is
-- perfect" must never render the same.
-- ============================================================================

create or replace function public.get_case_scope_traceability(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_org uuid := app_current_org();
  v_org uuid;
  c development_cases%rowtype;
  v_needs_no_req jsonb;
  v_reqs_no_wbs jsonb;
  v_wbs_no_ca jsonb;
  v_reqs_no_need jsonb;
  v_wbs_no_req jsonb;
  v_acts_no_wbs jsonb;
  v_costs_no_ca jsonb;
  v_need_total int;
  v_req_total int;
  v_wbs_total int;
  v_act_total int;
  v_cost_total int;
begin
  if auth.uid() is not null and v_caller_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id
    and (v_caller_org is null or organization_id = v_caller_org);
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  v_org := c.organization_id;

  -- ── 1. Needs with no requirement ─────────────────────────────────────────
  select count(*) into v_need_total
  from project_scope_needs n
  where n.development_case_id = c.id and n.status <> 'withdrawn';

  select coalesce(jsonb_agg(jsonb_build_object(
    'needId', n.id, 'needRef', n.need_ref, 'statement', n.statement,
    'sourceAuthority', n.source_authority,
    'owner', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = n.owner_id))
    order by n.need_ref), '[]'::jsonb)
  into v_needs_no_req
  from project_scope_needs n
  where n.development_case_id = c.id
    and n.status <> 'withdrawn'
    -- ON THIS CASE. Without the case filter a requirement belonging to a
    -- DIFFERENT development case closed the gap: the report then said this
    -- case had zero requirements and simultaneously that this need had one.
    -- (trg_requirement_need_case, 20261130090000, now refuses such a link for
    -- every writer; the filter is the second half of the same fix, because a
    -- report that depends on a wall holding is a report that fails silently
    -- when it does not.)
    and not exists (select 1 from design_requirements d
                     where d.scope_need_id = n.id
                       and d.development_case_id = c.id);

  -- ── 2. Requirements with no WBS element ──────────────────────────────────
  select count(*) into v_req_total
  from design_requirements d where d.development_case_id = c.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category, 'requirement', d.requirement,
    'verificationStatus', d.verification_status,
    'needRef', (select n.need_ref from project_scope_needs n where n.id = d.scope_need_id))
    order by d.requirement_ref), '[]'::jsonb)
  into v_reqs_no_wbs
  from design_requirements d
  where d.development_case_id = c.id
    and not exists (select 1 from project_requirement_wbs l where l.requirement_id = d.id);

  -- ── 3. WBS elements with no control account ──────────────────────────────
  --  A control account collects its whole branch, so an element BELOW one is
  --  covered by it and a summary element ABOVE one rolls up from it. Only a
  --  branch carrying NO control account anywhere — no ancestor, no self, no
  --  descendant — is a gap. Reporting every leaf under a designated account,
  --  or every summary level above one, would be noise dressed as rigour and
  --  would train a reader to ignore the list.
  select count(*) into v_wbs_total
  from project_wbs_elements w where w.development_case_id = c.id;

  with recursive down(id) as (
    select ca.wbs_element_id
      from project_control_accounts ca
     where ca.development_case_id = c.id
    union
    select w.id
      from project_wbs_elements w join down d on w.parent_id = d.id
  ),
  up(id, parent_id) as (
    select w.id, w.parent_id
      from project_wbs_elements w
      join project_control_accounts ca on ca.wbs_element_id = w.id
     where ca.development_case_id = c.id
    union
    select w.id, w.parent_id
      from project_wbs_elements w join up u on w.id = u.parent_id
  ),
  covered(id) as (
    select id from down union select id from up
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'wbsElementId', w.id, 'wbsCode', w.wbs_code, 'title', w.title, 'depth', w.depth)
    order by w.wbs_code), '[]'::jsonb)
  into v_wbs_no_ca
  from project_wbs_elements w
  where w.development_case_id = c.id
    and not exists (select 1 from covered cv where cv.id = w.id);

  -- ── 4. Requirements with no LIVE need (orphan) ───────────────────────────
  --  Gap 1 drops a withdrawn need from the needs list, so if this gap counted
  --  a requirement pointing AT a withdrawn need as traced, the chain would
  --  look complete from both ends while the justification for that
  --  requirement had been withdrawn. The two halves have to agree about what
  --  'withdrawn' means, so they use the same filter.
  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category, 'requirement', d.requirement, 'source', d.source,
    'withdrawnNeedRef', (select n.need_ref from project_scope_needs n
                          where n.id = d.scope_need_id and n.status = 'withdrawn'))
    order by d.requirement_ref), '[]'::jsonb)
  into v_reqs_no_need
  from design_requirements d
  where d.development_case_id = c.id
    and (d.scope_need_id is null
         or not exists (select 1 from project_scope_needs n
                         where n.id = d.scope_need_id
                           and n.development_case_id = c.id
                           and n.status <> 'withdrawn'));

  -- ── 5. WBS elements no requirement reaches (orphan) ──────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
    'wbsElementId', w.id, 'wbsCode', w.wbs_code, 'title', w.title,
    'scopeDescription', w.scope_description)
    order by w.wbs_code), '[]'::jsonb)
  into v_wbs_no_req
  from project_wbs_elements w
  where w.development_case_id = c.id
    and not exists (select 1 from project_requirement_wbs l where l.wbs_element_id = w.id);

  -- ── 6. Schedule activities with no authorized scope (orphan) ─────────────
  select count(*) into v_act_total
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = v_org and e.development_case_id = c.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'activityId', t.id, 'activityKey', t.task_key, 'label', t.label,
    'origin', t.origin, 'sourceSystem', t.source_system,
    -- The verbatim P6 string, so a reader can see the code that was NOT
    -- resolved rather than only that nothing was resolved.
    'wbsPath', t.wbs_path, 'schedule', e.title, 'durationHours', t.duration_hours)
    order by t.task_key), '[]'::jsonb)
  into v_acts_no_wbs
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = v_org and e.development_case_id = c.id
    and t.wbs_element_id is null;

  -- ── 7. Cost lines outside every control account (orphan) ─────────────────
  select count(*) into v_cost_total
  from project_cost_items ci where ci.development_case_id = c.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'costItemId', ci.id, 'costItemRef', ci.cost_item_ref,
    'description', ci.description,
    'wbsCode', (select w.wbs_code from project_wbs_elements w where w.id = ci.wbs_element_id),
    'baselineCost', ci.baseline_cost, 'forecast', ci.forecast, 'currency', ci.currency)
    order by ci.cost_item_ref), '[]'::jsonb)
  into v_costs_no_ca
  from project_cost_items ci
  where ci.development_case_id = c.id and ci.control_account_id is null;

  return jsonb_build_object(
    'caseId', c.id,
    'chain', jsonb_build_array(
      jsonb_build_object('link', 'business need', 'home', 'project_scope_needs', 'built', true, 'count', v_need_total),
      jsonb_build_object('link', 'requirement', 'home', 'design_requirements', 'built', true, 'count', v_req_total),
      -- The System link is OPTIONAL by design ("not every element serves a
      -- single system", 20261130090000): a count of 0 is not a gap and there
      -- is no gap class for it. It is `built` because a caller can populate
      -- it — record_wbs_element takes system_node_id, validates it against
      -- the ONE five-level tree and refuses a node outside the tenant's
      -- subtree, and the Integrated Controls WBS form offers the choice.
      jsonb_build_object('link', 'system', 'home', 'organizations (org_level=system)', 'built', true,
        'count', (select count(*) from project_wbs_elements w
                   where w.development_case_id = c.id and w.system_node_id is not null),
        'optional', true),
      jsonb_build_object('link', 'WBS', 'home', 'project_wbs_elements', 'built', true, 'count', v_wbs_total),
      -- The two named holes. Rendered as part of the chain so the gap is
      -- visible, with the slice that owns each.
      jsonb_build_object('link', 'work package', 'home', 'work_orders + AWP package (D7.17)',
        'built', false, 'count', null,
        'deferral', 'Work packages are Slice 7 (overlap-map ruling 8: work_orders stays the work identity and the AWP package wraps it). Until then the chain jumps from WBS to schedule activity, and this report says so rather than hiding the jump.'),
      jsonb_build_object('link', 'contract', 'home', 'contract_packages (D6.05/D6.08)',
        'built', false, 'count', null,
        'deferral', 'Contract award lands in Slice 6. No contract link is asserted here, and none is implied by the links either side of it.'),
      jsonb_build_object('link', 'schedule activity', 'home', 'shutdown_tasks (P6 door)', 'built', true, 'count', v_act_total),
      jsonb_build_object('link', 'cost', 'home', 'project_cost_items', 'built', true, 'count', v_cost_total),
      jsonb_build_object('link', 'control account', 'home', 'project_control_accounts', 'built', true,
        'count', (select count(*) from project_control_accounts ca where ca.development_case_id = c.id))
    ),
    'forwardGaps', jsonb_build_object(
      'needsWithoutRequirement', v_needs_no_req,
      'requirementsWithoutWbs', v_reqs_no_wbs,
      'wbsElementsWithoutControlAccount', v_wbs_no_ca),
    'orphans', jsonb_build_object(
      'requirementsWithoutNeed', v_reqs_no_need,
      'wbsElementsWithoutRequirement', v_wbs_no_req,
      'scheduleActivitiesWithoutScope', v_acts_no_wbs,
      'costItemsOutsideAControlAccount', v_costs_no_ca),
    'totals', jsonb_build_object(
      'needs', v_need_total, 'requirements', v_req_total, 'wbsElements', v_wbs_total,
      'scheduleActivities', v_act_total, 'costItems', v_cost_total),
    'brokenLinkCount',
      jsonb_array_length(v_needs_no_req) + jsonb_array_length(v_reqs_no_wbs)
      + jsonb_array_length(v_wbs_no_ca) + jsonb_array_length(v_reqs_no_need)
      + jsonb_array_length(v_wbs_no_req) + jsonb_array_length(v_acts_no_wbs)
      + jsonb_array_length(v_costs_no_ca),
    -- NULL over an empty chain: "nothing recorded" and "nothing broken" are
    -- not the same answer and must not render as the same number.
    'requirementsTracedPct', case when v_req_total = 0 then null
      else round(100.0 * (v_req_total - jsonb_array_length(v_reqs_no_wbs)) / v_req_total, 1) end,
    'activitiesWithScopePct', case when v_act_total = 0 then null
      else round(100.0 * (v_act_total - jsonb_array_length(v_acts_no_wbs)) / v_act_total, 1) end);
end
$$;

revoke all on function public.get_case_scope_traceability(uuid) from public, anon;
grant execute on function public.get_case_scope_traceability(uuid) to authenticated, service_role;

comment on function public.get_case_scope_traceability(uuid) is
  'D5.02 (spec I.6): THE scope traceability predicate. Deterministic, bidirectional, and the only implementation — the controls read, the Integrated Controls surface and compute_case_scope_growth all consume this function rather than re-deriving "uncovered".';

notify pgrst, 'reload schema';
