import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { centrifugalPumpComponentDna, industrialAcMotorDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for liquid-cooling coolant distribution units (in-row or facility). */
export const coolantDistributionUnitTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-CDU",
  name: "Coolant distribution unit",
  family: "critical_cooling",
  description:
    "Reusable engineering template for CDUs that circulate technology coolant to direct-to-chip, rear-door or immersion loops and exchange heat with facility water. Coolant chemistry, flow and supply temperature limits come only from the IT and CDU manufacturers' approved documents.",
  functions: ["circulate technology coolant", "exchange heat with facility water", "keep coolant clean and inside its chemistry"],
  operatingStates: ["running", "redundant_pump_standby", "alarm", "isolated", "offline"],
  standards: ["ASHRAE TC 9.9", "OCP Advanced Cooling Solutions", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "CDU-PUMPS",
      name: "Circulation pumps and motors",
      sharedComponentDnaCodes: [centrifugalPumpComponentDna.code, industrialAcMotorDna.code],
      functions: ["circulate coolant"],
      telemetryConcepts: ["pump_speed", "flow_rate", "differential_pressure", "motor_current", "vibration"],
      inspectionZones: ["pumps", "motors", "isolation valves"],
      failureModes: [
        f("CDU-PUMP-FAILURE", "CDU-PUMPS", "Pump failure or loss of flow",
          "seal, bearing or motor failure stops a pump; without a standby the loop loses flow",
          ["seal wear", "bearing wear", "cavitation", "motor failure"],
          ["IT thermal throttling", "IT shutdown"],
          ["flow_rate", "differential_pressure", "vibration"],
          ["vibration_assessment", "manufacturer_assessment"], 5),
      ],
    },
    {
      code: "CDU-HEAT-EXCHANGER",
      name: "Liquid-to-liquid heat exchanger and control valve",
      functions: ["transfer heat to facility water", "control coolant supply temperature to approved setpoint"],
      telemetryConcepts: ["coolant_supply_temperature", "coolant_return_temperature", "facility_water_temperature", "valve_position"],
      inspectionZones: ["plate heat exchanger", "control valve", "facility water connections"],
      failureModes: [
        f("CDU-HX-FOULING", "CDU-HEAT-EXCHANGER", "Heat exchanger fouling",
          "deposits on either side reduce heat transfer and raise coolant supply temperature",
          ["facility water quality", "coolant degradation"],
          ["rising coolant temperature", "IT throttling"],
          ["coolant_supply_temperature", "approach_temperature"],
          ["heat_exchanger_inspection"], 4),
      ],
    },
    {
      code: "CDU-COOLANT-QUALITY",
      name: "Filters, expansion tank and coolant",
      functions: ["filter particulates", "hold pressure and volume", "maintain coolant chemistry"],
      telemetryConcepts: ["filter_differential_pressure", "loop_pressure", "reservoir_level", "conductivity"],
      inspectionZones: ["filters", "expansion tank", "fill and drain points", "sampling port"],
      failureModes: [
        f("CDU-COOLANT-CONTAMINATION", "CDU-COOLANT-QUALITY", "Coolant contamination or chemistry drift",
          "particles, biological growth or inhibitor depletion clog cold plates and corrode wetted parts",
          ["inhibitor depletion", "incompatible materials", "poor fill practice"],
          ["cold plate blockage", "corrosion leaks"],
          ["filter_differential_pressure", "coolant_sampling", "conductivity"],
          ["coolant_sampling", "filter_inspection"], 4),
      ],
    },
    {
      code: "CDU-LEAK-CONTROLS",
      name: "Leak detection and controls",
      functions: ["detect leaks", "isolate the loop on leak", "report status"],
      telemetryConcepts: ["leak_alarm", "controller_alarm", "communication_status"],
      inspectionZones: ["drip tray", "leak sensors", "controller"],
      failureModes: [
        f("CDU-LEAK", "CDU-LEAK-CONTROLS", "Coolant leak",
          "fittings, hoses or seals leak coolant near energised IT equipment",
          ["fitting loosening", "hose ageing", "seal failure"],
          ["IT equipment damage", "loss of coolant", "loop shutdown"],
          ["leak_alarm", "reservoir_level", "inspection"],
          ["leak_inspection", "pressure_hold_test"], 5),
      ],
    },
  ],
};
