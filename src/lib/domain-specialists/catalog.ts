import type {
  DomainInputDefinition,
  DomainMethodDefinition,
  DomainSpecialistModule,
  DomainSpecialistModuleKey,
} from "./types.ts";

const n = (
  key: string,
  label: string,
  unit: string,
  description: string,
): DomainInputDefinition => ({ key, label, kind: "number", unit, description });

const s = (
  key: string,
  label: string,
  description: string,
): DomainInputDefinition => ({ key, label, kind: "string", description });

const records = (
  key: string,
  label: string,
  description: string,
): DomainInputDefinition => ({ key, label, kind: "records", description });

const matrix = (
  key: string,
  label: string,
  description: string,
): DomainInputDefinition => ({ key, label, kind: "matrix", description });

const method = (definition: DomainMethodDefinition): DomainMethodDefinition =>
  definition;

export const DOMAIN_SPECIALIST_MODULES: DomainSpecialistModule[] = [
  {
    key: "oil-sands-tailings",
    industryCode: "oil_sands",
    label: "Oil Sands — Tailings Geotechnical Assessment",
    version: "1.0.0",
    reviewerRoleKey: "domain_tailings_reviewer",
    purpose:
      "Calculate documented stability margins and instrumentation exceptions for qualified geotechnical review.",
    dataClasses: ["operational", "safety_critical", "regulatory"],
    methods: [
      method({
        key: "tailings-geotechnical",
        label: "Tailings geotechnical screening",
        purpose:
          "Compute force-based factor of safety and compare it with an approved case-specific acceptance criterion.",
        kind: "engineering_calculation",
        algorithm:
          "Factor of safety = resisting force / driving force; instrument readings are checked against supplied trigger levels.",
        requiredInputs: [
          n(
            "resistingForce",
            "Resisting force",
            "kN",
            "Qualified model output for the assessed section and load case.",
          ),
          n(
            "drivingForce",
            "Driving force",
            "kN",
            "Qualified model output for the same section and load case.",
          ),
          n(
            "minimumFactorOfSafety",
            "Approved minimum factor of safety",
            "ratio",
            "Criterion selected by the responsible geotechnical authority.",
          ),
          records(
            "instruments",
            "Instrumentation observations",
            "Named observations with value, approved trigger, unit, and timestamp.",
          ),
          s(
            "loadCase",
            "Load case",
            "The assessed construction, water, seismic, or operating case.",
          ),
        ],
        requiredEvidence: [
          "geotechnical-model",
          "survey-or-instrumentation",
          "approved-criteria",
        ],
        authorityReferences: [
          "site tailings governance",
          "licensed geotechnical design basis",
          "applicable jurisdictional requirements",
        ],
        requiredApproverRole:
          "Engineer of record / geotechnical technical authority",
        limitations: [
          "This is not a slope-stability solver and does not derive soil parameters.",
          "A passing arithmetic screen is not a declaration of dam safety or regulatory compliance.",
        ],
        exampleInputs: {
          resistingForce: 18200,
          drivingForce: 12100,
          minimumFactorOfSafety: 1.5,
          loadCase: "Approved operating load case",
          instruments: [
            {
              id: "PZ-01",
              value: 42,
              trigger: 50,
              direction: "higher_worse",
              unit: "kPa",
              observedAt: "2026-08-01T00:00:00Z",
            },
          ],
        },
      }),
    ],
  },
  {
    key: "oil-gas-well-integrity",
    industryCode: "oil_gas",
    label: "Oil & Gas — Well Integrity",
    version: "1.0.0",
    reviewerRoleKey: "domain_well_integrity_reviewer",
    purpose:
      "Evaluate barrier-envelope evidence, pressure margins, tests, anomalies, and overdue actions without declaring a well safe.",
    dataClasses: ["operational", "safety_critical", "regulatory"],
    methods: [
      method({
        key: "well-integrity",
        label: "Well barrier and pressure-envelope review",
        purpose:
          "Check independent barrier coverage and measured pressure against approved operating limits.",
        kind: "verification",
        algorithm:
          "For every phase, require the approved number of verified independent barriers and calculate pressure margin to the supplied limit.",
        requiredInputs: [
          records(
            "barriers",
            "Barrier elements",
            "Barrier, phase, independence group, verification status, last test, and evidence reference.",
          ),
          records(
            "pressureObservations",
            "Pressure observations",
            "Observed and approved maximum pressure for each monitored annulus or envelope.",
          ),
          n(
            "requiredIndependentBarriers",
            "Required independent barriers",
            "count",
            "Minimum from the operator-approved well integrity standard.",
          ),
        ],
        requiredEvidence: [
          "well-schematic",
          "barrier-verification",
          "pressure-history",
          "approved-operating-envelope",
        ],
        authorityReferences: [
          "operator well-integrity standard",
          "approved well programme",
          "applicable regulator requirements",
        ],
        requiredApproverRole: "Well integrity technical authority",
        limitations: [
          "Does not infer barrier independence or leak mechanism.",
          "Does not authorize continued operation, intervention, suspension, or abandonment.",
        ],
        exampleInputs: {
          requiredIndependentBarriers: 2,
          barriers: [
            {
              phase: "production",
              id: "tubing",
              independenceGroup: "primary",
              verified: true,
            },
            {
              phase: "production",
              id: "packer-casing",
              independenceGroup: "secondary",
              verified: true,
            },
          ],
          pressureObservations: [
            { id: "A-annulus", observed: 3200, limit: 5000, unit: "kPa" },
          ],
        },
      }),
    ],
  },
  {
    key: "petrochemical-rbi",
    industryCode: "petrochemical",
    label: "Petrochemical — RBI Corrosion-Loop Modelling",
    version: "1.0.0",
    reviewerRoleKey: "domain_rbi_reviewer",
    purpose:
      "Calculate measured corrosion rates, remaining-life screens, and risk ranking from organization-approved inputs.",
    dataClasses: ["operational", "safety_critical", "regulatory"],
    methods: [
      method({
        key: "rbi-corrosion-loop",
        label: "RBI corrosion-loop calculation",
        purpose:
          "Trend thickness, calculate remaining life, and combine supplied probability and consequence categories.",
        kind: "engineering_calculation",
        algorithm:
          "Corrosion rate = (previous thickness - current thickness) / elapsed years; remaining life = (current - minimum allowable) / positive rate; risk rank uses the tenant's supplied matrix.",
        requiredInputs: [
          records(
            "circuits",
            "Corrosion circuits",
            "Circuit thickness history, elapsed time, minimum allowable thickness, PoF category, and CoF category.",
          ),
          matrix(
            "riskMatrix",
            "Approved RBI risk matrix",
            "Organization-approved PoF-by-CoF matrix; no default bands are supplied.",
          ),
          n(
            "inspectionFraction",
            "Approved inspection fraction",
            "fraction",
            "Approved fraction of remaining life used only to screen a candidate next inspection interval.",
          ),
        ],
        requiredEvidence: [
          "inspection-data",
          "minimum-thickness-basis",
          "damage-mechanism-review",
          "approved-rbi-matrix",
        ],
        authorityReferences: [
          "API 580",
          "API 581",
          "site inspection programme",
          "jurisdictional pressure-equipment requirements",
        ],
        requiredApproverRole: "Pressure-equipment / RBI technical authority",
        limitations: [
          "This is not a full API 581 implementation.",
          "It does not calculate minimum allowable thickness, damage factors, PoF, or CoF from first principles.",
        ],
        exampleInputs: {
          inspectionFraction: 0.5,
          riskMatrix: { "3:C": "high" },
          circuits: [
            {
              id: "CL-01",
              previousThickness: 9.2,
              currentThickness: 8.8,
              elapsedYears: 2,
              minimumThickness: 6.5,
              probabilityCategory: "3",
              consequenceCategory: "C",
            },
          ],
        },
      }),
    ],
  },
  {
    key: "utilities-storm-response",
    industryCode: "utilities",
    label: "Utilities — Storm Mobilization & Crew Dispatch",
    version: "1.0.0",
    reviewerRoleKey: "domain_storm_dispatch_reviewer",
    purpose:
      "Prioritize incidents and produce a constraint-feasible draft crew assignment for dispatcher approval.",
    dataClasses: ["operational", "safety_critical"],
    methods: [
      method({
        key: "storm-crew-dispatch",
        label: "Storm mobilization and crew dispatch",
        purpose:
          "Assign qualified, available crews to prioritized incidents while exposing every unassigned job.",
        kind: "optimization",
        algorithm:
          "Deterministic priority-ordered assignment; for each incident, choose the eligible qualified crew with the lowest supplied travel cost while preserving capacity. Infeasible incidents remain unassigned.",
        requiredInputs: [
          records(
            "incidents",
            "Storm incidents",
            "Incident ID, priority/severity, customers affected, required skills, location, and work hours.",
          ),
          records(
            "crews",
            "Available crews",
            "Crew ID, skills, available hours, base location, and status.",
          ),
          matrix(
            "travelMinutes",
            "Travel-time matrix",
            "Explicit crew-to-incident travel minutes from an approved routing source.",
          ),
          matrix(
            "priorityWeights",
            "Approved priority weights",
            "Weights for severity, customers affected, and travel; no values are invented.",
          ),
        ],
        requiredEvidence: [
          "incident-feed",
          "crew-roster",
          "competency-records",
          "travel-time-source",
          "dispatch-policy",
        ],
        authorityReferences: [
          "utility emergency-response plan",
          "switching and safe-work rules",
          "mutual-aid agreements",
        ],
        requiredApproverRole: "System operations / storm incident commander",
        limitations: [
          "Does not issue switching orders, energization commands, or crew movement instructions.",
          "Travel estimates and field hazards must be confirmed by dispatch.",
        ],
        exampleInputs: {
          priorityWeights: { severity: 10, customers: 0.01, travel: 0.1 },
          incidents: [
            {
              id: "I-1",
              severity: 5,
              customersAffected: 900,
              requiredSkills: ["line"],
              workHours: 4,
            },
          ],
          crews: [
            {
              id: "C-1",
              skills: ["line"],
              availableHours: 8,
              status: "available",
            },
          ],
          travelMinutes: { "C-1:I-1": 25 },
        },
      }),
    ],
  },
  {
    key: "manufacturing-operations",
    industryCode: "manufacturing",
    label: "Manufacturing — Line Balancing & Robot Health",
    version: "1.0.0",
    reviewerRoleKey: "domain_manufacturing_reviewer",
    purpose:
      "Quantify production-line balance and evidence-based robot health without changing PLC or robot parameters.",
    dataClasses: ["operational", "safety_critical", "quality"],
    methods: [
      method({
        key: "line-balancing",
        label: "Production line balancing",
        purpose:
          "Calculate takt, theoretical station count, balance efficiency, bottleneck, and a precedence-feasible draft allocation.",
        kind: "optimization",
        algorithm:
          "Takt = available production time / required units; deterministic longest-eligible-task assignment respects precedence and takt capacity.",
        requiredInputs: [
          n(
            "availableMinutes",
            "Available production time",
            "min",
            "Net planned production time for the horizon.",
          ),
          n(
            "requiredUnits",
            "Required output",
            "units",
            "Required good units for the same horizon.",
          ),
          records(
            "tasks",
            "Work elements",
            "Task ID, cycle minutes, and predecessor IDs.",
          ),
        ],
        requiredEvidence: [
          "time-study",
          "demand-plan",
          "precedence-definition",
        ],
        authorityReferences: [
          "approved standard work",
          "site ergonomics and safety requirements",
          "quality control plan",
        ],
        requiredApproverRole:
          "Manufacturing engineering / operations authority",
        limitations: [
          "Does not infer fatigue, ergonomic, quality, buffer, changeover, or stochastic-loss allowances.",
          "A draft balance does not change approved standard work.",
        ],
        exampleInputs: {
          availableMinutes: 420,
          requiredUnits: 140,
          tasks: [
            { id: "A", minutes: 1.2, predecessors: [] },
            { id: "B", minutes: 1.5, predecessors: ["A"] },
          ],
        },
      }),
      method({
        key: "robot-health",
        label: "Robot health model",
        purpose:
          "Combine normalized condition indicators using approved direction, limits, and weights.",
        kind: "engineering_calculation",
        algorithm:
          "Each signal is normalized between approved healthy and critical bounds; weighted degradation is reported only when all weights and bounds are supplied.",
        requiredInputs: [
          records(
            "signals",
            "Robot condition signals",
            "Signal, observed value, healthy bound, critical bound, direction, unit, and approved weight.",
          ),
        ],
        requiredEvidence: [
          "robot-controller-history",
          "condition-monitoring",
          "maintenance-history",
          "approved-signal-model",
        ],
        authorityReferences: [
          "OEM maintenance instructions",
          "validated site condition-monitoring model",
          "machinery safety controls",
        ],
        requiredApproverRole: "Automation / robot reliability authority",
        limitations: [
          "No universal robot-health weights or alarm limits are embedded.",
          "Does not bypass safety-rated controls or command the robot.",
        ],
        exampleInputs: {
          signals: [
            {
              id: "axis-2-torque",
              observed: 46,
              healthy: 30,
              critical: 60,
              direction: "higher_worse",
              weight: 1,
              unit: "%",
            },
          ],
        },
      }),
    ],
  },
  {
    key: "food-beverage-safety",
    industryCode: "food_beverage",
    label: "Food & Beverage — HACCP, CIP & Cold Chain",
    version: "1.0.0",
    reviewerRoleKey: "domain_food_safety_reviewer",
    purpose:
      "Verify records against approved food-safety and sanitation limits without releasing product.",
    dataClasses: ["operational", "safety_critical", "quality", "regulatory"],
    methods: [
      method({
        key: "haccp-verification",
        label: "HACCP critical-control-point verification",
        purpose:
          "Check monitored CCP observations against the hazard plan's approved critical limits and corrective-action records.",
        kind: "verification",
        algorithm:
          "Evaluate every observation using its supplied lower/upper critical limit and require disposition evidence for every excursion.",
        requiredInputs: [
          records(
            "criticalControlPoints",
            "CCP observations",
            "CCP, value, approved lower/upper limits, monitoring time, deviation and disposition references.",
          ),
        ],
        requiredEvidence: [
          "approved-haccp-plan",
          "monitoring-records",
          "corrective-action-records",
          "verification-records",
        ],
        authorityReferences: [
          "organization-approved HACCP plan",
          "applicable food-safety authority requirements",
        ],
        requiredApproverRole: "Food-safety / HACCP plan authority",
        limitations: [
          "Does not create hazards or critical limits.",
          "Does not release, hold, destroy, or rework product.",
        ],
        exampleInputs: {
          criticalControlPoints: [
            {
              id: "CCP-1",
              value: 74,
              lowerLimit: 72,
              unit: "°C",
              dispositionReference: null,
            },
          ],
        },
      }),
      method({
        key: "cip-validation",
        label: "Clean-in-place cycle verification",
        purpose:
          "Verify actual time, temperature, concentration, flow, and sequence against an approved recipe envelope.",
        kind: "verification",
        algorithm:
          "Each required phase and parameter must remain inside the supplied validated envelope for the required duration.",
        requiredInputs: [
          records(
            "phases",
            "CIP phase results",
            "Phase and actual/required duration, temperature, concentration, flow, sequence, and calibrated-sensor status.",
          ),
        ],
        requiredEvidence: [
          "validated-cip-recipe",
          "cycle-historian",
          "instrument-calibration",
          "deviation-records",
        ],
        authorityReferences: [
          "site sanitation validation protocol",
          "applicable food-safety requirements",
        ],
        requiredApproverRole: "Sanitation / quality authority",
        limitations: [
          "Does not establish microbiological lethality or cleaning acceptance criteria.",
          "Does not release equipment or product.",
        ],
        exampleInputs: {
          phases: [
            {
              id: "caustic",
              actualDuration: 22,
              minimumDuration: 20,
              actualTemperature: 75,
              minimumTemperature: 72,
              actualConcentration: 1.8,
              minimumConcentration: 1.5,
              actualFlow: 120,
              minimumFlow: 110,
              sequence: 2,
              expectedSequence: 2,
              sensorsCalibrated: true,
            },
          ],
        },
      }),
      method({
        key: "cold-chain",
        label: "Cold-chain excursion model",
        purpose:
          "Integrate excursion exposure against an approved product-specific limit and identify affected lots.",
        kind: "engineering_calculation",
        algorithm:
          "Excursion dose = sum(max(0, observed temperature - approved limit) × duration); compare only with a supplied product-specific allowable dose.",
        requiredInputs: [
          records(
            "segments",
            "Time-temperature segments",
            "Temperature, duration, product limit, lot, sensor, and timestamp.",
          ),
          n(
            "allowableExcursionDose",
            "Approved allowable excursion dose",
            "°C·min",
            "Product-specific limit approved by quality.",
          ),
        ],
        requiredEvidence: [
          "temperature-history",
          "sensor-calibration",
          "lot-traceability",
          "approved-stability-or-shelf-life-basis",
        ],
        authorityReferences: [
          "product specification",
          "approved cold-chain procedure",
          "applicable food-safety requirements",
        ],
        requiredApproverRole: "Quality / food-safety disposition authority",
        limitations: [
          "The dose model is a screening integral, not a microbial growth or shelf-life model.",
          "Only an approved product-specific model may support disposition.",
        ],
        exampleInputs: {
          allowableExcursionDose: 90,
          segments: [
            { lot: "L-1", temperature: 9, limit: 5, durationMinutes: 15 },
          ],
        },
      }),
    ],
  },
  {
    key: "pharmaceutical-quality",
    industryCode: "pharmaceuticals",
    label: "Pharmaceuticals — GxP Validation & Batch Records",
    version: "1.0.0",
    reviewerRoleKey: "domain_pharmaceutical_quality_reviewer",
    purpose:
      "Trace requirements, tests, deviations, approvals, and batch-record completeness while preserving qualified-person release authority.",
    dataClasses: ["operational", "quality", "regulatory"],
    methods: [
      method({
        key: "gxp-validation",
        label: "GxP validation traceability",
        purpose:
          "Verify requirements-to-test-to-result trace coverage, approved deviations, and validated-state evidence.",
        kind: "traceability",
        algorithm:
          "Every in-scope requirement must have an approved test and passing result or approved deviation; open changes and periodic reviews remain visible.",
        requiredInputs: [
          records(
            "requirements",
            "Validation requirements",
            "Requirement ID, risk class, test reference, result, deviation, approval, and change-control state.",
          ),
        ],
        requiredEvidence: [
          "validation-plan",
          "requirements-specification",
          "test-protocols-and-results",
          "deviations",
          "change-control",
        ],
        authorityReferences: [
          "organization quality system",
          "applicable GxP requirements",
          "validated-system lifecycle procedures",
        ],
        requiredApproverRole: "Quality assurance / validation authority",
        limitations: [
          "Does not declare a system validated or compliant.",
          "Electronic-record controls and jurisdictional applicability require quality review.",
        ],
        exampleInputs: {
          requirements: [
            {
              id: "URS-1",
              inScope: true,
              testReference: "OQ-12",
              result: "passed",
              deviationStatus: null,
              approved: true,
              changeControlState: "closed",
            },
          ],
        },
      }),
      method({
        key: "batch-record",
        label: "Batch-record completeness and exception review",
        purpose:
          "Check required batch-record fields, signatures, material genealogy, results, and deviation disposition.",
        kind: "traceability",
        algorithm:
          "Evaluate an approved required-record manifest; any missing, unsigned, out-of-specification, or unresolved-deviation item blocks a clean draft result.",
        requiredInputs: [
          records(
            "recordItems",
            "Batch record items",
            "Required item, present, attributable signature, result status, material genealogy, and deviation disposition.",
          ),
        ],
        requiredEvidence: [
          "master-batch-record",
          "executed-batch-record",
          "laboratory-results",
          "deviation-and-oos-records",
        ],
        authorityReferences: [
          "approved master batch record",
          "organization quality system",
          "applicable GxP requirements",
        ],
        requiredApproverRole: "Qualified batch-release / quality authority",
        limitations: [
          "Does not release a batch or resolve deviations/OOS results.",
          "Completeness does not prove data integrity or product quality.",
        ],
        exampleInputs: {
          recordItems: [
            {
              id: "weighing",
              required: true,
              present: true,
              signed: true,
              resultStatus: "accepted",
              genealogyComplete: true,
              deviationStatus: null,
            },
          ],
        },
      }),
    ],
  },
  {
    key: "transport-logistics",
    industryCode: "transportation_logistics",
    label: "Transportation & Logistics — Route, Depot & Inspection",
    version: "1.0.0",
    reviewerRoleKey: "domain_transport_reviewer",
    purpose:
      "Optimize bounded routes and expose inspection-due constraints for dispatcher and regulatory review.",
    dataClasses: ["operational", "safety_critical", "regulatory"],
    methods: [
      method({
        key: "route-depot-optimization",
        label: "Route and depot optimization",
        purpose:
          "Select a feasible depot and shortest bounded route from an explicit cost matrix.",
        kind: "optimization",
        algorithm:
          "Enumerate all routes for at most 8 stops and 10 depots, reject capacity/time-window violations, and return the minimum supplied travel cost with deterministic tie-breaking.",
        requiredInputs: [
          records(
            "stops",
            "Stops",
            "Stop ID, demand, service duration, and optional time window.",
          ),
          records(
            "depots",
            "Depots",
            "Depot ID, vehicle capacity, available route minutes, and start/end nodes.",
          ),
          matrix(
            "travelCosts",
            "Travel cost matrix",
            "Directed monetary or generalized cost for every required node pair.",
          ),
          matrix(
            "travelMinutes",
            "Travel-time matrix",
            "Directed elapsed travel minutes for every required node pair.",
          ),
        ],
        requiredEvidence: [
          "orders-or-service-demand",
          "depot-and-fleet-capacity",
          "approved-route-cost-source",
          "operating-constraints",
        ],
        authorityReferences: [
          "carrier operating rules",
          "driver-hours and route restrictions",
          "dangerous-goods or special-load requirements where applicable",
        ],
        requiredApproverRole:
          "Fleet dispatcher / transport operations authority",
        limitations: [
          "Exact enumeration is intentionally limited to 8 stops and 10 depots; larger problems are blocked rather than falsely labelled optimized.",
          "Does not dispatch vehicles or override driver/safety constraints.",
        ],
        exampleInputs: {
          stops: [
            { id: "A", demand: 2, serviceMinutes: 10 },
            { id: "B", demand: 1, serviceMinutes: 5 },
          ],
          depots: [{ id: "D", capacity: 5, availableMinutes: 240 }],
          travelCosts: {
            "D:A": 20,
            "A:B": 10,
            "B:D": 20,
            "D:B": 15,
            "B:A": 10,
            "A:D": 25,
          },
          travelMinutes: {
            "D:A": 20,
            "A:B": 10,
            "B:D": 20,
            "D:B": 15,
            "B:A": 10,
            "A:D": 25,
          },
        },
      }),
      method({
        key: "inspection-scheduling",
        label: "Regulatory inspection scheduling",
        purpose:
          "Calculate due state and produce a priority-ordered draft inspection schedule from approved intervals and capacity.",
        kind: "optimization",
        algorithm:
          "Due date = last compliant inspection + approved interval; overdue and soonest-due assets consume explicit daily inspection capacity first.",
        requiredInputs: [
          records(
            "assets",
            "Fleet inspection obligations",
            "Asset, last compliant inspection, approved interval days, duration, priority, and out-of-service state.",
          ),
          n(
            "dailyCapacityHours",
            "Daily inspection capacity",
            "h/day",
            "Qualified inspection capacity available.",
          ),
          s(
            "planningStart",
            "Planning start",
            "ISO date for the schedule horizon.",
          ),
        ],
        requiredEvidence: [
          "inspection-history",
          "applicable-interval-register",
          "fleet-status",
          "qualified-inspector-capacity",
        ],
        authorityReferences: [
          "applicable transport inspection rules",
          "operator maintenance programme",
        ],
        requiredApproverRole: "Fleet compliance / maintenance authority",
        limitations: [
          "Does not derive statutory intervals or return an asset to service.",
          "Calendar output remains subject to shop, parts, access, and defect constraints.",
        ],
        exampleInputs: {
          planningStart: "2026-09-01",
          dailyCapacityHours: 8,
          assets: [
            {
              id: "TR-1",
              lastInspection: "2026-01-01",
              intervalDays: 180,
              durationHours: 4,
              priority: 2,
            },
          ],
        },
      }),
    ],
  },
  {
    key: "aviation-airworthiness",
    industryCode: "aviation",
    label: "Aviation — Airworthiness, MSG-3 & Life-Limited Parts",
    version: "1.0.0",
    reviewerRoleKey: "domain_airworthiness_reviewer",
    purpose:
      "Expose airworthiness applicability, maintenance-programme, and back-to-birth traceability gaps without signing a release.",
    dataClasses: ["operational", "safety_critical", "regulatory"],
    methods: [
      method({
        key: "airworthiness-compliance",
        label: "Airworthiness directive and service-bulletin trace",
        purpose:
          "Check applicability, compliance method, due limits, recurring action, and release evidence.",
        kind: "traceability",
        algorithm:
          "Every applicable instruction must have an approved compliance state, method, effectivity match, completion evidence, and next due value where recurring.",
        requiredInputs: [
          records(
            "instructions",
            "Airworthiness instructions",
            "Identifier, revision, applicability, effectivity basis, compliance state/method/evidence, and recurring due values.",
          ),
        ],
        requiredEvidence: [
          "current-airworthiness-publications",
          "aircraft-configuration",
          "technical-records",
          "authorized-release-records",
        ],
        authorityReferences: [
          "applicable civil or military aviation authority",
          "approved maintenance programme",
          "type-certificate holder instructions",
        ],
        requiredApproverRole:
          "Authorized airworthiness / maintenance release authority",
        limitations: [
          "Does not determine legal applicability or sign an airworthiness release.",
          "Service-bulletin status must not be conflated with mandatory directive status.",
        ],
        exampleInputs: {
          instructions: [
            {
              id: "AD-EXAMPLE",
              applicable: true,
              revisionCurrent: true,
              complianceState: "complied",
              methodApproved: true,
              evidenceReference: "WO-1",
              recurring: false,
            },
          ],
        },
      }),
      method({
        key: "msg3-trace",
        label: "MSG-3 maintenance-programme trace",
        purpose:
          "Verify that systems/powerplant, structural, and zonal analyses are traceable to approved tasks and escalation evidence.",
        kind: "traceability",
        algorithm:
          "Every in-scope MSI/SSI/zone decision record must preserve failure effect, consequence branch, task applicability/effectiveness, interval basis, and approval status.",
        requiredInputs: [
          records(
            "decisionRecords",
            "MSG-3 decision records",
            "Item/zone, category, effect, consequence branch, task, applicability, effectiveness, interval basis, and approval.",
          ),
        ],
        requiredEvidence: [
          "approved-msg3-policy",
          "configuration-baseline",
          "decision-records",
          "in-service-data",
        ],
        authorityReferences: [
          "operator-approved MSG-3 process",
          "maintenance review board / authority requirements",
        ],
        requiredApproverRole: "Maintenance-programme / airworthiness authority",
        limitations: [
          "Does not supply MSG-3 decision logic from copyrighted source material.",
          "Does not approve tasks or intervals.",
        ],
        exampleInputs: {
          decisionRecords: [
            {
              id: "MSI-1",
              category: "systems",
              effectDefined: true,
              consequenceBranch: "operational",
              taskDefined: true,
              applicabilityJustified: true,
              effectivenessJustified: true,
              intervalBasis: "fleet data",
              approved: false,
            },
          ],
        },
      }),
      method({
        key: "life-limited-part",
        label: "Life-limited-part back-to-birth traceability",
        purpose:
          "Calculate remaining approved life only when identity, complete history, units, and current limit are traceable.",
        kind: "engineering_calculation",
        algorithm:
          "Remaining life = approved current limit - accumulated authenticated usage; any genealogy or unit gap blocks a usable result.",
        requiredInputs: [
          records(
            "parts",
            "Life-limited parts",
            "Part/serial, approved limit and unit, authenticated life segments, configuration, repairs, and back-to-birth completeness.",
          ),
        ],
        requiredEvidence: [
          "authorized-component-records",
          "back-to-birth-history",
          "current-approved-life-limit",
          "installation-configuration",
        ],
        authorityReferences: [
          "applicable airworthiness limitations",
          "type-certificate holder data",
          "approved repair data",
        ],
        requiredApproverRole:
          "Authorized airworthiness records / release authority",
        limitations: [
          "Does not authenticate source records or reconcile incompatible life units.",
          "A computed remainder is not installation or release authorization.",
        ],
        exampleInputs: {
          parts: [
            {
              partNumber: "PN-1",
              serialNumber: "SN-1",
              approvedLimit: 20000,
              unit: "cycles",
              authenticatedUsage: [7000, 5000],
              backToBirthComplete: true,
              configurationCurrent: true,
            },
          ],
        },
      }),
    ],
  },
  {
    key: "marine-shipping",
    industryCode: "marine_shipping",
    label: "Marine Shipping — Surveys, Propulsion & Voyage",
    version: "1.0.0",
    reviewerRoleKey: "domain_marine_reviewer",
    purpose:
      "Track class-survey due state and quantify propulsion/voyage alternatives for authorized marine review.",
    dataClasses: ["operational", "safety_critical", "regulatory"],
    methods: [
      method({
        key: "class-survey-scheduling",
        label: "Class survey scheduling",
        purpose:
          "Calculate due/overdue status and docking-window fit from class-approved survey intervals.",
        kind: "optimization",
        algorithm:
          "Due date = last credited survey + supplied interval; schedule against explicit docking windows and survey duration without changing class status.",
        requiredInputs: [
          records(
            "surveys",
            "Survey obligations",
            "Survey item, last credited date, approved interval, duration, window, and prerequisites.",
          ),
          records(
            "dockingWindows",
            "Docking windows",
            "Start/end and available survey capacity.",
          ),
        ],
        requiredEvidence: [
          "class-status-report",
          "credited-survey-history",
          "approved-survey-cycle",
          "docking-plan",
        ],
        authorityReferences: [
          "vessel class society rules",
          "flag-state requirements",
          "statutory survey programme",
        ],
        requiredApproverRole: "Class / marine technical authority",
        limitations: [
          "Does not interpret class rules or credit a survey.",
          "The class society and flag administration remain authoritative.",
        ],
        exampleInputs: {
          surveys: [
            {
              id: "annual",
              lastCredited: "2025-10-01",
              intervalDays: 365,
              durationHours: 8,
            },
          ],
          dockingWindows: [
            {
              id: "W-1",
              start: "2026-09-20",
              end: "2026-09-30",
              capacityHours: 24,
            },
          ],
        },
      }),
      method({
        key: "propulsion-efficiency",
        label: "Hull and propulsion efficiency",
        purpose:
          "Normalize observed propulsion performance against an approved comparable baseline.",
        kind: "engineering_calculation",
        algorithm:
          "Compute energy/fuel per distance and percent deviation from a supplied speed, draft, weather, and load-matched baseline.",
        requiredInputs: [
          records(
            "observations",
            "Voyage observations",
            "Fuel/energy, distance, speed, draft/load, weather bin, and matching baseline intensity.",
          ),
        ],
        requiredEvidence: [
          "fuel-or-energy-metering",
          "distance-and-speed",
          "draft-and-load",
          "weather-current",
          "approved-baseline-model",
        ],
        authorityReferences: [
          "vessel energy-management plan",
          "OEM propulsion limits",
          "applicable emissions requirements",
        ],
        requiredApproverRole:
          "Marine engineering / vessel performance authority",
        limitations: [
          "Does not attribute degradation to hull, propeller, engine, weather, or measurement error without discriminating evidence.",
          "Does not change engine settings or voyage plan.",
        ],
        exampleInputs: {
          observations: [
            {
              id: "leg-1",
              energy: 1200,
              distanceNm: 100,
              baselineEnergyPerNm: 10,
              speedKnots: 14,
              draftM: 9,
            },
          ],
        },
      }),
      method({
        key: "voyage-optimization",
        label: "Voyage option optimization",
        purpose:
          "Rank feasible route/speed options using explicit safety, schedule, fuel, emissions, and weather constraints.",
        kind: "optimization",
        algorithm:
          "Reject options that violate supplied hard constraints, min-max normalize the feasible option set, then minimize an approved weighted objective over cost, duration, energy, and emissions.",
        requiredInputs: [
          records(
            "options",
            "Voyage options",
            "Option, duration, cost, energy, emissions, weather margin, under-keel margin, and constraint flags.",
          ),
          matrix(
            "weights",
            "Approved objective weights",
            "Non-negative weights for cost, duration, energy, and emissions.",
          ),
        ],
        requiredEvidence: [
          "approved-route-options",
          "weather-and-current-forecast",
          "vessel-limitations",
          "port-and-channel-constraints",
          "charter-or-schedule-obligations",
        ],
        authorityReferences: [
          "master's overriding authority",
          "company voyage planning procedure",
          "applicable navigation and emissions requirements",
        ],
        requiredApproverRole: "Vessel master / marine operations authority",
        limitations: [
          "Does not navigate, command speed, or override the master.",
          "Forecast and chart validity remain external controls.",
        ],
        exampleInputs: {
          weights: { cost: 1, duration: 2, energy: 1, emissions: 1 },
          options: [
            {
              id: "north",
              durationHours: 30,
              cost: 50000,
              energy: 300,
              emissions: 80,
              constraintsSatisfied: true,
            },
          ],
        },
      }),
    ],
  },
  {
    key: "data-center-thermal",
    industryCode: "data_centers",
    label: "Data Centers — Thermal & Airflow Modelling",
    version: "1.0.0",
    reviewerRoleKey: "domain_data_center_thermal_reviewer",
    purpose:
      "Calculate rack heat balance, airflow demand, capacity margin, and sensor exceptions without changing controls.",
    dataClasses: ["operational", "safety_critical"],
    methods: [
      method({
        key: "thermal-airflow",
        label: "Thermal and airflow balance",
        purpose:
          "Compute required mass/volumetric airflow and compare observed rack/cooling capacity with approved thermal envelopes.",
        kind: "engineering_calculation",
        algorithm:
          "Required mass flow = heat load / (air specific heat × approved temperature rise); compare with measured airflow and N+X available cooling capacity.",
        requiredInputs: [
          n(
            "heatLoadKw",
            "IT heat load",
            "kW",
            "Measured or approved design heat load.",
          ),
          n(
            "airSpecificHeat",
            "Air specific heat",
            "kJ/kg·K",
            "Approved property for the model conditions.",
          ),
          n(
            "airDensity",
            "Air density",
            "kg/m³",
            "Approved property for altitude and conditions.",
          ),
          n(
            "allowedTemperatureRise",
            "Allowed temperature rise",
            "K",
            "Approved supply-to-return design envelope.",
          ),
          n(
            "measuredAirflow",
            "Measured airflow",
            "m³/s",
            "Measured delivered airflow.",
          ),
          n(
            "availableCoolingKw",
            "Available cooling capacity",
            "kW",
            "Capacity available in the assessed redundancy state.",
          ),
          records(
            "sensors",
            "Thermal observations",
            "Sensor/rack, observed value, approved lower/upper envelope, timestamp, and calibration state.",
          ),
        ],
        requiredEvidence: [
          "power-and-heat-load",
          "airflow-measurement",
          "thermal-sensors",
          "cooling-topology",
          "approved-envelopes",
        ],
        authorityReferences: [
          "facility thermal design basis",
          "equipment environmental specifications",
          "applicable data-center thermal guidance",
        ],
        requiredApproverRole: "Data-center facilities / thermal authority",
        limitations: [
          "This is a lumped heat-balance model, not CFD.",
          "Does not change setpoints, fan speed, containment, or redundancy state.",
        ],
        exampleInputs: {
          heatLoadKw: 500,
          airSpecificHeat: 1.006,
          airDensity: 1.18,
          allowedTemperatureRise: 12,
          measuredAirflow: 38,
          availableCoolingKw: 650,
          sensors: [
            {
              id: "rack-1-inlet",
              value: 24,
              lowerLimit: 18,
              upperLimit: 27,
              calibrated: true,
            },
          ],
        },
      }),
    ],
  },
  {
    key: "defense-readiness",
    industryCode: "defense",
    label: "Defense — Mission Readiness, Configuration & Classified Deployment",
    version: "1.0.0",
    reviewerRoleKey: "domain_defense_readiness_reviewer",
    purpose:
      "Quantify mission-capable coverage and configuration/deployment control gaps while respecting security boundaries.",
    dataClasses: [
      "operational",
      "safety_critical",
      "security_sensitive",
      "classified",
    ],
    methods: [
      method({
        key: "mission-readiness",
        label: "Mission readiness model",
        purpose:
          "Compute mission-capable asset coverage against an approved force-generation requirement and mission profile.",
        kind: "readiness",
        algorithm:
          "For each mission, count assets that are available, configured, qualified, supplied, and within maintenance limits; compare with the supplied required count.",
        requiredInputs: [
          records(
            "missions",
            "Mission requirements",
            "Mission ID, required capability tags, required asset count, and time window.",
          ),
          records(
            "assets",
            "Force elements",
            "Asset ID, capability tags, availability, configuration, crew qualification, supply, and maintenance-limit state.",
          ),
        ],
        requiredEvidence: [
          "approved-mission-requirements",
          "configuration-status",
          "maintenance-status",
          "crew-qualification",
          "supply-readiness",
        ],
        authorityReferences: [
          "command-approved readiness definition",
          "applicable materiel and operational policy",
        ],
        requiredApproverRole:
          "Designated operational / materiel readiness authority",
        limitations: [
          "Does not determine operational suitability, threat outcome, or mission authorization.",
          "No classified data should enter a deployment not accredited for its classification.",
        ],
        exampleInputs: {
          missions: [
            { id: "M-1", requiredCapabilities: ["lift"], requiredCount: 2 },
          ],
          assets: [
            {
              id: "A-1",
              capabilities: ["lift"],
              available: true,
              configurationReady: true,
              crewQualified: true,
              supplyReady: true,
              maintenanceWithinLimit: true,
            },
          ],
        },
      }),
      method({
        key: "milspec-configuration",
        label: "MIL-SPEC configuration and obsolescence trace",
        purpose:
          "Check configuration-item identity, approved baseline, deviation/waiver, part status, and replacement qualification.",
        kind: "traceability",
        algorithm:
          "Every in-scope configuration item must match an approved baseline or carry an authorized deviation; obsolete items require an approved resolution path.",
        requiredInputs: [
          records(
            "configurationItems",
            "Configuration items",
            "CI, installed/current baseline, deviation or waiver, obsolescence state, replacement qualification, and evidence.",
          ),
        ],
        requiredEvidence: [
          "approved-configuration-baseline",
          "as-maintained-configuration",
          "deviations-and-waivers",
          "obsolescence-and-substitution-records",
        ],
        authorityReferences: [
          "contractually applicable MIL specifications and standards",
          "configuration-management plan",
          "authorized technical data",
        ],
        requiredApproverRole:
          "Configuration control / designated engineering authority",
        limitations: [
          "MIL-SPEC is not a single requirement set; applicability must come from the contract and approved baseline.",
          "Does not approve deviations, waivers, substitutions, or concessions.",
        ],
        exampleInputs: {
          configurationItems: [
            {
              id: "CI-1",
              installedRevision: "B",
              approvedRevision: "B",
              deviationApproved: false,
              obsolete: false,
              replacementQualified: null,
            },
          ],
        },
      }),
      method({
        key: "classified-deployment",
        label: "Classified / air-gapped deployment readiness",
        purpose:
          "Verify that the intended deployment has an approved classification boundary, accreditation evidence, controlled interfaces, and offline continuity.",
        kind: "readiness",
        algorithm:
          "All organization-defined accreditation and boundary controls must be evidenced; any egress, unapproved interface, or missing control blocks readiness.",
        requiredInputs: [
          records(
            "controls",
            "Deployment controls",
            "Control ID, required, implemented, tested, approved, evidence, and finding.",
          ),
          s(
            "classification",
            "Data classification",
            "Organization-assigned classification for the deployment.",
          ),
          s(
            "deploymentZone",
            "Deployment zone",
            "Approved network/security zone identifier.",
          ),
        ],
        requiredEvidence: [
          "authorization-or-accreditation",
          "system-security-plan",
          "boundary-and-data-flow",
          "offline-continuity-test",
          "supply-chain-approval",
        ],
        authorityReferences: [
          "organization security authority",
          "applicable national security policy",
          "system accreditation boundary",
        ],
        requiredApproverRole:
          "Authorizing official / security accreditation authority",
        limitations: [
          "Does not grant an authority to operate or handle classified information.",
          "The public SaaS deployment must never be assumed suitable for classified data.",
        ],
        exampleInputs: {
          classification: "organization-controlled",
          deploymentZone: "air-gapped-zone",
          controls: [
            {
              id: "egress-disabled",
              required: true,
              implemented: true,
              tested: true,
              approved: true,
              evidenceReference: "TEST-1",
            },
          ],
        },
      }),
    ],
  },
  {
    key: "aerospace-launch",
    industryCode: "aerospace_launch",
    label: "Aerospace & Launch — Reuse Life, Range Safety & Propellant",
    version: "1.0.0",
    reviewerRoleKey: "domain_launch_reviewer",
    purpose:
      "Track reusable-item life, range-safety evidence, and propellant condition without issuing flight or launch authorization.",
    dataClasses: [
      "operational",
      "safety_critical",
      "regulatory",
      "security_sensitive",
    ],
    methods: [
      method({
        key: "reuse-life",
        label: "Reusable hardware life accounting",
        purpose:
          "Calculate remaining approved life across cycles, hours, starts, thermal events, and component-specific counters.",
        kind: "engineering_calculation",
        algorithm:
          "For every controlled life counter, remaining = current approved limit - authenticated accumulated usage; minimum normalized remaining fraction governs the screen.",
        requiredInputs: [
          records(
            "items",
            "Reusable items",
            "Part/serial/configuration and counters with approved limit, accumulated usage, unit, and authenticated history state.",
          ),
        ],
        requiredEvidence: [
          "as-flown-configuration",
          "authenticated-mission-history",
          "current-life-limits",
          "inspection-and-refurbishment-records",
        ],
        authorityReferences: [
          "approved vehicle life-management plan",
          "design authority limits",
          "applicable launch licence conditions",
        ],
        requiredApproverRole: "Vehicle design / flightworthiness authority",
        limitations: [
          "Does not derive fatigue, fracture, thermal, or probabilistic life limits.",
          "Does not approve reuse, flight, or launch.",
        ],
        exampleInputs: {
          items: [
            {
              id: "engine-1",
              counters: [{ key: "starts", limit: 20, used: 7, unit: "starts" }],
              historyAuthenticated: true,
              configurationCurrent: true,
            },
          ],
        },
      }),
      method({
        key: "range-safety",
        label: "Range-safety evidence readiness",
        purpose:
          "Trace required hazards, constraints, analyses, approvals, and real-time prerequisites for a launch campaign.",
        kind: "readiness",
        algorithm:
          "Every range-defined requirement and hold point must have current evidence and explicit approval; unresolved or expired items block readiness.",
        requiredInputs: [
          records(
            "requirements",
            "Range-safety requirements",
            "Requirement, applicability, evidence, status, approval, validity, and hold-point state.",
          ),
        ],
        requiredEvidence: [
          "range-approved-requirements",
          "trajectory-and-debris-analyses",
          "flight-termination-system-status",
          "weather-and-public-safety-constraints",
          "launch-authorization-records",
        ],
        authorityReferences: [
          "applicable range authority",
          "launch licence",
          "approved mission rules",
        ],
        requiredApproverRole: "Range safety / launch authority",
        limitations: [
          "Does not perform debris, toxic, casualty-expectation, trajectory, or flight-termination analysis.",
          "Does not authorize launch or clear a range.",
        ],
        exampleInputs: {
          requirements: [
            {
              id: "RS-1",
              applicable: true,
              evidenceReference: "AN-1",
              status: "satisfied",
              approved: true,
              current: true,
            },
          ],
        },
      }),
      method({
        key: "propellant-degradation",
        label: "Propellant degradation screening",
        purpose:
          "Trend measured propellant properties and storage exposure against approved material-specific limits.",
        kind: "engineering_calculation",
        algorithm:
          "Calculate property margin and exposure consumption for each supplied limit; no chemistry or degradation rate is inferred without an approved model.",
        requiredInputs: [
          records(
            "properties",
            "Propellant condition properties",
            "Property, observed value, approved lower/upper limit, unit, method, sample time, and calibration.",
          ),
          records(
            "exposures",
            "Storage/handling exposures",
            "Exposure type, accumulated value, approved maximum, unit, and provenance.",
          ),
        ],
        requiredEvidence: [
          "material-specification",
          "sample-and-test-results",
          "storage-history",
          "handling-history",
          "approved-degradation-model-or-limits",
        ],
        authorityReferences: [
          "propellant material authority",
          "approved storage and handling specification",
          "mission-specific flight rules",
        ],
        requiredApproverRole: "Propellant / materials technical authority",
        limitations: [
          "Does not infer reaction kinetics, compatibility, stability, or safe life.",
          "Does not authorize loading, use, disposal, or flight.",
        ],
        exampleInputs: {
          properties: [
            {
              id: "density",
              observed: 1.01,
              lowerLimit: 0.99,
              upperLimit: 1.03,
              unit: "g/mL",
              methodApproved: true,
              calibrated: true,
            },
          ],
          exposures: [
            { id: "warm-storage", accumulated: 10, maximum: 30, unit: "h" },
          ],
        },
      }),
    ],
  },
  {
    key: "healthcare-clinical-engineering",
    industryCode: "healthcare",
    label: "Healthcare — Clinical Engineering Assurance",
    version: "1.0.0",
    reviewerRoleKey: "domain_healthcare_clinical_engineering_reviewer",
    purpose:
      "Screen medical-device reliability evidence for clinical criticality, availability, calibration, infection-control readiness, patient risk and traceability without making clinical decisions or releasing equipment for use.",
    dataClasses: ["operational", "safety_critical", "regulatory"],
    methods: [
      method({
        key: "clinical-criticality",
        label: "Clinical criticality trace",
        purpose: "Verify that every in-scope device has an authority-approved clinical function, consequence and criticality classification.",
        kind: "verification",
        algorithm: "Measure coverage of device records with canonical identity, clinical function, consequence, approved criticality and named authority approval.",
        requiredInputs: [records("devices", "Clinical device scope", "Device identity, clinical function, consequence category, approved criticality and authority approval.")],
        requiredEvidence: ["device-inventory", "clinical-service-definition", "approved-criticality-method", "criticality-approval-record"],
        authorityReferences: ["organization-approved clinical criticality method", "manufacturer intended use", "applicable medical-device requirements"],
        requiredApproverRole: "Clinical and biomedical engineering authority",
        limitations: ["Does not infer patient consequence or clinical criticality.", "Does not prioritize patients, prescribe care or authorize device use."],
        exampleInputs: { devices: [{ id: "device-001", clinicalFunction: "approved function", consequenceCategory: "approved category", approvedCriticality: "customer-defined", authorityApproved: true }] },
      }),
      method({
        key: "device-availability",
        label: "Device availability and alternative coverage",
        purpose: "Calculate availability only for an explicit device population and observation window, while exposing missing alternative-care and impairment evidence.",
        kind: "engineering_calculation",
        algorithm: "For each device, divide supplied available time by required time and verify service state, impairment disposition and approved alternative coverage.",
        requiredInputs: [records("devices", "Device availability records", "Device identity, available time, required time, unit, service state, impairment approval and alternative coverage.")],
        requiredEvidence: ["device-population", "availability-history", "clinical-service-requirements", "impairment-and-alternative-plan"],
        authorityReferences: ["approved clinical service requirement", "organization availability definition", "contingency and alternative-care plan"],
        requiredApproverRole: "Clinical operations and biomedical engineering authority",
        limitations: ["Does not infer required capacity or acceptable availability.", "Does not authorize substitution, deferral or continued clinical use."],
        exampleInputs: { devices: [{ id: "device-001", availableTime: 710, requiredTime: 720, unit: "h", serviceState: "controlled", impairmentApproved: true, alternativeCoverageApproved: true }] },
      }),
      method({
        key: "calibration-assurance",
        label: "Calibration assurance trace",
        purpose: "Verify calibration currency, traceability, approved tolerance and disposition for in-scope measuring functions.",
        kind: "traceability",
        algorithm: "Measure coverage where identity, current calibration, traceable standard, approved tolerance, result and disposition are all evidenced.",
        requiredInputs: [records("instruments", "Calibration records", "Device/function identity, calibration date/due date, traceable standard, approved tolerance, result and disposition.")],
        requiredEvidence: ["calibration-program", "calibration-certificates", "traceable-standards", "approved-tolerances-and-dispositions"],
        authorityReferences: ["manufacturer service information", "approved calibration program", "applicable metrology requirements"],
        requiredApproverRole: "Biomedical engineering / metrology authority",
        limitations: ["Does not invent tolerance, uncertainty or calibration interval.", "Does not declare a device calibrated or fit for clinical use."],
        exampleInputs: { instruments: [{ id: "device-001-pressure", calibrationCurrent: true, traceableStandard: "certificate reference", toleranceApproved: true, result: "within", dispositionApproved: true }] },
      }),
      method({
        key: "infection-control-readiness",
        label: "Infection-control readiness trace",
        purpose: "Verify approved cleaning, disinfection or sterilization method and current release evidence without declaring an item sterile.",
        kind: "readiness",
        algorithm: "Measure record coverage for device identity, approved classification/method, current cycle or process evidence, exception disposition and infection-prevention release.",
        requiredInputs: [records("devices", "Reprocessing readiness records", "Device identity, approved classification and method, current process evidence, exception disposition and release approval.")],
        requiredEvidence: ["manufacturer-reprocessing-instructions", "infection-prevention-approved-method", "cycle-or-process-records", "release-and-exception-records"],
        authorityReferences: ["manufacturer instructions for use", "infection prevention and control policy", "applicable reprocessing requirements"],
        requiredApproverRole: "Infection prevention and clinical operations authority",
        limitations: ["Does not invent a cleaning, disinfection or sterilization method.", "Does not declare sterility, release a device or authorize clinical use."],
        exampleInputs: { devices: [{ id: "device-001", classificationApproved: true, methodApproved: true, processEvidenceCurrent: true, exceptionsResolved: true, releaseApproved: true }] },
      }),
      method({
        key: "patient-risk",
        label: "Patient-risk control trace",
        purpose: "Trace device-related hazards to approved controls, current tests, residual-risk decisions and human acceptance.",
        kind: "verification",
        algorithm: "Measure coverage for hazard identity, consequence, implemented/tested controls, evidence binding, residual-risk classification and named acceptance.",
        requiredInputs: [records("hazards", "Device-related hazard records", "Hazard identity, approved consequence, implemented and tested controls, evidence binding, residual risk and acceptance.")],
        requiredEvidence: ["device-risk-file", "incident-and-hazard-history", "control-test-records", "residual-risk-acceptance"],
        authorityReferences: ["organization patient-safety risk process", "manufacturer risk information", "applicable medical-device vigilance requirements"],
        requiredApproverRole: "Patient safety, clinical and biomedical engineering authority",
        limitations: ["Does not calculate clinical risk without an approved method.", "Does not diagnose, recommend treatment or accept residual patient risk."],
        exampleInputs: { hazards: [{ id: "hazard-001", consequenceApproved: true, controlsImplemented: true, controlsTestCurrent: true, evidenceBound: true, residualRisk: "customer-defined", riskAccepted: true }] },
      }),
      method({
        key: "device-traceability",
        label: "Device identity and lifecycle trace",
        purpose: "Verify unique device identity, controlled configuration, location, ownership and complete maintenance, calibration and safety-action links.",
        kind: "traceability",
        algorithm: "Measure lifecycle trace coverage across canonical device identity, serial/model, location, configuration, service history, calibration state and safety-action status.",
        requiredInputs: [records("devices", "Device trace records", "Canonical identity, model/serial or UDI, location, owner, configuration, maintenance, calibration and safety-action status.")],
        requiredEvidence: ["device-inventory", "configuration-baseline", "maintenance-and-calibration-history", "recall-and-safety-action-register"],
        authorityReferences: ["organization device inventory policy", "manufacturer identification and configuration records", "applicable traceability requirements"],
        requiredApproverRole: "Healthcare technology management authority",
        limitations: ["Does not infer missing device identity, configuration or history.", "Patient identifiers must not be supplied or emitted."],
        exampleInputs: { devices: [{ id: "device-001", model: "controlled", serialOrUdi: "canonical-reference", location: "approved location", owner: "clinical engineering", configurationControlled: true, maintenanceLinked: true, calibrationStatus: "current", safetyActionsResolved: true }] },
      }),
    ],
  },
  {
    key: "civil-infrastructure",
    industryCode: "civil_infrastructure",
    label: "Civil Infrastructure — Condition, Restrictions and Renewal",
    version: "1.0.0",
    reviewerRoleKey: "domain_civil_infrastructure_reviewer",
    purpose: "Screen qualified inspection, condition, deterioration, load, geographic-hazard and renewal evidence without certifying safety or exercising owner authority.",
    dataClasses: ["operational", "safety_critical", "regulatory"],
    methods: [
      method({
        key: "structural-condition",
        label: "Structural condition evidence trace",
        purpose: "Trace component condition and defects to qualified observations, controlled configuration, severity and disposition.",
        kind: "verification",
        algorithm: "Measure coverage where every component/defect record has canonical identity, current qualified observation, approved severity scale and disposition.",
        requiredInputs: [records("components", "Structural condition records", "Asset/component identity, observation, date, qualified inspector, approved severity, configuration and disposition.")],
        requiredEvidence: ["asset-and-component-register", "qualified-inspection-records", "approved-condition-scale", "defect-disposition-register"],
        authorityReferences: ["owner-approved inspection manual", "applicable infrastructure inspection requirements", "engineer-of-record criteria"],
        requiredApproverRole: "Qualified civil/structural engineering authority",
        limitations: ["Does not infer material capacity or certify structural safety.", "Does not replace inspection, analysis, closure or repair authority."],
        exampleInputs: { components: [{ id: "bridge-01/girder-01", observation: "controlled finding", observedAt: "2026-09-01", qualifiedInspector: "credential reference", severityApproved: true, configurationCurrent: true, dispositionApproved: true }] },
      }),
      method({
        key: "inspection-rating",
        label: "Inspection rating and critical-finding trace",
        purpose: "Verify ratings against an approved scale and trace critical findings to required follow-up.",
        kind: "traceability",
        algorithm: "Measure records with approved rating method/scale, qualified inspection, review, critical-finding classification and controlled follow-up.",
        requiredInputs: [records("inspections", "Inspection rating records", "Asset/component, rating, approved scale/method, qualified inspector, review and critical-finding follow-up.")],
        requiredEvidence: ["inspection-program", "approved-rating-scale", "inspection-reports", "critical-finding-follow-up"],
        authorityReferences: ["owner inspection program", "applicable inspection and reporting requirements", "qualified inspection authority"],
        requiredApproverRole: "Infrastructure inspection program authority",
        limitations: ["Does not translate between rating systems or invent a rating.", "Does not close a critical finding or certify compliance."],
        exampleInputs: { inspections: [{ id: "inspection-001", assetId: "bridge-01", rating: "owner-scale-value", scaleApproved: true, methodApproved: true, inspectorQualified: true, reviewed: true, criticalFollowUpControlled: true }] },
      }),
      method({
        key: "deterioration-forecast",
        label: "Evidence-bounded deterioration forecast",
        purpose: "Apply only supplied, approved deterioration models within their calibrated applicability boundary.",
        kind: "engineering_calculation",
        algorithm: "For each series, apply supplied current value plus approved rate times horizon; block missing calibration, applicability or approved bounds and expose forecast uncertainty.",
        requiredInputs: [records("series", "Deterioration series", "Identity, current value, approved rate, horizon, unit, model approval, calibration and applicability.")],
        requiredEvidence: ["condition-observation-history", "approved-deterioration-model", "model-calibration-record", "applicability-and-uncertainty-basis"],
        authorityReferences: ["owner-approved deterioration model", "qualified materials/structural review", "asset-specific exposure history"],
        requiredApproverRole: "Qualified infrastructure deterioration-model authority",
        limitations: ["Does not invent deterioration rates, thresholds or remaining life.", "A projection is not a safety, intervention or service-life determination."],
        exampleInputs: { series: [{ id: "deck-01", currentValue: 8, ratePerYear: -0.2, horizonYears: 5, unit: "owner rating", modelApproved: true, calibrationCurrent: true, applicable: true }] },
      }),
      method({
        key: "load-restriction",
        label: "Load rating and restriction evidence screen",
        purpose: "Compare a supplied qualified rating factor with supplied approved criteria and verify posting/restriction implementation evidence.",
        kind: "engineering_calculation",
        algorithm: "Calculate margin between supplied rating factor and supplied criterion, while blocking stale/invalid analysis and surfacing unimplemented authority decisions.",
        requiredInputs: [records("ratings", "Load rating records", "Asset/load case, rating factor, approved criterion, analysis currency, qualified approval and restriction implementation.")],
        requiredEvidence: ["current-load-rating-analysis", "controlled-asset-condition-and-configuration", "applicable-legal-and-permit-load-basis", "posting-and-restriction-records"],
        authorityReferences: ["qualified load-rating analysis", "applicable owner and legal load requirements", "posting/restriction authority decision"],
        requiredApproverRole: "Qualified load-rating and infrastructure owner authority",
        limitations: ["Does not perform structural load rating or establish a legal load.", "Does not post, restrict, close, reopen or route traffic."],
        exampleInputs: { ratings: [{ id: "bridge-01/legal-load", ratingFactor: 1.08, approvedCriterion: 1, analysisCurrent: true, authorityApproved: true, restrictionRequired: false, restrictionImplemented: true }] },
      }),
      method({
        key: "geographic-risk",
        label: "Geographic hazard evidence overlay",
        purpose: "Trace assets to authority-approved hazard layers with explicit coordinate, resolution, vintage and overlap quality.",
        kind: "verification",
        algorithm: "Measure asset/layer overlay coverage only where geometry, coordinate reference, layer authority/vintage/resolution and approved overlap method are supplied.",
        requiredInputs: [records("overlays", "Asset hazard overlays", "Asset/layer identity, geometry and CRS control, approved layer, vintage, resolution, overlap method and review.")],
        requiredEvidence: ["canonical-asset-geometries", "approved-hazard-layers", "layer-metadata-and-vintage", "approved-overlay-method"],
        authorityReferences: ["owner-approved GIS governance", "applicable emergency/hazard authority", "qualified geospatial review"],
        requiredApproverRole: "Qualified geospatial and infrastructure risk authority",
        limitations: ["Does not invent hazard probability, threshold or consequence.", "Does not replace site investigation, emergency action or engineering analysis."],
        exampleInputs: { overlays: [{ id: "bridge-01/flood-layer", assetGeometryControlled: true, crsMatched: true, layerApproved: true, metadataCurrent: true, resolutionAccepted: true, overlapMethodApproved: true, reviewed: true }] },
      }),
      method({
        key: "renewal-planning",
        label: "Mandatory-first civil renewal planning",
        purpose: "Rank evidence-ready non-mandatory renewal candidates while preserving safety and regulatory obligations ahead of economics.",
        kind: "optimization",
        algorithm: "Sort mandatory candidates first by supplied due date, then rank evidence-ready non-mandatory candidates by approved weighted benefit divided by supplied cost.",
        requiredInputs: [records("candidates", "Renewal candidates", "Identity, mandatory status/due date, evidence readiness, cost and approved 0-5 factor scores."), records("weights", "Approved renewal weights", "Factor and non-negative approved weight."), n("budget", "Indicative planning envelope", "supplied currency", "Non-authorizing comparison envelope.")],
        requiredEvidence: ["condition-and-critical-finding-register", "approved-renewal-priority-model", "cost-estimate-basis", "network-service-and-community-consequence-basis", "mandatory-obligation-register"],
        authorityReferences: ["owner capital governance", "qualified engineering dispositions", "applicable mandatory obligations"],
        requiredApproverRole: "Infrastructure owner and qualified engineering authority",
        limitations: ["Does not defer mandatory work or authorize expenditure.", "Does not invent scores, weights, costs, benefits or due dates."],
        exampleInputs: { candidates: [{ id: "bridge-01-renewal", mandatory: true, dueDate: "2027-06-01", evidenceReady: true, cost: 1000000, safety: 5, service: 4 }], weights: [{ factor: "safety", weight: 0.7 }, { factor: "service", weight: 0.3 }], budget: 1500000 },
      }),
    ],
  },
  {
    key: "battery-energy-storage",
    industryCode: "battery_energy_storage",
    label: "Battery & Energy Storage — Safety and Degradation",
    version: "1.0.0",
    reviewerRoleKey: "domain_battery_safety_reviewer",
    purpose:
      "Screen measured thermal, high-voltage, electrochemical, and fire-barrier evidence against supplied approved criteria without declaring a battery safe or fit for service.",
    dataClasses: ["operational", "safety_critical", "regulatory"],
    methods: [
      method({
        key: "battery-thermal-envelope",
        label: "Thermal-management envelope screen",
        purpose:
          "Check traceable cell/module and coolant/air observations against asset-specific approved limits and thermal-control availability.",
        kind: "engineering_calculation",
        algorithm:
          "For every supplied observation, calculate margin to supplied lower/upper limits; flag missing calibration, stale evidence, unavailable cooling, and out-of-envelope values.",
        requiredInputs: [
          records(
            "observations",
            "Thermal observations",
            "Location, observed value, approved lower/upper limit, unit, timestamp, calibration state, and controlled configuration.",
          ),
          records(
            "thermalControls",
            "Thermal-management controls",
            "Required control, availability, current test, impairment approval, and compensating measure.",
          ),
        ],
        requiredEvidence: [
          "approved-thermal-envelope",
          "temperature-and-flow-history",
          "instrument-calibration",
          "thermal-control-test-records",
        ],
        authorityReferences: [
          "manufacturer-approved operating envelope",
          "site battery safety basis",
          "applicable electrical and fire requirements",
        ],
        requiredApproverRole: "Battery thermal / safety technical authority",
        limitations: [
          "Does not model heat generation, propagation, CFD, reaction kinetics, or safe separation.",
          "Does not infer a temperature limit or authorize continued operation.",
        ],
        exampleInputs: {
          observations: [
            {
              id: "module-01",
              observed: 31,
              lowerLimit: 10,
              upperLimit: 40,
              unit: "degC",
              observedAt: "2026-09-01T00:00:00Z",
              calibrated: true,
            },
          ],
          thermalControls: [
            {
              id: "cooling-loop-a",
              required: true,
              available: true,
              testCurrent: true,
            },
          ],
        },
      }),
      method({
        key: "battery-hv-safety",
        label: "High-voltage safety and protection trace",
        purpose:
          "Trace required isolation, grounding, overcurrent, interlock, emergency-stop, lockout, and arc-flash controls to current evidence and approval.",
        kind: "verification",
        algorithm:
          "Every in-scope required control must be implemented, tested, current, evidenced, and approved; impaired controls require an approved disposition and compensating measures.",
        requiredInputs: [
          records(
            "controls",
            "High-voltage controls",
            "Control, applicability, implementation, test/current state, evidence, impairment, compensating measure, and authority approval.",
          ),
        ],
        requiredEvidence: [
          "single-line-and-protection-design",
          "isolation-and-protection-test-records",
          "lockout-and-energized-work-procedures",
          "approved-arc-flash-and-electrical-safety-basis",
        ],
        authorityReferences: [
          "site electrical safety programme",
          "approved protection and coordination study",
          "applicable electrical and workplace-safety requirements",
        ],
        requiredApproverRole: "Electrical safety / protection authority",
        limitations: [
          "Does not perform arc-flash, protection-coordination, touch-potential, insulation, or short-circuit studies.",
          "Does not issue an energized-work permit or authorize energization.",
        ],
        exampleInputs: {
          controls: [
            {
              id: "main-dc-isolator",
              required: true,
              implemented: true,
              tested: true,
              current: true,
              evidenceReference: "TEST-HV-01",
              approved: true,
            },
          ],
        },
      }),
      method({
        key: "battery-degradation",
        label: "Electrochemical degradation screen",
        purpose:
          "Calculate measured capacity retention and resistance/impedance change against compatible baselines and supplied approved service criteria.",
        kind: "engineering_calculation",
        algorithm:
          "Capacity retention = measured capacity / compatible baseline capacity; resistance change = (measured - baseline) / baseline. Compare only to supplied asset-specific criteria and identify incompatible or missing bases.",
        requiredInputs: [
          records(
            "units",
            "Battery unit observations",
            "Unit/configuration, baseline and measured capacity, baseline and measured resistance/impedance, compatible-method flag, units, and approved criteria.",
          ),
        ],
        requiredEvidence: [
          "controlled-battery-configuration",
          "capacity-test-records",
          "resistance-or-impedance-test-records",
          "approved-service-criteria",
          "duty-cycle-and-exposure-history",
        ],
        authorityReferences: [
          "manufacturer-approved test method and limits",
          "site asset management and battery safety basis",
          "applicable product/listing requirements",
        ],
        requiredApproverRole:
          "Battery reliability / electrochemistry authority",
        limitations: [
          "Does not infer remaining useful life, reaction mechanism, state of health, or a universal end-of-life threshold.",
          "Results from incompatible temperature, SOC, duty, method, or configuration bases must not be compared.",
        ],
        exampleInputs: {
          units: [
            {
              id: "string-a",
              baselineCapacity: 100,
              measuredCapacity: 91,
              capacityUnit: "kWh",
              minimumCapacityRetention: 0.85,
              baselineResistance: 1.2,
              measuredResistance: 1.35,
              resistanceUnit: "mOhm",
              maximumResistanceChange: 0.25,
              compatibleMethod: true,
            },
          ],
        },
      }),
      method({
        key: "battery-fire-readiness",
        label: "Fire-barrier and emergency-readiness trace",
        purpose:
          "Check required detection, off-gas, ventilation, propagation, suppression, isolation, responder, and emergency-plan barriers for current evidence and governed impairment disposition.",
        kind: "readiness",
        algorithm:
          "Every required barrier must be available and current or carry an approved impairment with a named compensating measure; emergency prerequisites must be current and exercised where required.",
        requiredInputs: [
          records(
            "barriers",
            "Fire and propagation barriers",
            "Barrier, applicability, availability, test/current state, evidence, impairment approval, and compensating measure.",
          ),
          records(
            "emergencyPrerequisites",
            "Emergency prerequisites",
            "Plan, responder information, access/isolation, drill or validation, current state, evidence, and approval.",
          ),
        ],
        requiredEvidence: [
          "battery-fire-hazard-and-code-basis",
          "detection-ventilation-suppression-test-records",
          "barrier-and-impairment-register",
          "emergency-response-plan-and-drill-evidence",
        ],
        authorityReferences: [
          "authority having jurisdiction",
          "approved fire-protection and emergency-response basis",
          "manufacturer and chemistry-specific emergency information",
        ],
        requiredApproverRole: "Fire protection / battery emergency authority",
        limitations: [
          "Does not model fire growth, gas generation, explosion, tenability, propagation, suppression performance, or responder tactics.",
          "Does not certify code compliance or authorize occupancy, entry, firefighting, reset, or re-energization.",
        ],
        exampleInputs: {
          barriers: [
            {
              id: "off-gas-detection",
              required: true,
              available: true,
              testCurrent: true,
              evidenceReference: "TEST-FIRE-01",
            },
          ],
          emergencyPrerequisites: [
            {
              id: "site-response-plan",
              required: true,
              current: true,
              exercised: true,
              evidenceReference: "DRILL-01",
              approved: true,
            },
          ],
        },
      }),
    ],
  },
  {
    key: "buildings-infrastructure",
    industryCode: "buildings_infrastructure",
    label: "Buildings & Facilities — Safety, Controls, Performance & Renewal",
    version: "2.0.0",
    reviewerRoleKey: "domain_building_safety_reviewer",
    purpose:
      "Govern code and life-safety traceability, occupied-environment and BAS evidence, normalized energy/water performance, and facility-renewal priorities without claiming compliance or taking operational or spending authority.",
    dataClasses: ["operational", "safety_critical", "regulatory"],
    methods: [
      method({
        key: "code-compliance",
        label: "Jurisdictional code-compliance trace",
        purpose:
          "Map adopted-code requirements to design/as-built evidence, inspections, deficiencies, and authority disposition.",
        kind: "traceability",
        algorithm:
          "Every in-scope requirement from the supplied adopted-code register must have current evidence and an authority disposition; gaps remain open.",
        requiredInputs: [
          records(
            "requirements",
            "Code requirements",
            "Citation/requirement, applicability, evidence, inspection, deficiency, disposition, and authority status.",
          ),
        ],
        requiredEvidence: [
          "jurisdiction-and-adopted-code-register",
          "approved-design-documents",
          "as-built-records",
          "inspection-and-permit-records",
        ],
        authorityReferences: [
          "authority having jurisdiction",
          "adopted building and infrastructure codes",
          "approved alternative solutions",
        ],
        requiredApproverRole:
          "Authority having jurisdiction / designated code professional",
        limitations: [
          "Does not select the applicable code, interpret legal requirements, or certify compliance.",
          "Code editions and local amendments must be supplied by the project.",
        ],
        exampleInputs: {
          requirements: [
            {
              id: "REQ-1",
              applicable: true,
              evidenceReference: "DWG-A1",
              inspected: true,
              deficiencyStatus: null,
              authorityDisposition: "accepted",
            },
          ],
        },
      }),
      method({
        key: "fire-life-safety",
        label: "Fire and life-safety impairment/readiness model",
        purpose:
          "Check required systems, inspection/test status, impairments, compensating measures, and evacuation assumptions.",
        kind: "readiness",
        algorithm:
          "Every required fire/life-safety function must be available and current or have an approved impairment permit and compensating measures.",
        requiredInputs: [
          records(
            "systems",
            "Fire/life-safety systems",
            "Function, required, available, test due/current, impairment, compensating measure, and approval.",
          ),
          records(
            "egressZones",
            "Egress/occupant zones",
            "Zone, design occupants, current occupants, available exits, approved required exits, and accessibility provisions.",
          ),
        ],
        requiredEvidence: [
          "fire-safety-plan",
          "inspection-test-maintenance-records",
          "impairment-permits",
          "egress-and-occupant-basis",
          "emergency-drill-or-validation",
        ],
        authorityReferences: [
          "authority having jurisdiction",
          "approved fire-safety plan",
          "adopted fire and life-safety requirements",
        ],
        requiredApproverRole: "Fire protection / life-safety authority",
        limitations: [
          "Does not perform hydraulic, smoke-control, evacuation-time, tenability, or fire-dynamics modelling.",
          "Does not authorize occupancy during an impairment.",
        ],
        exampleInputs: {
          systems: [
            {
              id: "sprinkler",
              required: true,
              available: true,
              testCurrent: true,
              impairmentApproved: false,
            },
          ],
          egressZones: [
            {
              id: "L1",
              designOccupants: 200,
              currentOccupants: 150,
              availableExits: 3,
              requiredExits: 2,
              accessibilityProvisionCurrent: true,
            },
          ],
        },
      }),
      method({
        key: "occupancy-accessibility",
        label: "Occupancy and accessibility certification workflow",
        purpose:
          "Trace permit, inspection, deficiency, accessibility, life-safety, and authority sign-off prerequisites.",
        kind: "traceability",
        algorithm:
          "All organization/jurisdiction-required certificate prerequisites must be present, current, accepted, and free of unresolved blocking deficiencies.",
        requiredInputs: [
          records(
            "prerequisites",
            "Certification prerequisites",
            "Requirement, required, evidence, inspection result, deficiency state, authority acceptance, and expiry.",
          ),
        ],
        requiredEvidence: [
          "permit-register",
          "final-inspection-records",
          "accessibility-review",
          "fire-and-life-safety-clearance",
          "authority-certificate",
        ],
        authorityReferences: [
          "authority having jurisdiction",
          "adopted occupancy and accessibility requirements",
        ],
        requiredApproverRole:
          "Authority having jurisdiction / designated accessibility professional",
        limitations: [
          "Does not issue an occupancy permit or accessibility certification.",
          "Accessibility is not reduced to a checklist; professional and user review remain required.",
        ],
        exampleInputs: {
          prerequisites: [
            {
              id: "final-inspection",
              required: true,
              evidenceReference: "INSP-1",
              result: "accepted",
              blockingDeficiency: false,
              authorityAccepted: true,
            },
          ],
        },
      }),
      method({
        key: "occupant-environment",
        label: "Occupied-zone comfort and indoor-environment screen",
        purpose:
          "Compare occupied-zone observations with supplied, approved comfort and indoor-environment envelopes while retaining calibration and occupancy context.",
        kind: "verification",
        algorithm:
          "Each occupied observation is checked against its supplied temperature, humidity, and CO₂ limits; compliance is reported by occupied hours only.",
        requiredInputs: [
          records(
            "observations",
            "Occupied-zone observations",
            "Zone, occupied hours, measured temperature/humidity/CO₂, approved limits, calibration, timestamp, and criteria approval.",
          ),
        ],
        requiredEvidence: [
          "approved-indoor-environment-criteria",
          "occupancy-schedule",
          "bas-or-independent-trend-data",
          "sensor-calibration",
        ],
        authorityReferences: [
          "facility-owner indoor-environment criteria",
          "applicable occupational health and building requirements",
          "qualified indoor-environment professional",
        ],
        requiredApproverRole:
          "Facility operations / indoor-environment authority",
        limitations: [
          "Does not diagnose indoor-air-quality hazards or certify occupant safety or comfort.",
          "No universal comfort, humidity, or CO₂ threshold is inferred.",
        ],
        exampleInputs: {
          observations: [
            {
              id: "ZONE-2-2026-08-01",
              zone: "Level 2 occupied office",
              occupiedHours: 8,
              temperatureC: 23,
              temperatureMinC: 20,
              temperatureMaxC: 25,
              relativeHumidityPct: 42,
              humidityMinPct: 30,
              humidityMaxPct: 60,
              co2Ppm: 760,
              co2MaxPpm: 1000,
              criteriaApproved: true,
              calibrated: true,
              observedAt: "2026-08-01T20:00:00Z",
            },
          ],
        },
      }),
      method({
        key: "bas-control-integrity",
        label: "Building-automation control integrity",
        purpose:
          "Screen command/feedback agreement, alarm and fail-safe tests, trend completeness, and manual overrides for critical BAS points.",
        kind: "verification",
        algorithm:
          "A required control point is complete only when command/feedback deviation is within its supplied tolerance, tests are current, trends are complete, and any override is approved.",
        requiredInputs: [
          records(
            "controlPoints",
            "BAS control points",
            "Point identity, command, feedback, tolerance, alarm/fail-safe tests, trend completeness, override state, and approval.",
          ),
        ],
        requiredEvidence: [
          "approved-control-sequences",
          "bas-point-and-trend-export",
          "alarm-and-fail-safe-test-records",
          "override-and-bypass-register",
        ],
        authorityReferences: [
          "approved sequence of operations",
          "facility controls standard",
          "life-safety interface requirements",
        ],
        requiredApproverRole: "Facility controls / BAS authority",
        limitations: [
          "Read-only analysis; it cannot command, tune, bypass, or acknowledge a BAS point.",
          "A matching command and feedback does not prove physical-system performance.",
        ],
        exampleInputs: {
          controlPoints: [
            {
              id: "AHU-2-SAT",
              required: true,
              commandValue: 13,
              feedbackValue: 13.2,
              tolerance: 0.5,
              alarmTestCurrent: true,
              failSafeTestCurrent: true,
              trendComplete: true,
              manualOverrideActive: false,
              overrideApproved: false,
            },
          ],
        },
      }),
      method({
        key: "energy-water-performance",
        label: "Normalized energy and water performance",
        purpose:
          "Compare metered energy and water with a supplied, approved, like-for-like normalized baseline without inventing savings.",
        kind: "engineering_calculation",
        algorithm:
          "For comparable periods, variance = actual - approved normalized baseline and variance percent = variance / baseline; incomparable periods remain gaps.",
        requiredInputs: [
          records(
            "periods",
            "Normalized performance periods",
            "Period, actual and baseline energy/water, normalization approval, boundary equivalence, and accepted data quality.",
          ),
        ],
        requiredEvidence: [
          "metered-energy-and-water-data",
          "approved-normalized-baseline",
          "weather-occupancy-and-service-drivers",
          "meter-and-boundary-quality-review",
        ],
        authorityReferences: [
          "facility-owner energy and water objectives",
          "approved measurement and verification plan",
          "applicable reporting requirements",
        ],
        requiredApproverRole: "Energy manager / facility performance authority",
        limitations: [
          "Does not attribute causality, certify savings, or create a financial benefit claim.",
          "Weather, occupancy, service, tariff, meter, and boundary normalization must be supplied and approved.",
        ],
        exampleInputs: {
          periods: [
            {
              id: "2026-07",
              actualEnergyKwh: 92000,
              baselineEnergyKwh: 100000,
              actualWaterM3: 1210,
              baselineWaterM3: 1250,
              normalizationApproved: true,
              boundaryEquivalent: true,
              dataQualityAccepted: true,
            },
          ],
        },
      }),
      method({
        key: "facility-renewal-priority",
        label: "Facility renewal and capital priority",
        purpose:
          "Rank evidence-ready facility renewal candidates using organization-approved weights while keeping life-safety and mandatory compliance work outside economic trade-off.",
        kind: "optimization",
        algorithm:
          "Mandatory candidates rank first by due date; other candidates rank by approved weighted benefit score divided by cost. The budget line is indicative and never an authorization.",
        requiredInputs: [
          n(
            "availableBudget",
            "Indicative available budget",
            "currency",
            "Planning envelope only; not expenditure authorization.",
          ),
          matrix(
            "weights",
            "Approved priority weights",
            "Non-negative weights for safety, compliance, service, condition, and energy opportunity, with approval reference.",
          ),
          records(
            "candidates",
            "Renewal candidates",
            "Candidate identity, cost, evidence readiness, mandatory status/due date, and 0–5 factor scores.",
          ),
        ],
        requiredEvidence: [
          "approved-capital-priority-model",
          "condition-and-deficiency-register",
          "cost-estimate-basis",
          "service-and-occupant-consequence-basis",
          "energy-opportunity-basis",
        ],
        authorityReferences: [
          "facility-owner capital governance",
          "approved life-safety and compliance obligations",
          "organization-approved investment criteria",
        ],
        requiredApproverRole:
          "Facility portfolio owner / capital approval authority",
        limitations: [
          "Does not approve expenditure, defer mandatory work, or represent a full portfolio optimization.",
          "Scores, weights, costs, dependencies, and the planning envelope require human validation.",
        ],
        exampleInputs: {
          availableBudget: 750000,
          weights: {
            approved: true,
            approvalReference: "CAP-PRIORITY-2026",
            safety: 5,
            compliance: 5,
            service: 3,
            condition: 2,
            energy: 1,
          },
          candidates: [
            {
              id: "FIRE-PUMP-1",
              cost: 300000,
              mandatory: true,
              dueDate: "2026-10-01",
              evidenceReady: true,
              safety: 5,
              compliance: 5,
              service: 4,
              condition: 4,
              energy: 0,
            },
            {
              id: "AHU-2-RENEWAL",
              cost: 420000,
              mandatory: false,
              evidenceReady: true,
              safety: 1,
              compliance: 1,
              service: 4,
              condition: 5,
              energy: 4,
            },
          ],
        },
      }),
    ],
  },
];

export function getDomainSpecialistModule(
  key: DomainSpecialistModuleKey | string,
): DomainSpecialistModule | null {
  return DOMAIN_SPECIALIST_MODULES.find((module) => module.key === key) ?? null;
}

export function getDomainSpecialistMethod(
  moduleKey: DomainSpecialistModuleKey | string,
  methodKey: string,
): DomainMethodDefinition | null {
  return (
    getDomainSpecialistModule(moduleKey)?.methods.find(
      (candidate) => candidate.key === methodKey,
    ) ?? null
  );
}
