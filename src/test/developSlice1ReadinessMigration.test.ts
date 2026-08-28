/**
 * Sync Develop Slice 1 rows 9–12 — migration contract (static, no database).
 *
 * Live behavior is proven by scripts/ci-develop-slice1-smoke.sh steps 18–21
 * against a real local database. This file pins the CONTRACT in the
 * migration text — the six baseline types, the immutability backstop, the
 * §45 mandatory-block-at-any-percentage, the projection's refusal
 * thresholds, ruling 17's no-parallel-readiness-store, and the §70 advisory
 * boundary of the evidence agent — so a later edit that loosens any of them
 * fails CI before it reaches a database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const baselines = read("20261110090000_develop_baselines.sql");
const readiness = read("20261110090100_develop_gate_readiness.sql");
const readinessRaw = raw("20261110090100_develop_gate_readiness.sql");
const operational = read("20261110090200_develop_operational_readiness.sql");
const workspace = read("20261110090300_develop_workspace_read_v3.sql");
const lowerAll = [baselines, readiness, operational, workspace]
  .join("\n")
  .toLowerCase();

describe("baselines (D5.26, spec §20)", () => {
  it("carries the six types VERBATIM and only those", () => {
    expect(baselines).toContain(
      "('SCOPE','COST','SCHEDULE','DESIGN','RISK','BENEFITS')",
    );
  });

  it("a baseline is born a draft; approval and status are structurally paired", () => {
    expect(baselines).toMatch(/\(status = 'draft'\) = \(approved_at is null\)/);
    expect(baselines).toMatch(
      /\(status = 'superseded'\) = \(superseded_at is not null\)/,
    );
  });

  it("exactly one approved version per (case, type)", () => {
    expect(baselines).toMatch(
      /idx_dev_baseline_one_approved[\s\S]*?where status = 'approved'/,
    );
  });

  it("prior versions are immutable at the persistence boundary — the framework backstop pattern", () => {
    expect(baselines).toContain("enforce_baseline_immutability");
    // Guarded: non-draft insert (forged approval), non-draft update/delete,
    // and any status transition.
    expect(baselines).toMatch(/new\.status <> 'draft'/);
    expect(baselines).toMatch(/old\.status <> 'draft'/);
    expect(baselines).toMatch(/new\.status is distinct from old\.status/);
    // Client refused even with RLS bypassed; service admitted AND audited.
    expect(baselines).toMatch(/insufficient_privilege/);
    expect(baselines).toMatch(/insert into security_events/);
    // BEFORE DELETE returns OLD so cascades proceed.
    expect(baselines).toMatch(
      /return case when tg_op = 'DELETE' then old else new end/,
    );
    expect(baselines).toMatch(
      /before insert or update or delete on public\.development_baselines/,
    );
  });

  it("approval is a definer-RPC act recording approved_by/approved_at; ai_admin refused by name", () => {
    expect(baselines).toContain("approve_case_baseline");
    expect(baselines).toMatch(
      /set status = 'approved', approved_by = auth\.uid\(\), approved_at = now\(\)/,
    );
    expect(baselines).toMatch(/AI-operator identity/);
    // Approval supersedes the previously approved version of the same type.
    expect(baselines).toMatch(/set status = 'superseded', superseded_at = now\(\)/);
  });

  it("the C2.15 intake rail stays the only document door", () => {
    expect(baselines).toMatch(/kb_intake_documents/);
    expect(baselines).toMatch(/intake register/);
  });

  it("no client write policy exists on development_baselines", () => {
    expect(baselines).toMatch(/development_baselines_read[\s\S]*?for select/);
    expect(baselines).not.toMatch(
      /create policy [\w]* on public\.development_baselines[\s\S]{0,200}for (insert|update|delete|all)/i,
    );
  });
});

describe("gate readiness (D3.35/D13.05, spec §45)", () => {
  it("weight is configurable per criterion with default 1.0 and a positive check", () => {
    expect(readiness).toMatch(
      /add column if not exists weight numeric not null default 1\.0/,
    );
    expect(readiness).toMatch(/check \(weight > 0\)/);
  });

  it("GR = Σ(w·r)/Σw, and r counts ONLY an explicit met", () => {
    expect(readiness).toMatch(/v_weighted_met \/ v_weight_sum/);
    expect(readiness).toMatch(
      /sum\(sc\.weight\) filter \(where coalesce\(fi\.status, ''\) = 'met'\)/,
    );
  });

  it("one unmet mandatory — or never assessed — forces BLOCKED at any percentage", () => {
    expect(readiness).toMatch(
      /v_blocked := v_criteria_total = 0 or v_mandatory_met < v_mandatory_total/,
    );
    // The comment carries the rule; the code carries the coalesce that makes
    // absence score zero.
    expect(readinessRaw).toMatch(/forces BLOCKED at ANY percentage/i);
    expect(readinessRaw).toMatch(/absence is not a pass/i);
  });

  it("an empty gate has NULL readiness, never 0 or 100", () => {
    expect(readiness).toMatch(
      /case when v_weight_sum > 0\s*then round/,
    );
  });

  it("finding↔criterion matching mirrors the record RPC's text rule", () => {
    expect(readiness).toMatch(
      /btrim\(fi\.criterion_text\) = btrim\(sc\.criterion\)/,
    );
  });

  it("uncategorized rolls up visibly, ranked last — never dropped", () => {
    expect(readiness).toMatch(/'uncategorized'/);
    expect(readiness).toMatch(/when 'uncategorized' then 99/);
  });

  it("blockers are NAMED and typed: mandatory criteria, open High/Critical risks, open conditions", () => {
    expect(readiness).toMatch(/'type', 'mandatory_criterion'/);
    expect(readiness).toMatch(/'type', 'open_risk'/);
    expect(readiness).toMatch(/'type', 'open_condition'/);
    expect(readiness).toMatch(
      /r\.current_risk_level in \('High', 'Critical'\)/,
    );
    expect(readiness).toMatch(
      /r\.status not in \('closed', 'archived', 'accepted'\)/,
    );
    expect(readiness).toMatch(/gc\.status = 'open'/);
  });

  it("the projection refuses below its derived thresholds and never fabricates a date", () => {
    // Threshold 1: three closure events (never extrapolate from two points).
    expect(readiness).toMatch(/v_events < 3/);
    expect(readiness).toMatch(/not yet: %s of 3 closure events recorded/);
    // Threshold 2: at least one day of observed span.
    expect(readiness).toMatch(/v_span_days < 1/);
    expect(readiness).toMatch(/sub-day history/);
    // The derivation is documented in the migration itself.
    expect(readinessRaw).toMatch(/n−1 intervals|n-1 intervals/i);
    expect(readinessRaw).toMatch(/two points are never[\s-]+extrapolated/i);
  });

  it("the projection rate is mean inter-arrival over the observed span", () => {
    expect(readiness).toMatch(/v_rate := \(v_events - 1\) \/ v_span_days/);
    // Days-to-close divides ONCE (remaining·span/(n−1)) so numeric
    // representation error cannot leak a whole extra day through ceil().
    expect(readiness).toMatch(
      /ceil\(v_remaining \* v_span_days \/ \(v_events - 1\)\)::int/,
    );
  });

  it("the readiness read is SECURITY INVOKER so the risk-sensitivity boundary applies", () => {
    expect(readiness).toMatch(
      /get_gate_readiness[\s\S]*?security invoker/,
    );
  });

  it("versioning carries weight on the clone — no silent reset to 1.0", () => {
    expect(readiness).toMatch(
      /insert into stage_gate_criteria[\s\S]*?weight, authority_promoted_by/,
    );
  });

  it("set_gate_requirement refuses a non-positive weight by name", () => {
    expect(readiness).toMatch(/zero-weight requirement would vanish/);
  });
});

describe("operational readiness (D8.08/D8.11 — ruling 17, no parallel store)", () => {
  it("extends the ONE catalog: ori_category carries the thirteen §30 categories", () => {
    for (const cat of [
      "asset_master",
      "bom",
      "spares",
      "pm",
      "task_list",
      "procedure",
      "training",
      "inspection",
      "condition_monitoring",
      "vendor_support",
      "documentation",
      "cyber",
      "emergency_response",
    ]) {
      expect(operational).toContain(`'${cat}'`);
    }
    expect(operational).toMatch(
      /alter table public\.onboarding_requirements/,
    );
  });

  it("creates NO parallel readiness-item table", () => {
    // The only new table is the scope membership; items stay
    // asset_onboarding_items.
    const created = [...operational.matchAll(/create table if not exists ([\w.]+)/g)].map(
      (m) => m[1],
    );
    expect(created).toEqual(["public.development_case_assets"]);
    expect(operational).toMatch(/asset_onboarding_items/);
  });

  it("new catalog entries do NOT tighten the live go-live gate", () => {
    // Every inserted row carries required_for_golive = false; safety items
    // carry the flag instead.
    const insertBlock = operational.slice(
      operational.indexOf("insert into onboarding_requirements"),
      operational.indexOf("on conflict (key) do nothing"),
    );
    expect(insertBlock).not.toMatch(/'human', true/);
    expect(insertBlock).toMatch(/'human', false/);
  });

  it("safety/mission-critical is a restrained named set, not a relabeling", () => {
    expect(operational).toMatch(
      /'s16_safety_critical','s16_loto_requirements','s10_statutory_inspections'/,
    );
  });

  it("a missing item row counts as OPEN — absence is not a pass", () => {
    expect(operational).toMatch(/left join asset_onboarding_items/);
    expect(operational).toMatch(/coalesce\(i\.status, 'missing'\)/);
  });

  it("the case read extends the get_golive_readiness family: same satisfied set", () => {
    expect(operational).toMatch(
      /'auto_filled','deduced','human_provided','not_applicable'/,
    );
    expect(operational).toMatch(/get_case_operational_readiness/);
  });

  it("scope membership is definer-RPC-only: select policy, no client writes", () => {
    expect(operational).toMatch(
      /development_case_assets_read[\s\S]*?for select/,
    );
    expect(operational).not.toMatch(
      /create policy [\w]* on public\.development_case_assets[\s\S]{0,200}for (insert|update|delete|all)/i,
    );
    expect(operational).toMatch(/bind_asset_to_development_case/);
    expect(operational).toMatch(/records why \(10 characters minimum\)/);
  });

  it("the first-cut boundary is stated: per-asset now, system scope in Slice 8", () => {
    expect(operational).toMatch(/per-commissioning-system scope completes in Slice 8/);
  });
});

describe("workspace read v3", () => {
  it("criteria carry weight and the case carries its baselines", () => {
    expect(workspace).toMatch(/'weight', sc\.weight/);
    expect(workspace).toMatch(/'baselines', coalesce\(\(/);
    expect(workspace).toMatch(/from development_baselines b/);
  });
});

describe("the evidence agent boundary (D12.07, §70 absolute)", () => {
  const core = readFileSync(
    "supabase/functions/_shared/develop-evidence-core.ts",
    "utf8",
  );
  const fn = readFileSync(
    "supabase/functions/develop-evidence-agent/index.ts",
    "utf8",
  );
  const boundary = JSON.parse(
    readFileSync("config/edge-function-boundary.json", "utf8"),
  ) as { activeFunctions: string[]; blockedLegacyFunctions: string[] };

  it("is deployable: named in the active boundary, not in the blocked list", () => {
    expect(boundary.activeFunctions).toContain("develop-evidence-agent");
    expect(boundary.blockedLegacyFunctions).not.toContain(
      "develop-evidence-agent",
    );
  });

  it("the §70 disclaimer is structural — every result carries it", () => {
    expect(core).toMatch(/ADVISORY_DISCLAIMER/);
    expect(core).toMatch(/cannot satisfy a criterion/);
  });

  it("the function's only write path is the governed RPC, born AI_INFERENCE, as the calling user", () => {
    expect(fn).toMatch(/record_case_evidence/);
    expect(fn).toMatch(/evidence_class: "AI_INFERENCE"/);
    expect(fn).toMatch(/userClient\(\s*auth\.token,?\s*\)/);
    // No direct writes to any governed table, and no path near findings,
    // reviews, or criteria statuses.
    expect(fn).not.toMatch(/\.from\("evidence_items"\)[\s\S]{0,120}\.(insert|update|upsert|delete)/);
    expect(fn).not.toMatch(/\.from\("stage_gate_(findings|reviews|criteria)"\)[\s\S]{0,120}\.(insert|update|upsert|delete)/);
    expect(fn).not.toMatch(/verify_evidence_item/);
    expect(fn).not.toMatch(/record_case_gate_review/);
  });

  it("degrades honestly when no provider is configured", () => {
    expect(fn).toMatch(/no model provider is configured/);
    expect(fn).toMatch(/stands on its own/);
  });

  it("retrieval rides the existing governed rail, org-pinned to the caller", () => {
    expect(fn).toMatch(/retrieve_kb_context/);
    expect(fn).toMatch(/p_organization_id: organizationId/);
  });

  it("the readiness calculation consumes only findings, so the agent cannot move it", () => {
    // The structural half of the advisory promise: get_gate_readiness's r_i
    // derives from stage_gate_findings alone; evidence counts are display.
    expect(readinessRaw).toMatch(/readiness number consumes ONLY[\s-]+criterion satisfaction/i);
    expect(readiness).toMatch(/'aiInferenceUnverified'/);
  });
});

describe("definer hygiene (the ratchet)", () => {
  it("every new SECURITY DEFINER function revokes from public and anon", () => {
    for (const name of [
      "create_case_baseline",
      "approve_case_baseline",
      "set_gate_requirement",
      "create_project_framework_version",
      "get_gate_readiness",
      "bind_asset_to_development_case",
      "get_case_operational_readiness",
      "get_development_case",
    ]) {
      expect(lowerAll).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}\\([^)]*\\) from public, anon`,
        ),
      );
    }
  });

  it("every new definer RPC resolves the tenant from the session", () => {
    for (const sql of [baselines, readiness, operational]) {
      const definers = sql.match(/create or replace function[\s\S]*?\$\$;/g) ?? [];
      for (const fn of definers) {
        if (!/security definer/i.test(fn)) continue;
        if (/returns trigger/i.test(fn)) continue;
        expect(fn).toMatch(/app_current_org\(\)/);
      }
    }
  });
});
