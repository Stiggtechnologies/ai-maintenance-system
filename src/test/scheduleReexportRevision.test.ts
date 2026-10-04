import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101890000_schedule_reexport_revisions.sql",
  "utf8",
);
const service = readFileSync("src/services/developService.ts", "utf8");
const importer = readFileSync("src/components/ContractImport.tsx", "utf8");
const review = readFileSync(
  "src/components/P6ScheduleRevisionReview.tsx",
  "utf8",
);

describe("D5.28 governed changed-reexport revisions", () => {
  it("retains an immutable tenant-scoped proposal instead of overwriting duplicates", () => {
    expect(migration).toContain(
      "create table if not exists public.schedule_import_revisions",
    );
    expect(migration).toContain("organization_id = app_current_org()");
    expect(migration).toContain("st.status = 'duplicate'");
    expect(migration).toContain("v_run_status <> 'success'");
    expect(migration).toContain("only after every row passes");
    expect(migration).toContain("if v_fields <> '{}'::jsonb");
    expect(migration).toContain(
      "Identical replays remain ordinary duplicates and do not create revision noise",
    );
    expect(migration).toContain(
      "schedule import revisions are created and decided only through their governed RPCs",
    );
    expect(migration).toContain("old.status <> 'pending'");
    expect(migration).toContain("revoke insert, update, delete, truncate");
  });

  it("keeps evidence assembly separate from the human decision", () => {
    expect(migration).toMatch(
      /propose_schedule_import_revision[\s\S]*?'ai_admin'/,
    );
    const decisionBody = migration.slice(
      migration.indexOf(
        "create or replace function public.decide_schedule_import_revision",
      ),
    );
    expect(decisionBody).not.toMatch(
      /\('admin', 'maintenance_manager', 'reliability_engineer', 'planner', 'ai_admin'\)/,
    );
    expect(migration).toContain("enforce_awp_act_is_human(");
    expect(migration).toContain(
      "accept or reject a changed P6 schedule re-export",
    );
  });

  it("refuses stale decisions and reuses the existing P6 provenance walls", () => {
    expect(migration).toContain("sync_schedule_revision_digest(r.change_set)");
    expect(migration).toContain("is distinct from r.before_digest");
    expect(migration).toContain(
      "a stale proposal cannot overwrite newer evidence",
    );
    expect(migration).toContain(
      "set_config('app.schedule_activity_write', 'granted', true)",
    );
    expect(migration).toContain(
      "set_config('app.schedule_logic_write', 'import', true)",
    );
    expect(migration).toContain("predecessor.event_id = t.event_id");
    expect(migration).toContain("names missing or self predecessor");
    expect(migration).not.toMatch(/fetch\(|https?:\/\//i);
    expect(migration).toContain("Nothing writes back to P6");
  });

  it("is customer-reachable after the existing import run finishes", () => {
    expect(service).toContain("proposeScheduleImportRevision");
    expect(service).toContain("decideScheduleImportRevision");
    expect(importer).toContain("setCompletedScheduleRunId(runId)");
    expect(importer).toContain("P6ScheduleRevisionReview");
    expect(review).toContain("Accept reviewed revision");
    expect(review).toContain("Reject revision");
    expect(review).toContain("never writes back to P6");
  });
});
