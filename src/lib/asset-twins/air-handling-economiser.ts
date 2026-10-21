import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { industrialAcMotorDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Air handling unit with economiser or evaporative cooling. */
export const airHandlingEconomiserTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-AHU-ECONOMISER",
  name: "Air handling unit with economiser or evaporative cooling",
  family: "critical_cooling",
  description:
    "Reusable engineering template for air handlers using outside-air economisers, indirect evaporative or heat-wheel cooling. Changeover conditions come only from the approved sequence of operations.",
  functions: [
    "cool the IT space with outside air or evaporation",
    "exclude smoke and contaminated air",
  ],
  operatingStates: [
    "economiser",
    "mechanical_assist",
    "recirculation",
    "smoke_mode",
    "offline",
  ],
  standards: ["ASHRAE TC 9.9", "ASHRAE 90.4", "ISO 16890", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "AHU-DAMPERS",
      name: "Outside, return and relief dampers",
      functions: ["select air source"],
      telemetryConcepts: ["damper_position", "outside_air_quality"],
      inspectionZones: ["dampers", "actuators", "linkages"],
      failureModes: [
        f(
          "AHU-DAMPER-STUCK",
          "AHU-DAMPERS",
          "Damper stuck",
          "seized dampers admit outside air when they should not, or block economiser cooling",
          ["linkage failure", "actuator failure", "icing"],
          ["contaminated or wet air admitted", "loss of cooling"],
          ["damper_position"],
          ["damper_stroke_check"],
          4,
        ),
      ],
    },
    {
      code: "AHU-FANS-FILTERS",
      name: "Fans and filters",
      sharedComponentDnaCodes: [industrialAcMotorDna.code],
      functions: ["move and filter air"],
      telemetryConcepts: ["fan_speed", "filter_differential_pressure"],
      inspectionZones: ["fans", "filter banks"],
      failureModes: [
        f(
          "AHU-FILTER-LOADING",
          "AHU-FANS-FILTERS",
          "Filter loading",
          "loaded filters cut airflow and let particulates through when bypassed",
          ["missed changes", "wildfire smoke"],
          ["reduced airflow", "IT contamination"],
          ["filter_differential_pressure"],
          ["filter_inspection"],
          3,
        ),
      ],
    },
    {
      code: "AHU-EVAP",
      name: "Evaporative media or heat exchanger",
      functions: ["cool air"],
      telemetryConcepts: ["supply_air_temperature", "media_water_quality"],
      inspectionZones: ["media", "plate exchanger or wheel", "sump"],
      failureModes: [
        f(
          "AHU-EVAP-SCALING",
          "AHU-EVAP",
          "Media scaling or wheel failure",
          "scaled media or a failed wheel reduce cooling",
          ["water quality", "wheel drive failure"],
          ["capacity loss"],
          ["supply_air_temperature"],
          ["media_inspection"],
          3,
        ),
      ],
    },
  ],
};
