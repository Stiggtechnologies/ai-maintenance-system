import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const migration=readFileSync("supabase/migrations/20261219136000_restoration_time_components.sql","utf8");
const panel=readFileSync("src/components/RestorationTimeComponents.tsx","utf8");
const page=readFileSync("src/pages/ReliabilityPage.tsx","utf8");
describe("restoration time component contract",()=>{
  it("extends the canonical work membership with immutable boundaries",()=>{
    expect(migration).toContain("alter table public.restoration_event_work");
    expect(migration).toContain("execution_started_at is server-controlled and immutable");
    expect(migration).toContain("execution_completed_at is server-controlled and immutable");
    expect(migration).toContain("old.execution_status = 'in_progress'");
    expect(migration).toContain("new.execution_started_at := old.execution_started_at");
    expect(migration).not.toContain("new.execution_started_at := coalesce(old.execution_started_at, now());\n    new.execution_completed_at");
  });
  it("uses governed canonical lifecycle evidence without inferred starts",()=>{
    expect(migration).toContain("public.restoration_events");
    expect(migration).toContain("public.restoration_plan_versions");
    expect(migration).toContain("public.restoration_blockers");
    expect(migration).toContain("Historical start cannot be reconstructed");
    expect(migration).not.toContain("ew.updated_at-c.opened_at");
  });
  it("unions concurrent blockers and exposes measured component coverage",()=>{
    expect(migration).toContain("range_agg(tstzrange(");
    expect(migration).toContain("unnest(br.covered) as ranges(piece)");
    expect(migration).toContain("'sampleCount'");
    expect(migration).toContain("limit 100");
  });
  it("is tenant-bound, read-only, authenticated, and reachable",()=>{
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("'error', 'forbidden'");
    expect(migration).toContain("revoke all on function public.get_restoration_time_components(int) from public, anon");
    expect(panel).toContain('supabase.rpc("get_restoration_time_components"');
    expect(page).toContain("<RestorationTimeComponents />");
  });
});
