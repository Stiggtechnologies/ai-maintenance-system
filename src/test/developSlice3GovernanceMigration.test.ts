/**
 * Sync Develop Slice 3 — migration contract (static, no database).
 *
 * The live behavior is proven by scripts/ci-develop-slice3-smoke.sh against
 * a real local database (multi-role transcript: library seeding, adoption,
 * org tree, inheritance, six-factor refusals, determination, and the
 * gate-pass refusal at elevated intensity — RPC and persistence boundary
 * both). This file pins the CONTRACT in the migration text so a later edit
 * that loosens an invariant, forks a canonical store, widens the provenance
 * fence, or lets the SQL and the pure lib drift apart fails CI before it
 * reaches a database.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  FACTOR_RATING_SCALES,
  GOVERNANCE_INTENSITY_LEVELS,
} from "../lib/develop/governance";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));

const orgTree = read("20261120090000_develop_org_five_level_tree.sql");
const library = read("20261120090100_governance_profile_library.sql");
const tailoring = read("20261120090200_governance_intensity_tailoring.sql");
const enforcement = read("20261120090300_intensity_binding_enforcement.sql");
const lowerAll = [orgTree, library, tailoring, enforcement]
  .join("\n")
  .toLowerCase();

describe("organization five-level tree (D11.14)", () => {
  it("EXTENDS the one organizations table — no parallel org-node store anywhere in the slice", () => {
    expect(orgTree).toContain("alter table public.organizations");
    expect(lowerAll).not.toMatch(/create table[^;]*org_nodes/);
    expect(lowerAll).not.toMatch(/create table[^;]*organization_nodes/);
  });

  it("types the spec §2 five levels and ranks them once", () => {
    expect(orgTree).toContain(
      "check (org_level in ('enterprise','business_unit','site','area','system'))",
    );
    expect(orgTree).toContain("function public.org_level_rank");
  });

  it("tree integrity refuses cycles and inverted ranks for EVERY writer (no service escape)", () => {
    const fn = orgTree.slice(
      orgTree.indexOf("enforce_organization_tree_integrity"),
      orgTree.indexOf("drop trigger if exists trg_organization_tree_integrity"),
    );
    expect(fn).toContain("would close a cycle");
    expect(fn).toContain("cannot be its own parent");
    expect(fn).toContain("sits strictly above its child");
    expect(fn).toMatch(/check_violation/);
    // Corrupt data is not a provenance question: no admit-the-service branch.
    expect(fn).not.toContain("current_user not in ('authenticated', 'anon')");
  });

  it("a governance profile attaches only ADOPTED and only from the node's own ancestry", () => {
    expect(orgTree).toContain("cannot govern an organization");
    expect(orgTree).toContain("outside this node''s ancestry");
  });

  it("inheritance resolution follows supersession by NAME to the adopted version", () => {
    const fn = orgTree.slice(
      orgTree.indexOf(
        "create or replace function public.resolve_org_governance_profile",
      ),
      orgTree.indexOf(
        "create or replace function public.create_sub_organization",
      ),
    );
    expect(fn).toContain("join project_frameworks pinned");
    expect(fn).toMatch(/fw\.name = pinned\.name/);
    expect(fn).toMatch(/fw\.status = 'adopted'/);
    expect(fn).toMatch(/order by a\.depth asc, fw\.version desc/);
  });

  it("create_development_case inherits by walking the tree, and only an OPERABLE framework governs", () => {
    expect(orgTree).toContain("from resolve_org_governance_profile(v_org)");
    // Ancestor-owned resolutions are reported, never silently half-applied.
    expect(orgTree).toContain("'framework_inheritance_not_operable'");
    // Explicit selection stays strictly org-scoped.
    expect(orgTree).toContain(
      "where id = v_framework_id and organization_id = v_org",
    );
    // The audit and the return both name the inheritance source.
    expect(orgTree).toContain("'framework_inherited_from', v_inherited_from");
  });

  it("tree authoring is executive/administrator work, audited", () => {
    for (const rpc of [
      "create_sub_organization",
      "set_organization_node",
      "set_org_governance_profile",
    ]) {
      const body = orgTree.slice(orgTree.indexOf(`function public.${rpc}`));
      expect(body).toContain("in ('admin','executive')");
    }
    expect(orgTree).toContain("'organization_tree'");
  });
});

describe("the framework profile library (D3.02) under the provenance fence (D11.04)", () => {
  it("seeds exactly the six build-plan archetypes, generically named", () => {
    for (const name of [
      "Major Capital Projects — Mining & Metals",
      "Sustaining Capital — Light Governance",
      "Turnaround & Shutdown Delivery",
      "Brownfield Modification — Operating Site",
      "Digital & IT Delivery",
      "Exploration & Study Phase",
    ]) {
      expect(library).toContain(`'${name}'`);
    }
  });

  it("THE FENCE: no seeded string names ADEM or Suncor, in any casing", () => {
    // Comments are stripped; what remains is the shipped data itself.
    expect(library.toLowerCase()).not.toMatch(/\badem\b/);
    expect(library.toLowerCase()).not.toMatch(/\bsuncor\b/);
  });

  it("THE FENCE: every seeded provenance tier is INDUSTRY_GUIDANCE or BEST_PRACTICE — never a corporate/authoritative claim", () => {
    const tiers = [
      ...library.matchAll(
        /'(LAW|REGULATION|CORPORATE_STANDARD|PROJECT_FRAMEWORK|CONTRACT|INDUSTRY_GUIDANCE|BEST_PRACTICE|AI_SUGGESTION)'/g,
      ),
    ].map((m) => m[1]);
    expect(tiers.length).toBeGreaterThan(6);
    expect(new Set(tiers)).toEqual(
      new Set(["INDUSTRY_GUIDANCE", "BEST_PRACTICE"]),
    );
  });

  it("THE FENCE holds product-wide: no customer-facing surface names ADEM or Suncor", () => {
    const roots = [
      "src/pages",
      "src/components",
      "src/lib",
      "src/services",
      "public",
      "help-articles",
    ];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|html|md|json|txt)$/.test(e.name)) {
          const text = readFileSync(p, "utf8").toLowerCase();
          if (/\badem\b/.test(text) || /\bsuncor\b/.test(text)) {
            offenders.push(p);
          }
        }
      }
    };
    for (const r of roots) walk(r);
    expect(offenders).toEqual([]);
  });

  it("every profile arrives as a DRAFT — the library is a shelf, adoption is the tenant's act", () => {
    // The only status literals written by the seeder are 'draft'.
    const seeder = library.slice(
      library.indexOf(
        "create or replace function public.seed_governance_framework_library(p_target uuid)",
      ),
      library.indexOf(
        "revoke all on function public.seed_governance_framework_library(uuid)",
      ),
    );
    expect(seeder).not.toContain("'adopted'");
    const statuses = [
      ...seeder.matchAll(/'INDUSTRY_GUIDANCE',\s*'(\w+)'/g),
    ].map((m) => m[1]);
    expect(statuses.length).toBe(6);
    expect(new Set(statuses)).toEqual(new Set(["draft"]));
  });

  it("the seeder is service-only; the tenant verb is role-gated and audited", () => {
    expect(library).toContain(
      "grant execute on function public.seed_governance_framework_library(uuid) to service_role;",
    );
    const rpc = library.slice(
      library.indexOf(
        "create or replace function public.seed_governance_framework_library()",
      ),
    );
    expect(rpc).toContain("in ('admin','ai_admin','executive')");
    expect(rpc).toContain("'library_seeded'");
  });
});

describe("tailoring rules + GovernanceIntensity (D3.03/D3.04)", () => {
  it("rules are DATA on versioned adopted rule sets — the risk_criteria_profiles discipline", () => {
    expect(tailoring).toContain(
      "create table if not exists public.governance_tailoring_rule_sets",
    );
    expect(tailoring).toContain(
      "create table if not exists public.governance_tailoring_rules",
    );
    expect(tailoring).toContain(
      "check (status in ('draft','adopted','superseded'))",
    );
    expect(tailoring).toContain("function public.adopt_governance_rule_set");
  });

  it("new tables are SELECT-only to clients: org-scoped read policies, no write policy anywhere in the slice", () => {
    for (const t of [
      "governance_tailoring_rule_sets",
      "governance_tailoring_rules",
      "governance_intensity_bindings",
      "development_case_governance",
    ]) {
      expect(tailoring).toContain(
        `alter table public.${t} enable row level security;`,
      );
      expect(tailoring).toContain(
        `create policy ${t}_read on public.${t}\n  for select to authenticated using (organization_id = app_current_org());`,
      );
    }
    expect(lowerAll).not.toMatch(
      /create policy [^;]*(governance_tailoring|governance_intensity|case_governance)[^;]*for (insert|update|delete|all)/,
    );
  });

  it("the SQL and the pure lib cannot drift: every lib rating token appears verbatim in governance_factor_rating_level", () => {
    const fn = tailoring.slice(
      tailoring.indexOf("function public.governance_factor_rating_level"),
      tailoring.indexOf(
        "create table if not exists public.governance_tailoring_rule_sets",
      ),
    );
    for (const [factor, scale] of Object.entries(FACTOR_RATING_SCALES)) {
      expect(fn).toContain(`when '${factor}' then`);
      for (const rating of scale) {
        expect(fn).toContain(`'${rating}'`);
      }
    }
    for (const level of GOVERNANCE_INTENSITY_LEVELS) {
      expect(tailoring).toContain(`when '${level}' then`);
    }
  });

  it("apply_case_governance refuses NAMING every missing factor, and ai_admin by name", () => {
    const fn = tailoring.slice(
      tailoring.indexOf(
        "create or replace function public.apply_case_governance",
      ),
      tailoring.indexOf(
        "create or replace function public.get_case_governance",
      ),
    );
    expect(fn).toContain("the AI-operator identity cannot record one");
    expect(fn).toContain("'missing_factors', to_jsonb(v_missing)");
    expect(fn).toContain(
      "'value (the case states no sanctioned value and no estimated capex",
    );
    for (const factor of Object.keys(FACTOR_RATING_SCALES)) {
      expect(fn).toContain(`'${factor} (`);
    }
    // No adopted rule set / no matching rule / unadopted framework: all named.
    expect(fn).toContain("no ADOPTED tailoring rule set exists");
    expect(fn).toContain("the compiler selects nothing silently");
    expect(fn).toContain("which has no ADOPTED version in this organization");
  });

  it("a rule floor RAISES intensity only, and the schema refuses a determination below its computed level", () => {
    expect(tailoring).toContain(
      "greatest(v_computed, coalesce(governance_intensity_rank(r.intensity_floor), 0))",
    );
    expect(tailoring).toContain(
      "check (governance_intensity_rank(intensity_level) >= governance_intensity_rank(computed_level))",
    );
  });

  it("the determination is provenance-guarded: clients refused, service admitted AND audited", () => {
    const fn = tailoring.slice(
      tailoring.indexOf("function public.enforce_case_governance_provenance"),
      tailoring.indexOf(
        "drop trigger if exists trg_case_governance_provenance",
      ),
    );
    expect(fn).toContain("current_user not in ('authenticated', 'anon')");
    expect(fn).toContain("insert into security_events");
    expect(fn).toContain("apply_case_governance");
    expect(fn).toContain("A direct write would assert a regime nobody");
  });

  it("one CURRENT determination per case; supersession is recorded, never an edit", () => {
    expect(tailoring).toContain(
      "on development_case_governance(development_case_id) where status = 'current'",
    );
    // Supersede-first (the partial unique index refuses a second current),
    // then stamp the successor id on the retired row.
    expect(tailoring).toContain("set status = 'superseded'");
    expect(tailoring).toContain("set superseded_by = v_id");
  });

  it("adoption is the executability contract: thresholds ascending, rules present, referenced frameworks ADOPTED", () => {
    const fn = tailoring.slice(
      tailoring.indexOf(
        "create or replace function public.adopt_governance_rule_set",
      ),
      tailoring.indexOf(
        "create or replace function public.set_intensity_binding",
      ),
    );
    expect(fn).toContain(
      "value_thresholds must state the three ascending band boundaries",
    );
    expect(fn).toContain("it has no rules");
    expect(fn).toContain("'unresolved_frameworks', to_jsonb(v_unresolved)");
  });

  it("binding seeds arm evidence + assurance at elevated AND full, all as DRAFTS", () => {
    const seeds = tailoring.slice(
      tailoring.indexOf("function public.seed_governance_tailoring_defaults"),
      tailoring.indexOf(
        "revoke all on function public.seed_governance_tailoring_defaults",
      ),
    );
    expect(seeds).toContain("('elevated', true, true, 'line_2', 45,");
    expect(seeds).toContain("('full', true, true, 'independent', 30,");
    expect(seeds).not.toContain("'adopted'");
  });

  it("future tenants get the shelf too: provision_organization re-created to call both seeders", () => {
    expect(tailoring).toContain("seed_governance_framework_library(v_new)");
    expect(tailoring).toContain("seed_governance_tailoring_defaults(v_new)");
  });
});

describe("intensity binding is ENFORCED at the persistence boundary (D3.05)", () => {
  it("a BEFORE-trigger on stage_gate_reviews raises check_violation for clients", () => {
    expect(enforcement).toContain(
      "create trigger trg_intensity_governance_binding\n  before insert or update on public.stage_gate_reviews",
    );
    const fn = enforcement.slice(
      enforcement.indexOf(
        "function public.enforce_intensity_governance_binding",
      ),
      enforcement.indexOf(
        "drop trigger if exists trg_intensity_governance_binding",
      ),
    );
    expect(fn).toMatch(/check_violation/);
    expect(fn).toContain(
      "refused at the persistence boundary, not advised against",
    );
  });

  it("absence enforces nothing (the enforce_authority_limit posture), adoption arms it — through the MONOTONE resolver", () => {
    const fn = enforcement.slice(
      enforcement.indexOf(
        "function public.enforce_intensity_governance_binding",
      ),
      enforcement.indexOf("drop trigger"),
    );
    expect(fn).toContain("if v_gov.id is null then\n    return new;");
    expect(fn).toContain("if v_bind.id is null then\n    return new;");
    expect(fn).toContain(
      "resolve_case_intensity_binding(v_gov.organization_id, v_gov.intensity_level)",
    );
    // The resolver itself: only ADOPTED rows arm, and absence at a level
    // falls back to the STRONGEST adopted binding below it — raising a
    // case's intensity can never disarm enforcement.
    const resolver = tailoring.slice(
      tailoring.indexOf(
        "create or replace function public.resolve_case_intensity_binding",
      ),
      tailoring.indexOf(
        "create or replace function public.enforce_governance_config_provenance",
      ),
    );
    expect(resolver).toMatch(/b\.status = 'adopted'/);
    expect(resolver).toContain(
      "governance_intensity_rank(b.intensity_level) <= governance_intensity_rank(p_level)",
    );
    expect(resolver).toContain(
      "order by governance_intensity_rank(b.intensity_level) desc, b.version desc",
    );
  });

  it("UPDATE re-litigation covers every subject the predicate reads: outcome, gate, case AND reviewer", () => {
    const fn = enforcement.slice(
      enforcement.indexOf(
        "function public.enforce_intensity_governance_binding",
      ),
      enforcement.indexOf("drop trigger"),
    );
    expect(fn).toContain("new.outcome is not distinct from old.outcome");
    expect(fn).toContain("new.gate_id is not distinct from old.gate_id");
    expect(fn).toContain(
      "new.development_case_id is not distinct from old.development_case_id",
    );
    expect(fn).toContain(
      "new.reviewed_by is not distinct from old.reviewed_by",
    );
  });

  it("the service path is admitted AND audited, never silent", () => {
    const fn = enforcement.slice(
      enforcement.indexOf(
        "function public.enforce_intensity_governance_binding",
      ),
      enforcement.indexOf("drop trigger"),
    );
    expect(fn).toContain("insert into security_events");
    expect(fn).toContain("in violation of the adopted intensity binding");
  });

  it("the demand is ACCEPTED deliverables behind every MANDATORY criterion — stated ONCE, in the shared predicate", () => {
    const helper = tailoring.slice(
      tailoring.indexOf(
        "create or replace function public.case_binding_gate_demands",
      ),
      tailoring.indexOf(
        "revoke all on function public.case_binding_gate_demands",
      ),
    );
    expect(helper).toContain("d.requirement_id = sc.id");
    expect(helper).toContain("d.status = 'accepted'");
    expect(helper).toContain("sc.is_mandatory");
    // The stored-review independence arm: a passing latest review by the
    // sponsor/creator does not satisfy the binding, whenever it was written.
    expect(helper).toContain(
      "lr.outcome in ('proceed','proceed_with_conditions')",
    );
    expect(helper).toContain(
      "(lr.reviewed_by = c.sponsor_id or lr.reviewed_by = c.created_by)",
    );
    // Every consumer reads the helper, never a private copy: trigger, gate
    // RPC, advance, sanction, apply and the governance read.
    expect(
      enforcement.match(/case_binding_gate_demands\(/g)?.length,
    ).toBeGreaterThanOrEqual(4);
    expect(enforcement).not.toContain("d.requirement_id = sc.id");
  });

  it("record_case_gate_review carries the same refusals as named jsonb (door), trigger as wall", () => {
    const fn = enforcement.slice(
      enforcement.indexOf(
        "create or replace function public.record_case_gate_review",
      ),
    );
    expect(fn).toContain("'unlinked_mandatory', to_jsonb(v_unlinked)");
    expect(fn).toContain("carry no ACCEPTED deliverable for this case");
    expect(fn).toContain(
      "cannot record any of its gate decisions (segregation of duties)",
    );
  });

  it("the re-creation preserved every prior guard it was assembled from", () => {
    const fn = enforcement.slice(
      enforcement.indexOf(
        "create or replace function public.record_case_gate_review",
      ),
    );
    // D1.02 contract-before-design, duplicate-finding integrity, mandatory
    // block, condition contract, evaluation link — all still present.
    expect(fn).toContain("success is established before design begins");
    expect(fn).toContain("duplicate finding for criterion");
    expect(fn).toContain(
      "silence and not-assessed block for the same reason a failure does",
    );
    expect(fn).toContain(
      "proceed_with_conditions requires at least one condition",
    );
    expect(fn).toContain("record_case_value_evaluation and link it here");
    expect(fn).toContain("a §70 human determination");
  });

  it("advance AND sanction re-validate the binding AT THE ACT — a pass recorded before arming cannot carry either", () => {
    // Both re-created with marked insertions calling the ONE predicate; the
    // latest-review gate-pass test itself stays stated exactly once per act
    // (no parallel evaluator: the insertion adds the BINDING predicate, it
    // does not restate the gate-pass predicate).
    const adv = enforcement.slice(
      enforcement.indexOf(
        "create or replace function public.advance_development_case_stage",
      ),
      enforcement.indexOf(
        "create or replace function public.sanction_development_case",
      ),
    );
    const san = enforcement.slice(
      enforcement.indexOf(
        "create or replace function public.sanction_development_case",
      ),
    );
    for (const fn of [adv, san]) {
      expect(fn).toContain("case_binding_gate_demands(c.id, null)");
      expect(fn).toContain("'binding_demands', v_demands");
      expect(
        fn.match(/order by r\.reviewed_at desc, r\.id desc/g)?.length,
      ).toBe(1);
    }
    // Re-creation preserved the prior guards they were assembled from.
    expect(adv).toContain("skipping a stage would skip its gates");
    expect(adv).toContain("blocking_gates");
    expect(san).toContain("no ADOPTED sanction authority");
    expect(san).toContain("sanction ceiling");
    expect(san).toContain("a §70 human determination");
    // Sanction also refuses a value that bands above the determined value
    // level — against the determination's OWN frozen thresholds.
    expect(san).toContain("bands above the value level");
    expect(san).toContain("factor_inputs->'value_thresholds'");
    // And a non-finite commitment.
    expect(san).toContain("a sanctioned value must be a finite amount");
  });
});

describe("repair contract: the adversarial-review fixes stay fixed", () => {
  it("non-finite numbers are refused at every door: creation, determination, sanction", () => {
    // numeric NaN/Infinity satisfy >= 0 checks and band above every
    // threshold in Postgres — each door refuses them by name.
    expect(orgTree).toContain("estimated_capex must be a finite amount");
    expect(orgTree).toContain("p_estimated_capex = 'NaN'::numeric");
    const apply = tailoring.slice(
      tailoring.indexOf(
        "create or replace function public.apply_case_governance",
      ),
      tailoring.indexOf(
        "create or replace function public.get_case_governance",
      ),
    );
    expect(apply).toContain("v_value = 'NaN'::numeric");
    expect(apply).toContain("is not a finite amount");
  });

  it("off-scale ratings ACCUMULATE beside missing ones — the lib mirror's behavior, drivers in the spec's factor order", () => {
    const apply = tailoring.slice(
      tailoring.indexOf(
        "create or replace function public.apply_case_governance",
      ),
      tailoring.indexOf(
        "create or replace function public.get_case_governance",
      ),
    );
    expect(apply).toContain("missing or not on their stated scales");
    // Off-scale appends into the one refusal, never an early return.
    expect(apply).toContain(
      `format('risk ("%s" is not on the stated scale: low, medium, high, critical)', btrim(p_risk))`,
    );
    // Drivers ordered by the spec I.2 factor order, not alphabetically.
    expect(apply).toContain(
      "(values ('value',1),('risk',2),('complexity',3),('novelty',4),",
    );
    expect(apply).toContain("('regulatory_exposure',5),('interfaces',6))");
    expect(apply).not.toContain("order by v.key");
  });

  it("concurrent determinations serialize on a per-case advisory lock — supersession chains, no raw 23505", () => {
    const apply = tailoring.slice(
      tailoring.indexOf(
        "create or replace function public.apply_case_governance",
      ),
      tailoring.indexOf(
        "create or replace function public.get_case_governance",
      ),
    );
    expect(apply).toContain(
      "pg_advisory_xact_lock(hashtextextended('development_case_governance:' || p_case_id::text, 0))",
    );
  });

  it("a rule set is immutable but never a dead end: the succession verb exists and clones the rules", () => {
    const fn = tailoring.slice(
      tailoring.indexOf(
        "create or replace function public.create_governance_rule_set_version",
      ),
      tailoring.indexOf(
        "revoke all on function public.create_governance_rule_set_version",
      ),
    );
    expect(fn).toContain(
      "from governance_tailoring_rules where rule_set_id = rs.id",
    );
    expect(fn).toContain("already exists — edit and adopt that one");
    expect(fn).toContain("'version_drafted'");
    expect(tailoring).toContain(
      "grant execute on function public.create_governance_rule_set_version(uuid) to authenticated;",
    );
  });

  it("adopted means THE one configuration: adoption supersedes every adopted set and a partial unique index enforces it", () => {
    expect(tailoring).toContain(
      "create unique index if not exists idx_gov_rule_sets_one_adopted",
    );
    expect(tailoring).toContain(
      "on governance_tailoring_rule_sets(organization_id) where status = 'adopted';",
    );
    // The supersede is org-wide, not same-name-only.
    expect(tailoring).toContain(
      "update governance_tailoring_rule_sets set status = 'superseded', superseded_by = rs.id\n  where organization_id = v_org and status = 'adopted';",
    );
  });

  it("the ARMING tables carry the §70 provenance backstop: clients refused even RLS-bypassed, service admitted AND audited", () => {
    const fn = tailoring.slice(
      tailoring.indexOf("function public.enforce_governance_config_provenance"),
      tailoring.indexOf("drop trigger if exists trg_gov_rule_sets_provenance"),
    );
    expect(fn).toContain("current_user not in ('authenticated', 'anon')");
    expect(fn).toContain("insert into security_events");
    expect(fn).toContain("outside the governance authoring RPCs");
    expect(fn).toContain("insufficient_privilege");
    for (const trg of [
      "trg_gov_rule_sets_provenance",
      "trg_gov_rules_provenance",
      "trg_gov_bindings_provenance",
    ]) {
      expect(tailoring).toContain(`create trigger ${trg}`);
    }
    // Every legitimate writer holds the transaction-local marker.
    for (const rpc of [
      "set_rule_set_thresholds",
      "add_tailoring_rule",
      "adopt_governance_rule_set",
      "create_governance_rule_set_version",
      "set_intensity_binding",
      "adopt_intensity_binding",
      "seed_governance_tailoring_defaults",
    ]) {
      const body = tailoring.slice(
        tailoring.indexOf(`create or replace function public.${rpc}`),
        tailoring.indexOf(`revoke all on function public.${rpc}`),
      );
      expect(body).toContain(
        "set_config('app.governance_config_write', 'granted', true)",
      );
    }
  });

  it("sub-organization names are TENANT-scoped (no cross-tenant oracle) and the check-then-insert race is locked", () => {
    const fn = orgTree.slice(
      orgTree.indexOf(
        "create or replace function public.create_sub_organization",
      ),
      orgTree.indexOf(
        "create or replace function public.set_organization_node",
      ),
    );
    expect(fn).toContain(
      "pg_advisory_xact_lock(hashtextextended('organizations.name:' || lower(trim(p_name)), 0))",
    );
    expect(fn).toContain("org_node_in_scope(o.id, v_org)");
    expect(fn).not.toContain(
      "if exists (select 1 from organizations where name = trim(p_name)) then",
    );
  });

  it("the seeded reference rule 40 carries the elevated floor its description states", () => {
    expect(tailoring).toContain(
      "'Brownfield Modification — Operating Site', 'elevated');",
    );
  });

  it("the governance read exposes the enforcement truth: resolved binding, live unmet demands, value source, and the draft shelf", () => {
    const fn = tailoring.slice(
      tailoring.indexOf(
        "create or replace function public.get_case_governance",
      ),
      tailoring.indexOf("revoke all on function public.get_case_governance"),
    );
    expect(fn).toContain(
      "from resolve_case_intensity_binding(v_org, g.intensity_level)",
    );
    expect(fn).toContain(
      "'bindingUnmet', case_binding_gate_demands(c.id, null)",
    );
    expect(fn).toContain("'caseValueSource'");
    expect(fn).toContain("'draftRuleSets'");
    expect(fn).toContain("'draftBindings'");
  });

  it("the determination itself surfaces its unmet demands and the monotone fallback, at once", () => {
    const apply = tailoring.slice(
      tailoring.indexOf(
        "create or replace function public.apply_case_governance",
      ),
      tailoring.indexOf(
        "create or replace function public.get_case_governance",
      ),
    );
    expect(apply).toContain(
      "b := resolve_case_intensity_binding(v_org, v_names[v_effective]);",
    );
    expect(apply).toContain(
      "v_demands := case_binding_gate_demands(c.id, null);",
    );
    expect(apply).toContain("'binding_unmet', v_demands");
    expect(apply).toContain("strongest adopted binding at-or-below applies");
  });
});
