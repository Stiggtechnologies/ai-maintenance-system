# D9.05 — project FRACAS closure acceptance plan

Status: design investigation only. No capability promotion or implementation claim.

## Required outcome

Specification I.37 requires Failure → Cause → Corrective Action → Standard Changed
→ Future Projects Screened for the eight project-delivery failure types. Section
33 identifies the lesson/FRACAS object; the repository has already assigned that
identity to `learning_events`. A captured lesson alone does not satisfy closure.

## Existing contracts to extend

- `learning_events` and `record_project_lesson`: canonical case/project, failure
  taxonomy, cause, corrective action and applicability; `ProjectLessonsSection`
  is the existing customer surface.
- `ca_verifications`, `start_ca_verification`, `attest_ca_stage`,
  `evaluate_ca_effectiveness`, `screen_similar_assets`: existing corrective-action
  loop. Its current required work-order/asset identities and asset recurrence
  semantics must not be silently applied to delivery failures.
- `standard_work`: tenant-owned `(work_key, version)` identity, source basis and
  optional measured duration. A governed revision must preserve that identity
  and the old version rather than overwrite the history.
- `sync_lesson_applies_to_case` and `screen_applicable_project_lessons`: existing
  deterministic applicability predicate and project screening read. Reuse these;
  do not create a second matcher or invent a confidence score.
- Existing canonical approval/decision and `audit_events` contracts: preserve
  named human authority and recorded source evidence, rather than create another
  approval store or audit log.

## Important semantic correction

The register suggests `standards_register` / `record_standards_review` for the
Standard-Changed hop. Inspection shows these describe published external
standards and a tenant's edition/licensing holdings. Recording a licensed ISO
edition is not proof that a project corrective action changed internal standard
work. That API must not be used to manufacture closure. Internal standard-work
revision and human adoption must be evidenced; an external standard can remain
a supporting reference, not a substitute for that change.

## Acceptance cases to implement and verify

1. A named authorized human starts project closure from a same-tenant project
   lesson; missing cause/action, foreign lesson, AI-only identity, and duplicate
   active closure are refused. No fabricated corrective work order or asset is
   introduced to satisfy the existing asset-only schema.
2. The existing asset loop continues unchanged. Inventory every read, evaluator,
   scheduled job and metric over `ca_verifications` before extending its target:
   project rows must not corrupt asset effectiveness denominators or be evaluated
   as effective simply because they have no asset work-order recurrence.
3. Human attestations retain actor, time and substantive evidence. Recording an
   action is not proof of implementation, causal closure or effectiveness.
4. A revision of canonical standard work retains source lesson, previous version,
   exact change and basis. A draft governs nothing. Adoption requires existing
   human approval authority; concurrent revision/adoption and stale-version
   attempts cannot silently replace another revision.
5. The Standard-Changed stage refuses an unrelated, foreign, unapproved or
   unchanged reference. Published-standard holdings reviews cannot satisfy it.
6. Future-project screening uses the existing applicability predicate and records
   the screened population/time/basis. Own-source cases and foreign tenants are
   excluded. An empty candidate set is reported honestly, not as demonstrated
   prevention. Later eligible project creation still surfaces the relevant lesson
   and adopted standard-work reference through the existing project-start flow.
7. Stage order and closure are enforced at write time, not only by disabled UI
   buttons. No automatic engineering authorization or effectiveness claim arises
   from capture, matching, or absence of reported failures.
8. The customer can follow the complete chain from the existing project-lessons
   surface and inspect source evidence, actor, revision/adoption and screening
   receipts. Errors remain errors, not empty-success states.
9. Prove tenant scope on reads and all writes, including parent reassignment,
   malformed privileged history, concurrency and direct-client bypass attempts.
10. Run isolated boundary tests, full authenticated migration-chain tests,
    browser workflow and rendered review, then deployed-schema/live verification.
    Only then reconcile D9.05 and any other row actually proven complete.

## Investigation still required before schema changes

Resolve the exact canonical approval references and target extension after
reading every current CA consumer. Establish project-specific closure semantics
without inventing measurement periods, effectiveness thresholds or a parallel
workflow. This plan does not pre-approve a nullable-asset migration or declare
asset and project effectiveness equivalent.

The material-commercial release remains separate in PR #527. This worktree starts
from main `31343c7`; it does not depend on unmerged material UI/migrations.
