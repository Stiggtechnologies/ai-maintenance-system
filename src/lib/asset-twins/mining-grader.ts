import {
  centrifugalPumpComponentDna,
  coolingSystemDna,
  frictionBrakeDna,
  hydraulicCylinderDna,
  industrialGearboxComponentDna,
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
 * Manufacturer-neutral motor grader.
 *
 * Circle, drawbar, and moldboard geometry is the class-characteristic wear
 * group. Power, hydraulic, drive, and brake intelligence is referenced through
 * shared component DNA used by haul-truck, wheel-loader, and dozer classes —
 * it does not copy those templates.
 *
 * Numeric intervals, circle-clearance limits, and retirement criteria require
 * approved OEM or site evidence. Recommend does not authorize work.
 */
export const miningGraderTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "MIN-GRADER",
  name: "Motor grader",
  family: "mobile_mining_support",
  description:
    "Governed component, failure, telemetry, and inspection foundation for motor graders. Draft manufacturer-neutral content only; limits and intervals require approved evidence.",
  functions: [
    "grade",
    "scarify",
    "steer",
    "travel",
    "control_blade_geometry",
    "control_hydraulic_power",
  ],
  operatingStates: [
    "offline",
    "idle",
    "grading",
    "scarifying",
    "travelling",
    "articulating",
    "maintenance_test",
  ],
  standards: ["ISO 55000", "ISO 13374", "ISO 23247"],
  reviewState: "draft",
  components: [
    {
      code: "GR-STRUCT",
      name: "Main frame, articulation, and circle support",
      functions: [
        "support operating loads",
        "maintain frame and circle geometry",
        "transfer blade and travel reactions",
      ],
      telemetryConcepts: [
        "structural_strain",
        "articulation_angle",
        "cycle_count",
        "blade_load",
      ],
      inspectionZones: [
        "front frame",
        "rear frame",
        "articulation joint",
        "circle support or drawbar mounts",
        "ROPS or FOPS structure",
      ],
      failureModes: [
        draftFailure(
          "GR-STRUCT-FATIGUE",
          "GR-STRUCT",
          "Structural fatigue cracking or distortion",
          "fatigue crack initiation and propagation under cyclic grading, articulation, and impact loads",
          [
            "cyclic loading",
            "stress concentration",
            "impact",
            "corrosion",
            "geometry deviation",
          ],
          [
            "reduced structural capacity",
            "circle or articulation misalignment",
            "restricted blade motion",
          ],
          [
            "drone_rgb",
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
      code: "GR-CIRCLE-BLADE",
      name: "Circle, drawbar, moldboard, and scarifier",
      sharedComponentDnaCodes: [hydraulicCylinderDna.code],
      functions: [
        "position and hold the moldboard",
        "rotate the circle",
        "cut and spread material",
        "scarify compacted surfaces",
      ],
      telemetryConcepts: [
        "circle_position",
        "blade_angle",
        "blade_height",
        "cylinder_pressure",
        "circle_drive_load",
      ],
      inspectionZones: [
        "circle and teeth",
        "drawbar",
        "moldboard",
        "cutting edges",
        "circle drive",
        "pins and wear strips",
        "scarifier",
      ],
      failureModes: [
        draftFailure(
          "GR-CIRCLE-BLADE-WEAR",
          "GR-CIRCLE-BLADE",
          "Circle, drawbar, moldboard, or wear-strip degradation",
          "abrasion, impact, or joint wear changes blade geometry and circle backlash",
          [
            "abrasive grading",
            "impact",
            "lubrication loss",
            "loose hardware",
            "misalignment",
          ],
          [
            "poor grade control",
            "excess circle backlash",
            "cutting-edge loss",
            "secondary structural damage",
          ],
          [
            "drone_rgb",
            "inspection",
            "circle_position",
            "operator_observation",
          ],
          [
            "wear_measurement",
            "backlash_or_clearance_check",
            "qualified_mechanical_inspection",
          ],
          4,
        ),
      ],
    },
    {
      code: "GR-POWER",
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
          "GR-POWER-OVERHEAT",
          "GR-POWER",
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
      code: "GR-DRIVE",
      name: "Transmission, tandems, and final drives",
      sharedComponentDnaCodes: [
        industrialGearboxComponentDna.code,
        rollingElementBearingDna.code,
      ],
      functions: [
        "transmit power",
        "control travel speed",
        "support tandem-axle torque",
      ],
      telemetryConcepts: [
        "transmission_temperature",
        "gear_selection",
        "tandem_temperature",
        "wheel_speed",
        "oil_debris",
      ],
      inspectionZones: [
        "transmission",
        "tandem housings",
        "final drives",
        "drive shafts",
        "breathers",
      ],
      failureModes: [
        draftFailure(
          "GR-DRIVE-DEGRADE",
          "GR-DRIVE",
          "Transmission, tandem, or final-drive degradation",
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
      code: "GR-HYD",
      name: "Hydraulic power and blade actuation",
      sharedComponentDnaCodes: [
        centrifugalPumpComponentDna.code,
        hydraulicCylinderDna.code,
        coolingSystemDna.code,
      ],
      functions: [
        "generate hydraulic flow",
        "control blade, circle, and articulation motion",
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
          "GR-HYD-DEGRADE",
          "GR-HYD",
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
            "loss of blade or circle control",
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
      code: "GR-STEER-ARTIC",
      name: "Front-axle steering and frame articulation",
      sharedComponentDnaCodes: [hydraulicCylinderDna.code],
      functions: [
        "control direction",
        "articulate the frame",
        "lean the front wheels where fitted",
      ],
      telemetryConcepts: [
        "steering_angle",
        "articulation_angle",
        "steering_pressure",
        "wheel_lean_position",
      ],
      inspectionZones: [
        "steering cylinders",
        "articulation cylinders",
        "front axle",
        "linkages",
        "pins",
      ],
      failureModes: [
        draftFailure(
          "GR-STEER-ARTIC-LEAK",
          "GR-STEER-ARTIC",
          "Steering or articulation leakage or joint wear",
          "seal, hose, or pin wear permits fluid escape or geometry loss",
          [
            "seal wear",
            "hose damage",
            "contamination",
            "impact",
            "loose fitting",
          ],
          [
            "loss of steering or articulation authority",
            "environmental release",
            "excess joint clearance",
          ],
          ["drone_rgb", "inspection", "pressure", "fluid_level"],
          [
            "leak_source_inspection",
            "pressure_hold_test",
            "dimensional_inspection",
          ],
          4,
        ),
      ],
    },
    {
      code: "GR-BRAKE",
      name: "Service braking and parking brake",
      sharedComponentDnaCodes: [frictionBrakeDna.code],
      functions: [
        "decelerate the machine",
        "hold the machine stationary",
        "protect personnel",
      ],
      telemetryConcepts: [
        "brake_pressure",
        "parking_brake_state",
        "deceleration",
        "fault_code",
      ],
      inspectionZones: [
        "service brakes",
        "parking brake",
        "accumulators",
        "lines",
      ],
      failureModes: [
        draftFailure(
          "GR-BRAKE-PRESSURE-LOSS",
          "GR-BRAKE",
          "Brake pressure loss or incomplete release",
          "stored or delivered braking energy is not retained, or residual drag generates heat",
          [
            "leak",
            "accumulator fault",
            "release fault",
            "contamination",
            "control fault",
          ],
          [
            "increased stopping distance",
            "thermal damage",
            "loss of holding",
          ],
          ["pressure", "fault_code", "drone_thermal", "inspection"],
          [
            "pressure_hold_test",
            "functional_brake_test",
            "qualified_brake_inspection",
          ],
          5,
        ),
      ],
    },
    {
      code: "GR-ELEC-CTRL",
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
          "GR-ELEC-DEGRADE",
          "GR-ELEC-CTRL",
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
