# ISO/IEC 27001:2022 Annex A Control Matrix — SyncAI

_The 2022 revision organizes 93 controls into 4 themes. This maps each theme's
controls to evidence in this system._ **✅ In place** · **🟡 Partial** ·
**❌ Not started**. _ISO 27001 also requires clauses 4–10 (the ISMS management
system itself: scope, leadership, planning, risk treatment, internal audit,
management review) — those are organizational and summarized at the end._

## A.5 — Organizational controls (37)

| Control                                           | Status | Evidence / Gap                                                                                |
| ------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- | --------------- |
| 5.1 Policies for information security             | ❌     | Adopt the `policies/` set                                                                     |
| 5.2 Information security roles & responsibilities | 🟡     | System roles defined; assign an org security owner                                            |
| 5.3 Segregation of duties                         | ✅     | Role separation; admin gate; HITL approval separate from AI recommendation                    |
| 5.7 Threat intelligence                           | ❌     | Subscribe to dependency/CVE feeds                                                             |
| 5.8 Security in project management                | 🟡     | CI gates on every change; formalize in SDLC policy                                            |
| 5.9 Inventory of information & assets             | 🟡     | The product **is** an asset register; add an IT-asset inventory (repos, cloud projects, SaaS) |
| 5.10 Acceptable use of assets                     | ❌     | Acceptable-use policy (template)                                                              |
| 5.12 Classification of information                | 🟡     | `data_sensitivity` onboarding field; formalize scheme                                         |
| 5.15 Access control                               | ✅     | Org-scoped RLS; role-based; least privilege via security-definer RPCs                         |
| 5.16 Identity management                          | 🟡     | GoTrue identities; add lifecycle (joiner/mover/leaver) procedure                              |
| 5.17 Authentication information                   | 🟡     | Bcrypt password hashing; HIBP leaked-password check enabled                                   | **Enforce MFA** |
| 5.18 Access rights (provision/review/revoke)      | 🟡     | Provisioning exists; add periodic access review + revocation records                          |
| 5.19–5.22 Supplier relationships                  | ❌     | Vendor register + DPAs (Supabase, Vercel, OpenAI, Google)                                     |
| 5.23 Cloud services security                      | 🟡     | Certified cloud subprocessors; document shared-responsibility model                           |
| 5.24–5.28 Incident management                     | ❌     | Incident-response plan (template) + evidence handling                                         |
| 5.29 Continuity                                   | 🟡     | Backups + reproducible infra; write + test BCP/DR                                             |
| 5.30 ICT readiness for continuity                 | 🟡     | Migration chain rebuilds; test and document RTO/RPO                                           |
| 5.31 Legal/regulatory requirements                | 🟡     | Product maps ABSA/ISO 55000; add org-level legal register (privacy law, data residency)       |
| 5.34 Privacy & PII protection                     | 🟡     | Tenant isolation; minimal PII (email, name); write a privacy policy                           |
| 5.35–5.36 Review of information security          | ❌     | Internal audit + compliance review cadence                                                    |
| 5.37 Documented operating procedures              | 🟡     | Runbooks exist (`docs/*.md`); consolidate into an ops manual                                  |

## A.6 — People controls (8)

| Control                                | Status | Evidence / Gap                                                 |
| -------------------------------------- | ------ | -------------------------------------------------------------- |
| 6.1 Screening                          | ❌     | Background-check procedure for staff with access               |
| 6.2 Terms & conditions of employment   | ❌     | Security clauses in employment/contractor agreements           |
| 6.3 Security awareness & training      | ❌     | Annual training program                                        |
| 6.4 Disciplinary process               | ❌     | Document                                                       |
| 6.5 Responsibilities after termination | ❌     | Offboarding checklist (revoke access, recover assets)          |
| 6.6 Confidentiality/NDA                | ❌     | NDAs on file                                                   |
| 6.7 Remote working                     | ❌     | Remote-work security policy                                    |
| 6.8 Event reporting                    | 🟡     | In-app learning events; add a security-event reporting channel |

_People controls are the clearest "startup hasn't started" cluster — all
organizational, none blocked by engineering._

## A.7 — Physical controls (14)

| Control                                    | Status         | Evidence / Gap                                                                                                                                                                                           |
| ------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1–7.14 Physical & environmental security | ✅ (inherited) | No owned data centers — inherited from Supabase (AWS) and Vercel, both ISO 27001 / SOC 2 certified. Collect their certificates for the ISMS. For any office/endpoints: add a clean-desk/endpoint policy. |

## A.8 — Technological controls (34) — your strongest theme

