# D9.06 — standard-work learning acceptance plan

Status: accepted implementation; D9.06 is promoted with the forward outcome
contract in `20261231100000`. The canonical observation, learning revision and
separate-human adoption path shipped previously; the final repair separates an
outcome from its attribution boundary and requires a finite value plus unit for
quantitative observations. Legacy combined text is retained exactly as a
qualitative observation and attribution boundary—no measurement is inferred.
Promotion remains coupled to the branch's full CI, migration-chain, browser and
deployment gates; capture or adoption still does not claim measured improvement.

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
in migrations `20261225190200`–`20261225190400`. The rollback fixture covers
request/reject/retry/adopt and immutable history. The authenticated full-chain
smoke proves both CA→learning and learning→CA transitions, concurrent requests
and decisions, while asserting that the original conforming observation is never
relabelled as a failure. Browser coverage performs the observation write, reload,
revision request and separate-session human decision; isolated fixtures are not
substituted for those checks.

## Acceptance reconciliation

- Migrations `20261225190000`–`20261225190400` implement the canonical
  observation-to-adoption chain; `20261231100000` adds the explicit outcome kind,
  quantitative value/unit contract and independent attribution limit.
- `scripts/ci-project-fracas-smoke.sh` exercises authenticated tenant/refusal,
  qualitative and quantitative capture, CA→learning→CA lineage, concurrency,
  separate-human adoption and immutable history against the full migration chain.
- `tests/e2e/project-fracas.spec.ts` performs the customer write, reload, source
  inspection and separate-browser approval on the reachable Realize surface.
- Static, service and component tests pin the schema, receipts, read model and
  honest UI language. The register evidence deliberately stops at observed and
  adopted states; verified improvement needs later evidence and is not inferred.
