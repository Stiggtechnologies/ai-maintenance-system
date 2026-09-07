import {
  flexibleCouplingDna,
  hydraulicCylinderDna,
  industrialAcMotorDna,
  industrialGearboxComponentDna,
  lubricationSystemDna,
  rollingElementBearingDna,
  switchgearDna,
  variableFrequencyDriveDna,
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
 * Manufacturer-neutral mobile crusher (tracked or wheeled plant).
 *
 * Crushing-chamber geometry is site-specific (jaw, cone, or impact). Drive
 * and onboard conveyor intelligence is referenced through the same shared
 * component DNA used by `MIN-CRUSH-PRI` and `FP-CONVEYOR-BELT` — this class
 * does not copy those templates or their `PCR-*` / `CV-*` identities.
 *
 * Numeric closed-side settings, wear limits, and intervals require approved
 * OEM or site evidence. Recommend does not authorize work.
 */
export const mobileCrusherTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "MIN-MOBILE-CRUSH",
  name: "Mobile crusher",
  family: "mobile_material_processing",
  description:
    "Governed component, failure, telemetry, and inspection foundation for mobile crushing plants. Draft manufacturer-neutral content only; limits and intervals require approved evidence.",
  functions: [
    "receive",
    "size_reduce",
    "convey",
    "propel",
    "lubricate",
    "protect",
  ],
  operatingStates: [
    "offline",
    "isolated",
    "idle",
    "crushing",
    "conveying",
    "propelling",
    "blocked",
    "clearing",
    "maintenance_test",
  ],
  standards: ["ISO 55000", "ISO 13374", "ISO 23247"],
  reviewState: "draft",
  components: [
    {
      code: "MC-STRUCT",
      name: "Chassis, hoppers, and supporting structure",
      functions: [
        "support crushing and conveying loads",
        "maintain alignment",
        "contain feed material",
      ],
      telemetryConcepts: [
        "frame_vibration",
        "structural_strain",
        "throughput",
        "crusher_state",
      ],
      inspectionZones: [
        "main chassis",
        "hopper or dump pocket",
        "crusher mounts",
        "conveyor stringers",
        "access platforms",
      ],
      failureModes: [
        draftFailure(
          "MC-STRUCT-FATIGUE",
          "MC-STRUCT",
          "Structural fatigue cracking or distortion",
          "cyclic impact, crushing, and travel loads initiate and propagate cracking",
          [
            "cyclic loading",
            "impact",
            "stress concentration",
            "corrosion",
            "foundation or track settlement",
          ],
          [
            "reduced structural capacity",
            "alignment loss",
            "restricted crushing or travel",
          ],
          [
            "drone_rgb",
            "drone_lidar",
            "strain_trend",
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
      code: "MC-CRUSH",
      name: "Crushing chamber and wear parts",
      functions: [
        "fracture feed material",
        "control product size",
        "resist abrasion",
      ],
      telemetryConcepts: [
        "closed_side_setting",
        "power_draw",
        "throughput",
        "chamber_level",
        "product_size",
      ],
      inspectionZones: [
        "jaws, cone, or impact chamber",
        "liners or concaves",
        "feed opening",
        "toggle or adjustment hardware",
      ],
      failureModes: [
        draftFailure(
          "MC-CRUSH-WEAR",
          "MC-CRUSH",
          "Excessive or uneven chamber wear",
          "abrasion and impact progressively change chamber geometry",
          [
            "abrasive feed",
            "impact",
            "unbalanced feed",
            "foreign object",
          ],
          [
            "product-size drift",
            "reduced throughput",
            "secondary drive overload",
          ],
          ["inspection", "laser_scan", "power_draw", "product_size"],
          [
            "dimensional_survey",
            "liner_profile_measurement",
            "engineer_visual",
          ],
          4,
        ),
      ],
    },
    {
      code: "MC-DRIVE",
      name: "Crusher drive, eccentric or rotor, and bearings",
      sharedComponentDnaCodes: [
        rollingElementBearingDna.code,
        flexibleCouplingDna.code,
        industrialAcMotorDna.code,
      ],
      functions: [
        "transmit power",
        "generate crushing motion",
        "support rotating loads",
      ],
      telemetryConcepts: [
        "motor_current",
        "bearing_temperature",
        "vibration",
        "speed",
        "oil_debris",
      ],
      inspectionZones: [
        "drive motor",
        "coupling",
        "flywheel or sheaves",
        "eccentric or rotor",
        "main bearings",
      ],
      failureModes: [
        draftFailure(
          "MC-DRIVE-BEARING-DEGRADE",
          "MC-DRIVE",
          "Drive bearing or coupling degradation",
          "surface distress, contamination, or lubrication loss increases friction and clearance",
          [
            "contamination",
            "lubrication loss",
            "misalignment",
            "overload",
          ],
          [
            "abnormal heat",
            "vibration",
            "loss of crushing motion",
          ],
          ["vibration", "temperature", "oil_analysis", "motor_current"],
          [
            "bearing_inspection",
            "oil_sample_confirmation",
            "alignment_check",
          ],
          5,
        ),
      ],
    },
    {
      code: "MC-FEED-CONV",
      name: "Onboard feed conveyor or feeder",
      sharedComponentDnaCodes: [
        rollingElementBearingDna.code,
        flexibleCouplingDna.code,
        industrialAcMotorDna.code,
        industrialGearboxComponentDna.code,
        lubricationSystemDna.code,
      ],
      functions: [
        "receive feed material",
        "meter material into the chamber",
        "protect the crusher from surge",
      ],
      telemetryConcepts: [
        "belt_or_feeder_speed",
        "belt_tracking",
        "motor_current",
        "bearing_temperature",
        "feed_rate",
      ],
      inspectionZones: [
        "feed belt or grizzly",
        "pulleys or drums",
        "idlers",
        "drive",
        "skirts and hoppers",
      ],
      failureModes: [
        draftFailure(
          "MC-FEED-CONV-DEGRADE",
          "MC-FEED-CONV",
          "Feed-conveyor belt, idler, or drive degradation",
          "wear, tracking loss, or drivetrain deterioration interrupts chamber feed",
          [
            "mis-tracking",
            "idler seizure",
            "splice deterioration",
            "overload",
            "lubrication loss",
          ],
          [
            "material spillage",
            "chamber starve or surge",
            "unplanned stop",
          ],
          [
            "drone_rgb",
            "drone_thermal",
            "belt_speed",
            "vibration",
            "inspection",
          ],
          [
            "deenergized_visual_inspection",
            "idler_or_pulley_inspection",
            "drive_alignment_check",
            "splice_assessment",
          ],
          5,
        ),
      ],
    },
    {
      code: "MC-DISCH-CONV",
      name: "Onboard discharge and product conveyors",
      sharedComponentDnaCodes: [
        rollingElementBearingDna.code,
        flexibleCouplingDna.code,
        industrialAcMotorDna.code,
        industrialGearboxComponentDna.code,
        lubricationSystemDna.code,
      ],
      functions: [
        "remove crushed product",
        "transfer material off the plant",
        "maintain tracking and containment",
      ],
      telemetryConcepts: [
        "belt_speed",
        "belt_tracking",
        "motor_current",
        "bearing_temperature",
        "discharge_load",
      ],
      inspectionZones: [
        "discharge belt and splices",
        "pulleys",
        "idlers",
        "drive",
        "discharge chute",
        "skirts",
      ],
      failureModes: [
        draftFailure(
          "MC-DISCH-CONV-DEGRADE",
          "MC-DISCH-CONV",
          "Discharge-conveyor belt, idler, or drive degradation",
          "wear, tracking loss, or drivetrain deterioration interrupts product removal",
          [
            "mis-tracking",
            "idler seizure",
            "splice deterioration",
            "overload",
            "lubrication loss",
          ],
          [
            "material spillage",
            "chamber backup",
            "belt damage",
            "unplanned stop",
          ],
          [
            "drone_rgb",
            "drone_thermal",
            "belt_speed",
            "vibration",
            "inspection",
          ],
          [
            "deenergized_visual_inspection",
            "idler_or_pulley_inspection",
            "drive_alignment_check",
            "splice_assessment",
          ],
          5,
        ),
      ],
    },
    {
      code: "MC-LUBE-HYD",
      name: "Lubrication and hydraulic systems",
      sharedComponentDnaCodes: [
        lubricationSystemDna.code,
        hydraulicCylinderDna.code,
      ],
      functions: [
        "lubricate crusher bearings",
        "remove heat",
        "support adjustment, folding, and protection functions",
      ],
      telemetryConcepts: [
        "lubricant_pressure",
        "lubricant_flow",
        "oil_temperature",
        "filter_differential_pressure",
        "hydraulic_pressure",
      ],
      inspectionZones: [
        "reservoirs",
        "pumps",
        "filters",
        "coolers",
        "lines",
        "adjustment or folding cylinders",
      ],
      failureModes: [
        draftFailure(
          "MC-LUBE-HYD-LOSS",
          "MC-LUBE-HYD",
          "Lubrication delivery loss or hydraulic leakage",
          "blocked lines, failed pumps, leakage, or empty inventory starve bearings or lose hydraulic authority",
          [
            "pump failure",
            "blocked line",
            "leakage",
            "empty reservoir",
            "wrong lubricant",
          ],
          [
            "accelerated bearing wear",
            "heat generation",
            "loss of adjustment or folding",
          ],
          ["pressure", "flow", "temperature", "oil_analysis", "inspection"],
          [
            "lubrication_system_function_test",
            "oil_sample_confirmation",
            "leak_source_inspection",
          ],
          5,
        ),
      ],
    },
    {
      code: "MC-PROPEL",
      name: "Propel drives, tracks or wheels, and travel interface",
      sharedComponentDnaCodes: [
        industrialAcMotorDna.code,
        industrialGearboxComponentDna.code,
        rollingElementBearingDna.code,
      ],
      functions: [
        "reposition the plant",
        "support machine mass while travelling",
        "control travel starts and stops",
      ],
      telemetryConcepts: [
        "travel_speed",
        "motor_current",
        "final_drive_temperature",
        "track_or_wheel_bearing_temperature",
      ],
      inspectionZones: [
        "propel motors or hydrostatic drives",
        "final drives",
        "tracks or wheels",
        "rollers or axles",
        "travel interlocks",
      ],
      failureModes: [
        draftFailure(
          "MC-PROPEL-DEGRADE",
          "MC-PROPEL",
          "Propel drive, track, or wheel-interface degradation",
          "wear, lubrication loss, or misalignment increases travel resistance and tracking error",
          [
            "lubrication loss",
            "contamination",
            "overload",
            "ground impact",
            "obstruction",
          ],
          [
            "restricted travel",
            "abnormal heat",
            "loss of positioning",
          ],
          [
            "drone_rgb",
            "thermal",
            "motor_current",
            "inspection",
          ],
          [
            "drivetrain_inspection",
            "wear_measurement",
            "oil_sample_confirmation",
          ],
          5,
        ),
      ],
    },
    {
      code: "MC-ELEC-CTRL",
      name: "Electrical power, drives, controls, and protection",
      sharedComponentDnaCodes: [
        switchgearDna.code,
        variableFrequencyDriveDna.code,
      ],
      functions: [
        "distribute electrical power",
        "control crushing, conveying, and travel",
        "protect personnel and equipment",
        "coordinate interlocks",
      ],
      telemetryConcepts: [
        "voltage",
        "current",
        "cabinet_temperature",
        "fault_code",
        "interlock_state",
        "communication_health",
      ],
      inspectionZones: [
        "incoming power or generator interface",
        "switchgear",
        "drive cabinets",
        "local panels",
        "protective devices",
      ],
      failureModes: [
        draftFailure(
          "MC-ELEC-DEGRADE",
          "MC-ELEC-CTRL",
          "Electrical connection, drive, interlock, or protection fault",
          "loose connections, cooling loss, sensor faults, or configuration errors compromise motion control or protective response",
          [
            "loose connections",
            "contamination",
            "cooling loss",
            "sensor damage",
            "configuration error",
          ],
          [
            "thermal damage",
            "nuisance trip",
            "failure to trip",
            "loss of crushing, conveying, or protection",
          ],
          [
            "thermal",
            "fault_code",
            "current_imbalance",
            "proof_test",
            "inspection",
          ],
          [
            "deenergized_electrical_inspection",
            "approved_proof_test",
            "insulation_test",
            "configuration_review",
          ],
          5,
        ),
      ],
    },
  ],
};
