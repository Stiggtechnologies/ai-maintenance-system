# SAP S/4HANA Material Stock read adapter

**Status:** implemented and deterministic-test proven; not certified against a
customer SAP tenant. Capability-register item C2.17 remains partial until the
live acceptance evidence below exists.

## Contract

One connector reads one administrator-approved SAP Plant and StorageLocation
and maps them to one same-tenant SyncAI site. SAP remains the system of record.
The adapter issues `GET` requests only to the SAP S/4HANA Material Stock read
API entity `A_MatlStkInAcctMod`; there is no SAP mutation route.

The adapter extends the existing canonical path:

`connectors` → service-attested `connector_runs` → `ingest_staging` →
`material_stock` → `ingest_watermarks`

Only SAP inventory stock type `01` (unrestricted-use stock) with an empty
special-stock type is counted as general on-hand inventory. The response is
grouped by exact material code and base unit. Each code must already exist in
the governed tenant `materials` catalogue, its UOM must match exactly, and the
configured site cannot be selected or widened by the pull request.

The adapter updates only `qty_on_hand`, `last_counted_at`, source identity and
the stock-row update timestamp. Existing `qty_reserved`, `qty_on_order` and
`expected_receipt_date` evidence is preserved because this API does not prove
those values. An empty response is refused rather than interpreted as a
zero-stock snapshot.

## Protected runtime configuration

Set both Edge Function secrets before an administrator enables a source:

- `SAP_S4_INVENTORY_READ_ALLOWED_HOSTS`: comma-separated exact SAP hostnames.
  Wildcards, private addresses, localhost, redirects, URL credentials,
  non-HTTPS targets, query strings and fragments are refused.
- `SAP_S4_INVENTORY_READ_CREDENTIALS_JSON`: secret registry keyed by the opaque
  reference stored on the connector. Each entry currently supports a rotated
  OAuth bearer token:

  ```json
  {
    "vault://customer/sap-s4-inventory": {
      "type": "oauth_bearer",
      "access_token": "REDACTED"
    }
  }
  ```

Never put a token in a connector row, browser, URL, repository, log or
capability register. Rotate the protected secret before expiry. Client
credentials or refresh-token exchange must be separately bound to the
customer's SAP identity deployment; the adapter does not guess a token URL.

In `/integrations`, a named human administrator records the exact OData service
root, Plant, StorageLocation, canonical tenant site, row/page ceilings,
expected interval, opaque credential reference and a substantive mapping
authority. The `ai_admin` identity is explicitly refused. Use one connector
per Plant + StorageLocation → site mapping.

## Runtime controls

- `$select`, `$filter`, `$orderby`, `$top` and JSON output are fixed by the
  adapter. The request body cannot alter the SAP query.
- OData V2 `d.__next` pagination must stay on the original HTTPS origin and
  resource path, retain the exact approved select/filter/order, and add only
  bounded paging parameters. Repeated page URLs are refused.
- Each response page is limited to 10 MB and receives only the remaining
  combined streaming budget; a pull cannot cross 25 MB or 55 seconds across
  transport and mapping, the configured page ceiling, or the configured
  raw-row ceiling.
- Each complete response page is SHA-256 hashed. Sequential page number, exact
  source scope, byte count and raw-row count must reconcile server-side before
  a run is opened.
- Mapping rejects a scope escape, stock type other than `01`, special stock,
  missing or overlong identity/UOM, negative or non-finite quantity,
  conflicting units or an empty result.
- The database independently checks row shape, exact source identity,
  material code, UOM, site and observation timestamp. Unknown materials and
  UOM mismatches are retained with refusal reasons.
- Only the service-attested Edge transport can begin, ingest or finish a run.
  Direct client execution is revoked and direct run creation is trigger
  blocked.
- A watermark advances only when every mapped material balance was read once
  and no row was rejected. Partial runs retain successful stock updates and
  refusals but do not move the clean cursor.
- Tenant scope and actor identity are derived from the verified bearer and
  rechecked in every service-only database function.

## Live acceptance required before green

Use a non-production SAP tenant and approved stock location to retain evidence
for all of the following:

1. Dry-run fetches every page and reports counts/hashes without creating a run,
   staging row, stock update or watermark.
2. First committed pull updates the expected unrestricted balances while a
   pre-existing reservation, on-order quantity and receipt date remain exact.
3. Identical replay is retained as duplicate evidence and creates no extra
   stock row.
4. An unknown material and a base-UOM mismatch are refused with retained
   staging reasons and no clean watermark advance.
5. Blocked, quality, returns and special stock do not enter general on-hand
   inventory.
6. A malicious or malformed next link, excess page/row/byte response, stale
   observation and concurrent run all fail closed.
7. Expired OAuth fails without exposing the token; after rotation, retry
   succeeds without duplicated balances.
8. A foreign tenant cannot read the connector, run, staging, stock or
   watermark, and SAP audit evidence confirms SyncAI performed no mutation.

Attach the customer, SAP release, approved host, Plant, StorageLocation,
canonical site, witness identities, timestamps, run IDs, page hashes and
failure/recovery receipt to the acceptance record. Only then may C2.17 move to
green.

## SAP references

- [Material Stock - Read API](https://help.sap.com/docs/SAP_S4HANA_CLOUD/3f57e7df4a114edabffe8b2d581a59ed/f68f51a4dc2e46779877a10a301d9138.html)
- [Read Material Stock operation](https://help.sap.com/docs/SAP_S4HANA_CLOUD/3f57e7df4a114edabffe8b2d581a59ed/dfc5b3e292874297843ed6cfb08eb83a.html)
- [Material Stock response example](https://help.sap.com/docs/SAP_S4HANA_CLOUD/3f57e7df4a114edabffe8b2d581a59ed/0805d101dc5140bb91444c3d6271b984.html)
- [Inventory stock type semantics](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/ee6ff9b281d8448f96b4fe6c89f2bdc8/b03aeebad0bb4594a1f0183dd1aeeeab.html)
