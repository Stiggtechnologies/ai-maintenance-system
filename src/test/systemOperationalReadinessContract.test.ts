import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261219151000_develop_system_operational_readiness.sql",
  "utf8",
);
const service = readFileSync("src/services/developService.ts", "utf8");
const panel = readFileSync(
  "src/components/develop/ReadinessPanels.tsx",
  "utf8",
);
const smoke = readFileSync(
  "scripts/ci-develop-system-operational-readiness-smoke.sh",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

describe("D8.08 commissioning-system operational readiness", () => {
  it("normalizes system scope over the one canonical readiness item store", () => {
    expect(sql).toContain("commissioning_system_readiness_scope");
    expect(sql).toContain("onboarding_item_id uuid not null references public.asset_onboarding_items");
    expect(sql).not.toMatch(/create table[^;]+operational_readiness_items/i);
    expect(sql).toContain("readinessStore','asset_onboarding_items'");
  });

  it("carries the thirteen categories with owner, date, and evidence accountability", () => {
    expect(smoke).toContain('len({i["category"] for i in s["items"]})==13');
    for (const field of [
      "owner_id uuid not null",
      "required_before date not null",
      "basis_evidence_item_id uuid not null",
      "evidence_item_id uuid references public.evidence_items",
    ])
      expect(sql).toContain(field);
  });

  it("enforces tenant, bound-asset, named-human, evidence, and immutability walls", () => {
    expect(sql).toContain("commissioning readiness scope must remain in one tenant");
    expect(sql).toContain("readiness item asset must be bound to the commissioning system");
    expect(sql).toContain("readiness owner and assigner must be named humans in the same tenant");
    expect(sql).toContain("same-tenant evidence matching the readiness asset is required");
    expect(sql).toContain("completed system readiness evidence is immutable");
    expect(sql).toContain("commissioning system readiness scope is append-only");
    expect(sql).toContain(
      "revoke all on function public.guard_commissioning_system_readiness_scope() from public,anon,authenticated",
    );
  });

  it("keeps readiness advisory and separate from energization and handover acceptance", () => {
    expect(sql).toContain("does not accept handover, authorize energization, or approve operations ownership");
    expect(sql).not.toContain("update public.commissioning_systems set commissioning_state");
  });

  it("ships customer writes, the case read surface, and clean-chain runtime proof", () => {
    for (const rpc of [
      '"initialize_commissioning_system_readiness"',
      '"record_system_operational_readiness_item"',
      '"get_case_system_operational_readiness"',
    ])
      expect(service).toContain(rpc);
    expect(panel).toContain("Commissioning-system readiness");
    expect(panel).toContain("Assign canonical readiness items");
    expect(panel).toContain("Record evidenced outcome");
    expect(ci).toContain("ci-develop-system-operational-readiness-smoke.sh");
    expect(smoke).toContain("readiness scope rewrite unexpectedly succeeded");
  });
});
