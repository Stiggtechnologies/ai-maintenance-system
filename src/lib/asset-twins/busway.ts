import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { switchgearDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for overhead plug-in busway feeding rack rows. */
export const buswayTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-BUSWAY",
  name: "Overhead busway with tap-off units",
  family: "critical_power",
  description:
    "Reusable engineering template for overhead plug-in busway and tap-off boxes. Joint maintenance and tap-off changes on energized busway stay with qualified site staff.",
  functions: ["carry power along the row", "feed racks through tap-off units"],
  operatingStates: ["energized", "section_isolated", "maintenance", "offline"],
  standards: ["IEC 61439-6", "UL 857", "NFPA 70B", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "BUS-SECTIONS",
      name: "Busway sections and joints",
      sharedComponentDnaCodes: [switchgearDna.code],
      functions: ["carry current"],
      telemetryConcepts: ["joint_temperature", "feed_current"],
      inspectionZones: ["joint packs", "housing", "supports"],
      failureModes: [
        f("BUS-JOINT-HOT", "BUS-SECTIONS", "Overheating joint",
          "joint packs lose clamping force with thermal cycling and overheat",
          ["thermal cycling", "installation torque", "vibration"],
          ["insulation damage", "row outage", "arc fault"],
          ["joint_temperature", "thermal_imaging"],
          ["thermal_imaging", "deenergized_torque_check"], 5),
      ],
    },
    {
      code: "BUS-TAPOFF",
      name: "Tap-off units",
      sharedComponentDnaCodes: [switchgearDna.code],
      functions: ["protect and feed rack circuits"],
      telemetryConcepts: ["tapoff_current", "breaker_status"],
      inspectionZones: ["plug-in contacts", "breakers", "cable glands"],
      failureModes: [
        f("BUS-TAPOFF-CONTACT", "BUS-TAPOFF", "Tap-off contact degradation",
          "poorly seated or worn plug-in contacts overheat",
          ["incomplete seating", "repeated insertion", "overload"],
          ["rack outage", "contact burn"],
          ["thermal_imaging", "tapoff_current"],
          ["qualified_electrical_inspection"], 4),
      ],
    },
    {
      code: "BUS-END-FEED",
      name: "End feed and monitoring",
      functions: ["connect busway to its source", "report row load"],
      telemetryConcepts: ["feed_current", "kwh", "communication_status"],
      inspectionZones: ["end feed box", "metering", "terminations"],
      failureModes: [
        f("BUS-FEED-TERMINATION", "BUS-END-FEED", "End feed termination fault",
          "loose cable terminations at the end feed overheat",
          ["loosening", "thermal cycling"],
          ["row outage"],
          ["thermal_imaging", "feed_current"],
          ["thermal_imaging", "deenergized_torque_check"], 4),
      ],
    },
  ],
};
