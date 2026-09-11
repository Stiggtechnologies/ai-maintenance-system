import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20261219132000_failure_mode_elimination_rate.sql",
  "utf8",
);
const panel = readFileSync("src/components/FailureModeElimination.tsx", "utf8");
const page = readFileSync("src/pages/ReliabilityPage.tsx", "utf8");

describe("failure-mode elimination contract", () => {
  it("uses the canonical coded mechanism and CA verification lifecycle", () => {
    expect(migration).toContain("public.ca_verifications");
    expect(migration).toContain("wo.failure_mechanism_id");
    expect(migration).toContain("public.damage_mechanisms");
    expect(migration).not.toMatch(/create table/i);
  });

  it("withholds credit from open, ineffective, recurrent, and uncoded work", () => {
    expect(migration).toContain("c.effectiveness = 'effective'");
    expect(migration).toContain("not c.later_recurrence");
    expect(migration).toContain("then 'recurrent'");
    expect(migration).toContain("wo.failure_mechanism_id is null");
    expect(migration).toContain("uncodedVerificationsExcluded");
    expect(migration).toContain("'targetsReturned', least(totals.targeted, 100)");
    expect(migration).toContain("limit 100");
  });

  it("keeps the reader tenant-bound and authenticated", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("'error', 'forbidden'");
    expect(migration).toContain(
      "revoke all on function public.get_failure_mode_elimination_rate() from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.get_failure_mode_elimination_rate() to authenticated",
    );
  });

  it("prevents direct clients from forging verification outcomes", () => {
    expect(migration).toContain(
      "create policy ca_verifications_read on public.ca_verifications",
    );
    expect(migration).toContain("for select to authenticated");
    expect(migration).toContain(
      "revoke insert, update, delete, truncate on public.ca_verifications from anon, authenticated",
    );
    expect(migration).not.toMatch(
      /create policy ca_verifications_read[\s\S]*?for all to authenticated/,
    );
  });

  it("is reachable from the Reliability product surface with its caveat visible", () => {
    expect(panel).toContain('"get_failure_mode_elimination_rate"');
    expect(panel).toContain(
      "a raw source label is not treated as a failure mechanism",
    );
    expect(page).toContain("<FailureModeElimination />");
  });
});
