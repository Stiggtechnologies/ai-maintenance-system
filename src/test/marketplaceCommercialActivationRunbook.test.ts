import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync("marketplace/partner-center-manifest.json", "utf8"),
);
const decision = JSON.parse(
  readFileSync("marketplace/commercial-offer-decision.json", "utf8"),
);
const unitEconomics = JSON.parse(
  readFileSync("marketplace/ai-unit-economics.json", "utf8"),
);
const productionBoundary = JSON.parse(
  readFileSync("marketplace/production-data-plane-boundary.json", "utf8"),
);
const runbook = readFileSync(
  "docs/marketplace/commercial-policy-activation-runbook.md",
  "utf8",
);
const deploymentWorkflow = readFileSync(
  ".github/workflows/deploy-migrations.yml",
  "utf8",
);
const sharedCommercialBoundary = readFileSync(
  "supabase/functions/_shared/llm-commercial-usage.ts",
  "utf8",
);
const developEvidenceAgent = readFileSync(
  "supabase/functions/develop-evidence-agent/index.ts",
  "utf8",
);
const onboardingEnrich = readFileSync(
  "supabase/functions/onboarding-enrich/index.ts",
  "utf8",
);

describe("Marketplace commercial-policy activation runbook", () => {
  it("binds production policy to fulfillment IDs rather than resource GUIDs", () => {
    expect(manifest.listing.offerId).toBe("syncai-predictive-maintenance");
    expect(
      manifest.plans.map(
        (plan: { technicalPlanId: string }) => plan.technicalPlanId,
      ),
    ).toEqual(["starter", "professional", "enterprise"]);
    expect(runbook).toContain("`syncai-predictive-maintenance`");
    expect(runbook).toContain("`starter`");
    expect(runbook).toContain("`professional`");
    expect(runbook).toContain("`enterprise`");
    expect(runbook).toMatch(
      /The GUIDs identify\s+Partner Center resources and must never be substituted/,
    );
  });

  it("keeps policy approval blocked until the deployed paid route is witnessed", () => {
    expect(unitEconomics.implemented.paidCommercialProviderRoute.status).toBe(
      "implemented_merged_deployed_runtime_witness_pending",
    );
    expect(
      unitEconomics.observedProductionConfiguration.releaseCandidateDeployed,
    ).toBe(true);
    expect(
      unitEconomics.observedProductionConfiguration
        .releaseCandidateRuntimeWitnessed,
    ).toBe(false);
    expect(
      unitEconomics.observedProductionConfiguration
        .releaseCandidateDeploymentEvidence.canonicalProjectRef,
    ).toBe("pjvoswbwomesuwhygpby");
    expect(
      unitEconomics.observedProductionConfiguration
        .releaseCandidateDeploymentEvidence.workflowRunId,
    ).toBe("41283398055");
    expect(manifest.bindingConstraint.secondaryReleaseGates).toContain(
      "paid_commercial_direct_model_route_runtime_witness_not_completed",
    );
    expect(decision.releaseGates).toContain(
      "the merged paid-plan direct-model route is deployed and witnessed on every production AI function that can consume a commercial allowance",
    );
  });

  it("pins all Marketplace production work to the buyer-facing data plane", () => {
    expect(productionBoundary.status).toBe(
      "canonical_production_target_verified",
    );
    expect(productionBoundary.canonicalProduction.applicationDomain).toBe(
      "https://app.syncai.ca",
    );
    expect(productionBoundary.canonicalProduction.vercelProject).toBe(
      "syncai-github",
    );
    expect(productionBoundary.canonicalProduction.supabaseProjectRef).toBe(
      "pjvoswbwomesuwhygpby",
    );
    expect(productionBoundary.noncanonicalProjectObserved.projectRef).toBe(
      "snlevbkyjipucmkpkqka",
    );
    expect(
      productionBoundary.noncanonicalProjectObserved.productionUseAuthorized,
    ).toBe(false);
    expect(
      productionBoundary.noncanonicalProjectObserved.classification,
    ).toBe("active_separate_stigg_security_operations_not_buyer_facing");
    expect(productionBoundary.noncanonicalProjectObserved.projectStatus).toBe(
      "ACTIVE_HEALTHY",
    );
    expect(productionBoundary.noncanonicalProjectObserved.disposition).toBe(
      "logically_quarantined_from_syncai_marketplace",
    );
    expect(
      productionBoundary.noncanonicalProjectObserved.operationalInventory,
    ).toMatchObject({
      activeEdgeFunctions: 39,
      edgeFunctionsWithoutJwtVerification: 15,
      publicTables: 115,
      authUsers: 9,
      storageObjects: 3589,
      activeScheduledJobs: 9,
    });
    expect(
      productionBoundary.releaseConsequences
        .paidDirectModelRouteDeploymentProven,
    ).toBe(true);
    expect(
      productionBoundary.releaseConsequences
        .boundPaidDirectModelRuntimeWitnessProven,
    ).toBe(false);
    expect(
      manifest.technicalConfiguration.commercialEntitlementEnforcement
        .productionVerification.projectRef,
    ).toBe("pjvoswbwomesuwhygpby");
    expect(runbook).toContain("Never");
    expect(runbook).toContain("snlevbkyjipucmkpkqka");
    expect(runbook).toContain("active, separate Stigg Security operations");
    expect(runbook).toContain("owner-approved dependency");
  });

  it("requires one named owner and preserves fail-closed release evidence", () => {
    expect(runbook).toMatch(/existing `admin` or `ai_admin`\s+user/i);
    expect(runbook).toContain("<existing-admin-or-ai-admin-uuid>");
    expect(runbook).toMatch(
      /Do\s+not activate any Marketplace\s+subscription/i,
    );
    expect(runbook).toMatch(
      /leave the offer unpublished and the subscription\s+inactive/i,
    );
    expect(manifest.documents).toContain(
      "docs/marketplace/commercial-policy-activation-runbook.md",
    );
  });

  it("orders the paid runtime witness after controlled-preview approval", () => {
    const approval = runbook.indexOf("Approval is a human authority act");
    const witness = runbook.indexOf(
      "An actual bound paid runtime witness is necessarily post-approval",
    );
    expect(approval).toBeGreaterThan(-1);
    expect(witness).toBeGreaterThan(approval);
    expect(runbook).toContain("nonempty `commercialPlanId`");
    expect(runbook).toMatch(/do not publish the offer/i);
  });

  it("redeploys every commercial-boundary consumer when the shared guard changes", () => {
    expect(deploymentWorkflow).toContain(
      '"supabase/functions/_shared/llm-commercial-usage.ts"',
    );
    const importers = readdirSync("supabase/functions", {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => {
        try {
          return readFileSync(
            `supabase/functions/${name}/index.ts`,
            "utf8",
          ).includes("llm-commercial-usage");
        } catch {
          return false;
        }
      });
    expect(importers.length).toBeGreaterThan(0);
    for (const importer of importers) {
      expect(deploymentWorkflow).toContain(
        `supabase functions deploy ${importer}`,
      );
    }
  });

  it("removes the deprecated commercial default before policy approval", () => {
    expect(sharedCommercialBoundary).toContain(
      'DEFAULT_COMMERCIALLY_PRICED_MODEL = "gpt-5.6-terra"',
    );
    expect(developEvidenceAgent).toContain(
      'Deno.env.get("DEVELOP_AGENT_MODEL") ?? "gpt-5.6-terra"',
    );
    expect(onboardingEnrich).toContain(
      'Deno.env.get("ONBOARD_LLM_MODEL") ?? "gpt-5.6-terra"',
    );
    expect(
      unitEconomics.observedProductionConfiguration.proposedAllowedModels,
    ).toEqual(["gpt-5.6-terra", "gpt-5.6-luna"]);
    expect(manifest.bindingConstraint.secondaryReleaseGates).not.toContain(
      "deprecated_default_commercial_model_not_replaced_in_production",
    );
    expect(decision.releaseGates).toContain(
      "the deprecated gpt-4o-mini commercial default is replaced in production and excluded from the approved plan allowlist",
    );
  });
});
