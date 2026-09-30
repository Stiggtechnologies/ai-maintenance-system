import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101130000_site_maintenance_handover.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/shiftHandoverService.ts", "utf8");
const panel = readFileSync(
  "src/components/ShiftHandoverAgentPanel.tsx",
  "utf8",
);
const briefing = readFileSync("src/pages/OperationalBriefing.tsx", "utf8");
const workforce = readFileSync("src/pages/AIWorkforcePage.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-site-maintenance-handover-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("governed Site Maintenance Manager shift handover", () => {
  it("reuses canonical agent and operating stores", () => {
    expect(migration).toContain("where key='maintenance_operations'");
    expect(migration).toContain("insert into public.agent_runs");
    expect(migration).toContain(
      "create table if not exists public.shift_handover_packs",
    );
    for (const source of [
      "public.work_orders",
      "public.process_events",
      "public.equipment_releases",
      "public.work_order_materials",
      "public.restoration_blockers",
      "public.operator_round_executions",
      "public.daily_coordination_meetings",
    ])
      expect(migration).toContain(source);
    expect(migration).not.toContain("create table if not exists site_actions");
  });

  it("has explicit role, tenant and per-agent control gates", () => {
    expect(migration).toContain("run_site_maintenance_manager_agent");
    expect(migration).toContain("requires a named maintenance manager");
    expect(migration).toContain("where id=p_site_id and organization_id=v_org");
    expect(migration).toContain("generate_meeting_packs");
    expect(migration).toContain("generate_shift_handover_pack");
    expect(migration).toContain("site maintenance manager agent refused");
    expect(migration).toContain("history.agent_id=r.agent_id");
  });

  it("freezes evidence and requires a different named human receipt", () => {
    expect(migration).toContain(
      "shift handover packs are retained governance records",
    );
    expect(migration).toContain("new.acknowledged_by=old.created_by");
    expect(migration).toContain(
      "incoming-shift acknowledgement must come from a different named human",
    );
    expect(migration).toContain("source_state_changed',false");
    expect(migration).toContain(
      "receipt only; no work, risk, schedule, custody or return-to-service state changed",
    );
  });

  it("grants no execution or approval authority", () => {
    for (const boundary of [
      "'may_assign_work',false",
      "'may_close_work',false",
      "'may_release_schedule',false",
      "'may_change_equipment_custody',false",
      "'may_accept_risk',false",
      "'may_commit_spend',false",
      "'may_return_to_service',false",
    ])
      expect(migration).toContain(boundary);
    expect(migration).toContain(
      "empty section means no matching record was found",
    );
  });

  it("is reachable on the shift ritual and visible in AI Workforce", () => {
    expect(service).toContain('"run_site_maintenance_manager_agent"');
    expect(service).toContain('"acknowledge_shift_handover_pack"');
    expect(panel).toContain("Governed Site Maintenance Manager agent");
    expect(panel).toContain("Different-person acknowledgement");
    expect(briefing).toContain("<ShiftHandoverAgentPanel />");
    expect(workforce).toContain('"/briefing": "shift handovers"');
  });

  it("keeps a runtime proof in the full migration-chain gate", () => {
    expect(smoke).toContain("exact_sources=true");
    expect(smoke).toContain("tenant_wall=true");
    expect(smoke).toContain("immutable_pack=true");
    expect(smoke).toContain("different_human_ack=true");
    expect(smoke).toContain("no_execution_authority=true");
    expect(workflow).toContain(
      "bash scripts/ci-site-maintenance-handover-smoke.sh",
    );
  });

  it("advances exactly the completed register claims", () => {
    for (const id of ["C1.02", "C5.09"]) {
      expect(register).toMatch(
        new RegExp(
          `\\| ${id.replace(".", "\\.")} \\|[^\\n]+\\| ✅[^\\n]+`,
          "i",
        ),
      );
    }
  });
});
