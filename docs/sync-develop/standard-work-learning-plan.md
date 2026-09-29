# D9.06 — standard-work learning acceptance plan

Status: investigation, not implementation or capability acceptance.

## Required outcome

Specification I.38 requires STANDARD → ACTUAL EXECUTION → VARIATION → OUTCOME
→ LEARNING → IMPROVED STANDARD. A captured lesson or approved revision alone
does not establish this loop. Positive outcomes and conforming execution must
not be disguised as failures merely to use project FRACAS.

## Canonical contracts and investigation

- `standard_work` identifies the exact tenant-owned work key and version;
  `procedure_translations` holds the actual language-specific procedure.
  Published `standards_register` holdings are not an internal work procedure.
- `learning_events` remains the learning identity. Before extending it, inventory
  existing execution, outcome and variation contracts and their consumers.
- #528 provides human-approved project-failure-driven standard revision history.
  Investigate extending its typed canonical approval path to evidenced learning
  without inventing a failure, asset, work order or parallel approval store.
- `standard_minutes` is optional and requires a basis. Never infer duration,
  savings, compliance or causality from missing actuals or a successful workflow.
- Reuse canonical evidence and `audit_events`; preserve exact procedure content,
  actor, time and source identity when recording execution against a version.

## Acceptance requirements

1. An authorized same-tenant human records actual execution against an exact
   approved/human-verified procedure version and real case/work context.
2. Record observed conformance or variation explicitly with evidence and basis;
   absence of a variation record is not evidence of conformance.
3. Capture outcomes with evidence, units and attribution limits. Distinguish
   observation from verified improvement and do not fabricate counterfactuals.
4. Link producing execution, variation and outcome to canonical learning.
   Support beneficial and adverse learning without false failure classification.
5. Proposed improvements retain source learning and exact prior/new content.
   Adoption requires a separate authorized human and canonical approval.
6. Retain rejected attempts and historical evidence; stale/concurrent requests
   cannot overwrite a decided revision or silently change the observed baseline.
7. Enforce tenant scope, immutable referenced history and write authority at the
   database boundary, including direct-client and forged-parent attempts.
8. Expose the complete loop on an existing reachable customer surface, including
   errors, missing evidence, source inspection and adoption state.
9. Prove with boundary tests, authenticated migration-chain tests, browser writes
   and reloads, rendered inspection and deployed/live acceptance before promotion.

## Prior release boundary

#528 merged as `a7620539`; production deployment `36521832377` and all three
Vercel statuses passed. Its authenticated production acceptance remains open:
the available browser exposes public access, not an authenticated tenant session.
Neither D9.05 nor D9.06 is promoted by this investigation.
