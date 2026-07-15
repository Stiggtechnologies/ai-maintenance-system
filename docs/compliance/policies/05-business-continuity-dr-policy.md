# Business Continuity & Disaster Recovery Policy

**Owner:** `[SECURITY OWNER]` · **Approved:** `[NAME, DATE]` · **Review:** annual

## 1. Objectives

- **RTO (recovery time objective):** `[e.g. 4 hours]`
- **RPO (recovery point objective):** `[e.g. 24 hours]`

## 2. Backups

- The Supabase project uses **automated managed backups** (`[frequency/retention
per plan]`).
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
