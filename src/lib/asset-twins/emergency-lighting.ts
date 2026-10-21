import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Emergency lighting and egress signage. */
export const emergencyLightingTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-EMERGENCY-LIGHTING",
  name: "Emergency lighting and egress signage",
  family: "fire_life_safety",
  description:
    "Reusable engineering template for emergency luminaires, exit signs and central battery systems. Duration and illuminance requirements come only from the applicable code and the authority having jurisdiction.",
  functions: ["light escape routes on power failure", "show the way out"],
  operatingStates: ["normal", "emergency", "fault", "test"],
  standards: ["NFPA 101", "NFPA 70", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "EL-LUMINAIRES",
      name: "Luminaires and exit signs",
      functions: ["provide escape lighting"],
      telemetryConcepts: ["luminaire_status", "battery_status"],
      inspectionZones: ["luminaires", "exit signs", "batteries"],
      failureModes: [
        f("EL-BATTERY-FAIL", "EL-LUMINAIRES", "Emergency battery failure",
          "aged batteries do not light routes for the required duration",
          ["battery ageing", "charger fault"],
          ["dark escape routes"],
          ["battery_status", "duration_test_result"],
          ["duration_test"], 4),
      ],
    },
  ],
};
