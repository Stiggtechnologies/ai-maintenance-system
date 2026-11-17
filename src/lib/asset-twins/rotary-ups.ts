import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { powerConverterDna, rollingElementBearingDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Flywheel or rotary UPS. */
export const rotaryUpsTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-ROTARY-UPS",
  name: "Flywheel or rotary UPS",
  family: "critical_power",
  description:
    "Reusable engineering template for flywheel energy storage and diesel or static rotary UPS. Speed, vacuum and bearing limits come only from the manufacturer's approved documents; recommendations never take a unit offline.",
  functions: ["store kinetic energy", "bridge source loss until generation picks up"],
  operatingStates: ["online", "discharging", "recharging", "bypass", "offline"],
  standards: ["IEC 62040", "ISO 8528-11", "NFPA 70B", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "RUPS-ROTOR",
      name: "Flywheel rotor, bearings and vacuum system",
      sharedComponentDnaCodes: [rollingElementBearingDna.code],
      functions: ["store kinetic energy"],
      telemetryConcepts: ["rotor_speed", "bearing_temperature", "vibration", "vacuum_level"],
      inspectionZones: ["rotor housing", "bearings", "vacuum pump"],
      failureModes: [
        f("RUPS-BEARING-WEAR", "RUPS-ROTOR", "Bearing wear",
          "high-speed bearings wear or lose lubrication and raise vibration",
          ["lubricant ageing", "contamination", "cycling"],
          ["unit trips", "stored energy unavailable"],
          ["vibration", "bearing_temperature"],
          ["vibration_assessment", "manufacturer_assessment"], 4),
        f("RUPS-VACUUM-LOSS", "RUPS-ROTOR", "Loss of vacuum",
          "seal or pump failure raises windage losses and heat",
          ["seal wear", "vacuum pump failure"],
          ["overheating", "reduced ride-through"],
          ["vacuum_level"],
          ["manufacturer_assessment"], 3),
      ],
    },
    {
      code: "RUPS-POWER-ELECTRONICS",
      name: "Motor-generator and power electronics",
      sharedComponentDnaCodes: [powerConverterDna.code],
      functions: ["convert between kinetic and electrical energy"],
      telemetryConcepts: ["output_voltage", "dc_bus_voltage", "alarm_code"],
      inspectionZones: ["converter", "motor-generator", "controls"],
      failureModes: [
        f("RUPS-CONVERTER-FAULT", "RUPS-POWER-ELECTRONICS", "Converter or controller fault",
          "power electronics or control faults stop the unit discharging on demand",
          ["thermal stress", "component ageing"],
          ["no ride-through on source loss"],
          ["alarm_code"],
          ["qualified_power_electronics_assessment"], 5),
      ],
    },
  ],
};
