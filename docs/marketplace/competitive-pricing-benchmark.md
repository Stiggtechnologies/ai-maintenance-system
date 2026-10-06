# Competitive pricing benchmark — outcome-led entry

**Controlled recommendation — 2026-10-06. This record is research and a test
design, not owner approval for a price change, Partner Center mutation, customer
quote, discount, or outcome guarantee.**

## Commercial decision

SyncAI is not being sold as a repository, generic AI assistant, or replacement
CMMS. The acquisition promise is **Unplanned Downtime Reduction**. The first
product customers can use against that promise is the **SyncAI Failure
Investigation Agent**, delivered through the same governed SyncAI platform that
supports evidence, decisions, approvals, recovery coordination, preventive
maintenance decisions, cost tracking, verification, and learning.

The promise and the product must remain distinct:

- **Outcome-led promise:** reduce the recurrence, duration, and economic impact
  of unplanned downtime.
- **Product:** a governed failure-investigation and reliability-decision system.
- **Contracted delivery:** the software and/or bounded proof scope, evidence,
  decision process, actions, owners, approval gates, cost track, and verification
  method.
- **Not guaranteed:** failure elimination, a particular number of avoided hours,
  savings, ROI, prediction accuracy, or production result.

## AI cost-control finding

The first audit was directionally right that the repository already contained
the cost-control foundation. The missing commercial layer now extends those
canonical controls instead of creating a second ledger or quota system:

| Control                                                     | Evidence in the repository                                                              | Status                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Tenant/model/function token ledger                          | `private.llm_usage`                                                                     | Built                                                        |
| Versioned CAD input/output price table with provenance      | `private.llm_prices`                                                                    | Built                                                        |
| Atomic check-and-reserve quota gate                         | `check_llm_quota()`                                                                     | Built                                                        |
| Per-organization quota overrides                            | `private.llm_org_quotas`                                                                | Built                                                        |
| Anonymous public-rail abuse allowance                       | `consume_public_reliability_ip_allowance()`                                             | Built                                                        |
| Decision/case/work cost subject and exact price snapshot    | Extended fields on `private.llm_usage`                                                  | Built on supported runtime paths; unattributed calls exposed |
| Paid Microsoft plan mapped to a commercial period allowance | `apply_ai_commercial_plan_allowance()` and subscription triggers                        | Built; no policy values configured or approved               |
| Production COGS and p50/p95 cost-to-serve report            | `get_ai_unit_economics()`                                                               | Built; no production distribution evidenced                  |
| Pre-activation variable-cost margin gate                    | `evaluate_ai_commercial_plan_policy()` and explicit approval                            | Built; commercial inputs remain owner decisions              |
| Marketplace usage aggregation and idempotent hourly events  | `private.marketplace_meter_definitions` and `public.marketplace_hourly_metering_events` | Built but unconfigured and not live-certified                |
| Paid realtime usage settlement                              | Realtime provider terminal usage                                                        | Missing; paid realtime is therefore blocked                  |

The default 5,184 calls and 22 million tokens per organization per UTC day
remain **abuse caps with engineering headroom**. They are not customer
entitlements, included usage, or evidence that a plan has positive gross
margin. The commercial policy adds a separate calls, tokens, and decision
boundary. Supported runtimes attach model calls to a governed cost object so
several calls can roll up into one decision; unattributed and unknown-price
calls remain explicit in the report and still count against the hard token cap.

The gross-margin gate is a conservative variable-cost gate: it uses the
worst-priced allowed model plus an explicitly supplied non-inference variable
cost. It is not a substitute for a complete company gross-margin model.

No price, allowance, model set, overage rate, non-inference cost, or margin
threshold was seeded or approved. Microsoft activation fails closed when the
approved policy is absent. Direct-channel activation is not yet covered by that
automatic trigger, and remains a named release gap rather than a completed
claim.

The controlled machine-readable record is
[`ai-unit-economics.json`](../../marketplace/ai-unit-economics.json).

## Correct benchmark set

The benchmark has four layers. A vendor can be economically relevant without
being feature-equivalent.

| Layer                                         | Products                                                                             | Why the buyer compares them                                                                                 | Pricing role                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Direct failure-investigation tools            | Causelink, Relyence FRACAS, TapRooT                                                  | Structured investigations, cause analysis, corrective actions, evidence, collaboration, and auditability    | Software-led entry floor                                                                                        |
| Enterprise reliability and APM systems        | IBM Maximo Application Suite, including Condition Insight and Reliability Strategies | Asset health, reliability engineering, condition-based decisions, investigations, and maintenance execution | Recurring platform anchor                                                                                       |
| Downtime-outcome and machine-health platforms | C3 AI Reliability, Siemens Senseye, Augury                                           | Reduced downtime, earlier risk detection, diagnosis, and avoided production loss                            | Buyer budget and enterprise value ceiling; not proof that SyncAI has equivalent sensor or predictive capability |
| Adjacent maintenance systems                  | MaintainX, UpKeep, Fiix, and other CMMS products                                     | Existing maintenance-system budget, work execution, and the alternative of using a general CMMS             | Substitute and price-sensitivity reference only; not the primary price anchor                                   |

