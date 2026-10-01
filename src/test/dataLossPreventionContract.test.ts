import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath =
  "supabase/migrations/20270101330000_data_loss_prevention.sql";
const migration = readFileSync(migrationPath, "utf8").toLowerCase();
const guard = readFileSync(
  "supabase/functions/_shared/data-egress-guard.ts",
  "utf8",
);
const deploymentBoundary = JSON.parse(
  readFileSync("config/edge-function-boundary.json", "utf8"),
) as { activeFunctions: string[]; blockedLegacyFunctions: string[] };

const deployedTenantModelCallers = [
  "agent-loop-enrich",
  "ai-agent-processor",
  "develop-change-impact-agent",
  "develop-contract-strategy-agent",
  "develop-evidence-agent",
  "develop-gate-agent",
  "develop-methodology-agent",
  "develop-requirements-agent",
  "develop-risk-agent",
  "onboarding-enrich",
  "sync-investigation-runtime",
  "sync-realtime-session",
  "sync-tts",
] as const;

describe("E5.07 governed data-loss prevention", () => {
  it("extends the canonical egress register with an immutable governed lifecycle", () => {
    expect(migration).toContain("alter table public.data_egress_rules");
    expect(migration).not.toMatch(/create table[^;]+(dlp|egress)/);
    expect(migration).toContain("propose_data_egress_rule");
    expect(migration).toContain("decide_data_egress_rule");
    expect(migration).toContain("trg_guard_data_egress_rule_write");
    expect(migration).toContain("the proposer cannot independently");
    expect(migration).toContain("app_actor_has_verified_mfa(v_uid)");
    expect(migration).toContain("app_current_aal()<>'aal2'");
  });

  it("authorizes exact tenant, destination, class and purpose or denies", () => {
    expect(migration).toContain("authorize_data_egress");
    expect(migration).toContain("authorize_service_data_egress");
    expect(migration).toContain("r.organization_id=p_organization_id");
    expect(migration).toContain("r.destination=p_destination");
    expect(migration).toContain("r.data_class=p_data_class");
    expect(migration).toContain("p_purpose=any(r.allowed_purposes)");
    expect(migration).toContain("r.rule_status='adopted'");
    expect(migration).toContain("r.superseded_by_rule_id is null");
    expect(migration).toContain("not r.permitted");
    expect(migration).toContain(
      "r.redaction_required and not p_redaction_applied",
    );
    expect(migration).toContain("'allowed',false");
  });

  it("retains every decision without creating a parallel audit ledger", () => {
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("insert into public.security_events");
    expect(migration).not.toMatch(
      /create table[^;]+(decision|receipt|audit|event)/,
    );
  });

  it("fails closed before an outbound provider fetch", () => {
    expect(guard).toContain('"authorize_service_data_egress"');
    expect(guard).toContain('"authorize_data_egress"');
    expect(guard).toContain("if (error)");
    expect(guard).toContain("decision?.allowed !== true");
    expect(guard).toContain("decision = authorizeDataEgress");
    expect(guard).toContain("await decision");
    expect(guard).toContain("return fetchLike(url, init)");
    expect(guard.indexOf("await decision")).toBeLessThan(
      guard.indexOf("return fetchLike(url, init)"),
    );
  });

  it.each(deployedTenantModelCallers)(
    "guards production tenant model egress in %s",
    (name) => {
      const source = readFileSync(
        `supabase/functions/${name}/index.ts`,
        "utf8",
      );
      expect(source).toContain("data-egress-guard.ts");
      expect(source).toContain("withDataEgressGuard");
    },
  );

  it("cannot add an active tenant provider caller outside the governed boundary", () => {
    const providerCallMarkers = [
      /callWithResilience(?:Stream)?\(/,
      /resolveExternalGatewayUrl\(/,
      /synthesizeOpenAiSpeech\(/,
      /api\.openai\.com/,
      /api\.x\.ai/,
      /openai\.azure\.com/,
      /generativelanguage\.googleapis/,
    ];
    const discovered: string[] = [];

    for (const name of deploymentBoundary.activeFunctions) {
      const source = readFileSync(`supabase/functions/${name}/index.ts`, "utf8");
      if (!providerCallMarkers.some((marker) => marker.test(source))) continue;

      // This is the anonymous, public-reference rail: it has no tenant corpus
      // or tenant id. Authenticated requests are handed to ai-agent-processor,
      // which is guarded separately above.
      if (name === "public-reliability-agent") {
        expect(source).toContain("organization_id: null");
        expect(source).toContain("No tenant documents");
        continue;
      }

      discovered.push(name);
      expect(source, `${name} opens a provider boundary without DLP`).toContain(
        "withDataEgressGuard",
      );
    }

    expect(discovered.sort()).toEqual([...deployedTenantModelCallers].sort());
  });

  it("exposes the governed register to customers without claiming plant authority", () => {
    const panel = readFileSync(
      "src/components/DataEgressGovernancePanel.tsx",
      "utf8",
    );
    const service = readFileSync(
      "src/services/dataEgressGovernanceService.ts",
      "utf8",
    );
    expect(panel).toContain("Data-loss prevention");
    expect(panel).toContain("does not authorize plant action");
    expect(service).toContain('"get_data_egress_rules"');
    expect(service).toContain('"propose_data_egress_rule"');
    expect(service).toContain('"decide_data_egress_rule"');
  });
});
