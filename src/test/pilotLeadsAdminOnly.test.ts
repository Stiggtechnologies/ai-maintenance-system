/**
 * Pilot leads are admin-only — proven at the two layers that enforce it.
 *
 * The RLS layer is asserted against the migration SQL as text, the same idiom
 * the navigation-integrity suite uses for the board-packs and write-gate
 * policies (roleNavigation.test.ts): CI's `migrations` job proves the chain
 * end-to-end against a live Postgres, and this is the locally-runnable guard
 * that the policy text stays admin-only so that job can never regress silently.
 *
 * The nav layer is asserted against the real isNavItemVisible function, so the
 * route's AdminGate is not the only thing standing between a non-admin and the
 * leads menu entry.
 *
 * Mutation-sanity is explicit below: the same predicate guard that passes the
 * shipped policy is shown to REJECT a policy that admits any non-admin role —
 * an always-true predicate, a role set widened past ('admin','ai_admin'), or a
 * predicate with no role check at all. If a future edit weakened the policy to
 * any of those, the guard — and this test — would fail.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isNavItemVisible } from "../lib/roleNavigation";

const MIGRATION_PATH =
  "supabase/migrations/20260913090000_pilot_leads_admin_only.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8");

// The executable DDL with `--` line comments stripped — so assertions about
// what the migration DOES are not tripped by prose in its header (which
// deliberately quotes the very leak it removes, `using (true)`, and the anon
// grant it leaves alone).
const executable = migration
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

/** Text of the `using ( … )` predicate for a named create-policy statement. */
function selectPredicate(policyName: string): string {
  const anchor = `create policy ${policyName}`;
  const start = migration.indexOf(anchor);
  expect(start, `${anchor} not found`).toBeGreaterThan(-1);
  const usingAt = migration.indexOf("using (", start);
  expect(usingAt, `using(...) not found for ${policyName}`).toBeGreaterThan(-1);
  // Balance parens from the '(' that opens the using clause.
  let depth = 0;
  let i = usingAt + "using ".length;
  const open = i;
  for (; i < migration.length; i += 1) {
    if (migration[i] === "(") depth += 1;
    else if (migration[i] === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return migration.slice(open + 1, i).trim();
}

/**
 * True only when the predicate admits admin / ai_admin and NOBODY else: it must
 * test the caller (`auth.uid()`) against exactly the role set ('admin',
 * 'ai_admin'), and must not collapse to an always-true predicate.
 */
function isAdminOnlyPredicate(pred: string): boolean {
  const p = pred.toLowerCase().replace(/\s+/g, " ");
  const scopesToCaller = p.includes("auth.uid()");
  // The closing paren immediately after 'ai_admin' is load-bearing: a widened
  // set like ('admin','ai_admin','reliability_engineer') would not match, so a
  // non-admin role slipped into the list fails this guard.
  const exactAdminSet = /p\.role in \('admin', 'ai_admin'\)/.test(p);
  const alwaysTrue = /^true$/.test(p);
  return scopesToCaller && exactAdminSet && !alwaysTrue;
}

describe("pilot leads — RLS is admin-only", () => {
  it("drops the permissive reads the original migration shipped", () => {
    // 20260520030000 gave both lead tables `for select to authenticated using
    // (true)` — every authenticated user could read lead PII. Those exact
    // policies must be dropped, or the admin policy just OR's alongside them
    // and changes nothing.
    expect(migration).toContain(
      'drop policy if exists "Authenticated users can read pilot intake requests"',
    );
    expect(migration).toContain(
      'drop policy if exists "Authenticated users can read pilot onboarding packages"',
    );
  });

  it("leaves no always-true SELECT read on either lead table", () => {
    // Whatever else the migration does, it must not itself contain a
    // `using (true)` read that would re-open the leak.
    expect(executable.toLowerCase()).not.toContain("using (true)");
  });

  it("admits admin and ai_admin — an admin reads the lead", () => {
    expect(
      isAdminOnlyPredicate(selectPredicate("pilot_intake_requests_admin_read")),
    ).toBe(true);
    expect(
      isAdminOnlyPredicate(
        selectPredicate("pilot_onboarding_packages_admin_read"),
      ),
    ).toBe(true);
  });

  it("denies every non-admin authed role — a non-admin reads zero rows", () => {
    // The predicate requires the caller's own profile role to be admin/ai_admin;
    // any other authenticated role fails the EXISTS and the row is invisible.
    // Encoded as the guard rejecting a mutant that admits a non-admin role.
    const intake = selectPredicate("pilot_intake_requests_admin_read");
    const widenedToNonAdmin = intake.replace(
      "'admin', 'ai_admin'",
      "'admin', 'ai_admin', 'reliability_engineer'",
    );
    expect(widenedToNonAdmin).not.toBe(intake); // the mutation actually applied
    expect(isAdminOnlyPredicate(widenedToNonAdmin)).toBe(false);
  });

  it("mutation-sanity — the guard fails on any predicate that admits a non-admin", () => {
    const adminOnly =
      "exists (select 1 from user_profiles p where p.id = auth.uid() and p.role in ('admin', 'ai_admin'))";
    expect(isAdminOnlyPredicate(adminOnly)).toBe(true);
    // Always-true — admits everyone.
    expect(isAdminOnlyPredicate("true")).toBe(false);
    // Role set widened past the admin pair — admits a non-admin.
    expect(
      isAdminOnlyPredicate(
        "exists (select 1 from user_profiles p where p.id = auth.uid() and p.role in ('admin', 'ai_admin', 'planner'))",
      ),
    ).toBe(false);
    // No caller/role check at all.
    expect(isAdminOnlyPredicate("exists (select 1 from user_profiles p)")).toBe(
      false,
    );
  });

  it("does not weaken the anonymous insert path", () => {
    // The public intake RPC and its anon grant live in the original migration
    // and must stay untouched — this migration only changes SELECT policies, so
    // its executable DDL must not mention anon, grants, revokes, or inserts.
    const lower = executable.toLowerCase();
    expect(lower).not.toContain("anon");
    expect(lower).not.toContain("grant");
    expect(lower).not.toContain("revoke");
    expect(lower).not.toContain("submit_pilot_intake_request");
    expect(lower).not.toMatch(/\binsert\b/);
  });
});

describe("pilot leads — the menu entry is admin-only too", () => {
  it("shows Pilot Leads to admin and ai_admin", () => {
    for (const role of ["admin", "ai_admin"]) {
      expect(isNavItemVisible(role, "pilot-leads")).toBe(true);
    }
  });

  it("hides Pilot Leads from every non-admin role and the unknown role", () => {
    for (const role of [
      "operator",
      "technician",
      "supervisor",
      "planner",
      "reliability_engineer",
      "maintenance_manager",
      "executive",
      "board",
      "some_unvetted_role",
    ]) {
      expect(isNavItemVisible(role, "pilot-leads")).toBe(false);
    }
    expect(isNavItemVisible(null, "pilot-leads")).toBe(false);
    expect(isNavItemVisible(undefined, "pilot-leads")).toBe(false);
  });
});
