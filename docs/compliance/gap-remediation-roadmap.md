# Compliance Gap Remediation Roadmap — SyncAI

_A prioritized plan to move from "strong technical foundation, no program" to
"audit-ready." Effort is indicative for a small team. **Owner** is the role that
should hold it, not a named person yet._

## Phase 0 — Do this week (security hygiene, not optional)

| #   | Action                                                                                                                                        | Owner          | Effort | Why                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------ | -------------------------------------------------------------------------------- |
| 0.1 | **Rotate every credential shared in plaintext** — Anthropic + OpenAI API keys, `admin@syncai.ca`, the owner account, any others in chat/email | Security owner | 1 hr   | One exposed live credential is an automatic audit finding and a real breach risk |
| 0.2 | Replace the personal `SUPABASE_ACCESS_TOKEN` CI secret with a scoped deploy token                                                             | Security owner | 30 min | Least privilege for automation                                                   |
| 0.3 | Move all secrets to the Supabase/Vercel secret stores; confirm none are in the repo or chat history                                           | Eng            | 1 hr   | Secrets management (CC6.7 / A.8.24)                                              |
| 0.4 | Enable a password manager for the team; stop sharing credentials in chat/email                                                                | All            | 30 min | Prevents recurrence                                                              |

## Phase 1 — Technical controls (days-to-weeks; closes most CC6/A.8 gaps)

| #   | Action                                                                                                  | Owner          | Effort   |
| --- | ------------------------------------------------------------------------------------------------------- | -------------- | -------- |
| 1.1 | **Enforce MFA** on all accounts; enforce SSO for staff (Azure AD wiring exists)                         | Eng            | 1–2 days |
| 1.2 | Enable Dependabot + a SAST scan (CodeQL) in CI; set a patch SLA                                         | Eng            | 1 day    |
| 1.3 | Stand up a **staging** environment distinct from production                                             | Eng            | 1–2 days |
| 1.4 | Configure log retention + alerting (Supabase logs → alert on auth failures, RLS denials, admin actions) | Eng            | 2 days   |
| 1.5 | Perform and **record a database restore test**; document RTO/RPO                                        | Eng            | 0.5 day  |
| 1.6 | Collect subprocessor attestations (Supabase, Vercel, OpenAI SOC 2 / ISO certs) into the ISMS            | Security owner | 0.5 day  |
| 1.7 | Formalize data retention + disposal (retention windows already coded)                                   | Eng + legal    | 0.5 day  |
| 1.8 | Add a public trust/security page + a security disclosure channel (security@)                            | Security owner | 0.5 day  |

## Phase 2 — Organizational program (weeks; the policies + processes)

| #   | Action                                                                                                         | Owner                  | Effort      |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------- |
| 2.1 | Adopt the `policies/` set — edit `[BRACKETED]` fields, get sign-off, communicate to staff                      | Security owner         | 2–3 days    |
| 2.2 | Build a **security risk register**; run a formal risk assessment; write the ISO **Statement of Applicability** | Security owner         | 3–5 days    |
| 2.3 | Establish access-request/approval + **quarterly access recertification** with records                          | Security owner         | 1 day setup |
| 2.4 | Vendor risk management: subprocessor register + DPAs signed                                                    | Security owner + legal | 2–3 days    |
| 2.5 | Security-awareness training (annual) + onboarding/offboarding checklists                                       | People ops             | 1–2 days    |
| 2.6 | Incident-response plan + on-call + a tabletop exercise                                                         | Security owner + eng   | 2 days      |
| 2.7 | HR controls: NDAs, background-check procedure, employment security clauses                                     | People ops + legal     | varies      |

## Phase 3 — Certification (months; the auditor + observation window)

| #   | Action                                                                                                                              | Owner          | Effort                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------- |
| 3.1 | Adopt a compliance-automation platform (Vanta / Drata / Secureframe); connect Supabase, Vercel, GitHub; feed it this control matrix | Security owner | 1 week to onboard     |
| 3.2 | Independent **penetration test**; remediate findings                                                                                | Eng + vendor   | 2–4 weeks incl. fixes |
| 3.3 | **SOC 2 Type I** (point-in-time) with a licensed CPA firm                                                                           | Security owner | 1–2 months            |
| 3.4 | **SOC 2 Type II** after a 3–6 month observation window                                                                              | Security owner | 3–6 months elapsed    |
| 3.5 | **ISO 27001** Stage 1 (docs) → Stage 2 (audit) with an accredited body; parallel track                                              | Security owner | 3–6 months elapsed    |

## Realistic timeline

- **Weeks 1–2:** Phase 0 + start Phase 1 → the platform is materially more secure.
- **Month 1–2:** Phase 1 complete, Phase 2 underway, compliance platform live,
  pen test booked → you can honestly tell a prospect "SOC 2 Type I in progress."
- **Month 2–4:** SOC 2 Type I report; ISO Stage 1 passed.
- **Month 5–9:** SOC 2 Type II report; ISO 27001 certificate.

## What NOT to claim before it's true

Do not state "SOC 2 compliant" or "ISO 27001 certified" until the report/
certificate is issued. Acceptable interim language: _"SOC 2 Type II in progress;
controls implemented; report expected [Qx]"_ and _"pursuing ISO 27001
certification."_ Misrepresenting compliance status is itself a serious risk in
enterprise procurement.

## The one-line summary

The engineering is ~two weeks of focused work from technically ready. The
certification is a **program + time** problem — policies, a risk register, an
observation window, and an independent auditor — not a code problem.
