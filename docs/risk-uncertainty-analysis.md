# Governed uncertainty-aware risk analysis

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
