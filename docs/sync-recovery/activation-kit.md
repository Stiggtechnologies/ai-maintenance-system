# Recovery Activation Kit

The Recovery Activation Kit is SyncAI's controlled first-customer path from a
tenant source to a governed Recovery draft. It extends the canonical connector,
asset, work, materials, workforce, operating-context and Recovery contracts; it
does not create a second import queue, work-order store, plan engine or approval
path.

## What ships

- Eight ordered domains: sites, assets, work orders, materials, material stock,
  craft capacity, operating state and production records.
- CSV fallback parsed in the browser and a JWT-protected generic JSON `GET`
  adapter for CMMS/EAM/ERP/inventory/data-lake/scheduling sources.
- Human-approved column, vocabulary and constant mappings, including the
  decision basis and approver.
- A dry run that writes neither canonical nor staging rows.
- Batch validation, tenant-bound identity resolution, idempotent master-data
  upsert, immutable-history deduplication, retained rejects and replay.
- Source freshness, mapping state, domain coverage and 30-day rejection
  evidence. No arbitrary completeness percentage is treated as an engineering
  release threshold.
- A transactional first-plan guide. A human selects the asset, work orders,
  event type and counterfactual baseline. Any refused canonical step rolls the
  transaction back. Success creates a `draft`; existing independent approval
  and release gates remain mandatory.

## Activation order

Use one stable connector key across the tenant's first-source bundle and load
in dependency order:

1. `site`
2. `asset`
3. `work_order` and `material`
4. `material_stock` and `craft_capacity`
5. `operating_state` and `production_record`

Every row requires a stable `external_id`. Child records reference the parent's
source identity (`site_external_id`, `asset_external_id` or
`material_external_id`), not a database UUID copied out of SyncAI. An unresolved
or cross-tenant identity is rejected and retained; it never becomes a null
foreign key.

The exact accepted fields are the programmatic definitions in
`src/lib/recovery-activation/index.ts`. The Activate Tenant tab proposes header
aliases, but an administrator must confirm the mapping and any source-vocabulary
translation. That confirmation is a governed decision, not an AI guess.

## Generic REST boundary

The deployed `recovery-activation-pull` function accepts only a connector key,
entity type and dry-run flag from an authenticated planning user. It obtains the
endpoint and approved mapping from tenant-scoped database configuration. A
caller cannot submit an arbitrary URL.

The transport is deliberately narrow:

- HTTPS `GET`, standard port, no redirects;
- hostname must be in `RECOVERY_CONNECTOR_ALLOWED_HOSTS`;
- local, private and link-local IP targets are denied;
- response must be JSON, at most 10 MB and 10,000 rows;
- the configured dot path must resolve to an array of objects;
- credentials come only from `RECOVERY_CONNECTOR_CREDENTIALS_JSON` by opaque
  binding URI;
- no source-system write method exists.

Example Edge Function secrets (illustrative names only; never commit values):

```text
RECOVERY_CONNECTOR_ALLOWED_HOSTS=api.customer.example
RECOVERY_CONNECTOR_CREDENTIALS_JSON={"vault://customer/cmms":{"type":"bearer","value":"<secret>"}}
```

Custom header credentials are limited to `x-api-key` or `api-key`. The mapping
and endpoint tables expose the opaque binding URI, never the secret value.

The product provides an operator-triggered pull and records an expected interval
so missed pulls become `stale`, never silently healthy. Automatic unattended
polling is intentionally not activated without a customer operating policy and
a reviewed service credential; an external scheduler may invoke the same
JWT-protected function under an authorized planning identity.

## Data semantics and fail-closed rules

- Sites, assets, work orders, materials, stock and craft capacity update their
  canonical row on replay of the same `(source_system, external_id)`.
- Operating-state and production history are immutable facts. Replays are
  staged as `duplicate` and do not double-count.
- Existing same-name/tag/code records under another identity are rejected. The
  kit never silently merges two industrial identities.
- Missing imported asset criticality/status and work status/priority/type stay
  unknown (`NULL`); the activation path does not manufacture defaults.
- Completed/closed work requires `completed_at`; quantities and hours must have
  valid sign and type; time intervals must be ordered.
- Material catalogue and crew capacity require the customer's evidence basis.
- A REST pull must first pass a dry run in the product before the import control
  is enabled. CSV commit is disabled until every dry-run rejection is fixed.

## Operating and rollback procedure

1. Configure the source disabled. For REST, add the hostname and credential to
   the Edge Function secret registry through the approved production-secret
   procedure.
2. Upload a representative CSV/sample export, confirm column and vocabulary
   mappings, record the basis, and approve.
3. Run dry validation. Resolve every rejection or explicitly correct the source
   identity/mapping; do not edit staging rows.
4. Enable the source and import each domain in order.
5. Review freshness, domain counts, linked counts and retained rejects.
6. Select the real asset, open work and frozen baseline; create the governed
   draft. Resolve canonical constraints before submission and use an independent
   approver before release.

Rollback is additive and recoverable: disable the connector first. Do not delete
staging/run provenance. A bad accepted master-data batch is corrected by fixing
the source/mapping and replaying the same stable IDs. Immutable historical facts
require a separately reviewed data-correction migration; the activation kit does
not rewrite history.

## Deliberate boundaries

- No CMMS/EAM write-back.
- No credential values in PostgreSQL, logs, responses or Git.
- No pagination/vendor-specific OAuth workflow; bind a narrow customer endpoint
  that returns the configured JSON array window.
- No automatic background poll until the tenant authorizes its cadence and
  service credential.
- No plan submission, approval or release from the activation transaction.
- No invented engineering thresholds, durations, material readiness, crew
  availability, production priority or return-to-service claim.
