import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101340000_contract_legal_compliance.sql",
  "utf8",
).toLowerCase();
const regulatory = readFileSync(
  "supabase/migrations/20261122090200_regulatory_condition_propagation.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/developService.ts", "utf8");
const panel = readFileSync(
  "src/components/develop/CommercialPanels.tsx",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync("docs/sync-develop/register.md", "utf8");

describe("D11.24 deterministic contract-compliance boundary", () => {
  it("attaches immutable legal determinations to the canonical contract and evidence models", () => {
    expect(migration).toContain("references public.contract_packages(id)");
    expect(migration).toContain("references public.evidence_items(id)");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(
      /create table[^;]+public\.(contracts|contract_awards|approvals|audit_events)/,
    );
    expect(migration).toContain("supersedes_id");
    expect(migration).toContain(
      "contract legal-compliance attestations are immutable",
    );
  });

  it("reserves the determination for a named same-tenant human with verified AAL2", () => {
    expect(migration).toContain("record_contract_legal_compliance");
    expect(migration).toContain("app_actor_has_verified_mfa(v_uid)");
    expect(migration).toContain("app_current_aal()<>'aal2'");
    expect(migration).toContain("the ai-operator identity cannot attest");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("enforce_contract_legal_attestor_is_human");
  });

  it("requires verified documented case evidence and refuses stale or absent truth", () => {
    expect(migration).toMatch(/e\.verification_status\s*<>\s*'verified'/);
    expect(migration).toMatch(/e\.evidence_class\s*<>\s*'documented'/);
    expect(migration).toMatch(
      /e\.development_case_id\s+is distinct from\s+p\.development_case_id/,
    );
    expect(migration).toContain("contract_legal_compliance_position");
    expect(migration).toContain("no legal-compliance determination");
    expect(migration).toContain("legal-compliance determination expired");
    expect(migration).toContain("'compliant',a.determination='compliant'");
  });

  it("fails direct writes closed and makes the governed act customer reachable", () => {
    expect(migration).toContain(
      "coalesce(current_setting('app.contract_legal_writer',true),'')<>'governed'",
    );
    expect(migration).toContain("get_contract_commercial");
    expect(service).toContain('"record_contract_legal_compliance"');
    expect(panel).toContain("Contract legal compliance — human determination");
    expect(panel).toContain(
      "AI may prepare evidence; it cannot make this determination",
    );
    expect(workflow).toContain(
      "bash scripts/ci-contract-legal-compliance-smoke.sh",
    );
  });

  it("closes all seven spec §70 determinations without overclaiming regulation", () => {
    expect(regulatory).toContain(
      "recording a regulatory approval asserts that a regulator has been satisfied",
    );
    expect(regulatory).toContain("the ai-operator identity cannot record it");
    expect(register).toMatch(/\| D11\.24 \|[^\n]+\| ✅\s+\|/);
    for (const determination of [
      "gate passed",
      "risk accepted",
      "regulation satisfied",
      "safety barrier adequate",
      "project sanctioned",
      "equipment safe to start",
      "contract legally compliant",
    ]) {
      expect(register.toLowerCase()).toContain(determination);
    }
  });
});
