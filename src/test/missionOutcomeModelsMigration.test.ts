import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261219210000_mission_outcome_models.sql",
  "utf8",
).toLowerCase();
const page = readFileSync("src/pages/DecisionGovernance.tsx", "utf8");

describe("U1.01 governed mission/outcome models", () => {
  it("provides every required organization type", () => {
    for (const type of [
      "utility",
      "water",
      "rail",
      "airline",
      "hospital",
      "municipality",
      "data_centre",
      "mining",
      "manufacturing",
      "defence",
      "property",
      "telecom",
    ]) {
      expect(sql).toContain(`('${type}'`);
    }
  });

  it("keeps templates advisory and adoption organization-owned", () => {
    expect(sql).toContain("template defaults are not authority");
    expect(sql).toContain("organization_id=public.app_current_org()");
    expect(sql).toContain("only the latest independently adopted tenant model is effective");
    expect(sql).toContain("status='superseded'");
    expect(sql).toContain("references public.approvals");
    expect(sql).not.toContain("create table public.mission_outcome_approvals");
  });

  it("enforces evidence, independence, human authority and honest outcomes", () => {
    expect(sql).toContain("the author may not approve or reject their own");
    expect(sql).toContain("ai may prepare a mission model but may not adopt");
    expect(sql).toContain("app_has_approval_authority()");
    expect(sql).toContain("state the organization evidence basis");
    expect(sql).toContain("separate governed evidence is required to claim performance");
    expect(sql).toContain("insert into public.audit_events");
    expect(sql).toContain("approvals_mission_outcome_sensitive");
  });

  it("is wired into the governance workspace", () => {
    expect(page).toContain("<MissionOutcomeModels />");
  });
});
