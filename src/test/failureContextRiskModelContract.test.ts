import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAILURE_CONTEXTS } from "../lib/industry-profiles";

const migration = readFileSync(
  "supabase/migrations/20271113120000_failure_context_risk_models.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/failureContextRiskModelService.ts",
  "utf8",
);
const surface = readFileSync(
  "src/components/FailureContextDifferentiation.tsx",
  "utf8",
);
const host = readFileSync(
  "src/components/DomainSpecialistWorkbench.tsx",
  "utf8",
);

describe("failure context risk model contract", () => {
  it("keeps the server catalog identical to the canonical failure contexts", () => {
    const match = migration.match(/\$catalog\$([\s\S]*?)\$catalog\$/);
    expect(match, "catalog mirror missing").not.toBeNull();
    expect(JSON.parse((match as RegExpMatchArray)[1])).toEqual(
      FAILURE_CONTEXTS,
    );
  });

  it("recomputes differentiation and does not accept a client engine list", () => {
    expect(migration).toContain(
      "create or replace function public.record_failure_context_binding(",
    );
    expect(migration).toContain("p_asset_id uuid");
    expect(migration).toContain("p_context_key text");
    expect(migration).toContain("p_comparison_key text");
    expect(migration).toContain("p_basis text");
    expect(migration).not.toMatch(/p_engines|p_workflow|p_differentiated/);
    expect(migration).toContain("public.failure_context_catalog()");
    expect(migration).toContain("get genuinely different treatment:");
    expect(migration).toContain(
      "legitimately shared (the kernel is common by design — E1.01)",
    );
    expect(migration).toContain("Unknown context:");
    expect(migration).toContain(
      "a failure context is not differentiated from itself",
    );
    expect(migration).toContain(
      "These two contexts bind to identical engines and the same workflow.",
    );
  });

  it("is tenant scoped, human governed, append-only, and audited", () => {
    expect(migration).toContain(
      "organization_id uuid not null references public.organizations(id)",
    );
    expect(migration).toContain("references public.assets(id)");
    expect(migration).toContain("and a.organization_id = v_org");
    expect(migration).toContain("asset is outside the active tenant");
    expect(migration).toContain("v_org uuid := public.app_current_org()");
    expect(migration).toContain(
      "'reliability_engineer', 'maintenance_manager', 'admin'",
    );
    expect(migration).not.toContain("'ai_admin'");
    expect(migration).toContain(
      "binding a failure context requires a named reliability, maintenance, or admin role",
    );
    expect(migration).toContain(
      "evidence basis must be at least 20 characters",
    );
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("'failure_context_binding'");
    expect(migration).toContain("'work_authorized', false");
    expect(migration).toContain("'risk_accepted', false");
    expect(migration).toContain("check (not work_authorized)");
    expect(migration).toContain("check (not risk_accepted)");
    expect(migration).toContain("failure-context bindings are append-only");
    expect(migration).toContain("revoke insert, update, delete, truncate");
    expect(migration).toContain(
      "revoke all on function public.record_failure_context_binding(uuid, text, text, text)",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain(
      "using (organization_id = public.app_current_org())",
    );
    expect(migration).not.toMatch(/for\s+insert\s+to\s+authenticated/i);
  });

  it("is reachable from the specialists surface through the canonical check", () => {
    expect(service).toContain("checkDifferentiation(");
    expect(service).toContain('rpc("record_failure_context_binding"');
    expect(surface).toContain("differentiateFailureContexts(");
    expect(surface).toContain("recordFailureContextBinding(");
    expect(host).toContain("<FailureContextDifferentiation />");
    expect(surface).toContain("does not approve work, accept risk");
  });
});
