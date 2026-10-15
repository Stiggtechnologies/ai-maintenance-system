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
      directFlatRatePoliciesBindExistingActiveSubscriptionsWhenApproved: boolean;
      directPerUserQuantityBackedBinding: string;
      directSubscriptionActivationFailsClosedWithoutApprovedPolicy: boolean;
      flatRateAllowanceIgnoresMarketplaceSeatQuantity: boolean;
      perUserActivationFailsClosedWithoutQuantity: boolean;
      perUserAllowanceScalesWithAuthoritativeMarketplaceQuantity: boolean;
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
    paidCommercialProviderRoute: {
      commercialBindingSignal: string;
      crossModelSafetyFallbackAllowedForBoundPaidPlan: boolean;
      externalGatewayAllowedForBoundPaidPlan: boolean;
      gpt56ImplicitCacheWritesAllowed: boolean;
      gpt56PromptCacheMode: string;
      noExactDirectRouteBehavior: string;
      nonStandardObservedTierBehavior: string;
      requiredProviderBaseUrl: string;
      requiredProviderName: string;
      requiredObservedResponseServiceTier: string;
      requiredRequestServiceTier: string;
      requiresExactRequestedModel: boolean;
      source: string;
      status: string;
      standardRateEnvelope: {
        framingTokenAllowance: number;
        gpt4oMiniContextWindowTokens: number;
        gpt56TerraAndLunaLongContextInputThresholdTokens: number;
        maximumOutputTokens: number;
        maximumUtf8BytePlusOutputAndFramingUpperBound: number;
        overLimitBehavior: string;
        reservationUsesSameConservativeUpperBound: boolean;
        sourceEvidence: string[];
        status: string;
      };
      unboundEngineeringTrafficRetainsGatewayResilience: boolean;
    };
    protectedReliabilityEngineerCommercialBoundary: {
      databaseRefusal: string;
      paidPackageReleaseBlocked: boolean;
      paidProviderContactAllowed: boolean;
      qualificationBaselinePreserved: boolean;
      runtime: string;
      status: string;
    };
    paidRealtime: {
      status: string;
      unmeasuredPaidUsageAllowed: boolean;
    };
    productionCogsReporting: { status: string };
  };
  observedProductionConfiguration: {
    allConfiguredGatewayOutcomesPricedAndApproved: boolean;
    currentFirstProviderClass: string;
    currentRouteCompatibleWithProposedPolicy: boolean;
    defaultCommercialRequestedModel: string;
    defaultGatewayRequestedAlias: string;
    directProviderConfigurationNamePresent: string;
    gatewayModelEvidence: {
      configuredContextWindowFallbacks: string[];
      configuredFallbacks: string[];
      configuredPrimary: string;
      exactDeployedMappingEvidenced: boolean;
      requestedAlias: string;
      responseModelContract: string;
      scope: string;
    };
    gatewayConfigurationNamesPresent: string[];
    gatewayCostScheduleEvidenced: boolean;
    modelOverrideConfigurationNamesChecked: string[];
    modelOverrideConfigurationNamesPresent: string[];
    proposedAllowedModels: string[];
    providerCostMultiplierOneReleaseEligible: boolean;
    releaseCandidateDeployed: boolean;
    releaseCandidatePinsBoundPaidPlansToExactDirectModel: boolean;
    requestedAndGatewayModelIdentityMatch: boolean;
    secretValuesInspected: boolean;
    sharedProviderChainOrderWhenConfigured: string[];
  };
  pending: {
    approvedCommercialPolicy: { status: string };
    directChannelActivationGate: { status: string };
    productionMeasurementEvidence: { status: string };
    providerAndPricingTierEvidence: { reason: string; status: string };
    realtimeUsageSettlement: { status: string };
  };
};

const enrichmentRunbook = readFileSync("docs/llm-enrichment.md", "utf8");

