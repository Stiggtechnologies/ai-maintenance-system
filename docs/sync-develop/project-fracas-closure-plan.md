# D9.05 — project FRACAS closure acceptance plan

Status: accepted implementation. D9.05 is promoted after the complete canonical
closure chain, authenticated boundary smoke and customer browser workflow passed
on the merged implementation. Administrative workflow closure remains distinct
from measured effectiveness or demonstrated prevention.

## Accepted evidence

- The exclusive project-lesson subject on `ca_verifications`, evidence-backed
  human attestations, canonical standard-work revisions and approvals, and
  recorded project-population screening are implemented. Asset evaluators and
  KPI denominators explicitly exclude project subjects.
- Rejected revisions remain history; retry uses the last adopted baseline and the
  next unused version. Stale, pending, self-approved and concurrent decisions are
  refused, and submitted approval/procedure facts are immutable.
- `scripts/ci-project-fracas-smoke.sh` runs the authenticated API chain with the
  real applicability predicate, exact PostgREST relationships, foreign/anonymous/
  direct-write refusals, concurrent calls, screening population isolation and the
  non-effectiveness boundary on the full migration chain.
- `tests/e2e/project-fracas.spec.ts` inspects the completed chain, re-screens the
  project population and proves receipt persistence after reload on the reachable
  Realize workspace.
- Administrative completion is `closed_project_workflow`; effectiveness remains
  null. Zero candidates are an honest empty result, never prevention evidence.

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

## Pre-implementation investigation record

### Consumer inventory found on main

- `src/components/CaEffectivenessPanel.tsx`: reads recent `ca_verifications`
  without a subject discriminator and renders asset/work-order semantics.
- `20261005090000_recommendation_contract_producers.sql`: current asset
  effectiveness evaluator; its no-recurrence branch writes `closed_effective`.
  A project row with no asset recurrence cannot be allowed through that branch.
- `20261219133000_ca_effectiveness_kpi.sql`: `get_ca_effectiveness_rate` and
  scheduled `snapshot_ca_effectiveness_kpi` count verification records without a
  subject discriminator. Both require explicit scope preservation if project
  records enter this table, including the disclosed observing count.
- `20261219132000_failure_mode_elimination_rate.sql`: reads verification through
  same-tenant work orders and damage mechanisms. Preserve asset–mechanism units,
  latest-record selection, uncoded exclusion and direct-write revocations.
- `20260901140000_verification_obligations.sql`: an obligation can reference a CA
  verification. The later generalized requirement-verification contract
  (`20261204090100`) explicitly preserves the distinct existing stores; do not
  create another verification table to evade that contract.
- `20260920002000_ria_sponsor_and_demo_assessment.sql`: demo/workspace table
  inventory also includes CA verification. Check its handling of new targets.

The existing `approvals` and `decisions` tables plus database-owned
`app_has_approval_authority` are the starting approval contracts. The role
predicate's latest migration and object-specific write rules still need tracing
before selecting adoption authority; copying an older role list is not a design.

Resolve the exact canonical approval references and target extension after
reading every current CA consumer. Establish project-specific closure semantics
without inventing measurement periods, effectiveness thresholds or a parallel
workflow. This plan does not pre-approve a nullable-asset migration or declare
asset and project effectiveness equivalent.

## Contract investigation after the material release

PR #527 is merged as `45f7e69`; this branch now includes that released main.
Its production deployment passed, while authenticated live materials acceptance
remains separately outstanding. This project-closure plan does not promote it.

- The latest `record_verification_result` is in
  `20261204090300_develop_slice5a_repair.sql`, not the earlier `090100` migration.
  It preserves standing failed requirement verifications through derived status
  and explicit supersession. Any subject extension must retain that behavior.
- `verification_obligations` currently requires exactly one recommendation or
  requirement subject. Its `learning_event_id` is a failure-result output, not
  the originating lesson. Reusing that column as the project lesson would erase
  the distinction between source and generated learning.
- `standard_work` already has nullable measured duration and a unique
  organization/work-key/version identity. A project revision must not fabricate
  duration merely to create a standard. `procedure_translations` contains actual
  procedure content and human translation verification; a title/basis change
  alone must not be misrepresented as an adopted procedural change.
- The canonical `approvals` store already supports a typed subject extension:
  `20261219200000_significant_expenditure_approval.sql` adds an expenditure
  reference and blocks generic approval mutation through a restrictive policy.
  Standard adoption should follow that governed-subject pattern, with its own
  evidence and stale-revision guards, rather than add another approval table.
- `app_role_has_approval_authority` is database-owned in migration `00000000000022`.
  The implementation must use that predicate plus same-tenant human attribution;
  a copied UI role list is not the authority contract.

These findings constrain implementation; they do not establish completed closure
or choose a new verification subject without the required consumer tests.

## Target-extension decision

Extend `ca_verifications` for project lessons, as D9.05 requires, rather than
create a competing closure store or disguise a lesson as a design requirement.
The extension must use an exclusive subject constraint: an asset work order with
its asset, OR a canonical project `learning_events` reference, never both.
Project records must not inherit the asset-only default 90-day observation or
`closed_effective` outcome. Add explicit project closure semantics and keep all
existing asset evaluators, recent-row reads and metric denominators asset-scoped.

The first migration's acceptance tests must prove these negative boundaries
before the project write path is exposed. Standard revisions will use
`standard_work` and typed canonical `approvals`; the future-project screen will
reuse `sync_lesson_applies_to_case`. The existing `ProjectLessonsSection` is the
customer entry point. No new top-level workflow or learning table is needed.
