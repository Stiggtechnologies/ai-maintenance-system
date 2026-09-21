import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261220060000_sync_information_readiness_integration.sql",
  "utf8",
);
const panel = readFileSync(
  "src/components/develop/EventBusPanels.tsx",
  "utf8",
);
const slice5dSmoke = readFileSync(
  "scripts/ci-develop-slice5d-smoke.sh",
  "utf8",
);

describe("D11.09 Sync Information readiness integration", () => {
  it("composes the canonical §47 read rather than recalculating readiness", () => {
    expect(migration).toContain(
      "v_readiness := get_case_information_readiness_index(c.id)",
    );
    expect(migration).toContain("'project', v_readiness -> 'project'");
    expect(migration).toContain("'systems', v_readiness -> 'systems'");
    expect(migration).toContain("'hardBlockers', v_readiness -> 'hardBlockers'");
    expect(migration).not.toMatch(/100\.0\s*\*/);
    expect(migration).not.toMatch(/create table/i);
  });

  it("does not invent a composite score or hide remaining graph gaps", () => {
    expect(migration).not.toMatch(/'score'/);
    expect(migration).toContain("'complete', v_absent_edges = 0");
    expect(migration).toContain("sync_spec34_absent_edge_audit()");
    expect(migration).toContain("newlyClosableCount");
  });

  it("preserves the decision boundary and renders the readiness position", () => {
    expect(migration).toContain("'decisionBoundary', v_readiness");
    expect(migration).toContain("grants no handover");
    expect(panel).toContain("leg.project.status");
    expect(panel).toContain("hard blocker(s)");
    expect(panel).toContain("legs.assetDataReadiness?.decisionBoundary");
  });

  it("keeps the composed-module smoke on the new built=true contract", () => {
    expect(slice5dSmoke).toContain(
      "x['legs']['assetDataReadiness']['built']\")\" = \"True\"",
    );
    expect(slice5dSmoke).not.toContain(
      "x['legs']['assetDataReadiness']['built']\")\" = \"False\"",
    );
    expect(slice5dSmoke).toContain(
      "readiness is composed but the engine still claims it is not computed",
    );
    expect(slice5dSmoke).toContain('field complete)" = "False"');
    expect(slice5dSmoke).toContain("No composite score");
    expect(slice5dSmoke).toContain("2 of §34");
    expect(slice5dSmoke).toContain("the composed module produced a score");
  });
});
