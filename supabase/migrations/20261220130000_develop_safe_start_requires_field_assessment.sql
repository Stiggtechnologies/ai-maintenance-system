-- Sync Develop D7.06 — a package nobody walked is NOT safe to start.
--
-- Extend the ONE canonical release verdict. Do not add a second checklist,
-- release door, or screen-side rule. `release_work_package`,
-- `get_case_work_packages`, `get_package_field_readiness`,
-- `get_execution_readiness_board` and the composed Field module already read
-- this predicate verbatim.
--
-- A generic constraint row proves only that somebody considered that one
-- constraint. It is not evidence that the ten §27 field-ready elements were
-- walked for every work order. Only a COMPUTED `package_field_readiness` run
-- proves that assessment occurred; a refused run is deliberately excluded.

do $safe_start$
declare
  v_def text;
  v_new text;
  v_anchor text := $anchor$  if v_run.id is not null then
    v_gaps := sync_work_package_field_readiness_gaps(p.id);$anchor$;
  v_replacement text := $replacement$  if v_run.id is null then
    return jsonb_build_object('verdict', 'field_unassessed', 'canRelease', false,
      'packageCode', p.package_code, 'constraintsRecorded', v_total,
      'openHard', 0, 'workOrders', v_work,
      'reason', format('NOT READY — no field-readiness assessment has been completed for work package %s. Cleared constraints are not evidence that somebody walked the drawing, material, access, labour, crane, permit, isolation, scaffold, predecessor and inspection position for every work order. Assess the package first.',
        p.package_code));
  end if;

  if v_run.id is not null then
    v_gaps := sync_work_package_field_readiness_gaps(p.id);$replacement$;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'sync_work_package_release_verdict'
     and pg_get_function_identity_arguments(p.oid) = 'p_package_id bigint';

  if v_def is null then
    raise exception 'sync_work_package_release_verdict(bigint) is missing';
  end if;

  if position('field_unassessed' in v_def) > 0 then
    null; -- idempotent replay
  else
    v_new := replace(v_def, v_anchor, v_replacement);
    if v_new = v_def
       or position('field_unassessed' in v_new) = 0
       or position('r.status = ''computed''' in v_new) = 0 then
      raise exception
        'refusing D7.06 patch: the governed verdict is not in the Slice 7B predecessor shape';
    end if;
    execute v_new;
  end if;
end
$safe_start$;

comment on function public.sync_work_package_release_verdict(bigint) is
  'D7.06/D7.11: THE release verdict for one §27 work package. It refuses cancelled, released, constraint-unassessed, empty, parent-unreleased, not-ready, FIELD-UNASSESSED and stale packages; only a package with a computed field-readiness assessment whose recorded constraint set remains current can reach ready_for_human. A refused calculation run is not an assessment. release_work_package refuses through this function and every read renders its reason verbatim. Revoked from clients and called only inside tenant-gated definers.';

notify pgrst, 'reload schema';
