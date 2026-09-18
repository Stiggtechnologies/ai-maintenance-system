# Engineering-context retrieval safety — first slice

Status: proposed code change; not a claim of active runtime integration or deployment.

Baseline inspected: `3bfc0bb5b86e199d7bfb6ff59395089954d6014a` (2026-09-15).
References: #69 (canonical engineering relationships), #72 (evidence-based reasoning).
Coordination: #475 owns the live page/voice context and investigation runtime. Its
runtime and shared retrieval entrypoint are intentionally not modified here.

## Existing canonical contracts reused

- `EngineeringContextPackage` and `EngineeringKnowledgeDocumentMetadata`.
- `isKnowledgeApplicable()` and `buildAssetAwareRetrievalPlan()`.
- Existing source review states, provenance references, source authority ranking,
  and engineering entity identities.

No graph, corpus, queue, database table, approval path, or alternative runtime is
introduced. Existing tests and the capability register are not weakened or rewritten.

## Change

The applicability filter checks every declared scalar source scope, including site,
functional location, Engineering DNA, manufacturer, model and serial number. Optional
context fields are additive. A restricted source with missing matching context is
excluded; identifiers are compared exactly rather than guessed or normalized.
Shared-component restrictions are checked alongside existing component, failure-mode
and physics restrictions. Blank required context and malformed declared scopes are
refused. Missing source constraints still represent general applicability, not proof
of model-specific engineering authority.

The planner validates existing source metadata, finite semantic scores and nonblank
chunk references. It enforces source effective/superseded dates against an explicit
ISO evaluation time, with an inclusive start and exclusive end. Invalid dates fail
closed. A historical evaluation time does not resurrect currently superseded approval
or reconstruct historical configuration or permissions.

Eligibility precedes conflict scoring. An excluded foreign, draft or otherwise
inapplicable source cannot change admitted candidates' conflict flags or scores.
Canonical source IDs break score ties deterministically. Existing conflict heuristics
remain candidate signals, not confirmed engineering contradictions.

## Security and authority boundary

This is a pure applicability filter, not authentication, authorization or an RLS
boundary. A server must resolve canonical context from authorized records and
pre-authorize all candidate content and metadata before using it. Client page text
must not establish asset identity, source authority or approval state.

Excluded-source receipts themselves contain source identifiers and therefore require
server-side access control. The filter does not establish that a chunk belongs to a
source, that an approval was legitimately issued, or that a user may read a source.
Unscoped public material is background knowledge, not operational authority.

No prompts, credentials, tenant policies, migrations, model parameters or deployment
configuration change. Human approval and source-permission checks remain mandatory.
No customer, OEM or production data is used in the test fixtures.

## Validation evidence and limits

- Exact baseline blob hashes were checked before local modification:
  `ontology.ts`: `56ba1686c2e1f4cc1f096ae43321be3c9f6c4994`;
  `asset-aware-retrieval.ts`: `fe57348fbe38e58945e3d3da54a9ccb0795d1b92`.
- The 61 added behavioral cases produced 21 passes / 40 failures on that baseline.
- The same 61 cases passed after the change in a local Node test harness. Only the
  runner import (`vitest` to `node:test`) and local module extensions were adapted;
  test bodies and Node strict assertions were unchanged.
- Focused strict TypeScript checking of the two changed library files passed.
- `git diff --check` passed.

This was a selective source snapshot, not a full repository checkout. The local
results are not a Vitest, full-suite, production-build, database or live-tenant pass.
Repository CI and architecture/domain review must qualify the exact PR head.
No baseline manifest, qualification report or human SME approval was fabricated.

Run the actual repository tests in an authorized full checkout:

```bash
npx vitest run src/lib/engineering-knowledge/ontology.test.ts \
  src/lib/engineering-knowledge/asset-aware-retrieval.test.ts \
  src/lib/engineering-knowledge/asset-aware-retrieval-safety.test.ts
npm run typecheck
npm run test
npm run build
git diff --check
```

## Remaining coordinated integration (not completed by this slice)

1. Resolve tenant, site, asset/twin, installed component and applicable configuration
   through server-authorized canonical records; preserve unresolved context explicitly.
2. Retrieve permission-filtered candidates and approved engineering mappings through
   the existing corpus and RPCs. Never trust browser-supplied approval metadata.
3. Apply this planner in the supported runtime and carry accepted evidence, missing
   context and appropriately redacted exclusions into the existing investigation trace.
4. Ensure a scoped retrieval error does not fall back to broader unscoped evidence.
5. Exercise wrong-model, cross-site, missing-context, superseded-source, restricted-
   source and cross-tenant cases through the real authenticated end-to-end path.
6. Satisfy the existing Reliability Engineer qualification and named-review gates for
   any protected runtime or retrieval changes. Historical replay remains separate work.

Issues #69 and #72 remain open; library tests do not close their acceptance criteria.

## Rollback

Revert this library/test/document change through a reviewed PR. No schema rollback,
customer-data deletion, credential rotation or production toggle is required by this
slice. Review any later caller integration separately before reverting its dependencies.
