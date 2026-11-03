import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const migration = readFileSync(
  "supabase/migrations/20271107120000_maintenance_budget_forecast.sql",
  "utf8",
);
const executable = stripComments(migration);
const component = readFileSync(
  "src/components/MaintenanceBudgetForecast.tsx",
  "utf8",
);
const service = readFileSync(
  "src/services/maintenanceBudgetService.ts",
  "utf8",
);
const surface = readFileSync("src/components/ValueManagement.tsx", "utf8");

describe("E9.04 maintenance budget forecast contract", () => {
  it("writes only the canonical budget line and audits both customer doors", () => {
    expect(executable).not.toMatch(/create table/i);
    expect(executable).toContain("update public.budget_lines");
    expect(executable).toContain("insert into public.budget_lines");
    expect(executable).toContain("insert into public.audit_events");
    expect(executable).toContain("'maintenance_budget_line'");
    expect(executable).toContain("'maintenance_budget_forecast'");
    expect(executable).toContain("app.budget_line_write");
    expect(executable).toContain("expenditureAuthorized");
    expect(executable).not.toMatch(/insert into public\.approvals/i);
    expect(executable).not.toMatch(/downtime_cost_per_hour/);
    expect(executable).not.toMatch(/get_maintenance_cost_history/);
  });

  it("does not call SAP or any other external financial system", () => {
    expect(executable.toLowerCase()).not.toContain("sap");
    expect(executable.toLowerCase()).not.toContain("http");
    expect(component).toContain("or read SAP");
    expect(component).not.toMatch(/\bfetch\s*\(/);
    expect(service).not.toContain("sap");
  });

  it("keeps the forecast server-side and tenant-scoped", () => {
    expect(executable).toContain("public.app_current_org()");
    expect(executable).toContain("public.app_actor_has_verified_mfa(v_actor)");
    expect(executable).toContain("public.app_current_aal() <> 'aal2'");
    expect(executable).toContain("public.app_current_role_is_external()");
    expect(executable).toContain(
      "'admin', 'executive', 'maintenance_manager', 'reliability_engineer', 'planner'",
    );
    expect(executable).not.toContain("'ai_admin'");
    expect(executable).toContain("assumption_key = 'labour_rate'");
    expect(executable).toContain("w.labor_hours");
    expect(executable).not.toContain("w.actual_hours");
    expect(executable).toContain("materials.unit_cost_usd");
    expect(executable).toContain("Absence is not zero");
    expect(service).not.toContain("p_forecast");
    expect(component).not.toContain("forecast:");
  });

  it("revokes direct writes and anonymous execution", () => {
    expect(executable).toContain(
      "revoke insert, update, delete, truncate on table public.budget_lines",
    );
    expect(executable).toContain(
      "revoke all on function public.record_maintenance_budget_line(",
    );
    expect(executable).toContain(
      "revoke all on function public.refresh_maintenance_budget_forecast(int, text, uuid, int)",
    );
    expect(executable).toContain(
      "revoke all on function public.evaluate_maintenance_budget_forecast(int, text, uuid)",
    );
    expect(executable).toContain("to authenticated");
    expect(executable).toContain("before truncate on public.budget_lines");
  });

  it("is reached from the existing value surface", () => {
    expect(surface).toContain("<MaintenanceBudgetForecast />");
    expect(service).toContain('"record_maintenance_budget_line"');
    expect(service).toContain('"refresh_maintenance_budget_forecast"');
    expect(service).toContain('"get_maintenance_budget_workspace"');
  });
});
