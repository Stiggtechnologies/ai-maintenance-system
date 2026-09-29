import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const foundation = readFileSync("infra/azure/foundation.bicep", "utf8");
const application = readFileSync("infra/azure/app.bicep", "utf8");
const workflow = readFileSync(
  ".github/workflows/deploy-azure-edition.yml",
  "utf8",
);
const validationWorkflow = readFileSync(
  ".github/workflows/azure-edition-infrastructure.yml",
  "utf8",
);
const dockerfile = readFileSync("Dockerfile", "utf8");
const runbook = readFileSync("docs/azure-marketplace.md", "utf8");

describe("Azure Edition foundation", () => {
  it("creates an Azure-owned application foundation without local credentials", () => {
    expect(foundation).toContain("Microsoft.ContainerRegistry/registries");
    expect(foundation).toContain("adminUserEnabled: false");
    expect(foundation).toContain("Microsoft.App/managedEnvironments");
    expect(foundation).toContain(
      "Microsoft.ManagedIdentity/userAssignedIdentities",
    );
    expect(foundation).toContain("Microsoft.KeyVault/vaults");
    expect(foundation).toContain("enableRbacAuthorization: true");
    expect(foundation).toContain("enablePurgeProtection: true");
    expect(foundation).toContain("Microsoft.Insights/components");
    expect(foundation).toContain("AcrPull");
    expect(foundation).toContain("Key Vault Secrets User");
    expect(foundation).toContain("Key Vault Secrets Officer");
    expect(foundation).toContain("deploymentPrincipalObjectId");
    expect(foundation).not.toMatch(/adminUserEnabled:\s*true/);
  });

  it("runs the web workload in Container Apps with managed identity and health gates", () => {
    expect(application).toContain("Microsoft.App/containerApps");
    expect(application).toContain(
      "param location string = resourceGroup().location",
    );
    expect(application).toContain("location: location");
    expect(application).toContain("type: 'UserAssigned'");
    expect(application).toContain("identity: workloadIdentity.id");
    expect(application).toContain("external: true");
    expect(application).toContain("targetPort: 80");
    expect(application).toContain("path: '/health'");
    expect(application).toContain("minReplicas: minReplicas");
    expect(application).toContain("maxReplicas: maxReplicas");
    expect(application).not.toContain("passwordSecretRef");
  });

  it("uses short-lived GitHub OIDC and refuses an unconfigured deployment", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toMatch(/azure\/login@[0-9a-f]{40}/);
    expect(workflow).not.toMatch(/azure\/login@v\d/);
    expect(workflow).toContain("AZURE_CLIENT_ID");
    expect(workflow).toContain("AZURE_TENANT_ID");
    expect(workflow).toContain("AZURE_SUBSCRIPTION_ID");
    expect(workflow).toContain("AZURE_DEPLOYMENT_PRINCIPAL_OBJECT_ID");
    expect(workflow).toContain("Azure deployment prerequisites are missing");
    expect(workflow).toContain("GITHUB_REF");
    expect(workflow).toContain("refs/heads/main");
    expect(workflow).toContain("Unmerged Azure release refused");
    expect(workflow).toContain("needs: authorize-release");
    expect(workflow).toContain("infra/azure/foundation.bicep");
    expect(workflow).toContain("az acr build");
    expect(workflow).toContain("infra/azure/app.bicep");
    expect(workflow).toContain('location="$LOCATION"');
    expect(workflow).toContain("/health");
    expect(workflow).toContain("azure-production");
    expect(workflow).not.toContain("AZURE_CLIENT_SECRET");
  });

  it("compiles every Bicep entry point on each Azure infrastructure change", () => {
    expect(validationWorkflow).toMatch(/azure\/cli@[0-9a-f]{40}/);
    expect(validationWorkflow).not.toMatch(/azure\/cli@v\d/);
    expect(validationWorkflow).toContain(
      "az bicep build --file infra/azure/foundation.bicep",
    );
    expect(validationWorkflow).toContain(
      "az bicep build --file infra/azure/app.bicep",
    );
    expect(validationWorkflow).toContain(
      "az bicep build --file infra/azure/intelligence.bicep",
    );
    expect(validationWorkflow).toContain(
      "src/test/azureEditionFoundation.test.ts",
    );
  });

  it("embeds only browser-publishable build configuration in the web image", () => {
    expect(dockerfile).toContain("ARG VITE_SUPABASE_URL");
    expect(dockerfile).toContain("ARG VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(dockerfile).toContain("ARG VITE_APP_URL");
    expect(dockerfile).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(dockerfile).not.toContain("AZURE_CLIENT_SECRET");
  });

  it("keeps marketplace and co-sell status honest until deployed evidence exists", () => {
    expect(runbook).toContain(
      "Status: Azure foundation, intelligence, Entra, fulfillment, and lifecycle",
    );
    expect(runbook).toContain("commerce is not buyer-proven");
    expect(runbook).toMatch(/primarily\s+platformed on Microsoft Azure/);
    expect(runbook).toContain("SaaS Fulfillment APIs v2");
    expect(runbook).toContain("Microsoft Entra SSO");
    expect(runbook).toContain("No certification or co-sell claim");
    expect(runbook).toContain(
      "https://learn.microsoft.com/en-us/legal/marketplace/certification-policies",
    );
    expect(runbook).toContain(
      "https://learn.microsoft.com/en-us/partner-center/referrals/co-sell-requirements",
    );
  });
});
