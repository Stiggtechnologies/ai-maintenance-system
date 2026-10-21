import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { centrifugalPumpComponentDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Cooling water treatment and make-up. */
export const coolingWaterTreatmentTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-WATER-TREATMENT",
  name: "Cooling water treatment and make-up",
  family: "critical_cooling",
  description:
    "Reusable engineering template for make-up water storage, chemical dosing, filtration and blowdown. Chemistry and microbiological limits come only from the site's approved water management plan.",
  functions: [
    "supply make-up water",
    "control scale, corrosion and microbial growth",
  ],
  operatingStates: ["normal", "dosing_alarm", "bypass", "offline"],
  standards: ["ASHRAE 188", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "WT-DOSING",
      name: "Dosing and control",
      functions: ["dose chemicals to approved residuals"],
      telemetryConcepts: [
        "conductivity",
        "biocide_residual",
        "inhibitor_residual",
        "dosing_pump_status",
      ],
      inspectionZones: [
        "dosing pumps",
        "chemical tanks",
        "controller",
        "sensors",
      ],
      failureModes: [
        f(
          "WT-DOSING-FAIL",
          "WT-DOSING",
          "Dosing failure",
          "pump, chemical run-out or controller faults stop treatment",
          ["empty chemical tank", "pump failure", "sensor fouling"],
          ["scale", "corrosion", "microbial growth"],
          ["biocide_residual", "conductivity"],
          ["water_management_plan_review", "microbiological_sampling"],
          5,
        ),
      ],
    },
    {
      code: "WT-MAKEUP",
      name: "Make-up storage and pumps",
      sharedComponentDnaCodes: [centrifugalPumpComponentDna.code],
      functions: ["store and deliver make-up water"],
      telemetryConcepts: ["makeup_tank_level", "pump_status"],
      inspectionZones: ["tank", "pumps", "backflow preventer"],
      failureModes: [
        f(
          "WT-MAKEUP-LOSS",
          "WT-MAKEUP",
          "Loss of make-up supply",
          "utility interruption or pump failure starves heat rejection",
          ["utility interruption", "pump failure"],
          ["loss of evaporative heat rejection"],
          ["makeup_tank_level", "pump_status"],
          ["pump_inspection"],
          4,
        ),
      ],
    },
  ],
};
