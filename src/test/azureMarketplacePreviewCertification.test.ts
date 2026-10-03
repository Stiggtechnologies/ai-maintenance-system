import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateMarketplacePreviewCertification,
  type MarketplaceCertificationInput,
} from "../lib/azure-marketplace-certification";

const read = (path: string) => readFileSync(path, "utf8");

function fixture(): MarketplaceCertificationInput {
  const primary = "11111111-1111-4111-8111-111111111111";
  const terminal = "22222222-2222-4222-8222-222222222222";
  const organization = "33333333-3333-4333-8333-333333333333";
  const billing = "44444444-4444-4444-8444-444444444444";
  const operation = (action: string) => ({
    action,
    processing_state: "completed",
    microsoft_status: "Succeeded",
  });
  return {
    expected: {
      publisherId: "syncai-publisher",
      offerId: "syncai-preview",
      planId: "enterprise",
      dimension: "ai-analysis-unit",
      unitSize: 1_000,
      includedQuantity: 2,
      quantityScale: 0,
    },
    primarySubscriptionId: primary,
    unsubscribeSubscriptionId: terminal,
    primaryBilling: {
      id: billing,
      organization_id: organization,
      billing_source: "azure_marketplace",
      marketplace_subscription_id: primary,
      marketplace_publisher_id: "syncai-publisher",
      marketplace_offer_id: "syncai-preview",
      marketplace_plan_id: "enterprise",
      marketplace_status: "Subscribed",
      status: "active",
    },
    primaryResolution: {
      billing_subscription_id: billing,
      organization_id: organization,
      publisher_id: "syncai-publisher",
      offer_id: "syncai-preview",
      plan_id: "enterprise",
      internal_status: "active",
      marketplace_status: "Subscribed",
      activated_at: "2026-09-29T10:00:00Z",
    },
    primaryOperations: [
      "ChangePlan",
      "ChangeQuantity",
      "Renew",
      "Suspend",
      "Reinstate",
    ].map(operation),
    terminalBilling: {
      billing_source: "azure_marketplace",
      marketplace_subscription_id: terminal,
      marketplace_publisher_id: "syncai-publisher",
      marketplace_offer_id: "syncai-preview",
      marketplace_status: "Unsubscribed",
      status: "cancelled",
    },
    terminalResolution: {
      internal_status: "unsubscribed",
      marketplace_status: "Unsubscribed",
    },
    terminalOperations: [operation("Unsubscribe")],
    acceptedMeteringEvent: {
      id: "55555555-5555-4555-8555-555555555555",
      marketplace_subscription_id: primary,
      plan_id: "enterprise",
      dimension: "ai-analysis-unit",
      status: "accepted",
      microsoft_status: "Accepted",
      microsoft_usage_event_id: "usage-1",
      request_id: "66666666-6666-4666-8666-666666666666",
      correlation_id: "77777777-7777-4777-8777-777777777777",
      source_units: 12_000,
      included_quantity: 2,
      prior_unreportable_quantity: 1,
      prior_allocated_quantity: 3,
      quantity: 6,
      submitted_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    },
    marketplacePrimary: {
      id: primary,
      publisherId: "syncai-publisher",
      offerId: "syncai-preview",
      planId: "enterprise",
      status: "Subscribed",
    },
    duplicateResult: {
      status: "Duplicate",
      exactDuplicate: true,
      acceptedQuantity: 6,
    },
    rejectedResult: { status: "ResourceNotFound" },
    auditEvents: [
      {
        entity_type: "azure_marketplace_subscription",
        event_data: {
          event: "activation_requested",
          marketplaceSubscriptionId: primary,
        },
      },
      {
        entity_type: "azure_marketplace_metering",
        event_data: {
          event: "usage_emission_completed",
          marketplaceSubscriptionId: primary,
          meteringRecordId: "55555555-5555-4555-8555-555555555555",
          status: "accepted",
          microsoftStatus: "Accepted",
        },
      },
    ],
    partnerCenterEvidence: {
      reference: "evidence/partner-center-usage-view.png",
      sha256: "a".repeat(64),
      capturedAt: new Date().toISOString(),
    },
    witnessedBy: "marketplace-operator",
    reviewedBy: "independent-reviewer",
  };
}

describe("Azure Marketplace preview certification", () => {
  it("requires every live commerce witness before passing", () => {
    const checks = evaluateMarketplacePreviewCertification(fixture());
    expect(checks).toHaveLength(12);
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("rejects unrelated audit history and stale external evidence", () => {
    const input = fixture();
    input.auditEvents[0] = {
      entity_type: "azure_marketplace_subscription",
      event_data: {
        event: "activation_requested",
        marketplaceSubscriptionId: input.unsubscribeSubscriptionId,
      },
    };
    input.partnerCenterEvidence.capturedAt = new Date(
      Date.now() - 25 * 60 * 60_000,
    ).toISOString();
    const failed = evaluateMarketplacePreviewCertification(input)
      .filter((check) => !check.passed)
      .map((check) => check.id);
    expect(failed).toEqual(
      expect.arrayContaining([
        "canonical-audit-lineage",
        "partner-center-usage-view",
      ]),
    );
  });

  it("fails closed on missing suspension, incorrect arithmetic, or self-review", () => {
    const input = fixture();
    input.primaryOperations = input.primaryOperations.filter(
      (operation) => operation.action !== "Suspend",
    );
    if (input.acceptedMeteringEvent) input.acceptedMeteringEvent.quantity = 7;
    input.reviewedBy = input.witnessedBy;
    const failed = evaluateMarketplacePreviewCertification(input)
      .filter((check) => !check.passed)
      .map((check) => check.id);
    expect(failed).toEqual(
      expect.arrayContaining([
        "primary-live-lifecycle",
        "included-quantity-reconciliation",
        "partner-center-usage-view",
      ]),
    );
  });

  it("keeps the live suite manual, protected, and artifact-backed", () => {
    const workflow = read(
      ".github/workflows/azure-marketplace-preview-certification.yml",
    );
    const script = read("scripts/azure-marketplace-preview-certification.ts");
    const migration = read(
      "supabase/migrations/20261230100000_azure_marketplace_preview_certification.sql",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("environment: azure-production");
    expect(workflow).toContain(
      "MARKETPLACE_PREVIEW_UNSUBSCRIBE_SUBSCRIPTION_ID",
    );
    expect(workflow).toContain("actions/upload-artifact@");
    expect(workflow).not.toContain("pull_request:");
    expect(script).toContain("microsoft_exact_duplicate_not_witnessed");
    expect(script).toContain("synthetic_non_billable_rejection_not_witnessed");
    expect(script).toContain("reportSha256");
    expect(script).toContain("primarySubscriptionFingerprint");
    expect(script).toContain("record_marketplace_preview_certification");
    expect(script).not.toContain("AZURE_MARKETPLACE_CLIENT_SECRET=");
    expect(migration).toContain("azure_marketplace_certification");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("p_witness_fingerprint=p_reviewer_fingerprint");
    expect(migration).toContain("v_required_check_ids constant text[]");
    expect(migration).toContain("canonical-audit-lineage");
    expect(migration).toContain(
      "event_data->>'marketplaceSubscriptionId'=p_primary_subscription_id",
    );
    expect(migration).toContain("event_data->>'meteringRecordId'=v_meter_id::text");
    expect(migration).toContain(
      "p_evidence_captured_at<v_meter_submitted_at",
    );
    expect(migration).not.toContain("p_primary_subscription_id',");
  });
});
