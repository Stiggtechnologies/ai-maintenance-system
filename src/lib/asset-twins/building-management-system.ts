import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Building management system. */
export const buildingManagementSystemTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-BMS",
  name: "Building management system",
  family: "critical_controls",
  description:
    "Reusable engineering template for building management and plant control systems. Control sequences and setpoints come only from the approved sequence of operations; recommendations never write setpoints or override plant.",
  functions: ["run plant control sequences", "collect plant telemetry", "raise plant alarms"],
  operatingStates: ["normal", "degraded", "manual_override", "offline"],
  standards: ["ISO 16484", "ASHRAE 135", "IEC 62443", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "BMS-CONTROLLERS",
      name: "Plant controllers",
      functions: ["execute control sequences"],
      telemetryConcepts: ["controller_status", "point_quality", "override_count"],
      inspectionZones: ["controllers", "I/O modules", "panel power"],
      failureModes: [
        f("BMS-CONTROLLER-FAIL", "BMS-CONTROLLERS", "Controller failure or lost sequence",
          "a failed controller drops plant to its fail-safe state or stops sequencing",
          ["hardware failure", "power loss", "firmware fault"],
          ["plant runs uncontrolled or stops", "loss of cooling redundancy"],
          ["controller_status", "point_quality"],
          ["controls_point_to_point_check", "sequence_review_against_approved_record"], 5),
        f("BMS-OVERRIDES", "BMS-CONTROLLERS", "Manual overrides left in place",
          "points left in manual after work defeat automatic sequences",
          ["maintenance not closed out"],
          ["hidden loss of redundancy"],
          ["override_count"],
          ["override_log_review"], 4),
      ],
    },
    {
      code: "BMS-FIELD-DEVICES",
      name: "Field sensors and actuators",
      functions: ["measure and actuate"],
      telemetryConcepts: ["sensor_status", "point_quality"],
      inspectionZones: ["sensors", "actuators", "wiring"],
      failureModes: [
        f("BMS-SENSOR-DRIFT", "BMS-FIELD-DEVICES", "Sensor drift or failure",
          "drifting sensors make plant control to the wrong condition",
          ["ageing", "installation"],
          ["wrong control action"],
          ["point_quality", "cross_check_between_sensors"],
          ["sensor_calibration_check"], 4),
      ],
    },
    {
      code: "BMS-SUPERVISORY",
      name: "Supervisory servers and network",
      functions: ["display, trend and alarm"],
      telemetryConcepts: ["server_status", "communication_status", "alarm_flood_rate"],
      inspectionZones: ["servers", "workstations", "network switches"],
      failureModes: [
        f("BMS-VISIBILITY-LOSS", "BMS-SUPERVISORY", "Loss of supervisory visibility",
          "server or network failure hides plant state from operators",
          ["server failure", "network failure", "cyber incident"],
          ["alarms unseen", "slow response"],
          ["communication_status", "server_status"],
          ["recovery_test", "cybersecurity_review"], 4),
      ],
    },
  ],
};
