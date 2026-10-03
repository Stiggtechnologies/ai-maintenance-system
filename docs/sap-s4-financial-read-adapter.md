# SAP S/4HANA G/L actuals read adapter

**Status:** implemented and deterministic-test proven; not certified against a
customer SAP finance tenant. Capability-register item C2.18 remains partial
until the live acceptance evidence below exists.

## Contract

One connector binds one administrator-approved SAP ledger, company code,
company-code currency and cumulative posting start date to one same-tenant
SyncAI development case. Its 1–40 explicit mappings bind SAP WBS internal ID +
G/L account pairs to cost lines that already exist on that case.

The adapter extends the canonical path:

`connectors` → service-attested `connector_runs` → `ingest_staging` →
`ingest_cost_actual_batch` → `record_cost_item` → `project_cost_items.actual`
→ `ingest_watermarks`

SAP remains the accounting system of record. SyncAI performs OData V2 `GET`
requests only against `API_GLACCOUNTLINEITEM_SRV/GLAccountLineItem`. It cannot
create a case, WBS, CBS or cost line; approve or revise a baseline; alter a
commitment, forecast or contingency; or write to SAP.

SAP journal lines may be positive or negative. The adapter sums signed
`AmountInCompanyCodeCurrency` values for each approved canonical cost line
using exact fixed-point decimal arithmetic; non-integer JSON numbers are
refused because a binary floating-point parse has already lost source
precision. SAP OData decimal strings remain exact through the canonical
PostgreSQL `numeric` writer.
The final cumulative total must be finite and non-negative. Every returned row
must match the exact ledger, company, currency and approved WBS/G/L pair. An
empty response or an approved mapping with no returned row is never interpreted
as zero.

## Protected runtime configuration

Set both Edge Function secrets before enabling a source:

- `SAP_S4_FINANCIAL_READ_ALLOWED_HOSTS`: comma-separated exact SAP hostnames.
  Wildcards, private addresses, localhost, redirects, URL credentials,
  non-HTTPS targets, query strings and fragments are refused.
- `SAP_S4_FINANCIAL_READ_CREDENTIALS_JSON`: protected registry keyed by the
  opaque reference stored on the connector:

  ```json
  {
    "vault://customer/sap-s4-finance": {
      "type": "oauth_bearer",
      "access_token": "REDACTED"
    }
  }
  ```

Never store a token in a connector row, browser, URL, repository, log or
register. Token exchange and rotation remain a customer identity binding; the
adapter does not guess an authorization server.

In `/integrations`, the administrator records the service root, case, ledger,
company code, currency, project accounting inception date, exact mapping lines,
row/page ceilings, interval, opaque credential reference and substantive
activation authority. Mapping format is:

`SAP_WBS_INTERNAL_ID | GL_ACCOUNT | EXISTING_COST_ITEM_REF`

## Runtime controls

- `$select`, `$filter`, `$orderby`, `$top`, date range and JSON output are
  generated from the approved connector. A request body cannot widen them.
- SAP explicitly recommends a single ledger and strongly restricted period.
  This adapter additionally restricts one company code and exact WBS/G/L pairs.
- OData `d.__next` must remain on the original HTTPS origin/resource, preserve
  the exact select/filter/order and add only bounded paging parameters.
- Each page is capped at 10 MB; one pull is capped at 25 MB, 55 seconds, the
  configured page count and raw-row count. Every page is SHA-256 hashed.
- Manifest page numbers, exact scope, date window, byte count and row count
  reconcile server-side before a run can open.
- The database independently verifies the attested actor, tenant, connector,
  row count, exact case/currency/cost reference and source timestamp.
- The existing cost importer retains accepted, duplicate and rejected source
  evidence and invokes the one `record_cost_item` writer. All non-actual cost
  fields are passed back exactly as stored.
- Direct client run creation, ingestion and completion are revoked and
  trigger-blocked. A watermark advances only for a complete zero-reject run.

## Live acceptance required before green

Using an approved non-production SAP finance tenant, retain evidence that:

1. Dry run downloads and hashes every page without creating a run, staging
   row, cost update or watermark.
2. SAP totals for each mapped pair reconcile independently to the posted
   cumulative amount and the canonical cost line.
3. Debits, credits and reversals aggregate correctly; a negative final total,
   mixed currency or unapproved pair fails closed.
4. Missing mapping rows are reported as missing and do not overwrite an
   existing actual with zero.
5. First committed pull changes only `actual` and source identity; baseline,
   commitment, forecast, contingency, WBS/CBS coding and approvals remain exact.
6. Identical replay creates no additional economic fact. A conflicting reused
   source identity is retained as a refusal.
7. Malformed pagination, excess page/row/byte response, concurrent run, stale
   observation and expired OAuth all fail closed; credential rotation recovers
   without duplicate actuals.
8. A foreign tenant cannot read the connector, run, staging, cost line or
   watermark, and SAP audit evidence confirms no mutation.
9. A named finance authority signs the ledger/company/currency/posting-window
   and WBS/G/L mapping reconciliation.

Attach customer, SAP release, host, communication arrangement, exact scope,
mapping approval, witness identities, timestamps, run IDs, page hashes,
reconciliation workbook and failure/recovery receipt. Only then may C2.18 move
to green.

## SAP references

- [G/L Account Line Items - Read (A2X)](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/3ab6e6fc510f4840a5508e126ef01e22/80214b5ede2f4e97b640137a4eca208a.html?locale=en-US)
- [Finance APIs and communication arrangement](https://help.sap.com/docs/SAP_S4HANA_CLOUD/6b39bd1d0e5e4099a5b65d835c29c696/5792333ddf3c47eaad4314b071dfd684.html)
- [Journal Entry Item Basic fields](https://help.sap.com/docs/SAP_S4HANA_CLOUD/c0c54048d35849128be8e872df5bea6d/50b1d45d70f24030a47e381dba83f009.html)
