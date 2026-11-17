import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Deliverable {
  name: string;
  acceptanceEvidence: string;
}

interface PlanTemplate {
  planId: string;
  planName: string;
  status: string;
}

interface ProfessionalServiceOffer {
  key: string;
  category: string;
  proposedOfferId: string;
  name: string;
  searchSummary: string;
  keywords: string[];
  description: string;
  planTemplates: PlanTemplate[];
  entryCriteria: string[];
  deliverables: Deliverable[];
  excluded: string[];
  exitDecision: string;
}

interface ProfessionalServicesManifest {
  overallStatus: string;
  claims: Record<string, boolean>;
  partnerCenterDraftWitness: {
    observedAt: string;
    offers: Array<{
      offerAlias: string;
      name: string;
      offerId: string;
      offerType: string;
      status: string;
      listingCopySaved?: boolean;
      remainingListingValidationErrors?: number;
    }>;
    submitted: boolean;
    published: boolean;
  };
  marketplaceContract: {
    deliveryMode: string;
    transactionRoute: string;
    storefrontDiscovery: string;
    supportingSoftware: {
      offerType: string;
      marketplaceListingUrl: string;
      requiredBeforeServicePublication: boolean;
      status: string;
    };
  };
  adoptionArchitecture: {
    horizontalDecisionLoop: string[];
    verticalValueLadder: string[];
    promotionRule: string;
    riaIsMandatory: boolean;
    riaBypassCriteria: string[];
  };
  canonicalRecordReuse: string[];
  customerAuthorityBoundary: {
    customerRetains: string[];
    syncaiAndFdeNeverReceiveByDefault: string[];
  };
  offers: ProfessionalServiceOffer[];
  forwardDeployedEngineering: {
    attachedOfferKey: string;
    isSeparateAdoptionRung: boolean;
    isOpenEndedStaffAugmentation: boolean;
    deliveryMode: string;
    allowedWork: string[];
    prohibitedWork: string[];
  };
  supportingCollateral: {
    builder: string;
    renderedPdf: string;
    pageCount: number;
    visualQa: string;
    textExtractionQa: string;
    accessibilityTagReview: string;
    brandApproval: string;
    legalAndClaimsApproval: string;
    partnerCenterUpload: string;
    status: string;
  };
  externalActions: Array<{
    id: string;
    dependsOn?: string[];
    status: string;
  }>;
}

const manifest = JSON.parse(
  readFileSync("marketplace/professional-services-offers.json", "utf8"),
) as ProfessionalServicesManifest;

