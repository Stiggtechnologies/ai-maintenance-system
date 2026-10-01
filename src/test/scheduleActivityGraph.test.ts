import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101350000_schedule_activity_graph.sql",
  "utf8",
);
const service = readFileSync("src/services/developService.ts", "utf8");
const surface = readFileSync(
  "src/components/develop/ControlsPanels.tsx",
  "utf8",
);

describe("D5.28 canonical predecessor/successor graph", () => {
  it("derives both directions from the one canonical dependency store", () => {
    expect(migration).toContain(
      "create or replace function public.get_case_schedule_activity_graph",
    );
    expect(migration).toContain("from public.shutdown_task_dependencies d");
    expect(migration).toContain("d.task_key = t.task_key");
    expect(migration).toContain("d.predecessor_key = t.task_key");
    expect(migration).not.toMatch(
      /create table|insert into|update\s+public\./i,
    );
  });

  it("scopes the definer read to the caller tenant and case", () => {
    expect(migration).toContain("v_org uuid := app_current_org()");
    expect(migration).toContain("c.organization_id = v_org");
    expect(migration).toContain("e.organization_id = v_org");
    expect(migration).toContain("e.development_case_id = p_case_id");
    expect(migration).toContain(
      "revoke all on function public.get_case_schedule_activity_graph(uuid)",
    );
    expect(migration).toContain("from public, anon, service_role");
    expect(migration).toContain("to authenticated");
  });

  it("joins the graph into the existing controls object and renders both sides", () => {
    expect(service).toContain('rpc("get_case_schedule_activity_graph"');
    expect(service).toContain("predecessors: logic?.predecessors ?? []");
    expect(service).toContain("successors: logic?.successors ?? []");
    expect(surface).toContain(">Predecessors<");
    expect(surface).toContain(">Successors<");
    expect(surface).toContain("scheduleLogicLabel(a.predecessors)");
    expect(surface).toContain("scheduleLogicLabel(a.successors)");
  });
});
