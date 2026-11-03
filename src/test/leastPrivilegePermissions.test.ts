/**
 * E5.02 — least-privilege permissions.
 *
 * The migration self-test is what CI's fresh Postgres chain executes. This
 * file is the locally runnable guard that the ceiling, the denials, the
 * RLS read, and the absence of a client write grant cannot regress quietly.
 * Mutation checks show the same predicates rejecting a widened ceiling, an
 * always-true read, and a write grant.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  resolveChainPolicies,
  stripComments,
  usingOf,
} from "./support/migrationPolicies";

const MIGRATION_PATH =
  "supabase/migrations/20271104100000_least_privilege_permissions.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8");
const executable = stripComments(migration);
const settings = readFileSync("src/pages/SettingsPage.tsx", "utf8");
const panel = readFileSync(
  "src/components/RolePermissionGrantsPanel.tsx",
  "utf8",
);
const service = readFileSync("src/services/rolePermissionService.ts", "utf8");

function functionBody(name: string): string {
  const marker = `function public.${name}`;
  const start = executable.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  const open = executable.indexOf("$fn$", start);
  const close = executable.indexOf("$fn$", open + 4);
  return executable.slice(open + 4, close);
}

function commandOf(statement: string): string {
  const match = /\bfor\s+(all|select|insert|update|delete)\b/i.exec(statement);
  return (match?.[1] ?? "all").toLowerCase();
}

describe("least-privilege permission ceiling", () => {
  const ceiling = functionBody("app_permission_ceiling");

  it("gives audit read only to admin and ai_admin", () => {
    expect(ceiling).toMatch(
      /when 'security\.audit\.read' then\s+lower\(coalesce\(p_role, ''\)\) in \('admin', 'ai_admin'\)/,
    );
  });

  it("gives propose and adopt only to admin", () => {
    expect(ceiling).toMatch(
      /when 'security\.permissions\.propose' then\s+lower\(coalesce\(p_role, ''\)\) = 'admin'/,
    );
    expect(ceiling).toMatch(
      /when 'security\.permissions\.adopt' then\s+lower\(coalesce\(p_role, ''\)\) = 'admin'/,
    );
  });

  it("mutation-sanity — a technician propose arm fails the ceiling guard", () => {
    const adminOnly =
      /when 'security\.permissions\.propose' then\s+lower\(coalesce\(p_role, ''\)\) = 'admin'/;
    expect(adminOnly.test(ceiling)).toBe(true);
    const widened = ceiling.replace(
      "when 'security.permissions.propose' then\n      lower(coalesce(p_role, '')) = 'admin'",
      "when 'security.permissions.propose' then\n      lower(coalesce(p_role, '')) in ('admin', 'technician')",
    );
    expect(adminOnly.test(widened)).toBe(false);
  });

  it("fails closed for an unknown permission", () => {
    expect(ceiling).toMatch(/else false/);
  });
});

describe("least-privilege enforcement", () => {
  it("consults the effective permission before reading the security audit", () => {
    const reader = functionBody("get_security_events");
    expect(reader).toContain(
      "public.app_has_permission('security.audit.read')",
    );
    expect(reader).not.toMatch(/not in \('admin', 'ai_admin'\)/);
    expect(reader).toContain("organization_id = v_org");
  });

  it("refuses ai_admin, under-privileged roles, ceiling widening, and self-approval by name", () => {
    const propose = functionBody("propose_role_permission_grant");
    const decide = functionBody("decide_role_permission_grant");
    expect(propose).toContain("'ai_admin cannot change role permissions'");
    expect(propose).toContain("cannot change role permissions");
    expect(propose).toContain(
      "cannot revoke a permission the role ceiling does not grant",
    );
    expect(propose).toContain("can only revoke a ceiling grant");
    expect(propose).toContain("cannot be removed");
    expect(propose).toContain("app.role_permission_grant_writer");
    expect(decide).toContain(
      "the proposer cannot adopt their own permission change",
    );
    expect(decide).toContain("g.organization_id = v_org");
    expect(decide).toContain("'role permission grant not found'");
  });

  it("keeps the self-test that CI executes against Postgres", () => {
    expect(executable).toContain(
      "forbidden: technician cannot change role permissions",
    );
    expect(executable).toContain("ai_admin cannot change role permissions");
    expect(executable).toContain("technician RLS read saw");
    expect(executable).toContain("foreign tenant RLS read saw");
    expect(executable).toContain("adopted narrowing did not deny ai_admin");
    expect(executable).toContain("least_privilege_selftest_ok");
  });

  it("records no engineering or operational authority", () => {
    expect(executable).toContain("'operational_authority', false");
    expect(executable).toContain("'engineering_authority', false");
    expect(service).toContain("operationalAuthority: false");
    expect(panel).toContain("cannot propose permission changes");
    expect(settings).toContain("<RolePermissionGrantsPanel />");
  });
});

describe("least-privilege row security", () => {
  const chain = resolveChainPolicies();

  it("lets a tenant member with matrix read select, and nobody write", () => {
    const policies = [...chain.values()].filter(
      (policy) => policy.table === "organization_role_permission_grants",
    );
    expect(policies.map((policy) => policy.policy)).toEqual([
      "organization_role_permission_grants_read",
    ]);
    const statement = policies[0]?.statements[0] ?? "";
    expect(commandOf(statement)).toBe("select");
    expect(usingOf(statement)).toMatch(
      /organization_id = public\.app_current_org\(\)/,
    );
    expect(usingOf(statement)).toMatch(
      /app_has_permission\('security\.permissions\.read'\)/,
    );
    expect(usingOf(statement)?.replace(/\s+/g, " ").trim()).not.toBe("true");
  });

  it("mutation-sanity — an always-true read is not this policy", () => {
    const leaked = "using (true)";
    const fixed = usingOf(
      "create policy organization_role_permission_grants_read on public.organization_role_permission_grants for select to authenticated using (organization_id = public.app_current_org() and public.app_has_permission('security.permissions.read'))",
    );
    expect(leaked.replace(/\s+/g, " ")).not.toBe(
      `using (${fixed})`.replace(/\s+/g, " "),
    );
    expect(fixed).toMatch(/app_current_org/);
  });

  it("moves the security audit read onto the same permission", () => {
    const policy = chain.get("security_events.security_events_admin_read");
    expect(policy?.source).toBe(
      "20271104100000_least_privilege_permissions.sql",
    );
    const using = usingOf(policy?.statements[0] ?? "") ?? "";
    expect(using).toMatch(/app_has_permission\('security\.audit\.read'\)/);
    expect(using).toMatch(/app_current_org\(\)/);
    expect(using).not.toMatch(/ai_admin/);
  });

  it("does not grant authenticated a write on the grant table", () => {
    expect(executable.toLowerCase()).not.toMatch(
      /grant\s+(insert|update|delete|all)\s+on\s+table\s+public\.organization_role_permission_grants\s+to\s+authenticated/,
    );
    expect(executable).toContain("direct role-permission writes are refused");
    expect(executable).toContain(
      "current_user in ('anon', 'authenticated', 'service_role')",
    );
  });

  it("revokes definer execute from public", () => {
    const flat = executable.toLowerCase().replace(/\s+/g, " ");
    for (const signature of [
      "public.app_has_permission(text)",
      "public.get_role_permission_grants()",
      "public.propose_role_permission_grant(text, text, text, text)",
      "public.decide_role_permission_grant(uuid, text, text)",
      "public.get_security_events(int)",
    ]) {
      expect(flat).toContain(
        `revoke all on function ${signature} from public, anon`,
      );
    }
  });
});
