# Explicit ethical boundaries

## Purpose

SyncAI's ethical-boundary register makes nine prohibited outcomes explicit and
reviewable. It is a governance control, not an automated ethics classifier or a
certification claim. A current posture exists only when all nine boundaries
have an implemented control, a reproducible verification procedure,
independently verified canonical evidence, a named accountable owner and an
independent human adoption decision whose review date has not expired.

The customer-reachable workspace is on **Decision Governance** at
`/governance`.

## The nine boundaries

1. Do not hide material uncertainty, limitations, conflicts or applicability
   boundaries.
2. Do not manipulate metric definitions, populations, baselines, targets,
   observations or verification states.
3. Do not recommend or reward unsafe staffing, workload, competence, fatigue
   or supervision conditions.
4. Do not use protected traits or unjustified proxies for adverse or unequal
   treatment.
5. Do not use unverified surveillance, identity, location, image, audio or
   behavioral inference as decision-grade evidence.
6. Do not punish, rank or make an adverse decision about an individual from
   model output alone.
7. Do not weaken mandatory safety, regulatory or barrier obligations to
   improve finance, production or schedule.
8. Do not obscure accountability behind an algorithm, model, agent, vendor or
   workflow.
9. Do not fabricate certification, approval, risk acceptance, compliance,
   safe-to-start, work-release or other authority SyncAI does not hold.

Definitions are global, versioned and changed only by database migrations.
Tenant reviews never alter their meaning.

## Canonical composition

The slice introduces only the versioned review and determination nouns. It
reuses the existing:

- `evidence_items` for independently verified proof;
- `user_profiles` for named same-tenant owners;
- `recommendations` for gap remediation;
- `approvals` for the independent final disposition; and
- `audit_events` for every governed transition.

The new recommendation and approval references use composite organization and
review foreign keys. A record cannot link an ethical review from another
tenant, even through a service-level write.

## Governed workflow

1. An administrator, executive, maintenance manager or reliability engineer
   opens a draft with scope, purpose, effective date and next-review date.
2. Each boundary is assessed as `enforced` or `gap`. The assessor must describe
   the control and reproduction procedure, select a same-tenant named owner and
   cite canonical evidence verified by someone other than that assessor.
3. Submission refuses a missing determination or evidence whose current
   verification no longer satisfies the independence rule.
4. A submission with any gap becomes `remediation_required` and opens one
   canonical pending recommendation per gap. It cannot enter final review.
5. Once all gaps are replaced by evidenced `enforced` determinations, the
   review becomes `review_pending`.
6. Only an administrator or executive who is not the author, submitter or any
   determination assessor can adopt or reject it.
7. Adoption rechecks all nine outcomes, evidence standing and the future
   review date. It supersedes the prior adopted version and closes remediation
   recommendations only after that independent decision.
8. An adopted version is `current` only until `next_review_on`.

Authenticated clients have read-only table grants. All changes move through
the governed RPCs, and direct inserts, updates, deletes or link fabrication are
refused by database triggers.

## Authority and safety boundary

An adopted review says that named humans reviewed evidence for the stated
scope. It does not prove that every future use will be ethical, authorize an AI
agent, approve work, accept risk, change an operating limit, discipline a
person, certify compliance or return equipment to service. Existing safety,
privacy, evidence, RACI, approval and operational-control contracts remain
controlling.

## Verification

`scripts/ci-ethical-boundaries-smoke.sh` proves on a fresh database chain:

- the exact nine-definition set;
- refusal of foreign and self-verified evidence;
- refusal of a foreign-tenant accountable owner;
- complete determination coverage;
- gap-to-canonical-remediation behavior;
- assessor/final-review separation;
- direct-write and fabricated-link refusal;
- independent adoption and canonical approval/audit records;
- remediation closure only after adoption;
- expiry refusal; and
- an explicit `automationAuthority=false` result.

The contract test pins the same architecture and verifies that the typed
service and routed governance page reach every mutation.

## Rollback

Remove the `EthicalBoundariesPanel` from the routed page to disable new user
actions, and revoke execution on the five ethical-boundary RPCs if an emergency
server-side stop is required. Retain definitions, reviews, determinations,
recommendations, approvals and audit events. A code rollback must not delete or
rewrite evidence used by a prior human decision.
