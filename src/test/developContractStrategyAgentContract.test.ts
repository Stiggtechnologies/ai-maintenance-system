import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261220000000_develop_contract_strategy_agent.sql", "utf8");
const edge = readFileSync("supabase/functions/develop-contract-strategy-agent/index.ts", "utf8");
const config = readFileSync("supabase/config.toml", "utf8");
const boundary = readFileSync("config/edge-function-boundary.json", "utf8");
const panel = readFileSync("src/components/develop/ContractStrategyAgentPanel.tsx", "utf8");
const host = readFileSync("src/components/develop/ProcurementPanels.tsx", "utf8");
const smoke = readFileSync("scripts/ci-develop-contract-strategy-agent-smoke.sh", "utf8");

describe("D12.02 contract-strategy agent contract", () => {
  it("uses the canonical recommendation ledger and preserves human award authority", () => {
    expect(migration).toContain("insert into public.recommendations");
    expect(migration).toContain("'pending'");
    expect(migration).toContain("'draft_recommendation'");
    expect(migration).toContain("'recommend_contract_strategy'");
    expect(migration).not.toMatch(/insert into public\.(contracts|contract_awards|purchase_orders)/i);
    expect(migration).not.toMatch(/insert into public\.approvals/i);
    expect(smoke).toContain("no_award=true");
  });

  it("enforces caller identity, tenant/case evidence binding, and model provenance", () => {
    expect(edge).toContain('Deno.env.get("SUPABASE_ANON_KEY")');
    expect(edge).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(edge).toContain('"record_contract_strategy_recommendation"');
    expect(migration).toContain("e.organization_id = v_org");
    expect(migration).toContain("e.development_case_id = p_case_id");
    expect(migration).toContain("the exact model identifier is required");
    expect(smoke).toContain("FOREIGN_EVIDENCE");
  });

  it("is deployed behind JWT verification and reachable in the canonical procurement surface", () => {
    expect(config).toContain("[functions.develop-contract-strategy-agent]");
    expect(config).toContain("verify_jwt = true");
    expect(boundary).toContain('"develop-contract-strategy-agent"');
    expect(panel).toContain("Generate and record pending recommendation");
    expect(panel).toContain("AI recommends. Accountable humans decide");
    expect(host).toContain("<ContractStrategyAgentPanel");
  });

  it("admits tenant-cascade delete of adopted controls without weakening in-place immutability", () => {
    const historyStart = migration.indexOf(
      "create or replace function public.enforce_agent_control_history()",
    );
    const historyEnd = migration.indexOf(
      "create or replace function public.enforce_agent_binding_history()",
    );
    const bindingEnd = migration.indexOf(
      "create or replace function public.provision_contract_strategy_agent",
    );
    expect(historyStart).toBeGreaterThan(-1);
    expect(historyEnd).toBeGreaterThan(historyStart);
    expect(bindingEnd).toBeGreaterThan(historyEnd);
    const history = migration.slice(historyStart, historyEnd);
    const bindings = migration.slice(historyEnd, bindingEnd);
    expect(history).toContain("if tg_op='DELETE' then");
    expect(history).toContain(
      "if not exists (select 1 from organizations where id = old.organization_id) then",
    );
    expect(history).toContain("return old;");
    expect(history).toContain(
      "adopted agent controls are immutable; supersede them with a new version",
    );
    expect(history).toContain("if tg_op='UPDATE' and old.status='adopted' then");
    expect(bindings).toContain(
      "if not exists (select 1 from organizations where id = old.organization_id)",
    );
    expect(bindings).toContain("adopted agent control bindings are immutable");
  });
});
