import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219450000_develop_program_portfolio.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/developmentProgramService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/develop/ProgramPortfolioPanel.tsx",
  "utf8",
);
const page = readFileSync("src/pages/DevelopmentPortfolioPage.tsx", "utf8");
const analysis = readFileSync("src/lib/develop/programPortfolio.ts", "utf8");

describe("D10 program and dependency portfolio contract", () => {
  it("keeps canonical projects, objectives, benefits, evidence and calculations", () => {
    for (const canonical of [
      "development_cases",
      "capital_projects",
      "risk_objectives",
      "value_metrics",
      "evidence_items",
    ]) {
      expect(migration).toContain(canonical);
    }
    expect(migration).not.toMatch(
      /create table if not exists public\.(projects|benefits|evidence|approvals|recommendations)\s*\(/,
    );
  });

  it("persists only the new program, membership and project dependency nouns", () => {
    expect(migration).toContain(
      "create table if not exists public.development_programs",
    );
    expect(migration).toContain(
      "create table if not exists public.development_program_projects",
    );
    expect(migration).toContain(
      "create table if not exists public.development_project_dependencies",
    );
    expect(migration).toContain(
      "both dependency endpoints must be members of this program",
    );
    expect(migration).toContain("would create a cycle");
  });

  it("holds tenant, evidence and named-human boundaries at the persistence wall", () => {
    expect(migration).toContain("organization_id = public.app_current_org()");
    expect(migration).toContain("independently verified same-tenant evidence");
    expect(migration).toContain("u.role<>'ai_admin'");
    expect(migration).toContain("u.id=auth.uid()");
    expect(migration).toContain("ai cannot decide program membership");
    expect(migration).toContain(
      "ai may identify a possible dependency but cannot establish",
    );
  });

  it("detects benefit double counting against a stated capacity constraint without altering benefits", () => {
    expect(migration).toContain("potentialdoublecount");
    expect(migration).toContain("constraintadjustedclaim");
    expect(migration).toContain(
      "project claims exceed the independently evidenced program capacity constraint",
    );
    expect(migration).not.toMatch(/update\s+public\.value_metrics/);
  });

  it("reuses the deterministic CPM kernel and refuses missing schedule evidence", () => {
    expect(analysis).toContain('from "../modelling/schedule-risk"');
    expect(analysis).toContain("criticalPath(");
    expect(analysis).toContain("Dependency-adjusted finish is withheld");
    expect(analysis).toContain("no adjusted forecast is claimed");
  });

  it("is customer reachable on the one development portfolio", () => {
    expect(service).toContain('"get_development_program_workspace"');
    expect(service).toContain('"create_development_program"');
    expect(service).toContain('"record_development_project_dependency"');
    expect(panel).toContain("Sync Portfolio · programs and dependencies");
    expect(page).toContain(
      "<ProgramPortfolioPanel portfolioRows={data.rows} />",
    );
  });

  it("keeps all operative decisions outside the analysis", () => {
    expect(migration).toContain("automaticfunding");
    expect(migration).toContain("automaticsanction");
    expect(migration).toContain(
      "does not pass a gate, sanction a project, accept risk, commit funds or authorize work",
    );
  });
});
