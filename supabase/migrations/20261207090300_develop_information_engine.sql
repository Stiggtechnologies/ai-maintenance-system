-- ============================================================================
-- Sync Develop Slice 5D — §34's absent edges made FALSIFIABLE, and the
-- Sync Information engine composed
--   D11.21  core graph relationship set (spec III.§34)
--   D11.09  Sync Information engine (spec II.engines)
--
-- ── RULING 5D-R16 — ONE OF THE FIVE ABSENT EDGES IS NOT ABSENT ───────────
--
-- Slice 5C's ledger names five of §34's nineteen relationships as ABSENT
-- because an endpoint OBJECT is unbuilt. Every one was re-checked against the
-- LIVE SCHEMA before writing this file — by asking the catalogue, not by
-- reading the prose — and one of the five was wrong:
--
--   Benefit MEASURES Objective — CLOSED HERE. `value_metrics.objective_id`
--     exists and has since Slice 2 (`20261115090600_develop_benefit_owner.sql`,
--     register row D9.10 ✅), which lands §32's Benefit on the ONE value store
--     per overlap ruling 11 with owner, objective, expected date and basis, a
--     schema CHECK no writer gets past, and `record_case_benefit` as the
--     governed door. D9.10's own evidence names this edge by name — "objective_id
--     (adopted objectives only — Benefit MEASURES Objective, §34)". Slice 5C's
--     ledger said "spec §32 Benefit is not built" about an object this register
--     already carried as ✅, and this file moves the edge to `live_elsewhere`
--     with `value_metrics` as its canonical home. It is corrected by
--     TRANSFORMATION of the live `sync_spec34_edges` body rather than by
--     re-typing nineteen entries, so nothing else in that ledger can drift.
--
-- The finding is worth stating plainly: the claim was prose, nothing checked
-- it, and it survived a slice. That is why the audit below exists.
--
-- The other four are still absent, checked the same way:
--
--   WorkPackage DEPENDS_ON Constraint — §27's WorkPackage is unbuilt. The
--     overlap map rules `work_orders` the work IDENTITY and
--     `restoration_constraints` the Constraint, and a TWO-HOP path does exist:
--     restoration_constraints.event_work_id → restoration_event_work.work_order_id
--     → work_orders. That is Recovery's event work, and a transitive path is not
--     the edge — the same standard 5C applied to Asset SUPPORTS Objective, applied
--     here so the ledger does not use one rule in one row and another in the next.
--     Emitting a WorkPackageBlocked event from `work_orders` (20261207090000) does
--     not create the edge either, and this file does not pretend it does.
--
--   Contract PROVIDES Asset — `contract_packages` exists; no contract→asset
--     relation does. §24's Contract award side lands with procurement (Slice 6).
--
--   Asset SUPPORTS Objective — no stored asset→objective relation. Reachable
--     transitively (asset ← case → objective, or asset ← requirement →
--     objective) and a transitive path is not the edge.
--
--   Lesson APPLIES_TO AssetClass — the ASSET-CLASS end exists (`assets.asset_class`,
--     `assets.asset_class_id`); the LESSON end does not. The canonical Lesson is
--     `learning_events` (overlap ruling 9) and it carries no applicability field
--     and no asset-class reference. §33's Lesson/FRACAS object is not built
--     (D9.11), so the gap is on the tail of the edge, not the head.
--
-- So D11.21 stays 🟡 and this file adds the one thing that was actually
-- missing: THE LEDGER'S ABSENCE CLAIM IS NOW CHECKED RATHER THAN ASSERTED.
--
-- `sync_spec34_absent_edge_audit()` names, for each absent edge, the exact
-- table and column whose existence would close it, and asks the catalogue.
-- Today it returns FOUR edges still absent and zero newly closable — the fifth
-- was `value_metrics.objective_id`, which this file proves already exists and
-- therefore closes. When Slice 6 adds a contract→asset relation, or Slice 9
-- puts an applicability field on `learning_events`, this function says so and
-- the prose in `sync_spec34_edges` is provably stale rather than quietly
-- wrong. A register row whose "not built" survives the thing being built is
-- the failure mode this program has hit repeatedly; this makes that state
-- detectable by a query instead of by somebody remembering. It is the reason
-- the sentence above counts with a variable rather than spelling a number:
-- the first draft of this very file said "four ... the five are named".
--
-- ── RULING 5D-R17 — THE INFORMATION ENGINE COMPOSES; IT DOES NOT RE-ASK ──
--
-- II.engines: "Sync Information — digital thread, documentation, asset-data
-- readiness." `get_case_information_engine` composes the shipped reads —
-- `check_thread_continuity`, `get_case_thread_receipts`, `sync_spec34_edges`
-- — and computes NOTHING they already answer. The documentation leg is the
-- one thing it derives, and it derives it from the same thread rows the other
-- two read.
--
-- AND IT REFUSES ON THE THIRD LEG. Asset-data readiness is D11.08/D11.23 —
-- the Information Readiness Index §47 with its hard blockers — and it is NOT
-- BUILT. The composition names that leg as missing and produces no readiness
-- percentage for it. Averaging two legs and calling it an engine score is the
-- exact move `allocateAvailability` refuses and the six-axis scorecard refuses;
-- a composed module gets no exemption from it.
--
-- D11.09 therefore moves ❌ → 🟡, not ✅: two of its three legs are 🟡
-- themselves, and a composition of incomplete parts is incomplete.
--
-- Canonical reuse: check_thread_continuity, get_case_thread_receipts,
-- sync_spec34_edges, thread_objects, thread_object_versions,
-- thread_change_receipts, development_cases, app_current_org().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- THE ONE EDGE THAT CLOSES (ruling 5D-R16). Corrected BY TRANSFORMATION of the
-- live `sync_spec34_edges` body, never by re-typing nineteen entries: this
-- ledger is the D11.21 row's evidence, and a slice that retypes it is a slice
-- that can silently revert an entry it never meant to touch.
-- ---------------------------------------------------------------------------
do $spec34$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_spec34_edges';
  if v_def is null then
    raise exception
      'sync_spec34_edges does not exist — the Slice 5C ledger this file corrects is missing, and writing a second ledger instead is forbidden.'
      using errcode = 'check_violation';
  end if;
  -- Guard against correcting an edge whose endpoint really is unbuilt: the
  -- catalogue is asked, not the prose.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'value_metrics'
                    and column_name = 'objective_id') then
    raise exception
      'value_metrics.objective_id does not exist, so Benefit MEASURES Objective is genuinely absent and this correction would be the false claim it exists to remove.'
      using errcode = 'check_violation';
  end if;
  if position('value_metrics.objective_id' in v_def) > 0 then
    null;  -- already corrected by a previous run of this migration
  else
    v_new := replace(v_def,
      $old$'home','none — spec §32 Benefit is not built','status','absent',$old$,
      $new$'home','value_metrics.objective_id (20261115090600, register row D9.10)','status','live_elsewhere',$new$);
    if v_new = v_def then
      raise exception
        'the Benefit MEASURES Objective entry of sync_spec34_edges was not found in the shape Slice 5C left it — do not edit a ledger blind; re-derive this correction against the current body.'
        using errcode = 'check_violation';
    end if;
    v_new := replace(v_new,
      $old$'note','Benefits realization is II.23/§32 and unbuilt. Naming the edge without the object would be the claim this register exists to refuse.'$old$,
      $new$'note','CORRECTED 20261207090300: §32''s Benefit IS built, on the ONE value store per overlap ruling 11 — owner_id, objective_id, expected_date and basis with a schema CHECK no writer gets past and record_case_benefit as the governed door (D9.10 ✅). 5C recorded this edge as absent from prose that nothing checked. Its count stays null: value_metrics has its own reads and this ledger does not re-implement them.'$new$);
    if position('CORRECTED 20261207090300' in v_new) = 0 then
      raise exception
        'the Benefit MEASURES Objective note of sync_spec34_edges was not found — a ledger whose status and whose note disagree is worse than one that is simply wrong, so this fails rather than moving the status alone.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$spec34$;

