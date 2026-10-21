import { draftCriticalFacilityFailure as f } from "./critical-facility-failure";
import type { AssetClassTemplate } from "./types";

/** Manufacturer-neutral template: Raised floor and overhead pathways. */
export const raisedFloorPathwaysTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "CRIT-RAISED-FLOOR",
  name: "Raised floor and overhead pathways",
  family: "it_space",
  description:
    "Reusable engineering template for raised floor, perforated tiles and cable pathways. Load ratings come only from the manufacturer and the approved structural design.",
  functions: [
    "carry cabling",
    "deliver supply air through the floor where used",
    "support equipment loads",
  ],
  operatingStates: ["in_service", "tiles_lifted"],
  standards: ["ANSI/TIA-942", "EN 50600", "ISO 55000"],
  reviewState: "draft",
  components: [
    {
      code: "RF-FLOOR",
      name: "Pedestals, tiles and perforated tiles",
      functions: ["support loads", "deliver air"],
      telemetryConcepts: ["underfloor_pressure"],
      inspectionZones: ["pedestals", "tiles", "perforated tiles", "stringers"],
      failureModes: [
        f(
          "RF-AIR-LEAKAGE",
          "RF-FLOOR",
          "Floor air leakage or misplaced tiles",
          "open cut-outs and misplaced perforated tiles waste supply air",
          ["unsealed cut-outs", "tiles moved during works"],
          ["low underfloor pressure", "hot spots"],
          ["underfloor_pressure", "inspection"],
          ["floor_survey"],
          3,
        ),
        f(
          "RF-OVERLOAD",
          "RF-FLOOR",
          "Floor overload",
          "heavy equipment or moving loads exceed tile or pedestal ratings",
          ["heavy racks", "equipment moves"],
          ["tile failure", "injury"],
          ["inspection"],
          ["structural_review"],
          4,
        ),
      ],
    },
    {
      code: "RF-PATHWAYS",
      name: "Cable trays and ladders",
      functions: ["carry power and data cabling"],
      telemetryConcepts: [],
      inspectionZones: ["trays", "ladders", "fibre pathways"],
      failureModes: [
        f(
          "RF-PATHWAY-OVERFILL",
          "RF-PATHWAYS",
          "Pathway overfill",
          "overfilled trays block airflow and strain supports",
          ["unmanaged cable growth", "abandoned cable"],
          ["airflow blockage", "support failure"],
          ["inspection"],
          ["pathway_survey"],
          2,
        ),
      ],
    },
  ],
};
