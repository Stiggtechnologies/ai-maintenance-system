import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Direct-to-chip manifolds and cold plates. */
export const directLiquidCoolingTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-DLC",
  name: "Direct-to-chip manifolds and cold plates",
  family: "critical_cooling",
  description:
    "Reusable engineering template for rack manifolds, quick-disconnect couplings, hoses and cold plates. Flow, pressure and coolant limits come only from the IT and manifold manufacturers' approved documents.",
  functions: ["carry coolant to and from cold plates", "remove processor heat"],
  operatingStates: ["running", "isolated", "leak_alarm"],
  standards: ["ASHRAE TC 9.9", "OCP Advanced Cooling Solutions", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "DLC-MANIFOLD",
      name: "Manifolds, hoses and couplings",
      functions: ["distribute coolant within the rack"],
      telemetryConcepts: ["rack_flow", "rack_pressure", "leak_alarm"],
      inspectionZones: ["manifolds", "quick disconnects", "hoses"],
      failureModes: [
        f("DLC-QD-LEAK", "DLC-MANIFOLD", "Quick-disconnect leak",
          "worn or mis-seated couplings leak coolant inside the rack",
          ["coupling wear", "incomplete connection"],
          ["IT damage", "server shutdown"],
          ["leak_alarm", "inspection"],
          ["leak_inspection"], 5),
      ],
    },
    {
      code: "DLC-COLD-PLATES",
      name: "Cold plates",
      functions: ["transfer heat from chips"],
      telemetryConcepts: ["chip_temperature", "cold_plate_flow"],
      inspectionZones: ["cold plates", "inlet strainers"],
      failureModes: [
        f("DLC-COLD-PLATE-BLOCKED", "DLC-COLD-PLATES", "Cold plate blockage",
          "particles or growth block microchannels",
          ["coolant contamination", "no filtration"],
          ["thermal throttling", "chip damage"],
          ["chip_temperature", "cold_plate_flow"],
          ["coolant_sampling"], 4),
      ],
    },
  ],
};
