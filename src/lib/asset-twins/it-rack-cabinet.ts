import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: IT racks and cabinets (critical load). */
export const itRackCabinetTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-IT-RACK",
  name: "IT racks and cabinets (critical load)",
  family: "it_space",
  description:
    "Reusable engineering template for IT racks and cabinets as the facility's critical load. The facility twin observes rack conditions only; it never touches IT equipment.",
  functions: ["house IT equipment", "present IT load to power and cooling"],
  operatingStates: ["in_service", "installing", "decommissioning"],
  standards: ["ANSI/TIA-942", "EN 50600", "ASHRAE TC 9.9", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "RACK-ENVIRONMENT",
      name: "Rack environment sensing",
      functions: ["report inlet and exhaust conditions"],
      telemetryConcepts: [
        "rack_inlet_temperature",
        "rack_exhaust_temperature",
        "rack_humidity",
      ],
      inspectionZones: ["inlet sensors", "exhaust sensors"],
      failureModes: [
        f(
          "RACK-HOT-SPOT",
          "RACK-ENVIRONMENT",
          "Rack inlet hot spot",
          "recirculation or local cooling shortfall raises inlet temperature above the approved envelope",
          ["missing blanking", "density above design", "cooling unit loss"],
          ["IT throttling or failure"],
          ["rack_inlet_temperature"],
          ["thermal_survey"],
          4,
        ),
      ],
    },
    {
      code: "RACK-STRUCTURE",
      name: "Cabinet, doors and cable management",
      functions: ["support and secure equipment"],
      telemetryConcepts: ["door_status"],
      inspectionZones: [
        "cabinet",
        "doors and locks",
        "cable management",
        "blanking panels",
      ],
      failureModes: [
        f(
          "RACK-AIRFLOW-OBSTRUCTION",
          "RACK-STRUCTURE",
          "Cable or door obstruction of airflow",
          "cable bundles or solid doors obstruct airflow through the rack",
          ["poor cable management", "wrong door type"],
          ["hot spots"],
          ["rack_exhaust_temperature", "inspection"],
          ["rack_inspection"],
          3,
        ),
      ],
    },
  ],
};
