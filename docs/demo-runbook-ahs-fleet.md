# Demo Runbook — AHS Pilot Fleet (Real 15-Month Dataset)

_A click-by-click script anyone on the team can run cold. ~12 minutes full,
~5 minutes short form. Last verified 2026-08-04 against app.syncai.ca._

## What makes this demo different

Everything on screen derives from a **real autonomous-haulage mine operation**:
15 consecutive months of operator event logs from a **26-unit fleet** — 22
autonomous haul trucks and 4 hydraulic shovels, on a Komatsu FrontRunner site —
ingested through the platform's own onboarding engine and rebuilt as **6,000
work orders**. Those work orders carry the operator's own downtime vocabulary,
and the platform classified it rather than promoted it: 67 source labels
resolved to 44 equipment system groups, 15 activity types and 8 delay reasons,
with none of them renamed a failure mode.

Every figure in that paragraph is sourced in the table at the bottom of this
runbook. Figures that used to be here and are gone — a calendar span, a
dispatch-event count, a corrective-versus-downtime split — came out because
nothing in the repository carries them, and this is the one product that cannot
afford to quote a number it cannot source.

**The one-line pitch:** "This isn't seeded demo data — it's fifteen months of a
real operation, rebuilt by the platform's own onboarding engine in an afternoon."

**Fleet composition (operator-provided):** T2-series — Komatsu 930-4 ·
T3-series — Komatsu 980-4 · SH1611 — Komatsu PC 9000. (SH1006/1008/1010:
make/model not provided — deliberately left blank rather than guessed.) Those
four SH units plus the 22 haul trucks are where the 26 comes from.

**The autonomy-lift beat — withdrawn, do not say it.** This runbook used to
carry a rehearsed line about onboarding autonomy rising from 47.5% to 56.9%
once the operator supplied make/model. The two figures appear in exactly two
prose documents in this repository and nowhere else — no migration, script,
fixture or recorded query produces them — which is the same self-citation that
put the dispatch-event count and the corrective/downtime split on this page.
A caveat does not repair a number; it was removed rather than qualified.

The underlying beat is still true and still worth making, without the figures:
adding one operator-provided column lets the engine auto-fill nameplate items
and re-deduce OEM-dependent specs under its own confidence gate, and it tells
you exactly what still needs a human. Say that. Re-measure the lift on the next
ingest, record the query in `docs/fleets/`, and the numbers can come back.

## Pre-flight (2 minutes, do before every showing)

1. Open **app.syncai.ca** in a fresh private window (avoids stale sessions).
2. Sign in once yourself and check three things, then sign out:
   - Mission Control loads with the **LIVE** badge on.
   - Readiness ring shows a real posture (not 100).
   - Assets page lists the AHS Pilot Fleet units.
3. Have this runbook's **sourced-figures table** (bottom) on a second screen,
   and expect to read every per-unit number off the app rather than off it.
4. If the copilot will be shown, warm it: ask it anything one-line first
   (cold starts add a few seconds).

Demo credentials (demo-tier by design — rotate nothing for these):

| Role                   | Login                | Password      | Lands on               |
| ---------------------- | -------------------- | ------------- | ---------------------- |
| Reliability engineer   | demo@syncai.ca       | Demo123!@#    | Mission Control        |
| Executive              | executive@syncai.ca  | Exec123!@#    | Executive Intelligence |
| Maintenance manager    | manager@syncai.ca    | Manager123!@# | Work Action Board      |
| Maintenance supervisor | supervisor@syncai.ca | Super123!@#   | Work Action Board      |
| Technician             | technician@syncai.ca | Tech123!@#    | Work Action Board      |
| Planner                | planner@syncai.ca    | Planner123!@# | Planning Briefing      |

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

- Point out the health spread across the 26 units — read the critical, warning
  and operational counts off the page as you say them. "A realistic fleet,
  because it _is_ one."
