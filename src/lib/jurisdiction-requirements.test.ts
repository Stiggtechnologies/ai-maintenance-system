import { describe, expect, it } from "vitest";
import {
  buildJurisdictionRequirement,
  EMPTY_JURISDICTION_REQUIREMENT,
  JURISDICTION_REQUIREMENT_CLASSES,
  JURISDICTION_REQUIREMENT_DOMAINS,
} from "./jurisdiction-requirements";

const complete = {
  ...EMPTY_JURISDICTION_REQUIREMENT,
  key: "pressure_vessel_inspection",
  title: "Pressure vessel inspection interval",
  domain: "pressure_regulation" as const,
  requirementClass: "regulatory" as const,
  applicability: "applicable" as const,
  obligation: "mandatory" as const,
  authorityReference: "ABSA requirement register PV-01",
  applicabilityBasis:
    "The controlled equipment register identifies an in-scope pressure vessel.",
  mandatoryBasis:
    "The adopted regulator requirement creates a mandatory inspection duty.",
};

describe("typed jurisdiction requirements", () => {
  it("covers every requested jurisdiction domain and requirement class", () => {
    expect(JURISDICTION_REQUIREMENT_DOMAINS).toEqual([
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
    ]);
    expect(JURISDICTION_REQUIREMENT_CLASSES).toEqual([
      "company_standard",
      "industry_guidance",
      "contractual",
      "regulatory",
      "statutory",
      "site_rule",
    ]);
  });

  it("builds an explicit mandatory regulatory requirement", () => {
    expect(buildJurisdictionRequirement(complete)).toEqual(
      expect.objectContaining({
        requirement_class: "regulatory",
        applicability: "applicable",
        obligation: "mandatory",
        mandatory_basis: complete.mandatoryBasis,
      }),
    );
  });

  it("never silently promotes industry guidance to mandatory", () => {
    expect(() =>
      buildJurisdictionRequirement({
        ...complete,
        requirementClass: "industry_guidance",
        adoptedByReference: "",
      }),
    ).toThrow(/explicit adoption reference/i);
    expect(
      buildJurisdictionRequirement({
        ...complete,
        requirementClass: "industry_guidance",
        adoptedByReference: "Company engineering standard ENG-104",
      }).adopted_by_reference,
    ).toBe("Company engineering standard ENG-104");
  });

  it("requires applicability and not-applicable obligation to agree", () => {
    expect(() =>
      buildJurisdictionRequirement({
        ...complete,
        applicability: "not_applicable",
        obligation: "advisory",
      }),
    ).toThrow(/recorded together/i);
  });
});
