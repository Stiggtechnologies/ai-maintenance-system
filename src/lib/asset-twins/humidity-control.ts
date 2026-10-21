import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Humidification and dehumidification. */
export const humidityControlTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-HUMIDITY",
  name: "Humidification and dehumidification",
  family: "critical_cooling",
  description:
    "Reusable engineering template for humidifiers and dehumidification serving IT spaces. Humidity and dew point envelope come only from the site's approved environmental specification.",
  functions: [
    "add moisture when air is too dry",
    "remove moisture when air is too wet",
  ],
  operatingStates: ["humidifying", "dehumidifying", "idle", "alarm"],
  standards: ["ASHRAE TC 9.9", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "HUM-HUMIDIFIER",
      name: "Humidifier and water supply",
      functions: ["add moisture"],
      telemetryConcepts: [
        "humidifier_status",
        "room_humidity",
        "water_conductivity",
      ],
      inspectionZones: ["humidifier", "water supply", "drain"],
      failureModes: [
        f(
          "HUM-HUMIDIFIER-FAIL",
          "HUM-HUMIDIFIER",
          "Humidifier failure or overrun",
          "failed humidifiers let air dry out; stuck ones wet it",
          ["scale", "valve failure", "sensor drift"],
          ["static discharge risk", "condensation"],
          ["room_humidity", "humidifier_status"],
          ["humidifier_inspection"],
          3,
        ),
      ],
    },
    {
      code: "HUM-SENSORS",
      name: "Humidity sensors",
      functions: ["measure humidity and dew point"],
      telemetryConcepts: ["sensor_status"],
      inspectionZones: ["sensors"],
      failureModes: [
        f(
          "HUM-SENSOR-DRIFT",
          "HUM-SENSORS",
          "Humidity sensor drift",
          "drifting sensors make units fight or over-humidify",
          ["sensor ageing"],
          ["units fighting", "condensation"],
          ["cross_check_between_sensors"],
          ["sensor_calibration_check"],
          3,
        ),
      ],
    },
  ],
};
