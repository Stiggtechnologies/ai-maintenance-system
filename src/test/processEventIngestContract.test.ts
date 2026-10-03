import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INGEST_ENTITIES, INGEST_ENTITY_ORDER } from "../lib/ingest-entities";

const migration = readFileSync(
  "supabase/migrations/20270102040000_process_event_ingest.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/reliabilityCallers.ts", "utf8");
const surface = readFileSync("src/components/AssetOperatingDuty.tsx", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("C2.04 governed process-event contract", () => {
  it("reuses the canonical process_events table and keeps condition alerts separate", () => {
    expect(migration).not.toContain("create table process_events");
    expect(migration).toContain("insert into process_events");
    expect(migration).not.toMatch(/insert\s+into\s+condition_alerts/);
    expect(migration).not.toMatch(/update\s+condition_alerts/);
    expect(migration).toContain("never condition_alerts");
  });

  it("is replay-safe, tenant-bound and router-only", () => {
    expect(migration).toContain("idx_process_events_external");
    expect(migration).toContain("organization_id = v_org");
    expect(migration).toContain("status, reject_reason");
    expect(migration).toContain("v_dup := v_dup + 1");
    expect(migration).toContain(
      "revoke all on function public.ingest_process_event_batch(uuid, jsonb)",
    );
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("ingest_process_event_batch(p_run_id, p_rows)");
  });

  it("validates event vocabulary, timestamp provenance and known assets", () => {
    for (const eventType of [
      "alarm",
      "trip",
      "interlock",
      "excursion",
      "start",
      "stop",
    ]) {
      expect(INGEST_ENTITIES.process_event.columns.find(
        (column) => column.name === "event_type",
      )?.oneOf).toContain(eventType);
    }
    expect(migration).toContain("explicit utc offset");
    expect(migration).toContain("more than one hour in the future");
    expect(migration).toContain("asset_name");
    expect(migration).toContain("is ambiguous");
  });

  it("is reachable from the customer import door and per-asset reader", () => {
    expect(INGEST_ENTITY_ORDER).toContain("process_event");
    expect(INGEST_ENTITIES.process_event.handler).toBe(
      "ingest_process_event_batch",
    );
    expect(service).toContain("get_process_event_context");
    expect(surface).toContain("getProcessEventContext(assetId, windowDays)");
    expect(surface).toContain("not predictive condition alerts");
    expect(workflow).toContain("ci-process-event-ingest-smoke.sh");
  });

  it("does not claim alarm-control authority", () => {
    expect(INGEST_ENTITIES.process_event.caution).toMatch(
      /never acknowledges, suppresses or resets/i,
    );
    expect(migration).toContain("cannot acknowledge or suppress alarms");
  });
});
