# D6.07 material commercial thread — closure record

D6.07 is customer-reachable and is promoted to green only with the validation
migration in this change. The implementation reuses the canonical requirement,
procurement, supplier, material, BOM, component, asset, work-order and audit
stores. It does not create a second commercial graph, approval model, or
provenance ledger.

## Customer-reachable chain

The forward read `get_specification_failure_thread` traverses:

`design_requirements` → `contract_package_specifications` →
`contract_packages` / `contract_bids` → `suppliers` /
`material_suppliers` → `bom_lines` / `components` → `assets` →
corrective `work_orders`.

Each missing hop is a named refusal. A broken relationship is never presented as
zero failures. The reverse direction calls the existing
`get_design_feedback_loop`; migration
`20261225170000_material_commercial_feedback.sql` removes its former
top-fifteen cutoff instead of adding another traversal.
`20261225170400_material_commercial_component_thread.sql` adds canonical
component relationships to the forward path. Work orders remain asset-level
history because the canonical work-order store has no component attribution;
the result says so rather than inferring one.

The `/materials` route mounts the four customer controls:

- `MaterialCatalogue` creates a human-sourced catalogue record.
- `MaterialSupplierLink` records which supplier supplies the material.
- `MaterialBomLink` links the material to an asset, asset class, and optional
  canonical component.
- `MaterialRelationshipHistory` shows retained source basis and actor
  provenance.

Those controls call `createCatalogueMaterial`, `linkCatalogueSupplier`, and
`linkCatalogueBom`, which reach `create_catalogue_material`,
`link_catalogue_supplier`, and `link_catalogue_bom`. Successful writes
persist in `materials`, `material_suppliers`, `bom_lines`, and the canonical
`audit_events` ledger, then refresh the customer-visible readback.

## Governance boundaries

Every write RPC derives its tenant from `app_current_org()`; no organization ID
is accepted from the browser. The RPCs require an authenticated human role,
validate every referenced parent in that tenant, serialize duplicate
relationships, and retain the actor and stated source basis. Direct customer
writes to the underlying tables remain denied, and RLS hides relationship and
audit rows from other tenants.

A supplier relationship does not approve or qualify the supplier. A BOM
relationship establishes traceability only; it does not assert inventory,
physical installation, inspection acceptance, or authority to execute work.
SyncAI does not claim that an asset-level corrective order occurred on a
particular component.

## Database integrity and historical validation

Migration `20261225170500_material_relationship_tenant_keys.sql` introduced
five composite tenant/parent foreign keys as `NOT VALID`. That rollout shape
protected all new writes immediately while allowing production history to be
audited without an implicit repair:

- `material_suppliers_material_tenant_fk`
- `material_suppliers_supplier_tenant_fk`
- `bom_lines_material_tenant_fk`
- `bom_lines_asset_tenant_fk`
- `bom_lines_component_parent_fk`

The deployment workflow runs `scripts/audit-material-production.mjs` before
and after every production migration push. It submits
`scripts/audit-material-relationship-history.sql` as a read-only,
repeatable-read, aggregate-only query with full-RLS visibility. It checks
supplier/material/asset tenant references, finite positive BOM quantities, and
component-parent scope. Permission failure or an error-shaped response blocks
deployment; the workflow never bypasses the audit or modifies data to make it
pass.

Migration
`20270101100000_validate_material_relationship_tenant_constraints.sql`
explicitly validates all five constraints. It contains no insert, update,
delete, truncate, drop, or repair statement. The same read-only production audit
must pass immediately before and after this metadata transition.

## Verification evidence

PR [#527](https://github.com/Stiggtechnologies/ai-maintenance-system/pull/527)
merged as `45f7e6926f1e0b5b4aad0cae0ac50cc4348ec3f5` on 2026-09-29. Its final
head `d21346c04b795ed64766976e0d598af26daf0776` passed:

- unit tests, lint, TypeScript and production build;
- the full migration chain and seeded-authentication smoke;
- Golden-path E2E;
- the commercial-to-verification smoke;
- domain and recovery runtime acceptance;
- licensing, dependency, secret and CodeQL policy gates; and
- all three Vercel previews.

The authenticated material smoke
(`scripts/ci-material-commercial-thread-smoke.sh`) proves catalogue, supplier
and component-BOM writes; anonymous, technician and foreign-tenant refusals;
RLS isolation; direct-write denial; a two-request duplicate race; provenance
readback; component traversal; and validation of all five constraints against
the full seeded migration chain.

The browser flow
(`tests/e2e/material-commercial-thread.spec.ts`) proves catalogue → supplier →
BOM → retained source/actor history through the customer surface.

Production deployment run
[36512339166](https://github.com/Stiggtechnologies/ai-maintenance-system/actions/runs/36512339166)
passed both the read-only preflight and post-migration audit while applying
migrations `20261225170000` through `20261225170500` to project
`pjvoswbwomesuwhygpby`. A direct read-only production inspection before this
closure change confirmed all six versions and all five RPC/read functions are
present, and confirmed the five constraints still carry the expected
`convalidated = false` state. That is why this final validation migration is a
real production-hardening step rather than a documentation-only status flip.

## Release and rollback

The change is ready to merge only after its final-head CI passes. After merge,
the production deployment must show:

1. read-only material-history preflight passed;
2. migration `20270101100000` applied;
3. read-only post-migration audit passed; and
4. all five constraints report `convalidated = true`.

If validation fails, deployment stops before any claim of production closure.
No automatic repair is permitted. Investigate the named relationship, preserve
customer history, and ship a reviewed forward corrective migration. Customer
controls can be disabled independently without deleting catalogue, supplier,
BOM, component, audit, or failure-history records.
