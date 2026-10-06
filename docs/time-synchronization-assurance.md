# Time-synchronization assurance

**2026-10-06 — DRAFT, NOT PRODUCTION-QUALIFIED.** This workstream provides
administrator-recorded clock contracts and immutable numerical observations.
Canonical evidence approval, real collector integration, downstream enforcement
and production witnesses remain open. Historical reconstruction now uses complete
versioned receipts in the canonical audit ledger; exact-head hosted verification
of this extension is still required.
Opaque references are not approved engineering evidence. Both eligibility
outputs stay false until those approval gates are integrated.

SyncAI compares event timestamps; it does not configure or discipline plant
clocks. The capability extends the canonical `connectors` record with a
named-human clock contract and keeps measurements in an immutable,
tenant-bound evidence ledger.

## Contract

A human tenant administrator records:

- the synchronization mechanism (`NTP`, `PTP`, `GNSS`, vendor-managed, or
  system-managed);
- the authoritative reference clock;
- the maximum acceptable worst-case offset in milliseconds;
- how long an observation may remain current;
- the controlled evidence reference and engineering basis.

SyncAI does not supply a default tolerance. Reconfiguring any of those inputs
creates a new monotonic contract revision. Measurements from earlier revisions
remain in history but cannot qualify the new contract.

A controlled service submits observations through
`record_connector_time_observation`. The database calculates signed offset
from source and reference timestamps, adds stated measurement uncertainty for
a conservative worst-case result, refuses understated round-trip uncertainty,
and makes deliveries replay-safe with a stable delivery ID plus SHA-256 body
digest. Direct inserts, updates, and deletes are refused.

The governed states are:

- `unconfigured` — no recorded contract;
- `disabled` — the connector is not operational;
- `unproven` — no measurement matches the active revision;
- `stale` — the latest matching measurement exceeds its recorded age;
- `untrusted` — worst-case offset exceeds the recorded tolerance;
- `synchronized` — current numerical observation is within the recorded tolerance,
  not proof that its engineering evidence has been approved.

`withinClockContract` / `within_clock_contract` report numerical posture only.
`eligibleForTimeSensitiveEvidence` / `eligible_for_time_sensitive_evidence`
remain false pending canonical evidence approval. The event-time RPC reports
`recorded_contract_at_event` and returns the selected configuration's audit ID,
revision, recorded time, tolerance and freshness. It reconstructs the complete
contiguous revision chain from `audit_events.previous_state/new_state`, validates
the chain against the current canonical connector, then uses only the contract
in force at the event and observations received no later than that event.
Reconfiguration cannot silently apply a newer tolerance to older events.

Snapshots include the original tenant/source identity, reference authority,
protocol, tolerance, freshness, evidence reference, basis, named administrator
and server-recorded configuration instant. That instant is serialized in UTC;
the audit row's transaction-start `created_at` is not its effective time.
Clock-configuration audit receipts can only be appended through the governed
configuration RPC; the existing ledger's update/delete/truncate protections are
not changed. Missing, duplicate, incomplete legacy, malformed or inconsistent
receipts fail closed, with no invented backfill. Future events and observations
received after an event remain refused. Currently disabled connectors remain
ineligible; clock-contract reconstruction does not claim historical operational
enablement or historical engineering-evidence approval.

The Data Governance panel exposes this read-only assessment to authorized
readers. Users select a tenant connector and provide an explicit-zone ISO event
timestamp. The result displays its recorded revision, tolerance/freshness and
configuration audit ID alongside the ineligible-evidence boundary. Ambiguous
timezone-free input is refused, and editing the inputs clears stale results,
including an older in-flight response.

## Azure IoT Operations and OPC UA

**Integration design, not an installed collector.** For the Azure IoT Operations path, deploy clock measurement beside the
read-only MQTT/Event Hubs relay. The collector may use the site's existing PTP
or NTP telemetry, but it must send only the observation envelope and an opaque
evidence reference. Credentials remain in the platform secret store. A clock
observation never grants command authority to OPC UA, MQTT, PLC, DCS, or plant
assets.

Recommended envelope fields map directly to the service-only RPC:

```json
{
  "organization_id": "tenant UUID",
  "connector_key": "site-a-azure-iot-operations",
  "delivery_id": "site-a-clock-000142",
  "source_clock_at": "2026-10-03T14:05:12.012Z",
  "reference_clock_at": "2026-10-03T14:05:12.000Z",
  "round_trip_delay_ms": 4,
  "measurement_uncertainty_ms": 2,
  "evidence_reference": "AIO-PTP-OBS-000142",
  "payload_sha256": "lowercase SHA-256 digest"
}
```

## Boundaries

- Time quality does not prove causality, sensor calibration, data correctness,
  or completeness.
- Source timestamps are preserved. SyncAI never silently shifts historical
  observations to make them appear synchronized.
- The screen and RPCs have no operational approval authority and no plant
  write path.
- Direct reads are tenant-scoped; configuration requires a named human admin;
  ingestion requires the controlled service role.
- A clock-configured connector retains its tenant and source identity and
  cannot be deleted; disable it instead. Observation update, deletion and
  truncation are refused, including ordinary database-owner writes. This is
  not protection against a database administrator disabling the guards.
- Initial configuration must use the named-human RPC, not a raw connector
  insert. There is no UI default tolerance or freshness interval.

## Verification

`scripts/ci-time-synchronization-assurance-smoke.sh` is the clean-chain test for named-human
configuration, service-only ingestion, exact signed offset, uncertainty,
replay safety, revision invalidation, stale/untrusted refusal, direct-write
protection, and two-tenant isolation on the clean migration chain. Passing
results must be recorded at the exact PR head before claiming those gates.
Mocks and source-contract assertions do not prove deployed database behavior.
The full E12.07 capability remains yellow even if these prerequisite tests pass.

### Isolated PostgreSQL adversarial witness

The actual migration also has reproducible fixtures in
`scripts/tests/time-assurance-postgres-bootstrap.sql` and
`scripts/tests/time-assurance-postgres-tests.sql`. Apply the bootstrap, actual
`20270103010000_time_synchronization_assurance.sql`, then tests with
`psql -v ON_ERROR_STOP=1` in a newly initialized disposable database only.
Apply the actual `20261121090000_audit_ledger_hardening.sql` between bootstrap and
the clock migration, then run `scripts/tests/time-assurance-history-postgres-tests.sql`
after the existing assertions. The historical tests cover revision-specific
tolerance/freshness, missing history, receipt forgery, shared append-only behavior
and timezone-independent reconstruction. The bootstrap deliberately substitutes
synthetic identity helpers; it is not a
full-chain, GoTrue, deployed-Supabase or production identity witness. It covers
initial/owner writes, incomplete NULL contracts, identity retention, deletion,
truncation, every changed replay field, hindsight, future events, stale receipts,
superseded revisions and an actual non-owner-role RLS query. The hosted smoke
must independently cover the real clean Supabase chain and authenticated users.
