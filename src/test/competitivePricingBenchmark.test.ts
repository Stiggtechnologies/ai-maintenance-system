import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const unitEconomics = JSON.parse(
  readFileSync("marketplace/ai-unit-economics.json", "utf8"),
) as {
  commercialCompatibility: {
    currentDraftCompatibleWithImplementedMeter: boolean;
    microsoftMeteringSupportedForPerUser: boolean;
    partnerCenterMutationAuthorized: boolean;
    recommendedCoreSaasArchitecture: string;
  };
  economicsModel: {
    commercialAllowanceApproved: boolean;
    currentGranularity: string;
    perDecisionCostAvailable: boolean;
    perDecisionCostCoverage: string;
  };
  implemented: {
    commercialPlanPolicy: {
      seededCommercialValues: boolean;
      status: string;
    };
    commercialPlanToQuotaBinding: {
      azureMarketplaceActivationFailsClosedWithoutApprovedPolicy: boolean;
      directSubscriptionActivationFailsClosedWithoutApprovedPolicy: boolean;
      status: string;
    };
    grossMarginReleaseGate: {
      isTotalCompanyGrossMarginModel: boolean;
      status: string;
    };
    organizationQuota: {
      defaultCapsAreCommercialEntitlements: boolean;
      defaultMaxCallsPerUtcDay: number;
      defaultMaxTokensPerUtcDay: number;
    };
    paidRealtime: {
      status: string;
      unmeasuredPaidUsageAllowed: boolean;
    };
    productionCogsReporting: { status: string };
  };
  pending: {
    approvedCommercialPolicy: { status: string };
    directChannelActivationGate: { status: string };
    productionMeasurementEvidence: { status: string };
    realtimeUsageSettlement: { status: string };
  };
};

const manifest = JSON.parse(
  readFileSync("marketplace/partner-center-manifest.json", "utf8"),
) as {
  commercialBenchmark: {
    benchmarkRoles: Record<string, string[]>;
    expansionPlanningBands: Array<{
      maximumArrUsd: number | null;
      minimumArrUsd: number;
      stage: string;
    }>;
    ownerApprovalRecorded: boolean;
    positioning: {
      customerPromise: string;
      entryProduct: string;
      outcomeGuaranteed: boolean;
    };
    pricingExperiments: Array<{
      defaultEngineeringQuotaMayBeUsedAsAllowance?: boolean;
      id: string;
      microsoftMeteredOverageSupported?: boolean;
      partnerCenterMutationAuthorized: boolean;
      priceUsd?: number;
      monthlyUsdPerUser?: number;
      pricingModelChangeBeforePublicationRequired?: boolean;
    }>;
    status: string;
  };
};

const benchmark = readFileSync(
  "docs/marketplace/competitive-pricing-benchmark.md",
  "utf8",
);

