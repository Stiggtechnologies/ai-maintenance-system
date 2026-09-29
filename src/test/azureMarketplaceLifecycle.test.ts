import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const boundary = JSON.parse(read("config/edge-function-boundary.json")) as {
  activeFunctions: string[];
  allowedNoVerifyJwt: string[];
};
const edge = read("supabase/functions/marketplace-webhook/index.ts");
const core = read("supabase/functions/marketplace-webhook/core.ts");
const migration = read(
  "supabase/migrations/20261228100000_azure_marketplace_lifecycle.sql",
);
const deploy = read(".github/workflows/deploy-migrations.yml");
const config = read("supabase/config.toml");
const docs = read("docs/azure-marketplace.md");
const auth = read("src/lib/auth.ts");

describe("Azure Marketplace A5 lifecycle boundary", () => {
  it("deploys a reviewed custom-auth webhook and refuses unsigned production probes", () => {
    expect(boundary.activeFunctions).toContain("marketplace-webhook");
    expect(boundary.allowedNoVerifyJwt).toContain("marketplace-webhook");
    expect(config).toMatch(
      /\[functions\.marketplace-webhook\]\s+verify_jwt = false/,
    );
    expect(deploy).toContain(
      "supabase functions deploy marketplace-webhook --no-verify-jwt",
    );
    expect(deploy).toContain("Prove Azure Marketplace Webhook is deployed");
    expect(edge).toContain("marketplace_webhook_token_required");
  });

  it("validates the Microsoft JWT signature and claims before Get Operation or persistence", () => {
    expect(edge).toContain('from "npm:jose@5.9.6"');
    expect(edge).toContain("createRemoteJWKSet");
    expect(edge).toContain("jwtVerify");
    expect(core).toContain("validateMarketplaceWebhookClaims");
    expect(edge.indexOf("await verifyWebhookToken")).toBeLessThan(
      edge.indexOf("const operationEvidence"),
    );
    expect(edge.indexOf("const operationEvidence")).toBeLessThan(
      edge.indexOf("claim_marketplace_lifecycle_operation"),
    );
  });

  it("uses Get Operation and authoritative subscription state with idempotent service persistence", () => {
    expect(edge).toContain("webhookMatchesOperation");
    expect(edge).toContain("normalizeMarketplaceSubscription");
    expect(migration).toContain("marketplace_fulfillment_operations");
    expect(migration).toContain(
      "unique (marketplace_subscription_id, microsoft_operation_id)",
    );
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("payload_fingerprint");
    expect(migration).not.toMatch(
      /request_payload|response_payload|purchase_token/i,
    );
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(/create table[^\n]*audit/i);
  });

  it("makes canonical billing status the workspace entitlement authority", () => {
    expect(migration).toContain("app_org_has_commercial_entitlement");
    expect(migration).toContain("get_current_workspace_entitlement");
    expect(migration).toContain("if not v_ack then");
    expect(migration).toMatch(
      /billing_source='azure_marketplace'[\s\S]+marketplace_status='Subscribed'/,
    );
    expect(migration).toContain(
      "create or replace function public.app_current_org()",
    );
    expect(auth).toMatch(
      /supabase\.rpc\(\s*"get_current_workspace_entitlement"\s*,?\s*\)/,
    );
  });

  it("keeps lifecycle persistence service-only and preserves customer evidence", () => {
    expect(migration).toMatch(
      /revoke all on table public\.marketplace_fulfillment_operations from public, anon, authenticated/,
    );
    expect(migration).not.toMatch(/delete from public\./i);
    expect(migration).not.toMatch(/^\s*truncate\s/im);
    expect(migration).toContain("when 'Suspended' then 'suspended'");
    expect(migration).toContain("when 'Unsubscribed' then 'cancelled'");
  });

  it("documents A5 as code-complete but not buyer-proven", () => {
    expect(docs).toContain(
      "Authenticated, idempotent webhook lifecycle and canonical entitlement enforcement are implemented in code",
    );
    expect(docs).toContain(
      "not end-to-end commerce evidence until a preview offer exercises every lifecycle event",
    );
  });
});
