import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for total-flooding clean-agent and inert-gas suppression. */
export const cleanAgentSuppressionTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-CLEAN-AGENT",
  name: "Clean-agent or inert-gas suppression",
  family: "fire_life_safety",
  description:
    "Reusable engineering template for total-flooding clean-agent and inert-gas systems protecting data halls and electrical rooms. Agent quantity, hold time and room integrity criteria come only from the approved design and the authority having jurisdiction; recommendations never arm, disarm or discharge a system.",
  functions: ["hold agent ready", "discharge on confirmed detection", "maintain room concentration"],
  operatingStates: ["armed", "disabled_for_maintenance", "pre_discharge_alarm", "discharged", "fault"],
  standards: ["NFPA 2001", "ISO 14520", "NFPA 75", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "CA-STORAGE",
      name: "Agent containers, valves and actuators",
      functions: ["store agent", "release agent on command"],
      telemetryConcepts: ["container_pressure", "container_weight", "actuator_status"],
      inspectionZones: ["containers", "valves", "actuators", "manifold"],
      failureModes: [
        f("CA-AGENT-LOSS", "CA-STORAGE", "Loss of agent quantity",
          "slow leaks or a partial discharge leave less agent than the design needs",
          ["valve seal leak", "accidental partial discharge"],
          ["fire not suppressed"],
          ["container_pressure", "container_weight"],
          ["container_weigh_check", "qualified_fire_system_inspection"], 5),
        f("CA-ACTUATOR-FAULT", "CA-STORAGE", "Actuator or release circuit fault",
          "a failed actuator or open release circuit stops the system discharging",
          ["actuator failure", "wiring fault", "left disabled after maintenance"],
          ["no discharge on fire"],
          ["actuator_status", "panel_fault"],
          ["release_circuit_test", "qualified_fire_system_inspection"], 5),
      ],
    },
    {
      code: "CA-PIPING-NOZZLES",
      name: "Discharge piping and nozzles",
      functions: ["deliver agent evenly"],
      telemetryConcepts: [],
      inspectionZones: ["piping supports", "nozzles", "nozzle orientation"],
      failureModes: [
        f("CA-NOZZLE-OBSTRUCTED", "CA-PIPING-NOZZLES", "Nozzle obstruction or damage",
          "blocked, painted or moved nozzles prevent even agent distribution",
          ["construction work", "cable tray changes", "impact"],
          ["uneven concentration", "incomplete suppression"],
          ["inspection"],
          ["qualified_fire_system_inspection"], 4),
      ],
    },
    {
      code: "CA-ROOM-INTEGRITY",
      name: "Protected enclosure integrity",
      functions: ["hold agent concentration for the design hold time"],
      telemetryConcepts: ["door_status", "damper_status"],
      inspectionZones: ["penetrations", "doors and seals", "dampers", "raised floor and ceiling voids"],
      failureModes: [
        f("CA-ROOM-LEAKAGE", "CA-ROOM-INTEGRITY", "Enclosure leakage",
          "new penetrations, failed seals or open dampers let agent leak out before the fire is out",
          ["unsealed penetrations", "door seal wear", "damper failure"],
          ["concentration lost before hold time", "re-ignition"],
          ["door_status", "damper_status", "inspection"],
          ["room_integrity_test", "penetration_survey"], 5),
      ],
    },
  ],
};
