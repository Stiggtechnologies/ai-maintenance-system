import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { powerConverterDna, stationaryBatteryDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for lithium-ion battery energy storage cabinets serving UPS systems. */
export const batteryEnergyStorageTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-BESS",
  name: "Lithium-ion battery energy storage (UPS)",
  family: "critical_power",
  description:
    "Reusable engineering template for lithium-ion battery cabinets and racks behind UPS systems. Charge, temperature and state-of-health limits come only from the manufacturer's approved documentation; isolation and module replacement stay with qualified staff.",
  functions: ["store energy for ride-through", "protect cells from abuse conditions", "contain and signal a thermal event"],
  operatingStates: ["float", "charging", "discharging", "isolated", "alarm", "offline"],
  standards: ["NFPA 855", "UL 9540", "UL 9540A", "IEC 62619", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "BESS-MODULES",
      name: "Battery modules and cells",
      sharedComponentDnaCodes: [stationaryBatteryDna.code],
      functions: ["store and release energy"],
      telemetryConcepts: ["cell_voltage", "cell_temperature", "state_of_charge", "state_of_health", "module_alarm"],
      inspectionZones: ["modules", "inter-module connectors", "rack structure"],
      failureModes: [
        f("BESS-THERMAL-RUNAWAY", "BESS-MODULES", "Cell thermal runaway",
          "internal short, abuse or manufacturing defect drives a cell into self-heating that can spread to neighbours",
          ["internal defect", "overcharge", "mechanical damage", "high ambient temperature"],
          ["off-gas release", "fire", "loss of ride-through", "evacuation"],
          ["cell_temperature", "off_gas_detection", "module_alarm"],
          ["manufacturer_assessment", "qualified_battery_inspection"], 5),
        f("BESS-CAPACITY-FADE", "BESS-MODULES", "Capacity fade",
          "cycling, calendar ageing and temperature reduce usable energy below the site's ride-through need",
          ["calendar ageing", "high temperature", "frequent cycling"],
          ["insufficient ride-through during outage"],
          ["state_of_health", "discharge_test_result"],
          ["witnessed_discharge_test", "manufacturer_assessment"], 4),
      ],
    },
    {
      code: "BESS-BMS",
      name: "Battery management system",
      sharedComponentDnaCodes: [powerConverterDna.code],
      functions: ["monitor cells", "balance cells", "open contactors on unsafe conditions"],
      telemetryConcepts: ["bms_status", "communication_status", "contactor_state", "balancing_status"],
      inspectionZones: ["BMS controllers", "sensing harnesses", "contactors"],
      failureModes: [
        f("BESS-BMS-FAULT", "BESS-BMS", "BMS sensing or protection fault",
          "lost sensing or a failed contactor removes the protection that keeps cells inside safe limits",
          ["harness damage", "firmware fault", "contactor welding"],
          ["unprotected cells", "string offline"],
          ["bms_status", "communication_status", "contactor_state"],
          ["manufacturer_assessment"], 5),
      ],
    },
    {
      code: "BESS-ENVIRONMENT",
      name: "Cabinet cooling, off-gas detection and suppression interface",
      functions: ["hold cells within the approved temperature range", "detect off-gas early"],
      telemetryConcepts: ["cabinet_temperature", "off_gas_detection", "hvac_status", "suppression_status"],
      inspectionZones: ["cabinet fans or HVAC", "off-gas sensors", "ventilation", "suppression interface"],
      failureModes: [
        f("BESS-COOLING-LOSS", "BESS-ENVIRONMENT", "Cabinet cooling or detection failure",
          "failed cooling raises cell temperature; failed off-gas detection removes early warning",
          ["fan or HVAC failure", "sensor failure", "blocked ventilation"],
          ["accelerated ageing", "late detection of a thermal event"],
          ["cabinet_temperature", "hvac_status", "sensor_status"],
          ["detector_function_test", "hvac_inspection"], 4),
      ],
    },
  ],
};
