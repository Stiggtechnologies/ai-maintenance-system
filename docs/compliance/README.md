# SyncAI Compliance Readiness Pack

_Prepared 2026-07-15. Scope: SOC 2 (Trust Services Criteria) and ISO/IEC 27001:2022
readiness for the SyncAI platform (`Stiggtechnologies/ai-maintenance-system`),
hosted on Supabase (project `pjvoswbwomesuwhygpby`, Canada Central) and Vercel,
serving app.syncai.ca._

## What this pack is — and is not

This is a **readiness assessment**, not a certification. SOC 2 and ISO 27001
certify an **organization's operation of controls over a period of time**,
verified by an independent auditor (SOC 2) or accredited certification body
(ISO 27001). No document can make you "compliant" — but this pack does the
work a compliance-automation platform (Vanta, Drata, Secureframe) would
otherwise charge to bootstrap: it maps every criterion/control to the concrete
evidence that **already exists** in this system versus what must still be built,
and gives you starter policies and a prioritized roadmap.

## Honest headline

- **Technical/product controls: ~60–70% present.** The engineering foundation
  (RLS access control, audit trails, change management, reproducible infra) is
  real and above-average for a product at this stage.
- **Organizational program: ~10% present.** Written policies, an evidence
  observation period, enforced MFA, access reviews, training, a risk register,
  vendor due diligence, and a penetration test have not been started.

You would **not pass an audit today.** With focused effort the technical gaps
close in weeks; the organizational program and the SOC 2 observation window are
the real timeline (see the roadmap).

## Contents

| File                                                     | Purpose                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [soc2-control-matrix.md](soc2-control-matrix.md)         | Each SOC 2 Trust Services Criterion → status, evidence in this system, gap            |
| [iso27001-annexA-matrix.md](iso27001-annexA-matrix.md)   | ISO 27001:2022 Annex A controls → status, evidence, gap                               |
| [gap-remediation-roadmap.md](gap-remediation-roadmap.md) | Prioritized plan with phases, owners, and effort                                      |
| [policies/](policies/)                                   | Starter policy templates (access control, incident response, change management, etc.) |

## The single most important action, today

**Rotate every credential that has been shared in plaintext** (API keys, admin
and owner passwords). One exposed live credential is an automatic audit finding
and a real security risk independent of any certification. This is an
organizational action only you can take — see
[gap-remediation-roadmap.md](gap-remediation-roadmap.md) Phase 0.

## Recommended path to certification

1. Adopt this pack's policies (edit the `[BRACKETED]` fields).
2. Close the Phase 0–1 technical gaps (mostly days of work; some already done).
3. Engage a compliance-automation platform (Vanta/Drata/Secureframe) — feed it
   this control matrix; it connects to Supabase/Vercel/GitHub and collects
   evidence continuously.
4. Run a penetration test and a formal risk assessment.
5. **SOC 2 Type I** (point-in-time) once controls are in place — ~1–2 months.
6. **SOC 2 Type II** after a 3–6 month observation window; **ISO 27001** on a
   parallel track (Stage 1 documentation review → Stage 2 audit).
