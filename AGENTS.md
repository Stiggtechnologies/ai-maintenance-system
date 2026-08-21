# SyncAI Agent Engineering Contract

This repository supports parallel development by Codex, Claude Code, and human engineers. Every contributor must preserve the canonical architecture and governed operating boundaries below.

## Mission

Build one industrial engineering operating system. Extend existing contracts before introducing new ones. Prefer references to canonical data over copied definitions.

## Non-negotiable architecture invariants

1. One canonical asset hierarchy per asset class.
2. One canonical failure-mode identity per component and mechanism.
3. One evidence model, one recommendation model, one approval model, and one customer-twin model.
4. OEM-specific data belongs in governed overlays; manufacturer-neutral concepts belong in core templates.
5. Engineering thresholds, limits, intervals, and safety claims require approved evidence.
6. Safety-critical and operational actions remain human-approved unless an explicitly approved policy says otherwise.
7. Tenant isolation and row-level security must be preserved for every persistence change.
8. No agent may create a parallel queue, audit log, workflow engine, or persistence store to avoid extending the existing one.
9. Every recommendation must remain explainable, traceable, and linked to evidence.
10. Draft engineering content must stay marked `draft` until authorized engineering and field review are complete.

## Parallel-work rules

- Work only on an `agent/<workstream>` branch or isolated worktree.
- Own a bounded folder or module. Do not edit another active workstream's files without coordination.
- Shared contracts and migrations are serialized through the architecture-steward workstream.
- Never commit directly to `main`.
- Never merge your own pull request.
- Open a draft pull request early and keep its scope narrow.
- Rebase or update from `main` before final review when shared contracts changed.

### Lane split (added 2026-08-20, after two agents independently built the RIA workspace)

Codex `#231` created the nine `ria_*` core tables; Claude `#235` added the governing-rule
triggers and `ALTER`s on top of them. They composed only by luck — the same week the
register grew 399 → 409 rows with neither agent seeing the other's additions. These lanes
make that outcome the default rather than the accident.

| Lane          | Owns                                                                                      | Typical change                  |
| ------------- | ----------------------------------------------------------------------------------------- | ------------------------------- |
| **Feature**   | `src/pages/`, `src/components/`, new tables, new routes, new capability                   | Builds the noun                 |
| **Invariant** | triggers, RLS, `SECURITY DEFINER`, `src/test/*Tenancy*`, `*Gate*`, `migrationPolicies.ts` | Makes the noun unbypassable     |
| **Honesty**   | deleting fabricated values, unreachable surfaces, over-claiming docs                      | Removes what cannot be defended |

**Rules that matter more than the table:**

1. **A deletion touching another lane's file needs the reason in the PR body, naming the
   fabrication.** The honesty lane exists to delete things; from the other side that is
   indistinguishable from vandalism unless the reason is stated.
2. **`docs/enterprise-readiness/capability-register.md` is append-and-accept, never
   rewrite.** Change an item's status and ship `npm run register:accept` in the _same_
   commit. The ratchet blocks regressions; it cannot see two agents appending different
   rows to the same section.
3. **Shared security guards** (`src/test/support/migrationPolicies.ts`,
   `tenancyIsolation.test.ts`, `definerTenancy.test.ts`) are Invariant-lane files. Loosening
   one requires a compensating assertion in the same PR and an explicit call-out in the PR
   body — a weakened guard is silent until something exploits it.
4. **Before building a surface, grep for it.** Both agents built an assessment workspace in
   the same week. `git log --oneline -20` and `gh pr list --state all --limit 15` cost
   seconds; a duplicated slice costs days.
5. **Migrations are serialized by timestamp, not by agreement.** Timestamp later than the
   deployed head _and_ later than every open PR's migrations — check
   `gh pr list --json number` then `gh pr diff <n> --name-only`.

## Required implementation sequence

1. Inspect existing types, services, migrations, and tests.
2. State which canonical models will be reused.
3. Add or extend tests before claiming completion.
4. Implement the smallest coherent vertical slice.
5. Run relevant tests, type checks, linting, and deployment checks.
6. Document governance boundaries and unsupported assumptions in the pull request.

## Definition of done

A change is not complete until:

- canonical identities are reused;
- tenant and authorization boundaries are preserved;
- invalid and unsafe paths are tested;
- no unsupported engineering values are invented;
- human-approval boundaries are explicit;
- required CI and deployment checks pass;
- the pull request includes architecture, governance, validation, and rollback notes.

## Prohibited behavior

- Fabricating OEM specifications or engineering thresholds.
- Bypassing approvals to make a demo appear autonomous.
- Broad repository rewrites unrelated to the assigned issue.
- Duplicating models because an existing interface is inconvenient.
- Weakening RLS, authentication, auditability, or evidence provenance.
- Mixing unrelated workstreams in one pull request.

## Review model

Every production change requires:

- architecture review for canonical-model and duplication risk;
- security/tenancy review for persistence or authorization changes;
- domain review for engineering or safety claims;
- passing automated checks before merge.

When instructions conflict, this contract and the repository's explicit governance tests take precedence.

## Capability register

The register at `docs/enterprise-readiness/capability-register.md` is the
program of record. It is protected by a ratchet, not by good intentions:

- an item may never be removed;
- an item's status may never regress (✅ → 🟡 → ❌), and a claim that carried
  evidence may never become a bare glyph;
- the headline tally is derived, never hand-typed.

Both are enforced by `npm run register:check` and by the unit tests, because a
merge once reverted C8.07 from "✅ all ten modelled" to a bare "❌" while the
totals still added up — the count was consistent and the register was wrong.

A downgrade is still legitimate when it is honest — five decision rights were
demoted from `enforced` to `policy` once an audit showed nothing consulted
them. Make it deliberate: run `npm run register:accept` in the same commit and
say why in the message, so the downgrade appears in the diff a reviewer reads
rather than inside a merge nobody does.
