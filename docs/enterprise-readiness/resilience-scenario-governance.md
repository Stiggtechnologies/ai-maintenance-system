# Enterprise resilience scenario governance

SyncAI uses the existing `threat_scenarios`, `scenario_exposure`,
`operating_mode_definitions`, asset dependency graph, evidence register and
Recovery operating-command workflow. This slice does not create a second
scenario store, cascade engine, evidence store or operating-state machine.

## Configuration and execution are different authorities

The resilience workspace lets an authorized named human:

- record wildfire, smoke, flood, extreme-cold, grid, cyber, supply-chain,
  utility, labour, equipment-loss, evacuation, shutdown and communications
  scenarios;
- map directly exposed canonical assets with an accountable basis;
- cite canonical evidence or explicitly record what evidence is missing;
- link an existing site, continuity procedure or supplier; and
- define entry criteria, exit criteria, declaring role and changed decision
  rights for normal, degraded, emergency and recovery policy.

Those acts configure planning policy. They do **not** declare an emergency,
dispatch people, isolate equipment, release work, approve return to service or
change current operating state.

Current state is read only from `recovery_operating_commands`. Transitions in
that workflow continue to require a named requester, an independent human
reviewer and verified canonical evidence. If no command records operating
state, the resilience view reports `unrecorded`, not an optimistic `normal`.
If governed commands span multiple states, it reports `mixed` rather than
inventing one enterprise-wide state.

## Evidence and tenant controls

The write functions derive organization and role from the authenticated
session. Every site, asset, supplier, continuity procedure and evidence item
must belong to that organization. Direct table writes remain closed; governed
RPCs validate controlled values, evidence shape, duplicate identities,
likelihood bounds, complete exercise facts and substantive human rationale.
Every accepted configuration change creates an audit event.

Scenario impact continues to use the canonical dependency cascade. Where a
directly exposed asset is absent from that graph, the displayed impact is
labelled a floor rather than an estimate. A scenario with no mapped exposure
is reported as a title, not as computed resilience.

## Customer path

The configuration panel is available from Enterprise Resilience in Emergency
Mode whether or not a critical alert is active. That permits preparedness work
before an incident without making a preparation record look like an active
emergency.

## Verification

The release gate includes:

- pure analysis tests for smoke and dependency-cascade coverage;
- a static architecture contract preventing parallel stores or state changes;
- a clean migration-chain application;
- authenticated scenario and four-mode configuration;
- malformed input, missing provenance and cross-tenant refusals;
- direct-write denial and audit-event checks; and
- proof that configuration does not add an `operating_mode_events` record.
