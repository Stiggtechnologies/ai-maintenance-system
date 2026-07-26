# SyncAI Asset Twin Library

## Decision

SyncAI can use AI to create most of the reusable asset intelligence library from legally available standards, public technical information, customer-authorized records and field evidence. AI-generated content remains draft until it passes evidence, engineering and field-validation gates.

The implementation uses four layers:

1. universal industrial asset concepts;
2. reusable asset-class templates;
3. OEM/model overlays;
4. customer asset instances and learned baselines.

This avoids separate application code for every machine while preserving model- and site-specific behaviour.

## What AI can produce

AI-assisted ingestion may propose:

- asset and component hierarchies;
- functions and functional failures;
- failure modes, mechanisms, effects and indicators;
- telemetry concepts and tag aliases;
- inspection zones and candidate drone observations;
- maintenance and verification tasks;
- operating-state rules;
- document citations and confidence scores.

AI must not invent serial-specific configuration, actual site tag mappings, legal requirements, component limits, warranty facts, hazardous-area classifications or confirmed failure diagnoses.

## Governance states

Every extracted or generated record progresses through:

`draft -> ai_extracted -> engineer_reviewed -> field_validated -> approved`

Production diagnostics may only depend on approved engineering records. Draft records can support research and onboarding suggestions but cannot create an authoritative alarm or maintenance instruction.

## Evidence rules

Every material engineering claim should carry:

- source type and title;
- document locator or URL where permitted;
- retrieval date;
- licence or usage restriction when known;
- extraction confidence;
- human reviewer and review date;
- field-validation evidence where applicable.

OEM manuals, CAD, diagnostic databases and proprietary control information must only be ingested when SyncAI or the customer has the right to use them. Public data does not automatically mean unrestricted redistribution.

## Initial mining scope

The code library starts with twelve surface-mining asset classes:

- electric rope shovel;
- hydraulic mining shovel;
- ultra-class haul truck;
- large wheel loader;
- blasthole drill;
- primary crusher;
- conveyor system;
- dragline;
- large mining dozer;
- motor grader;
- mobile crusher;
- stacker-reclaimer.

The electric rope shovel is the first detailed class. The remaining classes are typed starter shells so engineering content can be added without changing application architecture.

## Implementation roadmap

### Phase 1 — foundation

- domain types and validation;
- asset-class registry;
- version and review-state governance;
- electric rope shovel template;
- starter mining class catalogue.

### Phase 2 — persistence and onboarding integration

- Supabase tables for template versions, evidence, components, failure modes and overlays;
- tenant-safe template publication workflow;
- compiler that instantiates a customer asset from a class plus OEM overlay;
- mapping into the existing autonomous onboarding and FMEA libraries.

### Phase 3 — evidence ingestion

- allowlisted source registry;
- document parser and chunk provenance;
- structured extraction prompts and schemas;
- duplicate and contradiction detection;
- review queue for engineers;
- licence and redistribution controls.

### Phase 4 — model and field validation

- priority OEM/model overlays selected from target-customer fleets;
- customer historian and CMMS mappings;
- drone RGB, thermal and LiDAR observation models;
- confirmed findings and false-positive feedback;
- baseline learning per individual asset.

## Definition of done for an asset class

An asset class is commercially deployable when:

- its hierarchy and functions are engineer-reviewed;
- critical failure modes have cited evidence;
- each production diagnostic has an independent verification method;
- operating-state context is defined;
- telemetry and inspection concepts are mapped;
- customer overrides can survive template upgrades;
- field validation has been completed on at least one representative asset;
- known limitations and unsupported diagnoses are explicit.

## Immediate next engineering work

1. Persist the TypeScript template schema in Supabase with RLS and versioning.
2. Add a template compiler service that converts `AssetClassTemplate` records into the existing onboarding and failure-mode structures.
3. Build a source-ingestion queue with explicit licence, provenance and review fields.
4. Populate common component twins before adding many OEM models.
5. Use the first customer fleet list to prioritize model overlays.
