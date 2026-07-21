# Vanta-Ready Evidence Index — SyncAI

_Prepared 2026-07-21. A control-by-control map from each SOC 2 / ISO 27001
requirement to the **exact artifact in this system that proves it** — the file,
database object, CI workflow, or dashboard setting — and how that evidence is
collected._

## How to use this

This index is designed to be handed to whoever runs the certification (an
internal security owner + a compliance-automation platform like **Vanta**,
Drata, or Secureframe). It answers the three questions those platforms and their
auditors always ask about every control:

1. **Do you have the control?** → the "Evidence artifact" column.
2. **Where is the proof?** → the "Location" column (a real path/object).
3. **How is it collected?** → the "Collection" column:
   - **AUTO** — Vanta/Drata detects it automatically once you connect the
     relevant integration (GitHub, Supabase/AWS, Vercel, your IdP). No manual
     upload.
   - **EVIDENCE** — a document, screenshot, or export you attach once (and
     refresh periodically).
   - **PROCESS** — an organizational activity that produces recurring evidence
     (access reviews, training records, tickets). Not a code artifact.

> Scope note: rows marked **PROCESS** are the organizational program — they are
> not blocked by engineering and are owned by the security owner, not this
> repository. Everything marked AUTO or EVIDENCE either exists in the codebase
> today or is a one-time attach.

## Step 1 — Integrations to connect in Vanta (unlocks the AUTO rows)

| Integration                                                         | What Vanta auto-collects                                                                                                         | Owner action                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **GitHub** (`Stiggtechnologies/ai-maintenance-system`)              | Branch protection, required checks, PR reviews, CodeQL alerts, Dependabot alerts, secret-scanning, SECURITY.md, contributor list | Authorize the GitHub app; grant read on the repo/org            |
| **Supabase** (project `pjvoswbwomesuwhygpby`) or underlying **AWS** | Encryption at rest, automated backups, database access, RLS presence, region (Canada Central)                                    | Connect via Vanta's Supabase/AWS integration or attach evidence |
| **Vercel**                                                          | Hosting, TLS, deployment logs, access                                                                                            | Authorize the Vercel integration                                |
| **Identity provider** (Azure AD / GoTrue)                           | MFA status per user, user list, SSO config                                                                                       | Connect the IdP integration                                     |
| **Task tracker** (GitHub Issues / Linear)                           | Change tickets, incident tickets, remediation SLAs                                                                               | Connect                                                         |
| **HR system**                                                       | Onboarding/offboarding, background checks, training                                                                              | Connect                                                         |

## Step 2 — Control-to-evidence map

### Access control (SOC 2 CC6 · ISO A.5.15–5.18, A.8.2–8.5) — strongest area

| Control                             | Evidence artifact                                                                            | Location                                                                                                 | Collection                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Tenant data isolation               | Org-scoped RLS `for all` policies via `app_current_org()` on every table                     | `supabase/migrations/00000000000001_operating_loop_baseline.sql` (policy loop); `_005_rls_hardening.sql` | EVIDENCE (SQL) + AUTO (Supabase RLS on)          |
| Role-based least privilege          | 7 roles; per-role KPI **audience filtering server-side**                                     | `get_kpi_dashboard()` in `_017_kpi_service.sql`; `src/lib/roleNavigation.ts`                             | EVIDENCE (SQL + code)                            |
| Privileged-function isolation       | `revoke execute … from public, anon, authenticated` on platform RPCs; `service_role`-only    | grep `revoke execute` across `supabase/migrations/*`                                                     | EVIDENCE (SQL)                                   |
| Admin-surface gating                | `AdminGate` route wrapper on `/deployments`, `/research`, `/runs`, `/setup`, `/security-log` | `src/App.tsx` (`AdminGate`)                                                                              | EVIDENCE (code)                                  |
| **MFA (TOTP)**                      | Enrollment + AAL2 login challenge via GoTrue                                                 | `src/components/MfaManager.tsx`, `src/pages/Login.tsx` (`mfaChallengeRequired`)                          | EVIDENCE (code) + AUTO (IdP MFA status per user) |
| Authentication / password hardening | Bcrypt hashing; **HIBP leaked-password protection enabled**                                  | Supabase Auth settings (enabled via management API)                                                      | AUTO (IdP) / EVIDENCE (screenshot)               |
| Access provisioning/review          | GoTrue admin-API provisioning; `user_profiles.role` + assignments                            | `_016_persona_accounts.sql`; provisioning records                                                        | PROCESS (quarterly access review)                |