| Control                                     | Status | Evidence / Gap                                                                           |
| ------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 8.1 User endpoint devices                   | ❌     | Endpoint/MDM policy                                                                      |
| 8.2 Privileged access rights                | ✅     | Service-role isolation; admin/`ai_admin` gate; platform functions revoke `authenticated` |
| 8.3 Information access restriction          | ✅     | RLS + audience-filtered RPCs enforce restriction in the database                         |
| 8.4 Access to source code                   | 🟡     | GitHub repo (public); branch protection; add access-review + consider private            |
| 8.5 Secure authentication                   | 🟡     | GoTrue + bcrypt + HIBP; **add enforced MFA**                                             |
| 8.6 Capacity management                     | 🟡     | Managed autoscaling; add platform capacity monitoring                                    |
| 8.7 Protection against malware              | 🟡     | No arbitrary code execution; add dependency scanning                                     |
| 8.8 Management of technical vulnerabilities | 🟡     | Security Advisor; CI; **add Dependabot/Snyk + patch SLA**                                |
| 8.9 Configuration management                | ✅     | Migration chain + IaC-style deterministic config; MOC triggers                           |
| 8.10 Information deletion                   | 🟡     | Retention windows; formalize deletion procedure                                          |
| 8.11 Data masking                           | 🟡     | Role-based field withholding (KPI audiences); document                                   |
| 8.12 Data leakage prevention                | 🟡     | RLS prevents cross-tenant leakage; no secrets in code; add egress considerations         |
| 8.13 Information backup                     | ✅     | Automated Supabase backups + reproducible migrations                                     | **test restore**                                   |
| 8.15 Logging                                | ✅     | Decision log, agent runs, learning events, KPI lineage, SIR logging, Supabase logs       | Define retention + tamper-resistance               |
| 8.16 Monitoring activities                  | 🟡     | Product monitors assets in real time; **add infra/security monitoring + alerting**       |
| 8.17 Clock synchronization                  | ✅     | All timestamps server-side UTC (Postgres `now()`)                                        |
| 8.18 Privileged utility programs            | ✅     | Service-role RPCs are the only privileged path; revoked from app users                   |
| 8.19 Software on operational systems        | ✅     | Deploy only via CI from `main`; no manual production changes                             |
| 8.20–8.22 Network security & segregation    | ✅     | HTTPS; gateway; org data segregation via RLS                                             | Document network diagram                           |
| 8.23 Web filtering                          | n/a    | —                                                                                        |
| 8.24 Cryptography                           | ✅     | TLS in transit; managed encryption at rest (Supabase); bcrypt for passwords              | Cryptography policy                                |
| 8.25 Secure development lifecycle           | ✅     | CI gates, code review, test-first, typed strict, lint-clean zone                         | Document the SDLC                                  |
| 8.26 Application security requirements      | ✅     | RLS, input validation via typed RPCs, WCAG-audited UI                                    | —                                                  |
| 8.27 Secure system architecture             | ✅     | Three-plane separation; HITL governance; fail-soft                                       | —                                                  |
| 8.28 Secure coding                          | ✅     | Strict TypeScript, zero-error lint zone, security-definer discipline                     | Secure-coding standard doc                         |
| 8.29 Security testing in dev                | 🟡     | E2E + unit + migration smoke on every merge                                              | Add SAST/DAST + the pen test                       |
| 8.30 Outsourced development                 | n/a    | —                                                                                        |
| 8.31 Separation of dev/test/prod            | 🟡     | Local + cloud; CI pins E2E to local                                                      | Formalize a staging environment distinct from prod |
| 8.32 Change management                      | ✅     | Branch protection + required checks + reviewed PRs (see SOC 2 CC8.1)                     |
| 8.33 Test information                       | ✅     | Seeded synthetic demo data; no real customer PII in tests                                |
| 8.34 Protection during audit testing        | 🟡     | Read-only audit approach feasible; document                                              |

## ISMS management clauses (4–10) — the certification backbone

| Clause                                                 | Status | Gap                                                            |
| ------------------------------------------------------ | ------ | -------------------------------------------------------------- |
| 4 Context of the organization                          | ❌     | Define ISMS scope + interested parties                         |
| 5 Leadership                                           | ❌     | Management commitment + assigned CISO/owner                    |
| 6 Planning (risk assessment & treatment)               | ❌     | Risk assessment methodology + Statement of Applicability (SoA) |
| 7 Support (resources, competence, awareness)           | ❌     | Training + documented-information control                      |
| 8 Operation                                            | 🟡     | Operational controls exist; tie to risk treatment plan         |
| 9 Performance evaluation (internal audit, mgmt review) | ❌     | Internal audit program + management reviews                    |
| 10 Improvement (nonconformity, corrective action)      | 🟡     | FRACAS-style discipline exists in product; apply to the ISMS   |

## Bottom line for ISO 27001

**A.8 Technological controls — the largest theme — is ~75% in place**, which is
genuinely strong. A.7 Physical is inherited from certified clouds. A.5 is
half-covered. **A.6 People and clauses 4–10 (the ISMS itself) are the real
work** — all organizational, none blocked by the codebase. Expect a Stage 1
documentation review to pass once policies + SoA + risk assessment exist, and a
Stage 2 audit after the ISMS has run for a quarter.