describe("competitive pricing benchmark", () => {
  it("positions the outcome separately from the entry product and rejects a guarantee", () => {
    expect(manifest.commercialBenchmark.positioning).toEqual({
      customerPromise: "Unplanned Downtime Reduction",
      entryProduct: "SyncAI Failure Investigation Agent",
      platform: "SyncAI governed reliability decision platform",
      outcomeGuaranteed: false,
    });
    expect(benchmark).toMatch(/not being sold as a repository/i);
    expect(benchmark).toMatch(/Not guaranteed/);
  });

  it("uses direct reliability benchmarks and keeps CMMS products adjacent", () => {
    expect(
      manifest.commercialBenchmark.benchmarkRoles.directFailureInvestigation,
    ).toContain("Causelink");
    expect(
      manifest.commercialBenchmark.benchmarkRoles.enterpriseReliabilityAndApm,
    ).toContain("IBM Maximo Application Suite");
    expect(
      manifest.commercialBenchmark.benchmarkRoles
        .downtimeOutcomeAndMachineHealth,
    ).toEqual(
      expect.arrayContaining([
        "C3 AI Reliability",
        "Siemens Senseye",
        "Augury",
      ]),
    );
    expect(
      manifest.commercialBenchmark.benchmarkRoles.adjacentCmmsOnly,
    ).toEqual(expect.arrayContaining(["MaintainX", "UpKeep", "Fiix"]));
  });

  it("keeps the entry tests and every price mutation unapproved", () => {
    expect(manifest.commercialBenchmark.status).toBe(
      "recommendation_not_approved",
    );
    expect(manifest.commercialBenchmark.ownerApprovalRecorded).toBe(false);
    expect(manifest.commercialBenchmark.pricingExperiments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "software_led_failure_investigation",
          monthlyUsdPerUser: 99,
          defaultEngineeringQuotaMayBeUsedAsAllowance: false,
          microsoftMeteredOverageSupported: false,
          partnerCenterMutationAuthorized: false,
        }),
        expect.objectContaining({
          id: "outcome_led_downtime_reduction_proof",
          priceUsd: 35000,
          partnerCenterMutationAuthorized: false,
        }),
        expect.objectContaining({
          id: "core_saas_flat_rate_metered",
          pricingModelChangeBeforePublicationRequired: true,
          partnerCenterMutationAuthorized: false,
        }),
      ]),
    );
  });

  it("reuses the implemented guardrails without mislabeling abuse caps as entitlements", () => {
    expect(unitEconomics.implemented.organizationQuota).toMatchObject({
      defaultMaxCallsPerUtcDay: 5184,
      defaultMaxTokensPerUtcDay: 22000000,
      defaultCapsAreCommercialEntitlements: false,
    });
    expect(unitEconomics.economicsModel).toMatchObject({
      currentGranularity: "model_call_with_supported_cost_object_rollup",
      perDecisionCostAvailable: true,
      commercialAllowanceApproved: false,
    });
    expect(unitEconomics.economicsModel.perDecisionCostCoverage).toMatch(
      /supported runtime paths only/i,
    );
  });

  it("separates implemented controls from unapproved commercial configuration", () => {
    expect(unitEconomics.implemented.commercialPlanPolicy).toMatchObject({
      status: "implemented_not_configured",
      seededCommercialValues: false,
    });
    expect(
      unitEconomics.implemented.commercialPlanToQuotaBinding,
    ).toMatchObject({
      status: "implemented_for_azure_marketplace",
      azureMarketplaceActivationFailsClosedWithoutApprovedPolicy: true,
      directSubscriptionActivationFailsClosedWithoutApprovedPolicy: false,
    });
    expect(unitEconomics.implemented.productionCogsReporting.status).toBe(
      "implemented_no_production_distribution_evidenced",
    );
    expect(unitEconomics.implemented.grossMarginReleaseGate).toMatchObject({
      status: "implemented_not_configured",
      isTotalCompanyGrossMarginModel: false,
    });
    expect(unitEconomics.pending).toMatchObject({
      approvedCommercialPolicy: { status: "not_evidenced" },
      productionMeasurementEvidence: { status: "not_evidenced" },
      directChannelActivationGate: { status: "not_implemented" },
      realtimeUsageSettlement: { status: "not_implemented" },
    });
    expect(unitEconomics.implemented.paidRealtime).toEqual(
      expect.objectContaining({
        status: "commercially_blocked",
        unmeasuredPaidUsageAllowed: false,
      }),
    );
  });

  it("rejects the current per-user draft as compatible with automatic Marketplace overage", () => {
    expect(
      unitEconomics.commercialCompatibility
        .microsoftMeteringSupportedForPerUser,
    ).toBe(false);
    expect(
      unitEconomics.commercialCompatibility
        .currentDraftCompatibleWithImplementedMeter,
    ).toBe(false);
    expect(
      unitEconomics.commercialCompatibility.recommendedCoreSaasArchitecture,
    ).toBe("flat_rate_base_with_included_allowance_and_metered_overage");
    expect(
      unitEconomics.commercialCompatibility.partnerCenterMutationAuthorized,
    ).toBe(false);
  });

  it("records an expansion path capable of reaching enterprise ACV", () => {
    expect(manifest.commercialBenchmark.expansionPlanningBands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "production_site",
          minimumArrUsd: 60000,
        }),
        expect.objectContaining({
          stage: "multi_site_or_network",
          minimumArrUsd: 150000,
        }),
        expect.objectContaining({
          stage: "enterprise_standard",
          minimumArrUsd: 300000,
          maximumArrUsd: null,
        }),
      ]),
    );
    expect(benchmark).toMatch(/route to US\$100M ARR is expansion/i);
  });
});
