# D9.06 — standard-work learning acceptance plan

Status: implementation in progress; not capability acceptance. The observation
database contract, recording service and Realize capture/history surface are
implemented on PR #529. Learning-sourced revision requests, separate-human
approval/adoption and their UI are now implemented locally. Isolated PostgreSQL
tests cover request, rejection, retry, adoption and immutable history; targeted
service/component tests cover receipts and UI actions. These do not establish
authenticated browser acceptance. CI run `36525685877` on `8ac4b73` passed the
full migration chain and authenticated observation-to-adoption smoke, including
tenant refusals and concurrent requests/decisions. Browser execution recorded
an observation and persisted its draft revision across reload, but failed at
the separate approver's role-specific landing-page assertion. Commit `9ffe0b5`
corrects that test assumption; its full browser result, rendered inspection and
production acceptance remain open. No capability promotion is claimed.

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

## Execution-model findings

- `20261210090000_develop_work_package_object.sql` explicitly assigns execution
  state to `work_orders.status` (ruling 19). Package status is release state,
  not execution state. `work_package_work` joins a real work order to a package
  and its development case; one work order can appear at multiple package levels.
  Do not introduce another execution-status engine or count each membership as
  a separate execution.
- `learning_events_case_lesson_complete` currently admits case-linked
  `project_outcome` events or requires failure/cause/corrective action. A new
  positive standard-work learning type needs its own complete, enforced subject
  contract; merely exempting it from the existing constraint would weaken it.
- `project_outcome` is a completed-project reference-class observation with
  baseline/actual project cost and duration, independently verified evidence,
  and immutable provenance. It is not a per-execution outcome. Reusing it for a
  single standard-work observation would contaminate the reference-class corpus.
- Candidate extension: typed standard-work observation on canonical
  `learning_events`, referencing exact procedure and actual `work_orders`
  context, with evidence-backed execution/variation/outcome fields. This must
  not alter work-order completion or imply that evidence of execution authorizes
  work. Trace downstream lesson screening and metrics before adopting this shape.
- The newly released revision guard currently requires a project CA source.
  Generalization must preserve existing CA invariants while admitting a distinct
  evidenced learning source, not create a dummy CA or relax both source paths.

## Downstream consumer boundaries

- The current `screen_applicable_project_lessons` definition in
  `20261225180800` explicitly selects `lesson_learned` plus delivery failure
  taxonomy. Preserve that contract; do not inject positive observations with
  null failure/cause fields into existing failure-lesson cards.
- Project assurance and methodology outcome learning select `project_outcome`.
  A distinct typed observation must stay outside that project-level corpus.
- The eight-dimension substrate counts all case-linked learning as recorded
  outcome coverage. Reviewed `20261220080002` and
  `StageDimensionSubstratePanel.tsx`: the state is explicitly `recorded`, the
  basis names observed lifecycle results, and the rendered authority boundary
  says visibility is not outcome verification or work authorization. The new
  observation therefore contributes a record, not verified improvement.
- `getLearningEvents` reads all learning types. Its generic feed and derived
  metrics need an explicit compatibility review of the new type, not only the
  project-specific UI. Architectural north-star lesson links currently require
  `lesson_learned`; do not silently present the new subtype as already traversable.

## Revision generalization boundary audit

The existing revision path is CA-specific in more places than its request RPC.
The learning extension must update these contracts together, not merely add a
nullable source column:

- `project_standard_revision_complete` and `guard_project_standard_revision`
  must admit exactly one source (project CA or standard-work observation), retain
  same-tenant identity, exact prior version, immutable content and the canonical
  approval back-reference. Baselines have neither source nor revision metadata.
- `guard_project_procedure_history` currently protects revisions by testing
  `source_project_ca_id`. Extend all three branches (draft insertion, immutable
  history and approved verification) to learning revisions too; otherwise their
  procedure content could change after approval submission.
- `request_project_standard_revision` checks adoption of its predecessor using
  the CA source field. A CA-driven successor of a learning-driven revision must
  still require an adopted predecessor. The new learning request must bind its
  predecessor and language to the observation's exact procedure, not an arbitrary
  selected standard. Rejected attempts remain history, not a stranded baseline.
- The decision path must retain separate requester/approver, canonical approval
  locking, stale-version refusal and one reviewed draft. Learning decisions must
  not update CA strategy/completion fields or claim measured effectiveness.
- Observation capture (`guard_standard_work_observation`) and the form's
  eligible-procedure filter also test the CA source field. Extend their adoption
  check so a learning revision cannot become a new observed baseline while draft.
- Existing project screening/completion intentionally remains CA-specific. A
  positive learning observation must not appear as a failure or close FRACAS.
- Exercise both cross-source chains (CA → learning and learning → CA), rejection
  then retry, self-approval refusal, foreign evidence/source, generic approval
  writes, concurrent requests/decisions and immutable submitted procedure content.

The generalized source guards and learning request/decision paths are implemented
in migrations `20261225190200`–`20261225190400`. The isolated project FRACAS
fixture runs its existing CA workflow against these guards and separately checks
the learning request/reject/retry/adopt path and a CA successor of an adopted
learning revision. The authenticated CI smoke on `8ac4b73` captures execution
against an adopted CA revision and adopts its learning-driven successor, with
concurrent request/decision assertions. This proves the CA-to-learning path
through the authenticated API; the reverse chain currently has isolated SQL
proof only. The authenticated smoke now also requests and adopts a later
failure-driven successor of the learning revision, asserting the original
observation remains conforming; that added check awaits its first CI result.
Browser completion and live acceptance are still required; isolated
fixtures are not substituted for those checks.

## Prior release boundary

#528 merged as `a7620539`; production deployment `36521832377` and all three
Vercel statuses passed. Its authenticated production acceptance remains open:
the available browser exposes public access, not an authenticated tenant session.
Neither D9.05 nor D9.06 is promoted by this investigation.
