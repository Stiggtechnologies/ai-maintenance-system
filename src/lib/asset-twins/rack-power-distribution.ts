import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Rack power distribution unit. */
export const rackPowerDistributionTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-RACK-PDU",
  name: "Rack power distribution unit",
  family: "critical_power",
  description:
    "Reusable engineering template for metered and switched rack power strips. Outlet and inlet ratings come only from the nameplate; recommendations never switch outlets.",
  functions: ["deliver power to IT devices in the rack", "meter rack load"],
  operatingStates: ["energized", "alarm", "offline"],
  standards: ["IEC 60950-1", "UL 60950-1", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "RPDU-OUTLETS",
      name: "Inlet, outlets and protection",
      functions: ["feed IT devices"],
      telemetryConcepts: ["inlet_current", "outlet_status", "breaker_status"],
      inspectionZones: ["inlet cord and plug", "outlets", "branch protection"],
      failureModes: [
        f(
          "RPDU-OVERLOAD",
          "RPDU-OUTLETS",
          "Overload on failover",
          "load that is safe on two feeds exceeds one strip's rating when the other feed fails",
          ["unplanned IT additions", "no failover load check"],
          ["rack outage on loss of one feed"],
          ["inlet_current"],
          ["load_review_against_approved_design"],
          4,
        ),
        f(
          "RPDU-LOOSE-PLUG",
          "RPDU-OUTLETS",
          "Loose or overheating plug",
          "partially seated plugs overheat or drop out",
          ["cable strain", "vibration"],
          ["device outage"],
          ["outlet_status", "thermal_imaging"],
          ["rack_inspection"],
          3,
        ),
      ],
    },
    {
      code: "RPDU-METERING",
      name: "Metering and network module",
      functions: ["report rack load"],
      telemetryConcepts: ["communication_status", "kwh"],
      inspectionZones: ["network card", "display"],
      failureModes: [
        f(
          "RPDU-METER-LOSS",
          "RPDU-METERING",
          "Metering loss",
          "failed network modules hide rack load",
          ["module failure", "network fault"],
          ["unseen overload"],
          ["communication_status"],
          ["metering_verification"],
          2,
        ),
      ],
    },
  ],
};
