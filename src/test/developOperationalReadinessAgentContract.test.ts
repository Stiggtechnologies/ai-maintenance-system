import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const edge = readFileSync(
  "supabase/functions/develop-operational-readiness-agent/index.ts",
  "utf8",
);
const core = readFileSync(
  "supabase/functions/_shared/develop-operational-readiness-core.ts",
  "utf8",
);
const service = readFileSync("src/services/developService.ts", "utf8");
const panel = readFileSync(
  "src/components/develop/ReadinessPanels.tsx",
  "utf8",
);
const config = readFileSync("supabase/config.toml", "utf8");
const boundary = readFileSync("config/edge-function-boundary.json", "utf8");
const deploy = readFileSync(".github/workflows/deploy-migrations.yml", "utf8");

describe("D12.14 Operational Readiness Agent contract", () => {
  it("reads the canonical ORI as the authenticated caller", () => {
    expect(edge).toContain(
      'caller.rpc(\n    "get_case_operational_readiness_index"',
    );
    expect(edge).toContain("caller.auth.getUser()");
    expect(edge).toContain("SUPABASE_ANON_KEY");
    expect(edge).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(edge).not.toMatch(/\.from\(["']/);
  });

  it("cannot mutate readiness, acceptance, go-live or energy state", () => {
    for (const forbidden of [
      "accept_system_handover_package",
      "record_system_operational_readiness_item",
      "adopt_case_operational_readiness_index_profile",
      "transition_commissioning_system_state",
      ".insert(",
      ".update(",
      ".delete(",
    ])
      expect(edge).not.toContain(forbidden);
    expect(edge).toContain(
      "cannot accept handover, approve go-live, authorize energization, complete a readiness item",
    );
  });

  it("names hard blockers, preserves refusals and emits canonical provenance", () => {
    expect(core).toContain('answer: "yes" | "no" | "not_assessable"');
    expect(core).toContain("calculation.hardBlockers");
    expect(core).toContain("operational_readiness_index_profiles:");
    expect(core).toContain("asset_onboarding_items:");
    expect(core).toContain("evidence_items:");
    expect(core).toContain("unrecorded conditions are not proof of readiness");
  });

  it("is reachable and inside the authenticated deployment boundary", () => {
    expect(service).toContain('"develop-operational-readiness-agent"');
    expect(panel).toContain("Run Operational Readiness Agent");
    expect(panel).toMatch(/could operations take ownership\s+tomorrow\?/);
    expect(config).toMatch(
      /\[functions\.develop-operational-readiness-agent\]\s*verify_jwt = true/,
    );
    expect(boundary).toContain('"develop-operational-readiness-agent"');
    expect(deploy).toContain(
      "supabase functions deploy develop-operational-readiness-agent",
    );
  });
});
