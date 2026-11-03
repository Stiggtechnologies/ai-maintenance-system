# SAP S/4HANA Maintenance Order read adapter

**Status:** implemented and deterministic-test proven; not certified against a
customer SAP tenant. Capability-register item C2.12 remains partial until the
live acceptance evidence below exists.

## Contract

One connector reads one administrator-approved SAP `MaintenancePlanningPlant`
and maps maintenance-order headers onto canonical `work_orders` for assets that
already exist in the same tenant site. SAP remains the system of record for
the order header. The adapter issues `GET` requests only. There is no SAP
create, update, delete, status-change, or `$batch` route.

The service root must end in `API_MAINTENANCEORDER` or
`API_MAINTENANCEORDER;v=2`. The entity set is `MaintenanceOrder`. Those names
come from the published on-premise read specification
`OP_API_MAINTENANCEORDER_0001` (OpenAPI title "Maintenance Order - Read",
server `/sap/opu/odata/sap/API_MAINTENANCEORDER`) and from SAP Note 3614100,
which uses `API_MAINTENANCEORDER;v=2/MaintenanceOrder` on SAP S/4HANA Cloud
Public Edition. The Business Accelerator Hub page itself required a SAP ID
sign-in during this implementation, so the hub UI was not re-fetched live.

Selected properties, with the lengths in that specification:

| Property                                          | Use                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `MaintenanceOrder`                                | Order number, max 12. Canonical `wo_number` and part of `external_id`.              |
| `MaintenanceOrderDesc`                            | Description, max 40. Canonical `title`.                                             |
| `MaintenancePlanningPlant`                        | Planning plant, max 4. The fixed `$filter`.                                         |
| `Equipment`                                       | Equipment number, max 18. Must equal one `assets.external_id` in the approved site. |
| `TechnicalObjectLabel`                            | When present, must equal `Equipment`.                                               |
| `MaintOrdProcessPhaseCode`                        | Process phase, max 2. Translated only through an explicit administrator map.        |
| `MaintOrdBasicStartDate` / `MaintOrdBasicEndDate` | ISO-8601 timestamps, as in the published read sample (`2017-07-26T09:00:00+09:00`). |

`API_EQUIPMENT` is not called. Its entity set and field list were not
available from a public specification during this change, and the maintenance
order entity already carries `Equipment`. A separate equipment read must wait
until that service is verified the same way.

An empty phase does not assert a canonical status. A non-empty phase must be
mapped to one of `pending`, `scheduled`, `in_progress`, `blocked`, or
`completed`. `approval` and `critical` are not offered because those are
governance states. The adapter never writes failure mode, cause, corrective
action, labour, downtime, priority, work type, safety flag, or approval
fields. It does not create assets, approvals, or work from a functional
location alone. An empty plant response is refused rather than treated as a
closed backlog. A mapped non-complete phase cannot reopen an order that
already has `completed_at`.

The adapter extends the existing canonical path:

`connectors` → service-attested `connector_runs` → `ingest_staging` →
`work_orders` → `ingest_watermarks`

## Protected runtime configuration

Set both Edge Function secrets before an administrator enables a source:

- `SAP_S4_MAINTENANCE_ORDER_READ_ALLOWED_HOSTS`: comma-separated exact SAP
  hostnames. Wildcards, private addresses, localhost, redirects, URL
  credentials, non-HTTPS targets, query strings and fragments are refused.
- `SAP_S4_MAINTENANCE_ORDER_READ_CREDENTIALS_JSON`: secret registry keyed by
  the opaque reference stored on the connector. Each entry is a rotated OAuth
  bearer token:

  ```json
  {
    "vault://customer/sap-s4-maintenance": {
      "type": "oauth_bearer",
      "access_token": "REDACTED"
    }
  }
  ```

Never put a token in a connector row, browser, URL, repository, log or
capability register. The adapter does not guess a token URL. Client-credential
exchange stays outside this function, exactly as the inventory and finance
adapters.

In `/integrations`, a named human administrator records the service root,
planning plant, canonical site, optional phase map, row/page ceilings,
interval, opaque credential reference and a substantive mapping authority.
The `ai_admin` identity is refused.

## Runtime controls

- `$select`, `$filter`, `$orderby`, `$top` and JSON output are fixed by the
  adapter. The request body cannot alter the SAP query.
- OData V2 `d.__next` pagination must stay on the original HTTPS origin and
  resource path, retain the exact approved select/filter/order, and add only
  bounded paging parameters. Repeated page URLs are refused.
- Each response page is limited to 10 MB. A pull cannot cross 25 MB or 55
  seconds, the configured page ceiling, or the configured raw-row ceiling.
- Each complete response page is SHA-256 hashed. A SHA-256 contract binds the
  tenant, endpoint, credential reference, plant, phase map and transport
  ceilings from discovery through promotion.
- Only the service-attested Edge transport can begin, ingest or finish a run.
- A watermark advances only when every mapped order was read once and no row
  was rejected.

This function is not on the production deploy allowlist. `.github/workflows`
was intentionally left unchanged, so deploying it requires a separate
allowlist change.

## Live acceptance required before green

Use a non-production SAP tenant and retain evidence that:

1. Dry-run fetches every page and reports counts/hashes without creating a
   run, staging row, work order or watermark.
2. The first committed pull creates or updates only the header fields above
   for equipment that already exists, and leaves closeout and approval fields
   unchanged.
3. An unknown equipment number and an unmapped phase are refused with retained
   staging reasons and no clean watermark advance.
4. Identical replay is duplicate evidence and does not create a second order.
5. A malicious or malformed next link, excess page/row/byte response and
   expired OAuth all fail closed. Credential rotation recovers without
   duplicated orders.
6. A foreign tenant cannot read the connector, run, staging, work order or
   watermark, and SAP audit evidence confirms SyncAI performed no mutation.

## SAP references

- Published read specification checked for this change:
  `OP_API_MAINTENANCEORDER_0001` OpenAPI, title "Maintenance Order - Read",
  collection `GET /MaintenanceOrder`.
- [SAP Note 3614100](https://userapps.support.sap.com/sap/support/knowledge/en/3614100):
  `GET /sap/opu/odata/sap/API_MAINTENANCEORDER;v=2/MaintenanceOrder` and
  `MaintOrdProcessPhaseCode` `09` = Completion. `SYSTEMSTATUSTEXT` is not
  filterable and is not selected.
- [What's New in SAP S/4HANA 2022, OData API Maintenance Order](https://help.sap.com/doc/b870b6ebcd2e4b5890f16f4b06827064/2022.000/en-US/WN_OP2022_EN.pdf):
  the API was read-only before the 2022 write operations. This adapter uses
  only the read entity set.
