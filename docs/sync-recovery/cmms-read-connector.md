# Governed CMMS read connector

This connector performs a bounded, user-triggered HTTPS `GET` of work orders
from an approved CMMS JSON endpoint. It never writes to the source system. It
uses SyncAI's canonical connector, run, mapping, staging, reject, watermark,
and `work_orders` records rather than creating a parallel integration store.

## Deployment boundary

The Edge Function requires two deployment secrets:

- `CMMS_READ_ALLOWED_HOSTS`: comma-separated, exact lower-case hostnames. Do
  not add wildcards, private endpoints, localhost names, or hosts that are not
  controlled by the approved integration owner.
- `CMMS_READ_CREDENTIALS_JSON`: a JSON object keyed by the opaque binding URI
  saved in the connector. Every entry must carry the owning SyncAI tenant ID;
  plain string credentials are refused.

Example shape (place real values only in the platform secret store):

```json
{
  "vault://customer/cmms": {
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "type": "bearer",
    "value": "secret-value-from-the-approved-provider"
  },
  "vault://customer/maximo": {
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "type": "header",
    "header": "x-api-key",
    "value": "secret-value-from-the-approved-provider"
  }
}
```

The tenant ID must equal the active organization returned by the governed
source RPC. This prevents a tenant administrator from guessing another
tenant's binding name and using its credential. The endpoint hostname must
also match the deployment allow-list, and every pagination link must remain on
the initial HTTPS origin.

## Activation sequence

1. A named human administrator saves the source **disabled** and saves a draft
   canonical field mapping with its evidence basis.
2. A permitted human operator—or the AI administrator acting only as an
   evidence-preparation assistant—runs a dry run. Preview uses the same row
   validator and duplicate identity as commit, but writes no staging or
   canonical rows.
3. A named human reviews the accepted, duplicate, and rejected outcomes and
   approves the mapping. An AI administrator cannot create this approval.
4. The administrator enables the source. Activation is refused unless an
   approved work-order mapping already exists.
5. A named human triggers the canonical pull. Only that actor may
   ingest and finish the run; another same-tenant actor cannot take it over.

The Edge Function carries a server-generated hash of the connector,
pagination, credential binding, mapping, and approval into the canonical run.
If any of that contract changes after transport starts—or between ingest
batches—the pull fails without advancing its watermark. The operator must
start a fresh pull under the newly approved contract.

A failed or partial run never advances the watermark. Rejected rows remain in
`ingest_staging` with their reason. Replays are deduplicated by the governed
source system and external identity.

## Runtime ceilings

- 100 approved pages maximum (the administrator can choose a lower limit)
- 10,000 rows and 10 MB per page
- 50,000 rows and 50 MB per pull
- 55 seconds total source-transport time
- redirects, cross-origin next links, pagination loops, and non-JSON responses
  are refused

The connector remains deliberately user-triggered. Vendor-certified OAuth,
private-network deployment, unattended scheduling, and provider-specific
acceptance testing remain separate production-integration work and must not be
inferred from this initial governed read path.
