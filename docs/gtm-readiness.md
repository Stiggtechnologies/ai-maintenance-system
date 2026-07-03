# SyncAI — Enterprise Go-To-Market Readiness Assessment

_Assessed 2026-07-03 against the promises published on [syncai.ca](https://syncai.ca)._

## The promises on the website

1. **"The Industrial AI Infrastructure Layer"** — autonomous AI agents embedded in
   asset-intensive operations, operating / prioritizing / optimizing in real time.
2. **12-agent AI Workforce** (Reliability Intelligence, Predictive Failure, Work Order
   Optimization, Asset Health Scoring, Inventory, RCA, Maintenance Strategy, CI,
   Capital Planning, Risk & Compliance, Executive Reporting, Lifecycle).
3. **Continuous risk analysis → autonomous prioritization → human oversight →
   controlled operations.**
4. **Impact:** 10–20 % unplanned-downtime reduction, 5–12 % labor efficiency,
   3–8 % spare-parts optimization, real-time audit readiness.
5. **"Built as infrastructure"** — integrates with existing CMMS / ERP / sensors /
   inventory / financials. API-native. No rip-and-replace.
6. **"Security-first. Enterprise-governed. Human-in-the-loop."**
7. **Structured 90-day pilots**, scaled as ongoing infrastructure.
8. Industries: oil & gas, mining, heavy manufacturing, utilities, equipment rental,
   multi-site operators.

## Where the product genuinely is (verified, not aspirational)

| Promise                         | Status                       | Evidence                                                                                                                                                                                                                                                      |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Human-in-the-loop governed loop | **✅ Working E2E**           | Mission Control → recommendation → evidence → scenario comparison → approve → work order (safety-critical lands approval-gated, never auto-executed) → decision log → value metric → learning event. Verified through the real UI writing to Supabase, twice. |
| AI workforce surface            | **✅ Data-driven**           | 15 agents with status / autonomy mode / task / confidence / supervisor from `ai_agents`; approval queue shows live pending autonomous decisions.                                                                                                              |
| Every route works               | **✅ 32/32 routes**          | Full sweep: zero crashes, zero infinite spinners, zero blank pages. Route-level error boundaries keep the shell alive if any view fails. 15 s fetch timeout guarantees no hung page.                                                                          |
| Enterprise data model           | **✅ Complete locally**      | 3 consolidated migrations: 24 operating-loop tables + 8 onboarding tables + ~45 legacy-surface tables, org-scoped RLS, seeded oil-sands demo (Fort McMurray, C-22/P-101 scenario). `supabase db reset` reproduces everything.                                 |
| Asset onboarding engine         | **✅ Working**               | `/onboard used pump P-101 oil-sands deep` → industry-templated session → FMEA, strategy, criticality, FRACAS, exports → propagates to all 8 operating-loop surfaces.                                                                                          |
| Quality gates                   | **✅ Green**                 | Build passes, 100/100 tests, touched files lint-clean, demo runbook (`docs/operating-loop-demo.md`).                                                                                                                                                          |
| LLM plumbing                    | **🟡 Exists, not exercised** | `ai-agent-processor` edge function does real chat-completions with cost tracking; copilot calls it with deterministic fallback. Needs an LLM key + deployed functions to go live.                                                                             |

## The honest gap list (what "enterprise-ready GTM" still requires)

### P0 — trust blockers (before any paying pilot)

1. **Production hosting is not enterprise-grade.** app.syncai.ca runs on a
   Bolt-managed auto-pausing Supabase project that has caused outages. Migrate to a
   dedicated Supabase org project (or self-hosted), point DNS, add uptime monitoring.
2. **No CI/CD or environments.** All of this work lives on one branch; there is no
   pipeline running lint/build/test, no staging, no migration promotion process.
   Add GitHub Actions (checks + preview deploy + `supabase db push` gating).
3. **Auth hardening.** Enforce SSO (Azure AD wiring exists), MFA claims on the login
   page must be true, password policy, session policies.
4. **The ~415 pre-existing lint errors in `supabase/functions/`** and unpinned edge
   functions need one hardening pass before anyone audits the repo.

### P1 — promise gaps (to sell "autonomous infrastructure" honestly)

5. **Agents don't yet run continuously.** Recommendations/decisions are seeded or
   user-triggered. Ship the loop: scheduled edge function (cron) that scores assets
   from `sensors`/`asset_health_monitoring`, writes `recommendations` +
   `autonomous_decisions`, routed through the LLM gateway. The schema and UI are
   already wired for it — this is the highest-leverage build item.
6. **Integrations are catalog + demo rows, not live connectors.** The single biggest
   website promise. Priority order for pilots: CSV/API import (exists partially) →
   OSIsoft PI / historian read → SAP PM / Maximo work-order sync (read first).
7. **Value claims need instrumentation.** The 10–20 % downtime claims must be
   measured per-pilot: baseline capture at onboarding (already modeled as
   `baseline_pending_validation`) + verified-savings workflow (exists) + a pilot
   scorecard export.

### P2 — enterprise checklist (needed for procurement, not for pilots)

8. SOC 2 Type I roadmap, pen test, DPA/security whitepaper behind syncai.ca/security.
9. Multi-tenant onboarding flow (org provisioning is currently seed/manual).
10. Observability: Sentry + structured audit export (audit tables exist).
11. RLS tightening on legacy-surface tables (currently authenticated-scoped).

## Bottom line

The **buyer-value loop the website sells is real and demonstrable end-to-end today**,
with genuine human-in-the-loop governance — that is the hard part and it works. What
separates this from "enterprise-ready" is not more features: it is **(a) real hosting +
CI/CD, (b) one continuously-running agent loop, (c) one real connector, and (d) the
security paperwork**. Those four close the gap between a best-in-class demo and a
product an asset-intensive enterprise will pay for.
