export const JURISDICTION_REQUIREMENT_DOMAINS = [
  "inspection_interval",
  "certification",
  "environmental_reporting",
  "electrical_code",
  "pressure_regulation",
  "rail",
  "aviation",
  "maritime",
  "medical_device",
  "building_code",
  "worker_qualification",
  "privacy_residency",
  "retention",
  "indigenous_land_use",
] as const;

export const JURISDICTION_REQUIREMENT_CLASSES = [
  "company_standard",
  "industry_guidance",
  "contractual",
  "regulatory",
  "statutory",
  "site_rule",
] as const;

export const JURISDICTION_APPLICABILITY = [
  "applicable",
  "not_applicable",
  "undetermined",
] as const;

export const JURISDICTION_OBLIGATIONS = [
  "advisory",
  "mandatory",
  "not_applicable",
] as const;

export type JurisdictionRequirementDomain =
  (typeof JURISDICTION_REQUIREMENT_DOMAINS)[number];
export type JurisdictionRequirementClass =
  (typeof JURISDICTION_REQUIREMENT_CLASSES)[number];
export type JurisdictionApplicability =
  (typeof JURISDICTION_APPLICABILITY)[number];
export type JurisdictionObligation = (typeof JURISDICTION_OBLIGATIONS)[number];

export interface JurisdictionRequirementDraft {
  key: string;
  title: string;
  domain: JurisdictionRequirementDomain;
  requirementClass: JurisdictionRequirementClass;
  applicability: JurisdictionApplicability;
  obligation: JurisdictionObligation;
  authorityReference: string;
  applicabilityBasis: string;
  mandatoryBasis: string;
  adoptedByReference: string;
}

export interface JurisdictionRequirementRecord {
  key: string;
  title: string;
  domain: JurisdictionRequirementDomain;
  requirement_class: JurisdictionRequirementClass;
  applicability: JurisdictionApplicability;
  obligation: JurisdictionObligation;
  authority_reference: string;
  applicability_basis: string;
  mandatory_basis?: string;
  adopted_by_reference?: string;
}

export const EMPTY_JURISDICTION_REQUIREMENT: JurisdictionRequirementDraft = {
  key: "",
  title: "",
  domain: "inspection_interval",
  requirementClass: "regulatory",
  applicability: "undetermined",
  obligation: "advisory",
  authorityReference: "",
  applicabilityBasis: "",
  mandatoryBasis: "",
  adoptedByReference: "",
};

export function buildJurisdictionRequirement(
  draft: JurisdictionRequirementDraft,
): JurisdictionRequirementRecord {
  const key = draft.key.trim();
  const title = draft.title.trim();
  const authorityReference = draft.authorityReference.trim();
  const applicabilityBasis = draft.applicabilityBasis.trim();
  const mandatoryBasis = draft.mandatoryBasis.trim();
  const adoptedByReference = draft.adoptedByReference.trim();
  if (!/^[a-z][a-z0-9_]{2,79}$/.test(key))
    throw new Error("Requirement key must be a lowercase machine key.");
  if (title.length < 5 || authorityReference.length < 3)
    throw new Error("Requirement title and authority reference are required.");
  if (applicabilityBasis.length < 20)
    throw new Error(
      "Applicability requires a reviewable basis of at least 20 characters.",
    );
  if (
    (draft.applicability === "not_applicable") !==
    (draft.obligation === "not_applicable")
  )
    throw new Error(
      "Not-applicable status and obligation must be recorded together.",
    );
  if (draft.obligation === "mandatory" && mandatoryBasis.length < 20)
    throw new Error(
      "A mandatory requirement needs an explicit mandatory basis.",
    );
  if (
    draft.requirementClass === "industry_guidance" &&
    draft.obligation === "mandatory" &&
    adoptedByReference.length < 3
  )
    throw new Error(
      "Industry guidance can become mandatory only through an explicit adoption reference.",
    );
  return {
    key,
    title,
    domain: draft.domain,
    requirement_class: draft.requirementClass,
    applicability: draft.applicability,
    obligation: draft.obligation,
    authority_reference: authorityReference,
    applicability_basis: applicabilityBasis,
    ...(mandatoryBasis ? { mandatory_basis: mandatoryBasis } : {}),
    ...(adoptedByReference ? { adopted_by_reference: adoptedByReference } : {}),
  };
}
