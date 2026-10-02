import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20270101410000_degradation_library.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/degradationLibraryService.ts",
  "utf8",
);
const component = readFileSync(
  "src/components/DegradationLibraryPanel.tsx",
  "utf8",
);
const page = readFileSync("src/pages/EngineeringModelRegistryPage.tsx", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

const families = [
  "corrosion",
  "fatigue",
  "creep",
  "erosion",
  "wear",
  "embrittlement",
  "chemical",
  "concrete",
  "timber",
  "insulation_ageing",
  "battery",
  "cable",
  "semiconductor",
  "lubricant",
  "coating",
  "soil_foundation",
];

describe("U14.01 governed degradation library contract", () => {
  it("covers all sixteen required families on canonical damage mechanisms", () => {
    for (const family of families) {
      expect(migration).toContain(`'${family}'`);
    }
    expect(migration).toContain("alter table public.damage_mechanisms");
    expect(migration).toContain("degradation_family_key");
    expect(migration).toContain("references public.damage_mechanisms(id)");
    expect(migration).toContain("join public.engineering_model_mechanisms");
    expect(migration).toContain("join public.model_register");
  });

  it("keeps provenance and approval on canonical stores with no autonomous authority", () => {
    expect(migration).toContain("references public.evidence_items(id)");
    expect(migration).toContain("references public.approvals(id)");
    expect(migration).toContain("insert into public.approvals");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("operational_authorization boolean not null default false");
    expect(migration).toContain("check (not operational_authorization)");
    expect(migration).toContain("profile author cannot independently review");
    expect(migration).toContain("same-tenant verified source evidence is required");
  });

  it("denies direct mutation, service-role bypass and destructive history changes", () => {
    expect(migration).toContain(
      "revoke insert,update,delete,truncate on table public.degradation_profiles",
    );
    expect(migration).toContain("from public,anon,authenticated,service_role");
    expect(migration).toContain("degradation profile history is immutable");
    expect(migration).toContain("before truncate on public.degradation_profiles");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("is customer reachable through the model-governance workspace", () => {
    expect(service).toContain('"get_degradation_library_workspace"');
    expect(service).toContain('"propose_degradation_profile_revision"');
    expect(service).toContain('"review_degradation_profile"');
    expect(component).toContain("Governed degradation library");
    expect(component).toContain("Propose revision");
    expect(component).toContain("Independent review");
    expect(page).toContain("<DegradationLibraryPanel");
    expect(workflow).toContain("ci-degradation-library-smoke.sh");
  });
});
