# First Decision Journey — customer acceptance contract (2026-10-20)

Tracks #575. This is a **release gate**, not evidence of a completed journey. Reuse canonical Decision Case, tenant authorization, invitation, evidence and audit stores. No parallel graph, workflow or approval system.

## 24 observable steps

Each step must be demonstrated on the same exact deployed commit with a fresh authorized test account. Record **PASS / FAIL / BLOCKED**, actor, tenant, timestamp, evidence URL, and any limitation. No seeded customer outcomes.

1. Open public /get-started anonymously.
2. Understand the industrial problem and next action without a presenter.
3. Enter a concrete maintenance/reliability question.
4. See what information will be retained and who can access it.
5. Start authentication without losing the question.
6. Finish authentication and return to the same question.
7. Resolve correct tenant and permitted role server-side.
8. Create a canonical tenant-scoped Decision Case.
9. Reload and locate the saved case.
10. Edit question with version-safe persistence and recover from stale write.
11. Add manual evidence clearly labelled as manual/unverified.
12. Submit an authorized document through canonical knowledge intake.
13. Show quarantine/rejection versus usable indexed evidence truthfully.
14. Display evidence source, revision/configuration, provenance and access scope.
15. Resolve approved source mappings for the selected site/asset/component.
16. Show retrieval results or an explicit unsupported/unavailable state (never simulate a live connector).
17. Generate a bounded recommendation with uncertainty and counterfactuals.
18. Identify decision owner, required approver and verification owner separately.
19. Record disposition and planned verification with expected—not achieved—value.
20. Send an authorized invitation and distinguish submitted, delivered, accepted and active states.
21. Enforce canonical identity and case-version approval; refuse stale/cross-tenant/unauthorized approvals.
22. Return after sign-out and resume complete case/evidence/people/decision state.
23. Record a measured verification outcome, preserving baseline and approved expectation; never label expected value VERIFIED.
24. Present a shareable, accessible readiness/replay summary with unresolved items and next action.

## Two mandatory end-to-end acceptance runs

- **Presenter-led:** founder guides a fresh prospect through the 24 steps using authorized real customer-supplied data, with no manual DB repair or hidden developer assistance.
- **Independent:** unfamiliar user completes the same supported flow using only in-product guidance. Record confusion, blockers and completion time.

## Mandatory negative-path checks

- Anonymous and cross-tenant case, source, invitation and approval refusal.
- Missing coordinates/configuration/revision and stale evidence do not yield fabricated certainty.
- Invalid invitation email/provider failure does not become accepted membership.
- Missing integration provides a usable manual-evidence path, without claiming connector success.
- Expired/stale approval basis fails closed; governed reopen/reconsideration must preserve audit history.
- Refresh, network failure, duplicate submit, conflicting edits, and sign-out/re-entry preserve work or explain recovery.
- No plant execution, work release, approval impersonation, invented ROI or unsupported certification claim.

## Current implementation dependencies (re-resolve before closure)

- #599: governed invitations/evidence intake; closed 2026-10-20, but deployment and real invitation delivery unverified.
- #603: persistence, approval-basis and measured-outcome slice; open as checked 2026-10-20. Exact-head PostgreSQL CI and production deployment still need evidence.
- #575: overarching guided and self-guided journey; open as checked 2026-10-20.
- #576: Sync Context map is separate and not a prerequisite for completing the bounded First Decision Journey.

## Release evidence to attach to #575

- Exact commit SHA and production environment URL; CI run links; migration/Edge deployment records.
- Authenticated tenant isolation and provider failure witnesses.
- Both complete walkthrough recordings or stepwise traces, with user consent and private storage for customer data.
- Customer engineering reviewer and product owner signoff; limitations and rollback plan.

**Do not close #575 or market the full journey as complete until every supported step and both end-to-end runs pass.**
