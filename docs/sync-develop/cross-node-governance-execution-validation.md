# Cross-node governance execution — D11.14 closure

Validated 2026-09-30.

## Closure claim

A descendant organization can execute an adopted framework owned by its
ancestor without duplicating the framework. Definition rows remain owned by
the authoring node; the development case and every execution artifact remain
owned by the descendant.

## Controls

- `framework_operable_for_org` accepts only an adopted framework in the
  descendant's own ancestry.
- Framework, stage, gate and framework-bound criterion policies add SELECT
  visibility only. There is no descendant write policy.
- Case creation uses the same predicate for implicit inheritance and explicit
  framework selection, so a sibling or foreign framework is refused.
- Every gate and requirement act is linked back through the case's exact
  `framework_id`; removing the former definition-owner equality does not
  loosen the case tenant boundary.
- Case evidence, deliverables, waivers, sessions, reviews, findings,
  conditions and audit records continue to use the case organization.
- Human decision authority, independence checks, deterministic blockers and
  persistence triggers are unchanged.
- The Edge evidence agent reads ancestor definitions only after authenticating
  the child-owned case and confirming criterion → gate → case framework.

## Evidence

- Migration: `supabase/migrations/20270101110000_cross_node_governance_execution.sql`
- Required live transcript: `scripts/ci-cross-node-governance-smoke.sh`
- Migration/Edge contract: `src/test/crossNodeGovernanceExecutionMigration.test.ts`
- Historical inheritance contract updated: `src/test/developSlice3GovernanceMigration.test.ts`
- Required CI wiring: `.github/workflows/ci.yml`
- Customer selector/read caller: `src/services/developService.ts`
- Edge caller boundary: `supabase/functions/develop-evidence-agent/index.ts`

## Verification record

The migration was applied to the live production schema inside a database
transaction. All exact transformation anchors resolved, the resulting
definitions were inspected, and the transaction rolled back.

A second production-schema transaction created a temporary child node, moved
two fixture identities into it, inherited the root's adopted framework,
created a child-owned case, bound a deliverable to an ancestor-owned
criterion, assembled gate review packs, recorded first-stage decisions as a
distinct human reviewer, advanced the case and asserted that review rows were
child-owned while gate rows remained root-owned. It also asserted that no
framework copy existed. The transaction rolled back every temporary row and
profile change.

The GitHub migration job repeats this on a clean database through the
authenticated API, including direct RLS visibility and a foreign-root denial,
before the pull request can merge.
