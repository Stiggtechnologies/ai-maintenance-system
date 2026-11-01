import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271027090000_marketplace_commercial_entitlements.sql",
  "utf8",
).toLowerCase();

const decision = JSON.parse(
  readFileSync("marketplace/commercial-offer-decision.json", "utf8"),
) as {
  decision: { publicActivationAuthorizedByEvidence: boolean };
  offerArchitecture: {
    pricingModel: string;
    automaticMeteredOverageAtLaunch: boolean;
  };
  plans: Array<{
    controlledDisplayName: string;
    monthlyPriceUsd: number;
    annualContractValueUsd: number;
    includedSites: number;
    includedNamedUsers: number;
    includedGovernedAiDecisionsPerMonth: number;
    maximumModelCallsPerMonth: number;
    maximumTokensPerMonth: number;
    allowanceMode: string;
  }>;
  economics: {
    minimumGrossMarginRatio: number;
    planStressTests: Array<{ modeledGrossMarginRatio: number }>;
  };
};

describe("Marketplace commercial entitlement controls", () => {
  it("extends the existing private AI policy instead of creating a second registry", () => {
    expect(migration).toContain(
      "alter table private.ai_commercial_plan_policies",
    );
    expect(migration).toContain(
      "create or replace function public.configure_commercial_plan_capacity",
    );
    expect(migration).not.toContain(
      "create table if not exists private.commercial_plan_entitlements",
    );
    expect(migration).toContain(
      "marketplace ai commercial policy approval blocked: site and named-user capacity are required",
    );
    expect(migration).toContain(
      "draft ai commercial policy must exist before capacity is configured",
    );
    expect(migration).toContain(
      "invalidate_marketplace_capacity_on_policy_reconfiguration",
    );
    expect(migration).toContain("new.max_sites := null");
    expect(migration).toContain("new.max_named_users := null");
  });

  it("fails Marketplace activation closed on absent or exceeded limits", () => {
    expect(migration).toContain(
      "marketplace activation blocked: approved commercial plan entitlement is absent",
    );
    expect(migration).toContain(
      "current site count exceeds the approved plan limit",
    );
    expect(migration).toContain(
      "current named-user count exceeds the approved plan limit",
    );
    expect(migration).toContain(
      "marketplace activation blocked: commercial entitlement is ambiguous",
    );
    expect(migration).toContain(
      "before insert or update of organization_id, billing_source",
    );
  });

  it("enforces capacity at every site and membership write door", () => {
    expect(migration).toContain("on public.sites");
    expect(migration).toContain("on public.user_profiles");
    expect(migration).toContain("approved marketplace site limit reached");
    expect(migration).toContain(
      "approved marketplace named-user limit reached",
    );
    expect(migration.match(/pg_advisory_xact_lock/g)).toHaveLength(3);
  });

  it("exposes a tenant-scoped readback without mutation authority", () => {
    expect(migration).toContain(
      "create or replace function public.get_current_commercial_plan_limits()",
    );
    expect(migration).toContain("where id = auth.uid()");
    expect(migration).toContain("grants no mutation authority");
  });

  it("keeps the controlled plan math internally consistent", () => {
    expect(decision.offerArchitecture.pricingModel).toBe("flat_rate");
    expect(decision.offerArchitecture.automaticMeteredOverageAtLaunch).toBe(
      false,
    );
    expect(decision.decision.publicActivationAuthorizedByEvidence).toBe(false);
    for (const plan of decision.plans) {
      expect(plan.annualContractValueUsd).toBe(plan.monthlyPriceUsd * 12);
      expect(plan.allowanceMode).toBe("hard_stop");
      expect(plan.maximumModelCallsPerMonth).toBe(
        plan.includedGovernedAiDecisionsPerMonth * 5,
      );
      expect(plan.maximumTokensPerMonth).toBe(
        plan.includedGovernedAiDecisionsPerMonth * 500_000,
      );
      expect(plan.includedSites).toBeGreaterThan(0);
      expect(plan.includedNamedUsers).toBeGreaterThan(0);
    }
    for (const stress of decision.economics.planStressTests) {
      expect(stress.modeledGrossMarginRatio).toBeGreaterThanOrEqual(
        decision.economics.minimumGrossMarginRatio,
      );
    }
  });
});
