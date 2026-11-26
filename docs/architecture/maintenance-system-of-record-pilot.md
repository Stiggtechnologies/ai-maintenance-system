# Maintenance system-of-record pilot

**Status:** Design and acceptance gates; no authority mode implemented or enabled by this document.

Use the existing `assets`, `maintenance_notifications`, `recommendations`, `work_orders`, `maintenance_plans`, connector records, evidence and audit. No additional queue, graph or copied asset identity. Preserve the requirements in AGENTS.md. MaintainX is a UX reference, not an account dependency.

## Authority contract for the next coordinated change

- Resolve authority from trusted site/asset configuration on the server, not a browser flag or vendor name. An external configuration references an explicitly approved connector identity for that organization; SAP and other CMMS/EMS providers use the same contract. Mappings preserve external IDs and provenance. Unknown/mixed or missing asset scope must not be treated as native for newly enrolled sites. Legacy tenants are not silently migrated: audit current effective behavior before any rollout or backfill.
- For opted-in native sites, a named human can screen and release work through canonical commands; assistants only propose. Keep the existing notifications as intake, not an execution queue. Convert idempotently under a lock, preserving the notification-to-work relationship. Use the existing closeout contract and evidence lineage. A subsequent slice can generate calendar-based PM draft occurrences idempotently.
- For external sites, allow observations and advisory evidence or recommendations; do not create local executable work, assign, release, complete, or write back implicitly. Externally sourced work may be projected for reference through an approved, provenance-checked import. Neither a caller-supplied source string nor UI visibility confers import authority. Manual linking or approved import must not change source records. Keep any separately enabled SAP write adapter out of this pilot.
- Preserve and test the authority boundary on all relevant paths: direct authenticated writes, notification conversion, recommendation alias and approval RPCs, non-notification work producers, order and schedule release, order edits and closeout, and service/agent writers. Verify active connector provenance separately from tenant membership. Coordinate with open PRs #736, #768 and #744 before changing their areas or serializing a new migration.

## Staging acceptance

Use synthetic records in an isolated database, with two tenants and separate technician, supervisor, and AI identities.

1. Native: open an asset QR route, file a fault with and without a photo, screen and convert, open the returned canonical work order, release via an authorized human, close via the existing work-order closeout, and see its history on the same asset. Network or photo errors after filing must not prompt a duplicate report.
2. External: file an observation and review advisory evidence without creating executable work. Import one mapped external order via the approved connector, replay it, and verify it remains a single read-only projection. Do not change source-system data.
3. Negative: deny direct mutation, cross-tenant or cross-site references, impersonation and unapproved agent release. Exercise retries and concurrency. Verify existing customers remain unchanged. No production access or operational side effects are needed for these tests.

The application preview must be shown to point to the isolated staging database before performing any write-based tests. A successful build or preview status alone is not staging acceptance. For rollback, keep the new pilot flag off; if a qualified pilot ever creates real history, preserve it and reconcile before changing authority. Do not drop or reclassify work silently.
