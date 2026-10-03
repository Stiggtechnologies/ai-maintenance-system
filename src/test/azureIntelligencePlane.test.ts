import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const infrastructure = readFileSync("infra/azure/intelligence.bicep", "utf8");
const workflow = readFileSync(
  ".github/workflows/deploy-azure-edition.yml",
  "utf8",
);
const validation = readFileSync(
  ".github/workflows/azure-edition-infrastructure.yml",
  "utf8",
);
const dockerfile = readFileSync("Dockerfile.azure-intelligence", "utf8");
const dockerignore = readFileSync(".dockerignore", "utf8");
const runtime = readFileSync(
  "supabase/functions/agent-loop-enrich/index.ts",
  "utf8",
);
const azureProvider = readFileSync(
  "supabase/functions/_shared/azure-openai-provider.ts",
  "utf8",
);
const identity = readFileSync(
  "supabase/functions/_shared/azure-managed-identity.ts",
  "utf8",
);
const runbook = readFileSync("docs/azure-marketplace.md", "utf8");

describe("Azure Intelligence plane", () => {
  it("runs variable inference compute on Azure without an Azure OpenAI key", () => {
    expect(infrastructure).toContain("Microsoft.CognitiveServices/accounts");
    expect(infrastructure).toContain("kind: 'OpenAI'");
    expect(infrastructure).toContain("disableLocalAuth: true");
    expect(infrastructure).toContain(
      "Microsoft.CognitiveServices/accounts/deployments",
    );
    expect(infrastructure).toContain("Microsoft.App/containerApps");
    expect(infrastructure).toContain("plane: 'intelligence'");
    expect(infrastructure).toContain("maxReplicas: maxReplicas");
    expect(infrastructure).toContain("Cognitive Services OpenAI User");
    expect(infrastructure).toContain("5e0bd9bd-7b93-4f28-af87-19fc36ad61bd");
    expect(infrastructure).not.toMatch(/AZURE_OPENAI_(API_)?KEY/);
    expect(infrastructure).not.toContain("disableLocalAuth: false");
  });

  it("reads operational secrets only through managed-identity Key Vault references", () => {
    expect(infrastructure).toContain("keyVaultUrl:");
    expect(infrastructure).toContain("identity: workloadIdentity.id");
    expect(infrastructure).toContain("secretRef: 'supabase-service'");
    expect(infrastructure).toContain("secretRef: 'enrich-auth'");
    expect(infrastructure).not.toContain("value: supabaseServiceRole");
    expect(infrastructure).not.toContain("passwordSecretRef");
  });

  it("deploys a minimal governed runtime image", () => {
    expect(dockerfile).toContain("supabase/functions/_shared");
    expect(dockerfile).toContain("supabase/functions/agent-loop-enrich");
    expect(dockerfile).toContain('"--cached-only"');
    expect(dockerfile).toContain('"--allow-env"');
    expect(dockerfile).toContain('"--allow-net"');
    expect(dockerfile).not.toContain("COPY . .");
    expect(dockerfile).not.toMatch(/(SERVICE_ROLE|SHARED_SECRET|OPENAI_KEY)=/);
    expect(dockerignore).toContain("!supabase/functions/_shared/**");
    expect(dockerignore).toContain("!supabase/functions/agent-loop-enrich/**");
  });

  it("uses the Container Apps managed identity and refuses token exfiltration", () => {
    expect(runtime).toContain("getAzureManagedIdentityAccessToken");
    expect(runtime).toContain("AZURE_EDITION_STRICT");
    expect(runtime).toContain("azure_intelligence_unavailable");
    expect(runtime).toContain("intelligence_provider_probe_failed");
    expect(azureProvider).toContain("resolveAzureOpenAiEndpoint");
    expect(azureProvider).toContain("adaptAzureOpenAiFetch");
    expect(azureProvider).toContain('name: "azure-openai"');
    expect(identity).toContain('"X-IDENTITY-HEADER"');
    expect(identity).toContain('host === "127.0.0.1"');
    expect(identity).toContain('host === "169.254.169.254"');
    expect(identity).not.toContain("console.");
  });

  it("proves health, anonymous refusal, managed identity, and canonical routing before cutover", () => {
    expect(workflow).toContain("Dockerfile.azure-intelligence");
    expect(workflow).toContain("infra/azure/intelligence.bicep");
    expect(workflow).toContain("azureOpenAIConfigured");
    expect(workflow).toContain("unauthenticated");
    expect(workflow).toContain("Refuse malformed deployment inputs");
    expect(workflow).toContain('p.provider!=="azure-openai"');
    expect(workflow).toContain("configure_agent_enrichment");
    expect(
      workflow.indexOf("Prove the Azure Intelligence identity"),
    ).toBeLessThan(
      workflow.indexOf("Route the canonical enrichment cron to Azure"),
    );
    expect(workflow).not.toContain("AZURE_CLIENT_SECRET");
  });

  it("compiles and tests every intelligence-plane artifact on change", () => {
    expect(validation).toContain(
      "az bicep build --file infra/azure/intelligence.bicep",
    );
    expect(validation).toContain("src/test/azureIntelligencePlane.test.ts");
    expect(validation).toContain(
      "src/lib/llm-resilience/azure-managed-identity.test.ts",
    );
    expect(validation).toContain(
      "src/lib/llm-resilience/azure-openai-provider.test.ts",
    );
  });

  it("keeps the marketplace claim below deployed proof", () => {
    expect(runbook).toContain("Azure Intelligence plane");
    expect(runbook).toMatch(/not\s+yet production-proven/);
    expect(runbook).toContain("canonical recommendation records");
    expect(runbook).toMatch(/does\s+not authorize operational action/);
  });
});
