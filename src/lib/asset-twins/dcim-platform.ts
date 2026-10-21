import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Data centre infrastructure management platform. */
export const dcimPlatformTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-DCIM",
  name: "Data centre infrastructure management platform",
  family: "critical_controls",
  description:
    "Reusable engineering template for DCIM software, rack sensors and integrations. It observes and records only; it never changes plant or IT state.",
  functions: ["track space, power and cooling capacity", "record assets and connectivity"],
  operatingStates: ["normal", "degraded", "offline"],
  standards: ["ISO/IEC 30134", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "DCIM-DATA",
      name: "Asset and capacity records",
      functions: ["hold accurate records"],
      telemetryConcepts: ["record_reconciliation_status"],
      inspectionZones: ["asset database", "integrations"],
      failureModes: [
        f("DCIM-RECORD-DRIFT", "DCIM-DATA", "Records drift from reality",
          "changes not recorded leave capacity and connectivity wrong",
          ["unrecorded moves and changes", "integration failure"],
          ["wrong capacity decisions", "overload on failover"],
          ["record_reconciliation_status"],
          ["physical_audit"], 3),
      ],
    },
    {
      code: "DCIM-SENSORS",
      name: "Rack sensors and gateways",
      functions: ["measure rack conditions"],
      telemetryConcepts: ["sensor_status", "communication_status"],
      inspectionZones: ["sensors", "gateways"],
      failureModes: [
        f("DCIM-SENSOR-LOSS", "DCIM-SENSORS", "Sensor or gateway loss",
          "failed sensors hide rack hot spots",
          ["battery depletion", "gateway failure"],
          ["unseen hot spots"],
          ["sensor_status"],
          ["sensor_function_test"], 2),
      ],
    },
  ],
};
