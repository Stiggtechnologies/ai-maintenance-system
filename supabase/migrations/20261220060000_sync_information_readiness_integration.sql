-- D11.09: close the formerly missing Sync Information readiness leg by
-- composing the canonical D11.23 Information Readiness Index. This remains a
-- composition: no readiness facts, weights, score, or authority are copied.

create or replace function public.get_case_information_engine(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_continuity jsonb;
  v_receipts jsonb;
  v_readiness jsonb;
  v_edges jsonb;
  v_audit jsonb;
  v_docs jsonb;
  v_doc_total int := 0;
  v_doc_released int := 0;
  v_refusals jsonb := '[]'::jsonb;
  v_live_edges int;
  v_absent_edges int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- Legs 1 and 3 are canonical reads, included whole rather than recomputed.
  v_continuity := check_thread_continuity(c.id);
  v_receipts := get_case_thread_receipts(c.id);
  v_readiness := get_case_information_readiness_index(c.id);

  -- Leg 2 remains the document-control projection over the canonical thread.
  select coalesce(jsonb_agg(jsonb_build_object(
      'objectKind', t.object_kind,
      'count', t.n,
      'withAuthoritativeVersion', t.released) order by t.object_kind), '[]'::jsonb),
      coalesce(sum(t.n)::int, 0), coalesce(sum(t.released)::int, 0)
    into v_docs, v_doc_total, v_doc_released
    from (
      select o.object_kind,
             count(*)::int n,
             count(*) filter (where exists (
               select 1 from thread_object_versions v
                where v.thread_object_id = o.id and v.status = 'authoritative'))::int released
        from thread_objects o
       where o.organization_id = v_org
         and o.development_case_id = c.id
         and o.status = 'live'
         and o.object_kind in ('vendor_document', 'drawing', 'equipment_specification',
                               'requirement', 'commissioning_test')
       group by o.object_kind) t;

  v_edges := sync_spec34_edges();
  v_audit := sync_spec34_absent_edge_audit();
  select count(*) filter (where x ->> 'status' <> 'absent')::int,
         count(*) filter (where x ->> 'status' = 'absent')::int
    into v_live_edges, v_absent_edges
    from jsonb_array_elements(v_edges) x;

  if v_absent_edges > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      '%s of spec §34''s nineteen core relationships are ABSENT, so no traversal over this graph is a traversal over all of §34. The audit names every unresolved relationship and any endpoint that has since become closable.',
      v_absent_edges)::text);
  end if;
  if coalesce((v_audit ->> 'newlyClosableCount')::int, 0) > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      '%s relationship(s) recorded as absent now have their closing endpoint in the canonical schema. The §34 ledger must be reconciled before this module can be complete.',
      (v_audit ->> 'newlyClosableCount'))::text);
  end if;
  if coalesce((v_continuity ->> 'refused')::boolean, false)
     or v_continuity ? 'error' then
    v_refusals := v_refusals || to_jsonb(
      'The digital-thread leg REFUSED for this case rather than reporting zero breaks over an empty CDE — see the continuity payload for which empty it is.'::text);
  end if;
  if v_doc_total > 0 and v_doc_released < v_doc_total then
    v_refusals := v_refusals || to_jsonb(format(
      '%s of %s document-bearing thread objects on this case have NO released revision. A documentation figure that counted them as present would be counting folders, not controlled documents.',
      v_doc_total - v_doc_released, v_doc_total)::text);
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'engine', 'Sync Information',
    -- No composite score: readiness keeps its exact §47 ratio and hard-blocker
    -- status; thread and documentation remain evidence states, not percentages.
    'legs', jsonb_build_object(
      'digitalThread', jsonb_build_object(
        'built', true,
        'continuity', v_continuity,
        'receipts', v_receipts),
      'documentation', jsonb_build_object(
        'built', true,
        'objectsByKind', v_docs,
        'documentBearingObjects', v_doc_total,
        'withReleasedRevision', v_doc_released),
      'assetDataReadiness', jsonb_build_object(
        'built', true,
        'registerRows', jsonb_build_array('D11.08', 'D11.23'),
        'project', v_readiness -> 'project',
        'systems', v_readiness -> 'systems',
        'hardBlockers', v_readiness -> 'hardBlockers',
        'formula', v_readiness -> 'formula',
        'hardBlockerRule', v_readiness -> 'hardBlockerRule',
        'decisionBoundary', v_readiness -> 'decisionBoundary')),
    'graph', jsonb_build_object(
      'spec34Edges', v_edges,
      'liveEdgeCount', v_live_edges,
      'absentEdgeCount', v_absent_edges,
      'absentEdgeAudit', v_audit),
    'refusals', v_refusals,
    'complete', v_absent_edges = 0
      and coalesce((v_audit ->> 'newlyClosableCount')::int, 0) = 0,
    'headline', format(
      'Sync Information composes the digital thread, controlled documentation and the governed §47 Information Readiness Index. No composite score is produced. %s of §34''s nineteen relationships remain recorded as absent.',
      v_absent_edges));
end
$$;

revoke all on function public.get_case_information_engine(uuid) from public, anon;
grant execute on function public.get_case_information_engine(uuid) to authenticated, service_role;

comment on function public.get_case_information_engine(uuid) is
  'D11.09 / II.engines: composes the canonical digital-thread reads, controlled-document projection and D11.23 §47 Information Readiness Index without copying facts or averaging unlike states. Runtime completeness remains false while the canonical §34 ledger has absent or newly closable relationships. The read grants no handover, regulatory, safety, release or approval authority.';

notify pgrst, 'reload schema';
