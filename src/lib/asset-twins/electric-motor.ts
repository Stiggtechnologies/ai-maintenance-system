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

/** Manufacturer-neutral engineering template for industrial AC electric motors. */
export const electricMotorTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "IND-ELECTRIC-MOTOR",
  name: "Industrial electric motor",
  family: "rotating_electrical_equipment",
  description: "Reusable engineering template for medium- and large-frame industrial AC motors without OEM-specific limits.",
  functions: ["convert_electrical_energy", "produce_torque", "support_driven_equipment", "reject_heat", "protect_insulation"],
  operatingStates: ["offline", "standby", "starting", "running", "coasting", "maintenance_test"],
  standards: ["ISO 55000", "ISO 13373", "IEC 60034"],
  reviewState: "draft",
  components: [
    {
      code: "EM-STATOR",
      name: "Stator winding and insulation system",
      functions: ["create rotating magnetic field", "maintain electrical insulation", "transfer heat"],
      telemetryConcepts: ["phase_current", "phase_voltage", "winding_temperature", "insulation_status", "partial_discharge"],
      inspectionZones: ["terminal box", "stator frame", "cooling passages", "lead exits"],
      failureModes: [
        draftFailure("EM-STATOR-INSULATION", "EM-STATOR", "Stator insulation deterioration", "thermal, electrical, mechanical or environmental stress reduces dielectric integrity", ["overheating", "contamination", "voltage stress", "vibration", "ageing"], ["ground fault", "phase fault", "forced outage", "secondary damage"], ["insulation_test", "partial_discharge", "current_signature", "thermal", "inspection"], ["insulation_resistance_test", "polarization_index", "surge_test", "qualified_electrical_assessment"], 5),
        draftFailure("EM-STATOR-HOTSPOT", "EM-STATOR", "Abnormal winding heating", "localized losses or restricted cooling create elevated temperature", ["phase imbalance", "overload", "cooling restriction", "connection resistance"], ["accelerated insulation ageing", "derate", "winding failure"], ["winding_temperature", "thermal", "phase_current", "resistance_balance"], ["deenergized_resistance_test", "cooling_system_inspection", "electrical_assessment"], 4),
      ],
    },
    {
      code: "EM-ROTOR",
      name: "Rotor, shaft and air-gap system",
      functions: ["develop torque", "transmit torque", "maintain rotor geometry"],
      telemetryConcepts: ["speed", "slip", "current_signature", "shaft_vibration", "air_gap"],
      inspectionZones: ["shaft extensions", "rotor accessible surfaces", "air-gap access points"],
      failureModes: [
        draftFailure("EM-ROTOR-DEFECT", "EM-ROTOR", "Rotor electrical or mechanical defect", "rotor conductor, cage, shaft or fit deterioration disturbs torque production and balance", ["thermal cycling", "fatigue", "overload", "manufacturing defect", "loose fit"], ["torque pulsation", "heating", "vibration", "loss of capacity"], ["current_signature", "vibration", "speed", "thermal"], ["motor_current_signature_analysis", "rotor_inspection", "air_gap_measurement", "run_test"], 4),
      ],
    },
    {
      code: "EM-BEARING",
      name: "Bearings and lubrication",
      functions: ["support rotor", "maintain air gap", "minimize friction"],
      telemetryConcepts: ["bearing_temperature", "bearing_vibration", "lubricant_condition", "shaft_position"],
      inspectionZones: ["drive-end bearing", "non-drive-end bearing", "lubrication points", "bearing housings"],
      failureModes: [
        draftFailure("EM-BEARING-DEGRADE", "EM-BEARING", "Bearing degradation", "surface distress, contamination, lubrication deficiency or electrical discharge increases friction and clearance", ["contamination", "lubrication error", "misalignment", "overload", "electrical fluting"], ["heat", "vibration", "rotor movement", "stator contact", "seizure"], ["vibration", "ultrasound", "bearing_temperature", "lubricant_analysis", "current_signature"], ["bearing_inspection", "lubricant_sample", "shaft_alignment_check", "electrical_discharge_assessment"], 5),
      ],
    },
    {
      code: "EM-COOLING",
      name: "Cooling and ventilation system",
      functions: ["remove losses", "maintain component temperatures", "control contamination ingress"],
      telemetryConcepts: ["cooling_airflow", "inlet_temperature", "outlet_temperature", "filter_differential_pressure", "fan_status"],
      inspectionZones: ["fans", "filters", "heat exchangers", "air passages", "external fins"],
      failureModes: [
        draftFailure("EM-COOLING-LOSS", "EM-COOLING", "Cooling performance loss", "restricted flow, fan degradation or heat-exchanger fouling reduces heat rejection", ["blocked filters", "fan fault", "fouling", "damaged ducting"], ["winding overheating", "bearing heating", "derate", "insulation ageing"], ["thermal", "airflow", "differential_pressure", "fan_status", "inspection"], ["airflow_test", "fan_inspection", "heat_exchanger_inspection"], 4),
      ],
    },
    {
      code: "EM-TERMINAL",
      name: "Terminations, enclosure and protection interfaces",
      functions: ["connect power", "contain energized parts", "support grounding", "interface protection"],
      telemetryConcepts: ["terminal_temperature", "phase_current", "ground_status", "protection_trip", "enclosure_temperature"],
      inspectionZones: ["terminal box", "cable entries", "grounding points", "space heaters", "protection sensors"],
      failureModes: [
        draftFailure("EM-TERMINAL-HOT", "EM-TERMINAL", "High-resistance terminal connection", "loose, contaminated, corroded or damaged connection creates localized heating", ["fastener loosening", "corrosion", "contamination", "conductor damage"], ["voltage drop", "thermal damage", "arc fault", "motor trip"], ["thermal", "phase_current", "voltage_balance", "inspection"], ["deenergized_torque_check", "contact_resistance_test", "qualified_electrical_inspection"], 5),
      ],
    },
  ],
};
