# OEM integration roadmap

**Status:** live. Updated 2026-08-10.
**Owner decision recorded:** the Cat dealer agreement permits extraction of OEM
service content into internal systems (Orville, 2026-08-10). That gate is
answered; what remains is technical sequencing and, in one case, a phone call.

---

## Why this exists

An OEM holds facts about your machines that no amount of analysis of your own
data can recover: which builds carry a recalled part, what a component is made
of, what the machine's meter actually reads, and what the dealer did to it last
month. Seven distinct feeds, with very different value and very different
blockers.

This document ranks them by value to **this** operator, states the blocker on
each honestly, and records what is already built.

---

## The finding that shapes the whole plan

**ISO 15143-3 (AEMP 2.0) is a published standard supported by Caterpillar,
Komatsu, Hitachi, John Deere and Volvo.** It defines a common JSON/XML payload —
location, meter hours, fuel, idle ratio, machine status — with the same field
names across every OEM portal.

That matters here specifically: the operator's 6-series excavators are Komatsu,
Hitachi _and_ Caterpillar. Telematics is **one integration, not three**. No other
feed on this list has an equivalent standard, which is why it is sequenced early
despite not being the highest-value item in isolation.

Sources:
[AEMP 2.0 explained](https://www.autopi.io/blog/what-is-aemp-telematics-standard/) ·
[Cat ISO 15143-3 API](https://www.mantracgroup.com/en-iq/technology/link/iso-15143-3-aemp-2-0-api/) ·
[Komatsu conformance](https://www.forconstructionpros.com/construction-technology/equipment-monitoring-logistics/article/22197990/komatsu-america-corp-my-komatsu-achieves-aemp-20iso-151433-interoperability) ·
[mixed-fleet support](https://gomotive.com/blog/aemp-heavy-equipment-telematics/)

---

## The seven feeds

| #   | Feed                           | Value                                                                                | Blocker                         | Built              |
| --- | ------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------- | ------------------ |
| 1   | Safety recalls / PSP by serial | **Highest** — an unactioned recall is a live exposure                                | **Serial numbers: 0 of 144**    | Engine ✅, data ❌ |
| 2   | Meter hours (ISO 15143-3)      | **High** — the Weibull fits use calendar time; operating hours are not in the schema | Dealer must enable the endpoint | Not started        |
| 3   | Dealer service history         | **High** — work done at the dealer never reaches the CMMS                            | Per-OEM portal, no standard     | Not started        |
| 4   | Fault / diagnostic codes       | **High** — the mechanism data the register lacks entirely                            | API access                      | Not started        |
| 5   | S·O·S fluid analysis           | Medium-high — earliest signal on drives and transmissions                            | Lab feed                        | Not started        |
| 6   | Parts supersession             | Medium — configuration change management                                             | None; file export works         | ✅ **Built**       |
| 7   | Warranty status                | Medium — stops paying for covered repairs                                            | Dealer portal                   | Not started        |

---

## Priority order, and why it differs from the value order

### P0 — Serial number capture _(not an integration)_

**0 of 144 assets record a serial number.** This is not a nice-to-have field. It
gates feeds 1, 3, 5 and 7 outright, because a manufacturer scopes everything it
publishes by serial range — that is how it knows which builds carry the affected
part.

The applicability engine already handles the absence honestly: it returns
`possibly_affected` on a model match with no serial, and says so. But
"possibly" across a whole fleet is not a safety position anyone can act on.

Serials cannot be derived. Unit numbers gave us tags; nothing in the register
gives us serials. This is a walk-the-yard exercise, or a dealer extract keyed on
the machines the dealer already knows you own.

**Sequenced first not because it is the most valuable, but because four of the
six remaining feeds are worth nothing until it is done.**

### P1 — ISO 15143-3 telematics

Meter hours are the sleeper. Be precise about what is and is not missing,
because the platform already derives more than a first look suggests:

**Already derived and in use.** Downtime is recorded on every work order, so
`repairableSummary` computes uptime as `calendar − downtime` and availability
from it. That is real, and it is not the gap.

**Absent from the schema entirely.** A machine meter reading. Every hours-like
column in the database is labour hours, downtime hours, planning capacity, or a
derived metric — there is no SMU field on `assets`, on `condition_readings`, or
anywhere else.

**Why that gap lands on the Weibull specifically.** The fit runs on CALENDAR
inter-arrivals: `ReliabilityAnalytics` builds cumulative hours from
`completed_at` timestamps and diffs them. So it models failures per elapsed
time. Uptime is not running time — a dozer that is available and parked accrues
uptime and zero meter hours. Two machines over the same month, one running 500
hours and one running 100, have identical calendar exposure and five times
different wear exposure. Undercarriage and final-drive wear track operating
hours and load, not the calendar, so fitting on calendar blends those machines
and flattens beta toward 1 — making wear-out look like random failure.

Real meter hours would change every fitted parameter for the wear-driven
components, which on this fleet is where the downtime is (undercarriage alone is
29,822 hours, 43% of coded dozer downtime). And because ISO 15143-3 is a
standard, one integration covers the mixed fleet.

**Next action is a phone call, not code:** confirm the dealer can enable the
ISO 15143-3 endpoint on the existing Product Link subscriptions. That answer
decides whether this is two weeks of work or a procurement conversation.

### P2 — Dealer service history

The most uncomfortable of the seven. Work performed at the dealer typically never
lands in the operator's CMMS, which means the failure history every analysis in
this platform rests on is incomplete **by an unknown amount**. Not a wrong
number — an unquantified one, which is worse.

Blocked on serials (P0) to match records to machines.

### P3 — Fault and diagnostic codes

Recall the finding from the twin-derivation work: `actual_failure_mode` is
exactly equal to `system_group` in all 8,504 coded rows. The register has
component coding and **no failure-mode coding at all**.

OEM fault codes are the mechanism data that gap needs. They will not fill it
retrospectively, but they end it going forward.

### P4 — S·O·S fluid analysis, P5 — Warranty

Both per-OEM, both dependent on serials, both valuable and neither urgent.

### Done — Parts supersession

Built and tested. Supersession becomes a **proposed, one-way, unapproved**
interchangeability rule feeding the existing `interchangeability_rules` and
`configuration_reconciliations` tables. Works off a file export, needs no OEM
API, and does not wait on serials — it degrades to `possibly_affected` and says
so.

---

## Architectural commitments already made

These are settled and should not be relitigated per-feed:

- **Client-scoped, never shared.** OEM content lands in the `oem_service_manual`
  document class, which is `may_be_global = false`. The corpus-scope trigger
  physically refuses to place it in the cross-tenant knowledge base, and the
  importer re-checks that flag and refuses to run if it is ever flipped.
- **Own subscriptions.** Each client authenticates with their own OEM
  entitlement. SyncAI does not hold a licence and does not redistribute content.
- **Credential handling, best to worst:** delegated OAuth (no stored secret) →
  client-side agent that pushes to SyncAI (credential never leaves them) →
  vaulted credentials. Avoid the third where either of the first two exists.
- **No standing on failure behaviour.** OEM service content may be cited for
  component structure, maintenance tasks and rated figures. A service interval
  is what the manufacturer requires; a failure rate is what the fleet does.
  Conflating them is one of the commonest errors in maintenance analysis.
- **Reject, don't drop.** All feeds use `ingest_staging`, where rejected rows are
  retained with their reason. A connector that silently drops rows reports a
  successful sync.

---

## What would change this plan

- **If the dealer cannot enable ISO 15143-3**, P1 drops behind P2 and telematics
  becomes a per-OEM integration rather than one.
- **If serials arrive via a dealer extract rather than a yard walk**, P0
  collapses into P2 and the whole plan shortens by weeks.
- **If any OEM publishes a bulletin webhook**, feed 1 moves from polled to
  pushed, which materially changes recall response time. None is known to today.
