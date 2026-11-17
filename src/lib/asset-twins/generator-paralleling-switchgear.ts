import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import { switchgearDna } from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Generator paralleling switchgear. */
export const generatorParallelingSwitchgearTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-PARALLELING-SWITCHGEAR",
  name: "Generator paralleling switchgear",
  family: "critical_power",
  description:
    "Reusable engineering template for generator paralleling switchgear and master controls. Load-shed priorities and synchronising settings come only from the approved design; recommendations never start, parallel or shed.",
  functions: ["synchronise generators", "share load between generators", "shed and restore load by priority"],
  operatingStates: ["standby", "paralleling", "on_generator", "load_shed", "manual", "locked_out"],
  standards: ["NFPA 110", "IEEE C37", "NFPA 70B", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "PSG-BREAKERS",
      name: "Generator and feeder breakers",
      sharedComponentDnaCodes: [switchgearDna.code],
      functions: ["connect generators and loads to the bus"],
      telemetryConcepts: ["breaker_position", "trip_event"],
      inspectionZones: ["breakers", "mechanisms"],
      failureModes: [
        f("PSG-BREAKER-FAIL", "PSG-BREAKERS", "Breaker fails to close or open",
          "a generator breaker that will not close leaves a set off the bus",
          ["mechanism wear", "control power loss"],
          ["reduced generation capacity", "load shed"],
          ["breaker_position", "trip_event"],
          ["witnessed_load_bank_or_transfer_test", "breaker_timing_test"], 5),
      ],
    },
    {
      code: "PSG-CONTROLS",
      name: "Synchronising, load-share and master controls",
      functions: ["synchronise and share load", "run load-shed sequences"],
      telemetryConcepts: ["sync_status", "load_share_balance", "plc_status"],
      inspectionZones: ["master PLC", "synchronisers", "load-share controllers"],
      failureModes: [
        f("PSG-SYNC-FAIL", "PSG-CONTROLS", "Failure to synchronise or unstable load share",
          "control faults stop generators paralleling or make them hunt",
          ["controller fault", "settings drift", "communication loss"],
          ["generators trip", "load dropped"],
          ["sync_status", "load_share_balance"],
          ["witnessed_paralleling_test", "settings_review_against_approved_record"], 5),
      ],
    },
  ],
};
