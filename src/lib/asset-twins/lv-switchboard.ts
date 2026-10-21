import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { switchgearDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Low-voltage main switchboard. */
export const lvSwitchboardTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-LV-SWITCHBOARD",
  name: "Low-voltage main switchboard",
  family: "critical_power",
  description:
    "Reusable engineering template for low-voltage main switchboards distributing to UPS, mechanical and house loads. Protection settings come only from the approved coordination study; switching stays with authorised persons.",
  functions: ["distribute low-voltage power", "protect feeders", "isolate for maintenance"],
  operatingStates: ["energized", "section_isolated", "tripped", "locked_out"],
  standards: ["IEC 61439", "UL 891", "NFPA 70B", "NFPA 70E", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "LVSB-BREAKERS",
      name: "Air and moulded-case circuit breakers",
      sharedComponentDnaCodes: [switchgearDna.code],
      functions: ["make, carry and break current"],
      telemetryConcepts: ["breaker_position", "trip_event", "operation_count"],
      inspectionZones: ["breakers", "trip units", "racking mechanisms"],
      failureModes: [
        f("LVSB-FAIL-TO-TRIP", "LVSB-BREAKERS", "Breaker fails to trip or trips wrongly",
          "mechanism or trip unit faults stop a breaker clearing a fault, or trip it unnecessarily",
          ["dried lubricant", "trip unit fault", "settings drift"],
          ["upstream trip", "wider outage"],
          ["trip_event", "inspection"],
          ["breaker_timing_test", "settings_review_against_coordination_study"], 5),
      ],
    },
    {
      code: "LVSB-BUS",
      name: "Busbar, joints and terminations",
      sharedComponentDnaCodes: [switchgearDna.code],
      functions: ["carry current"],
      telemetryConcepts: ["busbar_temperature", "phase_current"],
      inspectionZones: ["busbar joints", "cable terminations", "insulators"],
      failureModes: [
        f("LVSB-HOT-JOINT", "LVSB-BUS", "Hot joint or termination",
          "loose or corroded joints overheat",
          ["loosening", "corrosion"],
          ["arc fault", "outage"],
          ["thermal_imaging", "busbar_temperature"],
          ["thermal_imaging", "deenergized_torque_check"], 5),
      ],
    },
    {
      code: "LVSB-SURGE-METERING",
      name: "Surge protection and metering",
      functions: ["limit surges", "measure power"],
      telemetryConcepts: ["spd_status", "meter_status"],
      inspectionZones: ["surge protective devices", "meters"],
      failureModes: [
        f("LVSB-SPD-EXHAUSTED", "LVSB-SURGE-METERING", "Surge protection exhausted",
          "surge devices reach end of life and stop protecting",
          ["repeated surges", "age"],
          ["unprotected downstream equipment"],
          ["spd_status"],
          ["spd_inspection"], 3),
      ],
    },
  ],
};
