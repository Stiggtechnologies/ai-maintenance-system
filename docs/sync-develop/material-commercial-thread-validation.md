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

28 focused Vitest assertions passed during implementation. TypeScript and changed-file lint checks passed before the final test additions; rerun all checks before release.

`scripts/test-material-catalogue-isolated.sql` executed successfully in a disposable PostgreSQL database. It covers successful catalogue/supplier/component/class writes, duplicate refusals, cross-tenant references, component-parent guard, NaN refusal, audit count, AI-role refusal and reverse lookup beyond fifteen modes.

That SQL harness uses minimal dependency fixtures and a test identity provider. It does **not** prove the full migration chain, actual Supabase authentication, RLS policies or production behavior.

## Required before ready for review / green status

- Finish canonical component-history traversal and expose its evidence boundaries in the commercial panel.
- Replace the original traversal's stale top-fifteen explanatory text.
- Test writes and reads using actual authenticated tenant roles against the complete migration chain.
- Test anonymous/viewer/foreign-tenant access, all finite quantity boundaries and concurrent duplicate attempts.
- Review direct-writer guards and parent-reference mutation behavior.
- Check selector pagination and ensure catalogues larger than the API row limit remain reachable.
- Verify source provenance is inspectable after saving and refresh dependent selectors after catalogue creation.
- Run the full test, lint, build, security and migration gates; inspect the rendered customer flow.
- Complete architecture, security/tenancy and domain review, then verify deployment and production behavior.

## Rollback

If a defect appears, disable/remove the new customer controls without deleting catalogue, supplier, BOM or audit records. Any database rollback must be a forward corrective migration; preserve component references and recorded provenance. No automatic procurement, installation or work authorization is introduced.
