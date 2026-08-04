# Demo Runbook — AHS Pilot Fleet (Real 15-Month Dataset)

_A click-by-click script anyone on the team can run cold. ~12 minutes full,
~5 minutes short form. Last verified 2026-08-04 against app.syncai.ca._

## What makes this demo different

Everything on screen derives from a **real autonomous-haulage mine operation**:
15 consecutive months of operator event logs (Aug 2019 – Oct 2020, ~2.2 million
dispatch events, 26 units — 23 autonomous haul trucks + 3 hydraulic shovels),
ingested through the platform's own onboarding engine and rebuilt as **6,000
failure-coded work orders** (4,329 corrective · 27,438 downtime hours). Every
number a prospect questions can be traced to a row in the source spreadsheets.

**The one-line pitch:** "This isn't seeded demo data — it's fifteen months of a
real operation, rebuilt by the platform's own onboarding engine in an afternoon."

## Pre-flight (2 minutes, do before every showing)

1. Open **app.syncai.ca** in a fresh private window (avoids stale sessions).
2. Sign in once yourself and check three things, then sign out:
   - Mission Control loads with the **LIVE** badge on.
   - Readiness ring shows a real posture (not 100).
   - Assets page lists the AHS Pilot Fleet units.
3. Have this runbook's **numbers table** (bottom) on a second screen.
4. If the copilot will be shown, warm it: ask it anything one-line first
   (cold starts add a few seconds).

Demo credentials (demo-tier by design — rotate nothing for these):

| Role                 | Login                | Password      | Lands on               |
| -------------------- | -------------------- | ------------- | ---------------------- |
| Reliability engineer | demo@syncai.ca       | Demo123!@#    | Mission Control        |
| Executive            | executive@syncai.ca  | Exec123!@#    | Executive Intelligence |
| Technician           | technician@syncai.ca | Tech123!@#    | Work Action Board      |
| Planner              | planner@syncai.ca    | Planner123!@# | Planning Briefing      |

## The script — seven acts

### Act 1 — The front door (30s)

Open app.syncai.ca signed out.

- Let the page breathe for two seconds: the operations lattice, the question
  ("Can we safely and reliably deliver the production plan?"), the proof strip.
- **Say:** "Everything in this product answers that one question, continuously."
- Sign in as **demo@syncai.ca**.

### Act 2 — Mission Control: the posture (90s)

You land on Mission Control.

- Point to the **readiness ring** (At-Risk posture) and the LIVE badge.
- **Say:** "This ring is computed from the real health of a real fleet — we
  loaded fifteen months of an autonomous-haulage operation's dispatch logs."
- Point to the readiness factors and the recommendation counters.
- Do NOT click anything yet — posture first, detail second.

### Act 3 — The fleet and its bad actor (2 min)

Navigate: **Assets** → scroll to the AHS Pilot Fleet units.

- Point out the health spread: **1 critical, 7 warning, 18 operational** —
  "a realistic fleet, because it _is_ one."
- Open **T301**.
- **Say:** "271 corrective failures, 2,476 hours down, 31-hour MTBF. The
  platform scored it critical from its own trajectory — the September 2020
  engine failure, 404 hours, followed months of rising engine-related stops."
- If asked how health is computed: it's on the asset record — mean of
  full-period and last-3-month availability, risk is the inverse. No black box.
- Bonus honesty beat: **T341** shows _no_ health score — "zero corrective
  events in the period, so the platform refuses to invent one."

### Act 4 — The evidence trail (90s)

From T301, open its **work order history** (or Work & Execution → filter T301).

- Scroll the HIST-* work orders: failure mode, downtime hours, dates, and the
  source attribution in every closeout note.
- **Say:** "Every one of these six thousand work orders traces to a row in the
  operator's own spreadsheet. When your auditor asks where a KPI came from,
  this is the answer."

### Act 5 — The copilot work product (2–3 min)

Open the copilot dock (or /demo/copilot).
Ask, verbatim:

