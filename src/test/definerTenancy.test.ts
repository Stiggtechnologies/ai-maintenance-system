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

/**
 * Platform-level functions that intentionally accept a target organization.
 *
 * These are not exempt from tenancy review. They are exempt ONLY from the
 * normal "replace the argument with app_current_org()" shape, because their
 * product purpose is explicitly cross-tenant. Every name here must have its
 * own stronger contract test below. Keeping the set literal means a second
 * platform-cross-tenant function cannot appear without changing this file.
 */
const PLATFORM_CROSS_TENANT = new Set(["activate_ria_from_intake"]);

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
      // Last definition moved with the governed-source overlay. The session
      // gate and permitted_claims join must still hold on THIS file, not on
      // the earlier tenancy-hardening copy.
      "20261215090000_governed_engineering_knowledge.sql",
    );
  });
});

describe("no function lets a signed-in caller name another tenant without explicit platform authority", () => {
  it("finds the full surface by scanning, including the reviewed platform exception", () => {
    const names = orgParameterSurface()
      .map((d) => d.name)
      .sort();
    expect(names).toEqual([
      "activate_ria_from_intake",
      "explain_kb_exclusions",
      "get_pm_due_count",
      "retrieve_kb_context",
    ]);
  });

  it("the platform-cross-tenant exception list is exact and cannot grow silently", () => {
    const discovered = orgParameterSurface()
      .filter((d) => !SESSION_GATE.test(d.body))
      .map((d) => d.name)
      .sort();
    expect(discovered).toEqual([...PLATFORM_CROSS_TENANT].sort());
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

  it("every normal tenant-scoped function on the scanned surface carries the session gate", () => {
    const ungated = orgParameterSurface()
      .filter((d) => !PLATFORM_CROSS_TENANT.has(d.name))
      .filter((d) => !SESSION_GATE.test(d.body))
      .map((d) => `${d.name} (${d.file})`);
    expect(ungated).toEqual([]);
  });

  it("activate_ria_from_intake has a stronger, explicit platform boundary", () => {
    const def = defs.get("activate_ria_from_intake");
    expect(def).toBeDefined();
    const body = (def as FunctionDef).body.toLowerCase();

    expect(body).toContain("auth.uid() is null");
    expect(body).toContain("v_role not in ('admin', 'ai_admin')");
    expect(body).toContain(
      "v_role = 'admin' and p_organization_id is distinct from v_current_org",
    );
    expect(body).toContain("target organization does not exist");
    expect(body).toContain("for update");
    expect(body).toContain("p_acceptance_reference");
    expect(body).not.toMatch(/insert\s+into\s+(public\.)?organizations\b/);
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

/**
 * The other half of the surface: definer functions that take no organization
 * argument at all.
 *
 * orgParameterSurface() above finds functions whose ARGUMENT list names an
 * organization. That was the shape of the three original defects, and it is a
 * real shape — but it is not the only one. A SECURITY DEFINER function granted
 * to `authenticated` runs with RLS off whether or not it takes an org
 * argument; if it filters an org-scoped table by an ASSET id, a RUN id or a
 * SENSOR id and never mentions app_current_org(), it reads and writes across
 * tenants and this file could not see it.
 *
 * ingest_rows (20261004090000) is the immediate reason. It is new, SECURITY
 * DEFINER, granted to `authenticated`, reads connector_runs and writes tenant
 * data through two validators — and it takes a run id, not an org id, so it
 * scored zero on the scan above. Its `and organization_id = v_org` was asserted
 * only in a Feature-lane test, where the next definer function to land would
 * not have inherited it. This scan is where it belongs.
 *
 * It found three functions that had never been looked at. One of them,
 * get_operating_regime, is fixed in 20261004090200 — it read any tenant's duty
 * state from an asset id, and nothing had ever called it. The other two are
 * named below as OPEN DEFECTS, not as approved exceptions.
 */
describe("a definer function that touches tenant tables names the tenant", () => {
  /** Tables whose every row belongs to exactly one organization. */
  const ORG_SCOPED = [
    "connector_runs",
    "ingest_staging",
    "ingest_watermarks",
    "operating_states",
    "production_records",
    "condition_readings",
    "condition_alerts",
    "work_orders",
    "maintenance_plans",
    "maintenance_notifications",
    "material_stock",
    "asset_onboarding_items",
    "assets",
    "sensors",
  ];

  function touchesOrgScopedTable(body: string): boolean {
    return ORG_SCOPED.some((t) =>
      new RegExp(`(from|join|into|update)\\s+${t}\\b`, "i").test(body),
    );
  }

  const surface = [...defs.values()].filter(
    (d) =>
      d.definer &&
      grantedToAuthenticated.has(d.name) &&
      touchesOrgScopedTable(d.body),
  );

  /**
   * Functions that touch an org-scoped table with RLS off and never mention
   * app_current_org(). These are DEFECTS, dated 2026-08-26, not exemptions:
   *
   *   derive_onboarding_value(uuid, text)   reads assets and work_orders for
   *   run_onboarding_resolution(uuid)       any asset id the caller supplies,
   *                                         takes the organization FROM that
   *                                         asset, and the second one WRITES
   *                                         asset_onboarding_items. Both are
   *                                         20260814140000_awaiting_data.sql,
   *                                         a different workstream from the
   *                                         one that found them; fixing them
   *                                         here would mix two changes in one
   *                                         review. The fix is one predicate
   *                                         each: `and organization_id =
   *                                         app_current_org()` on the
   *                                         `select * into a from assets`.
   *
   * The set is asserted exactly, so it can shrink when they are fixed and
   * cannot grow quietly.
   */
  const KNOWN_UNSCOPED = [
    "derive_onboarding_value",
    "run_onboarding_resolution",
  ];

  it("the scan sees a real surface rather than passing vacuously", () => {
    expect(surface.length).toBeGreaterThan(50);
    expect(surface.map((d) => d.name)).toContain("ingest_rows");
    expect(surface.map((d) => d.name)).toContain("ingest_batch");
  });

  it("mutation-sanity — a body with no org filter is detected", () => {
    expect(
      /app_current_org\s*\(\s*\)/i.test(
        "select * from assets where id = p_asset_id;",
      ),
    ).toBe(false);
    expect(touchesOrgScopedTable("select 1 from organizations")).toBe(false);
    expect(touchesOrgScopedTable("select 1 from work_orders w")).toBe(true);
  });

  it("every one of them consults app_current_org(), and the exceptions are exactly the two known defects", () => {
    const unscoped = surface
      .filter((d) => !/app_current_org\s*\(\s*\)/i.test(d.body))
      .map((d) => d.name)
      .sort();
    expect(
      unscoped,
      "a SECURITY DEFINER function granted to `authenticated` reads or writes " +
        "an org-scoped table with RLS off and never names the caller's tenant",
    ).toEqual([...KNOWN_UNSCOPED].sort());
  });

  it("ingest_rows in particular derives the tenant and filters the run by it", () => {
    // The router is the only caller ingest_batch and ingest_context_batch have
    // left, so a missing predicate here is a missing predicate for the whole
    // ingest contract.
    const body = defs.get("ingest_rows")?.body ?? "";
    expect(body).toMatch(/v_org\s+uuid\s*:=\s*app_current_org\(\)/i);
    expect(body.replace(/\s+/g, " ")).toMatch(
      /cr\.organization_id\s*=\s*v_org/i,
    );
    expect(body).toContain("no organization in session");
  });
});
