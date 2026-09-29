import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const boundary = JSON.parse(read("config/edge-function-boundary.json")) as {
  activeFunctions: string[];
  allowedNoVerifyJwt: string[];
};
const edge = read("supabase/functions/marketplace-metering/index.ts");
const core = read("supabase/functions/marketplace-metering/core.ts");
const migration = read(
  "supabase/migrations/20261229100000_azure_marketplace_metering.sql",
);
const deploy = read(".github/workflows/deploy-migrations.yml");
const config = read("supabase/config.toml");
const docs = read("docs/azure-marketplace.md");

describe("Azure Marketplace A6 metering boundary", () => {
  it("deploys metering behind both the platform and exact service-role gates", () => {
    expect(boundary.activeFunctions).toContain("marketplace-metering");
    expect(boundary.allowedNoVerifyJwt).not.toContain("marketplace-metering");
    expect(config).toMatch(
      /\[functions\.marketplace-metering\]\s+verify_jwt = true/,
    );
    expect(deploy).toContain("supabase functions deploy marketplace-metering");
    expect(deploy).toContain("Prove Azure Marketplace Metering is deployed");
    expect(edge).toContain("constantTimeEqual(authorization, expected)");
    expect(edge.toLowerCase()).not.toContain("access-control-allow-origin");
    expect(edge).not.toMatch(/request\.method\s*===?\s*["']OPTIONS["']/);
  });

  it("derives settled hourly usage server-side and applies the configured included base", () => {
    expect(migration).toContain("from private.llm_usage u");
    expect(migration).toContain("and not u.reserved");
    expect(migration).toContain("d.included_quantity");
    expect(migration).toContain(
      "v_billable := greatest(v_cumulative-v.included_quantity,0)",
    );
    expect(migration).toContain("v_due := v_billable-v_unreportable-v_allocated");
    expect(migration).toContain("prior_unreportable_quantity");
    expect(migration).toContain(
      "Marketplace meter conversion is locked after its first usage event",
    );
    expect(migration).toContain(
      "unique (marketplace_subscription_id, dimension, usage_hour)",
    );
    expect(edge).not.toMatch(/body\.(quantity|usage)|requestedQuantity/);
  });

  it("claims no more than 25 events and safely recovers stale or retryable claims", () => {
    expect(migration).toContain(
      "limit least(greatest(coalesce(p_limit,25),1),25)",
    );
    expect(migration).toContain("for update of e skip locked");
    expect(migration).toContain("last_error_code='stale_claim_released'");
    expect(migration).toContain("make_interval(mins=>least(60,power(2");
    expect(core).toContain("MARKETPLACE_METERING_BATCH_LIMIT = 25");
  });

  it("uses Microsoft's current batch contract and requires exact accepted or duplicate identity", () => {
    expect(core).toContain("/api/batchUsageEvent?api-version=");
    expect(core).toContain("resourceId");
    expect(core).not.toContain("subscriptionId:");
    expect(core).toContain("exactDuplicate");
    expect(migration).toContain(
      "when v_result->>'status'='Duplicate' then 'conflict'",
    );
    expect(migration).toContain("count(distinct result->>'recordId')");
  });

  it("keeps metering service-only, append-preserving and free of customer content", () => {
    expect(migration).toMatch(
      /revoke all on table public\.marketplace_hourly_metering_events from public, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /grant select on table public\.marketplace_hourly_metering_events to service_role/,
    );
    expect(migration).not.toMatch(
      /grant (insert|update|delete|truncate)[^;]*marketplace_hourly_metering_events/i,
    );
    expect(migration).not.toMatch(/delete from public\./i);
    expect(migration).not.toMatch(/^\s*truncate\s/im);
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(
      /prompt_text|completion_text|message_content/i,
    );
  });

  it("documents A6 as code-complete without claiming buyer proof", () => {
    expect(docs).toContain(
      "Hourly metering is implemented in code but remains disabled until",
    );
    expect(docs).toContain(
      "No live usage event has been submitted to Microsoft",
    );
  });
});
