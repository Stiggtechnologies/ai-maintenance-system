import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADOPTION_MANAGEMENT_CATEGORIES } from "../services/adoptionManagementService";

const migration = readFileSync("supabase/migrations/20270101670000_adoption_management.sql", "utf8");
const panel = readFileSync("src/components/AdoptionManagementPanel.tsx", "utf8");
const page = readFileSync("src/pages/OrganizationalMaturityPage.tsx", "utf8");

describe("U23.01 implementation and adoption management contract", () => {
  it("makes every adoption discipline explicit in storage and UI", () => {
    expect(ADOPTION_MANAGEMENT_CATEGORIES).toHaveLength(13);
    expect(new Set(ADOPTION_MANAGEMENT_CATEGORIES).size).toBe(13);
    for (const category of ADOPTION_MANAGEMENT_CATEGORIES) {
      expect(migration).toContain(`'${category}'`);
      expect(panel).toContain(`${category}:`);
    }
  });

  it("reuses canonical identity, evidence, value, approval and audit models", () => {
    expect(migration).toContain("references public.user_profiles");
    expect(migration).toContain("references public.evidence_items");
    expect(migration).toContain("alter table public.value_metrics");
    expect(migration).toContain("alter table public.approvals");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(/create table if not exists public\.(evidence_items|value_metrics|approvals|audit_events|user_profiles)/);
  });

  it("enforces completeness, measurement and independent review on the server", () => {
    expect(migration).toContain("all thirteen adoption disciplines require an owned plan");
    expect(migration).toContain("completion requires same-tenant independently verified canonical evidence");
    expect(migration).toContain("measurement items require baseline, target and actual canonical value points");
    expect(migration).toContain("the program author or submitter cannot perform its independent closeout review");
    expect(migration).toContain("adoption management records move only through governed functions");
  });

  it("keeps operational authority outside the adoption workspace", () => {
    expect(migration).toContain("'operationalAuthority',false");
    expect(panel).toContain("never changes plant controls, procedures, work-release authority or spending authority");
  });

  it("is reachable beside the maturity assessment", () => {
    expect(page).toContain('"maturity" | "adoption"');
    expect(page).toContain("<AdoptionManagementPanel />");
    expect(page).toContain("Adoption management");
  });
});