-- SECURITY DEFINER, deliberately. This function asks `information_schema`,
-- and information_schema filters by the CALLING role's privileges — so the
-- same question asked directly by `authenticated` and asked inside
-- `get_case_information_engine` (a definer, running as the owner) could return
-- different answers about whether an edge is closable. Two answers to one
-- question is the exact defect this function exists to make impossible, so it
-- runs as one role for every caller.
create or replace function public.sync_spec34_absent_edge_audit()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_row record;
  v_present boolean;
begin
  for v_row in
    select * from (values
      ('WorkPackage DEPENDS_ON Constraint',
       'restoration_constraints', 'work_order_id',
       'spec §27 WorkPackage is unbuilt. A two-hop path exists (restoration_constraints.event_work_id → restoration_event_work.work_order_id) and a transitive path is not the edge. This closes when the canonical Constraint store names the canonical work identity directly.'),
      ('Contract PROVIDES Asset',
       'contract_packages', 'asset_id',
       'spec §24 Contract''s award side lands with procurement (D6.05/D6.08, Slice 6). This edge closes when a contract row can name the asset it provides.'),
      ('Asset SUPPORTS Objective',
       'assets', 'objective_id',
       'No asset→objective relation is stored. The transitive path through a case or a requirement is not the edge, and this ledger does not claim it is.'),
      ('Lesson APPLIES_TO AssetClass',
       'learning_events', 'applicability',
       'The asset-class END exists (assets.asset_class_id); the LESSON end does not. The canonical Lesson is `learning_events` (overlap ruling 9) and it carries no applicability field. This closes when §33''s applicability lands there (D9.11).')
    ) as t(edge, tbl, col, why)
  loop
    select exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = v_row.tbl
         and column_name = v_row.col) into v_present;
    v_out := v_out || jsonb_build_object(
      'edge', v_row.edge,
      'closesWhen', format('public.%s.%s exists', v_row.tbl, v_row.col),
      'columnPresent', v_present,
      'stillAbsent', not v_present,
      'why', v_row.why);
  end loop;
  return jsonb_build_object(
    'checkedAt', now(),
    'absentEdgeCount', (select count(*) from jsonb_array_elements(v_out) x
                         where (x ->> 'stillAbsent')::boolean),
    'newlyClosableCount', (select count(*) from jsonb_array_elements(v_out) x
                            where (x ->> 'columnPresent')::boolean),
    'edges', v_out,
    'note', 'D11.21 ruling 5D-R16. `sync_spec34_edges` states FOUR of §34''s nineteen relationships as ABSENT (five until this file closed Benefit MEASURES Objective on value_metrics.objective_id); this asks the catalogue whether that is still true. `newlyClosableCount` above zero means the endpoint got built and the ledger''s prose is stale — which is a fact a query can now find rather than one somebody has to remember.');
