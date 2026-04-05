# OEE Diagnosis Research Program

## Objective

Optimize the accuracy and usefulness of OEE loss diagnosis — ensuring the system correctly identifies root causes, categorizes losses, attributes them to the right assets, and recommends effective next actions.

## Domain

`oee_diagnosis`

## Mutable Surfaces

- OEE loss root-cause ranking prompts
- Loss categorization rules (mapping sensor patterns → six big losses)
- Asset attribution logic for shared production lines
- Recommended next action templates for each loss category
- Severity scoring weights for loss events

## Fixed Surfaces

- OEE calculation formula (A × P × Q)
- Loss category definitions (Equipment Failure, Setup, Minor Stops, Reduced Speed, Defects, Startup)
- Production line → asset mappings
- Historical OEE measurement persistence

## Success Metrics

### Primary

- **top1_diagnosis_accuracy**: % of times the #1 suggested root cause matches the actual cause (target: > 70%)
- **top3_diagnosis_recall**: % of times the actual cause appears in top 3 suggestions (target: > 90%)
- **intervention_time**: Estimated time from loss detection to actionable intervention (target: < 30 min)

### Secondary

- **false_attribution_rate**: % of losses attributed to the wrong asset (target: < 5%)
- **category_accuracy**: % of losses correctly categorized into the right big loss (target: > 85%)
- **action_specificity**: Does the recommended action reference the specific equipment and failure mode? (0-100)

## Benchmark Dataset Structure

```json
{
  "scenario_id": "string",
  "production_line": "string",
  "assets_on_line": [{ "id", "name", "type" }],
  "loss_event": {
    "duration_minutes": "number",
    "sensor_readings": {},
    "operator_notes": "string",
    "shift": "string"
  },
  "actual_root_cause": "string",
  "actual_loss_category": "Equipment Failure|Setup|Minor Stops|Reduced Speed|Defects|Startup",
  "actual_responsible_asset": "asset_id",
  "expert_recommended_action": "string"
}
```

## Proposal Strategy

- Start with root-cause ranking prompt improvements
- Then improve loss categorization rules
- Then optimize asset attribution for multi-asset lines
- Then improve action recommendation specificity
