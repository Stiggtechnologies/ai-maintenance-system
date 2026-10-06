# Conditional survival sampling-confidence contract

**Draft; C7.14 remains yellow.** Mathematical qualification is not customer
predictive calibration, engineering applicability, independent review or
production acceptance. This document describes the declared method, not a
claim that the current draft has shipped to production.

## What the calculation means

The existing server derives a complete component-life population from canonical
assets, installations, meters, life events and independently approved evidence.
It fits the pinned Efron Cox model without dropping incomplete lives and derives
the conditional cumulative hazard over the exact `(origin, horizon]` window.
The point probability remains a numerical scenario, not a qualified live-asset
forecast. Future measurements and unsupported condition persistence are refused.

`cox-joint-asset/1/draft` combines the direct baseline and coefficient effects
for each canonical physical asset. An asset's full path influence is summed
before squaring; path pieces are not assumed independent. The variance is the
sum of squared full asset influences. Repeated component lives on one asset do
not establish independent clusters. Missing, extra, single or numerically
singular asset maps refuse this uncertainty while preserving an otherwise valid
point estimate.

For positive resolvable conditional hazard `H` and full joint variance `V`,
`cox-model-confidence/1/draft` declares a pointwise log-hazard delta transform:

```text
z = qnorm(0.975) = 1.9599639845400536
w = z * sqrt(V) / H
lower hazard = exp(log(H) - w)
upper hazard = exp(log(H) + w)
failure bounds = -expm1(-hazard bounds), in the same order
survival bounds = exp(-hazard bounds), in reverse order
```

The confidence level is nominal 95%, not a statement of achieved coverage.
These are sampling-confidence bounds for the model's conditional probability,
not a future-event prediction interval, simultaneous confidence band,
remaining-useful-life limit, OEM specification or maintenance threshold.
Independent-asset adequacy, PH/model suitability, applicability, representative
sampling and held-out customer calibration still require qualification.

The transform follows the log-cumulative-hazard basis described in the
[R survival documentation](https://stat.ethz.ch/R-manual/R-devel/library/survival/html/survfit.formula.html).
The nominal quantile is independently obtained using R's
[normal quantile function](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/Normal.html).
The retained full case-weight variance is deliberately **not** substituted with
the different `survfit` variance convention. No package implementation source is
copied into the application.

## Qualification evidence

`qualify-cox-uncertainty-reference.mjs` retains actual full R Efron fits under
three physical-asset case-weight perturbations, complete input hashes and every
asset influence. `qualify-cox-confidence-reference.mjs` was actually executed
using the existing isolated WebR 0.6.0 / R 4.6.0 runtime. It applies R's quantile,
logarithm, exponential and stable probability transforms to all 25 retained
constant and known-at-origin piecewise scenarios across three synthetic cohorts.

`cox-confidence-reference.json` pins the exact uncertainty input artifact by
SHA-256, actual R version, critical value and each independent bound.
`cox-confidence.test.ts` compares all transformed log/hazard/probability bounds
and the application's retained complete-cohort results, checks endpoint order
and complementary failure/survival bounds, and covers numerical refusals.
The synthetic three-asset browser fixture's calculation is checked separately
from its single-asset refusal. Neither fixture proves customer coverage or real
authenticator enrollment.

## Numerical and retention boundaries

No-event windows, nonpositive/nonfinite hazard or variance, unresolvable width,
exponentiation overflow/underflow and probability boundary saturation do not
produce precise-looking zero-width or clipped 0%/100% confidence bounds. The
point scenario is retained separately and bound refusal is recorded explicitly.
There is no fallback to coefficient-only, model-based or independently summed
path-piece variance.

The authenticated calculation service writes bounds and refusals to the existing
immutable `calculation_runs` ledger through `record_survival_calculation`, with
the original source snapshot, approvals and canonical input references. No new
ledger, table, queue, approval path or model-monitoring store is introduced.
Historical receipts without bounds are displayed as missing; reads never
recompute or retrofit them. Historical refusals remain refusals.

The existing `confidenceInterval: null` field remains null because no predictive
interval is qualified. Model sampling-confidence output is retained separately
under `predictionUncertainty.modelConfidenceBounds`; its
`coverageValidated` and `futureEventPredictionInterval` flags remain false.
`calibration: unqualified`, `liveAssetForecast: false`, advisory-only authority,
tenant isolation, source freshness and named-human approval rules are unchanged.
Nothing here changes PM intervals, releases work, accepts risk, spends money,
changes operating limits or authorizes return to service.

## Remaining acceptance

Fresh exact-head migration/browser gates, independent architecture/security/domain
review, customer applicability and predictive calibration, parent-stack
integration, merge and production verification remain required. Three synthetic
cohorts are not high-dimensional or fleet-scale load qualification. Disabling
this draft surface must preserve the canonical source, approval, calculation and
audit history; rollback must not rewrite existing receipts.
