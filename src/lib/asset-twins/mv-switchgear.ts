import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { switchgearDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for medium-voltage switchgear and protection at critical facilities. */
export const mvSwitchgearTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-MV-SWITCHGEAR",
  name: "Medium-voltage switchgear and protection",
  family: "critical_power",
  description:
    "Reusable engineering template for medium-voltage incoming, tie and feeder switchgear with protection relays. Protection settings come only from the approved coordination study; switching stays with authorised persons under the site's switching programme.",
  functions: ["receive utility supply", "switch and isolate feeders", "detect and clear faults"],
  operatingStates: ["closed", "open", "earthed", "racked_out", "tripped", "locked_out"],
  standards: ["IEC 62271", "IEEE C37", "NFPA 70B", "NFPA 70E", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "MVSG-BREAKERS",
      name: "Circuit breakers and interrupters",
      sharedComponentDnaCodes: [switchgearDna.code],
      functions: ["make and break load and fault current"],
      telemetryConcepts: ["breaker_position", "operation_count", "trip_event", "phase_current"],
      inspectionZones: ["vacuum or gas interrupters", "operating mechanism", "racking mechanism"],
      failureModes: [
        f("MVSG-FAIL-TO-TRIP", "MVSG-BREAKERS", "Breaker fails to trip or close",
          "mechanism wear, lubrication loss or trip coil failure stop the breaker operating",
          ["dried lubricant", "trip coil failure", "mechanism wear"],
          ["fault not cleared", "upstream trip", "wider outage"],
          ["trip_event", "operation_count", "inspection"],
          ["breaker_timing_test", "qualified_electrical_assessment"], 5),
      ],
    },
    {
      code: "MVSG-PROTECTION",
      name: "Protection relays, CTs and VTs",
      functions: ["detect faults and command trips"],
      telemetryConcepts: ["relay_alarm", "relay_event", "settings_checksum"],
      inspectionZones: ["relays", "current and voltage transformers", "DC trip supply"],
      failureModes: [
        f("MVSG-PROTECTION-FAULT", "MVSG-PROTECTION", "Protection misoperation",
          "relay failure, wrong settings or a lost DC trip supply cause no trip or a wrong trip",
          ["settings drift from approved study", "DC supply failure", "CT wiring fault"],
          ["fault not cleared", "nuisance outage", "loss of selectivity"],
          ["relay_alarm", "settings_checksum", "dc_supply_status"],
          ["relay_secondary_injection_test", "settings_review_against_coordination_study"], 5),
      ],
    },
    {
      code: "MVSG-INSULATION",
      name: "Busbars, cable terminations and insulation",
      sharedComponentDnaCodes: [switchgearDna.code],
      functions: ["carry current", "maintain insulation"],
      telemetryConcepts: ["partial_discharge", "busbar_temperature", "humidity"],
      inspectionZones: ["busbar joints", "cable terminations", "insulators", "heaters"],
      failureModes: [
        f("MVSG-PARTIAL-DISCHARGE", "MVSG-INSULATION", "Partial discharge and insulation breakdown",
          "contamination, moisture or termination defects cause partial discharge that grows to flashover",
          ["moisture", "contamination", "termination defects"],
          ["arc flash", "switchboard outage"],
          ["partial_discharge", "ultrasonic_survey", "thermal_imaging"],
          ["partial_discharge_survey", "insulation_test"], 5),
      ],
    },
    {
      code: "MVSG-CONTROL-POWER",
      name: "DC control and trip supply",
      functions: ["power trip and close circuits"],
      telemetryConcepts: ["dc_supply_status", "battery_voltage", "charger_alarm"],
      inspectionZones: ["battery", "charger", "distribution"],
      failureModes: [
        f("MVSG-DC-LOSS", "MVSG-CONTROL-POWER", "Loss of DC trip supply",
          "battery or charger failure removes the energy breakers need to trip",
          ["battery ageing", "charger failure"],
          ["breakers cannot trip", "fault not cleared"],
          ["dc_supply_status", "charger_alarm"],
          ["battery_test", "charger_inspection"], 5),
      ],
    },
  ],
};
