# Climate-resilient concept selection

SyncAI compares development-case options across the eleven dimensions required
by the Sync Develop specification: CAPEX, OPEX, safety, reliability, carbon,
energy, water, land, waste, social effect and climate resilience.

## Canonical model

- `business_case_options` remains the option identity. Sustainability records
  reference an option; they do not copy or replace it.
- `option_sustainability_observations` is an append-only history of sourced
  observations for the ten non-climate dimensions. The current comparison uses
  the latest observation for each option and dimension.
- `climate_resilience_assessments` is a versioned assessment attached to an
  option. `climate_resilience_hazard_assessments` records extreme temperature,
  wildfire, flood, precipitation, water availability, freeze/thaw, permafrost
  and storm severity.
- Every observation and hazard references `evidence_items`, the platform's one
  evidence model. All changes also enter `audit_events`, the one audit ledger.

## Governed workflow

1. Create the business case and its candidate options.
2. Record evidence-backed observations for each of the ten non-climate
   dimensions. A quantified observation must carry a unit; every observation
   carries its basis and evidence.
3. Create a draft climate-resilience assessment with the future-conditions
   source and time horizon.
4. Record all eight hazard evaluations: the future condition, design response,
   residual gap and cited evidence.
5. A different authorized human independently reviews the complete assessment.
   The author cannot review their own work, and fewer than eight hazards is
   refused.
6. The Case Workspace shows every recorded dimension and every named gap for
   every option.

Tenant identity is checked in each RPC and again by table triggers. Authenticated
clients have read policies but no direct write policies. Reviewed assessments
cannot be edited; a changed future-condition basis requires a new revision.

## Decision boundary

Completeness means that each of the eleven dimensions has recorded evidence and
that all eight climate hazards received independent review. It does not mean an
option is good, climate-resilient, approved or preferred. SyncAI does not invent
missing values, collapse unlike units into a synthetic score, certify the
engineering conclusion, approve investment or select an option.

