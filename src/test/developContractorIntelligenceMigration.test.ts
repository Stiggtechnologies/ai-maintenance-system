import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261225160000_develop_contractor_intelligence.sql",
  "utf8",
);
const service = readFileSync("src/services/developService.ts", "utf8");
const procurementPanel = readFileSync(
  "src/components/develop/ProcurementPanels.tsx",
  "utf8",
);
const commercialPanel = readFileSync(
  "src/components/develop/CommercialPanels.tsx",
  "utf8",
);

describe("D6.02 contractor cross-project performance", () => {
  it("adds only the missing engineering-response evidence and reuses canonical performance facts", () => {
    expect(migration).toContain(
      "create table if not exists public.contractor_engineering_responses",
    );
    expect(migration).toContain("references public.suppliers(id)");
    expect(migration).toContain("references public.development_cases(id)");
    expect(migration).toContain("references public.contract_packages(id)");
    expect(
      migration.match(/references public\.evidence_items\(id\)/g),
    ).toHaveLength(2);
    for (const canonical of [
      "contract_packages",
      "quality_ncrs",
      "acceptance_tests",
      "quality_defects",
      "warranty_claims",
      "warranty_terms",
    ]) {
      expect(migration).toMatch(
        new RegExp(`(?:from|join) public\\.${canonical}\\b`, "i"),
      );
      expect(migration).not.toMatch(
        new RegExp(
          `create table(?: if not exists)? public\\.${canonical}\\s*\\(`,
          "i",
        ),
      );
    }
  });

  it("publishes exactly the five named dimensions without a composite score or recommendation", () => {
    for (const dimension of [
      "scheduleReliability",
      "ncrRate",
      "engineeringResponse",
      "reworkRate",
      "warrantyClaims",
    ]) {
      expect(migration).toContain(`'${dimension}'`);
    }
    expect(migration).toMatch(/exactly five independent dimensions/i);
    expect(migration).toContain(
      "does not score, rank, recommend or award a supplier",
    );
    expect(migration).not.toMatch(
      /composite_score|overall_score|vendor_score/i,
    );
  });

  it("keeps every ratio refusal-first with denominator, period and project coverage", () => {
    expect(migration).toContain("'numerator'");
    expect(migration).toContain("'denominator'");
    expect(migration).toContain("p.actual_delivery_date<=p.required_date");
    expect(migration).toContain("'projectCount'");
    expect(migration).toContain("'firstObservedAt'");
    expect(migration).toContain("'lastObservedAt'");
    expect(migration).toContain("no completed, dated contract receipt");
    expect(migration).toContain("no supplier-linked acceptance test");
    expect(migration).toContain("no completed engineering response");
    expect(migration).toContain("no inspected quantity");
    expect(migration).toContain("more than one currency");
  });

  it("enforces tenant, role, evidence, package and supplier scope at the table wall", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain(
      "enforce_contractor_engineering_response_scope",
    );
    expect(migration).toContain("app_current_org()");
    expect(migration).toContain(
      "recording engineering-response evidence requires",
    );
    expect(migration).toContain(
      "AI identities cannot record contractor performance evidence",
    );
    expect(migration).toContain("does not belong to this organization");
    expect(migration).toContain("was not invited to or awarded this package");
    expect(migration).toContain(
      "an engineering-response measurement is immutable",
    );
    expect(migration).toContain("insert into public.audit_events");
  });

  it("withholds procurement-time intelligence until the tender is opened", () => {
    expect(migration).toContain(
      "get_package_contractor_intelligence(p_package_id bigint)",
    );
    expect(migration).toContain("p.bids_opened_at is null");
    expect(migration).toMatch(
      /contractor performance evidence is withheld until the bids are opened/i,
    );
    expect(migration).toContain("from public.contract_bids b");
    expect(migration).toContain("get_contractor_performance_evidence(s.id)");
  });

  it("is reachable from procurement evaluation and the contract evidence surface", () => {
    expect(service).toContain("getPackageContractorIntelligence");
    expect(service).toContain("get_package_contractor_intelligence");
    expect(service).toContain("recordContractorEngineeringResponse");
    expect(service).toContain("record_contractor_engineering_response");
    expect(procurementPanel).toContain("getPackageContractorIntelligence");
    expect(procurementPanel).toContain(
      "Cross-project contractor evidence — five dimensions",
    );
    expect(procurementPanel).toContain("Historical evidence only");
    expect(commercialPanel).toContain("recordContractorEngineeringResponse");
    expect(commercialPanel).toContain(
      "Engineering response measurement — immutable evidence",
    );
    expect(commercialPanel).toContain(
      'aria-label="Engineering request evidence"',
    );
    expect(commercialPanel).toContain(
      'aria-label="Engineering response evidence"',
    );
    expect(procurementPanel).toContain("evidence={evidence}");
  });
});
