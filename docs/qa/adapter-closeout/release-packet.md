# Adapter integration draft — release HOLD

Base: `c1b5e8ca2506fc6d634b469ba0b0e07e2d2595ee`. This draft extracts real read
transports and canonical row mappers from existing work, repairs local gaps,
and tests them with synthetic sources. It is **not operational qualification**.
No credentials, live customer calls, SQL changes, tenant changes, deployment
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
only four shared cores, their handlers and mapper tests; it does not cherry-pick
the stack, replace existing imports, copy UI or copy old migrations.
Main already has `20261112090000_p6_schedule_import.sql`; the separate XER file
import #574 is not a REST connector. No DRMIS-specific implementation was found.

#661 owns customer journey/invitation/Auth integration. #662 owns the separate
`src/lib/telemetry-qualification` work. Neither area is changed. The historical
source PRs are preserved for their independent reviews. Integration ownership is
limited to this extracted disabled transport candidate; it does not transfer
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
- ADLS list/object/token responses are bounded while streaming. SAP finance
  streams against the remaining combined budget and rejects repeated page URLs.
- ADLS/finance request shape checks reject null/array/nonboolean dry-run inputs;
  database error contents are not reflected by these handlers. Credentials and
  source response bodies are never deliberately logged.

## Canonical mapping and limits

| Adapter       | Source → canonical draft payload                                                                                                                                                                                                                                   | Explicit limits and gaps                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADLS          | Administrator-approved field paths/vocabulary/constants → existing Recovery `site`, `asset`, `work_order` or another supported entity; `_sync_source` comes from actual object path/ETag/time/byte count/SHA-256, not source assertions                            | Storage is not a CMMS. CSV/JSONL/JSON only; no Parquet/Delta. Read mapping alone does not establish canonical evidence approval or business provenance. Object `{last_modified,path}` watermark needs append/update ordering and backfill agreement; late files behind the cursor need explicit replay/backfill.                                                                          |
| P6            | `Id` → `external_id`/`activity_id`; `ObjectId` → `p6_object_id`; `Name` → description; approved case/name; `PlannedDuration` × approved multiplier → hours; dates → offset-bearing dates; `CalendarName`, WBS, float, constraints and dependency type/lag retained | Uses existing schedule graph and revision workflow when SQL is integrated. Two complete arrays, not a general paginated project crawler. No resource assignments, shift/holiday calendar definitions or resource-leveling engine. A calendar name is not a full calendar. No timezone or duration conversion is guessed; deployment completeness and units need an Oracle-domain witness. |
| SAP inventory | `Material` + `MaterialBaseUnit` → approved existing material/UOM; exact Plant/StorageLocation → same-tenant site; unrestricted type `01`, no special stock; quantities aggregate to on-hand                                                                        | Intended canonical `material_stock` writer must preserve reservations/on-order/receipt dates. Empty does not mean zero. OData V2 same-resource pagination, fixed query scope, page/row/byte/time bounds. Catalogue and exact UOM resolution require SQL and a sanctioned catalogue.                                                                                                       |
| SAP finance   | ledger/company/currency + WBS internal ID/G/L mapping → existing cost-line reference; signed decimal strings → exact cumulative `actual_to_date`; source digest in identity                                                                                        | Intended canonical `ingest_cost_actual_batch`/`record_cost_item`; no baseline/commitment/forecast change. No absent-row-to-zero. Date window is cumulative; this is not a CDC feed. Independent finance reconciliation and posting-date semantics remain required.                                                                                                                        |

P6/SAP cursors describe reconciled snapshots, not an incremental vendor event
stream. ADLS uses a deterministic modified-time/path cursor. All database
idempotency, retained rejects, concurrent-run locks, exact actor/AAL binding,
contract mutation detection and clean-only watermark advancement must be
requalified after SQL integration. Mapper tests do not prove those RPC behaviors.
Current transport failures abort; there is no automatic retry loop. After
credential/429/5xx/timeout recovery, a named operator retries a bounded pull;
commit retry remains disabled until canonical replay behavior is proven.
Unsupported writeback stays absent.

## Database and release prerequisites — blocking runtime

The manifest identifies **16 required adapter RPCs absent from main**. Importing
these handlers does not make those functions exist. The only referenced ADLS
preview RPC already on main is `preview_recovery_activation_batch`.

The five original adapter migrations total 152,096 bytes and precede main's
latest `20270103040000` migration. Their SHA-256 digests identify source inputs,
**not approvals or an apply-ready patch**. They must not be dropped into the
migration directory or applied as-is. The prior ADLS/CMMS/historian contract
changes must be reconciled against current `connectors`, `connector_runs`,
`ingest_staging`, `ingest_watermarks`, Recovery, schedule and cost writers.

Required next approval is a bounded architecture/security SQL integration scope:

1. Architecture steward and #661 owner agree shared connector contracts and a
   timestamp later than current deployed head **and every open PR's migrations**.
   Re-fetch at that time. No timestamp is reserved by this packet.
2. Prepare only the missing adapter contract migrations on current main; preserve
   grants, RLS, actor/AAL, contract hashes, direct-write refusal and existing
   canonical writers. Do not include the duplicate invitation migration or
   unrelated source-stack work. Review changed migration digests anew.
3. Run fresh-chain and incremental-from-main migration tests plus the original
   four adapter SQL smokes adapted to current contracts. Include cross-tenant,
   credential-binding, direct service/client write, concurrent run, stale hash,
   replay, partial rejection and clean-watermark assertions. Green tests on old
   #614 do not qualify this candidate.
4. Only after those reviews, separately approve exact handler deployment
   allowlist/JWT probes and the minimal existing `/integrations` configuration
   surface. No deployment or UI wiring is included here.
5. Independently approve a non-production read-only source witness. Enable only
   the named adapter read flag for the named tenant. Keep commit false until the
   write-free preview and mapping authority are witnessed. Enable canonical
   promotion only after a separate exact tenant/mapping/actor release decision.

Release flags: `ADLS_READ_ENABLED`, `P6_READ_ENABLED`,
`SAP_S4_INVENTORY_READ_ENABLED`, `SAP_S4_FINANCIAL_READ_ENABLED`; the corresponding
commit flag inserts `_COMMIT` before `_ENABLED`. Default/unset is false for all.
These are not instructions to set production values.

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

Run focused suites with:

```sh
npx vitest run src/test/adapterCredentialBoundary.test.ts src/test/adapterHandlerBoundary.test.ts src/test/adlsDataLakeCore.test.ts src/test/p6ScheduleReadCore.test.ts src/test/sapS4InventoryReadCore.test.ts src/test/sapS4FinancialReadCore.test.ts
npm run typecheck
npx eslint src --max-warnings 5
npm run build
node scripts/check-edge-function-boundary.mjs
```

Record exact-head hosted CI externally in the draft PR; do not amend a commit
merely to claim its own SHA. Hosted migration smoke currently qualifies unchanged
main SQL only. No live adapter golden suite has run. Required independent reviews:
architecture, security/tenancy, P6 scheduling, SAP inventory/finance, ADLS data
ownership, and release owner.

Rollback before activation is a revert of this additive draft; no database
rollback or customer evidence deletion is necessary. If later approved for
activation, turn off the relevant read/commit flags and connector first, preserve
all run/staging/audit evidence, and follow an approved forward database containment
plan. Never delete evidence to make a failed qualification look clean.
