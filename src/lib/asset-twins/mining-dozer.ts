import {
  centrifugalPumpComponentDna,
  coolingSystemDna,
  frictionBrakeDna,
  hydraulicCylinderDna,
  industrialGearboxComponentDna,
  lubricationSystemDna,
  rollingElementBearingDna,
  switchgearDna,
} from "./shared-component-dna-library";
import type { AssetClassTemplate, FailureModeTemplate } from "./types";

const draftFailure = (
  code: string,
  componentCode: string,
  name: string,
  mechanism: string,
  causes: string[],
  effects: string[],
  detectableBy: string[],
  verificationMethods: string[],
  severity: 1 | 2 | 3 | 4 | 5,
): FailureModeTemplate => ({
  code,
  componentCode,
  name,
  mechanism,
  causes,
  effects,
  detectableBy,
  verificationMethods,
  recommendedActions: [],
  severity,
  evidence: [],
  reviewState: "draft",
});

/**
 * Manufacturer-neutral large track-type mining dozer.
 *
 * Wheel-dozer geometry shares power, hydraulic, and implement concepts; running
 * gear is site-specific. This is one asset class, not a second hierarchy.
 * Undercarriage, blade, and hydraulic intelligence is referenced through
 * shared component DNA used by haul-truck and hydraulic-shovel classes — it
 * does not copy `MIN-HAUL-TRUCK`, `MIN-WHEEL-LOADER`, or `MIN-HYD-SHOVEL`.
 *
 * There is no dedicated undercarriage COMP-DNA. Roller and idler support
 * reuses bearing and lubrication DNA; track-chain, sprocket, and shoe wear
 * remain local draft mechanisms. Numeric intervals, wear limits, and
 * retirement criteria require approved OEM or site evidence. Recommend does
 * not authorize work.
 */
