import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for passive and active rear-door heat exchangers. */
export const rearDoorHeatExchangerTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-RDHX",
  name: "Rear-door heat exchanger",
  family: "critical_cooling",
  description:
    "Reusable engineering template for passive and fan-assisted rear-door coils removing rack exhaust heat. Water temperature limits that avoid condensation come only from the site's approved design.",
  functions: ["remove rack exhaust heat", "avoid condensation"],
  operatingStates: ["running", "isolated", "alarm", "offline"],
  standards: ["ASHRAE TC 9.9", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "RDHX-COIL",
      name: "Coil, valves and hoses",
      functions: ["exchange heat with rack exhaust"],
      telemetryConcepts: ["water_supply_temperature", "water_return_temperature", "valve_position", "leak_alarm"],
      inspectionZones: ["coil", "quick connects", "hoses", "condensate path"],
      failureModes: [
        f("RDHX-LEAK", "RDHX-COIL", "Leak at coil or hose",
          "damaged hoses or quick connects leak water behind the rack",
          ["hose ageing", "door impact", "connector wear"],
          ["IT equipment damage", "door isolated"],
          ["leak_alarm", "inspection"],
          ["leak_inspection"], 5),
        f("RDHX-CONDENSATION", "RDHX-COIL", "Condensation on coil",
          "water supplied below room dew point condenses on the coil",
          ["supply water too cold for room conditions", "humidity excursion"],
          ["water drips", "corrosion"],
          ["water_supply_temperature", "room_dew_point"],
          ["controls_point_to_point_check"], 4),
      ],
    },
    {
      code: "RDHX-FANS",
      name: "Door fans (active doors)",
      functions: ["move exhaust air through the coil"],
      telemetryConcepts: ["fan_status", "fan_speed"],
      inspectionZones: ["fans", "fan power supply"],
      failureModes: [
        f("RDHX-FAN-FAILURE", "RDHX-FANS", "Door fan failure",
          "failed fans reduce airflow through the coil and raise rack exhaust temperature",
          ["bearing wear", "power supply failure"],
          ["hot exhaust into the room", "rack back-pressure"],
          ["fan_status", "rack_exhaust_temperature"],
          ["fan_inspection"], 3),
      ],
    },
  ],
};
