import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219153000_develop_design_origin_readiness.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/developService.ts", "utf8");
const panel = readFileSync(
  "src/components/develop/ReadinessPanels.tsx",
  "utf8",
);
const smoke = readFileSync(
  "scripts/ci-develop-design-origin-readiness-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("D8.10 operational readiness begins during design", () => {
  it("connects canonical requirements to canonical readiness without another status store", () => {
    expect(migration).toContain(
      "references public.design_requirements(id)",
    );
    expect(migration).toContain(
      "references public.onboarding_requirements(key)",
    );
    expect(migration).toContain(
      "references public.commissioning_system_readiness_scope(id)",
    );
    expect(migration).toContain("readinessstore','asset_onboarding_items'");
    expect(migration).toContain("acceptancestore','system_handover_packages'");
    expect(migration).not.toMatch(/create table[^;]+readiness[^;]+status text/is);
  });

  it("requires an explicit human mapping and never guesses requirement categories", () => {
    expect(migration).toContain(
      "record_system_readiness_design_origin",
    );
    expect(migration).toContain(
      "select a catalog item in one of the thirteen operational-readiness categories",
    );
    expect(migration).toContain("not public.commissioning_author_role(v_role)");
    expect(migration).toContain("p.role<>'ai_admin'");
    expect(migration).toContain("same-tenant mapping evidence is required");
    expect(smoke).toContain("s14_critical_spares");
    expect(smoke).toContain("s14_reorder_points");
    expect(smoke).toContain("requirement_key='s14_reorder_points'");
  });

  it("records design intent before assets and generates open items when assets bind", () => {
    expect(migration).toContain(
      "materialize_readiness_origins_for_bound_asset",
    );
    expect(migration).toContain(
      "after insert on public.commissioning_system_assets",
    );
    expect(migration).toContain(
      "insert into public.asset_onboarding_items(organization_id,asset_id,requirement_key)",
    );
    expect(migration).not.toMatch(
      /insert into public\.asset_onboarding_items\([^)]*status/i,
    );
    expect(smoke).toContain('x["status"]=="awaiting_assets"');
    expect(smoke).toContain("status='pending'");
  });

  it("enforces tenant/case/project scope and immutable provenance", () => {
    expect(migration).toContain(
      "must share one tenant, case, and project",
    );
    expect(migration).toContain(
      "design-origin readiness provenance is append-only",
    );
    expect(migration).toContain(
      "generated design-origin readiness links are append-only",
    );
    expect(migration).toContain(
      "accepted system readiness provenance is frozen",
    );
    expect(migration).toContain(
      "design-origin readiness provenance requires the governed human workflow",
    );
    expect(migration).toContain(
      "generated design-origin readiness links require the canonical materializer",
    );
    expect(migration).toContain("enable row level security");
    expect(migration).toContain(
      "organization_id=public.app_current_org()",
    );
  });

  it("surfaces the chain to customers and into the governed handover readiness", () => {
    expect(service).toContain(
      '"record_system_readiness_design_origin"',
    );
    expect(service).toContain(
      '"get_case_system_readiness_design_origins"',
    );
    expect(service).toContain('.from("onboarding_requirements")');
    expect(panel).toContain("Start readiness from a design requirement");
    expect(panel).toContain("Create canonical readiness items");
    expect(panel).toContain("awaiting bound assets");
    expect(smoke).toContain("get_system_handover_readiness");
    expect(workflow).toContain(
      "ci-develop-design-origin-readiness-smoke.sh",
    );
  });
});
