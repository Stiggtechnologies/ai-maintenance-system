import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101180000_shutdown_turnaround_agent.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/turnaroundAgentService.ts", "utf8");
const panel = readFileSync(
  "src/components/ShutdownTurnaroundAgentWorkbench.tsx",
  "utf8",
);
const parent = readFileSync("src/pages/TurnaroundsPage.tsx", "utf8");
const smoke = readFileSync("scripts/ci-shutdown-turnaround-agent-smoke.sh", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("governed Shutdown / Turnaround Specialist execution", () => {
  it("reuses the canonical outage scope, schedule graph and shared agent spine", () => {
    for (const source of [
      "public.outage_windows",
      "public.outage_work",
      "public.work_orders",
      "public.shutdown_events",
      "public.shutdown_tasks",
      "public.shutdown_task_dependencies",
      "insert into public.agent_runs",
    ]) expect(migration).toContain(source);
    expect(migration).toContain("add column if not exists shutdown_event_id");
    expect(migration).toContain("add column if not exists outage_work_id");
    expect(migration).not.toContain("create table if not exists public.turnaround_work");
    expect(migration).not.toContain("create table if not exists public.turnaround_schedule");
  });

  it("provides governed human acts for scope, schedule, late work and release", () => {
    for (const rpc of [
      "public.add_work_to_outage",
      "public.freeze_outage_scope",
      "public.create_turnaround_schedule",
      "public.link_outage_shutdown_schedule",
      "public.record_turnaround_schedule_activity",
      "public.link_turnaround_task_to_work",
      "public.record_turnaround_task_dependency",
      "public.release_turnaround_scope",
    ]) expect(migration).toContain(`function ${rpc}`);
    expect(migration).toContain("release_invalidated");
    expect(migration).toContain("segregation of duties requires release");
    expect(migration).toContain("readiness blockers cannot be waived");
  });

  it("makes readiness fail closed across scope, sequence, material, approval and safety", () => {
    expect(migration).toContain("function public.evaluate_turnaround_readiness");
    for (const field of [
      "'unsized'",
      "'scopewithouttask'",
      "'taskswithoutdates'",
      "'cycledetected'",
      "'materialblockedwork'",
      "'approvalblockedwork'",
      "'safetyblockedwork'",
      "'releaseready'",
    ]) expect(migration).toContain(field);
    expect(migration).toContain("missing evidence is a blocker, never a pass");
  });

  it("keeps the specialist advisory and every consequential act human-owned", () => {
    for (const control of [
      "'mayaddwork',false",
      "'mayfreezescope',false",
      "'mayreleasescope',false",
      "'mayrewriteschedule',false",
      "'maywaiveblocker',false",
      "'maystartexecution',false",
      "'mayreturntoservice',false",
    ]) expect(migration).toContain(control);
    expect(migration).toContain(
      "review owner must be a named human member of this organization",
    );
  });

  it("enforces tenant boundaries, immutable packs and durable receipts", () => {
    expect(migration).toContain("where id=p_window_id and organization_id=v_org");
    expect(migration).toContain("agent run names an outage outside its organization");
    expect(migration).toContain("turnaround readiness packs and review assignments are append-only");
    expect(migration).toContain("analyse_turnaround_readiness");
    expect(service).toContain("without a durable pack/run receipt");
  });

  it("is fully operable from the canonical turnaround route", () => {
    for (const rpc of [
      '"run_turnaround_agent"',
      '"freeze_outage_scope"',
      '"release_turnaround_scope"',
      '"record_turnaround_schedule_activity"',
      '"record_turnaround_task_dependency"',
      '"assign_turnaround_review"',
    ]) expect(service).toContain(rpc);
    expect(panel).toContain("Run retained assessment");
    expect(panel).toContain("Freeze scope");
    expect(panel).toContain("Release controlled execution");
    expect(panel).toContain("setPackId(receipt.packId)");
    expect(parent).toContain("<ShutdownTurnaroundAgentWorkbench");
  });

  it("keeps runtime proof in the clean migration gate and closes C1.09", () => {
    for (const proof of [
      "canonical_scope_graph=true",
      "late_work_invalidates_release=true",
      "sod_release=true",
      "readiness_fail_closed=true",
      "tenant_wall=true",
      "immutable_pack=true",
      "named_review=true",
      "no_agent_execution_authority=true",
    ]) expect(smoke).toContain(proof);
    expect(workflow).toContain("bash scripts/ci-shutdown-turnaround-agent-smoke.sh");
    expect(register).toMatch(/\| C1\.09 \|[^\n]+\| ✅[^\n]+/i);
  });
});
