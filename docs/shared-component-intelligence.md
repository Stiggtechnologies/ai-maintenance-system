# Shared Component Intelligence Library

**2026-09-06 — Issue #68.** Canonical identity strategy, gap analysis, compiler
inheritance, and the migration plan for knowledge still copied inside asset
templates. This document does not authorize work, invent OEM limits, or replace
issue #67 (asset-class hierarchies).

## Existing contracts reused

The library extends the Shared Component DNA already shipped by PR #97 and
consumed by pump / motor / gearbox / conveyor / crusher DNA migrations
(#98–#102):

| Contract                                                    | Role                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `SharedComponentDnaProfile`                                 | Manufacturer-neutral component intelligence          |
| `SharedComponentBinding` on Engineering DNA                 | Asset component → shared DNA                         |
| `compileAssetTwin`                                          | Overlay merge + now shared-reference provenance      |
| `ReviewState` / `EvidenceReference`                         | Provenance and draft/review gates                    |
| Core engineering standards `FM-*`, `DET-*`, `VER-*`, `MS-*` | Mechanism and strategy vocabulary                    |
| Engineering ontology `shared_component`                     | Knowledge-graph references, not copies               |
| #129 `engineering_knowledge_mappings`                       | Optional persistence of applicability to these codes |

No second component table, queue, or failure-mode store is introduced. OEM
overlays remain overlays. Asset-class parent/child trees stay on the asset
template (issue #67).

## Gap analysis (before this slice)

1. The shared library only covered bearings, couplings, seals, and lubrication.
2. Motors, gearboxes, and pumps existed as **asset-class** templates, so the
   same intelligence was copied again whenever those machines appeared as
   components of a shovel, conveyor, or crusher.
3. Brakes, ropes, sheaves, cylinders, cooling, switchgear, VFDs, and
   transformers had no shared identity.
4. The twin compiler merged OEM overlays but did not resolve shared DNA.
   Templates could not point at shared intelligence; they could only embed it.
5. Engineering DNA bindings existed for five classes and were absent for rope
   shovels, hydraulic shovels, haul trucks, and draglines.

## Canonical identity strategy

| Layer                | Identity                | Example                   | Owner                       |
| -------------------- | ----------------------- | ------------------------- | --------------------------- |
| Asset class          | One hierarchy per class | `MIN-LOAD-ERS`            | Issue #67 / asset templates |
| Asset component      | Class-local code        | `ERS-HOIST`, `EM-BEARING` | Asset template              |
| Shared component DNA | `COMP-DNA-*`            | `COMP-DNA-BRAKE-FRICTION` | This library                |
| Shared failure       | Library-local code      | `BRAKE-FAIL-RELEASE`      | This library                |
| Asset failure        | Class-local code        | `ERS-BRAKE-FAIL-RELEASE`  | Asset template              |
| Strategy             | Core standard           | `MS-CONDITION-BASED`      | Core engineering standards  |

Rules:

- Shared DNA is manufacturer-neutral. OEM numbers live in overlays with
  evidence.
- An industrial motor may be an **asset** (`IND-ELECTRIC-MOTOR`) or a
  **component** (`COMP-DNA-MOTOR-AC`). Those are different identities that
  reference the same shared intelligence; the motor asset hierarchy is not
  duplicated inside a shovel.
- Asset templates **reference** `sharedComponentDnaCodes`. They do not adopt
  shared failure codes. Asset-specific failures remain explainable and local.
- `inheritSharedIntelligence(code)` looks up the library. It does not clone a
  second source of truth into the compiled template body.
- `recommendDoesNotAuthorize` is required. A strategy code is a recommendation
  class, not a work order, isolation, or switching authority.
- Review state stays `draft` until authorized engineering and field review.
  Approved profiles will require evidence.

## Reference / inheritance mechanism

1. `ComponentTemplate.sharedComponentDnaCodes?: string[]` — optional, backward
   compatible.
2. `validateAssetClassTemplate` rejects unknown or duplicate references.
3. `compileAssetTwin(..., engineeringDna?)` validates template refs, optionally
   unions Engineering DNA bindings, and writes
   `provenance.sharedComponentReferences` (codes + review state only).
4. Unknown refs fail compilation the same way a mismatched overlay does.
5. Overlay merge preserves `sharedComponentDnaCodes` unless the overlay
   explicitly replaces them.

Compiled twins therefore carry pointers, not a copied library.

## Shared definitions shipped

`src/lib/asset-twins/shared-component-dna-library.ts` now includes draft
profiles for:

bearings, couplings, seals, lubrication, AC motors, industrial gearboxes,
friction brakes, wire ropes, sheaves, centrifugal pumps, hydraulic cylinders,
cooling, switchgear, VFDs, and transformers.

Each profile carries reusable functions, failure mechanisms, detectable
indicators, verification methods, and maintenance-strategy references. No
numeric interval, alarm, or retirement limit is encoded.

## Migration plan for embedded copies

**Phase A (this PR):** library + reference field + compiler provenance +
bindings on the classes that already compose those components. Local failure
modes stay so existing DNA failure-code lists remain stable.

**Phase B (follow-on, per asset class):** replace copied function / indicator
text with inherited lookup where the local text is only a restatement. Keep
asset-specific specializations (dipper latch, crowd alignment, haul-truck
retarding) as local failures that still **reference** the shared profile.

**Phase C:** persist mappings through the #129 governed-knowledge tables
(`entity_type = shared_component`, canonical id = `COMP-DNA-*`). Do not create
a parallel corpus.

Named residuals still embedding copies without a reference (guarded by
`shared-component-intelligence.test.ts`):

- `PROC-BALL-MILL` trunnion bearings, drive, and lubrication/cooling
- `PROC-SAG-MILL` trunnion bearings, drive, and lubrication/cooling
- `PROC-THICKENER` drive/gearbox, lubrication/hydraulics, underflow pumping
- `MIN-WHEEL-LOADER` brakes/steering and prime-mover cooling

Blasthole-drill feed/sheave content is inspection-zone vocabulary only and is
not yet a binding target.

## Compatibility and collisions

- Existing `COMP-DNA-BEARING-ROLLING`, `COMP-DNA-COUPLING-FLEXIBLE`,
  `COMP-DNA-SEAL-MECHANICAL`, and `COMP-DNA-LUBRICATION-SYSTEM` codes and
  `schemaVersion` `0.1.0` are unchanged.
- `physicsCapabilityCodes?` is reserved so draft PR #104 (engineering model
  supply chain) can attach physics without another type break. This PR does
  not own that area and does not add physics bindings.
- `CompiledAssetTwin.provenance.sharedComponentReferences` is new. Callers that
  only read overlay / customer-override keys are unaffected.
- No capability-register rewrite. This is a Feature-lane library extension.

## Governance

- Recommend ≠ authorize.
- Engineering approval remains required; customer overrides remain approval
  gated; autonomous operational action remains prohibited.
- Thresholds remain `approved_source_only`.
- Draft content stays draft.

## Rollback

Revert this PR. Templates regain optional-field absence; the compiler stops
emitting shared references; Engineering DNA bindings on newly wired classes
disappear. No database migration to roll back.