- Open **T301**.
- **Say:** "Engine Group is this unit's dominant system group, and the platform
  scored it critical from its own trajectory — months of rising engine-related
  stops, then a long one." Read its failure count, downtime hours and MTBF off
  the asset record while you say it. Those live in the hosted database and
  deliberately not in this runbook, so that a stale page can never put a number
  in your mouth.
- The recurrence itself is on the record: Engine Group came back on T301 within
  12 days of a corrective action, the effectiveness check marked that action
  ineffective, and the platform raised a governed recommendation off it
  (capability register C4.16).
- If asked how health is computed: it's on the asset record — mean of
  full-period and last-3-month availability, risk is the inverse. No black box.
- Bonus honesty beat: **T341** shows _no_ health score — "zero corrective
  events in the period, so the platform refuses to invent one."

### Act 4 — The evidence trail (90s)

From T301, open its **work order history** (or Work & Execution → filter T301).

- Scroll the HIST-\* work orders: the operator's own downtime code, downtime
  hours, dates, and the source attribution in every closeout note. Call it a
  downtime code, not a failure mode — see the note under Q&A ammunition.
- **Say:** "Every one of these six thousand work orders traces to a row in the
  operator's own spreadsheet. When your auditor asks where a KPI came from,
  this is the answer."

### Act 5 — The copilot work product (2–3 min)

Open the copilot dock (or /demo/copilot).
Fill the four bracketed figures from T301's asset record — you had it open in
Act 3 — then ask:

> Perform a root cause analysis packet for haul truck T301: [corrective
> failures] corrective failures, [downtime]h unscheduled downtime, MTBF
> [mtbf]h, MTTR [mttr]h over 15 months; dominant system group Engine Group,
> including its single longest event, which followed months of rising
> engine-related short stops.

Typing the live figures in front of the audience is worth the ten seconds: the
prompt they watch you build is visibly the fleet they were just looking at, and
nothing in it came from a script that could have gone stale.

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

**The provenance rule, before any number below.** A figure may be said to a
customer only if it traces to code, a migration, a fixture or a test in this
repository; to a query you ran against the hosted database and recorded; or to
the screen in front of the prospect at that moment. Nothing else gets said,
however well it lands.

Another prose document is not a source. Every fabricated figure this runbook
has had to withdraw was defended by pointing at a second document that also
merely asserted it, and a citation between two documents that both assert and
neither compute is a loop, not a provenance chain. If following the trail does
not end at something executable or something recorded, the number does not
exist. The
entire pitch is a product that refuses to display a number it cannot source; a
runbook quoting an unsourced number hands the prospect the counter-example, and
they will only need to find one. The same discipline for sales claims generally
is written down in
`docs/enterprise-readiness/claims-and-evidence-register.md`.

### Sourced — quote these freely

| Figure                                                                                       | Source                                                                |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 26 units, 15-month history, file-based ingest                                                | `docs/enterprise-readiness/gap-analysis-enterprise-maintenance-os.md` |
| 22 autonomous haul trucks (plus the four SH units named above)                               | `supabase/migrations/20260823143000_demo_twin_mapping.sql`            |
| 6,000 work orders; 67 source labels, 0 unclassified                                          | `supabase/migrations/20260810200000_failure_coding.sql`               |
| 44 system groups (4,035 WOs) · 15 activity types (1,654) · 8 delay reasons (311)             | capability register C2.03                                             |
| 838 corrective work orders across the nine Komatsu FrontRunner AHS subsystems                | `supabase/migrations/20260810220000_ahs_mechanisms.sql`               |
| 582 Engine Group failures across 24 assets                                                   | capability register E8.14                                             |
| 23 corrective work orders and 1 of 441 repeat pairs mislabelled — excluded, not assumed away | `supabase/migrations/20260810200000_failure_coding.sql`               |

That last row is the strongest one in the table. It is a defect the platform
found in its own metrics, measured, and published rather than quietly netted
out; a GM of Maintenance who has been sold a dashboard before will recognize
what it costs to print it.

### The Pareto the repository actually supports

