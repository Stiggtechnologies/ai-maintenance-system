# D6.07 material commercial thread — work in progress

This slice remains partial. The capability registers are deliberately unchanged.

## Canonical models and implemented paths

- `materials`: human-entered catalogue creation with source basis; duplicate codes refuse.
- `material_suppliers`: sourced supplier relationship; creation cannot approve a supplier or overwrite qualification.
- `bom_lines`: asset/class link and optional reference to the existing `components` identity; no separate installed-material store.
- `audit_events`: named actor, source basis and persisted state for each successful write.
- `get_design_feedback_loop`: existing canonical reverse traversal without the top-fifteen cutoff.
- `/materials`: catalogue, supplier and BOM controls with explicit distinctions between traceability, stock, qualification, installation and authorization.

## Evidence collected

The initial focused suite passed 32 assertions; six quantity-boundary assertions and two reverse-history presentation assertions subsequently passed. The latter confirm that reverse evidence remains visible when the forward chain refuses, without interpreting a requirement reference as verified failure prevention.

The broader tenancy/register/reachability/commercial set passed 1,278 assertions. A full local run completed with 6,696 passes and three failures caused by sandbox-denied `tsx` IPC; the affected reliability-harness file then passed all 64 tests with IPC permission. This is not described as a single all-green full-suite run. Repository lint passed with zero errors and five existing warnings. The production build passed with a bundle-size warning. CI unit and lint/type checks passed on `9451714`; migration/browser checks were still running when recorded. Final-head checks remain required.

`scripts/test-material-catalogue-isolated.sql` executed successfully in a disposable PostgreSQL database. It covers successful catalogue/supplier/component/class writes, duplicate refusals, cross-tenant references, component-parent guard, NaN refusal, audit count, AI-role refusal and reverse lookup beyond fifteen modes.

That SQL harness uses minimal dependency fixtures and a test identity provider. It does **not** prove the full migration chain, actual Supabase authentication, RLS policies or production behavior.

CI run `36503571131` on `9451714` completed the authenticated material-commercial smoke successfully after applying the full migration chain. That revision tested catalogue/supplier/component-BOM writes, technician/foreign-tenant refusal, duplicate refusals, anonymous denial, direct-write denial, audit visibility/isolation and validation of all five composite tenant constraints against seeded history. The later concurrency assertion and component-traversal assertion were not included in that successful step and require the final-head run. The isolated PostgreSQL harness separately executed the complete component traversal and verified reverse evidence on a broken forward chain.

Subsequent run `36504744680` on `5109aef` passed the complete migration/auth smoke,
including the two-request BOM race and canonical component traversal, plus unit
tests and lint/type checks. Its browser job passed eleven existing tests but
failed the new test's login landing assertion: the captured authenticated planner
screen was Operational Briefing, matching `getRoleHome('planner')`, not Mission
Control. Commit `9adae41` corrects that assertion without skipping the material
workflow; run `36506294349` is the rerun. Its result must be inspected before any
browser acceptance claim. Later audit additions also require final-head CI.

Run `36506294349` finished with unit/build and full migration/auth checks passing.
Its eleven existing browser tests passed. The new browser flow logged in and
created a material, then timed out on the exact-label Supplier selector. A local
Chromium reproduction using the same nested label/select shape found zero exact
label matches but one correctly named combobox; the captured page likewise shows
the enabled Supplier combobox with populated options. The test now uses named
combobox locators for selects. This is not yet a passing end-to-end flow; supplier,
BOM and provenance assertions still require the next run.

On `e05bb88`, run `36507767320` passed the browser job, including the complete
catalogue → supplier → BOM → persisted-source workflow. The success screenshot
was attached in memory but was not present in the uploaded `test-results` files;
the test now writes it to `testInfo.outputPath` before attaching it. Visual review
of the completed workflow therefore still awaits a retained success artifact.

