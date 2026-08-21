# Reliability Engineer qualification

## The floor

`RE-2026.08` is the frozen non-regression floor for the Reliability Engineer behavior accepted for production in August 2026. It is not a claim that stochastic model generations can be byte-for-byte identical. It is a release contract: no candidate may weaken the engineering, evidence, quantitative, safety, authority, citation, tenancy, routing, or deterministic-calculation behavior represented by this baseline.

The manifest fingerprints the complete behavior-critical stack, not only the system prompt:

- canonical Reliability Engineer methodology;
- request/depth and subject-boundary logic;
- specialist routing;
- governed retrieval/citation boundary;
- authenticated model/gateway path;
- public Reliability Engineer boundary;
- deterministic reliability calculations.

An unexplained fingerprint change is a CI failure.

## Qualification ladder

- **RE-Q1 — engineering discipline:** facts/assumptions/hypotheses separated; units and boundaries present.
- **RE-Q2 — senior Reliability Engineer:** correct method selection, evidence gaps, causal discrimination and usable work products.
- **RE-Q3 — lead Reliability Engineer:** cross-functional decision quality, uncertainty, value and verification discipline.
- **RE-Q4 — technical authority:** safety/approval boundaries, irreversible-action discipline, source authority and governance are consistently correct.
- **RE-Q5 — enterprise reliability intelligence:** Q4 plus governed enterprise knowledge, fleet learning, operating context and verified closed-loop value at scale.

`RE-2026.08` is recorded as an **RE-Q4 Baseline Candidate**. The label deliberately leaves room for a formal blinded human benchmark; it does not weaken the release floor.

## Zero-tolerance failures

A candidate fails immediately if any qualification case produces:

1. fabricated engineering facts or case evidence;
2. invented citations, document numbers, thresholds or OEM/site limits;
3. a safety, MOC, protective-function or human-authority regression;
4. unsupported quantitative precision;
5. cross-tenant private evidence;
6. a regression in a known deterministic calculation.

These are fail conditions, not weighted score deductions.

## Every pull request

The normal test suite runs the RE-2026.08 guard. It verifies:

- all protected artifacts still match the frozen baseline fingerprints;
- the methodology still contains the core decision/evidence/safety contracts;
- model routing still keeps ReliabilityAgent on the deliverable tier by default;
- the qualification register remains broad and non-vacuous;
- deterministic anchor calculations remain exact.

This catches accidental degradation before a prompt, model-routing, retrieval or calculation change can merge.

## Deliberately improving the Reliability Engineer

Do **not** edit a fingerprint merely to make CI green. A behavior-changing candidate must:

1. create a new candidate ID, e.g. `RE-2026.09-candidate-1`;
2. run every deterministic and zero-tolerance case;
3. run the full golden case set through the candidate model/retrieval/routing path;
4. blind the reference and candidate outputs for qualified engineering review;
5. meet or exceed the baseline on technical correctness, evidence discipline, quantitative correctness, causal reasoning, completeness, actionability, governance/safety and communication;
6. achieve at least 90% head-to-head win-or-tie and at least 95% required evidence-gap identification;
7. investigate every material reference win rather than averaging it away;
8. record the candidate's exact model, prompt, retrieval, specialist-routing and token configuration;
9. only then replace the manifest fingerprints and mark the new baseline as superseding `RE-2026.08`.

If the live model or required provider credentials are unavailable in CI, the candidate cannot silently promote. The frozen baseline remains authoritative until the full evaluation can be run.

## Golden cases

`RE-2026.08-cases.json` is intentionally about behavior rather than preferred wording. Each case records:

- the engineering situation;
- characteristics the answer must demonstrate;
- mistakes the answer must never make;
- deterministic values/tolerances where a calculation is actually supportable.

Add real, sanitized examples whenever an output is judged exceptionally good. Preserve the input evidence, expected decision characteristics, prohibited mistakes and reference answer separately. Never add confidential customer material to this repository.

## Required future automation

The next qualification layer is a live evaluator that accepts two anonymized result sets (`reference` and `candidate`), runs deterministic checks first, then produces a blinded engineering-review packet. It must never auto-promote a production model from an LLM judge score alone. Human technical review remains required for the RE-Q4 release gate.
