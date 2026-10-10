import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101780000_workforce_readiness_writer_guards.sql",
  "utf8",
).toLowerCase();

describe("workforce readiness writer guards", () => {
  it("keeps the established writers as private authoritative internals", () => {
    for (const writer of [
      "record_workforce_member",
      "record_member_competency",
      "record_shift_assignment",
    ]) {
      expect(migration).toContain(
        `rename to ${writer}_authoritative_internal`,
      );
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${writer}_authoritative_internal\\(jsonb\\)\\s+from public, anon, authenticated, service_role`,
        ),
      );
      expect(migration).toContain(`create function public.${writer}(p_payload jsonb)`);
      expect(migration).toContain(
        `return public.${writer}_authoritative_internal(p_payload)`,
      );
      expect(migration).toContain(
        `revoke all on function public.${writer}(jsonb) from public, anon`,
      );
      expect(migration).toContain(
        `grant execute on function public.${writer}(jsonb) to authenticated`,
      );
    }
  });

  it("proves an optional workforce site belongs to the current tenant", () => {
    expect(migration).toContain("s.organization_id = v_org");
    expect(migration).toContain("site not found in this organization");
    expect(migration).toContain("siteid must be a valid site identifier");
  });

  it("refuses new competency and shift evidence for inactive or foreign members", () => {
    const activeMemberGuard = /m\.id = v_member_id[\s\S]*?m\.organization_id = v_org[\s\S]*?m\.active/g;
    expect(migration.match(activeMemberGuard)).toHaveLength(2);
    expect(migration.match(/active workforce member not found in this organization/g)).toHaveLength(2);
    expect(migration.match(/for share/g)).toHaveLength(3);
  });

  it("validates employment dates without inventing either one", () => {
    expect(migration).toContain("sync_text_as_date(v_hired_text)");
    expect(migration).toContain("sync_text_as_date(v_departure_text)");
    expect(migration).toContain("expected departure cannot precede the hire date");
    expect(migration).not.toContain("current_date");
  });

  it("does not create a parallel workforce object", () => {
    expect(migration).not.toMatch(/create\s+table/i);
    expect(migration).not.toMatch(/create\s+(?:or\s+replace\s+)?view/i);
  });
});