### Public evidence anchors

- Causelink publishes US$799 per year for one user and US$6,250 per year for a
  five-user team. Its enterprise tier is quote-based. This is the closest public
  anchor for a narrow software-led failure-investigation entry.
- IBM publishes Maximo Maintenance starting below US$40,000 per year for up to
  25 users. The broader Standard suite, including APM and RCM capabilities, is
  quote-based. This is a useful recurring-platform anchor, not a feature-for-
  feature price.
- C3 AI Reliability, Siemens Senseye, and Augury market enterprise downtime,
  predictive-maintenance, and machine-health outcomes. Their role is to show
  the budget and value category in which enterprise buyers evaluate downtime
  programs. SyncAI must not borrow their sensor, monitoring, prediction, or
  performance claims.
- Public Microsoft Marketplace examples show bounded predictive-maintenance
  proofs ranging from roughly US$15,000 to US$50,000, depending on duration,
  data, equipment, and implementation scope. This supports a mid-market proof
  price but does not validate SyncAI demand or outcomes.

## Price experiments

Run two entrances into one product platform. Do not collapse them into one
buyer claim or infer success from traffic alone.

### Experiment A — software-led entry

| Field                           | Controlled recommendation                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer-facing promise         | Unplanned Downtime Reduction                                                                                                                                                          |
| Product                         | SyncAI Failure Investigation Agent                                                                                                                                                    |
| Entry price                     | US$99 per user per month, or US$89 per user per month on the annual term                                                                                                              |
| Initial quantity                | One to five named users                                                                                                                                                               |
| Five-user annual contract value | US$5,940 monthly-billed or US$5,340 at the observed annual-equivalent rate                                                                                                            |
| Benchmark logic                 | Near Causelink Team's published US$6,250 annual price while adding the broader SyncAI decision, approval, recovery, cost, and verification path where the current product supports it |
| Appropriate buyer               | A reliability or maintenance team with an identified failure problem and enough evidence to begin without a services-led readiness engagement                                         |
| AI usage boundary               | A hard bundled allowance enforced through the tenant quota system; stop or upgrade when consumed                                                                                      |
| Microsoft overage               | Not available under a per-user plan; no automatic token overage may be promised                                                                                                       |
| Publication boundary            | Appropriate only after an approved hard-stop plan policy, measured cost validation, and pre-publication verification                                                                  |

This recommendation preserves the currently observed Starter draft price as an
A/B-test candidate. It does not approve that price, and it is not commercially
safe with the repository's default abuse cap as its allowance. Microsoft makes
Marketplace metered billing available only to flat-rate SaaS plans, not
per-user plans.

### Core SaaS commercial architecture — decision required before publication

The governed SyncAI platform has variable model cost and is sold around a
site/outcome workflow rather than a repository or a seat alone. Its recommended
Marketplace architecture is therefore an offer-wide **flat-rate base fee with a
defined included allowance and a metered overage dimension**. The exact base
fee, commercial unit, included quantity, overage price, and model-routing policy
remain owner decisions and must not be invented from the engineering abuse
caps.

Microsoft requires every plan in a SaaS offer to use the same pricing model.
Marketplace metering is an extension of flat-rate pricing and does not apply to
per-user pricing. The current observed per-user draft and the repository's
already-built meter therefore do not fit together. Resolve that mismatch before
publication; it cannot be treated as a post-launch cleanup.

### Experiment B — outcome-led proof

| Field              | Controlled recommendation                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Offer              | Unplanned Downtime Reduction Proof                                                                                                      |
| Delivery vehicle   | Existing bounded Reliability Intelligence Assessment or Industrial Decision Proof of Concept contract, selected from customer readiness |
| Standard reference | US$35,000 fixed, normally six to eight weeks                                                                                            |
| Scope              | One named site, failure family, decision portfolio, or other explicitly bounded problem; final scope is the signed order                |
| Required economics | Customer-validated baseline, counterfactual, proof investment, observed and verified value, payback, and expansion decision             |
| Exit               | Go, change, hold, or stop; no automatic subscription expansion                                                                          |

The existing US$35,000 reference sits inside the public proof-market range and
is the recommended outcome-led acquisition test. It is not a SaaS plan price.

