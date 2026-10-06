# Governed uncertainty-aware risk analysis

**2026-10-06 — PARTIAL, CURRENT-MAIN DRAFT COMPOSITION; NOT RELEASE QUALIFICATION.**

The sections below describe the retained draft scope and intended customer
workflow, not a production-completion claim. The bounded client, backend/CI and
finite-input repairs were independently source-reviewed at local checkpoints
`a5fa94ac`, `b7c55d88` and `3a266066`. Their owned feature paths are selectively
composed on main `0e3ef27d`; unrelated stacked workstreams and historical register
claims are not imported. The composition passes 1,362 local tests in eight files,
including the current-main tenancy and definer guards, and application TypeScript
using the existing Vitest 4.1.10 runtime. No new native PostgreSQL, real HTTP,
concurrent-session or production qualification has run for these repairs.

Publication remains a draft, not approval to ship the full U18 family. The old,
unapplied `20270101960000` draft is replaced in this composition by the forward
`20270103050000` migration, ordered after #561 and all published open migration
heads inspected during preparation. Migration ordering must be rechecked before
publication. The final-chain policy test first failed in three cases and now
passes: the one restrictive audit gate retains its five existing event families
and adds both uncertainty families. Current-main shared security assertions are
inherited unchanged; no historical weaker or failing guard was copied. These
source-policy checks do not establish database runtime isolation.

Independent composition review also identifies a retained client gap: the panel
scope includes risk, actor and role, but not current organization identity.
Same-actor/same-role tenant changes therefore require coordinated canonical
tenant-context wiring and late-read/late-acknowledgment tests before release.
The page's optional authentication context is not proof that this gap is closed.

Remaining qualification includes ancestor/stakeholder privacy and actual
post-wait authority races; typed source approval, claim purpose and supersession
eligibility; stronger content/source and current-threshold digest standing;
authorized stale-pending replacement with retained history; native execution of
finite/object/date refusals; and parity with the canonical unrounded
value-of-information sign.
An ordinary verified evidence item is not proof of source approval or fitness
for every claim. A child-row lock plus a fresh visibility check does not freeze
ancestor or stakeholder permissions. Neither local source tests nor the
contained baseline harness establish those broader guarantees.

The subsequent local finite/object/date phase passes 109 focused source,
client and containment tests after independent review. Its additive native
transcript specifies 84 exact refusals with full artifact preservation and
three rollback-only timezone compatibility controls. Those PostgreSQL cases
have **not** executed; neither their presence nor the source tests clear native
qualification or the remaining digest, replacement, standing and VOI gaps.

SyncAI U18.02 adds versioned uncertainty packets to the canonical Risk Operating System. It supports bounded probability estimates, confidence intervals, best/expected/worst loss cases, ranked one-at-a-time sensitivity inputs, value-of-information analysis, adopted decision-threshold snapshots and measurable reassessment triggers.

It does not add a second risk register, evidence store, approval queue or audit ledger. Each packet belongs to a canonical `risks` record, cites canonical `evidence_items`, records its human disposition in `approvals`, and writes its lifecycle events to `audit_events`.

## Control model

- Only named engineering or management roles can submit or review a packet.
- The risk must use an adopted criteria profile with non-empty decision thresholds. The exact threshold JSON is copied into the packet so later criteria changes cannot silently rewrite the historical basis.
- Every cited item must already be verified, belong to the same organization and link to the exact risk. Unverified evidence remains visible in the workspace but is ineligible for submission.
- The server validates ordering and bounds and derives both the sensitivity ranking and value-of-information result. Client calculations are previews only.
- A SHA-256 digest freezes the packet, threshold snapshot and cited-evidence provenance. Changes to cited evidence make the packet visibly stale and prevent review.
- One pending-review packet per risk prevents competing review candidates. A new version is required after review or rejection.
- The author cannot review their own packet. Independent review validates the analysis packet; it does not verify an unverified source.
- Reviewed inputs are retained and immutable. Direct writes, deletes, truncation, anonymous access and service-role RPC bypass are refused.

## Authority boundary

Validation confirms that an independent named human reviewed the exact method, source basis, ranges, confidence interval, loss cases, sensitivity ranking, value-of-information calculation, adopted thresholds, reassessment triggers and evidence digest.

Validation does not accept risk, authorize operation, release work, approve a treatment, commit spend or certify that a source claim is true. A validated packet creates an unverified `CALCULATED` evidence item for downstream traceability; it does not promote that derived item to verified evidence. Risk decisions and risk acceptance continue through their existing governed workflows.

## Analytical scope

This slice provides transparent structured ranges and one-at-a-time sensitivity ranking. It does not claim Monte Carlo simulation, fitted probability distributions, correlated-variable modelling or a statistically derived confidence interval. Teams must name the method and basis used, cite the inputs, and state when the analysis must be reassessed. More advanced stochastic methods can later write a new version through the same controlled contract.

## Customer workflow

1. Open a risk in the Risk Operating System and inspect the adopted threshold snapshot.
2. Verify the risk-specific source evidence through the canonical evidence workflow.
3. Enter sourced probability, confidence, loss-case, sensitivity and value-of-information inputs without relying on software defaults.
4. Select eligible evidence and submit the exact packet digest for independent review.
5. A different authorized human validates or rejects the packet with a substantive basis.
6. If evidence provenance changes, the workspace reports the analysis as stale and requires a new version.

The workspace always displays `operationalAuthorization: false` to preserve the boundary between analysis quality and accountable operational authority.
