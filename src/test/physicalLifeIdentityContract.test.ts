import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271108120000_physical_life_identity.sql",
  "utf8",
);
const smoke = readFileSync("scripts/ci-survival-covariate-smoke.sh", "utf8");

describe("C7.14 physical-life identity", () => {
  it("extends the canonical life event instead of creating another store", () => {
    expect(migration).toContain("alter table public.component_life_events");
    expect(migration).toContain("add column if not exists physical_life_ref");
    expect(migration).not.toMatch(/create table/i);
  });

  it("keeps the legacy exposure refusal and adds a tenant-unique identity", () => {
    expect(migration).toContain("where physical_life_ref is null");
    expect(migration).toContain(
      "on public.component_life_events (organization_id, physical_life_ref)",
    );
    expect(migration).toContain(
      "this component life event is already recorded",
    );
    expect(migration).toContain(
      "this physical life is already recorded with different source facts",
    );
    expect(migration).toContain("'action', 'replayed'");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("v_org uuid := public.app_current_org()");
    expect(migration).toContain("organization_id = v_org");
  });

  it("freezes the captured identity and binds an included life reference to it", () => {
    expect(migration).toContain("Physical life identity is fixed at capture");
    expect(migration).toContain(
      "Included life reference must equal the physical life identity captured with this event",
    );
    expect(migration).toContain("'physicalLifeRef', cle.physical_life_ref");
    expect(migration).toContain("no partial population is returned");
  });

  it("revokes anonymous execution and does not grant the source wrapper to customers", () => {
    expect(migration).toContain(
      "revoke all on function public.record_component_life_event(",
    );
    expect(migration).toContain("from public, anon");
    expect(migration).toContain(
      "grant execute on function public.record_component_life_event(",
    );
    expect(migration).toContain("to authenticated");
    expect(migration).toContain(
      "revoke all on function public.get_survival_source_internal(uuid, uuid, text)",
    );
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain(
      "grant execute on function public.get_survival_source_internal(uuid, uuid, text)",
    );
    expect(migration).toContain("to service_role");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
  });

  it("keeps the runtime witness for legacy refusal, identified ingestion, replay and conflict", () => {
    for (const marker of [
      "legacy_same_exposure_life_ingestion=false",
      "physical_life_identity_ingestion=true",
      "same_source_retry_idempotent=true",
      "duplicate_physical_life_refused=true",
      "predictive_qualification=false",
      "operational_authority=false",
      "synthetic-life-a",
      "synthetic-life-b",
    ]) {
      expect(smoke).toContain(marker);
    }
  });
});
