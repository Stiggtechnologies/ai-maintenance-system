# Benefits and value leakage

SyncAI now separates four questions that are often collapsed into one optimistic
number: what benefit was expected, what the latest observation forecasts, what
a human has verified as actual, and where any loss of approved value is
evidentially attributed.

## Canonical model

- `value_metrics` remains the one benefit, checkpoint, lifecycle-value and
  leakage-attribution store.
- The approved `development_baselines` BENEFITS snapshot supplies sanctioned
  value. A user cannot type a replacement sanction value into the trajectory.
- Realized value is the latest human-verified realization checkpoint for each
  recorded benefit. An observation is a forecast until verification.
- Every manually recorded lifecycle point and attribution references
  `evidence_items` and enters `audit_events`.
- `verify_value_metric` remains the one authorization loop. For trajectory and
  leakage records, the verifier must be an authorized person other than the
  author.

## Six points and seven buckets

The six lifecycle points are original, design, sanction, execution forecast,
startup and realized. Original, design, execution forecast and startup are
recorded from evidence. Sanction and realized are derived from their canonical
approved and verified sources.

The seven attribution buckets are scope, cost, schedule, reliability, ramp-up,
operating cost and market assumption. Each recorded amount declares whether
the relationship is causal or contributing and states its evidence-backed
basis. Any remainder is displayed as unattributed; SyncAI never spreads it
across the buckets to make the ledger balance.

## Refusal and decision boundary

The calculation refuses mixed-unit approved benefits and names absent or
unit-mismatched lifecycle points. Independent verification refuses a bucket
revision that would make current verified allocations exceed positive
approved-to-realized leakage. A value gain remains a gain, rather than being
clamped to zero leakage.

Completeness means the records needed for the comparison exist and were
verified. It does not prove causation, approve an investment, select an
intervention or authorize an operational change.
