import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { centrifugalPumpComponentDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Immersion cooling tank. */
export const immersionCoolingTankTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-IMMERSION",
  name: "Immersion cooling tank",
  family: "critical_cooling",
  description:
    "Reusable engineering template for single-phase immersion tanks. Fluid property and temperature limits come only from the fluid and IT manufacturers' approved documents.",
  functions: ["cool submerged IT equipment", "keep dielectric fluid clean"],
  operatingStates: ["running", "maintenance_lift", "alarm", "offline"],
  standards: ["OCP Immersion Requirements", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "IMM-FLUID",
      name: "Tank and dielectric fluid",
      functions: ["hold and cool IT"],
      telemetryConcepts: [
        "fluid_temperature",
        "fluid_level",
        "fluid_condition",
      ],
      inspectionZones: ["tank", "fluid", "lid seals"],
      failureModes: [
        f(
          "IMM-FLUID-DEGRADATION",
          "IMM-FLUID",
          "Fluid degradation or contamination",
          "moisture, oxidation or leached materials change fluid properties",
          ["moisture ingress", "material incompatibility", "age"],
          ["reduced cooling", "IT damage"],
          ["fluid_condition", "fluid_sampling"],
          ["fluid_sampling"],
          4,
        ),
      ],
    },
    {
      code: "IMM-CIRCULATION",
      name: "Pumps, heat exchanger and filters",
      sharedComponentDnaCodes: [centrifugalPumpComponentDna.code],
      functions: ["circulate and cool fluid"],
      telemetryConcepts: [
        "pump_status",
        "flow_rate",
        "filter_differential_pressure",
      ],
      inspectionZones: ["pumps", "heat exchanger", "filters"],
      failureModes: [
        f(
          "IMM-PUMP-FAIL",
          "IMM-CIRCULATION",
          "Circulation pump failure",
          "pump failure stops heat removal from the tank",
          ["seal wear", "motor failure"],
          ["IT thermal shutdown"],
          ["flow_rate", "pump_status"],
          ["manufacturer_assessment"],
          5,
        ),
      ],
    },
  ],
};
