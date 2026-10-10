# Slice 7D — Quality management family

Slice 7D is the cross-industry quality backbone used by every specialist pack. It records what was required, how it was inspected, what failed, what remediation cost, and who independently released the result. It does not claim regulatory certification or authorize operation.

## Canonical record flow

1. `quality_requirements` records a controlled source, a measurable acceptance criterion, and a verification method. A different authorized user approves the draft.
2. `quality_itps` and `quality_itp_points` translate approved requirements into sequenced review, witness, and hold controls. Every plan is independently approved.
3. A review point passes only with canonical evidence. A witness or hold point that passes inspection remains `awaiting_release`; a hold point requires a different authorized actor, and a witness point requires witness attestation or a controlled waiver.
4. `quality_ncrs` enforces `open → contained → dispositioned → corrective_action → verification → closed`. Closing requires effectiveness evidence and an independent actor. Age and overdue state are derived from timestamps.
5. `quality_defects` captures inspected, defective, first-pass accepted, reworked, and scrapped quantities. `quality_rework_records` must reference the canonical `work_orders` row and captures labour, material, equipment, downtime, and external cost with basis and source.
6. The existing `acceptance_tests` aggregate remains canonical. Slice 7D extends it beyond capital-project FAT/SAT, adds sample results and evidence, and requires independent release after a full pass with zero open punch items.
7. `quality_cost_entries` captures prevention, appraisal, internal-failure, and external-failure costs. Failure entries are attributed to rework, scrap, retesting, delay, claims, or startup failures; legacy unclassified failure cost remains explicit. The quality cockpit derives Cost of Poor Quality, shows prevention and appraisal separately, and never combines currencies.
8. Case-linked quality entries may carry a sourced forecast-growth effect. The cockpit compares that recorded quality-driven growth with positive cost effects from the currently approved SCOPE baseline in canonical `project_scope_changes`. Missing scope costs refuse the combined figure and percentage; the calculation does not approve a forecast or change.

Every write is tenant-bound in a security-definer RPC, every table has organization RLS, and every approval/release also creates a canonical `approvals` record and `audit_events` entry.

## Seven governed metrics

| Metric                    | Formula                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| First-pass yield          | first-pass accepted quantity / inspected quantity × 100                                             |
| Defect rate               | defective quantity / inspected quantity × 100                                                       |
| Rework rate               | reworked quantity / inspected quantity × 100                                                        |
| Scrap rate                | scrapped quantity / inspected quantity × 100                                                        |
| Acceptance-test pass rate | passed samples / tested samples × 100; outcomes are the fallback only when sample counts are absent |
| NCR closure rate          | closed NCRs / detected non-cancelled NCRs × 100                                                     |
| Overdue open-NCR rate     | open NCRs past due / all open NCRs × 100                                                            |

The repository pins the same definitions in TypeScript and SQL. A zero denominator returns unavailable rather than a manufactured zero.

## Production acceptance

- Pure calculation tests validate all seven metrics, quantities, NCR age, multi-currency cost, and impossible-input refusal.
- Service and component tests prove all 13 operations are wired to the live Risk workspace.
- `scripts/ci-quality-management-smoke.sh` executes the complete database lifecycle on a clean Supabase stack, including self-approval refusals, hold release, NCR closure, rework cost, acceptance release, derived metrics, six-term COPQ, quality-versus-scope forecast attribution, and canonical approval records.

## Quality workbench session-lifecycle prerequisite

The workbench fails closed without a matching signed-in profile, organization and role. Observed actor, organization or role changes remount its local state. Reads clear prior cockpit data before reload; generation checks discard obsolete reads. A server-validated user check precedes reads and writes, with a lifetime check after that await to prevent an obsolete form from starting a request. Pending actions freeze the selected action and payload and prevent concurrent submission.

An acknowledged action remains acknowledged if its subsequent read fails. Authentication denial clears protected response details and the draft; only a non-sensitive acknowledgement marker remains. Mutation failures are not automatically retried: a lost response may conceal a committed action and must be checked against canonical records before resubmission.

These are UI lifecycle protections, not an atomic server actor/organization envelope, commit-time membership qualification or idempotent lost-acknowledgement recovery. Unobserved same-user membership changes remain a backend qualification requirement. Component/service tests use doubles and do not establish real-browser, HTTP/RLS or production qualification.

U8.01 remains incomplete. Its full scope still requires automatic condition-to-quality candidate discovery with explicit asset/cohort/window coverage; product, service, customer, regulatory, rework/scrap, warranty and reputation facets; independent causal review; canonical identity-deduplicated, currency-separated COPQ; existing NCR correction/effectiveness and acceptance-release gates; and current standing plus permitted immutable history. The seven cockpit metrics are not substitutes for these seven impact facets.
