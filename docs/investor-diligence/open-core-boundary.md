# Product and future open-core boundary

Current decision: no SyncAI code is authorized for new public release. The
current repository and all new revisions are proprietary unless a future file
or repository expressly states otherwise with owner and counsel approval.

## Proprietary core

Keep the following private by default:

- Customer-facing application code and user experience.
- Reliability reasoning, risk scoring, recommendations, evaluation data, and
  workflow orchestration.
- Integrations, tenant isolation, authorization, billing, marketplace,
  production deployment, and operational controls.
- Proprietary datasets, asset models, prompts, benchmarks, customer
  configurations, and implementation documentation.
- Brand assets, sales material, customer information, secrets, and incident
  records.

## Potential future public layer

If strategically useful, a small interface-only layer could later be reviewed
for publication: SDK types, API examples, import/export schemas, a CLI client,
or non-sensitive integration adapters. Nothing in that category is currently
approved. Publication requires a clean-room provenance review, security review,
trademark guidance, dependency/license review, support policy, and explicit
outbound license decision.

## Boundary test

A component may be considered for publication only if releasing it would not
expose customer data, security architecture, credentials, differentiated model
or workflow logic, proprietary training/evaluation material, contractual
confidential information, or a dependency whose terms conflict with the chosen
license. When uncertain, keep it private and escalate to the product owner and
counsel.

The prior public MIT history remains available to anyone who lawfully retained
it. Future open-core strategy should be evaluated on commercial merit; it
should not be used to blur or rewrite that historical boundary.
