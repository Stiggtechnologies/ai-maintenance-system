import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Chilled-water distribution piping and valves. */
export const chilledWaterDistributionTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-CHW-DISTRIBUTION",
  name: "Chilled-water distribution piping and valves",
  family: "critical_cooling",
  description:
    "Reusable engineering template for chilled-water mains, risers, isolation and control valves, heat exchangers and pressurisation. Isolation stays with qualified staff under the site's procedures.",
  functions: [
    "deliver chilled water to terminal units",
    "isolate sections for maintenance",
  ],
  operatingStates: ["normal", "section_isolated", "leak_alarm"],
  standards: ["ASHRAE 90.1", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "CHWD-PIPING",
      name: "Piping, insulation and supports",
      functions: ["carry chilled water"],
      telemetryConcepts: ["loop_pressure", "leak_alarm"],
      inspectionZones: ["mains", "risers", "insulation", "supports"],
      failureModes: [
        f(
          "CHWD-LEAK",
          "CHWD-PIPING",
          "Pipe or joint leak",
          "corrosion or joint failure releases water, sometimes over IT space",
          ["corrosion under insulation", "grooved joint gasket failure"],
          ["water in IT space", "loss of pressure"],
          ["leak_alarm", "loop_pressure"],
          ["leak_inspection", "insulation_inspection"],
          5,
        ),
      ],
    },
    {
      code: "CHWD-VALVES",
      name: "Isolation and control valves",
      functions: ["isolate and balance flow"],
      telemetryConcepts: ["valve_position", "valve_status"],
      inspectionZones: ["isolation valves", "control valves", "actuators"],
      failureModes: [
        f(
          "CHWD-VALVE-SEIZED",
          "CHWD-VALVES",
          "Isolation valve seized",
          "valves never exercised will not close when a section must be isolated",
          ["no exercising", "scale"],
          ["cannot isolate a leak without wider shutdown"],
          ["inspection"],
          ["valve_exercise_under_approved_procedure"],
          4,
        ),
      ],
    },
    {
      code: "CHWD-PRESSURISATION",
      name: "Expansion, pressurisation and air separation",
      functions: ["hold system pressure", "remove air"],
      telemetryConcepts: ["loop_pressure", "makeup_flow"],
      inspectionZones: [
        "expansion tanks",
        "pressurisation unit",
        "air separators",
      ],
      failureModes: [
        f(
          "CHWD-PRESSURE-LOSS",
          "CHWD-PRESSURISATION",
          "Loss of system pressure",
          "failed expansion or make-up lets pressure fall and air enter",
          ["expansion bladder failure", "make-up failure"],
          ["pump cavitation", "air locks in terminal units"],
          ["loop_pressure"],
          ["pressurisation_inspection"],
          4,
        ),
      ],
    },
  ],
};