Engine Group is the largest single mechanical system group — 582 failures
across 24 of the 26 units. But the nine AHS subsystems (ODS radar/laser, GPS,
gyro, communications, central control, observer controller, user interface,
e-stop button, and a general AHS system-failure code) carry **838 corrective
work orders between them, more than any single mechanical group**. On an
autonomous fleet the autonomy stack is the bad actor, and it needed a whole
cyber-physical mechanism family because a radar head does not spall.

The ordering below Engine Group — Steering, Hydraulics, Wheel Motor Group — is
recorded nowhere. Show it from the app's own Pareto or leave it out.

Note the word: **system group**, not failure mode. The source field mixes
equipment, activity and delay labels, and calling any of it a failure mode is
the one thing `20260810200000_failure_coding.sql` explicitly refuses to do.
Mechanism coding is human-only. If a prospect hears "failure mode" from us on
this dataset, we have made the mistake we sell against.

Basis for any availability figure you quote: 15 months × 720 h = 10,800
calendar hours; corrective events ≥ 1 h.

### Not sourced — get these live or do not say them

Per-unit failure counts, downtime hours, MTBF, MTTR and availability are not in
this runbook any more. No export, fixture, migration or script in the tree or
in git history carries them; the commit that first wrote them is their only
occurrence anywhere. The same applies to the calendar span of the source logs,
the raw dispatch-event count, and any corrective-versus-total downtime split —
and the split that used to be printed here also disagreed with the register's
own 4,035 / 1,654 / 311 classification, which is how the whole block came
apart.

When a prospect asks for a bad-actor table, get it live: sign in as
demo@syncai.ca, open Assets, sort by health, and read the unit's own record on
screen. A number read off the product while they watch is sourced by
definition. One read off this page was not.

The durable fix is a fleet record for the AHS dataset of the kind
`docs/fleets/auxiliary-fleet-2010-2012.md` already is for the auxiliary fleet —
named source file, span, per-class counts, data-quality notes taken before
loading. Until someone writes that from a recorded query, the AHS unit-level
numbers exist only in the hosted database and belong only on screen.

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

## Screenshots for outreach

A prospect who has not booked a call still needs to see the product, and the
pictures that reach them have to be the same pictures every time — same fleet,
same crop, same build stamp. Taking them by hand produces a different scroll
position for every prospect and a full re-shoot whenever a screen changes.

```bash
node scripts/capture-role-tour.mjs
```

That signs in as each demo role in turn and walks its own command centers,
writing `artifacts/role-tour/<date>/`:

- full-page PNGs at 2x (1600×1000 CSS, cropped to real content), one per
  role-and-screen, named `<role>--<route>.png`;
- `manifest.json`, recording the route and the on-screen heading for each
  shot, so a caption can be checked against what the page actually said; and
- `video/`, a silent recording of each role's pass.

The tour reads its logins from the credentials table above — there is one copy
of the demo passwords in this repository and it is that table.

Useful flags: `--roles executive,technician` to shoot one layer, `--base
http://localhost:5173` to shoot a branch before it ships.

**Stills, not video, for a first email.** The recipient usually forwards it;
images survive a forward and a phone, a video link is a click a cold reader
does not make, and an automated pass has no narration to carry it. Video earns
its place on the second touch, narrated.

**Two screens need a caption or they overclaim.** Operational Briefing shows
connector cards (Maximo, SAP PM, OSIsoft PI, Bently Nevada) that are demo
fixtures, not live customer integrations; and value figures run on stated
assumptions per the boundaries above. Say so, or cut the shot.

## If something goes wrong

- **Page looks stale:** hard-refresh once (the build stamp bottom-left should
  show a recent hash).
- **Copilot slow or unavailable:** the dock fails soft with a plain message —
  narrate governance (Act 6) and return to it.
- **LIVE badge shows CONNECTING:** realtime is reconnecting; data still loads
  on refresh. Don't debug on stage.
- **Wrong landing page after login:** you're in another role's session — sign
  out, use the private window.
