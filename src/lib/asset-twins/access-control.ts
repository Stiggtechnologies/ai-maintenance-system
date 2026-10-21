import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Physical access control. */
export const accessControlTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-ACCESS-CONTROL",
  name: "Physical access control",
  family: "physical_security",
  description:
    "Reusable engineering template for readers, door controllers, locks and mantraps. Access rules come only from the approved security policy; recommendations never grant access or unlock doors.",
  functions: ["admit authorised people only", "record entries"],
  operatingStates: ["secure", "door_held", "forced", "offline"],
  standards: ["ISO/IEC 27001", "EN 60839", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "ACS-DOORS",
      name: "Readers, controllers and locks",
      functions: ["authenticate and release doors"],
      telemetryConcepts: ["door_status", "reader_status", "controller_status"],
      inspectionZones: [
        "readers",
        "door controllers",
        "locks",
        "door hardware",
      ],
      failureModes: [
        f(
          "ACS-DOOR-FAULT",
          "ACS-DOORS",
          "Door hardware or lock failure",
          "failed locks or closers leave secure doors open or lock people out",
          ["closer wear", "lock failure", "power loss"],
          ["unauthorised entry", "delayed response"],
          ["door_status"],
          ["door_hardware_inspection"],
          3,
        ),
      ],
    },
    {
      code: "ACS-SERVER",
      name: "Access server and records",
      functions: ["hold credentials and logs"],
      telemetryConcepts: ["server_status", "communication_status"],
      inspectionZones: ["server", "panels"],
      failureModes: [
        f(
          "ACS-RECORDS-LOSS",
          "ACS-SERVER",
          "Server or log loss",
          "server failure stops credential updates and logging",
          ["hardware failure", "network fault"],
          ["stale credentials", "no audit trail"],
          ["server_status"],
          ["recovery_test"],
          3,
        ),
      ],
    },
  ],
};
