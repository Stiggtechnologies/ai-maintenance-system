# SyncAI — Enterprise Go-To-Market Readiness Assessment

_Originally assessed 2026-07-03 against the promises on [syncai.ca](https://syncai.ca);
last updated 2026-07-15 after the July hardening campaign (PRs #2–#34)._

## The promises on the website

1. **"The Industrial AI Infrastructure Layer"** — autonomous AI agents embedded in
   asset-intensive operations, operating / prioritizing / optimizing in real time.
2. **AI Workforce** across reliability, maintenance, planning, inventory, risk.
3. **Continuous risk analysis → autonomous prioritization → human oversight →
   controlled operations.**
4. **Impact:** 10–20 % unplanned-downtime reduction, measured value, real-time audit
   readiness.
5. **"Built as infrastructure"** — integrates with existing CMMS / ERP / sensors.
6. **"Security-first. Enterprise-governed. Human-in-the-loop."**
7. **Structured 90-day pilots**, scaled as ongoing infrastructure.
8. All asset-intensive industries.

## Where the product is now (verified live, not aspirational)

| Promise                       | Status          | Evidence                                                                                                                                                                                                                                                                                       |
| ----------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operating in real time        | **✅ Live**     | Telemetry moves every minute (simulator auto-yields to a real historian per org); operating tables stream to the UI over RLS-enforced realtime (verified: 27 events/2 min to an authenticated client).                                                                                         |
| Agents work ahead of problems | **✅ Live**     | Six proactive functions on the 5-min loop: condition, schedule, material, capacity, HSE, production — all raising HITL PENDING recommendations on cloud autonomously.                                                                                                                          |
| Human-in-the-loop governance  | **✅ E2E**      | Approve → work order → decision log → value verification → learning loop; Challenge-AI + closeout feedback train the models; 7-test Playwright gate on every merge.                                                                                                                            |
| Autonomous asset onboarding   | **✅ Live**     | 23-section RAM checklist self-fills (record/derived/library/AI ladder); 45 asset-class FMEA patterns; new assets self-onboard via trigger; Section-21 + governance gate with 5-role approval trail.                                                                                            |
| Audit readiness               | **✅ Built-in** | Data-quality gate (8 checks), AI model governance auto-documented, MOC triggers, mandatory FRACAS closeout, decision/audit exports, security advisor at by-design-only warnings.                                                                                                               |
| Measured value                | **✅ Live**     | 90-day pilot scorecard + verified-savings workflow + Decision Velocity cycle-time metrics, all derived from operating data.                                                                                                                                                                    |
| CI/CD + environments          | **✅ Green**    | 4 required checks on main (lint+typecheck, unit, migration chain + auth smoke, golden-path E2E); auto-deploy of migrations + edge functions on merge.                                                                                                                                          |
| Every route works             | **✅ 32/32**    | All routes render live org-scoped data or honest labeled states; zero fabricated numbers or fake timestamps; WCAG AA contrast + reduced-motion.                                                                                                                                                |
| LLM intelligence              | **✅ Live**     | Ten chartered agent types, all RAG-cited (DoD RAM Guide / MIL-HDBK-338B); deliverable mode produces complete work products (20+ row scored FMEA registers with jurisdiction notes + CSV export) at parity with the reference GPT; AI onboarding deduction with confidence-gated HITL demotion. |
| ISO 55000 KPI truth           | **✅ Live**     | 29-KPI catalog with workbook-faithful RACI; ~19 computed hourly from live data with lineage; breaches raise RACI-routed actions; access-controlled in the database per role.                                                                                                                   |
| Boardroom-down access         | **✅ Live**     | Six role credentials; per-role command-center landing + role-shaped navigation; role-aware copilot dock on every page, grounded in role-scoped live data.                                                                                                                                      |
| One-click deployment          | **✅ Live**     | provision_deployment(): site + industry starter pack that self-onboards, with telemetry and agent monitoring live within minutes.                                                                                                                                                              |

## Remaining gaps (all credential- or third-party-gated)

1. **One real connector** — OSIsoft PI / historian read, SAP PM / Maximo work-order
   sync. Needs a customer system or sandbox credentials. The telemetry simulator
   auto-disables per org the moment a historian integration connects, so the
   connector is a drop-in.
2. **Production hosting alignment** — app.syncai.ca still fronts the legacy Bolt
   project; the hardened project (pjvoswbwomesuwhygpby) is ready. DNS/domain switch
   is a business decision. Gateway hosting should land on Azure/GCP per the
   marketplace GTM.
3. **SSO enforcement** — Azure AD wiring exists; enforcing it needs the tenant.
4. **Procurement paperwork** — SOC 2 roadmap, pen test, DPA/security whitepaper.
5. **Operational hygiene** — rotate the API keys exposed during setup; replace the
   personal `SUPABASE_ACCESS_TOKEN` repo secret with a scoped token; upgrade the
   local Supabase CLI (2.75 → current) so realtime streams in local dev.

## Bottom line

The platform now **does what the website says, live, on cloud**: agents operate
continuously and proactively, views stream in real time, assets onboard themselves
with audit-grade governance, and value is measured — with humans approving every
action. What separates this from a paying enterprise deployment is no longer
engineering: it is **one real connector, the domain/hosting switch, SSO, and the
security paperwork** — all requiring credentials or third parties, none requiring
new product capability.
