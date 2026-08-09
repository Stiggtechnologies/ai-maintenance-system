# Auxiliary Fleet — Alberta Oil Sands Surface Mine (Jan 2010 – Apr 2012)

Source: `Traxs Down Summary Jan 2010 - April 2012.1.xlsx`, sheet `VNC 2010-2012`.
Second real fleet loaded into SyncAI, independent of the AHS haul fleet.

## What was loaded

|                  |                                                |
| ---------------- | ---------------------------------------------- |
| Down events      | **21,450**                                     |
| Assets           | **144** across 8 equipment classes             |
| Span             | 2010-01-01 → 2012-07-30 (31 months)            |
| Total downtime   | **398,638 hours**                              |
| Operating states | 21,450 (first real state data in the platform) |
| Work orders      | 20,314 — 8,504 corrective, 11,810 preventive   |

Delay events (1,136) are loaded as operating states only. Waiting is not work,
and creating a work order for it would inflate both the work count and the
maintenance-effort figures derived from it.

| Class          | Units | Work orders | Downtime (h) | Mean (h) |
| -------------- | ----- | ----------- | ------------ | -------- |
| Dozer          | 83    | 8,954       | 192,114      | 21.5     |
| Grader         | 24    | 8,604       | 77,301       | 9.0      |
| Shovel         | 13    | 1,425       | 44,553       | 31.3     |
| Wheel Dozer    | 2     | 430         | 12,428       | 28.9     |
| Support Loader | 7     | 278         | 7,827        | 28.2     |
| Water Truck    | 2     | 234         | 3,936        | 16.8     |
| Support Dozer  | 10    | 204         | 3,507        | 17.2     |
| Transporter    | 2     | 185         | 3,099        | 16.8     |

## Data quality, checked before loading

- **Zero overlapping down windows** on any unit across 21,450 events. Unusually
  clean; two simultaneous down states on one machine is impossible, and its
  absence is a genuine integrity signal.
- Zero negative durations. 17 rows with no end timestamp, reconstructed from
  the stated duration.
- 52 rows (0.2%) where the stated duration disagrees with the timestamps by
  more than an hour. Timestamps were kept as authoritative.
- 2 rows with a zero-length or inverted window, extended to one minute and
  counted, not dropped.
- **Unit numbers are reused across equipment types** — ten numbers appear as
  both `Dozer` and `Support Dozer`. The asset key is therefore type + unit;
  keying on unit alone would have silently merged twenty machines into ten.
- Seven events exceed 2,000 hours. All are legitimate: five `MIDLIFE` rebuilds,
  one `PLANNED OVERHAUL`, and one 19,235-hour `UNDERCARRIAGE / LFT TRACK BRK`
  that almost certainly marks a unit parked rather than repaired. Left in and
  flagged rather than trimmed — a rebuild is real downtime.

## Findings worth acting on

**Undercarriage is the fleet's single largest loss.** 458 events, **32,394
hours** — a mean of 70.7 hours each, the highest of any system group and more
downtime than the entire Shovel class. On a dozer fleet this is the classic
candidate for a wear-management strategy rather than run-to-failure.

**13.5% of all downtime was waiting, not working.** The source system records
maintenance delay separately, and it totals **53,874 hours** across 1,136
events:

| Delay                      | Events | Hours  |
| -------------------------- | ------ | ------ |
| Wait parts (incl. Finning) | 441    | 27,335 |
| All `WAIT *` reasons       | 928    | 43,555 |

This is the first real evidence for the waiting-on-material metric (C6.15),
which had no data behind it until now.

**Ground-engaging tools dominate event count but not hours** — 2,708 events for
16,249 hours (6 h each). High-frequency, low-impact: a planning and materials
problem, not a reliability one. Undercarriage is the reverse. Ranking by count
alone would have pointed the programme at the wrong target.

## Vocabulary

79 distinct reason codes, classified on ingest with zero left unclassified:
41 system groups (8,504 events), 25 activity types (11,810), 13 delay reasons
(1,136). Stored in `failure_code_map` as reviewable data with the same
draft-review posture as the AHS fleet vocabulary. The platform-wide vocabulary
is now 85 system groups, 40 activity types, 21 delay reasons.

The `Comment` column carries mechanism-level free text — "BRAKES FROZEN",
"LFT TRACK BRK", "HYD LEAK", "OVERHEATING" — across 5,603 distinct values. It
is loaded as the work-order title and is the best available raw material for
mechanism coding (C2.03), which remains a human act.

## A defect this data exposed

`get_operating_context` reported "No operating-state record for this asset"
whenever a trailing window found nothing. With 161 records on Dozer 5301
spanning 2010–2012 and a 900-day window, that message was simply false. It now
distinguishes "no records" from "no records in the period you asked about" and
volunteers the span it holds. Fixed in migration `20260812190000`.
