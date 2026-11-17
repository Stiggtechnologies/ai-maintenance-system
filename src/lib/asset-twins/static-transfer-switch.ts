import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { powerConverterDna, switchgearDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for static transfer switches feeding single-corded critical loads. */
export const staticTransferSwitchTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-STATIC-TRANSFER-SWITCH",
  name: "Static transfer switch",
  family: "critical_power",
  description:
    "Reusable engineering template for thyristor-based static transfer switches between two UPS sources. Transfer and bypass operations stay with qualified site staff.",
  functions: ["sense source quality", "transfer load between sources without interruption", "isolate for maintenance"],
  operatingStates: ["preferred_source", "alternate_source", "maintenance_bypass", "alarm", "offline"],
  standards: ["IEC 62310", "UL 1008", "NFPA 70B", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "STS-SCR",
      name: "Thyristor (SCR) switching modules",
      sharedComponentDnaCodes: [powerConverterDna.code],
      functions: ["switch load current between sources"],
      telemetryConcepts: ["output_current", "scr_status", "heatsink_temperature", "alarm_code"],
      inspectionZones: ["SCR modules", "heatsinks", "snubbers"],
      failureModes: [
        f("STS-SCR-SHORT", "STS-SCR", "Shorted or open thyristor",
          "a failed thyristor prevents a clean transfer or cross-connects sources",
          ["thermal stress", "surge", "ageing"],
          ["failed transfer", "source cross-connection", "load drop"],
          ["scr_status", "alarm_code"],
          ["qualified_power_electronics_assessment"], 5),
      ],
    },
    {
      code: "STS-CONTROLS",
      name: "Source sensing and transfer logic",
      functions: ["detect source disturbance", "decide and time transfers"],
      telemetryConcepts: ["source_voltage", "source_phase_angle", "transfer_event", "controller_alarm"],
      inspectionZones: ["logic boards", "sensing wiring", "control power supplies"],
      failureModes: [
        f("STS-NUISANCE-TRANSFER", "STS-CONTROLS", "Unwanted or blocked transfer",
          "sensing or logic faults trigger unnecessary transfers or block a needed one",
          ["logic board fault", "settings outside approved record", "control power loss"],
          ["load disturbance", "load on failing source"],
          ["transfer_event", "controller_alarm", "event_log_review"],
          ["settings_review_against_approved_record", "witnessed_transfer_test"], 4),
      ],
    },
    {
      code: "STS-BYPASS",
      name: "Maintenance bypass and isolation breakers",
      sharedComponentDnaCodes: [switchgearDna.code],
      functions: ["isolate the switch while keeping load fed"],
      telemetryConcepts: ["breaker_position", "interlock_status"],
      inspectionZones: ["bypass breakers", "interlocks", "terminations"],
      failureModes: [
        f("STS-BYPASS-INTERLOCK", "STS-BYPASS", "Bypass or interlock fault",
          "failed interlocks or breakers make maintenance bypass unsafe or unavailable",
          ["mechanism wear", "misadjustment"],
          ["no safe bypass", "risk of source paralleling"],
          ["breaker_position", "interlock_status", "inspection"],
          ["deenergized_electrical_inspection", "interlock_function_test"], 4),
      ],
    },
    {
      code: "STS-COOLING",
      name: "Cooling fans",
      functions: ["remove heat from switching modules"],
      telemetryConcepts: ["fan_status", "heatsink_temperature"],
      inspectionZones: ["fans", "air filters"],
      failureModes: [
        f("STS-FAN-FAILURE", "STS-COOLING", "Cooling fan failure",
          "fan failure lets the switching modules overheat",
          ["bearing wear", "dust"],
          ["thyristor overheating", "forced transfer or shutdown"],
          ["fan_status", "heatsink_temperature"],
          ["fan_inspection"], 3),
      ],
    },
  ],
};
