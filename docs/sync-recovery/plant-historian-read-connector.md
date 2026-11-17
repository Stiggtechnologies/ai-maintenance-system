# Governed plant historian read connector

This connector performs a bounded, user-triggered HTTPS `GET` of condition
readings from an approved historian or condition-monitoring JSON endpoint. It
never writes to the source system. It reuses SyncAI's canonical connector,
mapping, run, staging, reject, watermark, sensor, condition-reading, and alert
contracts rather than creating a parallel telemetry store.

## Deployment boundary

The Edge Function requires two deployment secrets:

- `PLANT_HISTORIAN_ALLOWED_HOSTS`: comma-separated exact lower-case
  hostnames. Do not add wildcards, private/local endpoints, or unapproved
  provider hosts.
- `PLANT_HISTORIAN_CREDENTIALS_JSON`: a JSON object keyed by the opaque
  binding URI stored on the connector. Every entry must include the owning
  SyncAI tenant ID. Plain strings and tenant-mismatched entries are refused.

Example shape (real values belong only in the platform secret store):

```json
{
  "vault://customer/historian": {
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "type": "bearer",
    "value": "secret-value-from-the-approved-provider"
  },
  "vault://customer/condition-monitoring": {
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "type": "header",
    "header": "x-api-key",
    "value": "secret-value-from-the-approved-provider"
  }
}
```

The entry tenant ID must equal the active organization returned by the
governed source RPC. The configured endpoint must match the deployment host
allow-list, and every next link must remain on the initial HTTPS origin.

## Activation sequence

1. A named human administrator saves the source disabled and records the
   credential-free endpoint, opaque secret binding, bounded pagination
   profile, and authority basis.
2. The administrator saves the canonical `condition_reading` mapping. Every
   mapping change disables the source so an old activation cannot authorize a
   new contract.
3. A permitted operator—or the AI administrator acting only as an
   evidence-preparation assistant—runs a dry run. Preview and commit use the
   same tenant sensor resolution, numeric, timestamp, quality, and replay
   validator. Preview writes neither staging nor canonical readings.
4. A named human reviews accepted, duplicate, and rejected outcomes and
   approves the mapping. An AI identity cannot approve, activate, begin,
   ingest, or finish canonical promotion.
5. The administrator enables the source. Activation is refused without a
   human-approved mapping. Seed/sim telemetry yields only at this point.
6. A named human operator triggers the pull. The same actor must ingest and
   finish it; concurrent pulls against the same watermark are refused.

The Edge Function carries a database-generated hash of the connector,
pagination profile, secret binding, mapping, and approval across source
transport and into the canonical run. A changed contract is refused both when
the run opens and before every ingest batch. The operator must start again
under the newly approved contract.

Failed or partial runs never advance the watermark. Rejected rows remain in
`ingest_staging` with a reason. Replays are deduplicated by source system and
external identity. Accepted readings flow through
`record_condition_reading`, preserving quality handling, historical-reading
semantics, limit evaluation, alert creation, and tenant isolation.

## Runtime ceilings

- 100 approved pages maximum; an administrator can set a lower ceiling
- 10,000 rows and 10 MB per page
- 50,000 rows and 50 MB per pull
- 55 seconds total source-transport time
- redirects, cross-origin next links, pagination loops, non-JSON responses,
  private/local targets, and non-GET source methods are refused

This is still a generic governed HTTPS JSON path. Vendor-certified PI/AVEVA,
AspenTech, Honeywell, or condition-monitoring bindings; vendor OAuth; private
network deployment; unattended scheduling; and provider-specific acceptance
testing remain separate production-integration work and must not be inferred
from this slice.
