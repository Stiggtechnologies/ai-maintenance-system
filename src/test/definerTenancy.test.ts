/**
 * Tenancy at the function boundary.
 *
 * Row-level security governs tables. A SECURITY DEFINER function runs as its
 * owner with RLS switched off, so every one granted to `authenticated` is a
 * second, independent access-control surface — and the policy tests in
 * tenancyIsolation.test.ts cannot see it. Three functions were carrying the
 * same class of defect the policies had:
 *
 *   get_pm_due_count       filtered maintenance_plans by a p_org ARGUMENT that
 *                          nothing compared to the caller. A tenant holding
 *                          another tenant's organization id read their PM
 *                          programme straight through a correct policy.
 *   retrieve_kb_context    gated the organization parameter on
 *   explain_kb_exclusions  `app_current_org() is null`, intending "no session".
 *                          app_current_org() reads user_profiles for auth.uid()
 *                          and is ALSO null for a signed-in user who has no
 *                          profile row — and no trigger on auth.users creates
 *                          one, so every freshly signed-up account could name
 *                          any organization and read its private corpus.
 *
 * The distinction those two lines turn on — "has no session" versus "has no
 * profile" — is the whole vulnerability, and it is invisible unless something
 * asserts it. That is what this file is for.
 *
 * The last test is the one that matters most: it rediscovers the surface from
 * the migrations rather than trusting the list above, so a fourth function
 * added later with an unchecked organization parameter fails here on the day
 * it lands.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrationFiles, stripComments } from "./support/migrationPolicies";

const GUARDS_PATH =
  "supabase/migrations/20260917001000_definer_tenancy_guards.sql";
const guards = stripComments(readFileSync(GUARDS_PATH, "utf8"));

/** The session gate. Not `app_current_org() is null` — that is the bug. */
const SESSION_GATE =
  /case\s+when\s+auth\.uid\(\)\s+is\s+not\s+null\s+then\s+app_current_org\(\)\s+else\s+(\w+)\s+end/i;

type FunctionDef = {
  name: string;
  file: string;
  args: string;
  body: string;
  definer: boolean;
};

/**
 * The last definition of every function in the chain, in filename order, plus
 * which ones are granted to `authenticated`. Later files win, exactly as
 * `create or replace` does in Postgres.
 */
function resolveChainFunctions(): {
  defs: Map<string, FunctionDef>;
  grantedToAuthenticated: Set<string>;
} {
  const defs = new Map<string, FunctionDef>();
  const grantedToAuthenticated = new Set<string>();

  for (const file of migrationFiles()) {
    const sql = stripComments(
      readFileSync(`supabase/migrations/${file}`, "utf8"),
    );

    for (const m of sql.matchAll(
      /grant\s+execute\s+on\s+function\s+([\w.]+)\s*\([^)]*\)\s+to\s+([\w,\s]+);/gi,
    )) {
      if (/\bauthenticated\b/i.test(m[2])) {
        grantedToAuthenticated.add(
          m[1].replace(/^public\./i, "").toLowerCase(),
        );
      }
    }

    // `create [or replace] function name(args) ... $tag$ body $tag$;`
    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(([\s\S]*?)\)\s*returns([\s\S]*?)(\$\w*\$)([\s\S]*?)\4\s*;/gi,
    )) {
      const name = m[1].replace(/^public\./i, "").toLowerCase();
      defs.set(name, {
        name,
        file,
        args: m[2],
        body: m[5],
        definer: /security\s+definer/i.test(m[3]),
      });
    }
  }

  return { defs, grantedToAuthenticated };
}

/**
 * Functions whose EXECUTE was explicitly revoked from `public`/`anon`.
 *
 * WHY THIS MATTERS SEPARATELY FROM THE ORG-ARGUMENT SCAN. Postgres grants
 * EXECUTE on every new function to PUBLIC by default. A SECURITY DEFINER
 * function that nobody revokes is therefore callable by `anon` — a caller with
 * no session at all — and the org-argument scan above cannot see it, because
 * that scan filters to functions granted to `authenticated` and to argument
 * lists mentioning an organization. seed_ria_dataset_slots(p_assessment_id
 * uuid) missed on both counts: it was granted to nobody (hence PUBLIC) and its
 * only argument was an assessment id. An unauthenticated caller, denied even
 * SELECT on ria_assessments, could write seven rows into any tenant whose
 * assessment uuid it held.
 */
