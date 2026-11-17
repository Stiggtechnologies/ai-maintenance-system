import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { transformerDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for facility step-down power transformers (liquid or dry type). */
export const powerTransformerTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-POWER-TRANSFORMER",
  name: "Facility step-down power transformer",
  family: "critical_power",
  description:
    "Reusable engineering template for liquid-filled and dry-type step-down transformers between medium-voltage and facility distribution. Loading and temperature limits come only from the nameplate and approved records.",
  functions: ["step voltage down", "isolate supply systems"],
  operatingStates: ["energized", "de-energized", "alarm", "tripped"],
  standards: ["IEC 60076", "IEEE C57", "NFPA 70B", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "PTX-ACTIVE-PART",
      name: "Windings, core and insulation",
      sharedComponentDnaCodes: [transformerDna.code],
      functions: ["transform voltage"],
      telemetryConcepts: ["winding_temperature", "dissolved_gas", "load_current", "partial_discharge"],
      inspectionZones: ["tank or enclosure", "core earthing"],
      failureModes: [
        f("PTX-INSULATION-AGEING", "PTX-ACTIVE-PART", "Insulation ageing and internal fault",
          "heat, moisture and oxygen age paper or resin insulation until it fails",
          ["sustained high temperature", "moisture ingress", "overloading"],
          ["internal fault", "transformer loss", "long outage"],
          ["dissolved_gas", "winding_temperature", "moisture_in_oil"],
          ["oil_analysis", "qualified_electrical_assessment"], 5),
      ],
    },
    {
      code: "PTX-BUSHINGS-TAPS",
      name: "Bushings and tap changer",
      sharedComponentDnaCodes: [transformerDna.code],
      functions: ["bring connections through the tank", "adjust ratio"],
      telemetryConcepts: ["bushing_capacitance", "tap_position", "thermal_image"],
      inspectionZones: ["bushings", "tap changer", "terminations"],
      failureModes: [
        f("PTX-BUSHING-FAULT", "PTX-BUSHINGS-TAPS", "Bushing deterioration",
          "moisture or contamination degrades bushing insulation",
          ["seal failure", "contamination", "age"],
          ["flashover", "transformer fire"],
          ["bushing_capacitance", "thermal_imaging"],
          ["bushing_power_factor_test"], 5),
      ],
    },
    {
      code: "PTX-COOLING-PROTECTION",
      name: "Cooling and protection devices",
      functions: ["remove heat", "detect internal faults"],
      telemetryConcepts: ["oil_temperature", "fan_status", "buchholz_alarm", "pressure_relief_status"],
      inspectionZones: ["radiators", "fans", "protection relays", "oil level gauge"],
      failureModes: [
        f("PTX-COOLING-LOSS", "PTX-COOLING-PROTECTION", "Cooling loss or protection device failure",
          "failed fans, blocked radiators or failed protection devices allow overheating or hide faults",
          ["fan failure", "radiator fouling", "device ageing"],
          ["accelerated ageing", "undetected internal fault"],
          ["oil_temperature", "fan_status"],
          ["protection_device_function_test", "cooling_inspection"], 4),
      ],
    },
  ],
};
