import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const queue = JSON.parse(
  readFileSync("marketplace/azure-product-line-queue.json", "utf8"),
) as {
  portfolioRule: string;
  products: Array<{
    id: string;
    priority: string;
    queueStatus: string;
    marketplacePath: string;
    targetArchitecture?: string[];
    remainingGates?: string[];
    entryCriteria?: string[];
  }>;
};

const manifest = JSON.parse(
  readFileSync("marketplace/partner-center-manifest.json", "utf8"),
) as {
  azureProductLineQueue: {
    record: string;
    primary: string;
    enterpriseSpinOff: string;
  };
  documents: string[];
};

describe("Azure commercial product-line queue", () => {
  it("keeps the Azure-hosted SaaS as the active primary product", () => {
    const primary = queue.products.find(
      ({ id }) => id === "azure_hosted_syncai_saas",
    );
    expect(primary).toMatchObject({
      priority: "P0",
      marketplacePath: "retain_and_update_the_existing_marketplace_saas_offer",
    });
    expect(primary?.queueStatus).toMatch(/^in_progress_/);
    expect(primary?.targetArchitecture).toEqual(
      expect.arrayContaining([
        "Azure Container Apps",
        "Azure Database for PostgreSQL Flexible Server",
        "Azure Blob Storage",
        "Azure Key Vault",
        "Application Insights and Log Analytics",
        "Microsoft Entra ID",
        "Azure OpenAI",
      ]),
    );
    expect(primary?.remainingGates).toEqual(
      expect.arrayContaining([
        "design_and_rehearse_the_supabase_postgresql_to_azure_database_for_postgresql_migration",
        "move_object_and_document_storage_to_azure_blob_storage_with_tenant_and_retention_controls",
      ]),
    );
  });

  it("queues the Managed Application as a distinct evidence-gated spin-off", () => {
    const managed = queue.products.find(
      ({ id }) => id === "syncai_managed_application",
    );
    expect(managed).toMatchObject({
      priority: "P1",
      queueStatus: "queued_discovery_after_primary_saas_foundation",
      marketplacePath:
        "separate_azure_managed_application_offer_and_certification_path",
    });
    expect(managed?.entryCriteria).toEqual(
      expect.arrayContaining([
        "primary_azure_saas_foundation_is_production_proven",
        "product_does_not_fragment_the_canonical_decision_approval_and_audit_model",
      ]),
    );
    expect(queue.portfolioRule).toMatch(
      /must not delay the primary SaaS cutover/i,
    );
  });

  it("links the queue from the authoritative Marketplace operating record", () => {
    expect(manifest.azureProductLineQueue).toMatchObject({
      record: "marketplace/azure-product-line-queue.json",
      primary: "azure_hosted_syncai_saas",
      enterpriseSpinOff: "syncai_managed_application",
    });
    expect(manifest.documents).toContain(
      "marketplace/azure-product-line-queue.json",
    );
  });
});
