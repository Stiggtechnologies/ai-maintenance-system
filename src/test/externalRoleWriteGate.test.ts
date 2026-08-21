/**
 * The assessment sponsor is a CUSTOMER identity inside an OPERATING tenant, and
 * this repository's write model is a deny-list.
 *
 * THE DEFECT THIS FILE EXISTS FOR. The org_rw policies from
 * 00000000000001:485 are `for all to authenticated` with an organization
 * predicate and nothing else. The only role-aware write gate in the chain,
 * 20260912123000, names 'board' and 'supervisor' explicitly. A role invented
 * after that gate is written is therefore permitted everything, by
 * construction — and 20260920002000 invented one and provisioned an account
 * for it. Measured against a faithful replica of both policies, that account
 * could:
 *
 *   UPDATE recommendations SET status='approved'   -> succeeded
 *   INSERT recommendations (status='approved')     -> succeeded
 *   DELETE recommendations                         -> succeeded
 *
 * across assets, work_orders, approvals, decisions, sensors and the rest.
 * 00000000000022's approval trigger did not catch it either: authority_limits
 * holds no row for the role, and `if not found then return new;` reads "no
 * delegation recorded" as "no ceiling".
 *
 * The migration's own header disclosed the sponsor as able to READ every
 * org-scoped table, which is true and is Phase 2's problem. It said nothing
 * about writing, and an operator acting on "a sponsor belongs only in an org
 * whose whole contents are the engagement" would take that as advice about
 * confidentiality — not as the only thing standing between a customer login
 * and the approve button.
 *
 * WHY THE GATE IS SHAPED THE WAY IT IS, asserted below:
 *   * RESTRICTIVE, so it can only narrow and never becomes a new grant;
 *   * denial in WITH CHECK on UPDATE, because a restrictive USING denies by
 *     filtering to zero rows with no error and a client that reads that as
 *     success turns a refusal into a green tick;
 *   * a LITERAL table list, because a catalog-driven sweep is invisible in the
 *     diff — and because tenancyIsolation.test.ts refuses policy statements it
 *     cannot resolve statically, which is a guard, not an obstacle;
 *   * a staleness alarm, so the literal list cannot quietly go out of date.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrationFiles, stripComments } from "./support/migrationPolicies";

const SPONSOR_PATH =
  "supabase/migrations/20260920002000_ria_sponsor_and_demo_assessment.sql";
const sponsor = stripComments(readFileSync(SPONSOR_PATH, "utf8"));
const lower = sponsor.toLowerCase();
const flat = lower.replace(/\s+/g, " ");

/** The literal `write_scoped` array the sweep loops over. */
function writeScopedTables(): string[] {
  const m = /write_scoped\s+text\[\]\s*:=\s*array\s*\[([\s\S]*?)\]/i.exec(
    lower,
  );
  expect(m, "write_scoped array not found").not.toBeNull();
  return [...(m as RegExpExecArray)[1].matchAll(/'([^']*)'/g)].map((q) => q[1]);
}

describe("the migration is what it claims to be", () => {
  it("parses to real DDL, not to a file of comments", () => {
    expect(sponsor.length).toBeGreaterThan(2000);
    expect(lower).toContain(
      "create or replace function public.app_role_is_external",
    );
  });
});

describe("an external role is a named thing, not an inline string", () => {
  it("the predicate is a function, so the next external role is one line", () => {
    expect(lower).toContain("public.app_role_is_external(p_role text)");
    expect(lower).toContain("public.app_current_role_is_external()");
    expect(flat).toContain("in ('assessment_sponsor')");
  });

  it("both predicates are revoked from anon", () => {
    expect(lower).toContain(
      "revoke all on function public.app_role_is_external(text) from public, anon",
    );
    expect(lower).toContain(
      "revoke all on function public.app_current_role_is_external() from public, anon",
    );
  });

  it("app_current_role_is_external resolves the role from the SESSION", () => {
    // It must not take a role argument. A caller-supplied role is a caller
    // who declares themselves internal.
    expect(flat).toContain(
      "create or replace function public.app_current_role_is_external() returns boolean",
    );
    expect(flat).toContain(
      "select public.app_role_is_external(public.app_current_role())",
    );
  });
});

describe("the gate is closed before the account exists", () => {
  it("the write denial is created earlier in the file than the sponsor user", () => {
    const gate = lower.indexOf("app_current_role_is_external()");
    const account = lower.indexOf("'sponsor@syncai.ca'");
    expect(gate).toBeGreaterThan(-1);
    expect(account).toBeGreaterThan(-1);
    expect(
      gate,
      "the sponsor account is provisioned before its write gate exists",
    ).toBeLessThan(account);
  });

  it("provisioning is still gated on the demo organization existing", () => {
    expect(flat).toContain(
      "if not exists (select 1 from organizations where id = v_org) then return; end if;",
    );
  });
});

