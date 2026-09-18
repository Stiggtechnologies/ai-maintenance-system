import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219131000_daily_ops_maintenance_control.sql",
  "utf8",
);
const surface = readFileSync(
  "src/components/DailyCoordinationControl.tsx",
  "utf8",
);
const host = readFileSync("src/pages/HandoverPage.tsx", "utf8");
const workflows = [
  "open_daily_coordination_meeting",
  "attest_daily_coordination_attendance",
  "record_daily_coordination_disposition",
  "complete_daily_coordination_meeting",
  "get_daily_coordination_control",
];

describe("daily operations-maintenance control contract", () => {
  it("assembles the agenda from canonical operating sources", () => {
    for (const source of [
      "process_events",
      "work_orders",
      "equipment_releases",
      "restoration_blockers",
      "operator_round_executions",
    ])
      expect(migration).toContain(`public.${source}`);
    expect(migration).toContain("immutable meeting agenda");
  });

  it("does not create a parallel task, decision, evidence, or audit store", () => {
    expect(migration).not.toContain("daily_coordination_actions");
    expect(migration).toContain(
      "work_order_id uuid references public.work_orders",
    );
    expect(migration).toContain("decision_id uuid references public.decisions");
    expect(migration).toContain("public.audit_events");
  });

  it("requires separate human operations and maintenance attendance", () => {
    expect(migration).toContain("AI may prepare the agenda but cannot %");
    expect(migration).toContain("attendance_function='operations'");
    expect(migration).toContain("attendance_function='maintenance'");
    expect(migration).toContain(
      "separate human attendance from both operations and maintenance",
    );
  });

  it("fails closed on critical items and unlinked actions", () => {
    expect(migration).toContain(
      "critical agenda items require a linked action or escalation",
    );
    expect(migration).toContain("acknowledgement alone is not closeout");
    expect(migration).toContain("canonical work order or decision");
    expect(migration).toContain(
      "critical agenda items still require linked action or escalation",
    );
  });

  it("tenant scopes persistence and closes direct writes", () => {
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("site is not in this organization");
    expect(migration).toContain("work order is not in this organization");
    expect(migration).toContain("decision is not in this organization");
    expect(migration).toContain(
      "revoke insert,update,delete on public.daily_coordination_meetings",
    );
  });

  it("exposes every workflow on the shipped handover page", () => {
    for (const workflow of workflows) {
      expect(migration).toContain(
        `grant execute on function public.${workflow}`,
      );
      expect(surface).toContain(workflow);
    }
    expect(host).toContain(
      'import { DailyCoordinationControl } from "../components/DailyCoordinationControl"',
    );
    expect(host).toContain("<DailyCoordinationControl");
  });
});
