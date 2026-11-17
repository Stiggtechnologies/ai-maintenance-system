import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for fire alarm panels, spot detection and aspirating smoke detection. */
export const fireDetectionAlarmTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-FIRE-DETECTION",
  name: "Fire detection and alarm (including aspirating smoke detection)",
  family: "fire_life_safety",
  description:
    "Reusable engineering template for fire alarm control panels, spot detectors and aspirating smoke detection in data halls. Alarm thresholds and cause-and-effect come only from the approved design; recommendations never isolate devices or silence alarms.",
  functions: ["detect smoke and heat early", "raise alarms", "initiate suppression, HVAC and release sequences"],
  operatingStates: ["normal", "alert", "fire", "fault", "disabled_zone", "test"],
  standards: ["NFPA 72", "NFPA 75", "EN 54-20", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "FD-PANEL",
      name: "Fire alarm control panel and power",
      functions: ["monitor devices", "run cause-and-effect", "signal alarms"],
      telemetryConcepts: ["panel_status", "zone_status", "battery_status", "disabled_device_count"],
      inspectionZones: ["panel", "standby batteries", "interfaces to suppression and HVAC"],
      failureModes: [
        f("FD-PANEL-DISABLED", "FD-PANEL", "Zones or outputs left disabled",
          "zones or outputs disabled for work are not restored",
          ["maintenance not closed out", "nuisance alarm workaround"],
          ["fire not detected or suppression not released"],
          ["disabled_device_count", "zone_status"],
          ["disablement_log_review", "qualified_fire_system_inspection"], 5),
        f("FD-PANEL-POWER", "FD-PANEL", "Panel standby power failure",
          "aged standby batteries cannot keep the panel running through a power loss",
          ["battery ageing", "charger fault"],
          ["panel offline during an outage"],
          ["battery_status"],
          ["battery_test"], 4),
      ],
    },
    {
      code: "FD-ASPIRATING",
      name: "Aspirating smoke detection",
      functions: ["sample air for very early smoke"],
      telemetryConcepts: ["airflow_status", "smoke_level", "detector_fault"],
      inspectionZones: ["detector unit", "sampling pipes and holes", "filters"],
      failureModes: [
        f("FD-ASPIRATING-FLOW", "FD-ASPIRATING", "Sampling pipe blockage or break",
          "blocked holes or broken pipes stop air reaching the detector from part of the room",
          ["dust", "pipe damage during works", "filter loading"],
          ["late or no early warning"],
          ["airflow_status", "detector_fault"],
          ["transport_time_test", "pipe_inspection"], 4),
      ],
    },
    {
      code: "FD-DEVICES",
      name: "Spot detectors, call points and sounders",
      functions: ["detect locally", "let people raise the alarm", "warn occupants"],
      telemetryConcepts: ["device_status", "device_contamination"],
      inspectionZones: ["detectors", "manual call points", "sounders and strobes"],
      failureModes: [
        f("FD-DETECTOR-CONTAMINATION", "FD-DEVICES", "Detector contamination or failure",
          "dust and ageing make detectors insensitive or prone to false alarms",
          ["dust", "age"],
          ["missed detection", "false alarm and unwanted discharge"],
          ["device_contamination", "device_status"],
          ["detector_sensitivity_test"], 4),
      ],
    },
  ],
};
