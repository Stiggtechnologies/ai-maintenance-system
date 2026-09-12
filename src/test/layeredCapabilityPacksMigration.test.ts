import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219190000_layered_capability_packs.sql",
  "utf8",
).toLowerCase();
const page = readFileSync(
  "src/pages/DecisionGovernance.tsx",
  "utf8",
);

describe("U20.01 layered capability pack contract", () => {
  it("implements the exact seven-layer precedence in one resolver", () => {
    expect(migration).toContain(
      "universal_core -> sector -> jurisdiction -> enterprise -> business_unit ->",
    );
    expect(migration).toContain("when 'universal_core' then 1");
    expect(migration).toContain("when 'asset' then 7");
    expect(migration).toContain("resolve_capability_pack_stack");
    expect(migration).toContain("effective_configuration");
    expect(migration).toContain("value_sources");
    expect(migration).toContain("missing_layers");
  });

  it("reuses canonical scope identities, approvals and audit instead of duplicating them", () => {
    expect(migration).toContain(
      "organization_node_id uuid references public.organizations",
    );
    expect(migration).toContain("site_id uuid references public.sites");
    expect(migration).toContain("asset_id uuid references public.assets");
    expect(migration).toContain(
      "override_approval_id uuid references public.approvals",
    );
    expect(migration).toContain("insert into public.approvals");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toContain("create table if not exists public.capability_pack_approvals");
    expect(migration).not.toContain("create table if not exists public.pack_sites");
    expect(migration).not.toContain("create table if not exists public.pack_assets");
  });

  it("holds changed inherited values for an exact-diff independent human approval", () => {
    expect(migration).toContain("override_diff");
    expect(migration).toContain("'inherited'");
    expect(migration).toContain("'proposed'");
    expect(migration).toContain("the override author cannot approve their own change");
    expect(migration).toContain("the ai-operator identity cannot approve overrides");
    expect(migration).toContain("the exact override diff requires completed human approval");
    expect(migration).toContain("p.status<>'approved'");
    expect(migration).toContain("decided_at is null");
    expect(migration).toContain("capability_pack_layer_id=l.id");
    expect(migration).toContain("approvals_capability_pack_sensitive");
    expect(migration).toContain("with check (capability_pack_layer_id is null)");
  });

  it("enforces tenant walls at references, reads and RPC grants", () => {
    expect(migration).toContain("organization_id=public.app_current_org()");
    expect(migration).toContain("org_node_in_scope");
    expect(migration).toContain("site is outside the tenant");
    expect(migration).toContain("asset is outside the tenant");
    expect(migration).toContain(
      "revoke all on function public.author_capability_pack_layer(jsonb) from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.get_capability_pack_workspace() to authenticated",
    );
  });

  it("keeps pack configuration advisory and customer reachable", () => {
    expect(migration).toContain("cannot approve work");
    expect(migration).toContain("change an operating limit");
    expect(migration).toContain("establish regulatory compliance");
    expect(page).toContain("<LayeredCapabilityPacks />");
  });
});