## Expansion bands

These are planning bands for sales-model and ARR testing, not approved list
prices or binding quote authority.

| Expansion stage       |     Target recurring band | Required evidence before quoting                                                                                                         |
| --------------------- | ------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Production site       |  US$60,000–US$100,000 ARR | Accepted proof, named production scope, enforceable entitlements, support boundary, value hypothesis, and implementation plan            |
| Multi-site or network | US$150,000–US$300,000 ARR | Site-level adoption and outcome evidence, reusable deployment pattern, named rollout owners, and gross-margin review                     |
| Enterprise standard   |           US$300,000+ ARR | Multi-site renewal/expansion evidence, enterprise controls, approved service levels, security/legal acceptance, and executive value case |

The route to US$100M ARR is expansion, not a large population of isolated
US$99 seats. The working portfolio math is 1,000 customers at US$100,000 ARR,
500 at US$200,000 ARR, 250 at US$400,000 ARR, or a blended equivalent. The
entry agent must therefore produce verified production expansion, not merely
low-value activations.

## Value and cost track

Every outcome-led proof must record these separately:

1. customer-validated baseline downtime hours, events, recovery duration, and
   maintenance/recovery cost;
2. the customer's approved economic value per downtime hour or event;
3. the addressable subset and counterfactual;
4. proof and implementation investment;
5. observed result, attribution confidence, and material confounders;
6. independently verified result, payback, and annualization method; and
7. the customer-owned expansion decision.

A useful calculation is:

```text
verified annual economic value =
  verified avoided downtime hours × customer-approved value per hour
  + verified maintenance and recovery cost delta
  - verified offsetting costs
```

Projected value and verified value must never be combined. A future value-based
price can be tested only after SyncAI has repeatable verified-outcome evidence,
and should be a bounded share of value with a contractual floor, cap, attribution
method, and dispute process.

## Experiment scorecard

Choose between or combine the entrances using:

- qualified-opportunity rate and cost per qualified opportunity;
- proof close rate, sales-cycle duration, and time to first governed decision;
- proof acceptance and recurring conversion rate;
- first-year ACV, gross margin, and implementation effort;
- retained weekly decision activity and named-human approvals;
- verified customer value and time to payback;
- site-to-multi-site expansion, renewal, gross retention, and net revenue
  retention; and
- support burden, security exceptions, and unresolved product gaps.

Clicks, sign-ups, generated investigations, or model output alone do not select
a winner.

## Approval and Marketplace control

- No value in this record authorizes a Partner Center price, visibility,
  quantity, term, discount, private offer, or publication change.
- Keep Starter, Professional, and Enterprise plan observations separate from
  recommendations and dated owner approvals.
- The software-led and outcome-led entrances must carry distinct attribution
  and converge on the same canonical organization, evidence, decision, approval,
  value, and learning records.
- The release owner must approve the exact public plan before a Partner Center
  mutation. Professional and Enterprise expansion should remain private until
  entitlement enforcement, cost-to-serve, proof conversion, and support capacity
  are evidenced.
- Do not use the 5,184-call or 22-million-token engineering abuse caps as a
  commercial allowance.
- Describe per-decision cost only for supported attributed runtime paths, and
  disclose unattributed calls separately.
- Do not enable Microsoft metering until an approved flat-rate plan, immutable
  dimension, included allowance, overage price, entitlement binding, and
  protected-preview certification all exist.

## Sources

- [Causelink pricing](https://www.causelink.com/pricing)
- [Relyence pricing request](https://relyence.com/pricing-request/)
- [IBM Maximo pricing](https://www.ibm.com/products/maximo/pricing)
- [IBM Maximo asset performance management](https://www.ibm.com/products/maximo/asset-performance-management)
- [C3 AI Reliability](https://c3.ai/products/applications/c3-ai-reliability)
- [Siemens Senseye Cloud Application](https://www.siemens.com/en-gb/products/industrial-digitalization-services/senseye-cloud-application/)
- [Augury Machine Health](https://www.augury.com/lp/critical-equipment/)
- [Microsoft Marketplace: US$50,000 ten-week predictive-maintenance proof](https://azuremarketplace.microsoft.com/en-us/marketplace/consulting-services/affineanalyticspvtltd1595517788010.sol-59467-igu)
- [Microsoft Marketplace: CA$25,268 four-week predictive-maintenance proof](https://azuremarketplace.microsoft.com/en-us/marketplace/consulting-services/hanu.predictive_maintenance_mfg)
- [Microsoft SaaS metered billing requirements](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/saas-metered-billing)
- [Plan a SaaS offer for Microsoft Marketplace](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/plan-saas-offer)
