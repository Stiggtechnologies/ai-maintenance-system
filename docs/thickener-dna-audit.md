# Thickener DNA Audit

## Scope

This note covers issue #111 for the manufacturer-neutral mineral-processing thickener asset DNA. The work adds a draft canonical thickener template and Engineering DNA profile without changing shared engineering contracts, physics contracts, engineering-knowledge files, migrations, RLS policies, or existing asset templates beyond registry integration.

## Repository Reuse

- Reused the merged SAG mill and ball mill pattern of a self-contained `AssetClassTemplate` with a paired `EngineeringDnaProfile`.
- Reused the existing registry shape through `getAssetClassTemplate`, `engineeringDnaLibrary`, `getEngineeringDnaProfile`, and `getEngineeringDnaForAssetClass`.
- Reused the existing customer twin compatibility path through `instantiateEngineeringTwin`.
- Reused the same draft governance policy: site approval required, engineering approval required, customer overrides approval-gated, approved-source-only thresholds, and autonomous operational action prohibited.

## Existing Concept Search

The repository search found no canonical thickener asset twin before this work. Existing non-canonical references included:

- Legacy oil-sands and mining seed assets named `THICKENER` with telemetry concepts `torque`, `rake_position`, and `bed_level`.
- Industry template pack notes for tailings thickener underflow-line blockage and operator review before shutdown.
- General torque references in other asset templates and shared drivetrain concepts.

Those concepts informed naming only. No legacy thresholds, intervals, pressures, setpoints, or acceptance criteria were copied.

## Thickener-Specific Definitions

- Tank, bridge, center column, and support structure are modeled separately from rotating drive systems because containment, settlement, access, corrosion, and support alignment are thickener-specific boundaries.
- Rake arms, blades, trusses, and lifting mechanism are explicit because solids collection, rake position, and lift status are core thickener behavior.
- Drive, gearbox, bearings, and torque transmission are modeled without prescribing torque limits or OEM trip behavior.
- Feedwell, overflow, and underflow interfaces are separate components because thickener performance depends on feed distribution, clarification, and underflow withdrawal.
- Lubrication and hydraulic lifting support are included as governed systems without hydraulic-pressure values.
- Controls and protection include torque, bed-level, rake-position, overflow, and underflow concepts without setpoints.

## Governance Boundary

All records remain `draft`. Site and engineering approval remain required. Autonomous operational action remains prohibited. The template does not introduce torque limits, bed-level setpoints, hydraulic pressures, maintenance intervals, OEM thresholds, or acceptance criteria.
