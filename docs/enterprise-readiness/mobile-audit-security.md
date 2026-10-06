# Mobile audit artifact confinement

Status: local regression-tested change; hosted CI, independent review and merge
are required. This is release tooling hardening, not production capability or
tenant-feed qualification.

## Risk and execution contract

The previous `scripts/mobile-audit.mjs` reused `/tmp/mobile-audit` and overwrote
predictable report and screenshot paths. Other local users could pre-create that
directory or its entries. The output can contain authenticated tenant UI data.
CodeQL alert 50 identifies the report write at main commit
`4b48426548390426c0c57e9d9d0fa2e11d466a36`.

Each invocation now atomically allocates an unpredictable `mkdtemp` directory
under the operating system's temporary directory, with owner-only permissions
(`0700` on POSIX). All screenshots and the report are written with exclusive
creation (`wx`) and owner-only file permissions (`0600`). Existing files and
symlinks are refused rather than overwritten. Artifact names are restricted to
single PNG/JSON filenames. No output-directory override or global umask change
is introduced. Windows ACL behavior is not qualified by the POSIX tests.

The browser returns screenshot bytes; it does not write to a supplied path.
The existing report shape, 390×844 viewport, demo-persona scope, 49 routes and
overflow/clipping checks are retained. No canonical asset, evidence, approval,
tenant, audit-event, or engineering model is changed or duplicated.

## Authorized use and honest results

Set `DEMO_EMAIL` and `DEMO_PASSWORD` through the operator's approved local secret
mechanism for an account authorized for this audit. There is no embedded
password or fallback account. Missing or blank credentials fail before browser
launch and artifact creation. Do not use a real customer tenant merely because
credentials are available.

Run `node scripts/mobile-audit.mjs`. The tool logs its unique artifact directory
and report path. Treat screenshots and reports as potentially confidential; do
not attach them to a public PR or upload them without authorization. Artifacts
are retained for the operator; no automated broad deletion is performed.

Sign-in must reach the exact same-origin authenticated workspace. A sign-in
timeout aborts with an `AUTH_FAIL` report instead of silently proceeding.
Redirected routes are `REDIRECTED`, HTTP failures are `HTTP_FAIL`, navigation
errors are `LOAD_FAIL`, and inspection/capture failures abort with `AUDIT_FAIL`.
Diagnostic error strings and credential values are not included in the report.
Both context and browser closure are attempted even if one fails. Cleanup
failure adds an `AUDIT_FAIL` row before the exclusive report write, and rejects
with a fixed sanitized error. Report-write failures also reject with a fixed
error after both closure attempts; a failed report write is never reported as
success. These failures do not reveal provider diagnostics or local file paths
through the CLI error message. A cleanup failure may add a failure row after
the 49 route rows; consumers must inspect all verdicts, not just route count.
The CLI exits nonzero if any route is not `PASS`, or if the audit aborts. A known
intentional redirect is still reported as a redirect, not proof that the
original route's mobile surface passed.

These remain layout heuristics: a `PASS` does not establish correct business
behavior, authorization/RLS, accessibility, source approval, complete route
coverage, production deployment identity, or customer engineering acceptance.
No live production screenshot sweep was run to qualify this change.

## Regression coverage

`src/test/mobileAuditSecurity.test.ts` imports the actual shipped script with
only its browser dependency mocked. Tests exercise real filesystem creation,
permissions, file overwrite refusal, planted symlink refusal and invalid
artifact names. The browser harness covers the full 49-route sweep, explicit
credential failures, failed authentication, redirection, HTTP errors, failed
capture, sanitized reports and resource closure. Screenshot payloads and
credentials in these tests are synthetic, not customer data.

The four cleanup/report-write regression cases were run against the prior PR
implementation: all four failed while the original 16 passed. After correction,
all 20 pass. The cleanup cases use a synthetic provider diagnostic containing a
synthetic credential; neither is allowed in the thrown message or saved report.
The report-write case plants a symlink, proves its target remains unchanged and
proves both resources are closed despite refusal to overwrite the report.

Existing MarkdownRenderer, FieldFailureCapture and booth-fast-path tests are
also run as bounded triage evidence, not substitutes for browser exploit
qualification or a finding-specific security review. No CodeQL alert is
dismissed by this change. Main alert 50 remains open until the fix is reviewed,
merged and a fresh main-branch analysis verifies it.

## Rollback

If this audit tool regresses, stop using it and preserve its private diagnostic
report. Reverting to predictable shared outputs, restoring embedded credentials,
or swallowing authentication failures is not an acceptable rollback. Application
runtime, database migrations, customer data and production deployment are
unchanged.