describe("SyncAI professional-service offer contract", () => {
  it("keeps publication, purchase and fulfillment claims below external proof", () => {
    expect(manifest.overallStatus).toBe("controlled_draft");
    expect(manifest.claims).toEqual({
      published: false,
      microsoftCertified: false,
      customerPurchaseProven: false,
      privateOfferAccepted: false,
      serviceDeliveryCompleted: false,
    });
    expect(manifest.marketplaceContract).toMatchObject({
      transactionRoute: "isv_to_customer_private_offer",
      deliveryMode: "virtual_only",
      storefrontDiscovery: "direct_link_only",
      supportingSoftware: {
        offerType: "SaaS",
        marketplaceListingUrl: "external_action_required",
        requiredBeforeServicePublication: true,
        status: "blocked",
      },
    });
    expect(manifest.partnerCenterDraftWitness).toMatchObject({
      observedAt: "2026-10-05",
      offers: [
        expect.objectContaining({
          offerId: "syncai-reliability-intelligence-assessment",
          status: "Draft",
        }),
        expect.objectContaining({
          offerId: "syncai-industrial-decision-proof-of-concept",
          status: "Draft",
        }),
        expect.objectContaining({
          offerAlias: "SyncAI Implementation and Scale",
          name: "SyncAI Forward-Deployed Engineering",
          offerId: "syncai-implementation-and-scale",
          status: "Draft",
          listingCopySaved: true,
          remainingListingValidationErrors: 8,
        }),
      ],
      submitted: false,
      published: false,
    });
  });

  it("defines exactly the Assessment, Proof of concept and Implementation offers", () => {
    expect(manifest.offers.map(({ category }) => category)).toEqual([
      "Assessment",
      "Proof of concept",
      "Implementation",
    ]);
    expect(new Set(manifest.offers.map(({ key }) => key)).size).toBe(3);

    for (const offer of manifest.offers) {
      expect(offer.name.length).toBeGreaterThan(0);
      expect(offer.name.length).toBeLessThanOrEqual(200);
      expect(offer.searchSummary.length).toBeGreaterThan(0);
      expect(offer.searchSummary.length).toBeLessThanOrEqual(200);
      expect(offer.description.length).toBeGreaterThan(0);
      expect(offer.description.length).toBeLessThanOrEqual(5000);
      expect(offer.keywords.length).toBeGreaterThan(0);
      expect(offer.keywords.length).toBeLessThanOrEqual(3);
      expect(offer.planTemplates.length).toBeGreaterThan(0);
      expect(offer.entryCriteria.length).toBeGreaterThan(0);
      expect(offer.deliverables.length).toBeGreaterThan(0);
      expect(offer.excluded.length).toBeGreaterThan(0);
      expect(offer.exitDecision).toMatch(/_to_/);

      for (const plan of offer.planTemplates) {
        expect(plan.planId).toMatch(/^[a-z0-9_-]{1,50}$/);
        expect(plan.planName.length).toBeGreaterThan(0);
        expect(plan.planName.length).toBeLessThanOrEqual(200);
        expect(plan.status).toBe("blocked");
      }
      for (const deliverable of offer.deliverables) {
        expect(deliverable.name.length).toBeGreaterThan(0);
        expect(deliverable.acceptanceEvidence.length).toBeGreaterThan(0);
      }
    }
  });

  it("places FDE inside implementation without transferring customer authority", () => {
    const fde = manifest.forwardDeployedEngineering;
    const implementation = manifest.offers.find(
      ({ key }) => key === fde.attachedOfferKey,
    );
    expect(fde.attachedOfferKey).toBe("implementation_and_scale");
    expect(fde.isSeparateAdoptionRung).toBe(false);
    expect(fde.isOpenEndedStaffAugmentation).toBe(false);
    expect(fde.deliveryMode).toBe("virtual_only");
    expect(implementation).toMatchObject({
      category: "Implementation",
      proposedOfferId: "syncai-implementation-and-scale",
      name: "SyncAI Forward-Deployed Engineering",
      searchSummary:
        "Operationalize governed industrial AI with a bounded SyncAI forward-deployed engineering team.",
      keywords: [
        "forward deployed engineering",
        "industrial AI implementation",
        "asset reliability",
      ],
    });
    expect(implementation?.description).toContain("Engagement agenda");
    expect(implementation?.description).toContain("Mobilize and govern");
    expect(implementation?.description).toContain("Connect and configure");
    expect(implementation?.description).toContain("Validate and accept");
    expect(implementation?.description).toContain("Enable and hand over");
    expect(implementation?.description).toContain("Decide and scale");
    expect(implementation?.description).toContain(
      "not open-ended staff augmentation",
    );
    expect(fde.allowedWork).toEqual(
      expect.arrayContaining([
        "authorized_data_integration_and_provenance_mapping",
        "tenant_role_and_workflow_configuration",
        "acceptance_measurement_and_verification_support",
        "adoption_runbook_training_and_handover",
      ]),
    );
    expect(fde.prohibitedWork).toEqual(
      expect.arrayContaining([
        "approving_customer_recommendations",
        "accepting_customer_risk",
        "acting_as_engineer_of_record",
        "changing_equipment_or_operating_limits",
        "operating_or_isolating_customer_equipment",
      ]),
    );
    expect(manifest.customerAuthorityBoundary.customerRetains).toEqual(
      expect.arrayContaining([
        "engineering_authority",
        "investment_authority",
        "operating_authority",
        "safety_and_regulatory_accountability",
      ]),
    );
  });

  it("reuses canonical records and requires a human expansion decision", () => {
    expect(manifest.canonicalRecordReuse).toEqual([
      "evidence_items",
      "recommendations",
      "decisions",
      "approvals",
      "verification_obligations",
      "learning_events",
      "value_metrics",
      "audit_events",
    ]);
    expect(manifest.adoptionArchitecture.horizontalDecisionLoop).toEqual([
      "ask",
      "understand",
      "save",
      "prove",
      "recommend",
      "decide",
      "approve",
      "verify",
      "collaborate",
      "learn",
    ]);
    expect(manifest.adoptionArchitecture.promotionRule).toMatch(
      /named customer authority/i,
    );
    expect(manifest.adoptionArchitecture.promotionRule).toMatch(
      /go, change, hold, or stop/i,
    );
    expect(manifest.adoptionArchitecture.riaIsMandatory).toBe(false);
    expect(manifest.adoptionArchitecture.riaBypassCriteria).toHaveLength(5);
  });

  it("keeps submission sequenced behind software, commercial and media gates", () => {
    expect(manifest.externalActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "PS-001", status: "blocked" }),
        expect.objectContaining({ id: "PS-002", status: "blocked" }),
        expect.objectContaining({ id: "PS-003", status: "blocked" }),
        expect.objectContaining({
          id: "PS-004",
          dependsOn: ["PS-001", "PS-002", "PS-003"],
          status: "blocked",
        }),
        expect.objectContaining({
          id: "PS-005",
          dependsOn: ["PS-004"],
          status: "blocked",
        }),
      ]),
    );
  });

  it("ships rendered collateral without overstating its approval posture", () => {
    const collateral = manifest.supportingCollateral;
    expect(collateral).toMatchObject({
      builder: "scripts/build-professional-services-pdf.py",
      renderedPdf: "output/pdf/syncai-professional-services-and-fde.pdf",
      pageCount: 4,
      visualQa: "passed_2026_10_05",
      textExtractionQa: "passed_2026_10_05",
      accessibilityTagReview: "blocked",
      brandApproval: "blocked",
      legalAndClaimsApproval: "blocked",
      partnerCenterUpload: "blocked",
      status: "rendered_unapproved",
    });
    expect(existsSync(collateral.builder)).toBe(true);
    expect(existsSync(collateral.renderedPdf)).toBe(true);
    expect(readFileSync(collateral.renderedPdf).subarray(0, 5).toString()).toBe(
      "%PDF-",
    );
  });
});
