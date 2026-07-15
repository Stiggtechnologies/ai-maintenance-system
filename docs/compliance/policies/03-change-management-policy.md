# Change Management Policy

**Owner:** `[SECURITY OWNER]` · **Approved:** `[NAME, DATE]` · **Review:** annual

## 1. Purpose

Ensure all changes to SyncAI production are authorized, tested, reviewed, and
traceable.

## 2. Requirements

- All changes are made via **pull request** to a protected branch — no direct
  commits to `main`, no manual production edits.
- Every PR must pass the **required CI checks** before merge: lint + typecheck,
  unit tests, migration-chain + seeded-auth smoke, and the golden-path E2E
  suite. Merge is blocked otherwise.
- Every PR requires review/approval by `[REVIEWER ROLE]` (currently the repo
  owner; expand to a second reviewer as the team grows).
- Merges to `main` **auto-deploy** frontend (Vercel) and database/functions
  (deploy workflow). No out-of-band deployment.
- Database schema changes are made only through the **migration chain**
  (`supabase/migrations/`), giving deterministic, reproducible, reviewable
  history.
- Configuration changes to monitored assets trigger an automatic
  management-of-change review in the product (MOC learning event).

## 3. Emergency changes

Emergency fixes still go through a PR and CI; if a check must be bypassed, the
`[SECURITY OWNER]` records the justification and a follow-up remediation task.

## 4. Segregation

The author and the deploying automation are separate; approval is required
before merge. Expand to author ≠ approver as headcount allows.

## 5. Evidence (for auditors)

- `.github/workflows/ci.yml` (4 required checks) + branch protection settings.
- `.github/workflows/deploy-migrations.yml` (deploy only from `main`).
- PR history: 30+ described, reviewed, test-gated changes.
- 10-test Playwright E2E suite; 111+ unit tests.
