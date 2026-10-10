# SC-02 operating picture and industrial inspector

## Initial browser checkpoint — October 9, 2026

This is an **in-progress implementation**, not a shipped map or a completed capability claim. The complete 18-requirement SC-02 assignment in `capability-ledger.json` remains in scope. No requirement or accepted baseline is promoted by this checkpoint. Issue #576 remains open.

The initial browser input boundary is implemented in:

- `src/lib/sync-context/geometry.ts`: copied, immutable source geometry with explicit EPSG:4326 and GeoJSON longitude/latitude encoding; supported Point/LineString/Polygon/Multi* structures; finite numeric positions and bounds; ring closure; dense arrays; cumulative rendering limits; asserted coordinate-basis description; positive supplied accuracy or explicitly unknown `null`.
- `src/lib/sync-context/operating-source.ts`: separate source-rights and source-health emission checks, with derived demo-only/live/degraded display meaning. A disconnected, unavailable or malformed source cannot emit. Last-good degraded context is not called live. This is browser defense in depth, **not server authorization**.
- `src/lib/sync-context/operating-picture.ts`: reuses `parseSyncContextSnapshot`, retaining canonical object/event identities and evidence references. It additionally checks scope syntax, bounded object/event arrays, query coverage, duplicate identities, layer/source binding, source and observation times, verified/current evidence, explicit validity and coordinate provenance. Invalid rows receive traceable issues; unavailable is not rewritten as a zero query count.

No new endpoint, persistence migration, service call, customer route, map renderer, inspector or production deployment is included at this checkpoint. The merged zero-argument SC-01 snapshot and authoring workspace remain unchanged.

## Server prerequisite checkpoint — October 10, 2026

The follow-on migration `20270103150000_sync_context_operating_contract.sql` extends the canonical feature rows with explicitly declared EPSG:4326, longitude/latitude axis order, a 20–4000-character asserted coordinate basis, and supplied horizontal accuracy or unknown `null`. There is no inferred coordinate backfill or rewrite of historical verified rows. A `NOT VALID` CHECK keeps those rows stored without certifying new provenance, while refusing new/amended verified rows without a structurally valid coordinate contract. Superseding a legacy row remains possible.

The same canonical human draft writer now requires this contract. The existing `/assets/ontology` authoring form supplies it explicitly, with no default CRS or invented accuracy; the canonical workspace projection and draft cards expose the metadata for independent review. The original author-versus-reviewer, verified canonical evidence, tenant/source rights, owner, validity and audit gates are preserved. No new approval or operational authority is granted. Accuracy must fit the positive finite browser-number wire range; this is a serialization bound, not an engineering accuracy threshold.

The separate immutable source-health classifier does not change legal rights or connector ingestion/telemetry ownership. Disconnected, unavailable, malformed, unknown and contradictory simulation states cannot qualify for emission. A forward CHECK refuses new/amended real-source records claiming simulated health. Historical contradictions are not silently rewritten. **The health classifier is not yet connected to a new server operating projection**; authoring/RLS and the existing SC-01 snapshot remain available for governed repair. The existing health writer's clock-grace behavior is unchanged; strict read-time checks remain required in the operating RPC.

The native SQL probes cover the health truth table, exact geometry nesting/closure/bounds, finite numbers, internal-helper privileges, cumulative budgets and coordinate CHECKs. Local execution used disposable PostgreSQL 16.13, canonical feature DDL and a minimal FK/composite fixture—not the full Supabase chain or real authentication. The browser/source cohort passes **200 tests across 11 files**, including coordinate form and reviewer-card tests. Existing geospatial, SC-01 and climate fixtures now explicitly declare synthetic coordinate encoding with unknown accuracy; none of their review or authority checks was skipped. Nine additional authenticated HTTP writer-refusal/no-write probes are wired into the existing full-chain smoke but have not yet executed for this follow-on commit. The ninth targets an existing active key with an invalid timestamp, exercising the exception rollback after the supersede update rather than only pre-mutation refusals.

The original browser commit `ef3a9fdf4bc567e59da21a63b74c0d6c154b8308` completed core CI run `38029171203` successfully, including migration/auth smoke and golden-path E2E. That receipt does **not** qualify the follow-on migration, writer or UI. Their fresh full-chain/HTTP CI, independent re-review and eventual production proof remain required. No SC-02 requirement is promoted by this checkpoint.

### What the input contract does not prove

