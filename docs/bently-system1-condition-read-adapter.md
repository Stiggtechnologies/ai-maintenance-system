# Bently Nevada System 1 condition-data read

## Purpose

C2.19 adds a real, bounded System 1 integration without pretending that System
1 exposes a public SaaS REST API. A customer-operated gateway reads the System
1 OPC UA export at the customer boundary and exposes one narrow endpoint:

`GET /syncai/v1/system1/readings?after=<UTC>&limit=<n>&cursor=<opaque>`

The complementary real-time route remains Azure OPC Publisher → Event Hubs →
the governed SyncAI ingress. Both routes converge on the same canonical sensor
registry and `condition_readings`; neither introduces a parallel telemetry
store.

## Gateway response contract

```json
{
  "items": [
    {
      "sampleId": "source-stable-id",
      "nodeId": "ns=2;s=Plant/P101/DE/Vibration",
      "value": "4.125",
      "timestamp": "2026-10-03T12:05:00Z",
      "quality": "Good",
      "unit": "mm/s"
    }
  ],
  "nextCursor": null,
  "complete": true
}
```

Decimal values are strings so the gateway does not silently round evidence.
Quality is exactly `Good`, `Uncertain` or `Bad`. `Uncertain` and `Bad` readings
are retained but the canonical writer does not let them create or clear an
alert.

## Governance boundary

- A named human administrator binds 1–200 exact OPC UA node IDs to existing,
  active, same-tenant canonical sensor UUIDs and exact engineering units.
- The endpoint, opaque credential reference, bindings and row/page ceilings are
  included in a SHA-256 contract hash from source discovery through finish.
- AI administrators may run a write-free dry run but cannot configure, enable
  or promote readings.
- Only named reliability engineers, maintenance managers or administrators can
  trigger promotion.
- The Edge Function performs host-allowlisted HTTPS `GET` only. It cannot write
  an OPC value, call a method, acknowledge an alarm, alter a limit or command
  equipment.
- Every page is size-bounded, hashed and cursor-reconciled. A service-only run
  attests the complete manifest before the first canonical write.
- Accepted, duplicate and refused rows are retained in canonical staging.
  Only a fully reconciled success with no refusals advances the watermark.
- If a process dies after opening a run, a named reliability, maintenance or
  administrator user can retain that run as failed after a 15-minute guard,
  with a substantive reason and audit event. Recovery cannot ingest, advance
  the watermark or mutate System 1.

## Deployment

Configure the Edge Function with:

- `SYSTEM1_READ_ALLOWED_HOSTS`: comma-separated exact gateway hostnames.
- `SYSTEM1_READ_CREDENTIALS_JSON`: opaque binding registry. Every entry is
  tenant-bound, for example:

```json
{
  "vault://north/system1": {
    "tenant_id": "tenant-uuid",
    "type": "bearer",
    "value": "secret resolved by deployment"
  }
}
```

The database stores only the opaque binding URI, never the secret value.

## Acceptance before claiming a live customer integration

C2.19 remains yellow until a real tenant witnesses the approved gateway and
OPC UA namespace, node/unit reconciliation, non-good quality handling, bounded
pagination, replay, failure recovery, watermark behavior, source-side
no-mutation evidence and reliability/OT cybersecurity sign-off.