describe("the table set is literal, reviewable, and cannot go stale", () => {
  const tables = writeScopedTables();

  it("covers the org-scoped write surface, not a token few", () => {
    expect(tables.length).toBeGreaterThan(40);
    for (const critical of [
      "recommendations",
      "approvals",
      "decisions",
      "assets",
      "work_orders",
      "sensors",
      "value_metrics",
      "user_role_assignments",
      "roles",
    ]) {
      expect(tables, `${critical} is not gated`).toContain(critical);
    }
  });

  it("includes every table 00000000000001 granted org_rw", () => {
    // Read the baseline's own array so the list cannot drift from the source
    // of the permission it exists to deny.
    const baseline = stripComments(
      readFileSync(
        "supabase/migrations/00000000000001_operating_loop_baseline.sql",
        "utf8",
      ),
    );
    const m = /org_scoped\s+text\[\]\s*:=\s*array\s*\[([\s\S]*?)\]/i.exec(
      baseline,
    );
    expect(m).not.toBeNull();
    const orgScoped = [...(m as RegExpExecArray)[1].matchAll(/'([^']*)'/g)].map(
      (q) => q[1],
    );
    const ungated = orgScoped.filter((t) => !tables.includes(t));
    expect(ungated).toEqual([]);
  });

  it("carries a staleness alarm that raises rather than warns", () => {
    // A later migration granting `authenticated` a write on a new table must
    // fail the deploy, not be discovered by a customer identity writing to it.
    expect(flat).toContain("external-role write gate is stale");
    expect(flat).toContain("raise exception");
    expect(flat).toContain("p.polpermissive");
    expect(flat).toContain("not (c.relname = any(write_scoped))");
  });

  it("names ria_data_sources as the single deliberate exemption", () => {
    // Supplying exports is the whole of what the sponsor is for, and that
    // policy carries its own role check.
    expect(flat).toContain("c.relname <> 'ria_data_sources'");
    expect(lower).toContain(
      "create policy ria_data_sources_ext_no_upd on public.ria_data_sources",
    );
    expect(lower).toContain(
      "create policy ria_data_sources_ext_no_del on public.ria_data_sources",
    );
    // …and NOT an insert denial, or the sponsor could not do their one job.
    expect(lower).not.toContain("ria_data_sources_ext_no_ins on public");
  });

  it("mutation-sanity — the array reader rejects a catalog-driven sweep", () => {
    const swept = "for r in select c.relname as tbl from pg_class c loop";
    expect(/write_scoped\s+text\[\]\s*:=\s*array\s*\[/i.test(swept)).toBe(
      false,
    );
    expect(writeScopedTables().length).toBeGreaterThan(0);
  });
});

describe("the policies deny, and cannot be mistaken for a grant", () => {
  it("every arm is RESTRICTIVE", () => {
    for (const arm of ["_ext_no_ins", "_ext_no_upd", "_ext_no_del"]) {
      const at = flat.indexOf(`'${arm}'`);
      expect(at, `${arm} not created`).toBeGreaterThan(-1);
    }
    // The three swept statements plus the two written-out ria_data_sources ones.
    expect((flat.match(/as restrictive/g) ?? []).length).toBeGreaterThanOrEqual(
      5,
    );
  });

  it("the UPDATE arm denies in WITH CHECK, with USING left true", () => {
    expect(flat).toContain(
      "for update to authenticated using (true) with check (not public.app_current_role_is_external())",
    );
  });

  it("the DELETE arm denies in USING, because DELETE has no WITH CHECK", () => {
    expect(flat).toContain(
      "for delete to authenticated using (not public.app_current_role_is_external())",
    );
  });

  it("the INSERT arm denies in WITH CHECK", () => {
    expect(flat).toContain(
      "for insert to authenticated with check (not public.app_current_role_is_external())",
    );
  });

  it("mutation-sanity — a permissive version of the same predicate is caught", () => {
    const permissive =
      "create policy t_ext_no_upd on public.t for update to authenticated using (true) with check (not public.app_current_role_is_external())";
    const restrictive =
      "create policy t_ext_no_upd on public.t as restrictive for update to authenticated using (true) with check (not public.app_current_role_is_external())";
    const isRestrictive = (sql: string) => /\bas\s+restrictive\b/i.test(sql);
    expect(isRestrictive(permissive)).toBe(false);
    expect(isRestrictive(restrictive)).toBe(true);
  });
});

describe("the deny-list that made this necessary is still the deny-list", () => {
  it("20260912123000 still names only board and supervisor", () => {
    // If someone later converts that gate to an allow-list, this file's
    // approach should be revisited rather than duplicated. Asserting the shape
    // means the day it changes, somebody reads this comment.
    const gate = stripComments(
      readFileSync(
        "supabase/migrations/20260912123000_readonly_recommendation_write_gate.sql",
        "utf8",
      ),
    ).toLowerCase();
    expect(gate).toContain("not in ('board', 'supervisor')");
  });

  it("no later migration re-grants a permissive write to the external role", () => {
    // The gate is only worth anything if nothing after it hands the role a
    // permissive policy of its own.
    for (const file of migrationFiles()) {
      if (file <= "20260920002000_ria_sponsor_and_demo_assessment.sql")
        continue;
      const sql = stripComments(
        readFileSync(`supabase/migrations/${file}`, "utf8"),
      ).toLowerCase();
      for (const m of sql.matchAll(/create policy[\s\S]*?;/g)) {
        if (!m[0].includes("assessment_sponsor")) continue;
        expect(
          /\bas\s+restrictive\b/.test(m[0]),
          `${file} grants assessment_sponsor a permissive policy`,
        ).toBe(true);
      }
    }
  });
});
