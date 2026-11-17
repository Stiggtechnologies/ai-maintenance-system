import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { centrifugalPumpComponentDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Generator fuel storage and transfer. */
export const generatorFuelSystemTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-FUEL-SYSTEM",
  name: "Generator fuel storage and transfer",
  family: "critical_power",
  description:
    "Reusable engineering template for bulk and day-tank diesel storage, transfer pumps and fuel polishing. Storage duration requirements and fuel quality limits come only from the approved design, the fuel standard and the authority having jurisdiction.",
  functions: ["store fuel", "transfer fuel to day tanks", "keep fuel clean"],
  operatingStates: ["normal", "transferring", "polishing", "low_level_alarm", "isolated"],
  standards: ["NFPA 110", "NFPA 30", "ASTM D975", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "FUEL-STORAGE",
      name: "Bulk and day tanks",
      functions: ["store fuel", "contain leaks"],
      telemetryConcepts: ["tank_level", "water_in_fuel", "leak_alarm"],
      inspectionZones: ["tanks", "interstitial space", "vents", "containment"],
      failureModes: [
        f("FUEL-CONTAMINATION", "FUEL-STORAGE", "Fuel contamination",
          "water, microbial growth and oxidation degrade stored fuel",
          ["condensation", "long storage", "no polishing"],
          ["filter plugging", "generator failure to run"],
          ["water_in_fuel", "fuel_sampling"],
          ["fuel_sampling", "tank_inspection"], 5),
        f("FUEL-LEAK", "FUEL-STORAGE", "Tank or piping leak",
          "corrosion or damage releases fuel",
          ["corrosion", "impact"],
          ["environmental release", "fuel shortfall"],
          ["leak_alarm", "tank_level"],
          ["leak_inspection"], 4),
      ],
    },
    {
      code: "FUEL-TRANSFER",
      name: "Transfer pumps, polishing and controls",
      sharedComponentDnaCodes: [centrifugalPumpComponentDna.code],
      functions: ["move fuel to day tanks", "polish fuel"],
      telemetryConcepts: ["pump_status", "day_tank_level", "filter_differential_pressure"],
      inspectionZones: ["pumps", "polishing filters", "level controls", "valves"],
      failureModes: [
        f("FUEL-TRANSFER-FAIL", "FUEL-TRANSFER", "Transfer failure",
          "pump or level-control failure lets day tanks run dry during a long run",
          ["pump failure", "level switch failure", "control power loss"],
          ["generator stops on fuel starvation"],
          ["day_tank_level", "pump_status"],
          ["witnessed_transfer_test"], 5),
      ],
    },
  ],
};