const manifest = JSON.parse(
  readFileSync("marketplace/partner-center-manifest.json", "utf8"),
) as {
  blockingActions: Array<{
    action: string;
    id: string;
    status: string;
  }>;
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
  offerInventory: {
    draftCount: number;
    offers: Array<{
      canonicalRecurringPath: boolean;
      partnerCenterName: string;
      status: string;
      type: string;
    }>;
    publishedCount: number;
    submitOrPublishEnabled: boolean;
  };
  plans: Array<{
    autoActivation: boolean;
    name: string;
    observedPricing: {
      markets: number;
      ownerApprovalRecorded: boolean;
    };
    partnerCenterPageStatus: string;
  }>;
  previewAndCertification: {
    acceptedMeteringWitness: string;
    authenticatedLifecycleWitness: string;
    realPreviewPurchasesObserved: number;
    repositoryHarness: string;
    repositoryHarnessEvidence: {
      githubActionsRun: string;
      productionOrRealPurchaseEvidence: boolean;
      pullRequest: string;
      verifiedImplementationCommit: string;
    };
  };
  supplementalContent: {
    commercialConsequence: string;
    draftSaveAuthorized: boolean;
    partnerCenterDraftSavedAt: string | null;
    portalOptionLabel: string;
    selectedScenario: string | null;
    status: string;
    truthfulCurrentScenario: string;
  };
  taxAndPayout: {
    azureMarketplaceAssignment: {
      paymentCurrency: string;
      paymentProfileStatus: string;
      submittedAt: string;
      taxProfileStatus: string;
      verificationStatus: string;
    };
    partnerCenterPayoutProfile: string;
    partnerCenterTaxValidationOrAssignment: string;
    publisherSubmission: string;
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
      perUserAllowanceScalesWithAuthoritativeMarketplaceQuantity: true,
      perUserActivationFailsClosedWithoutQuantity: true,
      flatRateAllowanceIgnoresMarketplaceSeatQuantity: true,
      directSubscriptionActivationFailsClosedWithoutApprovedPolicy: false,
      directFlatRatePoliciesBindExistingActiveSubscriptionsWhenApproved: true,
      directPerUserQuantityBackedBinding: "not_implemented",
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

  it("refuses the proposed model policy and a 1.0 multiplier on the unproved gateway-first route", () => {
    expect(unitEconomics.observedProductionConfiguration).toMatchObject({
      secretValuesInspected: false,
      gatewayConfigurationNamesPresent: ["LLM_BASE_URL", "LLM_API_KEY"],
      directProviderConfigurationNamePresent: "OPENAI_API_KEY",
      sharedProviderChainOrderWhenConfigured: [
        "stigg-gateway",
        "openai-direct",
      ],
      currentFirstProviderClass: "external_gateway",
      modelOverrideConfigurationNamesPresent: [],
      modelOverrideConfigurationNamesChecked: [
        "LLM_GATEWAY_MODEL",
        "DEVELOP_AGENT_MODEL",
      ],
      defaultCommercialRequestedModel: "gpt-4o-mini",
      defaultGatewayRequestedAlias: "stigg/fast",
      requestedAndGatewayModelIdentityMatch: false,
      proposedAllowedModels: ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-4o-mini"],
      allConfiguredGatewayOutcomesPricedAndApproved: false,
      currentRouteCompatibleWithProposedPolicy: false,
      releaseCandidatePinsBoundPaidPlansToExactDirectModel: true,
      releaseCandidateDeployed: false,
      gatewayCostScheduleEvidenced: false,
      providerCostMultiplierOneReleaseEligible: false,
    });
    expect(unitEconomics.pending.providerAndPricingTierEvidence).toMatchObject({
      status:
        "gateway_first_route_not_release_executable_for_proposed_model_policy",
    });
    expect(unitEconomics.pending.providerAndPricingTierEvidence.reason).toMatch(
      /proposed model policy (?:is|are) not release-eligible/i,
    );
    expect(
      unitEconomics.observedProductionConfiguration.gatewayModelEvidence,
    ).toMatchObject({
      requestedAlias: "stigg/fast",
      configuredPrimary: "claude-haiku-4-5-20251001",
      configuredFallbacks: [
        "claude-sonnet-5",
        "gpt-5.6-luna",
        "gemini-2.5-flash",
      ],
      configuredContextWindowFallbacks: ["claude-sonnet-5", "gemini-2.5-pro"],
      exactDeployedMappingEvidenced: false,
    });
    expect(
      unitEconomics.observedProductionConfiguration.gatewayModelEvidence
        .responseModelContract,
    ).toMatch(/concrete model used after fallback/i);
  });

  it("pins bound paid traffic to the exact direct model without claiming deployment", () => {
    expect(unitEconomics.implemented.paidCommercialProviderRoute).toEqual({
      status: "implemented_not_reviewed_merged_or_deployed",
      source: "supabase/functions/_shared/llm-commercial-usage.ts",
      commercialBindingSignal:
        "nonempty commercialPlanId returned by the atomic quota reservation",
      requiredProviderName: "openai-direct",
      requiredProviderBaseUrl: "https://api.openai.com",
      requiresExactRequestedModel: true,
      requiredRequestServiceTier: "default",
      requiredObservedResponseServiceTier: "default",
      nonStandardObservedTierBehavior:
        "withhold_output_settle_actual_model_and_tokens_as_unknown_price_pricing_mode_breach_freeze_later_paid_calls",
      gpt56PromptCacheMode: "explicit_without_breakpoints",
      gpt56ImplicitCacheWritesAllowed: false,
      externalGatewayAllowedForBoundPaidPlan: false,
      crossModelSafetyFallbackAllowedForBoundPaidPlan: false,
      noExactDirectRouteBehavior: "release_reservation_refuse_provider_contact",
      standardRateEnvelope: {
        status: "implemented_not_reviewed_merged_or_deployed",
        maximumOutputTokens: 8192,
        maximumUtf8BytePlusOutputAndFramingUpperBound: 100000,
        framingTokenAllowance: 1024,
        reservationUsesSameConservativeUpperBound: true,
        gpt4oMiniContextWindowTokens: 128000,
        gpt56TerraAndLunaLongContextInputThresholdTokens: 272000,
        overLimitBehavior: "release_reservation_refuse_provider_contact",
        sourceEvidence: [
          "https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create",
          "https://developers.openai.com/api/docs/guides/prompt-caching",
          "https://developers.openai.com/api/docs/models/gpt-4o-mini",
          "https://developers.openai.com/api/docs/models/gpt-5.6-terra",
          "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
        ],
      },
      unboundEngineeringTrafficRetainsGatewayResilience: true,
    });
    expect(
      unitEconomics.implemented.protectedReliabilityEngineerCommercialBoundary,
    ).toMatchObject({
      status:
        "commercially_blocked_pending_separately_reviewed_qualification_change",
      runtime: "ai-agent-processor",
      paidProviderContactAllowed: false,
      databaseRefusal: "commercial_runtime_boundary_unavailable",
      qualificationBaselinePreserved: true,
      paidPackageReleaseBlocked: true,
    });
  });

  it("does not preserve the stale claim that the public gateway is undeployed or priced", () => {
    expect(enrichmentRunbook).not.toMatch(
      /stigg-ai-gateway\.fly\.dev` does not exist/i,
    );
    expect(enrichmentRunbook).toMatch(/returns HTTP 401 without credentials/i);
    expect(enrichmentRunbook).toMatch(
      /no gateway\s+invoice or pricing schedule is evidenced/i,
    );
    expect(enrichmentRunbook).toMatch(
      /production cost multiplier of 1\.0 remains ineligible/i,
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

  it("keeps Partner Center payout state internally consistent", () => {
    expect(manifest.taxAndPayout).toMatchObject({
      publisherSubmission: "submitted_pending_validation",
      partnerCenterTaxValidationOrAssignment: "complete",
      partnerCenterPayoutProfile: "pending_microsoft_validation",
      status: "blocked",
      azureMarketplaceAssignment: {
        submittedAt: "2026-10-06",
        taxProfileStatus: "complete",
        paymentProfileStatus: "pending_microsoft_validation",
        paymentCurrency: "CAD",
        verificationStatus: "not_started",
      },
    });

    const payoutAction = manifest.blockingActions.find(
      ({ id }) => id === "PC-009",
    );
    expect(payoutAction).toMatchObject({ status: "blocked" });
    expect(payoutAction?.action).toMatch(/Tax is Complete/);
    expect(payoutAction?.action).toMatch(/Pending Microsoft validation/);
    expect(payoutAction?.action).toMatch(/verification is Not started/);
  });

  it("records the live offer inventory without promoting any draft to a product", () => {
    expect(manifest.offerInventory).toMatchObject({
      draftCount: 4,
      publishedCount: 0,
      submitOrPublishEnabled: false,
    });
    expect(
      manifest.offerInventory.offers.filter(
        ({ canonicalRecurringPath }) => canonicalRecurringPath,
      ),
    ).toEqual([
      expect.objectContaining({
        partnerCenterName: "SyncAI Predictive Maintenance",
        type: "saas",
        status: "draft",
      }),
    ]);
    expect(
      manifest.offerInventory.offers.filter(
        ({ type }) => type === "professional_service",
      ),
    ).toHaveLength(3);
  });

  it("keeps the truthful non-Azure declaration unsaved until action-time approval", () => {
    expect(manifest.supplementalContent).toMatchObject({
      selectedScenario: null,
      truthfulCurrentScenario: "not_hosted_in_azure",
      portalOptionLabel: "SaaS solution is not hosted in Azure",
      draftSaveAuthorized: false,
      partnerCenterDraftSavedAt: null,
      status: "blocked",
    });
    expect(manifest.supplementalContent.commercialConsequence).toMatch(
      /primarily platformed on Azure/i,
    );
    expect(manifest.supplementalContent.commercialConsequence).toMatch(
      /purchasable within Azure portal/i,
    );
    expect(manifest.plans).toHaveLength(3);
    for (const plan of manifest.plans) {
      expect(plan.partnerCenterPageStatus).toBe(
        "incomplete_account_publish_eligibility",
      );
      expect(plan.autoActivation).toBe(false);
      expect(plan.observedPricing).toMatchObject({
        markets: 141,
        ownerApprovalRecorded: false,
      });
    }
  });

  it("separates green repository proof from production and purchase evidence", () => {
    expect(manifest.previewAndCertification).toMatchObject({
      repositoryHarness: "implemented_and_ci_verified",
      realPreviewPurchasesObserved: 0,
      authenticatedLifecycleWitness: "blocked",
      acceptedMeteringWitness: "blocked",
      repositoryHarnessEvidence: {
        pullRequest:
          "https://github.com/Stiggtechnologies/ai-maintenance-system/pull/634",
        verifiedImplementationCommit: "7072c3d2",
        githubActionsRun: "37524709308",
        productionOrRealPurchaseEvidence: false,
      },
    });

    const productAction = manifest.blockingActions.find(
      ({ id }) => id === "PC-003",
    );
    expect(productAction).toMatchObject({ status: "blocked" });
    expect(productAction?.action).toMatch(/not merged or deployed/i);
    expect(productAction?.action).toMatch(/no commercial values are approved/i);
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
