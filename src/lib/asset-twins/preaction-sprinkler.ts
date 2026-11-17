import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for pre-action sprinkler systems protecting IT spaces. */
export const preactionSprinklerTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-PREACTION",
  name: "Pre-action sprinkler system",
  family: "fire_life_safety",
  description:
    "Reusable engineering template for single- and double-interlock pre-action systems. Supervisory pressures and test intervals come only from the approved design and the authority having jurisdiction; recommendations never trip or reset the valve.",
  functions: ["keep pipework dry until detection", "deliver water to an operating sprinkler", "signal faults and leaks"],
  operatingStates: ["set", "tripped", "flowing", "impaired", "test"],
  standards: ["NFPA 13", "NFPA 25", "NFPA 75", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "PA-VALVE",
      name: "Pre-action valve and release trim",
      functions: ["hold water back", "open on release"],
      telemetryConcepts: ["valve_status", "release_status", "water_pressure"],
      inspectionZones: ["valve", "trim", "solenoid", "drain"],
      failureModes: [
        f("PA-VALVE-FAIL", "PA-VALVE", "Valve fails to open or opens unwanted",
          "corrosion, debris or release faults stop the valve opening, or trip it without a fire",
          ["corrosion", "debris", "solenoid failure", "false release signal"],
          ["no water to fire", "water in pipework over IT"],
          ["valve_status", "release_status"],
          ["trip_test", "qualified_fire_system_inspection"], 5),
      ],
    },
    {
      code: "PA-SUPERVISORY-AIR",
      name: "Supervisory air or nitrogen supply",
      functions: ["hold supervisory pressure", "reveal pipework leaks"],
      telemetryConcepts: ["supervisory_pressure", "compressor_runtime", "low_pressure_alarm"],
      inspectionZones: ["compressor or nitrogen generator", "pressure switches", "dryer"],
      failureModes: [
        f("PA-SUPERVISORY-LOSS", "PA-SUPERVISORY-AIR", "Loss of supervisory pressure",
          "compressor failure or pipework leaks drop supervisory pressure",
          ["compressor failure", "pipework leak", "dryer failure"],
          ["leaks go unseen", "nuisance alarms"],
          ["supervisory_pressure", "compressor_runtime"],
          ["compressor_inspection", "pipework_leak_survey"], 3),
      ],
    },
    {
      code: "PA-PIPEWORK",
      name: "Pipework and sprinkler heads",
      functions: ["carry water to the fire"],
      telemetryConcepts: [],
      inspectionZones: ["pipework", "sprinkler heads", "hangers", "low-point drains"],
      failureModes: [
        f("PA-PIPE-CORROSION", "PA-PIPEWORK", "Internal corrosion and pinhole leaks",
          "moisture left in dry pipework corrodes it from inside",
          ["trapped water after tests", "wet supervisory air"],
          ["pinhole leaks", "blocked heads", "water over IT when charged"],
          ["supervisory_pressure", "inspection"],
          ["internal_pipe_inspection", "low_point_drain_check"], 4),
      ],
    },
  ],
};