> Perform a root cause analysis packet for haul truck T301: 271 corrective
> failures, 2,476h unscheduled downtime, MTBF 31h, MTTR 9.1h over 15 months;
> dominant mode Engine Group including a 404h event in Sept 2020 that followed
> months of rising engine-related short stops.

- While it generates (~60–90s — use the time): "Ten chartered agent types —
  reliability, RCA, PM strategy, risk, planning — each bound to the published
  body of knowledge, with citations."
- When it lands: scroll the packet — symptoms → mechanisms → causes → systemic
  causes → recommendations → method references.
- **Say:** "That's a work product, not a chat answer. Download it, hand it to
  the reliability engineer, done."

### Act 6 — Governance: the human stays in command (90s)

Navigate: **Approvals** (or Mission Control → pending approvals).

- Show the AI-raised recommendations awaiting human approval — including the
  coverage breaches the platform raised _by itself_ when the real fleet landed
  ("Predictive Maintenance Coverage", "Asset Register Accuracy").
- Approve one if the audience wants to see it; the decision is logged.
- **Say:** "Nothing executes autonomously against safety- or production-
  critical systems. The AI recommends; an accountable human approves; the
  audit trail records both."

### Act 7 — The boardroom view (60s)

Sign out, sign in as **executive@syncai.ca**.

- Lands on Executive Intelligence: ISO 55000 KPI truth with RACI ownership.
- **Say:** "Same platform, different altitude. The board sees 29 KPIs it's
  accountable for; a technician sees 21 — access control happens _in the
  database_, board rows never reach a technician's browser."

**Close:** return to the readiness ring. "One question, answered continuously,
on your own data, with every answer auditable. That's mission assurance."

## Short form (5 min)

Acts 1 → 2 → 3 (T301 only) → 5. Skip 4, 6, 7 unless asked.

## Q&A ammunition — the real numbers

| Unit   | Failures | Downtime | MTBF | Availability | MTTR  |
| ------ | -------- | -------- | ---- | ------------ | ----- |
| T301   | 271      | 2,476 h  | 31 h | 77.1%        | 9.1 h |
| T284   | 211      | 1,452 h  | 44 h | 86.6%        | 6.9 h |
| T276   | 187      | 1,379 h  | 50 h | 87.2%        | 7.4 h |
| T290   | 151      | 914 h    | 65 h | 91.5%        | 6.1 h |
| T285   | 139      | 832 h    | 72 h | 92.3%        | 6.0 h |
| SH1611 | 216      | 745 h    | 47 h | 93.1%        | 3.4 h |

Fleet Pareto (all 26 units): Engine Group and Steering System dominate, then
Hydraulics, Wheel Motors, AHS radar/laser. SH1611 is the counter-story: many
stops, 3.4-hour MTTR — a drilled maintenance response, the target state.

Basis: 15 months × 720 h = 10,800 calendar hours; corrective events ≥ 1 h.

## Honest boundaries — say these before they're asked

- **Telemetry is simulated** against real-failure-domain sensors until a
  historian connects; the simulator auto-yields the moment one does. The
  spreadsheets are a historian export — static; live streaming is the phase-2
  connector conversation.
- **SSO is deliberately disabled** pending the supported OIDC path (the login
  page says so) — email/password + TOTP MFA is the current door.
- **Financial figures** in value tracking run on stated assumptions until real
  cost data loads.
- Parts/inventory and digital-twin geometry need data this dataset doesn't
  contain.

## If something goes wrong

- **Page looks stale:** hard-refresh once (the build stamp bottom-left should
  show a recent hash).
- **Copilot slow or unavailable:** the dock fails soft with a plain message —
  narrate governance (Act 6) and return to it.
- **LIVE badge shows CONNECTING:** realtime is reconnecting; data still loads
  on refresh. Don't debug on stage.
- **Wrong landing page after login:** you're in another role's session — sign
  out, use the private window.
