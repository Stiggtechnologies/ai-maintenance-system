# SAP S/4HANA human-approved write-back

**Status:** built and tested against mocked SAP responses only. This path is not certified against a customer SAP tenant. Not on the production Edge deploy allowlist
(`config/edge-function-boundary.json` and `.github/workflows/deploy-migrations.yml`
do not deploy `sap-s4-write-execute`). Capability-register item C2.20 stays
partial until the live acceptance evidence below exists.

## What this does

A tenant member proposes one allowlisted OData V2 write. The proposal is stored
on `sap_s4_write_requests` with the payload, target service, target entity,
requester, tenant and a SHA-256 of the canonical payload. SAP is not called.

A different person whose role passes `app_has_approval_authority()` — the same
human role set as `public.app_role_has_approval_authority()` and the autonomous
orchestrator — approves or rejects it through `decide_sap_s4_write`. The
requester cannot approve, reject or execute their own request. The
orchestrator's internal service-role bypass is not reused.

`claim_sap_s4_write_execution` is service-role only. It returns `call_sap: true`
only when the request is `approved`, the per-tenant flag is on, and the
connector is explicitly write-enabled. The Edge function then fetches a SAP
Gateway CSRF token and performs the single POST or PATCH. A repeated call for
an already executed request returns the stored HTTP status and does not call
SAP again. A claim left in `executing` is not automatically retried, because a
retry could double-post if SAP had already applied the first attempt.

Every propose, decision, refusal, claim and SAP result inserts an
`audit_events` row. That ledger stays append-only: this change does not grant
update or delete on it and does not replace `trg_audit_events_append_only`.
The audit row carries the actor, timestamps, payload hash, SAP HTTP status and
error text. The raw SAP body is not stored.

## Per-tenant flag

`sap_s4_write_settings.enabled` defaults to false. No row means disabled.
`set_sap_s4_write_enabled(true, basis)` is an administrator act. Turning the
flag off also disables every `sap_s4_write` connector. A connector cannot be
enabled while the flag is off.

## Allowlisted operations

Confirmed against the published API contracts, not against a customer system:

| Operation                              | Method | Service                                               | Target                                                                    |
| -------------------------------------- | ------ | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `maintenance_notification_create`      | POST   | `API_MAINTNOTIFICATION`                               | entity set `MaintenanceNotification`                                      |
| `maintenance_notification_text_update` | PATCH  | `API_MAINTNOTIFICATION`                               | `MaintenanceNotification('<number>')`, body field `NotificationText` only |
| `maintenance_order_release`            | POST   | `API_MAINTENANCEORDER` (optional `;v=2` or `;v=0002`) | function import `ReleaseMaintenanceOrder?MaintenanceOrder='<number>'`     |

Citations:

- SAP Cloud SDK `MaintenanceNotificationService`, OData service
  `API_MAINTNOTIFICATION`, `createMaintenanceNotification` /
  `updateMaintenanceNotification`:
  <https://javadoc.io/static/com.sap.cloud.sdk.s4hana/s4hana-api-odata/4.30.0/com/sap/cloud/sdk/s4hana/datamodel/odata/services/MaintenanceNotificationService.html>
- SAP Cloud SDK maintenance-order package, `ReleaseMaintenanceOrderFluentHelper`:
  <https://javadoc.io/static/com.sap.cloud.sdk.s4hana/s4hana-api-odata/3.73.0/com/sap/cloud/sdk/s4hana/datamodel/odata/namespaces/maintenanceorder/package-summary.html>
- SAP KBA 3614398, which documents the sibling status imports on
  `API_MAINTENANCEORDER;v=2` as `POST .../<Import>?MaintenanceOrder=''`:
  <https://userapps.support.sap.com/sap/support/knowledge/en/3614398>

Notification short text is limited to 40 characters and object keys to 12
characters. Those are transport bounds aligned to the published header fields,
not operating or safety limits. No notification type, priority or order status
is invented by the adapter. PATCH sends `If-Match: *` because SAP Gateway
requires a precondition on OData updates. CSRF uses `X-CSRF-Token: Fetch` on a
GET of the service root, then the returned token and session cookie on the
mutating request. The CSRF GET runs only after approval.

OAuth bearer tokens use the same shape as the read adapters
(`SAP_S4_WRITE_CREDENTIALS_JSON`, keyed by the opaque connector reference) and
`SAP_S4_WRITE_ALLOWED_HOSTS` for the exact HTTPS host. Tokens are not stored
on the connector row.

## Flow

1. An administrator saves the tenant flag. Default is off. No SAP call.
2. An administrator configures one connector whose service root ends in
   `API_MAINTNOTIFICATION` or `API_MAINTENANCEORDER`. Enabling it requires the
   tenant flag. No SAP call.
3. A named human proposes an allowlisted payload and an idempotency key.
   The row is `pending`. An audit row records the requester and payload hash.
4. A different approval-authority user approves or rejects. An audit row
   records that person. SAP is still not called.
5. An approval-authority user who is not the requester executes. The database
   moves `approved` to `executing` in one update. Only then does the Edge
   function call SAP. The completion writes the HTTP status and error into a
   new audit row and sets `executed` or `failed`.
6. A retry of an executed request returns the stored result and performs no
   second write.

The customer surface is `SapS4WriteConnectorSetup` on `/integrations`.

## Tests

`src/test/sapS4WriteCore.test.ts` uses a mocked `fetch`. It shows that an
unapproved claim never calls HTTP, that a non-approver and the requester
cannot decide, that an approved notification performs one CSRF GET and one
POST, that a CSRF failure does not PATCH or POST, and that an idempotent
replay does not call HTTP. The completion passed to the audit writer includes
the payload hash and SAP status.

`src/test/sapS4WriteAdapterContract.test.ts` checks the migration, the role
set, the append-only audit reuse, the default-off flag, and that the function
is not deployed.

No migration was applied to a database for this change, and no customer SAP
system was called.

## Live acceptance still required

Before C2.20 can move to green, a non-production SAP tenant must witness:

1. The flag and connector default off, and a disabled tenant cannot propose.
2. A non-approver and the requester are refused, with audit rows and no SAP call.
3. An approved notification create returns the SAP notification number once.
4. Replaying that request does not create a second notification.
5. A release changes only the named maintenance order, and a text PATCH changes
   only `NotificationText`.
6. A failed CSRF or HTTP error is retained and is not automatically retried.
7. A foreign tenant cannot read the request or the audit row.

Until that witness exists, this path is a governed mock-tested implementation,
not a certified SAP integration.
