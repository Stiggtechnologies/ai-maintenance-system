import {
  buildJurisdictionRequirement,
  type JurisdictionRequirementDraft,
  type JurisdictionRequirementRecord,
} from "./jurisdiction-requirements";

/**
 * Alberta housing life-safety template for a jurisdiction pack layer.
 *
 * These are starting drafts, not requirements. Each one names the governing
 * document from the standards register and leaves applicability
 * "undetermined" and obligation "advisory". No interval, frequency or limit is
 * stated anywhere: a named reviewer cites the clause from a held copy or the
 * published code, records the applicability basis for their buildings, and only
 * then marks a requirement applicable and mandatory. Only an adopted layer with
 * applicable + mandatory regulatory requirements can be linked to a
 * safety-critical element (link_safety_critical_regulatory_obligation).
 */

const REVIEW_PENDING =
  "Template draft: applicability to this organization's buildings has not been reviewed. A named reviewer replaces this with the basis and the cited clause.";

function draft(
  key: string,
  title: string,
  domain: JurisdictionRequirementDraft["domain"],
  authorityReference: string,
): JurisdictionRequirementDraft {
  return {
    key,
    title,
    domain,
    requirementClass: "regulatory",
    applicability: "undetermined",
    obligation: "advisory",
    authorityReference,
    applicabilityBasis: REVIEW_PENDING,
    mandatoryBasis: "",
    adoptedByReference: "",
  };
}

const CLAUSE = "clause to be cited by reviewer";

export const ALBERTA_LIFE_SAFETY_LAYER_TITLE =
  "Alberta housing life-safety requirements";

export const ALBERTA_LIFE_SAFETY_REQUIREMENTS: readonly JurisdictionRequirementDraft[] =
  [
    draft(
      "smoke_alarm_operational",
      "Smoke alarms kept installed and operational in each dwelling unit",
      "inspection_interval",
      `NFC(AE) 2023 and NBC(AE) 2023 (installation per CAN/ULC-S553); ${CLAUSE}`,
    ),
    draft(
      "co_alarm_operational",
      "Carbon monoxide alarms kept installed and operational where fuel-burning appliances or attached parkades serve the building",
      "inspection_interval",
      `NBC(AE) 2023 and NFC(AE) 2023 (alarms per CSA 6.19); ${CLAUSE}`,
    ),
    draft(
      "fire_alarm_inspection_testing",
      "Building fire alarm system inspected and tested",
      "inspection_interval",
      `NFC(AE) 2023 (inspection and testing per CAN/ULC-S536); ${CLAUSE}`,
    ),
    draft(
      "extinguisher_inspection",
      "Portable fire extinguishers inspected and maintained",
      "inspection_interval",
      `NFC(AE) 2023 (inspection and maintenance per NFPA 10); ${CLAUSE}`,
    ),
    draft(
      "emergency_lighting_testing",
      "Emergency lighting and exit signs tested",
      "inspection_interval",
      `NFC(AE) 2023; ${CLAUSE}`,
    ),
    draft(
      "sprinkler_inspection",
      "Sprinkler system inspected, tested and maintained",
      "inspection_interval",
      `NFC(AE) 2023 (water-based fire protection referenced standard); ${CLAUSE}`,
    ),
    draft(
      "parkade_gas_detection_operational",
      "Parkade gas detection and ventilation kept operational",
      "building_code",
      `NBC(AE) 2023 and NFC(AE) 2023; ${CLAUSE}`,
    ),
    draft(
      "rental_unit_minimum_standards",
      "Rental housing meets Alberta minimum housing and health standards",
      "building_code",
      `Alberta Minimum Housing and Health Standards (AB-MHHS); ${CLAUSE}`,
    ),
  ];

/**
 * Which reference-model nodes each requirement concerns, so a reviewer knows
 * which safety-critical elements to link once a requirement is mandatory.
 * Codes are from SRM-RESIDENTIAL-DWELLING and SRM-APARTMENT-BUILDING.
 */
export const ALBERTA_LIFE_SAFETY_REFERENCE_NODES: Readonly<
  Record<string, readonly string[]>
> = {
  smoke_alarm_operational: ["RES-ALARMS"],
  co_alarm_operational: ["RES-ALARMS"],
  fire_alarm_inspection_testing: ["APT-FIRE-ALARM"],
  extinguisher_inspection: [],
  emergency_lighting_testing: ["APT-EMERGENCY-LIGHTING"],
  sprinkler_inspection: ["APT-SPRINKLERS"],
  parkade_gas_detection_operational: ["APT-PARKADE-VENT"],
  rental_unit_minimum_standards: [],
};

/** Fresh, editable copies for the authoring form. */
export function albertaLifeSafetyDrafts(): JurisdictionRequirementDraft[] {
  return ALBERTA_LIFE_SAFETY_REQUIREMENTS.map((r) => ({ ...r }));
}

export function albertaLifeSafetyRecords(): JurisdictionRequirementRecord[] {
  return ALBERTA_LIFE_SAFETY_REQUIREMENTS.map(buildJurisdictionRequirement);
}
