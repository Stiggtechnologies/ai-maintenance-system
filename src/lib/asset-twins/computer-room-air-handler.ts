import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { industrialAcMotorDna, rollingElementBearingDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for chilled-water computer room air handlers (CRAH) and fan walls. */
export const computerRoomAirHandlerTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-CRAH",
  name: "Computer room air handler (chilled water)",
  family: "critical_cooling",
  description:
    "Reusable engineering template for chilled-water air handlers and fan walls serving data halls. Supply-air and humidity setpoints come only from the site's approved environmental envelope; recommendations never change setpoints or stop units.",
  functions: ["move air through the IT space", "remove heat from return air", "drain condensate"],
  operatingStates: ["running", "standby", "lead_lag_rotation", "alarm", "maintenance", "offline"],
  standards: ["ASHRAE TC 9.9", "ASHRAE 127", "ISO 16890", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "CRAH-FANS",
      name: "Fan array and motors",
      sharedComponentDnaCodes: [industrialAcMotorDna.code, rollingElementBearingDna.code],
      functions: ["move supply air"],
      telemetryConcepts: ["fan_speed", "fan_power", "airflow", "differential_pressure", "vibration"],
      inspectionZones: ["fan wheels", "motors", "EC drive electronics", "inlet guards"],
      failureModes: [
        f("CRAH-FAN-FAILURE", "CRAH-FANS", "Fan or EC motor failure",
          "bearing wear, drive electronics faults or imbalance stop a fan and reduce airflow",
          ["bearing wear", "drive electronics ageing", "imbalance", "dust loading"],
          ["reduced airflow", "hot spots at rack intakes"],
          ["fan_speed", "fan_power", "vibration", "alarm_code"],
          ["vibration_assessment", "qualified_hvac_inspection"], 4),
      ],
    },
    {
      code: "CRAH-COIL",
      name: "Cooling coil and chilled-water valve",
      functions: ["exchange heat with chilled water", "modulate water flow"],
      telemetryConcepts: ["supply_air_temperature", "return_air_temperature", "valve_position", "chw_supply_temperature", "chw_return_temperature"],
      inspectionZones: ["coil face", "control valve and actuator", "piping connections"],
      failureModes: [
        f("CRAH-COIL-FOULING", "CRAH-COIL", "Coil fouling or air-side blockage",
          "dust and debris on the coil reduce heat transfer and raise air-side resistance",
          ["filter bypass", "missed filter changes", "construction dust"],
          ["rising supply air temperature", "higher fan power"],
          ["supply_air_temperature", "differential_pressure", "inspection"],
          ["coil_inspection", "qualified_hvac_inspection"], 3),
        f("CRAH-VALVE-STUCK", "CRAH-COIL", "Chilled-water valve stuck or actuator failure",
          "actuator or valve faults stop the unit modulating cooling",
          ["actuator failure", "debris", "control signal loss"],
          ["loss of cooling from the unit", "overcooling and condensation"],
          ["valve_position", "supply_air_temperature"],
          ["valve_stroke_check", "controls_point_to_point_check"], 4),
      ],
    },
    {
      code: "CRAH-FILTERS-DRAIN",
      name: "Filters, condensate pan and drain",
      functions: ["filter air", "remove condensate"],
      telemetryConcepts: ["filter_differential_pressure", "condensate_alarm", "leak_alarm"],
      inspectionZones: ["filter bank", "drain pan", "condensate pump", "drain line"],
      failureModes: [
        f("CRAH-DRAIN-BLOCKED", "CRAH-FILTERS-DRAIN", "Condensate drain blocked or pump failure",
          "blocked drains or failed condensate pumps let water overflow under the unit",
          ["biological growth", "debris", "pump failure"],
          ["water under raised floor", "leak alarm", "equipment damage"],
          ["condensate_alarm", "leak_alarm", "inspection"],
          ["drain_inspection", "qualified_hvac_inspection"], 4),
      ],
    },
    {
      code: "CRAH-CONTROLS",
      name: "Unit controller and sensors",
      functions: ["control fans and valve to the approved setpoint", "report alarms"],
      telemetryConcepts: ["controller_alarm", "sensor_status", "communication_status"],
      inspectionZones: ["controller", "temperature and humidity sensors", "communication wiring"],
      failureModes: [
        f("CRAH-SENSOR-DRIFT", "CRAH-CONTROLS", "Sensor drift or controller fault",
          "drifting sensors or lost communication make the unit control to the wrong condition",
          ["sensor ageing", "loose wiring", "firmware fault"],
          ["over- or under-cooling", "unit fighting neighbours"],
          ["sensor_status", "cross_check_with_neighbour_units"],
          ["sensor_calibration_check", "controls_point_to_point_check"], 3),
      ],
    },
  ],
};
