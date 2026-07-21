# SOC 2 Control Matrix — SyncAI

_Mapping of the SOC 2 Trust Services Criteria (2017, with 2022 points of focus)
to concrete evidence in this system. Legend:_ **✅ In place** · **🟡 Partial** ·
**❌ Not started**. _Scope assumes the Security (Common Criteria) category plus
Availability and Confidentiality; Processing Integrity and Privacy are optional
and noted where relevant._

## CC1 — Control Environment

| #     | Criterion                       | Status | Evidence in system                                                                           | Gap to close                                               |
| ----- | ------------------------------- | ------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| CC1.1 | Integrity & ethical values      | ❌     | —                                                                                            | Code of conduct; acceptable-use policy (template provided) |
| CC1.2 | Board / governance oversight    | ❌     | —                                                                                            | Assign a security owner; document oversight cadence        |
| CC1.3 | Org structure & reporting lines | 🟡     | Role model (`user_profiles.role`, `roles`, `user_role_assignments`) defines system authority | Document the human org chart + security responsibilities   |
| CC1.4 | Commitment to competence        | ❌     | —                                                                                            | Security-awareness training program; onboarding checklist  |
| CC1.5 | Accountability                  | 🟡     | RACI on every KPI + recommendation; decision log names the human actor                       | HR-level accountability policy                             |

## CC2 — Communication & Information

| #     | Criterion                                  | Status | Evidence                                                                                                                         | Gap                                                        |
| ----- | ------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| CC2.1 | Quality information for control            | ✅     | Audit tables: `decisions`, `learning_events`, `agent_runs`, `asset_onboarding_runs`, `kpi_values` (with `computed_from` lineage) | Retention policy formalizing these as records              |
| CC2.2 | Internal communication of responsibilities | 🟡     | In-app RACI, role landings, approval routing                                                                                     | Written security policies communicated to staff            |
| CC2.3 | External communication                     | ❌     | —                                                                                                                                | Security page / trust center; support + disclosure channel |

## CC3 — Risk Assessment

| #     | Criterion                    | Status | Evidence                                                                                        | Gap                                                       |
| ----- | ---------------------------- | ------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| CC3.1 | Objectives with clarity      | 🟡     | GTM readiness doc; product objectives documented                                                | Formal security objectives                                |
| CC3.2 | Identify & analyze risk      | ❌     | (Product does asset risk; org security risk not assessed)                                       | Security risk register + annual risk assessment           |
| CC3.3 | Fraud risk                   | ❌     | —                                                                                               | Consider in risk assessment                               |
| CC3.4 | Change that affects controls | ✅     | Migration chain + CI required checks gate every change; MOC triggers re-review on config change | Document the change-management policy (template provided) |

## CC4 — Monitoring Activities

| #     | Criterion                           | Status | Evidence                                                               | Gap                                                     |
| ----- | ----------------------------------- | ------ | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| CC4.1 | Ongoing/separate evaluations        | 🟡     | Supabase Security Advisor (35→2 by-design warnings); CI on every merge | Scheduled control self-assessments; evidence collection |
| CC4.2 | Evaluate & communicate deficiencies | 🟡     | PR review, CI failure surfacing                                        | Formal deficiency-tracking + remediation SLA            |

## CC5 — Control Activities

| #     | Criterion                      | Status | Evidence                                                       | Gap                                          |
| ----- | ------------------------------ | ------ | -------------------------------------------------------------- | -------------------------------------------- |
| CC5.1 | Controls to mitigate risk      | ✅     | RLS, security-definer RPCs, admin gate, service-role isolation | Map controls to risks (once register exists) |
| CC5.2 | Technology general controls    | ✅     | CI/CD, branch protection, migration chain, E2E gate            | —                                            |
| CC5.3 | Policies & procedures deployed | ❌     | —                                                              | Adopt the policy set in `policies/`          |

## CC6 — Logical & Physical Access (the heart of SOC 2)

| #     | Criterion                           | Status         | Evidence                                                                                                                                                                                                                                                              | Gap                                                       |
| ----- | ----------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| CC6.1 | Logical access security             | ✅             | **Org-scoped RLS on every table** via `app_current_org()`; role-based access enforced in the DB (audience-filtered KPIs; `get_kpi_dashboard` withholds board-tier rows server-side); admin gate on internal routes; security-definer functions revoke `public`/`anon` | Document the access-control policy (template provided)    |
| CC6.2 | Registration/authorization of users | 🟡             | Provisioning via GoTrue admin API; `user_profiles` + role assignment                                                                                                                                                                                                  | Formal access-request/approval workflow + records         |
| CC6.3 | Role-based access / least privilege | ✅             | Six roles, per-role nav + KPI audiences; service-role-only platform functions                                                                                                                                                                                         | Periodic access recertification (quarterly) — not yet run |
| CC6.4 | Physical access                     | ✅ (inherited) | Supabase (AWS) + Vercel data centers — SOC 2 / ISO 27001 certified subprocessors                                                                                                                                                                                      | Collect subprocessor attestations (SOC 2 reports)         |
| CC6.5 | Data disposal                       | 🟡             | Bounded retention (`agent_runs` 7d, `kpi_values` 90d, run prune)                                                                                                                                                                                                      | Data-retention & disposal policy                          |
| CC6.6 | Boundary protection                 | ✅             | HTTPS only; Supabase edge + Kong gateway; RLS at the data boundary                                                                                                                                                                                                    | Document network diagram                                  |
| CC6.7 | Data-in-transit / restrict movement | ✅             | TLS everywhere; no PII in URL params; secrets in Supabase secret store not code                                                                                                                                                                                       | Encryption policy doc                                     |
| CC6.8 | Malicious software prevention       | 🟡             | No user file execution; dependency install pinned in CI                                                                                                                                                                                                               | Dependency-scanning (Dependabot/Snyk); document           |