Run `36507767320` subsequently completed successfully: all 12 browser tests,
unit/build checks, and the complete migration/auth smoke passed. Its material
step explicitly logged a passing historical relationship audit on the full
seeded snapshot. Production history is still unverified. The screenshot-only
follow-up requires final-head checks and visual inspection before release.

## Implementation review boundaries

The implementation review checked canonical `materials`, `material_suppliers`,
`bom_lines`, `components`, and `audit_events` reuse; same-organization actor/role
checks in each write RPC; parent locks plus composite tenant foreign keys;
duplicate refusal without qualification changes; and component traversal joined
on its asset and organization. Supplier creation remains unapproved; BOM links
do not establish actual installation. Reverse requirement references are not
presented as verified failure prevention. The history surface exposes stored
source basis and actor identity, explicitly without independent verification.

This is an implementation self-review, not an independent reviewer approval or
proof of production acceptance. Rendered workflow evidence and production
historical audit remain release gates. `NOT VALID` constraints protect new writes
but cannot be cited as proof that pre-existing production relationships are clean.

The final traversal review found inherited package/bid/supplier reads that relied
on upstream reference guards without filtering the referenced tenant themselves.
The isolated harness now deliberately creates inconsistent historical references:
the original traversal failed by exposing a foreign package/bid, while explicit
organization filters on both package joins, both bid reads and supplier reads
make the regression pass, including a foreign supplier-name check. Ten focused
migration-contract tests also passed. This does not establish that production
contains inconsistent links; it hardens the definer read if such history exists.

## Required before ready for review / green status

### Historical rollout audit

`scripts/audit-material-relationship-history.sql` is a repeatable-read, read-only,
aggregate-only preflight and post-migration check. Run with `psql -f` against the
explicit intended database using a role with full RLS visibility; a tenant-scoped
role is refused rather than allowed to produce a false clean result. It checks
supplier/material/asset tenant references, finite positive BOM quantities, and
component parent references when the component column exists. It neither repairs
records nor validates constraints as a side effect. A pre-migration pass without
the component column requires a post-migration rerun.

Local verification: passed against `material_thread_trace_v2`; refused a separate
disposable cloned fixture with two zero-quantity BOM rows; refused the
`authenticated` role without global visibility. These are local fixture results,
**not a production audit**. Production execution and recorded results remain due.

`scripts/audit-material-production.mjs` submits the same SQL through the Supabase
Management API with `read_only: true`, retaining the SQL read-only transaction
and full-RLS-visibility check. The deployment workflow runs it before and after
the migration push, using its existing secret without printing response details.
Four local wrapper tests cover the read-only request, invalid configuration,
HTTP refusal, and error-shaped responses. Remote execution is still unverified;
an API or permission refusal must block rollout, not be bypassed. API contract:
https://supabase.com/docs/reference/api/v1-run-a-query.

- Verify the component associations and asset-level history boundaries added to the canonical traversal at runtime. Work orders do not have canonical component attribution; the UI must not infer it.
- Test writes and reads using actual authenticated tenant roles against the complete migration chain.
- Test anonymous/viewer/foreign-tenant access, all finite quantity boundaries and concurrent duplicate attempts.
- Verify the new composite tenant/parent constraints against full seeded history and audit production history before rollout. Focused PostgreSQL tests reject supplier tenant and component parent mutation.
- Render-check keyset-paginated selectors and the automatic refresh after catalogue creation; short-page pagination is covered by a service test.
- Verify the paginated canonical audit-history panel under actual tenant RLS; the authenticated smoke now checks source and actor visibility and foreign-tenant exclusion.
- Run the full test, lint, build, security and migration gates; inspect the rendered customer flow.
- Complete architecture, security/tenancy and domain review, then verify deployment and production behavior.

## Rollback

If a defect appears, disable/remove the new customer controls without deleting catalogue, supplier, BOM or audit records. Any database rollback must be a forward corrective migration; preserve component references and recorded provenance. No automatic procurement, installation or work authorization is introduced.
