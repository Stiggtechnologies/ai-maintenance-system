# Domain-depth specialist modules

**Program-of-record date:** 2026-08-26

SyncAI carries one reusable reliability/risk kernel and a separate registry of
domain-depth methods. The registry exists for the work that cannot honestly be
represented by a generic failure context: airworthiness traceability, tailings
instrument exceptions, batch records, class surveys, route constraints and
similar domain decisions.

## Executable scope

| Module                     | Executable methods                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Oil Sands — tailings       | Force-based factor-of-safety screen and supplied instrumentation triggers                                          |
| Oil & Gas — well integrity | Independent barrier coverage and pressure-envelope margins                                                         |
| Process Industry           | Process-safety barriers, pressure containment, RBI/corrosion, SIS proof tests, turnaround readiness and LOC risk   |
| Utilities — storm response | Priority-ordered, skill/capacity/travel-feasible draft crew assignment                                             |
| Manufacturing              | Precedence-feasible line balance and approved weighted robot-health model                                          |
| Food & Beverage            | HACCP CCP verification, CIP recipe-envelope verification and cold-chain excursion dose                             |
| Pharmaceuticals            | GxP requirements/test/deviation trace and batch-record completeness/exception trace                                |
| Healthcare                 | Clinical criticality, device availability, calibration, infection-control readiness, patient-risk and lifecycle trace |
| Transportation & Logistics | Exact bounded route/depot search and capacity-feasible inspection scheduling                                       |
| Aviation                   | AD/SB applicability/compliance trace, MSG-3 decision trace and life-limited-part remainder with back-to-birth gate |
| Marine Shipping            | Class-survey window scheduling, matched-baseline propulsion efficiency and constrained voyage-option ranking       |
| Data Centers               | Lumped heat/airflow balance, cooling margin and sensor-envelope exceptions                                         |
| Defense                    | Mission-capable coverage, configuration/obsolescence trace and classified-deployment control readiness             |
| Aerospace & Launch         | Reuse counters, range-safety evidence readiness and propellant property/exposure margins                           |
| Buildings & Infrastructure | Code, fire/life safety, occupancy, environment, BAS, resource performance and renewal priority                     |
| Civil Infrastructure       | Structural condition, inspection ratings, deterioration, load restrictions, geographic risk and renewal planning |

The 17 modules expose 54 methods. The canonical registry, input examples,
required evidence, authority references, limitations and reviewer roles live in
`src/lib/domain-specialists/catalog.ts`. The deterministic evaluators live in
`src/lib/domain-specialists/engine.ts`; every registry method must resolve to an
evaluator or the contract test fails.

## Execution and storage control

1. A user selects a canonical risk, module and method in the Risk Operating
   System's **Domain specialists** view.
2. Local preview may show input/evidence gaps, but it is never trusted for
   persistence.
3. `domain-specialist-run` authenticates the user and recalculates the result
   server-side with the same tested engine.
4. The service-only database RPC binds the actor, organization, risk and
   canonical evidence; browsers cannot call it directly.
5. The run registers its model/version as unapproved and human-in-loop, stores
   `authoritative=false`, and writes an audit event.
6. A different authorized person may review the calculation envelope and
   evidence. Review never turns the output into certification, release or
   operational authority.

## Refusal and authority boundary

- Required inputs and evidence references are mandatory. Missing data produces
  `blocked`, not a default or optimistic result.
- Limits, matrices, weights, intervals, degradation models and applicability
  come from the tenant, OEM or competent authority. SyncAI supplies no generic
  legal or engineering threshold.
- HAZOP/LOPA/QRA, pressure/relief/fitness-for-service design, SIL determination,
  full API 581 damage-factor/PoF/CoF calculation, geotechnical slope solving,
  CFD, fire dynamics, evacuation/tenability, microbial growth, reaction
  kinetics, trajectory/debris/casualty analysis and other specialist solvers
  outside the named algorithms are explicitly not claimed.
- Copyrighted standards are referenced as authorities only. Their text and
  jurisdictional interpretation are not embedded.
- No module can certify compliance, sign an airworthiness/class/range/security
  release, release a batch or facility, dispatch a crew or vehicle, change a
  setpoint/limit, or authorize operation.

## Acceptance evidence

- `domain-specialists.test.ts` executes every registered example and verifies
  the non-authoritative/human-approval invariant.
- `domainSpecialistContract.test.ts` checks registry/SQL allowlist parity,
  service-only persistence, tenancy, deployment and Edge recalculation.
- `ci-domain-specialists-smoke.sh` runs after the complete migration chain and
  proves direct browser persistence is denied, service persistence is
  tenant-bound, model registration occurs, self-review is refused and
  independent review never changes the authority flags.
