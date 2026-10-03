import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101090000_organization_governance_workspace.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/organizationGovernanceService.ts",
  "utf8",
);
const component = readFileSync(
  "src/components/OrganizationGovernanceWorkspace.tsx",
  "utf8",
);
const settings = readFileSync("src/pages/SettingsPage.tsx", "utf8");
const selfSignup = readFileSync(
  "supabase/migrations/20260918090000_self_signup_evaluation_workspace.sql",
  "utf8",
).toLowerCase();

describe("organization governance workspace contract", () => {
  it("extends the canonical organization and framework families", () => {
    expect(migration).not.toMatch(/create\s+table/);
    expect(migration).toContain("on public.organizations");
    expect(migration).toContain("from organizations o");
    expect(migration).toContain("join project_frameworks f");
    expect(migration).toContain("resolve_org_governance_profile(tree.id)");
  });

  it("seeds every customer-created root while leaving child nodes unseeded", () => {
    expect(selfSignup).toContain("insert into public.organizations");
    expect(migration).toContain(
      "create trigger trg_seed_new_root_governance_defaults",
    );
    expect(migration).toContain("when (new.parent_id is null)");
    expect(migration).toContain(
      "perform seed_governance_framework_library(new.id)",
    );
    expect(migration).toContain(
      "perform seed_governance_tailoring_defaults(new.id)",
    );
    expect(migration).toContain("if new.parent_id is not null then");
    expect(migration).toContain(
      "revoke all on function public.seed_new_root_governance_defaults()\n  from public, anon, authenticated",
    );
  });

  it("derives tenant scope from the signed-in profile and accepts no client org id", () => {
    expect(migration).toContain(
      "create or replace function public.get_organization_governance_workspace()",
    );
    expect(migration).toContain("v_org uuid := app_current_org()");
    expect(migration).toContain("where o.id = v_org");
    expect(migration).toContain("with recursive managed_tree as");
    expect(migration).toContain(
      "cross join lateral org_ancestry(managed_tree.id) ancestry",
    );
    expect(migration).toContain("f.status = 'adopted'");
    expect(migration).toContain("'eligiblenodeids'");
    expect(migration).not.toMatch(
      /get_organization_governance_workspace\s*\(\s*p_(org|organization)/,
    );
    expect(migration).toContain(
      "grant execute on function public.get_organization_governance_workspace()\n  to authenticated",
    );
  });

  it("keeps writes on the existing audited executive-gated RPCs", () => {
    for (const rpc of [
      "get_organization_governance_workspace",
      "create_sub_organization",
      "set_organization_node",
      "set_org_governance_profile",
    ]) {
      expect(service).toContain(`"${rpc}"`);
    }
    expect(service).not.toMatch(
      /\.from\(["']organizations["']\).*\.(insert|update|delete)/s,
    );
    expect(component).toContain("createSubOrganization");
    expect(component).toContain("updateOrganizationNode");
    expect(component).toContain("setOrganizationGovernanceProfile");
    expect(component).toContain("workspace.data?.nodes");
  });

  it("mounts the reachable surface in organization settings and states human authority", () => {
    expect(settings).toContain("<OrganizationGovernanceWorkspace />");
    expect(component).toContain("data.governance.writes");
    expect(component).toContain("data.governance.automation");
    expect(migration).toContain("executive or administrator only");
    expect(migration).toContain("never adopts or attaches");
    expect(component).toContain("written to the audit trail");
  });
});
