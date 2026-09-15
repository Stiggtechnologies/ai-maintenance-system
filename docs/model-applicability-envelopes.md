# Governed Model Applicability Envelopes

## Implemented boundary

Every SyncAI engineering model version now carries a machine-readable applicability envelope covering asset type and family, make/model policy, canonical damage mechanisms, duty, environment, data quality, operating ranges, training-population basis, validation dates, revalidation triggers and explicit limitations.

The envelope extends the canonical `model_register`. Mechanisms remain canonical `damage_mechanisms` referenced through `engineering_model_mechanisms`; evidence remains in `evidence_items`; envelope decisions remain in `approvals`; execution and refusals remain in `calculation_runs`; and provenance remains in `audit_events`.

## Review and eligibility controls

- A missing dimension is an explicit gap, never an implied match.
- A model author cannot approve their own envelope.
- The reviewer must be a named administrator or Reliability Engineer.
- Review requires independently verified same-tenant evidence already bound to the exact model version for applicability.
- Approval is pinned to the exact manifest checksum. Changing the manifest or envelope invalidates the review and removes production eligibility.
- An expired validation period refuses production eligibility and execution.
- Rejection removes production eligibility and sends an active production model to revalidation.
- Every approval or rejection is recorded in the canonical approval and audit trails.

## Runtime context gate

The immutable calculation boundary rechecks the canonical asset type and, where applicable, its make/model. It also requires a canonical mechanism binding and checks declared duty, environment and fit-for-use data-quality evidence. Existing port and rule gates continue to enforce input values, units, ranges, missing-data limits, operating state, component category, configuration and excluded conditions.

An unapproved, changed, expired or out-of-envelope context is persisted as a refused calculation with named refusal reasons. It does not produce an answer that downstream users could mistake for a valid result.

## Human-final safety boundary

Envelope approval means only that a model version is eligible to proceed through the rest of its governed lifecycle in the reviewed context. It does not approve a recommendation, change an operating limit, release work, defer maintenance, establish fitness for service or authorize continued operation. Every model result remains advisory and human-final.
