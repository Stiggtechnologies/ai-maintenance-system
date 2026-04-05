# Governance Research Program

## Objective

Optimize the governance layer's intelligence — improving how the system explains autonomous decisions, formats audit trails, prioritizes approval queues, and summarizes compliance status for executives.

## Domain

`executive_summaries`

## Mutable Surfaces

- Executive summary generation prompts
- Approval queue prioritization ranking weights
- Decision explanation templates
- Compliance status formatting
- Risk communication wording
- Audit trail summarization prompts

## Fixed Surfaces

- Approval authority rules
- Escalation chain logic
- Audit event creation triggers
- RLS policies
- Decision execution logic

## Success Metrics

### Primary

- **explanation_clarity**: Executive-judged clarity of autonomous decision explanations (0-100, target: > 85)
- **summary_completeness**: Does the executive summary cover all critical areas? (0-100, target: > 80)
- **prioritization_accuracy**: Are the most urgent approvals surfaced first? (0-100, target: > 90)

### Secondary

- **reading_time**: Estimated time to read and understand a summary (target: < 2 min)
- **action_from_summary**: Does the summary clearly indicate what action is needed? (0-100)
- **compliance_gap_detection**: Does the summary highlight compliance gaps? (0-100)

## Benchmark Dataset Structure

```json
{
  "scenario_id": "string",
  "decisions": [{ "type", "confidence", "asset", "action", "risk_score" }],
  "approvals_pending": [{ "entity_type", "priority", "age_hours" }],
  "audit_events_24h": [{ "type", "entity", "actor", "timestamp" }],
  "compliance_status": { "areas_compliant", "areas_at_risk", "areas_non_compliant" },
  "expert_summary": "what a good executive summary looks like"
}
```

## Proposal Strategy

- Start with executive summary generation (highest exec visibility)
- Then improve decision explanation templates
- Then optimize approval queue ranking
- Then enhance compliance status formatting