### Change management (SOC 2 CC8 · ISO A.8.25, A.8.32) — strongest area

| Control                            | Evidence artifact                                                                                                | Location                                                      | Collection               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------ |
| Authorized/tested/reviewed changes | Branch protection + **4 required CI checks** (lint+typecheck, unit, migration-chain+auth-smoke, golden-path E2E) | `.github/workflows/ci.yml`; GitHub branch-protection settings | AUTO (GitHub)            |
| Deploy only from `main`            | Deploy workflow triggers on `main` only                                                                          | `.github/workflows/deploy-migrations.yml`                     | AUTO (GitHub) + EVIDENCE |
| Reproducible schema changes        | Versioned migration chain                                                                                        | `supabase/migrations/` (18 sequential migrations)             | EVIDENCE (repo)          |
| Test evidence per change           | 10-test Playwright E2E + 111 unit tests gating merge                                                             | `tests/e2e/golden-path.spec.ts`; CI run history               | AUTO (GitHub Actions)    |
| Change policy                      | Written policy                                                                                                   | `docs/compliance/policies/03-change-management-policy.md`     | EVIDENCE (adopt + sign)  |

### Vulnerability & secure development (SOC 2 CC7.1 · ISO A.8.8, A.8.28–8.29)

| Control                             | Evidence artifact                                             | Location                                              | Collection                  |
| ----------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- | --------------------------- |
| Dependency vulnerability management | Dependabot (weekly npm + actions)                             | `.github/dependabot.yml`                              | AUTO (GitHub)               |
| Static application security testing | CodeQL (security-and-quality, weekly + PR)                    | `.github/workflows/codeql.yml`                        | AUTO (GitHub code scanning) |
| Secret scanning                     | gitleaks on every push/PR                                     | `.github/workflows/secret-scan.yml`, `.gitleaks.toml` | AUTO (GitHub)               |
| Secure SDLC                         | Strict TypeScript, zero-error lint zone, typed RPC boundaries | `tsconfig`, `eslint` config, CI                       | EVIDENCE (config)           |

### Security monitoring & incident response (SOC 2 CC7.2–7.5 · ISO A.8.15–8.16, A.5.24–5.28)

| Control                 | Evidence artifact                                                                       | Location                                                                              | Collection                       |
| ----------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------- |
| Security audit log      | Append-only `security_events` (admin-read RLS; role-change **trigger**; RPC-only write) | `_018_security_events.sql`; viewer `src/pages/SecurityAuditLog.tsx` (`/security-log`) | EVIDENCE (SQL + live export CSV) |
| Operational audit trail | Decisions, learning events, agent runs, KPI computation **lineage**                     | tables `decisions`, `learning_events`, `agent_runs`, `kpi_values.computed_from`       | EVIDENCE (SQL)                   |
| Automated alerting      | _Gap_ — alert on the audit log                                                          | (Phase 1 follow-on: Supabase logs → alert)                                            | PROCESS (to build)               |
| Incident response plan  | Written policy + IR runbook                                                             | `docs/compliance/policies/04-incident-response-policy.md`                             | EVIDENCE + PROCESS (tabletop)    |

### Communication & external (SOC 2 CC2.3 · ISO A.5.28)

| Control                | Evidence artifact                          | Location                                                              | Collection                                    |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------------- |
| Coordinated disclosure | Security policy + machine-readable contact | `SECURITY.md`; `public/.well-known/security.txt` (security@syncai.ca) | AUTO (GitHub surfaces SECURITY.md) + EVIDENCE |

