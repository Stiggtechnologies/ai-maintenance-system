# Time-synchronization assurance

SyncAI qualifies event timestamps; it does not configure or discipline plant
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

- `unconfigured` — no approved contract;
- `disabled` — the connector is not operational;
- `unproven` — no measurement matches the active revision;
- `stale` — the latest matching measurement exceeds its approved age;
- `untrusted` — worst-case offset exceeds the approved tolerance;
- `synchronized` — current evidence is within the approved tolerance.

Only `synchronized` is eligible for time-sensitive evidence. The
`evaluate_connector_event_time` RPC evaluates the state that applied at a
specific event time rather than rewriting the source timestamp or using the
latest result retroactively.

## Azure IoT Operations and OPC UA

For the Azure IoT Operations path, deploy clock measurement beside the
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
- Deleting a connector follows the existing connector lifecycle and cascades
  its observations. Individual observations cannot be edited or deleted.

## Verification

`scripts/ci-time-synchronization-assurance-smoke.sh` proves named-human
configuration, service-only ingestion, exact signed offset, uncertainty,
replay safety, revision invalidation, stale/untrusted refusal, direct-write
protection, and two-tenant isolation on the clean migration chain.