end
$$;

revoke all on function public.sync_spec34_absent_edge_audit() from public, anon;
grant execute on function public.sync_spec34_absent_edge_audit() to authenticated, service_role;

comment on function public.sync_spec34_absent_edge_audit() is
  'D11.21 / spec III.§34 ruling 5D-R16: makes the remaining FOUR absent edges falsifiable — the fifth, Benefit MEASURES Objective, was found already built and is closed by this file. For each one it names the table and column whose existence would close it and asks information_schema. Four absent and zero newly closable is today''s honest answer; the moment Slice 6 or Slice 9 builds an endpoint this function says so and the ledger''s prose is provably stale.';

-- ---------------------------------------------------------------------------
-- The composed engine (ruling 5D-R17).
-- ---------------------------------------------------------------------------
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

  -- LEG 1: the digital thread. The shipped reads, whole. Nothing recomputed.
  v_continuity := check_thread_continuity(c.id);
  v_receipts := get_case_thread_receipts(c.id);

  -- LEG 2: documentation. The one thing this composition derives, over the
  -- same thread rows the other legs read — which document-bearing objects
  -- exist and which of them have a RELEASED revision. An object with no
  -- authoritative version is a document nobody can build to.
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

  -- LEG 3: asset-data readiness. NOT BUILT, and named rather than averaged
  -- away. D11.08 and D11.23 are 🟡 in this register: get_golive_readiness is
  -- per-asset and physical; §47's Information Readiness Index with hard
  -- blockers does not exist.
  v_refusals := v_refusals || to_jsonb(
    'ASSET-DATA READINESS IS NOT COMPUTED. Spec §47''s Information Readiness Index — the information-object equivalent of the operational readiness index, with its hard blockers — is not built (register rows D11.08, D11.23). No percentage is produced for this leg, and the two legs that ARE built are not averaged into an engine score to cover for it.'::text);

  -- The §34 ledger, and whether its absence claims still hold.
  v_edges := sync_spec34_edges();
  v_audit := sync_spec34_absent_edge_audit();
  select count(*) filter (where x ->> 'status' <> 'absent')::int,
         count(*) filter (where x ->> 'status' = 'absent')::int
    into v_live_edges, v_absent_edges
    from jsonb_array_elements(v_edges) x;

  if v_absent_edges > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      '%s of spec §34''s nineteen core relationships are ABSENT because an endpoint object is unbuilt, so no traversal over this graph is a traversal over §34. Each one is named with the column that would close it (sync_spec34_absent_edge_audit), and %s of those columns exist today.',
      v_absent_edges, (v_audit ->> 'newlyClosableCount'))::text);
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
    -- NO COMPOSITE SCORE. Ruling 5D-R17.
    'engine', 'Sync Information',
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
        'built', false,
        'registerRows', jsonb_build_array('D11.08', 'D11.23'),
        'reason', 'Spec §47''s Information Readiness Index with hard blockers is not built. get_golive_readiness answers a per-asset physical readiness question and is not this leg.')),
    'graph', jsonb_build_object(
      'spec34Edges', v_edges,
      'liveEdgeCount', v_live_edges,
      'absentEdgeCount', v_absent_edges,
      'absentEdgeAudit', v_audit),
    'refusals', v_refusals,
    'complete', false,
    'headline', format(
      'Sync Information on this case: the digital thread and documentation legs are built and reported; asset-data readiness is NOT, and %s of §34''s nineteen edges are absent. This module is reported as INCOMPLETE with its missing legs named — there is deliberately no composite score, because averaging the legs that exist over the ones that do not is how a partial module reads as a finished one.',
      v_absent_edges));
end
$$;

revoke all on function public.get_case_information_engine(uuid) from public, anon;
grant execute on function public.get_case_information_engine(uuid) to authenticated, service_role;

comment on function public.get_case_information_engine(uuid) is
  'D11.09 / spec II.engines ruling 5D-R17: the Sync Information module composed from the SHIPPED reads (check_thread_continuity, get_case_thread_receipts, sync_spec34_edges) plus the one leg it derives (documentation, over the same thread rows). Asset-data readiness is NOT built and is named as missing; `complete` is false and there is no composite score, because averaging the legs that exist over the ones that do not is how a partial module reads as a finished one.';