### Availability & continuity (SOC 2 A1 · ISO A.5.29–5.30, A.8.13)

| Control               | Evidence artifact                                 | Location                      | Collection                              |
| --------------------- | ------------------------------------------------- | ----------------------------- | --------------------------------------- |
| Backups               | Managed automated Supabase (Postgres) backups     | Supabase dashboard            | AUTO (Supabase/AWS) + EVIDENCE (config) |
| Reproducible recovery | Migration chain rebuilds schema deterministically | `supabase/migrations/`        | EVIDENCE                                |
| Recovery testing      | _Gap_ — recorded restore test                     | (Phase 1.5)                   | PROCESS (run + record RTO/RPO)          |
| Retention bounds      | `agent_runs` 7d, `kpi_values` 90d prunes          | `_007_*`, `_017_*`; DP policy | EVIDENCE (SQL)                          |

### Confidentiality & cryptography (SOC 2 C1 · ISO A.8.24)

| Control               | Evidence artifact                             | Location                                              | Collection             |
| --------------------- | --------------------------------------------- | ----------------------------------------------------- | ---------------------- |
| Encryption in transit | TLS/HTTPS everywhere; no secrets/PII in URLs  | Vercel + Supabase edge                                | AUTO (Vercel/Supabase) |
| Encryption at rest    | Managed (Supabase/AWS)                        | Supabase dashboard                                    | AUTO                   |
| Data classification   | `data_sensitivity` field per asset onboarding | `_011_autonomous_onboarding.sql` (catalog); DP policy | EVIDENCE               |

### Vendor / subprocessor (SOC 2 CC9.2 · ISO A.5.19–5.23)

| Control                      | Evidence artifact                                                     | Location                                                  | Collection                           |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------ |
| Subprocessor register + DPAs | Register with attestations (Supabase, Vercel, OpenAI, Google, GitHub) | `docs/compliance/policies/06-vendor-management-policy.md` | EVIDENCE (collect certs + sign DPAs) |

### Governance, risk, people (SOC 2 CC1, CC3 · ISO A.6, clauses 4–10)

| Control                                         | Evidence artifact    | Location                    | Collection                            |
| ----------------------------------------------- | -------------------- | --------------------------- | ------------------------------------- |
| Policy set                                      | 8 adoptable policies | `docs/compliance/policies/` | EVIDENCE (adopt + sign + communicate) |
| Risk assessment + SoA                           | _Gap_                | (Phase 2)                   | PROCESS                               |
| Security training / awareness                   | _Gap_                | —                           | PROCESS (annual, tracked in HR)       |
| Background checks, NDAs, onboarding/offboarding | _Gap_                | HR system                   | PROCESS                               |
| Internal audit + management review              | _Gap_                | —                           | PROCESS                               |

## Step 3 — What's left after connecting Vanta

Once GitHub/Supabase/Vercel/IdP are connected, the **AUTO** rows populate on
their own and a large share of the technical control tests pass immediately. The
remaining work is:

- **EVIDENCE (one-time attach):** the SQL/code artifacts above, backup config
  screenshot, HIBP setting, subprocessor SOC 2 reports.
- **PROCESS (organizational, recurring):** adopt + sign the policies, run a risk
  assessment + Statement of Applicability, enforce MFA org-wide, set up access
  reviews, security training, HR controls, incident tabletop, a recorded restore
  test, and automated alerting on the audit log — then the SOC 2 **observation
  window** and an independent auditor.

## Coverage snapshot

| Collection type                             | Rows | Status                       |
| ------------------------------------------- | ---- | ---------------------------- |
| AUTO (Vanta detects on connect)             | ~12  | Ready — connect integrations |
| EVIDENCE (one-time attach; artifact exists) | ~18  | Ready — artifacts in repo    |
| PROCESS (organizational; to build)          | ~11  | The remaining program work   |

The engineering evidence is in place and pointed-to. What converts this into a
certificate is connecting the integrations, attaching the one-time evidence, and
running the organizational program through an observation window with an auditor.
