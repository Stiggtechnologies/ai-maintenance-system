import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Electrical power monitoring system. */
export const electricalPowerMonitoringTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-EPMS",
  name: "Electrical power monitoring system",
  family: "critical_controls",
  description:
    "Reusable engineering template for power meters, relay data links and the monitoring platform that records electrical events and power quality. It observes only; it never operates switchgear.",
  functions: ["record electrical state and events", "capture power quality", "time-stamp sequences of events"],
  operatingStates: ["normal", "degraded", "offline"],
  standards: ["IEC 61557-12", "IEC 61000-4-30", "IEEE 1588", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "EPMS-METERS",
      name: "Power meters and relay data links",
      functions: ["measure electrical quantities"],
      telemetryConcepts: ["meter_status", "communication_status", "waveform_capture"],
      inspectionZones: ["meters", "CT and VT wiring", "relay data links"],
      failureModes: [
        f("EPMS-METER-LOSS", "EPMS-METERS", "Meter failure or communication loss",
          "failed meters or links leave gaps in electrical visibility",
          ["hardware failure", "network fault", "configuration error"],
          ["missed events", "wrong capacity decisions"],
          ["communication_status", "meter_status"],
          ["metering_verification"], 3),
      ],
    },
    {
      code: "EPMS-TIME-SYNC",
      name: "Time synchronisation and platform",
      functions: ["time-stamp events consistently"],
      telemetryConcepts: ["time_sync_status", "server_status"],
      inspectionZones: ["time servers", "gateways", "servers"],
      failureModes: [
        f("EPMS-TIME-DRIFT", "EPMS-TIME-SYNC", "Time synchronisation loss",
          "unsynchronised clocks scramble the sequence of events during an incident",
          ["time server failure", "network fault"],
          ["wrong root cause in event analysis"],
          ["time_sync_status"],
          ["time_sync_check"], 3),
      ],
    },
  ],
};