export const miningDozerTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "MIN-DOZER",
  name: "Large mining dozer",
  family: "mobile_mining_support",
  description:
    "Governed component, failure, telemetry, and inspection foundation for large track-type mining dozers. Draft manufacturer-neutral content only; limits and intervals require approved evidence.",
  functions: [
    "push",
    "rip",
    "grade",
    "steer",
    "propel",
    "control_hydraulic_power",
    "cool",
  ],
  operatingStates: [
    "offline",
    "idle",
    "pushing",
    "ripping",
    "grading",
    "travelling",
    "maintenance_test",
  ],
  standards: ["ISO 55000", "ISO 13374", "ISO 23247"],
  reviewState: "draft",
  components: [
    {
      code: "DZ-STRUCT",
      name: "Main frame, track frames, and protective structure",
      functions: [
        "support operating loads",
        "maintain geometry",
        "transfer blade, ripper, and propel reactions",
      ],
      telemetryConcepts: [
        "structural_strain",
        "cycle_count",
        "shock_load",
        "blade_load",
      ],
      inspectionZones: [
        "main frame",
        "track frames",
        "blade push arms or C-frame",
        "ripper frame",
        "ROPS or FOPS structure",
      ],
      failureModes: [
        draftFailure(
          "DZ-STRUCT-FATIGUE",
          "DZ-STRUCT",
          "Structural fatigue cracking or distortion",
          "fatigue crack initiation and propagation under cyclic pushing, ripping, and impact loads",
          [
            "cyclic loading",
            "stress concentration",
            "impact",
            "corrosion",
            "geometry deviation",
          ],
          [
            "reduced structural capacity",
            "load-path redistribution",
            "restricted implement motion",
          ],
          [
            "drone_rgb",
            "drone_thermal",
            "drone_lidar",
            "strain_monitoring",
            "inspection",
          ],
          [
            "non_destructive_testing",
            "dimensional_survey",
            "structural_engineering_assessment",
          ],
          5,
        ),
      ],
    },
    {
      code: "DZ-UNDERCARRIAGE",
      name: "Track chain, rollers, idlers, sprockets, and shoes",
      sharedComponentDnaCodes: [
        rollingElementBearingDna.code,
        lubricationSystemDna.code,
      ],
      functions: [
        "support machine mass",
        "convert drive torque into travel",
        "maintain track guidance",
      ],
      telemetryConcepts: [
        "track_speed",
        "roller_temperature",
        "idler_temperature",
        "track_tension_state",
        "travel_hours",
      ],
      inspectionZones: [
        "track chains and pins",
        "track rollers",
        "carrier rollers",
        "idlers",
        "sprockets",
        "track shoes",
      ],
      failureModes: [
        draftFailure(
          "DZ-UNDERCARRIAGE-WEAR",
          "DZ-UNDERCARRIAGE",
          "Track, roller, idler, or sprocket wear or seizure",
          "abrasion, lubrication loss, or seizure changes pitch, guidance, and rolling resistance",
          [
            "abrasive ground",
            "lubrication loss",
            "contamination",
            "incorrect track tension",
            "impact",
          ],
          [
            "accelerated related-part wear",
            "loss of traction or guidance",
            "abnormal heat",
            "restricted travel",
          ],
          [
            "drone_rgb",
            "drone_thermal",
            "inspection",
            "temperature",
            "operator_observation",
          ],
          [
            "wear_measurement",
            "seal_and_leak_inspection",
            "roller_rotation_check",
            "engineer_visual",
          ],
          5,
        ),
      ],
    },
    {
      code: "DZ-IMPLEMENT",
      name: "Blade, ripper, and ground-engaging tools",
      sharedComponentDnaCodes: [hydraulicCylinderDna.code],
      functions: [
        "cut and move material",
        "control blade and ripper geometry",
        "resist abrasion and impact",
      ],
      telemetryConcepts: [
        "blade_position",
        "ripper_position",
        "cylinder_pressure",
        "implement_load",
      ],
      inspectionZones: [
        "blade or moldboard",
        "cutting edges and bits",
        "ripper shank and tip",
        "pins and bushings",
        "cylinder mounts",
      ],
      failureModes: [
        draftFailure(
          "DZ-IMPLEMENT-WEAR",
          "DZ-IMPLEMENT",
          "Blade, ripper, pin, or wear-surface degradation",
          "abrasion, impact, or joint wear changes cutting geometry and load paths",
          [
            "abrasive feed",
            "impact",
            "lubrication loss",
            "loose hardware",
            "misalignment",
          ],
          [
            "reduced cutting or ripping effectiveness",
            "excess joint clearance",
            "secondary structural damage",
          ],
          ["drone_rgb", "inspection", "cylinder_position", "operator_observation"],
          [
            "wear_measurement",
            "dimensional_inspection",
            "qualified_mechanical_inspection",
          ],
          4,
        ),
      ],
    },
    {
      code: "DZ-POWER",
      name: "Prime mover and cooling",
      sharedComponentDnaCodes: [coolingSystemDna.code],
      functions: [
        "generate propulsion and hydraulic power",
        "support auxiliaries",
        "reject heat",
      ],
      telemetryConcepts: [
        "engine_speed",
        "fuel_rate",
        "coolant_temperature",
        "oil_pressure",
        "exhaust_temperature",
      ],
      inspectionZones: [
        "engine",
        "cooling pack",
        "intake",
        "exhaust",
        "mounts",
      ],
      failureModes: [
        draftFailure(
          "DZ-POWER-OVERHEAT",
          "DZ-POWER",
          "Abnormal power-system heating",
          "heat generation exceeds cooling or lubrication capacity",
          [
            "cooling restriction",
            "overload",
            "lubrication loss",
            "combustion imbalance",
          ],
          ["derate", "accelerated wear", "loss of propulsion"],
          ["temperature", "drone_thermal", "fault_code", "inspection"],
          [
            "cooling_system_test",
            "oil_analysis",
            "engine_performance_test",
          ],
          4,
        ),
      ],
    },
    {
      code: "DZ-DRIVE",
      name: "Transmission and final drives",
      sharedComponentDnaCodes: [
        industrialGearboxComponentDna.code,
        rollingElementBearingDna.code,
      ],
      functions: [
        "transmit power",
        "control travel speed and direction",
        "support track torque",
      ],
      telemetryConcepts: [
        "transmission_temperature",
        "gear_selection",
        "final_drive_temperature",
        "oil_debris",
        "track_speed",
      ],
      inspectionZones: [
        "transmission",
        "steering drive or differential",
        "final drives",
        "drive shafts",
        "breathers",
      ],
      failureModes: [
        draftFailure(
          "DZ-DRIVE-DEGRADE",
          "DZ-DRIVE",
          "Transmission or final-drive degradation",
          "wear, contamination, or lubrication loss increases heat, noise, and clearance",
          [
            "lubrication loss",
            "contamination",
            "seal deterioration",
            "overload",
            "misalignment",
          ],
          [
            "abnormal heat",
            "oil leakage",
            "loss of propulsion",
            "secondary gear damage",
          ],
          [
            "oil_analysis",
            "thermal",
            "vibration",
            "inspection",
            "operator_observation",
          ],
          [
            "oil_sample_confirmation",
            "drivetrain_inspection",
            "seal_leak_inspection",
          ],
          5,
        ),
      ],
    },
    {
      code: "DZ-HYD",
      name: "Hydraulic power and actuation",
      sharedComponentDnaCodes: [
        centrifugalPumpComponentDna.code,
        hydraulicCylinderDna.code,
        coolingSystemDna.code,
      ],
      functions: [
        "generate hydraulic flow",
        "control blade and ripper motion",
        "reject hydraulic heat",
      ],
      telemetryConcepts: [
        "system_pressure",
        "oil_temperature",
        "pump_command",
        "cylinder_position",
        "fluid_level",
        "filter_differential_pressure",
      ],
      inspectionZones: [
        "pumps",
        "valves",
        "cylinders",
        "hoses",
        "reservoir",
        "coolers",
      ],
      failureModes: [
        draftFailure(
          "DZ-HYD-DEGRADE",
          "DZ-HYD",
          "Hydraulic pump, valve, hose, or cylinder degradation",
          "contamination, overheating, cavitation, or seal deterioration reduces force and containment",
          [
            "contamination",
            "overheating",
            "cavitation",
            "seal deterioration",
            "hose damage",
          ],
          [
            "loss of implement force",
            "uncontrolled leakage",
            "heat generation",
            "function loss",
          ],
          [
            "oil_analysis",
            "pressure",
            "temperature",
            "drone_thermal",
            "inspection",
          ],
          [
            "hydraulic_performance_test",
            "oil_sample_confirmation",
            "leak_source_inspection",
          ],
          5,
        ),
      ],
    },
    {
      code: "DZ-STEER",
      name: "Steering clutches, brakes, or differential steer",
      sharedComponentDnaCodes: [
        frictionBrakeDna.code,
        hydraulicCylinderDna.code,
      ],
      functions: [
        "control direction",
        "hold or release track torque",
        "support pivot or gradual turns",
      ],
      telemetryConcepts: [
        "steering_command",
        "brake_or_clutch_pressure",
        "left_track_speed",
        "right_track_speed",
        "fault_code",
      ],
      inspectionZones: [
        "steering clutches or differential",
        "steering brakes",
        "control linkages or valves",
        "accumulators",
        "lines",
      ],
      failureModes: [
        draftFailure(
          "DZ-STEER-DEGRADE",
          "DZ-STEER",
          "Steering clutch, brake, or differential degradation",
          "friction, leakage, or incomplete release prevents controlled turning or holding",
          [
            "friction-material wear",
            "hydraulic leakage",
            "contamination",
            "control fault",
            "mechanical binding",
          ],
          [
            "poor directional control",
            "uncommanded drag",
            "thermal damage",
            "loss of holding",
          ],
          [
            "drone_thermal",
            "pressure",
            "track_speed",
            "fault_code",
            "inspection",
          ],
          [
            "functional_steer_test",
            "pressure_hold_test",
            "qualified_brake_inspection",
          ],
          5,
        ),
      ],
    },
    {
      code: "DZ-ELEC-CTRL",
      name: "Electrical power, controls, and protection",
      sharedComponentDnaCodes: [switchgearDna.code],
      functions: [
        "distribute electrical power",
        "control machine functions",
        "protect personnel and equipment",
        "record faults",
      ],
      telemetryConcepts: [
        "voltage",
        "current",
        "cabinet_temperature",
        "fault_code",
        "communication_health",
      ],
      inspectionZones: [
        "electrical cabinets",
        "batteries",
        "terminations",
        "sensors",
        "control networks",
      ],
      failureModes: [
        draftFailure(
          "DZ-ELEC-DEGRADE",
          "DZ-ELEC-CTRL",
          "Electrical connection, control, or protection fault",
          "loose connections, contamination, or sensor faults compromise control or protective response",
          [
            "loose connections",
            "contamination",
            "corrosion",
            "sensor damage",
            "configuration error",
          ],
          [
            "thermal damage",
            "nuisance trip",
            "loss of function",
            "loss of protection",
          ],
          ["thermal", "fault_code", "current_imbalance", "inspection"],
          [
            "deenergized_electrical_inspection",
            "insulation_test",
            "configuration_review",
          ],
          5,
        ),
      ],
    },
  ],
};
