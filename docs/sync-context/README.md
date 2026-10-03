# Sync Context governed integration contract

This directory is the controlled source of truth for bringing the detailed God's Eye review into SyncAI. It records the complete product intent while keeping implementation claims tied to current evidence in this repository.

**No God's Eye source code is copied into this repository by this change.** The standalone prototype remains design and behavior evidence only. Any later third-party code adoption requires its own architecture, security, license, provenance and dependency review.

## Current truth

The machine-readable ledger contains **132 requirements**:

| Honest state        | Count | Meaning                                                                                                                    |
| ------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------- |
| Existing foundation |    43 | Main has a relevant canonical foundation, but the complete Context capability is not proved.                               |
| Prototype only      |    43 | The standalone prototype reports a playable or contracted capability; main has no production-grade proof.                  |
| Missing             |    21 | The review requires it and adequate implementation evidence is absent.                                                     |
| External dependency |    25 | Delivery depends on a provider, customer system, credential, physical sensor, certified system or legal/customer approval. |

Completion is tracked independently: **6 complete, 67 partial, 59 not started**. The six complete items are the reviewed SC-01 canonical-contract requirements; they do not establish the customer-reachable map, inspector, time navigation, spatial questions, Decision Case handoff or production lighthouse acceptance required by later slices. An existing foundation is deliberately not synonymous with a completed capability.

The authoritative artifacts are:

- [`capability-ledger.json`](./capability-ledger.json) — requirements, provenance, status, canonical reuse, evidence, gaps, constraints, acceptance conditions and bounded PR assignment.
- [`capability-ledger-baseline.json`](./capability-ledger-baseline.json) — accepted count and cryptographic digests used by the ratchet.
- [`scripts/check-sync-context-ledger.mjs`](../../scripts/check-sync-context-ledger.mjs) — schema, evidence and baseline checker.
- [`src/test/syncContextCapabilityLedger.test.ts`](../../src/test/syncContextCapabilityLedger.test.ts) — CI contract proving the checker runs and the accepted counts and guardrails remain visible.

## Source provenance

The ledger was reconciled from all of these sources, in full:

1. the original 1,074-line God's Eye discussion (`pasted-text.txt`, Codex attachment `83187d62-e6a0-4cf9-b75c-deb9f89bec0e`);
2. the standalone prototype `README.md`;
3. the standalone prototype `docs/SYNC_FORK_BLUEPRINT.md`;
4. current main-repository implementation, contract tests and canonical architecture.

Prototype prose is not treated as implementation proof. A `prototype_only` row must cite prototype evidence. An `existing_foundation` row must cite a file that exists in this repository. External data rights are never inferred from the Apache-2.0 code license.

## Canonical integration boundary

Context is a projection and decision-support layer. It must reuse:

- canonical assets, sites and relationships for identity;
- canonical work, projects, risk, recovery and process-safety records for operational state;
- `evidence_items` for evidence and provenance;
- existing recommendations, Decision Cases, decisions and approvals for governed action;
- existing audit and tenant/RLS boundaries for accountability.

It must not create a second asset model, evidence store, recommendation queue, approval workflow, audit log, work system or safety authority. A `SpatialObject` or `ContextEvent` is a source-aware projection linked to those records, not a replacement system of record.

The current main repository already provides meaningful foundations, including governed source-supplied GeoJSON, canonical subject links, independently verified geospatial assessments, process-safety barriers, Recovery, Decision Cases, FRACAS/RCA, Realtime voice, authenticated connector boundaries and tenant isolation. It does **not** currently prove a Cesium globe, a 2D map, public context feeds, synchronized video replay, a camera/VMS model, the reviewed deterministic scenario pack or production PostGIS queries.

## Non-negotiable constraints

Every implementation slice must preserve these rules:

1. Tenant and source authorization is enforced server-side. Hiding a layer is not authorization.
2. Coordinates, telemetry, thresholds, limits, exposure, travel time, causality, source health, connectivity and approvals are never invented.
3. `LIVE EXTERNAL`, `SIMULATED INDUSTRIAL` and `CUSTOMER OPERATIONAL` are explicit and mutually distinguishable source classes.
4. Context may observe, summarize, flag, draft and recommend. Authorized humans and existing policy remain responsible for approval, permits, work release, emergency decisions and corrective action.
5. Video supports prevention, response, investigation and learning. Facial recognition, individual productivity scoring and default worker surveillance are outside the product boundary.
6. Computer vision creates a reviewable observation, never causality, guilt, permit cancellation or a safety verdict.
7. Certified gas, permit, emergency and safety systems remain authoritative.
8. Every external provider needs a separate terms, attribution, commercial-use, quota, caching, redistribution and retention decision.
9. Missing, stale, conflicting, partial or clock-uncertain evidence stays visible and cannot be collapsed into false certainty.
10. Tactical branding, military/conflict defaults and the prototype's retained Global Intelligence HUD are provenance, not approved main-product scope.

## Bounded implementation sequence

| Slice | Outcome                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------ |
| SC-00 | Governed ledger, source provenance, constraints and ratchet. This change.                                                |
| SC-01 | Source-independent spatial/event/health contracts extending canonical models.                                            |
| SC-02 | First customer-reachable governed 2D operating picture and industrial inspector.                                         |
| SC-03 | Optional 3D globe, shared state, layer isolation, display modes and responsive shell.                                    |
| SC-04 | Honest deterministic industrial demo and five reviewed scenarios.                                                        |
| SC-05 | Public context adapters, one approved provider per bounded PR.                                                           |
| SC-06 | Canonical media evidence, chain of custody, clock integrity and investigation replay.                                    |
| SC-07 | Spatial safety observations, barriers, temporary conditions, SIMOPS and human review.                                    |
| SC-08 | Context-grounded voice and bounded map controls through the existing Realtime boundary.                                  |
| SC-09 | Customer historian, CMMS/EAM, fleet, GIS, VMS, permit, access and project connectors plus PostGIS.                       |
| SC-10 | Durable replay, degraded behavior, conflict handling, system-condition analytics, retention and production verification. |

The order is intentional. It establishes canonical and governance contracts before rendering, demo data before public/customer sources, evidence before video analytics, and safety authority before automated observations.

## Ratchet workflow

Run:

```bash
npm run sync-context:check
```

The checker rejects:

- a removed or changed requirement unless the accepted baseline is deliberately updated;
- duplicate or malformed capability IDs;
- unknown statuses, constraints, sources or PR slices;
- an `existing_foundation` claim without repository evidence;
- a `prototype_only` claim without prototype provenance;
- an external dependency without a named dependency;
- a partial claim without repository evidence;
- a complete claim without at least two current evidence paths and named automated verification.

When a reviewed change intentionally adds or changes requirements or status, run:

```bash
npm run sync-context:accept
```

Commit the ledger and baseline together. The digest change makes scope removal, requirement rewriting and status promotion visible in review. `accept` does not make a claim true; reviewers must still inspect the cited evidence and verification against every acceptance condition.
