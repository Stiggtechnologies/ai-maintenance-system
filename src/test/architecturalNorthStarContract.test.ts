import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261220080000_develop_architectural_north_star.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/architecturalNorthStarService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/develop/ArchitecturalNorthStarPanel.tsx",
  "utf8",
);
const page = readFileSync("src/pages/DevelopmentCaseWorkspacePage.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-architectural-north-star-smoke.sh",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

describe("D11.36 architectural north-star traversal", () => {
  it("reads every §86 leg from canonical stores", () => {
    for (const home of [
      "risk_objectives",
      "design_requirements",
      "risks",
      "decisions",
      "thread_objects",
      "work_packages",
      "development_case_assets",
      "work_orders",
      "learning_events",
    ]) {
      expect(sql).toContain(`public.${home}`);
    }
    expect(sql).toContain("public.sync_spec34_edges()");
    expect(
      [...sql.matchAll(/create table if not exists public\.([a-z_]+)/gi)].map(
        (match) => match[1],
      ),
    ).toEqual(["decision_learning_event_links"]);
  });

  it("names all eleven legs and refuses completion over any gap", () => {
    for (const key of [
      "objective",
      "requirement",
      "risk_opportunity",
      "decision",
      "design",
      "project_work",
      "asset",
      "operation",
      "outcome",
      "learning",
      "next_decision",
    ]) {
      expect(sql).toContain(`'key','${key}'`);
    }
    expect(sql).toContain("v_complete:=jsonb_array_length(v_gaps)=0");
  });

  it("makes outcome-to-learning-to-next-decision immutable, evidenced, tenant-safe, and human-owned", () => {
    expect(sql).toContain("decision_learning_event_links");
    expect(sql).toContain(
      "same-tenant evidence independently verified by someone other than the recorder",
    );
    expect(sql).toContain("o.project_outcome_evidence_id<>e.id");
    expect(sql).toContain("d.created_at < l.created_at");
    expect(sql).toContain("d.development_case_id=new.development_case_id");
    expect(sql).toContain("d.created_at>=l.created_at");
    expect(sql).toContain("requires an authorized named human");
    expect(sql).toContain(
      "retained as decision provenance and cannot be deleted directly",
    );
    expect(sql).toContain("operationalAuthorization',false");
  });

  it("is reachable in the Case Workspace and preserves the authority boundary", () => {
    expect(service).toContain('"get_case_architectural_north_star"');
    expect(service).toContain('"link_case_learning_to_next_decision"');
    expect(panel).toContain("Architectural north star (§86)");
    expect(panel).toContain("Link learning to next decision");
    expect(page).toContain("<ArchitecturalNorthStarPanel");
    expect(sql).toContain(
      "Every authority-bearing decision remains a named-human act",
    );
  });

  it("runs a clean-chain transcript over all eleven legs and their refusal controls", () => {
    expect(smoke).toContain("eleven_legs=true");
    expect(smoke).toContain("incomplete_refused=true");
    expect(smoke).toContain("candidate_time_filter=true");
    expect(smoke).toContain("independent_evidence=true");
    expect(smoke).toContain("tenant_wall=true");
    expect(smoke).toContain("named_human=true");
    expect(ci).toContain("bash scripts/ci-architectural-north-star-smoke.sh");
  });
});
