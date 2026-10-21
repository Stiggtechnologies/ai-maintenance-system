import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Hot- or cold-aisle containment. */
export const airflowContainmentTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-CONTAINMENT",
  name: "Hot- or cold-aisle containment",
  family: "critical_cooling",
  description:
    "Reusable engineering template for aisle containment, blanking and floor sealing. Fire-release behaviour comes only from the approved design and the authority having jurisdiction.",
  functions: [
    "separate supply and return air",
    "release on fire where required",
  ],
  operatingStates: ["intact", "door_open", "breached"],
  standards: ["ASHRAE TC 9.9", "NFPA 75", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "CONT-ENCLOSURE",
      name: "Doors, roof panels and blanking",
      functions: ["keep air streams apart"],
      telemetryConcepts: ["door_status", "rack_inlet_temperature"],
      inspectionZones: [
        "aisle doors",
        "roof panels",
        "blanking panels",
        "floor grommets",
      ],
      failureModes: [
        f(
          "CONT-BYPASS",
          "CONT-ENCLOSURE",
          "Air bypass and recirculation",
          "missing blanking, open doors or unsealed openings mix hot and cold air",
          [
            "missing blanking panels",
            "doors propped open",
            "unsealed cable openings",
          ],
          ["hot spots", "wasted cooling"],
          ["rack_inlet_temperature", "inspection"],
          ["containment_inspection"],
          3,
        ),
      ],
    },
    {
      code: "CONT-FIRE-RELEASE",
      name: "Fire-release mechanisms",
      functions: ["drop or open panels on fire"],
      telemetryConcepts: ["release_status"],
      inspectionZones: ["fusible links", "magnetic releases"],
      failureModes: [
        f(
          "CONT-RELEASE-FAIL",
          "CONT-FIRE-RELEASE",
          "Fire release fails",
          "failed releases keep panels in place and block sprinkler or agent distribution",
          ["release mechanism fault", "obstruction"],
          ["impaired suppression"],
          ["inspection"],
          ["release_function_test"],
          4,
        ),
      ],
    },
  ],
};
