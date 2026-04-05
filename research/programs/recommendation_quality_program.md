# Recommendation Quality Research Program

## Objective

Optimize the quality of AI-generated maintenance recommendations so they are clear, actionable, specific, and quantify business impact.

## Domain

`recommendation_quality`

## Mutable Surfaces

- `ai-agent-processor` system prompts for each agent type
- Recommendation template structure and wording
- Risk score → priority mapping weights
- Business impact summary generation prompts
- Action wording templates

## Fixed Surfaces

- Approval authority rules
- Recommendation persistence logic
- Tenant scoping
- Audit event logging

## Success Metrics

### Primary (must improve)

- **approval_rate**: % of recommendations approved by humans (target: > 75%)
- **clarity_score**: AI-judged clarity of the recommendation (0-100, target: > 80)
- **actionability_score**: Can a maintenance team act on this immediately? (0-100, target: > 85)

### Secondary (must not degrade)

- **override_rate**: % of approved recommendations later overridden (target: < 10%)
- **time_to_approval**: Average time from recommendation to approval decision
- **wo_conversion_rate**: % of accepted recommendations that become work orders
- **specificity_score**: Does it reference the specific asset, failure mode, and context? (0-100)
- **business_impact_score**: Does it quantify downtime cost, safety risk, or production impact? (0-100)

## Benchmark Dataset Structure

Each benchmark scenario contains:

```json
{
  "scenario_id": "string",
  "asset_type": "pump|motor|conveyor|compressor|heat_exchanger",
  "asset_context": { "name", "criticality", "age_years", "health_score", "recent_failures" },
  "sensor_data": { "temperature", "vibration", "pressure" },
  "known_issue": "description of the actual issue",
  "expected_recommendation_type": "preventive|corrective|predictive",
  "human_approved_recommendation": "what a good recommendation looks like"
}
```

## Experiment Protocol

1. Load benchmark scenarios
2. For each scenario, generate a recommendation using the candidate prompt
3. Score each recommendation against the metrics using an LLM judge
4. Compare aggregate scores against the baseline
5. A variant passes if primary metrics improve >= 3% and secondary metrics don't degrade > 5%

## Proposal Strategy

When proposing new variants:

- Start with clarity improvements (simpler language, shorter sentences)
- Then improve specificity (reference asset name, failure mode, sensor readings)
- Then improve business impact quantification (downtime cost, safety implications)
- Then optimize action wording (specific next steps, not vague suggestions)
- Use prior experiment results to guide the direction of proposals
