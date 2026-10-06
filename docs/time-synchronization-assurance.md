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

SyncAI does not supply a default tolerance. Deliberately changing any of those inputs
creates a new monotonic contract revision. Measurements from earlier revisions
remain in history but cannot qualify the new contract.

Each configuration act requires a caller-generated `p_idempotency_key` UUID.
The tenant/key is serialized before the connector lock and has a unique receipt
in the **existing** `audit_events` ledger, not a separate request/history store.
An exact retry by the currently authorized original administrator, with the
same connector and all normalized inputs, returns the original audit receipt
without changing the revision, configuration instant, observations or history.
Changed actor, connector or inputs under the same key are refused. Equal keys
in different tenants are independent. A receipt replay can be historical:
`configuration_revision` is the original receipt's revision and
`current_configuration_revision` is the connector's current revision. Neither
is evidence approval. The earlier seven-argument non-idempotent development
overload is removed by this unapplied draft migration.

A different key with all inputs identical to the current contract is refused
without mutation. Re-entering an unchanged contract after a browser reload
cannot create another revision merely by generating a new key. Reconfirmation
that changes a recorded basis or reference is a separate deliberate act.
Historical administrators need not remain administrators forever: unrelated
source-rights, health and disable changes do not revalidate the old clock actor.
New clock-field changes and configuration/replay requests still require current
same-tenant administrator standing, re-evaluated after serialization waits before
receipt lookup or mutation; old receipts are never rewritten.

A controlled service submits observations through
`record_connector_time_observation`. The database calculates signed offset
from source and reference timestamps, adds stated measurement uncertainty for
a conservative worst-case result, refuses understated round-trip uncertainty,
and makes deliveries replay-safe with a stable delivery ID plus SHA-256 body
digest. Direct inserts, updates, and deletes are refused.

Each submitted envelope must name `p_configuration_revision`: the contract the
collector observed for that measurement, not whichever revision happens to exist
at delivery time. The RPC compares it to the active revision under the same
connector lock used by configuration. Missing, NULL, non-positive, superseded and
unrecorded future revisions are refused without an observation insert. A retry
cannot relabel a previously stored delivery with a new revision. An in-flight
measurement overtaken by reconfiguration must be recollected against the new
contract; changing its revision to make it pass is not permitted. This binds the
collector's declared context, not proof of the collector's truthfulness or source
approval, and does not turn numerical posture into evidence eligibility.

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

Read and write responses are runtime-qualified, including requested connector,
event instant (preserving microseconds), intent and audit identities, revisions,
and literal false approval/eligibility/authority fields. Missing, malformed or
contradictory payloads are not an empty workspace or a confirmed write.
Offset must match the source/reference microsecond difference, and worst-case
offset must equal absolute offset plus uncertainty using exact decimal arithmetic
on the numeric values represented by the JSON response. Current posture is checked
against the server's `generatedAt` witness and recorded freshness, never the
browser clock. Unsafe numeric magnitudes and read-boundary contradictions are
refused without an invented engineering epsilon or grace interval; this does not
recover precision already lost before JSON decoding. Event receipts recorded
after the requested event, or contradictory verified-history metadata, are refused.
A configuration transport failure or unqualified acknowledgement leaves its
immutable proposal locked on screen; the explicit safe retry reuses the same
intent. Only a complete bound receipt or a qualified refusal releases it.
The current pending proposal is component-local and is **not persisted across
navigation/reload**. The screen warns users to reconcile before leaving; it does
not claim cross-session recovery of an unresolved proposal. Canonical status
refresh is scheduled separately, not treated as an awaited fresh-state proof.

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
  "configuration_revision": "explicit active revision captured for this measurement",
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

The actual browser test uses two explicit CI-only synthetic manual-file sources,
one enabled and one disabled. Setup is restricted to the disposable GitHub Actions
loopback database and an explicit fixture marker; existing demo connectors are not
enabled or altered. The enabled case proves persisted draft configuration and
recorded-chain assessment without an observation or evidence eligibility. The
disabled case independently proves refusal after the same configuration workflow.
These fixtures do not represent live feeds, collectors or production clocks.
The preceding checkpoint's browser failure exposed an arbitrary first-option
selection of a disabled demo source, not permission to weaken that refusal.

### Isolated PostgreSQL adversarial witness

The actual migration also has reproducible fixtures in
`scripts/tests/time-assurance-postgres-bootstrap.sql` and
`scripts/tests/time-assurance-postgres-tests.sql`. Apply the bootstrap, actual
`20270103030000_time_synchronization_assurance.sql`, then tests with
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
Run `scripts/tests/time-assurance-revision-postgres-tests.sql` next to verify
omitted/NULL/non-positive revisions, an earlier measurement with a new delivery
ID after reconfiguration, unrecorded future revisions, unchanged refused-row
counts, explicit active-revision acceptance/replay, subsequent invalidation and
the revised function's actual anon/authenticated/service-role execute privileges.
Then run `scripts/tests/time-assurance-configuration-intent-postgres-tests.sql`
for exact normalized receipt replay, every changed input, actor/connector and
tenant key isolation, no-op refusal, original-versus-current revisions with
retained observations, missing-key/obsolete-overload refusal, and historical
actor demotion/transfer without granting new clock-write authority. These new
fixtures must be actually executed at the repaired head before claiming a pass.

`scripts/tests/time-assurance-concurrency-postgres.mjs` adds an actual two-session
witness, with a third session inspecting PostgreSQL's blocking relationship.
Its isolated mode accepts only an explicitly marked owned Unix-socket test cluster and a
`clock_*` database with the synthetic identity helpers and no `auth.users`.
Run it after the above fixtures with Node and arguments
`--disposable-clock-fixture <owned-socket-directory> <port> <clock-database>`.
When configuration wins, the older declared measurement waits and is refused
without an insert. When observation wins, its original revision is retained and
the waiting new contract remains unproven. The fixture retains its four new
configuration receipts and one synthetic observation; no records are deleted.
The clean-chain smoke also invokes an explicitly marked `--ci-clock-fixture`
mode, restricted to GitHub Actions, loopback port 54322, the disposable `postgres`
database, and the newly created E12 fixture identity. This exercises the actual
clean-chain RPCs with controlled SQL JWT claims; separate HTTP smoke requests
exercise real GoTrue tokens. It does not prove customer or production identities.
Both modes test actual blocking, same-key cross-connector collision without
mutation, exact replay, a waiting retry after the first transaction rolls
back, and refusal when the original actor is demoted while a replay waits.
The clean-chain smoke separately tests actual source-health and rights
RPCs after historical administrator demotion/transfer in a rolled-back fixture.
These new concurrency/authority paths are not qualified until their actual
exact-head run passes. No real collector or production concurrency claim is made.
