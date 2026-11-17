# Governed Azure Data Lake read connector

This connector performs bounded, user-triggered reads from an approved Azure
Data Lake Storage Gen2 filesystem. It uses Microsoft client-credential OAuth
and HTTPS `GET` only. It never writes, deletes, leases, or changes metadata in
the customer's lake. Parsed rows enter SyncAI through the existing Recovery
connector, run, staging, rejection, canonical-entity, and watermark contracts.

## Deployment boundary

The Edge Function requires two deployment secrets:

- `RECOVERY_CONNECTOR_ALLOWED_HOSTS`: comma-separated exact lower-case ADLS
  DFS account hostnames, such as `customerlake.dfs.core.windows.net`. Wildcards,
  private/local targets, redirects, and alternate hosts are refused.
- `RECOVERY_CONNECTOR_CREDENTIALS_JSON`: a JSON object keyed by the opaque
  binding URI stored on the connector. Each ADLS entry must bind the secret to
  one SyncAI organization and identify the Microsoft Entra tenant separately.

Example shape (real values belong only in the platform secret store):

```json
{
  "vault://customer/adls-recovery": {
    "type": "azure_service_principal",
    "organization_id": "00000000-0000-0000-0000-000000000000",
    "tenant_id": "11111111-1111-4111-8111-111111111111",
    "client_id": "22222222-2222-4222-8222-222222222222",
    "client_secret": "secret-value-from-the-approved-vault"
  }
}
```

`organization_id` is the owning SyncAI tenant. `tenant_id` is the Microsoft
Entra directory used to obtain the storage token. A missing or mismatched
SyncAI organization is refused before token acquisition. Tokens are cached by
organization, binding, and client identity so two tenants cannot share a cache
entry merely by guessing the same opaque binding name.

The service principal should have only the minimum read/list permissions on
the approved filesystem or path. Do not grant write, delete, owner, or account
management permissions.

## Activation sequence

1. A named human administrator saves the source disabled, with an exact DFS
   filesystem root, object prefix, serialization format, file/byte ceilings,
   polling expectation, opaque secret binding, and substantive authority basis.
2. The administrator saves a draft entity mapping. A permitted user, including
   an AI administrator acting only as an evidence-preparation assistant, may
   transport and dry-run the disabled/draft contract. Dry-run writes no run,
   staging, canonical, rejection, or watermark row.
3. The named human administrator reviews the results and approves the mapping.
   The generic Recovery mapping RPC cannot mutate an ADLS mapping, and every
   mapping change disables the source.
4. The named human administrator reviews the complete contract and activates
   the source. Activation is refused until at least one mapping has a current
   named-human administrator approval.
5. A named human planner, reliability engineer, maintenance manager, or
   administrator triggers commit. AI identities may not begin, ingest, finish,
   approve, configure, or activate canonical promotion.
6. The same named human owns begin, every ingest batch, and finish. A second
   same-tenant user cannot take over the run, and another run for the same
   connector/entity is refused while one is open.

The database generates an immutable hash over the owning tenant, connector,
endpoint, limits, secret binding, entity mapping, mapping basis, and approval.
The Edge Function reads that hash before transport and presents it when opening
the run. The database checks it at begin, every ingest batch, and successful or
partial finish. If configuration changes mid-run, no further rows are promoted
and only a governed failure close is permitted.

## Evidence and recovery semantics

Every selected object is listed and fully downloaded before a run opens. The
retained manifest records path, ETag, last-modified time, content length,
SHA-256, and parsed row count. Every mapped row carries an exact receipt that
must match one manifest object. The final row counts must reconcile with the
manifest before success or partial completion is accepted.

Rejected rows remain in canonical staging with their reasons. Exact business
payload replays are retained as duplicates. A watermark advances only after a
fully reconciled success with zero rejects, and only if the proposed
`{last_modified,path}` cursor is newer than the existing clean cursor. Partial,
failed, interrupted, stale, or contract-mutated runs never advance it.

## Runtime ceilings

- 20 listing pages maximum
- 100,000 listing entries inspected maximum
- 5 MB maximum per listing response
- 100 selected objects maximum; an administrator can set a lower limit
- 20,000 rows per object and 50,000 rows per pull
- 50 MB aggregate object payload maximum
- 55 seconds total source-transport time
- CSV (RFC 4180), JSON Lines, and JSON object-array inputs only

## Honest production status

The repository proves the adapter contract, tenant walls, named-human gates,
dry-run/write separation, immutable evidence, replay handling, reconciliation,
and clean-watermark behavior. C2.14 remains yellow until a real customer ADLS
account, least-privilege identity, representative production objects, private
network posture where required, and live pull/replay/failure-recovery witness
have passed in that tenant. Repository tests are not a substitute for this
external acceptance witness.
