import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOMAIN_SPECIALIST_MODULES } from "../lib/domain-specialists";
import { INDUSTRY_PROFILES } from "../lib/industry-profiles";

const read = (path: string) => readFileSync(path, "utf8");
const migration = [
  read("supabase/migrations/20261213090000_domain_depth_specialists.sql"),
  read("supabase/migrations/20261219139000_battery_energy_storage_pack.sql"),
  read("supabase/migrations/20261219220000_buildings_facilities_pack.sql"),
  read("supabase/migrations/20261219230000_healthcare_pack.sql"),
  read("supabase/migrations/20261219240000_civil_infrastructure_pack.sql"),
  read("supabase/migrations/20261219250000_process_industry_pack.sql"),
  read("supabase/migrations/20261219260000_manufacturing_pack.sql"),
  read("supabase/migrations/20261219280000_transportation_pack.sql"),
]
  .join("\n")
  // Additive migrations patch deployed function definitions through SQL
  // string literals, where embedded quotes are doubled. Normalize that
  // representation before comparing the effective registry contract.
  .replaceAll("''", "'");
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

  it("patches the four missing transportation methods after the live inspection anchor", () => {
    const transport = read(
      "supabase/migrations/20261219280000_transportation_pack.sql",
    );
    expect(transport).toContain(
      "expected transport-to-aviation successor is absent",
    );
    expect(transport).toContain(
      "(''transport-logistics'',''fleet-duty-exposure'')",
    );
    expect(transport).toContain("when ''dispatch-availability'' then array[");
    expect(transport).toContain(
      "when ''fleet-configuration-trace'' then array[",
    );
    expect(transport).toContain(
      "when ''fleet-replacement-prioritization'' then array[",
    );
    expect(transport).toContain(
      "revoke all on function public.domain_specialist_required_evidence",
    );
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

  it("patches manufacturing evidence onto the live civil+process-industry body", () => {
    const civil = read(
      "supabase/migrations/20261219240000_civil_infrastructure_pack.sql",
    );
    const processIndustry = read(
      "supabase/migrations/20261219250000_process_industry_pack.sql",
    );
    const manufacturing = read(
      "supabase/migrations/20261219260000_manufacturing_pack.sql",
    );
    const civilEvidence = civil.slice(
      civil.indexOf(
        "create or replace function public.domain_specialist_required_evidence",
      ),
      civil.indexOf(
        "create or replace function public.seed_domain_specialist_reviewer_roles",
      ),
    );
    const processBefore =
      "when 'rbi-corrosion-loop' then array['inspection-data','minimum-thickness-basis','damage-mechanism-review','approved-rbi-matrix'] when 'storm-crew-dispatch' then";
    const processAfter =
      "when 'rbi-corrosion-loop' then array['inspection-data','minimum-thickness-basis','damage-mechanism-review','approved-rbi-matrix'] " +
      "when 'process-safety-barriers' then array['approved-hazard-study','barrier-register','barrier-performance-standards','verification-and-impairment-records'] " +
      "when 'pressure-containment-assurance' then array['pressure-equipment-register','approved-design-basis','inspection-and-anomaly-records','relief-protection-records'] " +
      "when 'sis-proof-test-assurance' then array['approved-sil-determination','sif-register-and-srs','proof-test-and-demand-history','bypass-and-impairment-register'] " +
      "when 'turnaround-readiness' then array['approved-turnaround-scope','work-package-and-constraint-register','isolation-and-permit-plan','resource-and-schedule-basis'] " +
      "when 'loss-of-containment-risk' then array['approved-loss-of-containment-scenarios','approved-risk-criteria','barrier-verification-records','emergency-response-basis'] " +
      "when 'storm-crew-dispatch' then";
    expect(civilEvidence).toContain(processBefore);
    expect(processIndustry.replaceAll("''", "'")).toContain(processBefore);
    expect(processIndustry).toContain(
      "when ''process-safety-barriers'' then array[",
    );
    const liveEvidence = civilEvidence.replace(processBefore, processAfter);
    const sameLinePredecessor =
      "when 'robot-health' then array['robot-controller-history','condition-monitoring','maintenance-history','approved-signal-model'] when 'haccp-verification' then";
    expect(liveEvidence).not.toContain(sameLinePredecessor);
    expect(liveEvidence).toContain(
      "when 'process-safety-barriers' then array[",
    );

    const robot =
      "when 'robot-health' then array['robot-controller-history','condition-monitoring','maintenance-history','approved-signal-model']";
    const haccp = "when 'haccp-verification' then";
    const robotPos = liveEvidence.indexOf(robot);
    expect(robotPos).toBeGreaterThan(-1);
    const afterRobot = liveEvidence.slice(robotPos + robot.length);
    const trimmed = afterRobot.replace(/^[ \t\n\r]+/, "");
    expect(trimmed.startsWith(haccp)).toBe(true);
    expect(manufacturing).toContain(
      "expected robot-to-HACCP predecessor is absent",
    );
    expect(manufacturing).toContain("ltrim(v_after_robot, E' \\t\\n\\r')");

    const insert =
      " when 'oee-loss-decomposition' then array['approved-oee-definition','production-calendar','downtime-event-history','production-and-quality-counts'] " +
      "when 'quality-loss-reconciliation' then array['quality-inspection-records','production-genealogy','defect-ncr-and-rework-records','approved-quality-counting-rules'] " +
      "when 'tooling-life-assurance' then array['tool-identity-and-configuration','authenticated-tool-usage','approved-tool-life-basis','inspection-calibration-and-quality-history'] " +
      "when 'changeover-readiness' then array['approved-changeover-standard','configuration-and-recipe-history','tooling-and-safety-verification','first-off-quality-and-release-records'] ";
    const wsLen = afterRobot.length - trimmed.length;
    const patched =
      liveEvidence.slice(0, robotPos + robot.length) +
      insert +
      liveEvidence.slice(robotPos + robot.length + wsLen);
    expect(patched).toContain("when 'oee-loss-decomposition' then array[");
    expect(patched).toContain("when 'quality-loss-reconciliation' then array[");
    expect(patched).toContain("when 'tooling-life-assurance' then array[");
    expect(patched).toContain("when 'changeover-readiness' then array[");
    expect(patched).toMatch(
      /when 'robot-health' then array\[[^\]]+\][\s\S]+when 'oee-loss-decomposition' then array\[[^\]]+\][\s\S]+when 'haccp-verification' then/,
    );
    expect(patched).toContain("when 'process-safety-barriers' then array[");
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
