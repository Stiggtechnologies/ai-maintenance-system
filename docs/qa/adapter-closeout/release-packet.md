# Adapter integration draft — release HOLD

Base: `c1b5e8ca2506fc6d634b469ba0b0e07e2d2595ee`. This draft extracts real read
transports and canonical row mappers from existing work, repairs local gaps,
and tests them with synthetic sources. It is **not operational qualification**.
No credentials, live customer calls, live SQL changes, tenant changes, deployment
configuration, merge or deployment are included. No vendor certification or
DRMIS authority is asserted. Capability registers are unchanged.

## Source ownership and composition

The exact PR heads, original migration digests and required RPC inventory are
in [source-manifest.json](source-manifest.json). Original PRs remain intact.

| Source                                                                                    | Original branch/head                              | Extracted meaning                                                                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [ADLS #597](https://github.com/Stiggtechnologies/ai-maintenance-system/pull/597)          | `agent/adls-data-lake-read` / `54c5cdcc`          | Entra client-credentials exchange plus bounded DFS GET listing/download; CSV, JSONL, JSON parsing |
| [P6 #600](https://github.com/Stiggtechnologies/ai-maintenance-system/pull/600)            | `agent/scheduling-tool-read` / `6f19a95f`         | P6 EPPM REST Activity/Relationship reads, one approved project                                    |
| [SAP inventory #601](https://github.com/Stiggtechnologies/ai-maintenance-system/pull/601) | `agent/inventory-system-read` / `ddb4a981`        | S/4HANA Material Stock OData V2 reads                                                             |
| [SAP finance #614](https://github.com/Stiggtechnologies/ai-maintenance-system/pull/614)   | `agent/financial-system-read-repair` / `33d0199a` | S/4HANA G/L actuals OData V2 reads                                                                |

The historical stack is #594 → #595 → #597 → #598 → #599 → #600 → #601 →
#603 → #614. It contains unrelated journey/invitation work. This draft extracts
the four shared cores, handlers and tests, then composes the necessary canonical
SQL prerequisites into five new migrations. It does not cherry-pick the stack,
replace existing imports or copy UI. Original migrations remain unmodified.
Main already has `20261112090000_p6_schedule_import.sql`; the separate XER file
import #574 is not a REST connector. No DRMIS-specific implementation was found.

#661 owns customer journey/invitation/Auth integration. #662 owns the separate
`src/lib/telemetry-qualification` work. Neither area is changed. The historical
source PRs are preserved for their independent reviews. Integration ownership is
limited to this disabled adapter integration candidate; it does not transfer
ownership of the source PRs or shared SQL contracts.

## Concrete local repairs

- P6 and SAP credential lookup requires exact `organization_id` and exact lowercase
  `host` in each secret registry entry. Missing fields fail closed. ADLS now also
  binds the account host. The organization comes from authenticated source RPC
  discovery, never the request body. The deployment host allowlist is an
  additional boundary, not a substitute for credential ownership.
- Provisioned bearers require `expires_at` with explicit offset and more than
  60 seconds remaining. P6/SAP do not implement refresh-token or client-credential
  exchange. Identity owners must rotate via the approved secret store. ADLS does
  Entra exchange; its cache key includes a digest of identity/secret values so
  rotation does not reuse a previous credential's cached token.
- New `*_READ_ENABLED` and separate `*_READ_COMMIT_ENABLED` flags default false.
  Disabled handlers return 503 before Auth or source I/O; read-enabled handlers
  still refuse commits with 403 unless commit separately enabled. Flags are code
  defaults only: no runtime configuration was set. No handler is added to the
  deployment allowlist, deployment workflow, UI or background polling.
- Missing/null/blank/boolean P6 durations and relationship lags cannot become
  invented zeros. Calendar names and explicit timestamp offsets are preserved.
- SAP stock and G/L reuse exact-decimal arithmetic. Missing, boolean or inexact
  numeric stock quantities are refused; decimal strings reach PostgreSQL without
  floating-point aggregation or unsafe-integer rounding.
- ADLS list/object/token responses are bounded while streaming. SAP finance
  streams against the remaining combined budget and rejects repeated page URLs.
- ADLS/finance request shape checks reject null/array/nonboolean dry-run inputs;
  database error contents are not reflected by these handlers. Credentials and
  source response bodies are never deliberately logged.

## Canonical mapping and limits

| Adapter       | Source → canonical draft payload                                                                                                                                                                                                                                   | Explicit limits and gaps                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADLS          | Administrator-approved field paths/vocabulary/constants → existing Recovery `site`, `asset`, `work_order` or another supported entity; `_sync_source` comes from actual object path/ETag/time/byte count/SHA-256, not source assertions                            | Storage is not a CMMS. CSV/JSONL/JSON only; no Parquet/Delta. Read mapping alone does not establish canonical evidence approval or business provenance. Object `{last_modified,path}` watermark needs append/update ordering and backfill agreement; late files behind the cursor need explicit replay/backfill.                                                                          |
| P6            | `Id` → `external_id`/`activity_id`; `ObjectId` → `p6_object_id`; `Name` → description; approved case/name; `PlannedDuration` × approved multiplier → hours; dates → offset-bearing dates; `CalendarName`, WBS, float, constraints and dependency type/lag retained | Uses the existing schedule graph and the added governed revision workflow. Two complete arrays, not a general paginated project crawler. No resource assignments, shift/holiday calendar definitions or resource-leveling engine. A calendar name is not a full calendar. No timezone or duration conversion is guessed; deployment completeness and units need an Oracle-domain witness. |
| SAP inventory | `Material` + `MaterialBaseUnit` → approved existing material/UOM; exact Plant/StorageLocation → same-tenant site; unrestricted type `01`, no special stock; quantities aggregate to on-hand                                                                        | Canonical `material_stock` writer preserves reservations/on-order/receipt dates. Empty does not mean zero. OData V2 same-resource pagination, fixed query scope, page/row/byte/time bounds. Exact UOM resolution requires an existing sanctioned catalogue.                                                                                                                               |
| SAP finance   | ledger/company/currency + WBS internal ID/G/L mapping → existing cost-line reference; signed decimal strings → exact cumulative `actual_to_date`; source digest in identity                                                                                        | Canonical `ingest_cost_actual_batch`/`record_cost_item`; no baseline/commitment/forecast change. No absent-row-to-zero. Date window is cumulative; this is not a CDC feed. Independent finance reconciliation and posting-date semantics remain required.                                                                                                                                 |

P6/SAP cursors describe reconciled snapshots, not an incremental vendor event
stream. ADLS uses a deterministic modified-time/path cursor. All database
idempotency, retained rejects, concurrent-run locks, exact actor/AAL binding,
contract mutation detection and clean-only watermark advancement must be
qualified on the exact SQL candidate by the native witness. Mapper tests alone
do not prove those RPC behaviors.
Current transport failures abort; there is no automatic retry loop. After
credential/429/5xx/timeout recovery, a named operator retries a bounded pull;
commit retry remains disabled until canonical replay behavior is proven.
Unsupported writeback stays absent.

## Repository SQL composition and remaining release gates

Repository-only SQL implementation and disposable synthetic database testing were
explicitly authorized in the continued delegation. All 16 adapter RPCs missing
from main are now implemented in the five candidate migrations listed with exact
SHA-256 digests in the manifest. Runtime qualification remains pending until the
new head completes native tests. No migration has been applied to a customer or
production database.

The reserved range `20270104090000` through `20270104090400` follows #661's
`20270103210000` reservation. A scan of every migration on all 303 fetched remote
branches found no collision. Recheck before release. No invitation/command-authority
migration or shared CI/deployment/boundary file was changed.

Composition includes additive connector transport columns, ADLS mapping/provenance
and clean-watermark contracts, P6 read plus the original canonical schedule revision
workflow, inventory read with exact catalogue/UOM resolution, and the original
canonical cost-actual importer plus SAP finance read. The manual import route table
and router remain unchanged. P6 and inventory now bind a SHA-256 source contract
across discovery, attestation, ingestion and finish. Ingest/finish serialize on the
run and source, recheck contract/actor/counts and refuse clean completion after drift.

The three protected RE-2026.08 SQL object digests remain unchanged. No governed-SQL
human approval record was fabricated or required by a protected-object change in
this candidate. Architecture, security/tenancy and domain reviews are still required
before release.

The separate `Adapter SQL qualification` workflow uses only disposable Supabase,
synthetic tenants/actors/rows and the four source adapter native smoke suites. It
exercises canonical writes, replay, rejects, tenant/role denial, transport evidence,
source-contract mutation and clean-only watermarks. Existing full-chain CI remains
unchanged. Source transport tests mock every source request. Neither layer is a live
vendor/customer witness.

Current main already exposes `/materials` → `MaterialCatalogue` →
`create_catalogue_material` (`20261225170100_material_catalogue_write.sql`). The
same-tenant human enters code, description, UOM and source basis; duplicate codes
are refused and canonical audit is retained. It creates identity only, not stock,
supplier qualification or engineering approval. Existing catalogue suites passed
35 tests and the unchanged authenticated catalogue smoke passed at the prior head.
SAP stock resolves existing non-template material codes with exact UOM; unknowns
remain staged rejects. No automatic catalogue creation or second catalogue added.

Remaining release sequence:

1. Complete exact-head fresh-chain and native adapter acceptance; review the exact
   migration digests and reconcile with #661's final head. Preserve source PRs.
2. Separately approve minimal existing `/integrations` UI wiring, exact handler
   allowlisting/JWT probes and deployment. No such configuration change is included.
3. Obtain the exact sanctioned test accounts, scope, mappings and source data below.
   Enable only the named adapter read flag for the named non-production tenant.
4. Keep commit false until write-free preview and mapping authority are witnessed.
   Canonical promotion requires a separate exact tenant/mapping/actor release decision.

Release flags: `ADLS_READ_ENABLED`, `P6_READ_ENABLED`,
`SAP_S4_INVENTORY_READ_ENABLED`, `SAP_S4_FINANCIAL_READ_ENABLED`; corresponding
commit flags insert `_COMMIT` before `_ENABLED`. All remain unset/default false.

## Verified production boundary (parent inspection, 2026-10-12 12:00 UTC)

The parent inspected the SyncAI production dashboard: project `pjvoswbwomesuwhygpby`
is healthy in **Canada Central (`ca-central-1`)**, MICRO/t4g.micro. Canadian-region
hosting exists. This does not qualify full-stack residency, self-hosting or offline
operation. No SyncAI staging project or preview branch was identified, and the
dashboard reported no connected repository.

There were 425 visible migrations, highest filename `20270103040000`, and 34 deployed
Edge functions. Future dates in migration filenames are ordering identifiers, not
deployment timestamps. All five adapter migrations and all four adapter handlers
in this draft were absent. This code has not closed production adapter availability.
Release stays blocked pending a proper staging or separately approved qualification
environment, independent reviews and the scoped source authority below. The journey
owner retains the reported process-safety view advisor investigation; this draft
makes no security-view or live SQL change.

## Exact source-access request for the parent

No real endpoints, identities or accounts have been supplied. Obtain the following
through the customer's authorized owner and secure secret handoff, not chat logs.

| Adapter       | Endpoint/auth contract                                                                                                                                                                                                                                                                                                                                                                                                          | Scoped test account and representative data                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADLS          | Exact `https://<account>.dfs.core.windows.net/<filesystem>` and approved prefix; Entra tenant/client IDs and service-principal secret in `RECOVERY_CONNECTOR_CREDENTIALS_JSON`; `organization_id`, exact `host`, type `azure_service_principal`; exact `RECOVERY_CONNECTOR_ALLOWED_HOSTS`; token exchange at `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`, storage scope `https://storage.azure.com/.default` | Named SyncAI admin/operator and second isolated tenant; minimum Azure list/read and path ACL access only; CSV/JSONL/JSON sample objects, exact approved schema/vocabulary, stable external IDs, matching canonical sites/assets, overwritten/late/same-time objects, malformed and oversized samples. Confirm public DFS/network/data classification; private network is unsupported by this candidate. |
| P6            | Exact sanctioned EPPM version and REST root ending before `/activity` and `/relationship`; `P6_READ_ALLOWED_HOSTS`; `P6_READ_CREDENTIALS_JSON` provisioned `oauth_bearer` entry with organization, exact host, token, offset-bearing expiry                                                                                                                                                                                     | Read-only Oracle principal limited to one approved `ProjectObjectId`; named SyncAI admin/planner and second tenant; existing case/schedule; two linked activities, FS/FF/SS/SF and lags, constraints, changed replay, cross-project dependency, exact duration unit/multiplier and time/calendar rules. Vendor owner confirms complete responses and absence of hidden pagination.                      |
| SAP inventory | Exact sanctioned S/4 release/communication arrangement and `.../API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod`; exact `SAP_S4_INVENTORY_READ_ALLOWED_HOSTS`; corresponding registry with tenant/host-bound provisioned bearer and expiry                                                                                                                                                                                            | Read-only technical user restricted to one Plant/StorageLocation; existing same-tenant site/material catalogue and exact UOM; multi-page sample, split balances, blocked/special stock, unknown material/UOM mismatch, preexisting reservations/on-order/receipt evidence. No inventory write privilege.                                                                                                |
| SAP finance   | Exact sanctioned S/4 release/arrangement and `.../API_GLACCOUNTLINEITEM_SRV/GLAccountLineItem`; exact `SAP_S4_FINANCIAL_READ_ALLOWED_HOSTS`; corresponding tenant/host-bound provisioned bearer registry and expiry                                                                                                                                                                                                             | Read-only G/L principal restricted to ledger/company/date window and approved WBS/G/L pairs; existing case and cost lines, currency and posting inception; multi-page signed debit/credit/reversal decimal samples, absent mapping, negative cumulative and mixed currency; named finance reconciliation owner. No accounting write privilege.                                                          |
| DRMIS         | **Unresolved interface**, not inferred from S/4. Obtain the authorized DRMIS owner, sanctioned interface/protocol/version and network/classification/export permission; exact authentication/authorization and read scope                                                                                                                                                                                                       | Authorized sanitized asset/equipment/functional-location/work-order/notification mappings and status/unit/timezone dictionaries, stable identity and change semantics, authoritative provenance, test account and named witness. A separate maintenance-domain connector increment is needed; inventory/finance access is insufficient. No DRMIS or CAF certification claim.                            |

For every source obtain exact SyncAI tenant/site/case ownership, mapping approval,
data retention/classification/network approval, identity expiry/rotation owner,
timebox and named witness. Prove first dry run, source-to-canonical reconciliation,
exact replay, malformed/scope escape refusal, tenant isolation, credential expiry
and recovery, restart/retry and retained rejection with no watermark advance.
Retain source-side audit evidence of no mutations plus run IDs/manifests/hash
references. Mocked I/O and merge alone do not satisfy this acceptance.

## Validation and rollback

Synthetic tests execute the actual handler entrypoints under a VM with mocked
Auth/RPC/fetch. Unexpected test dependencies and source calls fail closed. They
cover default-disabled operation, independent commit refusal, authenticated
source discovery, cross-tenant/cross-host binding rejection before transport,
malformed input, raw database error confidentiality and successful write-free
transport for all four adapters. Shared mapper suites cover schema drift,
canonical field mapping, UOM/currency/scope checks, source hashes and bounded
pagination. Streaming tests cover absent/dishonest Content-Length.
The native smoke scripts invoke `scripts/adapter-canonical-fixture.ts` to feed
actual CSV parsing/field mapping, P6 duration/relationship mapping, SAP stock
mapping and exact-decimal G/L aggregation into the canonical RPCs. Adversarial
fixtures separately exercise rejection, replay and authority boundaries.

Run focused suites with:

```sh
npx vitest run src/test/adapterCredentialBoundary.test.ts src/test/adapterHandlerBoundary.test.ts src/test/adlsDataLakeCore.test.ts src/test/p6ScheduleReadCore.test.ts src/test/sapS4InventoryReadCore.test.ts src/test/sapS4FinancialReadCore.test.ts
npm run typecheck
npx eslint src --max-warnings 5
npm run build
node scripts/check-edge-function-boundary.mjs
```

Record exact-head hosted CI externally in the draft PR; do not amend a commit
merely to claim its own SHA. The adapter native job must pass on the SQL candidate as well as the unchanged
main-domain smoke chain. No live adapter golden suite has run. Required independent reviews:
architecture, security/tenancy, P6 scheduling, SAP inventory/finance, ADLS data
ownership, and release owner.

Before deployment, rollback is a revert of this additive draft. After any later
approved migration deployment, use reviewed forward containment and preserve
customer evidence; do not assume a code revert reverses SQL. If later approved for
activation, turn off the relevant read/commit flags and connector first, preserve
all run/staging/audit evidence, and follow an approved forward database containment
plan. Never delete evidence to make a failed qualification look clean.
