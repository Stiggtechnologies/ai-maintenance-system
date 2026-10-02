# Governed recommendation evidence provenance

SyncAI recommendations use the canonical `evidence_items` store. This slice adds a recommendation-specific basis classification without creating a second evidence system or replacing the existing eight `evidence_class` provenance forms.

## Two independent classifications

- `evidence_class` describes the form: measured, inspected, calculated, tested, documented, historical, expert judgement or AI inference.
- `recommendation_evidence_level` describes the basis by which that item supports a particular recommendation: verified measurement, approved inspection, confirmed history, engineering calculation, OEM recommendation, industry reference, similar-asset inference, expert judgment or AI hypothesis.

Neither vocabulary is an ordinal trust score. The evidence level does not alter `verification_status`. In particular, classifying an AI hypothesis does not make it verified evidence.

## Confidence and refusals

The recommendation workspace calls the canonical `compute_evidence_confidence` function. A tenant-adopted Q × A × F × V profile produces the score and travels with it. If a factor or adopted profile is missing, the named refusal is displayed rather than replaced with a default confidence.

## Exact evidence packets

Each recommendation exposes linked evidence as supporting, contradicting or context, together with source system, reference, revision, source date, applicability, verification state and confidence/refusal. Decision-relevant gaps are recorded as `missing_evidence`; they are never fabricated as evidence rows.

Submitting a completeness assessment hashes the exact recommendation evidence packet. A different authorized human reviews that digest. Adding or changing evidence after validation makes the packet visibly `stale` and requires reassessment.

## Authority boundary

Classification review validates the level, claim role and recorded source applicability. Packet review validates that the exact conflicts and declared gaps were considered. Neither action verifies an unverified source, approves the recommendation, releases work, accepts risk, commits spend or authorizes operation. Existing recommendation and work-control approvals remain authoritative.

## Customer path

Open Mission Control, select **Evidence** on a recommendation, and use the recommendation evidence drawer. Authorized governance and engineering roles can submit classifications and completeness packets. Authors cannot independently review their own submission.

## Runtime acceptance

`scripts/ci-recommendation-evidence-provenance-smoke.sh` proves all nine levels, conflict and gap visibility, computed confidence or named refusal, independent review, exact-digest staleness, tenant isolation, direct/service-role mutation refusal, canonical approvals/audit and unchanged operational authority against a fresh migration chain.