function revokedFromPublic(): Set<string> {
  const revoked = new Set<string>();
  for (const file of migrationFiles()) {
    const sql = stripComments(
      readFileSync(`supabase/migrations/${file}`, "utf8"),
    );
    for (const m of sql.matchAll(
      /revoke\s+(?:all|execute)[^;]*?\bon\s+function\s+([\w.]+)\s*\(/gi,
    )) {
      revoked.add(m[1].replace(/^public\./i, "").toLowerCase());
    }
  }
  return revoked;
}

/**
 * The date after which the rule is enforced.
 *
 * There are 135 pre-existing SECURITY DEFINER functions in this chain with no
 * explicit revoke. Asserting the property over all of them would fail on day
 * one and be deleted by the next person, which is how a guard becomes a
 * comment. So it is a RATCHET, in the spirit of the capability register:
 * history is named, not silently blessed, and nothing new may join it. The
 * pre-existing set is real debt and is counted below so it cannot grow.
 */
const REVOKE_RULE_FROM = "20260918";

const { defs, grantedToAuthenticated } = resolveChainFunctions();

/** Functions an authenticated browser can call that take an org/tenant uuid. */
function orgParameterSurface(): FunctionDef[] {
  return [...defs.values()].filter(
    (d) =>
      d.definer &&
      grantedToAuthenticated.has(d.name) &&
      /uuid/i.test(d.args) &&
      /(^|[^a-z])(p_)?(org|organization|tenant)/i.test(d.args),
  );
}

// ---------------------------------------------------------------------------

describe("the resolver sees a real chain", () => {
  it("parses enough of the migrations to be worth trusting", () => {
    // Guards against the whole file passing because the regexes matched
    // nothing. There are ~235 function definitions and ~185 grants.
    expect(defs.size).toBeGreaterThan(150);
    expect(grantedToAuthenticated.size).toBeGreaterThan(100);
  });

  it("resolves each function to its LAST definition, not its first", () => {
    // get_pm_due_count is defined in 20260903090000 and redefined here. If the
    // resolver returned the first, every assertion below would test the
    // vulnerable version and pass for the wrong reason.
    expect(defs.get("get_pm_due_count")?.file).toBe(
      "20260917001000_definer_tenancy_guards.sql",
    );
    expect(defs.get("retrieve_kb_context")?.file).toBe(
      "20260917001000_definer_tenancy_guards.sql",
    );
  });
});

describe("no function lets a signed-in caller name another tenant", () => {
  it("finds the surface by scanning, and it is not empty", () => {
    const names = orgParameterSurface()
      .map((d) => d.name)
      .sort();
    expect(names).toEqual([
      "explain_kb_exclusions",
      "get_pm_due_count",
      "retrieve_kb_context",
    ]);
  });

  it.each(["get_pm_due_count", "retrieve_kb_context", "explain_kb_exclusions"])(
    "%s resolves the organization from the session, not the argument",
    (name) => {
      const def = defs.get(name);
      expect(def, `${name} not found in the chain`).toBeDefined();
      const body = (def as FunctionDef).body;
      expect(body, `${name} does not gate on auth.uid()`).toMatch(SESSION_GATE);
    },
  );

  it("every function on the scanned surface carries the gate", () => {
    // The property, stated once over whatever the scan finds — so a fourth
    // function added later is caught without editing the list above.
    const ungated = orgParameterSurface()
      .filter((d) => !SESSION_GATE.test(d.body))
      .map((d) => `${d.name} (${d.file})`);
    expect(ungated).toEqual([]);
  });

  it("the gate is on the session, never on the profile", () => {
    // `coalesce(app_current_org(), p_organization_id)` was the shipped bug: it
    // reads as "service role only" and actually means "anyone without a
    // user_profiles row", which includes every account between sign-up and
    // provisioning. There is no trigger on auth.users to close that window.
    for (const def of orgParameterSurface()) {
      expect(
        def.body,
        `${def.name} still coalesces app_current_org() with its argument`,
      ).not.toMatch(/coalesce\s*\(\s*[\w.]*app_current_org\(\)\s*,/i);
    }
  });

  it("mutation-sanity — the gate predicate rejects the shipped bug", () => {
    const shipped =
      "v_org uuid := coalesce(app_current_org(), p_organization_id);";
    const fixed =
      "v_org uuid := case when auth.uid() is not null then app_current_org() else p_organization_id end;";
    expect(SESSION_GATE.test(shipped)).toBe(false);
    expect(SESSION_GATE.test(fixed)).toBe(true);
  });

  it("get_pm_due_count no longer filters plans by the bare argument", () => {
    const body = defs.get("get_pm_due_count")?.body ?? "";
    expect(body).not.toMatch(/organization_id\s*=\s*p_org\b/i);
    expect(body).toMatch(/maintenance_plans/i);
  });

  it("the shared KB corpus is still readable to everyone", () => {
    // The null-organization branch is the point of the table: global reference
    // chunks must stay visible whatever the session resolves to. Tightening
    // the gate must not have taken that with it.
    for (const name of ["retrieve_kb_context", "explain_kb_exclusions"]) {
      expect(defs.get(name)?.body).toMatch(/c\.organization_id\s+is\s+null/i);
    }
  });
});

describe("provision_deployment cannot be entered with a null organization", () => {
  it("the null-swallowing comparison is rewritten, not left in place", () => {
    expect(guards).toMatch(
      /inst\.organization_id is distinct from app_current_org\(\)/,
    );
  });

  it("the rewrite is idempotent and disarms itself", () => {
    // It runs only when the exact defective text is present, so a second apply
    // is a no-op and a legitimately rewritten body is never clobbered.
    expect(guards).toMatch(/position\s*\(\s*v_bad\s+in\s+v_src\s*\)\s*=\s*0/i);
    expect(guards).toMatch(/pg_get_functiondef/i);
  });

  it("and the row the guard mishandles can no longer be created", () => {
    expect(guards).toMatch(
      /add\s+constraint\s+deployment_instances_organization_id_present[\s\S]*?check\s*\(\s*organization_id\s+is\s+not\s+null\s*\)\s*not\s+valid/i,
    );
  });

  it("the constraint cannot abort a deployment over inherited data", () => {
    // NOT VALID first, validated only when the table is measurably clean —
    // this chain is applied to databases that already exist, and a migration
    // that fails on historical rows stops the deployment for everyone.
    expect(guards).toMatch(
      /if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+public\.deployment_instances\s+where\s+organization_id\s+is\s+null\s*\)/i,
    );
    expect(guards).toMatch(
      /validate\s+constraint\s+deployment_instances_organization_id_present/i,
    );
  });

  it("adding the constraint twice is a no-op", () => {
    expect(guards).toMatch(/from\s+pg_constraint/i);
  });
});

// ---------------------------------------------------------------------------

describe("a definer function is not callable by anon just because nobody said so", () => {
  const revoked = revokedFromPublic();
  const definers = [...defs.values()].filter((d) => d.definer);

  const recent = definers.filter((d) => d.file.slice(0, 8) >= REVOKE_RULE_FROM);

  it("the scan finds recent definer functions at all", () => {
    // Without this, the assertion below passes vacuously the day the regex
    // stops matching.
    expect(recent.length).toBeGreaterThan(5);
  });

  it.each(recent.map((d) => [d.name, d.file]))(
    "%s (%s) revokes EXECUTE from public",
    (name) => {
      expect(
        revoked.has(name as string),
        `${name} is SECURITY DEFINER and carries no \`revoke ... from public\`, so PUBLIC — including anon — can execute it`,
      ).toBe(true);
    },
  );

  it("the pre-existing unrevoked set is named, and may not grow", () => {
    // A ratchet, not an amnesty. If this number goes UP, a new definer
    // function was added without a revoke in a file predating the rule, which
    // is the only way to sneak past the assertion above.
    const legacy = definers.filter(
      (d) => d.file.slice(0, 8) < REVOKE_RULE_FROM && !revoked.has(d.name),
    );
    expect(legacy.length).toBeLessThanOrEqual(149);
  });

  it("mutation-sanity — the revoke scan does not match a grant", () => {
    // `grant execute on function f() to authenticated` must not be read as a
    // revoke, or every function in the chain would look protected.
    const onlyGrant = new Set<string>();
    for (const m of "grant execute on function public.f(uuid) to authenticated;".matchAll(
      /revoke\s+(?:all|execute)[^;]*?\bon\s+function\s+([\w.]+)\s*\(/gi,
    )) {
      onlyGrant.add(m[1]);
    }
    expect([...onlyGrant]).toEqual([]);
  });

  it("the RIA slot seeder in particular is revoked from public, anon AND authenticated", () => {
    // It takes an assessment id, resolves the tenant from it, and writes with
    // RLS off. Its only callers are a trigger and a backfill, both of which run
    // as the function owner, so no client role needs it.
    const dataRoom = stripComments(
      readFileSync(
        "supabase/migrations/20260920001000_ria_data_room.sql",
        "utf8",
      ),
    ).toLowerCase();
    expect(dataRoom).toContain(
      "revoke all on function public.seed_ria_dataset_slots(uuid) from public, anon, authenticated",
    );
    expect(dataRoom).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.seed_ria_dataset_slots/,
    );
  });
});
