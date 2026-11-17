import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { switchgearDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for automatic transfer switches and paralleling switchgear. */
export const automaticTransferSwitchTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-TRANSFER-SWITCH",
  name: "Automatic transfer switch and critical switchgear",
  family: "critical_power",
  description:
    "Reusable engineering template for automatic transfer switches and critical low- and medium-voltage switchgear between utility, generator and UPS. Recommendations never operate, test-transfer or bypass a switch.",
  functions: [
    "sense loss of the normal source",
    "transfer load to the alternate source",
    "retransfer when the normal source is stable",
    "isolate faults",
  ],
  operatingStates: ["normal_source", "alternate_source", "transferring", "bypass_isolation", "locked_out"],
  standards: ["NFPA 110", "UL 1008", "NFPA 70B", "IEEE C37", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "ATS-MECHANISM",
      name: "Transfer mechanism and contacts",
      sharedComponentDnaCodes: [switchgearDna.code],
      functions: ["move load between sources", "carry load current"],
      telemetryConcepts: ["switch_position", "transfer_time", "phase_current", "contact_temperature"],
      inspectionZones: ["main contacts", "arc chutes", "operating mechanism", "position indicators"],
      failureModes: [
        f("ATS-FAIL-TO-TRANSFER", "ATS-MECHANISM", "Fails to transfer or retransfer",
          "mechanism wear, lubrication loss or control faults stop the switch moving when commanded",
          ["mechanism wear", "dried lubricant", "control power loss", "misadjustment"],
          ["load stays on failed source", "outage reaches critical load"],
          ["transfer_time", "switch_position", "inspection"],
          ["witnessed_transfer_test", "qualified_electrical_assessment"], 5),
        f("ATS-CONTACT-WEAR", "ATS-MECHANISM", "Contact erosion and high resistance",
          "repeated transfers and arcing erode contacts, raising resistance and heat",
          ["transfer count", "arcing", "contamination"],
          ["contact heating", "welding of contacts", "arc fault"],
          ["thermal_imaging", "contact_temperature"],
          ["contact_resistance_test", "deenergized_electrical_inspection"], 4),
      ],
    },
    {
      code: "ATS-CONTROLS",
      name: "Source sensing and transfer controls",
      sharedComponentDnaCodes: [switchgearDna.code],
      functions: ["detect source failure", "time and sequence the transfer"],
      telemetryConcepts: ["source_voltage", "source_frequency", "controller_alarm", "control_power_status"],
      inspectionZones: ["controller", "sensing wiring", "control power supply"],
      failureModes: [
        f("ATS-SENSING-FAULT", "ATS-CONTROLS", "Source sensing or timing fault",
          "sensing, timer or controller faults cause no transfer, late transfer or nuisance transfers",
          ["controller failure", "loose sensing wiring", "incorrect settings"],
          ["unnecessary generator starts", "delayed transfer", "no transfer"],
          ["controller_alarm", "event_log_review"],
          ["witnessed_transfer_test", "settings_review_against_approved_record"], 4),
      ],
    },
    {
      code: "ATS-BUS",
      name: "Bus, terminations and insulation",
      sharedComponentDnaCodes: [switchgearDna.code],
      functions: ["carry current", "maintain insulation"],
      telemetryConcepts: ["phase_current", "cabinet_temperature", "partial_discharge"],
      inspectionZones: ["bus joints", "cable terminations", "insulators"],
      failureModes: [
        f("ATS-BUS-HOT", "ATS-BUS", "Hot bus joint or termination",
          "loose or corroded joints overheat under load",
          ["fastener loosening", "corrosion", "thermal cycling"],
          ["insulation damage", "arc flash hazard", "outage"],
          ["thermal_imaging", "phase_current"],
          ["deenergized_torque_check", "connection_resistance_test"], 5),
        f("ATS-INSULATION", "ATS-BUS", "Insulation deterioration",
          "contamination, moisture or tracking reduces insulation integrity",
          ["dust", "moisture", "ageing"],
          ["flashover", "outage"],
          ["partial_discharge", "inspection"],
          ["insulation_test", "qualified_electrical_assessment"], 5),
      ],
    },
  ],
};
