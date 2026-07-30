# Parallel Agent Workstreams

This document partitions SyncAI development so multiple agents can work concurrently without fragmenting the architecture.

## Workstream ownership

### Architecture steward

Owns shared contracts, canonical ontologies, architecture tests, cross-module interfaces, and migration sequencing.

May edit:
- shared domain types;
- canonical registries;
- architecture tests;
- cross-cutting migrations.

Must not implement broad feature work in the same PR.

### Mobile asset DNA

Owns manufacturer-neutral engineering DNA for shovels, haul trucks, loaders, drills, dozers, graders, and related mobile equipment.

May edit asset-specific modules and tests. Shared contracts require architecture-steward coordination.

### Fixed-plant DNA

Owns crushers, conveyors, stacker-reclaimers, mills, pumps, motors, gearboxes, compressors, thickeners, flotation, and other process assets.

### Digital Twin Factory

Owns twin instantiation, lifecycle state, configuration inheritance, baseline learning, state history, and governed deployment workflows.

### Engineering intelligence

Owns reliability, risk, evidence fusion, failure reasoning, root-cause analysis, remaining-life contracts, and physics-informed services.

Deterministic engineering logic must remain separate from generative explanation.

### Knowledge graph and memory

Owns canonical relationships among assets, components, failure modes, evidence, recommendations, approvals, work, repairs, and lessons learned.

### Enterprise planning

Owns maintenance planning, shutdown planning, inventory, workforce, production-impact simulation, and cost forecasting after upstream engineering contracts are stable.

### Quality, security, and tenancy

Owns adversarial tests, RLS validation, authorization review, migration safety, dependency risk, CI quality gates, and architecture-conformance checks.

This workstream reviews other branches and should avoid becoming the primary feature implementer.

## Shared-file protocol

The following are serialized resources:

- shared domain type files;
- central registries and barrel exports;
- database migrations;
- RLS policies;
- recommendation, evidence, approval, and twin persistence interfaces.

An agent needing a serialized resource must either:

1. request an architecture-steward precursor change; or
2. make the smallest compatible edit and clearly flag the collision risk in the PR.

## Integration sequence

1. Shared contract PR.
2. Parallel domain implementations.
3. Independent security and architecture review.
4. Integration PR only when cross-domain wiring is required.
5. Deployment validation and human-approved merge.

## Initial parallel backlog

Once this control plane is merged, the preferred first wave is:

1. Hydraulic mining shovel DNA.
2. Fixed-plant core standards and pump/motor/gearbox DNA.
3. Twin lifecycle and baseline state contracts.
4. Reliability and risk core contracts.
5. Architecture-conformance and RLS regression tests.

Each issue must specify owned paths, forbidden paths, acceptance tests, dependencies, and governance boundaries.