# SC-02 operating picture and industrial inspector

## Current implementation checkpoint — October 9, 2026

This is an **in-progress implementation**, not a shipped map or a completed capability claim. The complete 18-requirement SC-02 assignment in `capability-ledger.json` remains in scope. No requirement or accepted baseline is promoted by this checkpoint. Issue #576 remains open.

The initial browser input boundary is implemented in:

- `src/lib/sync-context/geometry.ts`: copied, immutable source geometry with explicit EPSG:4326 and GeoJSON longitude/latitude encoding; supported Point/LineString/Polygon/Multi* structures; finite numeric positions and bounds; ring closure; dense arrays; cumulative rendering limits; asserted coordinate-basis description; positive supplied accuracy or explicitly unknown `null`.
- `src/lib/sync-context/operating-source.ts`: separate source-rights and source-health emission checks, with derived demo-only/live/degraded display meaning. A disconnected, unavailable or malformed source cannot emit. Last-good degraded context is not called live. This is browser defense in depth, **not server authorization**.
- `src/lib/sync-context/operating-picture.ts`: reuses `parseSyncContextSnapshot`, retaining canonical object/event identities and evidence references. It additionally checks scope syntax, bounded object/event arrays, query coverage, duplicate identities, layer/source binding, source and observation times, verified/current evidence, explicit validity and coordinate provenance. Invalid rows receive traceable issues; unavailable is not rewritten as a zero query count.

No new endpoint, persistence migration, service call, customer route, map renderer, inspector or production deployment is included at this checkpoint. The merged zero-argument SC-01 snapshot and authoring workspace remain unchanged.

### What the input contract does not prove

- A supplied source-coordinate basis is a description, not authenticated survey evidence. Numeric geometry validity does not prove survey suitability, polygon topology, winding, non-degeneracy or a safe industrial boundary. The structural rules follow [RFC 7946](https://www.rfc-editor.org/rfc/rfc7946); engineering suitability still requires canonical evidence and authorized review.
- A UUID-shaped site scope is not proof of site authorization or membership. The server must resolve the caller's tenant and permitted site and derive membership through canonical links, never coordinate proximity.
- Query `eligible`, `returned`, exclusion and truncation counts must come from the actual server predicates. They are not a count of rendered markers or a promise of complete enterprise coverage. Client rejection does not change server coverage metadata; issues and rendered counts remain separate.
- Source class and authority are preserved independently. No tuple of metadata authorizes dispatch, safety decisions, work release, approvals or an engineering conclusion.
- Events in this contract are unlocated canonical context, explicitly `locationAvailable: false`. Work history is not assigned an asset centroid or another invented location.
- Known coordinates do not make an external provider commercially licensed or a customer feed live. Legal rights and actual source health remain separate gates.

## Required continuation before SC-02 can close

1. **Server operating projection.** Extend canonical `geospatial_features` with explicit coordinate provenance; do not infer or backfill historical coordinates. Add a separate health-emission predicate without changing the legal rights classifier. Supply bounded tenant/site reads, source health, honest exclusion/truncation metadata and risk-filtered detail resolution. Preserve authenticated roles, RLS, source revocation, evidence verification and canonical link privacy. Qualify the real API, not only client filtering.
2. **Customer operating surface.** Add an authenticated, discoverable 2D map with verified objects, selectable layers, persistent view/selection state and desktop/tablet/mobile accessibility. Any basemap or new dependency requires provenance/license review. Unavailable tiles, missing geometry and partial coverage must remain visible. Do not claim an optional 3D globe has been delivered.
3. **Industrial inspector.** Present canonical identity, operating state, criticality, work, Recovery/RTS, risks, repeat failures, model-qualified PoF/RUL, projects/gates/commissioning, stock/logistics, route context and evidence-backed dependencies when available. Missing domains and unknown values remain explicitly unavailable. Stock is not shipment movement; a cluster is not statistical significance; a road is not a safe route or travel-time calculation.
4. **Nearby context and safe handoffs.** Provide range-sorted authorized objects with an explicit radius, units, supplied accuracy and coverage. Navigate only to actual canonical routes. Create a retained, audited, idempotent canonical Decision Case draft with object/event/source/evidence references through existing workflow authority; navigate using the returned case/workspace identity, never a guessed ID. Approval and execution stay outside the renderer.
5. **End-to-end qualification.** Run native two-tenant SQL and authenticated HTTP checks for rights revocation, unavailable sources, restricted risks, scope, malformed coordinates, drafts, expiry, duplicate references, limits and no-write refusals. Verify the rendered workflow at desktop, tablet and 375×812 mobile sizes, with keyboard/touch access and reload persistence. Demonstrate the deployed lighthouse path using real authorized source data before ledger promotion or issue closure.

The remainder of the 132-item Context register, including 3D, deterministic scenarios, provider adapters, media/replay, safety observations, voice, customer connectors and resilient production operation, remains separately required. Completing SC-02 will not close that full register.

## Validation at this checkpoint

The focused Context suite currently passes **181 tests across 7 files**, including the unchanged SC-01 contract, adapter and ledger checks. The application TypeScript check and ESLint for the six new TypeScript files pass. Red-first regressions reproduced sparse-array, immutability, duplicate-layer, coverage-limit, source/layer consistency, empty/count contradictions and evidence/time/display defects before repair. Zoned calendar timestamps are checked at JavaScript millisecond precision; this does not qualify server clock integrity.

These checks are source/client evidence only. No native SQL, authenticated operating-picture HTTP, rendered map acceptance or production lighthouse proof exists for SC-02 yet. The ledger remains **132 requirements: 6 complete, 67 partial, 59 not started**.

## Rollback and coordination

At this checkpoint there are no persistence, runtime route or existing consumer changes to roll back. Reverting the new contract modules and their tests removes only the unconnected SC-02 browser input boundary. Later migration and runtime commits require their own rollback and qualification evidence.

Before adding a forward migration, repeat the architecture-steward inventory of current main, the last successful deployment and every open PR's migration filenames. Do not rely on an earlier reservation or insert a timestamp behind an active branch. Keep this workstream isolated from risk qualification and other owners' public journey or implementation changes.
