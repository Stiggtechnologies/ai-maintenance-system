/**
 * Sync Develop residual cluster (D9.12 / D9.14 / D9.16 / D9.01) —
 * migration contract (static, no database).
 *
 * Live behaviour is the RPCs. This file pins the CONTRACT so a later edit
 * that forks a store, invents a VR percentage without a baseline, or
 * matches every lesson on the word "project" fails CI.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LESSON_SCREEN_STOPWORDS,
  PROJECT_SUCCESS_DIMENSIONS,
} from "../lib/develop/realize";
import { stripComments } from "./support/migrationPolicies";

const FILE = "20261219090000_develop_realize_residual_cluster.sql";
const sql = stripComments(readFileSync(`supabase/migrations/${FILE}`, "utf8"));
const lower = sql.toLowerCase();
const developRegister = readFileSync("docs/sync-develop/register.md", "utf8");
const intake = readFileSync("src/pages/DevelopIntakePage.tsx", "utf8");
const workspace = readFileSync(
  "src/pages/DevelopmentCaseWorkspacePage.tsx",
  "utf8",
);
const panels = readFileSync("src/components/develop/RealizePanels.tsx", "utf8");
const service = readFileSync("src/services/developService.ts", "utf8");

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const next = sql.indexOf("create or replace function public.", start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

const row = (id: string) => {
  const line = developRegister
    .split("\n")
    .find((candidate) => candidate.startsWith(`| ${id} `));
  expect(line, id).toBeTruthy();
  return line!;
};

describe("no parallel stores", () => {
  it("creates no lesson / vr / success / phase / leakage table", () => {
    expect(lower).not.toMatch(
      /create table[^;]*(lesson|value_realiz|success_score|lifecycle_success|leakage)/,
    );
  });

  it("lessons stay on learning_events; VR stays on value_metrics + development_baselines", () => {
    expect(functionBody("screen_applicable_project_lessons")).toContain(
      "learning_events",
    );
    expect(functionBody("get_case_value_realization")).toContain(
      "development_baselines",
    );
    expect(functionBody("get_case_value_realization")).toContain(
      "value_metrics",
    );
    expect(functionBody("approve_case_baseline")).toContain(
      "sync_benefits_denominator_snapshot",
    );
  });
});

describe("vocabularies pinned to src/lib/develop/realize.ts", () => {
  it("stopwords match LESSON_SCREEN_STOPWORDS", () => {
    const body = functionBody("sync_lesson_screen_stopwords");
    for (const word of LESSON_SCREEN_STOPWORDS) {
      expect(body).toContain(`'${word}'`);
    }
    expect(body).not.toContain("'crusher'");
  });

  it("eight §55 dimensions match PROJECT_SUCCESS_DIMENSIONS", () => {
    const body = functionBody("sync_project_success_dimensions");
    expect(PROJECT_SUCCESS_DIMENSIONS).toHaveLength(8);
    for (const key of PROJECT_SUCCESS_DIMENSIONS) {
      expect(body).toContain(`'${key}'`);
    }
  });
});

describe("D9.12 — deterministic screen, no LLM, no self-match", () => {
  it("a case is never screened against its own lessons", () => {
    const body = functionBody("sync_lesson_applies_to_case");
    expect(body).toContain("p_lesson_case_id = p_case_id");
    expect(body).toContain("return false");
  });

  it("intake calls the screen after create", () => {
    expect(intake).toContain("screenApplicableProjectLessons");
    expect(intake).toContain("createDevelopmentCase");
    expect(service).toContain("screen_applicable_project_lessons");
  });

  it("the workspace banner is a live caller", () => {
    expect(workspace).toContain("ApplicableLessonsBanner");
    expect(panels).toContain("screenApplicableProjectLessons");
  });
});

describe("D9.14 — no fabricated VR percentage", () => {
  it("refuses without an approved BENEFITS baseline", () => {
    const body = functionBody("get_case_value_realization");
    expect(body).toContain("no_approved_benefits_baseline");
    expect(body).toContain("register standing constraint 3");
    expect(body).toContain("mixed_units");
    expect(body).toContain("zero_denominator");
    expect(body).toContain("Unverified benefits are omitted");
  });

  it("the snapshot rides the existing human approval act", () => {
    const body = functionBody("approve_case_baseline");
    expect(body).toContain("BENEFITS");
    expect(body).toContain("app.baseline_write");
    expect(body).toContain(
      "the AI-operator identity cannot record one",
    );
    expect(body).toContain(
      "'admin','executive','maintenance_manager','reliability_engineer'",
    );
  });
});

describe("D9.16 / D9.01 — eight dimensions, on-budget-but-unreliable fails", () => {
  it("the success object walks all eight slots", () => {
    const body = functionBody("get_case_project_success");
    expect(body).toContain("sync_project_success_dimensions");
    expect(body).toContain("Missing is displayed, not zeroed");
    expect(body).toContain("On-time and on-budget alone are not success");
  });

  it("lifecycle success uses framework stages and names case-level cost/RAM", () => {
    const body = functionBody("get_case_lifecycle_success");
    expect(body).toContain("project_framework_stages");
    expect(body).toContain("onBudgetUnreliable");
    expect(body).toContain("case-level");
    expect(body).toContain("no governing framework");
  });

  it("panels render the server rows", () => {
    expect(panels).toContain("getCaseValueRealization");
    expect(panels).toContain("getCaseProjectSuccess");
    expect(panels).toContain("getCaseLifecycleSuccess");
  });
});

describe("tenancy walls", () => {
  it("every new SECURITY DEFINER function revokes from public and anon", () => {
    for (const name of [
      "screen_applicable_project_lessons",
      "get_case_value_realization",
      "get_case_project_success",
      "get_case_lifecycle_success",
      "sync_case_success_dimensions",
      "approve_case_baseline",
    ]) {
      expect(lower).toMatch(
        new RegExp(
          `revoke (all|execute) on function public\\.${name}\\([^)]*\\) from public, anon`,
        ),
      );
      expect(functionBody(name)).toContain("app_current_org()");
    }
  });
});

describe("register flips only the rows this cluster closed", () => {
  it("D9.12 / D9.14 / D9.16 / D9.01 are ✅ with walkable citations", () => {
    expect(row("D9.12")).toMatch(/^\| D9\.12 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D9.12")).toContain("`screenApplicableProjectLessons`");
    expect(row("D9.12")).toContain("`DevelopIntakePage`");
    expect(row("D9.12")).toContain("`ApplicableLessonsBanner`");

    expect(row("D9.14")).toMatch(/^\| D9\.14 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D9.14")).toContain("`getCaseValueRealization`");
    expect(row("D9.14")).toContain("`approveCaseBaseline`");
    expect(row("D9.14")).toContain("`ValueRealizationSection`");

    expect(row("D9.16")).toMatch(/^\| D9\.16 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D9.16")).toContain("`getCaseProjectSuccess`");
    expect(row("D9.16")).toContain("`ProjectSuccessSection`");
    expect(row("D9.16")).toContain("`PROJECT_SUCCESS_DIMENSIONS`");

    expect(row("D9.01")).toMatch(/^\| D9\.01 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D9.01")).toContain("`getCaseLifecycleSuccess`");
    expect(row("D9.01")).toContain("`LifecycleSuccessSection`");
  });

  it("does not paper-close leftovers this slice did not ship", () => {
    expect(row("D9.05")).toMatch(/^\| D9\.05 \|[^|]*\|[^|]*\| 🟡/);
    expect(row("D9.06")).toMatch(/^\| D9\.06 \|[^|]*\|[^|]*\| 🟡/);
    expect(row("D9.07")).toMatch(/^\| D9\.07 \|[^|]*\|[^|]*\| ❌/);
    expect(row("D9.09")).toMatch(/^\| D9\.09 \|[^|]*\|[^|]*\| ❌/);
    expect(row("D9.15")).toMatch(/^\| D9\.15 \|[^|]*\|[^|]*\| ❌/);
    expect(row("D3.02")).toMatch(/^\| D3\.02 \|[^|]*\|[^|]*\| 🟡/);
    expect(row("D11.27")).toMatch(/^\| D11\.27 \|[^|]*\|[^|]*\| 🟡/);
    expect(row("D1.03")).toMatch(/^\| D1\.03 \|[^|]*\|[^|]*\| ❌/);
  });
});
