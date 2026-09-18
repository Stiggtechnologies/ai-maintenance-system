import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const edge = readFileSync(
  "supabase/functions/develop-lessons-agent/index.ts",
  "utf8",
);
const core = readFileSync(
  "supabase/functions/_shared/develop-lessons-core.ts",
  "utf8",
);
const screening = readFileSync(
  "supabase/migrations/20261219090000_develop_realize_residual_cluster.sql",
  "utf8",
);
const service = readFileSync("src/services/developService.ts", "utf8");
const panel = readFileSync("src/components/develop/RealizePanels.tsx", "utf8");
const deployment = readFileSync(
  ".github/workflows/deploy-migrations.yml",
  "utf8",
);
const boundary = readFileSync("config/edge-function-boundary.json", "utf8");
const config = readFileSync("supabase/config.toml", "utf8");
const register = readFileSync("docs/sync-develop/register.md", "utf8");

function registerRow(id: string) {
  return (
    register.split("\n").find((line) => line.startsWith(`| ${id} |`)) ?? ""
  );
}

describe("D12.17 Lessons Agent contract", () => {
  it("reuses the canonical deterministic project-history comparison as the caller", () => {
    expect(edge).toContain(
      'caller.rpc(\n    "screen_applicable_project_lessons"',
    );
    expect(edge).toContain("Authorization: `Bearer ${token}`");
    expect(edge).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(screening).toContain(
      "create or replace function public.screen_applicable_project_lessons",
    );
    expect(screening).toContain("from learning_events e");
    expect(screening).not.toMatch(/create table/i);
  });

  it("preserves record provenance and refuses to overstate an empty history", () => {
    expect(core).toContain("`learning_events:${lesson.id}`");
    expect(core).toContain("`development_cases:${lesson.sourceCaseId}`");
    expect(core).toContain("it does not prove that no relevant lesson exists");
    expect(core).not.toMatch(/score|confidence/i);
  });

  it("is advisory-only and exposes no write or approval path", () => {
    expect(edge).toContain("advisory: true");
    expect(edge).toContain("A named human must confirm applicability");
    expect(edge).not.toMatch(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
    expect(edge).not.toMatch(/record_project_lesson|adopt_|approve_|accept_/);
  });

  it("is customer reachable and controlled by the deployment boundary", () => {
    expect(service).toContain('"develop-lessons-agent"');
    expect(panel).toContain("runLessonsAgent(caseId)");
    expect(panel).toContain("Run Lessons Agent");
    expect(deployment).toContain("develop-lessons-agent");
    expect(boundary).toContain('"develop-lessons-agent"');
    expect(config).toMatch(
      /\[functions\.develop-lessons-agent\]\s*verify_jwt = true/,
    );
  });

  it("promotes the capability only with its full reachable chain present", () => {
    expect(registerRow("D12.17")).toMatch(/^\| D12\.17 \|[^|]*\|[^|]*\| ✅/);
  });
});
