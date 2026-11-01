import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stagingSql = readFileSync(
  "scripts/stage-marketplace-commercial-policy-drafts.sql",
  "utf8",
);
const normalized = stagingSql.replace(/\s+/g, " ").toLowerCase();

describe("Marketplace commercial-policy draft staging script", () => {
  it("pins the canonical project and requires an explicit draft commit switch", () => {
    expect(stagingSql).toContain("\\set ON_ERROR_STOP on");
    expect(stagingSql).toContain("pjvoswbwomesuwhygpby");
    expect(stagingSql).toContain("target_project_ref");
    expect(stagingSql).toContain("commit_drafts");
    expect(normalized).toContain("rollback;");
    expect(normalized).toContain("commit;");
  });

  it("stages the three exact flat-rate hard-stop plans through canonical RPCs", () => {
    expect(
      normalized.match(/select public\.configure_ai_commercial_plan_policy/g),
    ).toHaveLength(3);
    expect(
      normalized.match(/select public\.configure_commercial_plan_capacity/g),
    ).toHaveLength(3);
    expect(
      normalized.match(
        /public\.evaluate_ai_commercial_plan_policy\( 'azure_marketplace'/g,
      ),
    ).toHaveLength(3);
    expect(stagingSql).toContain("syncai-predictive-maintenance");
    expect(stagingSql).toContain("ARRAY['gpt-5.6-terra', 'gpt-5.6-luna']");
    expect(normalized).toContain("'starter', 'flat_rate', 'hard_stop'");
    expect(normalized).toContain("'professional', 'flat_rate', 'hard_stop'");
    expect(normalized).toContain("'enterprise', 'flat_rate', 'hard_stop'");
  });

  it("refuses to overwrite an approved policy or touch an active subscription", () => {
    expect(normalized).toContain("status <> 'draft'");
    expect(normalized).toContain("billing_source = 'azure_marketplace'");
    expect(normalized).toContain("status = 'active'");
    expect(normalized).toContain("marketplace_offer_id");
    expect(normalized).not.toContain("approve_ai_commercial_plan_policy");
    expect(normalized).not.toMatch(/update\s+public\.billing_subscriptions/);
    expect(normalized).not.toMatch(
      /insert\s+into\s+public\.billing_subscriptions/,
    );
  });

  it("fails the transaction unless every resulting row is an allowed draft", () => {
    expect(normalized).toContain("status <> 'draft'");
    expect(normalized).toContain(
      "coalesce((evaluation ->> 'allowed')::boolean, false)",
    );
    expect(normalized).toContain("basegrossmarginratio");
    expect(normalized).toContain("0.75");
    expect(normalized.match(/is distinct from row/g)).toHaveLength(3);
    expect(normalized).toContain("raise exception");
  });
});
