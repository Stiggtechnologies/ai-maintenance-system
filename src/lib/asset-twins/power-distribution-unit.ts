import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { switchgearDna, transformerDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template for floor-standing PDUs and remote power panels. */
export const powerDistributionUnitTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-PDU",
  name: "Power distribution unit and remote power panel",
  family: "critical_power",
  description:
    "Reusable engineering template for floor-standing PDUs (with or without isolation transformer) and remote power panels feeding rack branch circuits. Branch loading limits come only from the site's approved electrical design; recommendations never switch circuits.",
  functions: ["transform and distribute critical power", "protect branch circuits", "meter branch load"],
  operatingStates: ["energized", "partially_isolated", "maintenance", "offline"],
  standards: ["NFPA 70", "NFPA 70B", "IEC 61439", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "PDU-TRANSFORMER",
      name: "Isolation transformer",
      sharedComponentDnaCodes: [transformerDna.code],
      functions: ["isolate and step voltage"],
      telemetryConcepts: ["winding_temperature", "input_current", "output_voltage", "harmonic_distortion"],
      inspectionZones: ["windings", "terminations", "ventilation path"],
      failureModes: [
        f("PDU-TX-OVERHEAT", "PDU-TRANSFORMER", "Transformer overheating",
          "high load, harmonics or blocked ventilation overheat windings and age insulation",
          ["harmonic loading", "blocked ventilation", "load growth"],
          ["insulation ageing", "transformer trip", "rack outage"],
          ["winding_temperature", "harmonic_distortion", "thermal_imaging"],
          ["thermal_imaging", "qualified_electrical_assessment"], 4),
      ],
    },
    {
      code: "PDU-PANELBOARDS",
      name: "Panelboards and branch breakers",
      sharedComponentDnaCodes: [switchgearDna.code],
      functions: ["protect and feed branch circuits"],
      telemetryConcepts: ["branch_current", "breaker_status", "panel_temperature"],
      inspectionZones: ["branch breakers", "neutral and earth bars", "terminations"],
      failureModes: [
        f("PDU-BRANCH-OVERLOAD", "PDU-PANELBOARDS", "Branch circuit overload or imbalance",
          "load growth or uneven phase loading drives branches toward their protective rating",
          ["unplanned IT additions", "phase imbalance", "redundant-cord load doubling on failover"],
          ["breaker trip", "rack outage", "loss of redundancy on failover"],
          ["branch_current", "phase_imbalance"],
          ["load_review_against_approved_design"], 4),
        f("PDU-HOT-TERMINATION", "PDU-PANELBOARDS", "Hot termination",
          "loose or undersized terminations overheat",
          ["loosening", "poor workmanship"],
          ["insulation damage", "arc fault"],
          ["thermal_imaging", "panel_temperature"],
          ["thermal_imaging", "deenergized_torque_check"], 4),
      ],
    },
    {
      code: "PDU-MONITORING",
      name: "Branch circuit monitoring and metering",
      functions: ["measure and report load"],
      telemetryConcepts: ["branch_current", "kwh", "communication_status"],
      inspectionZones: ["current transformers", "meter module", "network card"],
      failureModes: [
        f("PDU-METER-LOSS", "PDU-MONITORING", "Metering failure or drift",
          "failed or drifting monitoring hides real branch loading",
          ["CT failure", "communication loss", "configuration error"],
          ["unseen overload", "wrong capacity decisions"],
          ["communication_status", "cross_check_with_upstream_meter"],
          ["metering_verification"], 3),
      ],
    },
  ],
};
