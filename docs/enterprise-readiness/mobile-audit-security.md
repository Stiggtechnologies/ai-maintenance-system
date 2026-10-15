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
and planned `report target` before attempting the exclusive report write; that
notification is not proof that a report was saved. Treat screenshots and reports
as potentially confidential; do not attach them to a public PR or upload them
without authorization. Artifacts
are retained for the operator; no automated broad deletion is performed.

Sign-in must reach the exact same-origin authenticated workspace. A sign-in
timeout aborts with an `AUTH_FAIL` report instead of silently proceeding.
Failures during option access, directory allocation, permission setup, output
notification or browser/page creation are controlled by the orchestrator too.
A failure before sign-in navigation is attempted is `SETUP_FAIL`, not evidence
of an attempted authentication failure. If owner-only output was never safely
established, the fixed error does not promise an inspectable report. An allocated
directory left by a permission failure is retained; no report is attempted in
that unqualified location and no broad cleanup is performed.
Redirected routes are `REDIRECTED`, HTTP failures are `HTTP_FAIL`, navigation
errors are `LOAD_FAIL`, and inspection/capture failures abort with `AUDIT_FAIL`.
Diagnostic error strings and credential values are not included in the report.
Both context and browser closure are attempted even if one fails. Cleanup
failure adds an `AUDIT_FAIL` row before the exclusive report write, and rejects
with a fixed sanitized error. Report-write failures also reject with a fixed
error after both closure attempts; a failed report write is never reported as
success. Output callbacks may be synchronous or return a promise. Initial,
route and final notifications are awaited before execution progresses; thrown
errors and promise rejections are sanitized and recorded as failed verdicts
before the report write. A successful report write
followed by a notification failure is not claimed: the final notification occurs
before the write, and a fixed error distinguishes saved report/failed notification
from a failed write. The controlled `runMobileAudit` execution and shipped CLI's
invocation of it do not reveal provider diagnostics or local file paths through
their error messages. Deliberately requested successful output notifications do
include private artifact paths. Direct calls to the low-level filesystem helpers
retain their ordinary filesystem exceptions. Module loading failures, process
startup failures and asynchronous terminal/stream failures outside this execution
boundary are not qualified as sanitized by these tests. A cleanup failure may add
a failure row after the 49 route rows; consumers must inspect all verdicts, not
just route count.
The CLI exits nonzero if any route is not `PASS`, or if the audit aborts. A known
intentional redirect is still reported as a redirect, not proof that the
original route's mobile surface passed.

These remain layout heuristics: a `PASS` does not establish correct business
behavior, authorization/RLS, accessibility, source approval, complete route
coverage, production deployment identity, or customer engineering acceptance.
No live production screenshot sweep was run to qualify this change.

## Regression coverage

`src/test/mobileAuditSecurity.test.ts` imports the actual shipped script with
its browser dependency mocked and bounded filesystem setup fault injection.
Tests exercise real filesystem creation, permissions, file overwrite refusal,
planted symlink refusal and invalid
artifact names. The browser harness covers the full 49-route sweep, explicit
credential failures, failed authentication, redirection, HTTP errors, failed
capture, sanitized reports and resource closure. Screenshot payloads and
credentials in these tests are synthetic, not customer data.

The four cleanup/report-write regression cases were run against the prior PR
implementation: all four failed while the original 16 passed. After correction,
all 20 passed. The cleanup cases use a synthetic provider diagnostic containing a
synthetic credential; neither is allowed in the thrown message or saved report.
The report-write case plants a symlink, proves its target remains unchanged and
proves both resources are closed despite refusal to overwrite the report.

The startup/output-boundary repair was test-first: nine new cases failed against
the prior implementation while all 20 existing cases passed. They include actual
CLI subprocesses exercising the shipped entry point with allocation failure,
permission failure and an initial throwing output callback. No browser is launched
by those subprocesses. That corrected focused suite had 31 passing cases, including
additional pre-authentication page/cleanup and route-notification failure coverage.
The final callback regression checks that a failed verdict is written instead of
an all-PASS report; both browser resource closures are attempted. All fault strings,
credentials, screenshot bytes and directories are synthetic. This does not prove
a live production sweep, production browser startup, or POSIX behavior on Windows.

Independent review then found that a promise-returning output callback was not
awaited. Six additional test-first cases failed against that implementation while
the prior 31 passed. Three actual-script subprocess probes counted escaped async
initial/route/final rejections and the incorrectly saved all-PASS reports. Their
rejection listeners exist only in the disposable synthetic subprocesses; the
production tool does not suppress unhandled rejections. Three deferred successful
callback probes verify that browser launch, later route captures and report
completion wait for their respective notification. The awaited-callback correction
passes all 37 mobile-audit tests, with no escaped callback rejection and with
failed verdicts saved before rejection is returned. These probes use a synthetic
browser harness, not a live browser or provider connection. Detached asynchronous
work that a callback neither returns nor awaits remains outside the callback
promise contract, as do the module-loader and terminal/stream boundaries above.

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
