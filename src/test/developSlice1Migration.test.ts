/**
 * Sync Develop Slice 1 — migration contract (static, no database).
 *
 * The live behavior is proven by scripts/ci-develop-slice1-smoke.sh against
 * a real local database (two-role transcripts, refusals exercised). This
 * file pins the CONTRACT in the migration text so a later edit that
 * loosens a §70 boundary, drops a revoke, or forks the canonical stores
 * fails CI before it reaches a database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));

const stages = read("20261101090000_develop_canonical_stage_additions.sql");
const frameworks = read("20261101090100_project_frameworks.sql");
const cases = read("20261101090200_development_cases.sql");
const gates = read("20261101090300_gate_generalization.sql");
const provenance = read("20261101090400_gate_requirement_provenance.sql");
const sanction = read("20261101090500_sanction_authority.sql");
const seed = read("20261101090600_develop_reference_framework_seed.sql");
const lowerAll = [stages, frameworks, cases, gates, provenance, sanction, seed]
  .join("\n")
  .toLowerCase();

describe("canonical stages (D3.23/D11.10 — ruling 2)", () => {
  it("adds the five missing master stages to lifecycle_stages, not to a second vocabulary", () => {
    expect(stages).toContain("insert into lifecycle_stages");
    for (const key of [
      "'assure'",
      "'sanction'",
      "'stabilize'",
      "'realize'",
      "'learn'",
    ]) {
      expect(stages).toContain(key);
    }
    expect(lowerAll).not.toContain("create table if not exists public.framework_stages_vocabulary");
  });

  it("teaches the coarse-status mapper the in_service additions", () => {
    expect(stages).toMatch(
      /'operation',\s*'maintenance',\s*'modification',\s*\n?\s*'stabilize',\s*'realize',\s*'learn'/,
    );
  });
});

describe("ProjectFramework (D3.01/D3.22/D3.37)", () => {
  it("framework stages MAP to lifecycle_stages.stage_key", () => {
    expect(frameworks).toMatch(
      /project_framework_stages[\s\S]*?stage_key text not null references lifecycle_stages\(stage_key\)/,
    );
  });

  it("versioning copies the adopt_risk_criteria discipline: draft → adopted → superseded", () => {
    expect(frameworks).toContain(
      "check (status in ('draft','adopted','superseded'))",
    );
    expect(frameworks).toContain("set status = 'superseded', superseded_by");
    expect(frameworks).toMatch(/only draft frameworks can be adopted/i);
  });

  it("a checkpoint is a lighter gate row on the SAME family — no parallel table", () => {
    expect(frameworks).toContain(
      "decision_type text not null default 'gate' check (decision_type in ('gate','checkpoint'))",
    );
    expect(lowerAll).not.toMatch(/create table[^;]*checkpoints/);
  });

  it("every new table enables RLS with an org-scoped read policy and a drop guard", () => {
    for (const [sql, table] of [
      [frameworks, "project_frameworks"],
      [frameworks, "project_framework_stages"],
      [frameworks, "stage_gates"],
      [cases, "development_cases"],
      [gates, "gate_conditions"],
    ] as const) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`drop policy if exists ${table}_read`);
      expect(sql).toMatch(
        new RegExp(
          `create policy ${table}_read on public\\.${table}\\s+for select to authenticated using \\(organization_id = app_current_org\\(\\)\\)`,
        ),
      );
    }
  });
});

describe("gate generalization (D3.24/D3.06 — ruling 1)", () => {
  it("extends stage_gate_reviews rather than creating a parallel review store", () => {
    expect(gates).toContain(
      "add column if not exists development_case_id uuid references development_cases(id)",
    );
    expect(lowerAll).not.toMatch(/create table[^;]*case_gate_reviews/);
  });

  it("carries the reconciled eight-outcome union beside the legacy vocabulary", () => {
    expect(gates).toContain(
      "('pass','pass_with_conditions','hold',\n     'proceed','proceed_with_conditions','recycle','pivot','redesign','pause','terminate')",
    );
  });

  it("documents the I.5-vs-§6 reconciliation in the migration itself", () => {
    const raw = readFileSync(
      "supabase/migrations/20261101090300_gate_generalization.sql",
      "utf8",
    );
    expect(raw).toContain("PART I.5:");
    expect(raw).toContain("PART III §6:");
    expect(raw).toContain("the UNION, eight values");
  });

  it("conditions stay mandatory on a conditional pass in BOTH vocabularies", () => {
    expect(gates).toContain(
      "outcome not in ('pass_with_conditions','proceed_with_conditions')",
    );
  });

  it("gate_conditions carries the full II.16 contract, nothing optional", () => {
    for (const col of [
      "owner_id uuid not null",
      "due_date date not null",
      "evidence_requirement text not null",
      "consequence_if_missed text not null",
    ]) {
      expect(gates).toContain(col);
    }
  });

  it("the record RPC repeats assessGate's discipline at the DB — silence blocks", () => {
    expect(gates).toContain("not explicitly met in this review");
    expect(gates).toMatch(/silence and not-assessed block/);
    expect(gates).toContain(
      "this gate defines no criteria, so it can block nothing",
    );
  });

  it("§70: outcome writes require the transaction-local marker; clients are refused", () => {
    expect(gates).toContain("app.gate_review_write");
    expect(gates).toMatch(
      /current_user in \('authenticated', 'anon'\)/,
    );
    expect(gates).toContain("using errcode = 'insufficient_privilege'");
    // The trigger is SECURITY INVOKER — a DEFINER trigger would make the
    // client-role check a tautology.
    expect(gates).not.toMatch(
      /function public\.enforce_gate_review_provenance\(\)[\s\S]{0,200}security definer/i,
    );
  });

  it("ai_admin is refused by name — a gate decision is a §70 human determination", () => {
    expect(gates).toContain("the AI-operator identity cannot record one");
  });
});

describe("requirement provenance (D3.25/D3.14/D3.15)", () => {
  it("the eight tiers land ON stage_gate_criteria — no parallel requirement table", () => {
    expect(provenance).toContain("alter table public.stage_gate_criteria");
    expect(provenance).toContain(
      "('LAW','REGULATION','CORPORATE_STANDARD','PROJECT_FRAMEWORK','CONTRACT',\n       'INDUSTRY_GUIDANCE','BEST_PRACTICE','AI_SUGGESTION')",
    );
    expect(lowerAll).not.toMatch(/create table[^;]*gate_requirements/);
  });

  it("the promotion invariant ships in the SAME migration as the column", () => {
    expect(provenance).toContain("enforce_requirement_authority_provenance");
    expect(provenance).toMatch(
      /source_authority_rank\(new\.source_authority\) > source_authority_rank\(old\.source_authority\)/,
    );
    expect(provenance).toContain(
      "using errcode = 'insufficient_privilege'",
    );
  });

  it("a raise requires the RECORDED human even on the marked path", () => {
    expect(provenance).toContain("new.authority_promoted_by is null");
    expect(provenance).toMatch(/at least 20 characters/i);
  });

  it("the promotion RPC is admin/executive only — not ai_admin", () => {
    expect(provenance).toMatch(
      /promote_requirement_authority[\s\S]*?not in \('admin','executive'\)/,
    );
  });

  it("existing EN 16646 seeds are backfilled to INDUSTRY_GUIDANCE before the trigger exists", () => {
    const backfill = provenance.indexOf("set source_authority = 'INDUSTRY_GUIDANCE'");
    const trigger = provenance.indexOf("create trigger trg_requirement_authority_provenance");
    expect(backfill).toBeGreaterThan(-1);
    expect(trigger).toBeGreaterThan(backfill);
  });

  it("template cloning carries the tier and excludes gate-scoped rows", () => {
    expect(provenance).toContain("and gate_id is null;");
    expect(provenance).toMatch(
      /insert into stage_gate_criteria[\s\S]*?source_authority\)\s*select v_new/,
    );
  });
});

describe("sanction (D1.04/D1.05/D3.34)", () => {
  it("problem-first intake refuses a token-thin problem statement", () => {
    expect(cases).toContain(
      "a development case begins with the problem, not the project",
    );
    expect(cases).toContain("problem_statement text not null");
  });

  it("lifecycle_type is the nine-value §3 enum", () => {
    expect(cases).toContain(
      "('greenfield','brownfield','sustaining_capital','replacement',\n     'reliability_improvement','regulatory','capacity','life_extension',\n     'decommissioning')",
    );
  });

  it("the case references canonical stores instead of duplicating them", () => {
    expect(cases).toContain("references risk_objectives(id)");
    expect(cases).toContain("references capital_projects(id)");
    expect(cases).toContain("references lifecycle_stages(stage_key)");
  });

  it("authority_limits gains action_type — the ONE authority store, extended", () => {
    expect(sanction).toContain(
      "check (action_type in ('general','sanction','regulatory_variance'))",
    );
    expect(lowerAll).not.toMatch(/create table[^;]*sanction_authorities/);
  });

  it("every per-role general-ladder consumer now names action_type = 'general'", () => {
    // adopt supersede + enforce + accept_risk x2 + decide + two extended
    // triggers = at least 6 predicates besides the sanction RPC's own.
    const hits = sanction.match(/action_type\s*=\s*'general'/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(6);
    expect(sanction).toContain("and action_type = l.action_type");
  });

  it("sanction is FAIL-CLOSED: no adopted delegation, no sanction — and no admin bypass", () => {
    expect(sanction).toContain("no ADOPTED sanction authority exists");
    expect(sanction).toMatch(
      /action_type = 'sanction' and status = 'adopted'/,
    );
    // The refusal branch has no admin/ai_admin exemption before it.
    expect(sanction).not.toMatch(
      /sanction_development_case[\s\S]*?if v_role in \('admin', 'ai_admin'\) then\s*return new/,
    );
  });

  it("ai_admin cannot sanction, by name", () => {
    expect(sanction).toContain(
      "the AI-operator identity cannot sanction a case",
    );
  });

  it("a sanction is never overwritten", () => {
    expect(sanction).toContain("A sanction is not overwritable");
  });

  it("§70: the case table refuses client sanction writes without the marker", () => {
    expect(cases).toContain("app.development_sanction_write");
    expect(cases).toContain("trg_development_sanction_provenance");
    expect(cases).toContain("using errcode = 'insufficient_privilege'");
  });

  it("the seeded sanction delegations are DRAFTS with placeholder-named bases", () => {
    expect(sanction).toMatch(/'sanction', v\.usd/);
    expect(sanction).toContain("Placeholder amount");
    expect(sanction).not.toMatch(
      /insert into authority_limits[\s\S]{0,600}'adopted'/,
    );
  });
});

describe("definer hygiene (the ratchet this repo enforces)", () => {
  it("every new SECURITY DEFINER function revokes from public and anon", () => {
    for (const name of [
      "create_project_framework",
      "add_framework_stage",
      "add_framework_gate",
      "adopt_project_framework",
      "create_development_case",
      "record_case_gate_review",
      "advance_development_case_stage",
      "set_gate_requirement",
      "promote_requirement_authority",
      "create_project_framework_version",
      "sanction_development_case",
      "get_development_case",
    ]) {
      expect(lowerAll).toMatch(
        new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`),
      );
    }
  });

  it("every new definer RPC resolves the tenant from the session", () => {
    for (const sql of [frameworks, cases, gates, provenance, sanction]) {
      const definers = sql.match(/create or replace function[\s\S]*?\$\$;/g) ?? [];
      for (const fn of definers) {
        if (!/security definer/i.test(fn)) continue;
        if (/returns trigger/i.test(fn)) continue;
        // Re-created pre-existing functions keep their own idioms; new
        // Develop RPCs must open with the session-org guard.
        if (!/develop|framework|gate_requirement|requirement_authority/.test(fn)) continue;
        expect(fn).toMatch(/app_current_org\(\)/);
      }
    }
  });
});

describe("demo seed honesty (register standing constraint 1)", () => {
  it("is INDUSTRY_GUIDANCE, demo-tenant-gated, and never claims to be ADEM", () => {
    expect(seed).toContain("'INDUSTRY_GUIDANCE'");
    expect(seed).toContain("11111111-1111-1111-1111-111111111111");
    expect(seed).toMatch(/if not exists \(select 1 from organizations where id = v_org\)/);
    expect(seed.toLowerCase()).not.toContain("adem");
    expect(seed.toLowerCase()).not.toContain("suncor");
  });

  it("demonstrates the checkpoint member and the AI_SUGGESTION floor", () => {
    expect(seed).toContain("'checkpoint'");
    expect(seed).toContain("'AI_SUGGESTION'");
  });
});
