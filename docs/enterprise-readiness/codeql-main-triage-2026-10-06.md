# Current-main CodeQL triage — 2026-10-06

Status: findings remain open. A successful scanner run is not a clean security
assessment. No alert has been dismissed, no production release is approved,
and no capability register has been promoted by this triage.

## Authoritative baseline

- Main: `4b48426548390426c0c57e9d9d0fa2e11d466a36`.
- [CodeQL run 37401590941](https://github.com/Stiggtechnologies/ai-maintenance-system/actions/runs/37401590941), attempt 2.
- Analysis ID `1899059340`, `refs/heads/main`, 201 rules, 34 results, empty
  analysis error; created `2026-10-06T08:02:01Z`.
- Fresh main-ref alert API and analysis SARIF agree: 11 high-security findings,
  13 medium-security findings, and 10 non-security quality findings.

The existing advanced CodeQL workflow had previously skipped analysis because
`CODEQL_ENABLED` was not set. The public repository's variable was enabled and
the existing workflow re-executed without changing source, visibility, billing
or merge protections. The original skipped run remains historical evidence.
The separate PR #637 scan's zero PR-ref alerts does not clear these main findings.

## Finding-specific next actions

Numbers below identify GitHub code-scanning alerts, **not pull requests**.
Ownership is by area, including draft PRs; a different filename is not
permission to implement around an active workstream.

| Alert(s)                   | Location and current evidence                                                                                                                                                                                                                                                          | Required disposition                                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 50                         | `scripts/mobile-audit.mjs:95`: predictable shared temp path with overwriting report write; screenshots use the same directory.                                                                                                                                                         | Implemented in the separate mobile-audit artifact-confinement workstream. Private unique directory, exclusive writes, explicit credentials and honest execution reports are tested. Requires hosted analysis/review/merge before main closure.   |
| 40                         | `MarkdownRenderer.tsx:76`: SARIF traces user-entered chat text through markdown links and the leading-slash branch of `safeLink` to `<a href>`. React text nodes are escaped; `javascript:` is refused by current tests. However `//host` and `/\\host` pass the leading-slash branch. | Coordinate with #569/#603. Test URL normalization, control characters, scheme and authority confusion in actual browser context; preserve valid evidence links. No demonstrated XSS or false-positive dismissal claimed.                         |
| 46                         | `FieldFailureCapture.tsx:130`: SARIF traces the selected file through `URL.createObjectURL` to `<img src>`. Source has no MIME/size validation and does not revoke replaced object URLs.                                                                                               | Coordinate with #608. Qualify image decoding/context and object-URL cleanup with hostile uploads; preserve governed tenant attachment RPCs. Blob taint alone does not prove script execution.                                                    |
| 47, 48                     | `sync-investigation-runtime/index.ts:616,667`: DOCX/PPTX XML text extraction strips tags with a regex. These are text-extraction operations, not an established HTML sanitizer.                                                                                                        | Coordinate with #569/#603/#608. Trace all sinks and verify text-only rendering, untrusted-evidence handling and bounded archive expansion. Do not add a cosmetic replacement loop and claim malicious-document containment.                      |
| 42                         | `boothFastPath.ts:31`: overlapping regex alternatives; `isShortSocialTurn` first refuses inputs of 40 or more trimmed characters.                                                                                                                                                      | Coordinate with #603. Measure adversarial inputs within the actual bound, and preserve real reliability questions on the governed path. Scanner warning alone does not establish an exploitable unbounded DoS.                                   |
| 53, 54                     | `sync-tts-contract.test.ts:40,41`: negative substring assertions over source text, not an allowlist used to approve URLs.                                                                                                                                                              | Finding-specific security review; preserve or strengthen the source guard. Do not anchor a negative substring search merely to silence the scanner.                                                                                              |
| 55, 56                     | `developSlice3dMigration.test.ts:646,647`: negative source assertions rejecting hardcoded provider hosts, not URL validation.                                                                                                                                                          | Same disposition; Develop/model-provider area coordination required. Adding anchors could weaken detection of provider URLs inside source.                                                                                                       |
| 49                         | `developSlice5cMigration.test.ts:246`: replaces the one apostrophe in a fixed expected SQL-message literal. No caller-controlled SQL is executed by the assertion.                                                                                                                     | Verify fixed-input scope and retain exact tenancy assertion; do not confuse it with a production SQL escaping utility.                                                                                                                           |
| 43, 44, 45                 | `developFieldReadinessEvidenceMigration.test.ts:62`: three identity replacements in construction of a policy-name assertion.                                                                                                                                                           | Test cleanup in owned Develop area, preserving coverage of all three tenant-scoped stores and their RLS.                                                                                                                                         |
| 52                         | `azure-marketplace-preview-certification.ts:460`: network-derived data written into a certification artifact.                                                                                                                                                                          | Review provenance, bounds, artifact path trust and secret redaction in the existing Marketplace certification contract. Intentional evidence capture does not automatically make it safe.                                                        |
| 51                         | `audit-material-production.mjs:17`: local file data sent in an outbound request.                                                                                                                                                                                                       | Coordinate with #592; prove destination, authorized data scope, read-only execution and credential handling before live use.                                                                                                                     |
| 36, 32                     | `run-reliability-qualification.ts:420` and `check-reliability-baseline.mjs:217`: file-to-network paths in qualification/provenance tooling.                                                                                                                                            | Protected Reliability Engineer area: do not change the harness or floor without required requalification/approval. Establish exact data and destination before finding disposition.                                                              |
| 29                         | `run-reliability-qualification.ts:704`: provider-derived output written into a qualification artifact.                                                                                                                                                                                 | Same protected tooling contract; verify artifact integrity and redaction without weakening immutable machine-report provenance.                                                                                                                  |
| 5, 6                       | `ingest_reliability_kb.mjs:58,98`: manual CLI reads a JSONL file, sends text to Gemini, then upserts to a supplied Supabase URL.                                                                                                                                                       | Coordinate with #569/#571. Verify source approval and destination/data-egress authorization. Intended ingestion is not proof of tenant-approved egress.                                                                                          |
| 1, 2, 3                    | AWS webhook/resolve and Salesforce licensing entrypoints return caught error text. Current deployment allowlist does not include these functions; actual production deployment is not established.                                                                                     | Marketplace backend review must cover error exposure together with authentication, stable idempotency, lifecycle updates and tenant binding. Do not deploy unqualified prototypes or claim purchasing certification from an error-message patch. |
| 10, 13, 14, 15, 16, 17, 22 | Unused imports/variables in AssetDetail and legacy billing/document/health/edge/gateway/RAG modules.                                                                                                                                                                                   | Quality triage, preserving useful code and honest deployment posture; no bulk deletion or inferred production reachability.                                                                                                                      |
| 31                         | `RiaAssessmentWorkspacePage.tsx:280`: a conditional flagged as always false.                                                                                                                                                                                                           | RIA error-handling behavior review; a successful build is not failure-path qualification.                                                                                                                                                        |
| 57, 58                     | `ReliabilityEngineerPage.tsx:722,777`: unused local UI functions.                                                                                                                                                                                                                      | Coordinate with protected Reliability Engineer/UI ownership; no bulk removal based only on this scan.                                                                                                                                            |

## Bounded validation versus unresolved proof

Existing MarkdownRenderer, FieldFailureCapture and booth-fast-path test suites
pass locally alongside the new mobile-audit security tests (33 tests across four
files). They are narrower than exploit qualification and do not justify
dismissing the application alerts. Fresh head inspection showed the flagged
renderer/runtime lines unchanged in #569 and the field preview unchanged in
#608; merely merging those PRs is not proof that these findings disappear.

The mobile artifact writer's sensitivity check temporarily removed exclusive
creation in this worktree: the overwrite and planted-symlink tests both failed.
Restoring `wx` restored all 16 mobile-audit tests. Synthetic fixtures were used,
not production credentials, customer screenshots or live network requests.

No real tenant feed, Microsoft preview purchase, external certification,
canonical engineering approval, or live model qualification is demonstrated by
this report. Completion requires verified remediation or finding-specific
review, followed by exact-commit hosted and production evidence where relevant.

The query context was checked against primary
[CodeQL DOM-XSS guidance](https://codeql.github.com/codeql-query-help/javascript/js-xss-through-dom/)
and [temporary-file guidance](https://codeql.github.com/codeql-query-help/javascript/js-insecure-temporary-file/).
Neither source grants permission to dismiss an alert without tracing its actual
source, sink and execution context.