**MFA:** **TOTP multi-factor authentication is now implemented** (enroll in
Settings → Security; enrolled users are challenged at sign-in via GoTrue AAL2).
Enrollment is opt-in per account; **organization-wide enforcement** (making it
mandatory) remains the follow-on policy step. Azure AD SSO is wired but not yet
enforced for staff.

## CC7 — System Operations

| #     | Criterion                               | Status | Evidence                                                 | Gap                                                     |
| ----- | --------------------------------------- | ------ | -------------------------------------------------------- | ------------------------------------------------------- |
| CC7.1 | Detect config changes / vulnerabilities | 🟡     | CI, Security Advisor, migration review                   | Vulnerability scanning + cadence; log-based detection   |
| CC7.2 | Monitor for anomalies                   | ❌     | (App monitors assets; infra security not monitored)      | SIEM / log alerting (Supabase logs → alert)             |
| CC7.3 | Evaluate security events                | ❌     | —                                                        | Incident-response procedure (template provided)         |
| CC7.4 | Incident response                       | ❌     | —                                                        | IR plan + on-call + post-incident review                |
| CC7.5 | Recovery from incidents                 | 🟡     | Supabase automated backups; reproducible migration chain | Documented + **tested** BCP/DR; recovery-time objective |

## CC8 — Change Management

| #     | Criterion                             | Status | Evidence                                                                                                                                                                                                                | Gap                                                                 |
| ----- | ------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| CC8.1 | Authorize/design/test/approve changes | ✅     | **Branch protection + 4 required CI checks** (lint+typecheck, unit, migration chain + auth smoke, golden-path E2E); PR review; auto-deploy only from `main`; 10-test E2E gate; every change is a described, reviewed PR | Formalize as a written change-management policy (template provided) |

## CC9 — Risk Mitigation

| #     | Criterion                            | Status | Evidence                                                       | Gap                                                          |
| ----- | ------------------------------------ | ------ | -------------------------------------------------------------- | ------------------------------------------------------------ |
| CC9.1 | Risk-mitigation activities           | 🟡     | Fail-soft design; HITL on all actions; no autonomous execution | Business-continuity + insurance considerations               |
| CC9.2 | Vendor & business-partner management | ❌     | (Subprocessors: Supabase, Vercel, OpenAI, Google)              | Vendor risk-management policy + subprocessor register + DPAs |

## Availability (A1)

| #    | Criterion                          | Status                   | Evidence                                                                                     | Gap                                                  |
| ---- | ---------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| A1.1 | Capacity management                | 🟡                       | Managed Supabase/Vercel scaling; the app's own `get_pilot_scorecard`/uptime is product-level | Capacity/SLA monitoring for the platform itself      |
| A1.2 | Environmental protections / backup | ✅ (inherited + backups) | Managed data-center resilience; automated DB backups                                         | Document backup schedule + **restore test evidence** |
| A1.3 | Recovery testing                   | ❌                       | —                                                                                            | Perform and record a restore/DR test                 |

## Confidentiality (C1)

| #    | Criterion                            | Status | Evidence                                                                          | Gap                        |
| ---- | ------------------------------------ | ------ | --------------------------------------------------------------------------------- | -------------------------- |
| C1.1 | Identify & protect confidential info | ✅     | RLS tenant isolation; audience-filtered KPIs; onboarding `data_sensitivity` field | Data-classification policy |
| C1.2 | Dispose of confidential info         | 🟡     | Retention windows exist                                                           | Formal disposal procedure  |

## Summary scoring (indicative, not an audit)

| Category                | In place | Partial | Not started |
| ----------------------- | -------- | ------- | ----------- |
| CC1 Control Environment | 0        | 2       | 3           |
| CC2 Communication       | 1        | 1       | 1           |
| CC3 Risk Assessment     | 1        | 1       | 2           |
| CC4 Monitoring          | 0        | 2       | 0           |
| CC5 Control Activities  | 2        | 0       | 1           |
| CC6 Access              | 6        | 3       | 0           |
| CC7 Operations          | 0        | 2       | 3           |
| CC8 Change Mgmt         | 1        | 0       | 0           |
| CC9 Risk Mitigation     | 0        | 1       | 1           |
| Availability            | 1        | 1       | 1           |
| Confidentiality         | 1        | 1       | 0           |

**Access control (CC6) and change management (CC8) — the two areas auditors
scrutinize hardest — are your strongest.** The weak areas (CC1, CC7) are
organizational program items, not engineering.
