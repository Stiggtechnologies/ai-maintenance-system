import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMISSIONING_STATES } from "../services/commissioningService";

const sql = readFileSync(
  "supabase/migrations/20261219150000_develop_commissioning_state_machine.sql",
  "utf8",
);
const service = readFileSync("src/services/commissioningService.ts", "utf8");
const panel = readFileSync(
  "src/components/develop/CommissioningPanel.tsx",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const smoke = readFileSync(
  "scripts/ci-develop-commissioning-state-machine-smoke.sh",
  "utf8",
);

describe("D8.07 commissioning state machine", () => {
  it("pins exactly the seven ordered §29 states", () => {
    expect(COMMISSIONING_STATES).toEqual([
      "CONSTRUCTION_COMPLETE",
      "MECHANICAL_COMPLETE",
      "READY_FOR_ENERGIZATION",
      "PRECOMMISSIONED",
      "COMMISSIONED",
      "PERFORMANCE_VERIFIED",
      "ACCEPTED",
    ]);
    for (const state of COMMISSIONING_STATES) expect(sql).toContain(state);
    expect(sql).toContain(
      "commissioning states cannot skip, regress or branch",
    );
    expect(sql).toContain("commissioning_state is null");
  });

  it("uses canonical release and energy truth without creating a rival store", () => {
    expect(sql).toContain("from equipment_releases");
    expect(sql).toContain("from asset_energy_states");
    expect(sql).toContain("commissioning_energy_types_valid");
    expect(sql).toContain(
      "asset and energy scope is frozen once READY_FOR_ENERGIZATION is recorded",
    );
    expect(sql).toContain("x.status='released' and x.isolation_confirmed");
    expect(sql).toContain("('isolated','dissipated','verified_zero')");
    expect(sql).not.toMatch(/create table[^;]*(isolation|energy_state)/i);
    expect(sql).toContain(
      "neither this read nor its writers authorize energization, operation, acceptance or handover",
    );
  });

  it("keeps every transition human, evidenced, append-only and final acceptance segregated", () => {
    expect(sql).toContain(
      "named-human commissioning transition authority required",
    );
    expect(sql).toContain("same-tenant transition evidence is required");
    expect(sql).toContain("commissioning transition history is append-only");
    expect(sql).toContain("accepted commissioning results are frozen");
    expect(sql).toContain(
      "revoke all on function public.guard_commissioning_state_update() from public,anon,authenticated",
    );
    expect(sql).toContain(
      "revoke all on function public.guard_accepted_commissioning_results() from public,anon,authenticated",
    );
    expect(sql).toContain(
      "the performance verifier cannot also record final acceptance",
    );
    expect(sql).not.toMatch(/commissioning_author_role[\s\S]{0,300}'ai_admin'/);
  });

  it("requires released canonical stage results before later states", () => {
    expect(sql).toContain("from acceptance_tests");
    expect(sql).toContain("a.release_status='released'");
    expect(sql).toContain("a.punch_items_open=0");
    expect(sql).toContain("a.test_stage='pre_commissioning'");
    expect(sql).toContain("a.test_stage='commissioning'");
    expect(sql).toContain("'performance_test','reliability_run'");
  });

  it("ships a customer write path and a clean-chain runtime transcript", () => {
    expect(service).toContain('"bind_commissioning_system_asset"');
    expect(service).toContain('"transition_commissioning_system"');
    expect(panel).toContain("Bind system assets and required energy types");
    expect(panel).toContain("Record {label(system.nextState)}");
    expect(ci).toContain("ci-develop-commissioning-state-machine-smoke.sh");
    expect(smoke).toContain('len(s["stateHistory"])==7');
    expect(smoke).toContain("direct state regression unexpectedly succeeded");
  });
});
