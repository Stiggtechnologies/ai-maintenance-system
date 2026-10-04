import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102180000_primavera_p6_read_adapter.sql",
  "utf8",
);
const edge = readFileSync(
  "supabase/functions/p6-schedule-read-pull/index.ts",
  "utf8",
);
const service = readFileSync("src/services/p6ScheduleRead.ts", "utf8");
const setup = readFileSync(
  "src/components/P6ScheduleReadConnectorSetup.tsx",
  "utf8",
);
const integrations = readFileSync("src/pages/IntegrationsPage.tsx", "utf8");
const workflow = readFileSync(
  ".github/workflows/deploy-migrations.yml",
  "utf8",
);
const boundary = readFileSync("config/edge-function-boundary.json", "utf8");

describe("Primavera P6 schedule read adapter contract", () => {
  it("extends the canonical connector, schedule ingest and revision contracts", () => {
    expect(migration).toContain("public.connectors");
    expect(migration).toContain("public.connector_runs");
    expect(migration).toContain("public.ingest_schedule_batch");
    expect(migration).toContain("public.propose_schedule_import_revision");
    expect(migration).toContain("'schedule_activity'");
    expect(migration).toContain("'scheduling_read'");
    expect(migration).toContain("'manual_upload','scheduling_read'");
  });

  it("keeps P6 source-of-record access bounded, GET-only and service-attested", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("P6 schedule ingestion is service-only");
    expect(migration).toContain(
      "a named human administrator must configure or enable",
    );
    expect(migration).toContain("direction='read_only'");
    expect(migration).toContain("write_enabled=false");
    expect(migration).toContain(
      "watermark_to=(r.transport_cursor_to->>'fetched_at')::timestamptz",
    );
    expect(edge).toContain("P6_READ_ALLOWED_HOSTS");
    expect(edge).toContain("P6_READ_CREDENTIALS_JSON");
    expect(edge).toContain('method: "GET"');
    expect(edge).toContain('redirect: "error"');
    expect(edge).toContain("response.body.getReader()");
    expect(edge).toContain("MAX_TOTAL_BYTES - activities.bytes");
    expect(edge).toContain("normalizeP6PullRequest(body)");
    expect(edge).toContain("request_too_large");
    expect(edge).not.toMatch(/method:\s*["'](?:PUT|PATCH|DELETE)["']/);
  });

  it("preserves the verified human session assurance without upgrading it", () => {
    expect(edge).toContain("verifiedSessionAal(authorization)");
    expect(edge).toContain("p_actor_aal: actorAal");
    expect(migration).toContain("p_actor_aal text");
    expect(migration).toContain("p_actor_aal,'') not in ('aal1','aal2')");
    expect(migration).toContain(
      "set_config('request.jwt.claim.aal',p_actor_aal,true)",
    );
    expect(migration).toContain("'aal',p_actor_aal");
    expect(migration).not.toContain("'aal','aal2'");
  });

  it("requires explicit duration conversion and preserves human revision approval", () => {
    expect(migration).toContain("duration-to-hours multiplier");
    expect(migration).toContain("p6_schedule_read_source");
    expect(migration).toContain(
      "Changed P6 rows were retained as a pending revision",
    );
    expect(setup).toContain("P6 duration unit to hours");
    expect(setup).toContain("human revision review");
    expect(setup).toContain("P6ScheduleRevisionReview");
  });

  it("is customer-reachable and explicitly deployed", () => {
    expect(setup).toContain("Oracle Primavera P6 EPPM (read-only)");
    expect(setup).toContain("Dry-run complete pull");
    expect(service).toContain("p6-schedule-read-pull");
    expect(integrations).toContain("P6ScheduleReadConnectorSetup");
    expect(integrations).toContain("Review P6 changes");
    expect(integrations).toContain("showNoChanges");
    expect(workflow).toContain("supabase/functions/p6-schedule-read-pull/**");
    expect(workflow).toContain(
      "supabase functions deploy p6-schedule-read-pull",
    );
    expect(workflow).toContain("P6 schedule read adapter is deployed");
    expect(boundary).toContain('"p6-schedule-read-pull"');
  });
});
