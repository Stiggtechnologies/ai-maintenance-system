import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { industrialAcMotorDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Dry cooler or adiabatic cooler. */
export const dryCoolerTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-DRY-COOLER",
  name: "Dry cooler or adiabatic cooler",
  family: "critical_cooling",
  description:
    "Reusable engineering template for dry and adiabatic coolers rejecting heat to air. Fluid and spray water limits come only from the approved design.",
  functions: [
    "reject heat to air",
    "pre-cool inlet air adiabatically when enabled",
  ],
  operatingStates: [
    "running",
    "adiabatic_assist",
    "standby",
    "freeze_protection",
    "offline",
  ],
  standards: ["EN 1048", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "DRY-COIL",
      name: "Coil and fluid circuit",
      functions: ["exchange heat with air"],
      telemetryConcepts: [
        "fluid_supply_temperature",
        "fluid_return_temperature",
        "approach_temperature",
      ],
      inspectionZones: ["coil face", "headers", "glycol connections"],
      failureModes: [
        f(
          "DRY-COIL-FOULING",
          "DRY-COIL",
          "Coil fouling",
          "debris and scale on the coil face reduce heat rejection",
          ["airborne debris", "cottonwood", "spray-water scale"],
          ["higher fluid temperature", "chiller or CDU capacity loss"],
          ["approach_temperature", "inspection"],
          ["coil_inspection"],
          3,
        ),
      ],
    },
    {
      code: "DRY-FANS",
      name: "Fans and EC motors",
      sharedComponentDnaCodes: [industrialAcMotorDna.code],
      functions: ["move air"],
      telemetryConcepts: ["fan_speed", "fan_status"],
      inspectionZones: ["fans", "motors"],
      failureModes: [
        f(
          "DRY-FAN-FAIL",
          "DRY-FANS",
          "Fan failure",
          "failed fans reduce heat rejection",
          ["bearing wear", "drive fault"],
          ["capacity loss"],
          ["fan_status"],
          ["fan_inspection"],
          3,
        ),
      ],
    },
    {
      code: "DRY-ADIABATIC",
      name: "Adiabatic pads and spray",
      functions: ["pre-cool air"],
      telemetryConcepts: ["spray_status", "water_quality"],
      inspectionZones: ["pads", "nozzles", "water supply"],
      failureModes: [
        f(
          "DRY-ADIABATIC-WATER",
          "DRY-ADIABATIC",
          "Adiabatic water quality or supply loss",
          "poor water or supply loss scales pads and removes assist on hot days",
          ["no treatment", "supply interruption"],
          ["capacity loss on hot days", "microbial risk"],
          ["water_quality", "spray_status"],
          ["water_management_plan_review"],
          3,
        ),
      ],
    },
  ],
};
