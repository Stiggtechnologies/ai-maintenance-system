import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { industrialAcMotorDna, refrigerationCircuitDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Computer room air conditioner (direct expansion). */
export const computerRoomAirConditionerTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-CRAC",
  name: "Computer room air conditioner (direct expansion)",
  family: "critical_cooling",
  description:
    "Reusable engineering template for direct-expansion computer room air conditioners with integral or remote condensers. Refrigerant handling stays with certified technicians; setpoints come only from the site's approved envelope.",
  functions: ["cool air with an integral refrigeration circuit", "move air through the IT space"],
  operatingStates: ["running", "standby", "alarm", "maintenance", "offline"],
  standards: ["ASHRAE TC 9.9", "ASHRAE 15", "ASHRAE 127", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "CRAC-REFRIGERATION",
      name: "Compressor and refrigeration circuit",
      sharedComponentDnaCodes: [refrigerationCircuitDna.code],
      functions: ["remove heat by vapour compression"],
      telemetryConcepts: ["suction_pressure", "discharge_pressure", "compressor_status", "superheat"],
      inspectionZones: ["compressor", "evaporator", "expansion valve", "refrigerant lines"],
      failureModes: [
        f("CRAC-REFRIGERANT-LOSS", "CRAC-REFRIGERATION", "Refrigerant loss",
          "leaks reduce charge and cooling capacity",
          ["brazed joint leak", "vibration fatigue"],
          ["capacity loss", "compressor damage"],
          ["suction_pressure", "superheat"],
          ["certified_refrigerant_leak_check"], 4),
        f("CRAC-COMPRESSOR-FAIL", "CRAC-REFRIGERATION", "Compressor failure",
          "electrical or mechanical compressor failure stops cooling from the unit",
          ["liquid slugging", "overheating", "electrical fault"],
          ["unit loss of cooling"],
          ["compressor_status", "alarm_code"],
          ["certified_refrigeration_assessment"], 4),
      ],
    },
    {
      code: "CRAC-FANS",
      name: "Fans and motors",
      sharedComponentDnaCodes: [industrialAcMotorDna.code],
      functions: ["move air"],
      telemetryConcepts: ["fan_speed", "fan_power", "airflow"],
      inspectionZones: ["fans", "motors"],
      failureModes: [
        f("CRAC-FAN-FAIL", "CRAC-FANS", "Fan failure",
          "fan or motor failure reduces airflow",
          ["bearing wear", "drive fault"],
          ["hot spots"],
          ["fan_speed", "alarm_code"],
          ["fan_inspection"], 3),
      ],
    },
    {
      code: "CRAC-CONDENSER",
      name: "Condenser and heat rejection",
      functions: ["reject heat outdoors"],
      telemetryConcepts: ["condensing_pressure", "condenser_fan_status"],
      inspectionZones: ["condenser coil", "condenser fans"],
      failureModes: [
        f("CRAC-CONDENSER-FOULING", "CRAC-CONDENSER", "Condenser fouling or fan failure",
          "fouled coils or failed fans raise head pressure and trip the compressor",
          ["debris", "fan failure"],
          ["high-pressure trips", "capacity loss"],
          ["condensing_pressure"],
          ["coil_inspection"], 3),
      ],
    },
  ],
};