- A supplied source-coordinate basis is a description, not authenticated survey evidence. Numeric geometry validity does not prove survey suitability, polygon topology, winding, non-degeneracy or a safe industrial boundary. The structural rules follow [RFC 7946](https://www.rfc-editor.org/rfc/rfc7946); engineering suitability still requires canonical evidence and authorized review.
- A UUID-shaped site scope is not proof of site authorization or membership. The server must resolve the caller's tenant and permitted site and derive membership through canonical links, never coordinate proximity.
- Query `eligible`, `returned`, exclusion and truncation counts must come from the actual server predicates. They are not a count of rendered markers or a promise of complete enterprise coverage. Client rejection does not change server coverage metadata; issues and rendered counts remain separate.
- Source class and authority are preserved independently. No tuple of metadata authorizes dispatch, safety decisions, work release, approvals or an engineering conclusion.
- Events in this contract are unlocated canonical context, explicitly `locationAvailable: false`. Work history is not assigned an asset centroid or another invented location.
- Known coordinates do not make an external provider commercially licensed or a customer feed live. Legal rights and actual source health remain separate gates.

## Required continuation before SC-02 can close

1. **Server operating projection.** Qualify the new canonical coordinate/health prerequisites on the full chain. Supply bounded tenant/site reads, source health, strict read-time checks, honest exclusion/truncation metadata (including rights versus health exclusions) and risk-filtered detail resolution. Preserve authenticated roles, RLS, source revocation, evidence verification and canonical link privacy. Qualify the real API, not only client filtering.
2. **Customer operating surface.** Add an authenticated, discoverable 2D map with verified objects, selectable layers, persistent view/selection state and desktop/tablet/mobile accessibility. Any basemap or new dependency requires provenance/license review. Unavailable tiles, missing geometry and partial coverage must remain visible. Do not claim an optional 3D globe has been delivered.
3. **Industrial inspector.** Present canonical identity, operating state, criticality, work, Recovery/RTS, risks, repeat failures, model-qualified PoF/RUL, projects/gates/commissioning, stock/logistics, route context and evidence-backed dependencies when available. Missing domains and unknown values remain explicitly unavailable. Stock is not shipment movement; a cluster is not statistical significance; a road is not a safe route or travel-time calculation.
4. **Nearby context and safe handoffs.** Provide range-sorted authorized objects with an explicit radius, units, supplied accuracy and coverage. Navigate only to actual canonical routes. Create a retained, audited, idempotent canonical Decision Case draft with object/event/source/evidence references through existing workflow authority; navigate using the returned case/workspace identity, never a guessed ID. Approval and execution stay outside the renderer.
5. **End-to-end qualification.** Run native two-tenant SQL and authenticated HTTP checks for rights revocation, unavailable sources, restricted risks, scope, malformed coordinates, drafts, expiry, duplicate references, limits and no-write refusals. Verify the rendered workflow at desktop, tablet and 375×812 mobile sizes, with keyboard/touch access and reload persistence. Demonstrate the deployed lighthouse path using real authorized source data before ledger promotion or issue closure.

The remainder of the 132-item Context register, including 3D, deterministic scenarios, provider adapters, media/replay, safety observations, voice, customer connectors and resilient production operation, remains separately required. Completing SC-02 will not close that full register.

## Validation of the initial browser checkpoint — October 9, 2026

The focused Context suite currently passes **181 tests across 7 files**, including the unchanged SC-01 contract, adapter and ledger checks. The application TypeScript check and ESLint for the six new TypeScript files pass. Red-first regressions reproduced sparse-array, immutability, duplicate-layer, coverage-limit, source/layer consistency, empty/count contradictions and evidence/time/display defects before repair. Zoned calendar timestamps are checked at JavaScript millisecond precision; this does not qualify server clock integrity.

These checks are source/client evidence only. No native SQL, authenticated operating-picture HTTP, rendered map acceptance or production lighthouse proof exists for SC-02 yet. The ledger remains **132 requirements: 6 complete, 67 partial, 59 not started**.

## Rollback and coordination

The initial browser checkpoint changed no persistence or runtime consumer. The October 10 follow-on changes the existing draft-writer input: older callers without explicit coordinate metadata are refused instead of being silently trusted. The updated UI and migration must be deployed together after qualification; an app-only rollback to the older form would leave that form unable to record drafts. Prefer a reviewed forward compatibility repair preserving the coordinate gate. Retain the added metadata columns and recorded provenance; never delete or invent them to make an older client pass. The operating map, customer route and server read projection remain unimplemented.

Before adding a forward migration, repeat the architecture-steward inventory of current main, the last successful deployment and every open PR's migration filenames. Do not rely on an earlier reservation or insert a timestamp behind an active branch. Keep this workstream isolated from risk qualification and other owners' public journey or implementation changes.
