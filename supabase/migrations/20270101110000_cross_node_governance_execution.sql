-- ============================================================================
-- D11.14 closure — execute an adopted ancestor framework at a descendant node.
--
-- The organization tree already resolves governance downward.  Until this
-- migration, the case/gate paths then required every definition row to be
-- owned by the case's node, leaving a correctly resolved ancestor framework
-- unusable.  This closes that seam without copying configuration:
--
--   * project_frameworks, stages, gates and criteria remain owned once by the
--     node that authored and adopted them;
--   * a descendant may SELECT only an ADOPTED framework in its ancestry;
--   * every execution path pins the requested gate/criterion to the case's
--     governing framework before acting;
--   * cases, evidence, reviews, waivers, decisions and audit rows remain owned
--     by the descendant organization;
--   * framework authoring/adoption remains owner-only and human gate decisions
--     retain every existing role, independence and persistence backstop.
-- ============================================================================

create or replace function public.framework_operable_for_org(
  p_framework_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_framework_id is not null
     and p_organization_id is not null
     and exists (
       select 1
       from project_frameworks f
       join org_ancestry(p_organization_id) a
         on a.node_id = f.organization_id
       where f.id = p_framework_id
         and f.status = 'adopted'
     )
$$;

revoke all on function public.framework_operable_for_org(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.framework_operable_for_org(uuid, uuid)
  to service_role;

comment on function public.framework_operable_for_org(uuid, uuid) is
  'D11.14: true only when the framework is adopted and owned by the named organization or one of its ancestors. This is scope, never authoring authority.';

create or replace function public.framework_visible_to_current_org(
  p_framework_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select framework_operable_for_org(p_framework_id, app_current_org())
$$;

revoke all on function public.framework_visible_to_current_org(uuid)
  from public, anon;
grant execute on function public.framework_visible_to_current_org(uuid)
  to authenticated, service_role;

comment on function public.framework_visible_to_current_org(uuid) is
  'D11.14 RLS predicate: exposes an adopted framework only down its organization ancestry. It reveals no draft and grants no write authority.';

-- Definition reads flow down the tree.  Writes still have no client policy
-- and the authoring RPCs continue to require organization_id = app_current_org().
drop policy if exists project_frameworks_read on public.project_frameworks;
create policy project_frameworks_read on public.project_frameworks
  for select to authenticated
  using (
    organization_id = app_current_org()
    or framework_visible_to_current_org(id)
  );

drop policy if exists project_framework_stages_read on public.project_framework_stages;
create policy project_framework_stages_read on public.project_framework_stages
  for select to authenticated
  using (
    organization_id = app_current_org()
    or framework_visible_to_current_org(framework_id)
  );

drop policy if exists stage_gates_read on public.stage_gates;
create policy stage_gates_read on public.stage_gates
  for select to authenticated
  using (
    organization_id = app_current_org()
    or framework_visible_to_current_org(framework_id)
  );

drop policy if exists sgc_read on public.stage_gate_criteria;
create policy sgc_read on public.stage_gate_criteria
  for select to authenticated
  using (
    organization_id = app_current_org()
    or exists (
      select 1
      from stage_gates g
      where g.id = stage_gate_criteria.gate_id
        and framework_visible_to_current_org(g.framework_id)
    )
  );

-- The execution functions below have accumulated controls across many later
-- slices.  Replacing their complete bodies here would fork those controls.
-- Transform the live definition instead, with fail-closed anchors: if any
-- upstream function has drifted, this migration aborts rather than applying a
-- partial scope change.
create or replace function public._d1114_replace_function(
  p_signature text,
  p_old text,
  p_new text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_oid regprocedure;
  v_definition text;
  v_next text;
begin
  v_oid := to_regprocedure(p_signature);
  if v_oid is null then
    raise exception 'D11.14 migration: function % is missing', p_signature;
  end if;
  select pg_get_functiondef(v_oid) into v_definition;
  if position(p_old in v_definition) = 0 then
    raise exception 'D11.14 migration: anchor not found in %', p_signature;
  end if;
  v_next := replace(v_definition, p_old, p_new);
  if v_next = v_definition then
    raise exception 'D11.14 migration: transformation did not change %', p_signature;
  end if;
  execute v_next;
end
$$;

revoke all on function public._d1114_replace_function(text, text, text)
  from public, anon, authenticated;

-- Case creation: an implicit resolution and an explicit selection both use
-- the same adopted-ancestor scope predicate.  A sibling/descendant/foreign
-- framework remains indistinguishable from not found.
select public._d1114_replace_function(
  'public.create_development_case(text,text,text,text,uuid,uuid,text,numeric,numeric,uuid,uuid)',
  $old$  -- D11.14: a case created without an explicit framework resolves one by
  -- walking up the organization tree. Resolution is the ADOPTED version of
  -- the attached profile's framework name (see this file's header); a tree
  -- that resolves nothing leaves the case ungoverned exactly as before —
  -- inheritance adds governance, it never invents it. A resolution whose
  -- framework is OWNED by an ancestor node is reported, not silently used:
  -- the gate machinery and the framework read surface are org-scoped to the
  -- case's own node, so an ancestor-owned framework is not yet operable
  -- here — get_case_governance renders the same resolution with the same
  -- note, and cross-node framework operation is named future work
  -- (register D11.14), never a silent half-governed case.$old$,
  $new$  -- D11.14: a case created without an explicit framework resolves the
  -- adopted version attached at the nearest node in its ancestry. The
  -- framework definition remains owned once by its authoring node while the
  -- case and every execution record remain owned by the descendant. A tree
  -- that resolves nothing still leaves the case ungoverned; inheritance adds
  -- governance, it never invents it.$new$
);

select public._d1114_replace_function(
  'public.create_development_case(text,text,text,text,uuid,uuid,text,numeric,numeric,uuid,uuid)',
  $old$
      if exists (select 1 from project_frameworks pf
                 where pf.id = v_resolved.framework_id and pf.organization_id = v_org) then
        v_framework_id := v_resolved.framework_id;
        v_inherited_from := v_resolved.source_node_id;
      else
        insert into audit_events (organization_id, entity_type, actor, event_data)
        values (v_org, 'development_case', coalesce(v_role, 'unknown'),
          jsonb_build_object('action', 'framework_inheritance_not_operable',
            'resolved_framework_id', v_resolved.framework_id,
            'source_node_id', v_resolved.source_node_id));
      end if;
$old$,
  $new$
      v_framework_id := v_resolved.framework_id;
      v_inherited_from := v_resolved.source_node_id;
$new$
);

select public._d1114_replace_function(
  'public.create_development_case(text,text,text,text,uuid,uuid,text,numeric,numeric,uuid,uuid)',
  $old$    select * into f from project_frameworks
    where id = v_framework_id and organization_id = v_org;
    if not found then
      return jsonb_build_object('error', 'framework not found in this organization');
    end if;$old$,
  $new$    select * into f from project_frameworks where id = v_framework_id;
    if not found or not framework_operable_for_org(v_framework_id, v_org) then
      return jsonb_build_object('error', 'framework not found in this organization or its ancestry');
    end if;$new$
);

-- The governance workspace must state the same truth as the act site.
select public._d1114_replace_function(
  'public.get_case_governance(uuid)',
  $old$'operableHere', fw.organization_id = v_org$old$,
  $new$'operableHere', framework_operable_for_org(fw.id, v_org)$new$
);

-- Every gate act first loads the caller-owned case, then accepts only a gate
-- whose framework_id equals that case's framework_id.  The former gate-owner
-- predicate was therefore redundant for isolation and fatal to inheritance.
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.case_gate_outstanding_obligations(uuid,bigint)',
    'public.gate_review_sod_position(uuid,bigint,uuid)',
    'public.get_gate_readiness(uuid,bigint)',
    'public.get_gate_review_pack(uuid,bigint)',
    'public.open_gate_review(uuid,bigint)',
    'public.record_case_gate_review(uuid,bigint,text,text,jsonb,jsonb,uuid,text)',
    'public.record_gate_agent_report(uuid,bigint,text,text)'
  ] loop
    perform public._d1114_replace_function(
      v_signature,
      'select * into g from stage_gates where id = p_gate_id and organization_id = v_org;',
      'select * into g from stage_gates where id = p_gate_id;'
    );
  end loop;
end
$$;

-- Requirement acts are likewise pinned through requirement -> gate -> the
-- case framework.  Remove only the definition-owner equality; case-owned
-- deliverables, waivers, evidence and reviews keep their tenant predicates.
select public._d1114_replace_function(
  'public.create_case_deliverable(uuid,text,text,uuid,bigint,date,text)',
  'where id = p_requirement_id and organization_id = v_org;',
  'where id = p_requirement_id;'
);

select public._d1114_replace_function(
  'public.request_gate_requirement_waiver(uuid,bigint,text,text,uuid,timestamp with time zone)',
  'where id = p_requirement_id and organization_id = v_org;',
  'where id = p_requirement_id;'
);

select public._d1114_replace_function(
  'public.record_assurance_claim(uuid,jsonb)',
  'where sc.id = v_req and sc.organization_id = v_org and g.framework_id = c.framework_id',
  'where sc.id = v_req and g.framework_id = c.framework_id'
);

select public._d1114_replace_function(
  'public.record_case_assurance_review(uuid,jsonb)',
  'where g.id = v_gate and g.organization_id = v_org',
  'where g.id = v_gate'
);

-- Readiness and decision recording enumerate the governing gate's criteria.
-- The gate/framework pin above is the scope boundary; result rows continue to
-- be written with v_org (the descendant case owner).
select public._d1114_replace_function(
  'public.get_gate_readiness(uuid,bigint)',
  'where sc.organization_id = v_org and sc.gate_id = g.id',
  'where sc.gate_id = g.id'
);

select public._d1114_replace_function(
  'public.record_case_gate_review(uuid,bigint,text,text,jsonb,jsonb,uuid,text)',
  'and sc.organization_id = v_org and sc.gate_id = p_gate_id',
  'and sc.gate_id = p_gate_id'
);
select public._d1114_replace_function(
  'public.record_case_gate_review(uuid,bigint,text,text,jsonb,jsonb,uuid,text)',
  'where organization_id = v_org and gate_id = p_gate_id;',
  'where gate_id = p_gate_id;'
);
select public._d1114_replace_function(
  'public.record_case_gate_review(uuid,bigint,text,text,jsonb,jsonb,uuid,text)',
  'where sc.organization_id = v_org and sc.gate_id = p_gate_id and sc.is_mandatory',
  'where sc.gate_id = p_gate_id and sc.is_mandatory'
);

-- Intensity bindings remain descendant-owned.  Only the mandatory definition
-- rows they apply to may now come from the governing ancestor framework.
select public._d1114_replace_function(
  'public.case_binding_gate_demands(uuid,bigint[])',
  'where sc.organization_id = v_gov.organization_id
        and sc.gate_id = any(v_gates)',
  'where sc.gate_id = any(v_gates)'
);

-- Lifecycle-success phase/gate definitions come from the case framework;
-- review rows still come exclusively from the descendant case organization.
select public._d1114_replace_function(
  'public.get_case_lifecycle_success(uuid)',
  'and sg.organization_id = v_org',
  ''
);
select public._d1114_replace_function(
  'public.get_case_lifecycle_success(uuid)',
  'and s.organization_id = v_org',
  ''
);

drop function public._d1114_replace_function(text, text, text);

notify pgrst, 'reload schema';
