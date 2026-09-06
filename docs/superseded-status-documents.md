# Superseded status documents

On 2026-08-20 twenty-four top-level Markdown files were deleted. This note
records what they were and why, so that a link to one of them leads somewhere
rather than nowhere.

## What they were

`AUTONOMOUS-MVP.md`, `MVP-COMPLETED.md`, `MVP-COMPLETION-STATUS.md`,
`PRODUCTION-READY.md`, `STATUS-REPORT.md`, `FINAL-AUDIT-REPORT.md`,
`OPERATIONAL-COMPLETION-REPORT.md`, `PHASE2-VALIDATION-REPORT.md`,
`PREMIUM_CUSTOMER_JOURNEY_DEPLOYED.md`, `PRODUCT_AGENT_SUMMARY.md`,
`CUSTOMER_INFRASTRUCTURE_ROADMAP.md`, `ISO-55000-IMPLEMENTATION-SUMMARY.md`,
`MICROSOFT-COPILOT-FEATURES.md`, `BILLING-IMPLEMENTATION.md`,
`STRIPE-INTEGRATION-GUIDE.md`, `RAG-TRAINING-GUIDE.md`,
`AI-AGENT-TRAINING-GUIDE.md`, `TRAINING_MATERIALS_OUTLINE.md`,
`README-STAKEHOLDER.md`, `SYNC_AI_PRODUCT_IMPLEMENTATION_PLAN.md`, and the four
`JAVIS-*.md` files.

## Why they were removed

They asserted a shipped state that the codebase does not support, in the
vocabulary a reader trusts most: "100% COMPLETE", "PRODUCTION-READY", "FULLY
OPERATIONAL", "FULLY IMPLEMENTED". The capability register — audited the same
week — recorded 399 items of which 40 were absent and 190 partial, and the
reachability gate added in that audit demoted 68 further items from ✅ to 🟡
after finding they were schema and a read panel with no way for a customer to
create a record.

Both statements cannot be true. One of them was written by a program that
counts and is checked on every commit; the others were written once and never
revisited.

The four `JAVIS-*.md` files describe a subsystem that no longer exists —
`javis-orchestrator` was retired, and migration 20260911090000 notes that its
last query referenced columns the live schema does not have.

They were deleted rather than bannered. A banner leaves the claim on the page
and adds a caveat above it, and the claim is what gets quoted. These documents
were the most likely thing for a buyer, an auditor or a new engineer to read
first, and every one of them would have been misled.

## What replaces them

- **[`docs/enterprise-readiness/capability-register.md`](enterprise-readiness/capability-register.md)**
  is the program of record: 399 enumerated items, each with a status and
  evidence, protected by a ratchet (`npm run register:check`) and by the
  reachability gate (`src/test/capability-reachability.test.ts`), which fails
  the build when a ✅ cites code that no surface can reach.
- Operational runbooks were kept: `DEPLOYMENT.md`, `DEPLOYMENT-CHECKLIST.md`,
  `PRODUCTION-CHECKLIST.md`, `SECURITY.md`, `SECRETS.md`, `ACCESS-GUIDE.md`,
  `FEATURE-ACCESS-MAP.md` and the two quick-start guides. Those describe how to
  do something, not what has been achieved.

The full text of every deleted file remains in git history.
