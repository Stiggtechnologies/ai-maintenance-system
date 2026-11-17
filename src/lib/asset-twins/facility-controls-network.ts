import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Facility controls network. */
export const facilityControlsNetworkTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-OT-NETWORK",
  name: "Facility controls network",
  family: "critical_controls",
  description:
    "Reusable engineering template for the operational technology network carrying BMS, EPMS, fire and security traffic. Segmentation and access rules come only from the approved security architecture.",
  functions: ["carry control and monitoring traffic", "keep controls segmented and secure"],
  operatingStates: ["normal", "degraded", "isolated"],
  standards: ["IEC 62443", "NIST SP 800-82", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "OTN-SWITCHING",
      name: "Switches, fibre and redundant paths",
      functions: ["carry traffic"],
      telemetryConcepts: ["link_status", "switch_status", "path_redundancy_status"],
      inspectionZones: ["switches", "fibre", "patching"],
      failureModes: [
        f("OTN-PATH-LOSS", "OTN-SWITCHING", "Loss of network path",
          "switch or fibre failure cuts controllers off from supervisors",
          ["switch failure", "fibre damage", "single path"],
          ["loss of visibility and control"],
          ["link_status", "path_redundancy_status"],
          ["network_failover_test"], 4),
      ],
    },
    {
      code: "OTN-SECURITY",
      name: "Firewalls and remote access",
      functions: ["restrict access"],
      telemetryConcepts: ["firewall_status", "remote_session_log"],
      inspectionZones: ["firewalls", "remote access gateway"],
      failureModes: [
        f("OTN-UNAUTHORISED-ACCESS", "OTN-SECURITY", "Unauthorised access",
          "weak segmentation or remote access lets an attacker reach plant controls",
          ["flat network", "shared credentials", "unpatched devices"],
          ["plant manipulation", "outage"],
          ["remote_session_log", "firewall_status"],
          ["cybersecurity_review"], 5),
      ],
    },
  ],
};
