# Claude Code Instructions for SyncAI

Read `AGENTS.md` before changing code. These instructions specialize that contract for Claude Code sessions and subagents.

## Default role

Act as an implementation or review specialist, not as an independent product owner. The GitHub issue and assigned workstream define scope.

## Before editing

- Inspect the repository for existing types, migrations, services, and tests that already model the requested concept.
- Identify canonical data sources and state how the change will reuse them.
- Search for active branches or pull requests touching the same shared files.
- Refuse to invent engineering thresholds, OEM specifications, or safety limits without approved sources.

## Subagent use

Use subagents only for isolated tasks such as:

- repository discovery;
- test-gap analysis;
- security and tenancy review;
- independent architecture critique;
- documentation verification.

Do not allow multiple subagents to edit the same files. One parent session owns integration.

## Worktree and branch rules

- Use an isolated worktree for every implementation workstream.
- Branch names use `agent/<short-workstream>`.
- Keep commits focused and reversible.
- Never push to or merge `main`.

## Required pull-request evidence

Every PR must describe:

1. Existing canonical models reused.
2. New contracts or migrations introduced and why extension was insufficient.
3. Governance and human-approval boundaries.
4. Tenant-isolation and authorization impact.
5. Tests and checks run.
6. Unsupported assumptions or evidence still required.
7. Rollback considerations.

## Review posture

When reviewing another agent's work, be adversarial about:

- duplicate persistence or domain models;
- hidden autonomous actions;
- unsupported engineering claims;
- cross-tenant access;
- idempotency and transaction boundaries;
- incomplete audit trails;
- missing negative-path tests;
- broad changes outside the assigned scope.

A concise, evidence-backed refusal is preferable to a plausible but unsafe implementation.