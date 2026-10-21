import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { centrifugalPumpComponentDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Water-mist suppression. */
export const waterMistSuppressionTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-WATER-MIST",
  name: "Water-mist suppression",
  family: "fire_life_safety",
  description:
    "Reusable engineering template for high-pressure water-mist systems. Design and test criteria come only from the approved design and the authority having jurisdiction; recommendations never release the system.",
  functions: ["suppress fire with fine spray", "limit water damage"],
  operatingStates: ["set", "released", "impaired", "test"],
  standards: ["NFPA 750", "EN 14972", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "MIST-PUMP",
      name: "Pump unit and water supply",
      sharedComponentDnaCodes: [centrifugalPumpComponentDna.code],
      functions: ["deliver water at system pressure"],
      telemetryConcepts: ["pump_status", "supply_pressure", "tank_level"],
      inspectionZones: ["pump unit", "water tank", "controls"],
      failureModes: [
        f("MIST-PUMP-FAIL", "MIST-PUMP", "Pump fails to start",
          "pump or control faults stop water delivery",
          ["controller fault", "power loss", "pump wear"],
          ["fire not suppressed"],
          ["pump_status"],
          ["pump_start_test", "qualified_fire_system_inspection"], 5),
      ],
    },
    {
      code: "MIST-NOZZLES",
      name: "Section valves, piping and nozzles",
      functions: ["deliver mist to the fire zone"],
      telemetryConcepts: ["section_valve_status"],
      inspectionZones: ["section valves", "piping", "nozzles"],
      failureModes: [
        f("MIST-NOZZLE-BLOCKED", "MIST-NOZZLES", "Nozzle blockage",
          "fine nozzles block with debris or corrosion",
          ["poor water quality", "debris"],
          ["incomplete suppression"],
          ["inspection"],
          ["nozzle_inspection"], 4),
      ],
    },
  ],
};
