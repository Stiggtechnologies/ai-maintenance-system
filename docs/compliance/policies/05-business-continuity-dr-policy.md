# Business Continuity & Disaster Recovery Policy

**Owner:** `[SECURITY OWNER]` · **Approved:** `[NAME, DATE]` · **Review:** annual

**2026-10-06 — CONTROLLED POLICY TEMPLATE, NOT AN APPROVED RECOVERY COMMITMENT.**
Production backup configuration, objectives and successful recovery are not
established by this document or by the local database drill. See the
[E5.13 acceptance and drill runbook](../../enterprise-readiness/database-restore-drill.md).

## 1. Objectives

- **RTO (recovery time objective):** `[e.g. 4 hours]`
- **RPO (recovery point objective):** `[e.g. 24 hours]`

## 2. Backups

- Verify and record the production project's **actual managed backup/PITR
  configuration and restore points** (`[frequency/retention per verified plan]`).
  Do not infer protection from the provider's advertised plan capabilities.
- Database backups do not cover private Storage file bytes; separate recovery
  of files, configuration, credentials and deployment dependencies is required.
- The full schema is reproducible from the versioned **migration chain**; the
  demo/seed data is deterministic.
- Application code is in version control (GitHub) with full history.

## 3. Recovery procedures

- **Database:** restore from Supabase backup, or rebuild schema from the
  migration chain and restore data from the latest backup.
- **Application:** redeploy from `main` via CI (Vercel + deploy workflow).
- **Secrets:** re-provision from `[secret store / password manager]`.

## 4. Testing

Perform and **record a restore test at least annually** (a real gap today —
Phase 1.5). Document elapsed time vs RTO/RPO.

## 5. Continuity

Key-person risk: document runbooks (`docs/*.md`) so recovery does not depend on
one individual. Cloud subprocessors (Supabase/Vercel) carry their own
resilience attestations — collect them.

## 6. Evidence (for auditors)

- Backup configuration screenshot/export; restore-test record; this policy;
  RTO/RPO statement; migration chain as reproducible-infra evidence.
