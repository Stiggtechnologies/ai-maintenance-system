# Governed degradation library

## Purpose

SyncAI’s degradation library is a controlled evidence and model-selection
workspace for sixteen universal degradation families: corrosion, fatigue,
creep, erosion, wear, embrittlement, chemical attack, concrete, timber,
insulation ageing, batteries, cables, semiconductors, lubricants, coatings, and
soil/foundations.

The library answers a bounded question: **what evidence, damage-state fields,
applicability checks, and governed model classes are required before a tenant
can rely on a degradation conclusion?** It does not answer how fast an asset is
degrading unless the tenant supplies a separately governed exact-version model
and applicable site evidence.

## Canonical architecture

- `damage_mechanisms` remains the only mechanism taxonomy. The
  `degradation_family_key` classifies one representative canonical mechanism
  for each library family.
- `degradation_profiles` adds versioned evidence and applicability requirements
  to that mechanism identity. It is not a parallel mechanism or model catalog.
- `model_register` and `engineering_model_mechanisms` remain the only model
  registry and mechanism-binding path. The library only shows those existing
  bindings.
- `evidence_items`, `approvals`, and `audit_events` remain the evidence,
  decision, and provenance systems.

The Engineering Model Registry mounts `DegradationLibraryPanel`, which calls
`get_degradation_library_workspace`. Reliability engineers and administrators
may submit a revision with independently verified evidence. A different named
engineer or administrator must approve or reject the exact version.

## Governance boundaries

- Platform rows are immutable `reference_draft` profiles. They contain only
  evidence questions and generic method classes.
- A tenant revision cannot be proposed without same-tenant verified evidence.
- The author cannot review their own revision.
- Direct insert, update, delete, and truncate are revoked from public,
  anonymous, authenticated, and service-role identities.
- Approved and rejected history is immutable; an approved version can only be
  superseded intact by another independently reviewed version.
- Tenant provisioning copies all sixteen canonical family identities and draft
  profiles without inheriting another tenant’s approvals.
- Every profile fixes `operational_authorization=false` by constraint.

## Explicit non-capabilities

The library does not supply or infer engineering thresholds, material
properties, degradation rates, inspection intervals, remaining life,
condemnation criteria, structural capacity, diagnosis, repair scope, work
release, risk acceptance, expenditure authority, or return-to-service
authority. A linked model is not usable merely because it is linked: the
existing model-registry lifecycle, applicability, evidence, validation,
competency, and human-approval controls still apply.

## Verification

- `src/test/degradationLibraryContract.test.ts` locks the canonical-store,
  tenant, evidence, approval, immutability, service-role, and reachability
  contract.
- `src/components/DegradationLibraryPanel.test.tsx` proves all sixteen families
  render and that proposal/review actions use only governed RPCs.
- `scripts/ci-degradation-library-smoke.sh` proves the authenticated clean-chain
  flow: sixteen-family coverage, verified-evidence refusal, proposal,
  author-review refusal, independent approval, exact-version model linkage,
  future-tenant seeding, service-role revocation, owner-mutation refusal,
  owner-TRUNCATE refusal, canonical approval/audit evidence, and unchanged
  operational authority.
