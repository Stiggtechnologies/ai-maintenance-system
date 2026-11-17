import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Emergency power off system. */
export const emergencyPowerOffTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-EPO",
  name: "Emergency power off system",
  family: "fire_life_safety",
  description:
    "Reusable engineering template for IT-space emergency power off stations and circuits. EPO zones and interfaces come only from the approved design; recommendations never test, bypass or operate EPO.",
  functions: ["isolate IT-space power on deliberate operation", "resist inadvertent operation"],
  operatingStates: ["armed", "test_bypass", "operated", "fault"],
  standards: ["NFPA 75", "NFPA 70", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "EPO-STATIONS",
      name: "EPO stations and covers",
      functions: ["let a person isolate power deliberately"],
      telemetryConcepts: ["station_status"],
      inspectionZones: ["stations", "protective covers", "signage"],
      failureModes: [
        f("EPO-INADVERTENT", "EPO-STATIONS", "Inadvertent operation",
          "an unguarded or mislabelled station is pressed by mistake",
          ["missing cover", "confusion with door release"],
          ["full IT-space outage"],
          ["event_log_review", "inspection"],
          ["station_inspection"], 5),
      ],
    },
    {
      code: "EPO-CIRCUIT",
      name: "Supervised wiring and interface relays",
      functions: ["carry the trip signal", "report faults"],
      telemetryConcepts: ["circuit_supervision", "relay_status"],
      inspectionZones: ["wiring", "interface relays", "test bypass switch"],
      failureModes: [
        f("EPO-CIRCUIT-FAULT", "EPO-CIRCUIT", "Circuit fault or bypass left on",
          "a wiring fault causes a trip, or a test bypass left on removes the function",
          ["wiring damage", "maintenance not closed out"],
          ["unwanted outage", "EPO not available"],
          ["circuit_supervision", "relay_status"],
          ["functional_test_under_approved_procedure"], 5),
      ],
    },
  ],
};
