import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOMAIN_SPECIALIST_MODULES } from "../lib/domain-specialists";
import { INDUSTRY_PROFILES } from "../lib/industry-profiles";

const read = (path: string) => readFileSync(path, "utf8");
const migration = [
  read("supabase/migrations/20261213090000_domain_depth_specialists.sql"),
  read("supabase/migrations/20261219139000_battery_energy_storage_pack.sql"),
  read("supabase/migrations/20261219220000_buildings_facilities_pack.sql"),
].join("\n");
const edge = read("supabase/functions/domain-specialist-run/index.ts");
const workflow = read(".github/workflows/deploy-migrations.yml");
const closeout = read(".github/workflows/domain-specialists-closeout.yml");

describe("domain specialist production contract", () => {
  it("keeps the SQL allowlist exactly aligned with the executable registry", () => {
    const expected = DOMAIN_SPECIALIST_MODULES.flatMap((module) =>
      module.methods.map((method) => `${module.key}/${method.key}`),
    ).sort();
    const actual = [
      ...new Set(
        [...migration.matchAll(/\('([^']+)','([^']+)'\)/g)]
          .map((match) => `${match[1]}/${match[2]}`)
          .filter((pair) => expected.includes(pair)),
      ),
    ].sort();
    expect(actual).toEqual(expected);
  });

  it("removes the named prose-only gaps only where a governed module exists", () => {
    const moduleByIndustry = new Map(
      DOMAIN_SPECIALIST_MODULES.map((module) => [
        module.industryCode,
        module.key,
      ]),
    );
    for (const profile of INDUSTRY_PROFILES) {
      const expected = moduleByIndustry.get(profile.industryCode);
      if (expected) {
        expect(profile.domainModules).toContain(expected);
        expect(profile.proseOnly, profile.industryCode).toEqual([]);
      }
    }
  });

  it("persists only non-authoritative human-reviewed tenant-bound envelopes", () => {
    expect(migration).toContain(
      "authoritative boolean not null default false check (not authoritative)",
    );
    expect(migration).toContain(
      "human_approval_required boolean not null default true check (human_approval_required)",
    );
    expect(migration).toContain(
      "risk_id uuid not null references public.risks(id)",
    );
    expect(migration).toContain(
      "evidence.id = evidence_id and evidence.organization_id = v_org and evidence.risk_id = p_risk_id",
    );
    expect(migration).toContain(
      "specialist output must be non-authoritative and require human approval",
    );
    expect(migration).toContain(
      "independent review cannot be completed by the run author",
    );
    expect(migration).toContain(
      "domain_specialist_actor_has_role(\n    auth.uid(),v_org,v_run.required_reviewer_role_key",
    );
    for (const module of DOMAIN_SPECIALIST_MODULES) {
      expect(migration).toContain(
        `when '${module.key}' then '${module.reviewerRoleKey}'`,
      );
      for (const method of module.methods) {
        expect(migration).toContain(`when '${method.key}' then array[`);
        for (const evidenceKey of method.requiredEvidence)
          expect(migration).toContain(`'${evidenceKey}'`);
      }
    }
    expect(migration).toContain(
      "create policy domain_specialist_runs_org_read",
    );
  });

  it("prevents browsers from persisting a spoofed calculation", () => {
    expect(migration).toContain("if auth.role() <> 'service_role' then");
    expect(migration).toContain(
      "revoke all on function public.record_domain_specialist_run(uuid,uuid,uuid,jsonb,uuid[]) from public,anon,authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.record_domain_specialist_run(uuid,uuid,uuid,jsonb,uuid[]) to service_role",
    );
    expect(edge).toContain("evaluateDomainSpecialist(specialistRequest)");
    expect(edge).toContain(
      "canonicalEvidence.map((item) => item.evidenceItemId)",
    );
    expect(edge).not.toContain("body.evidenceItemIds");
    expect(edge).toContain(
      'const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
    );
    expect(edge).toContain('service.rpc("record_domain_specialist_run"');
    expect(edge).not.toContain("candidate.result");
  });

  it("deploys and probes the JWT-protected executor", () => {
    expect(workflow).toContain(
      "supabase functions deploy domain-specialist-run",
    );
    expect(workflow).toContain("Prove Domain Specialist executor is deployed");
    expect(workflow).toContain('if [ "$status" != "401" ]');
    expect(closeout).toContain("ci-domain-specialists-smoke.sh");
    expect(closeout).toContain("Domain specialist runtime acceptance");
  });
});
