import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const edge = readFileSync(
  "supabase/functions/develop-handover-agent/index.ts",
  "utf8",
);
const service = readFileSync("src/services/handoverPackageService.ts", "utf8");
const panel = readFileSync(
  "src/components/develop/SystemHandoverPanel.tsx",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20261219152000_develop_system_handover_package.sql",
  "utf8",
);
const deployment = readFileSync(
  ".github/workflows/deploy-migrations.yml",
  "utf8",
);
const boundary = readFileSync("config/edge-function-boundary.json", "utf8");
const config = readFileSync("supabase/config.toml", "utf8");

describe("D12.15 governed Handover Agent contract", () => {
  it("uses the caller identity and canonical case/package/readiness functions", () => {
    expect(edge).toContain("Authorization: `Bearer ${token}`");
    expect(edge).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(edge).toContain('"get_case_system_handover_packages"');
    expect(edge).toContain('"assemble_system_handover_package"');
    expect(edge).toContain('"get_system_handover_readiness"');
    expect(edge).not.toMatch(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
  });

  it("can assemble a draft but has no acceptance path", () => {
    expect(edge).toContain("advisory: true");
    expect(edge).toContain("assembled an evidence-linked draft only");
    expect(edge).not.toContain('"accept_system_handover_package"');
    expect(edge).not.toContain("accepted_at");
    expect(edge).not.toContain("transition_commissioning_system");
    expect(migration).toContain(
      "Draft assembly cannot accept handover or change commissioning state.",
    );
  });

  it("rejects a guessed system outside the tenant-scoped case response", () => {
    expect(edge).toContain("caseModel?.systems?.find");
    expect(edge).toContain("item.systemId === systemId");
    expect(edge).toContain('"commissioning system not found"');
  });

  it("is reachable on the handover screen and inside the deployment boundary", () => {
    expect(service).toContain('"develop-handover-agent"');
    expect(panel).toContain("runHandoverAgent({");
    expect(panel).toContain("Run Handover Agent · assemble draft");
    expect(deployment).toContain(
      "supabase functions deploy develop-handover-agent",
    );
    expect(boundary).toContain('"develop-handover-agent"');
    expect(config).toContain(
      "[functions.develop-handover-agent]\nverify_jwt = true",
    );
  });
});
