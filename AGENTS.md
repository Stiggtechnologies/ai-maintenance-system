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