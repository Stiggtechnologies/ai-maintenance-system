import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Earthing, bonding and lightning protection. */
export const earthingSystemTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-EARTHING",
  name: "Earthing, bonding and lightning protection",
  family: "critical_power",
  description:
    "Reusable engineering template for earthing grids, bonding networks, signal reference grids, lightning protection and surge protective devices. Resistance and continuity acceptance values come only from the approved design and the applicable standard.",
  functions: ["provide a safe fault return path", "equalise potential", "divert lightning and surge current"],
  operatingStates: ["in_service", "under_test"],
  standards: ["IEEE 80", "IEEE 1100", "IEC 62305", "NFPA 780", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "EARTH-GRID",
      name: "Earth electrodes, grid and main earthing bar",
      functions: ["return fault current to source"],
      telemetryConcepts: ["earth_resistance_test_result"],
      inspectionZones: ["electrodes", "test pits", "main earthing bar"],
      failureModes: [
        f("EARTH-HIGH-RESISTANCE", "EARTH-GRID", "Rising earth resistance",
          "corrosion and soil drying raise grid resistance over time",
          ["corrosion", "soil moisture change", "damaged connections"],
          ["unsafe touch voltages", "protection may not clear faults"],
          ["earth_resistance_test_result"],
          ["earth_resistance_test"], 4),
      ],
    },
    {
      code: "EARTH-BONDING",
      name: "Bonding conductors and signal reference grid",
      functions: ["bond equipment and structures"],
      telemetryConcepts: ["continuity_test_result"],
      inspectionZones: ["bonding jumpers", "rack bonds", "signal reference grid"],
      failureModes: [
        f("EARTH-BROKEN-BOND", "EARTH-BONDING", "Broken or missing bond",
          "bonds removed during works or corroded leave equipment unbonded",
          ["works not closed out", "corrosion"],
          ["shock hazard", "electrical noise"],
          ["continuity_test_result", "inspection"],
          ["continuity_test"], 4),
      ],
    },
    {
      code: "EARTH-LIGHTNING-SURGE",
      name: "Lightning protection and surge devices",
      functions: ["intercept and divert lightning", "limit surges"],
      telemetryConcepts: ["spd_status", "lightning_counter"],
      inspectionZones: ["air terminals", "down conductors", "surge protective devices"],
      failureModes: [
        f("EARTH-SPD-END-OF-LIFE", "EARTH-LIGHTNING-SURGE", "Surge device end of life",
          "surge devices degrade with each event until they stop protecting",
          ["surge events", "age"],
          ["equipment damage from surges"],
          ["spd_status"],
          ["spd_inspection"], 3),
      ],
    },
  ],
};
