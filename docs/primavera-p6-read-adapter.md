# Primavera P6 EPPM read adapter

**Status:** implemented and deterministic-test proven; not certified against a
customer P6 tenant. Capability-register item C2.16 remains partial until the
live acceptance evidence below exists.

## Contract

SyncAI reads one administrator-approved Oracle Primavera P6 EPPM project. P6
remains the system of record. The adapter issues only REST `GET` requests for
`Activity` and `Relationship`; it has no P6 write path.

The adapter extends the existing canonical path:

`connectors` → `connector_runs` → `ingest_schedule_batch` →
`shutdown_events` / `shutdown_tasks` / `shutdown_task_dependencies`

Changed activity identities are retained as duplicate staging evidence and use
the existing `schedule_import_revisions` workflow. Nothing overwrites the
canonical analysis copy until a named planner, reliability engineer,
maintenance manager, or administrator accepts the exact change set. Rejection
retains the evidence and changes no schedule data.

## Protected runtime configuration

Set both Edge Function secrets before an administrator enables a source:

- `P6_READ_ALLOWED_HOSTS`: comma-separated exact hostnames. Wildcards, private
  addresses, localhost, redirects, non-HTTPS endpoints, URL credentials, query
  strings, and fragments are refused.
- `P6_READ_CREDENTIALS_JSON`: a secret registry keyed by the opaque reference
  recorded in the connector. Each entry currently supports a rotated OAuth
  bearer token:

  ```json
  {
    "vault://customer/primavera-p6": {
      "type": "oauth_bearer",
      "access_token": "REDACTED"
    }
  }
  ```

Do not place a token in the connector row, browser, repository, URL, log, or
register. Rotate the protected secret before expiry. A future refresh-token or
client-credential profile must be separately reviewed against the customer's
Oracle identity deployment; the adapter does not guess an OAuth token endpoint.

In `/integrations`, an administrator records:

- the exact REST base ending before `/activity` and `/relationship`;
- the P6 `ProjectObjectId`;
- one same-tenant Sync Develop case and schedule name;
- the explicit conversion from the deployed P6 duration unit to hours;
- maximum activity and relationship rows;
- the opaque credential reference and a substantive approval basis.

There is intentionally no default duration conversion. Oracle duration values
are converted only by the multiplier the customer verifies for its deployment.

## Runtime controls

- Both resource responses must be complete JSON arrays from the approved
  project and exact host.
- Activity and relationship field lists, filter and `ObjectId` order are
  explicit.
- Each response is streamed through a 15 MB bound; the combined transport is
  limited to 25 MB and 55 seconds.
- Both byte streams are SHA-256 hashed. The manifest, cursor hashes, source byte
  count and activity row count must reconcile server-side.
- Activity scope escape, cross-project predecessors, missing activities,
  duplicate identities or edges, unknown P6 vocabulary, invalid dates,
  non-finite values, stale observation timestamps and repeated ingestion fail
  closed.
- Every schedule timestamp must include `Z` or an explicit UTC offset. If a P6
  deployment emits local times without an offset, configure and review an
  explicit source-timezone profile before extending this adapter; SyncAI does
  not guess the site timezone.
- Only a service-attested run can use the canonical importer or finish a run.
  A clean watermark advances only after every transported activity was read
  exactly once and no row was rejected.
- The Edge Function verifies the human bearer with Supabase Auth and carries
  that verified session's exact `aal1` or `aal2` value into the service-only
  importer. It never upgrades a session to satisfy an MFA policy.
- Tenant scope is derived server-side. Request input cannot choose another
  organization or development case.

## Live acceptance required before green

Use a non-production P6 project containing at least two linked activities and
capture retained evidence for all of the following:

1. Dry-run downloads, validates, maps and hashes both resources without
   creating a run, staging row, schedule row or watermark.
2. First committed pull creates the canonical activities and predecessor
   relationship with the customer-approved duration conversion.
3. Identical replay creates no revision noise.
4. A changed activity creates a pending revision; one named human accepts or
   rejects it and the audit receipt identifies that person.
5. A malformed or cross-project relationship is refused, retained in logs and
   does not advance the watermark.
6. Expired OAuth credentials fail without exposing the token; after rotation,
   retry succeeds without duplicating activities.
7. A foreign tenant cannot read the connector, run, staging evidence, schedule,
   revision or watermark.
8. Confirm in P6 audit evidence that SyncAI performed no source mutation.

Attach the customer, P6 version, approved host, ProjectObjectId, witness
identities, timestamps, run IDs, revision ID, hash references and failure/
recovery receipt to the acceptance record. Only then may C2.16 move to green.

## Oracle references

- [Activity GET](https://docs.oracle.com/en/industries/construction-engineering/primavera-p6-project/26/rest-api/op-activity-get.html)
- [Relationship GET](https://docs.oracle.com/en/industries/construction-engineering/primavera-p6-project/26/rest-api/op-relationship-get.html)
- [WBS GET](https://docs.oracle.com/en/industries/construction-engineering/primavera-p6-project/26/rest-api/op-wbs-get.html)
- [REST performance guidance](https://docs.oracle.com/en/industries/construction-engineering/primavera-p6-project/26/rest-api/D102457.html)
