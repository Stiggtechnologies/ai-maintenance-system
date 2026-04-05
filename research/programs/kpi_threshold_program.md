# KPI Threshold Tuning Research Program

## Objective

Optimize KPI alert thresholds by industry template so alerts are useful (high signal) rather than noisy (high false positive rate). Different industries have different normal operating ranges.

## Domain

`kpi_thresholds`

## Mutable Surfaces

- Green/yellow/red threshold values per KPI per industry
- Alert escalation trigger points
- Health score penalty curves (per asset class)
- Anomaly detection sensitivity parameters

## Fixed Surfaces

- KPI definition formulas
- Alert persistence and audit logging
- Notification routing rules
- Escalation chain definitions

## Success Metrics

### Primary

- **alert_precision**: % of alerts that led to actual intervention (target: > 60%)
- **false_escalation_rate**: % of critical alerts that were false positives (target: < 15%)

### Secondary

- **human_override_frequency**: % of thresholds manually adjusted by users after deployment (target: < 20%)
- **mean_time_to_acknowledge**: Average time from alert to human acknowledgment
- **alert_fatigue_score**: Number of alerts per day per site (target: < 20)

## Industry Templates

Test threshold packs for:

- **Oil & Gas**: Higher temperature tolerances, vibration-sensitive, pressure-critical
- **Mining**: High dust/contamination, heavy equipment, extended maintenance windows
- **Manufacturing**: OEE-focused, shift-based, quality-critical
- **Utilities**: Uptime-critical, regulatory compliance, seasonal load variation

## Benchmark Dataset Structure

```json
{
  "scenario_id": "string",
  "industry": "oil_gas|mining|manufacturing|utilities",
  "kpi_code": "string",
  "historical_values": [{ "timestamp", "value" }],
  "actual_interventions": [{ "timestamp", "type", "was_necessary" }],
  "current_thresholds": { "green_max", "yellow_max", "red_min" },
  "false_positive_events": [{ "alert_id", "reason_false" }]
}
```

## Proposal Strategy

- Start with the industry where override frequency is highest
- Adjust thresholds in small increments (5-10% per iteration)
- Test widening green zones first (reduce noise)
- Then tighten red zones (improve critical alert precision)
- Use historical intervention data as ground truth
