import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Chilled-water thermal storage tank. */
export const thermalStorageTankTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-THERMAL-STORAGE",
  name: "Chilled-water thermal storage tank",
  family: "critical_cooling",
  description:
    "Reusable engineering template for stratified chilled-water storage tanks that carry cooling through chiller restart. Required ride-through comes only from the approved design.",
  functions: [
    "store chilled water",
    "discharge cooling during chiller restart",
  ],
  operatingStates: ["charged", "charging", "discharging", "isolated"],
  standards: ["ASHRAE Design Guide for Cool Thermal Storage", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "TES-TANK",
      name: "Tank, insulation and diffusers",
      functions: ["hold stratified chilled water"],
      telemetryConcepts: ["tank_temperature_profile", "tank_level"],
      inspectionZones: ["tank shell", "insulation", "diffusers"],
      failureModes: [
        f(
          "TES-STRATIFICATION-LOSS",
          "TES-TANK",
          "Loss of stratification",
          "mixing or diffuser faults blend warm and cold water and reduce usable cooling",
          ["diffuser damage", "flow above design"],
          ["shorter ride-through"],
          ["tank_temperature_profile"],
          ["discharge_test_under_approved_procedure"],
          4,
        ),
      ],
    },
    {
      code: "TES-VALVES",
      name: "Isolation and discharge valves",
      functions: ["switch tank into the loop"],
      telemetryConcepts: ["valve_position", "valve_status"],
      inspectionZones: ["valves", "actuators"],
      failureModes: [
        f(
          "TES-VALVE-FAIL",
          "TES-VALVES",
          "Discharge valve fails to open",
          "actuator or valve faults stop the tank discharging when chillers stop",
          ["actuator failure", "control signal loss"],
          ["no ride-through cooling"],
          ["valve_status"],
          ["valve_stroke_check"],
          5,
        ),
      ],
    },
  ],
};
