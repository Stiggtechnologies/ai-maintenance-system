import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Water and coolant leak detection. */
export const leakDetectionTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-LEAK-DETECTION",
  name: "Water and coolant leak detection",
  family: "fire_life_safety",
  description:
    "Reusable engineering template for sensing cable, spot sensors and controllers that detect water or coolant. Zones and alarm routing come only from the approved design.",
  functions: ["detect liquid where it should not be", "locate the leak"],
  operatingStates: ["normal", "leak_alarm", "fault"],
  standards: ["ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "LEAK-SENSORS",
      name: "Sensing cable and spot sensors",
      functions: ["sense liquid"],
      telemetryConcepts: ["leak_alarm", "cable_fault"],
      inspectionZones: ["sensing cable runs", "spot sensors"],
      failureModes: [
        f(
          "LEAK-SENSOR-FAULT",
          "LEAK-SENSORS",
          "Sensor or cable fault",
          "cut, dirty or disconnected cable leaves zones unmonitored",
          ["cable damage during works", "contamination"],
          ["leak undetected"],
          ["cable_fault"],
          ["sensor_function_test"],
          4,
        ),
      ],
    },
    {
      code: "LEAK-CONTROLLER",
      name: "Controller and alarm interface",
      functions: ["locate and report leaks"],
      telemetryConcepts: ["controller_status", "communication_status"],
      inspectionZones: ["controller", "BMS interface"],
      failureModes: [
        f(
          "LEAK-ALARM-LOST",
          "LEAK-CONTROLLER",
          "Alarm not delivered",
          "controller or interface faults stop alarms reaching operators",
          ["interface fault", "power loss"],
          ["late response to a leak"],
          ["communication_status"],
          ["alarm_path_test"],
          4,
        ),
      ],
    },
  ],
};
