/**
 * Sync Develop Slice 3D — migration contract (static, no database).
 *
 * The live behaviour is proven by scripts/ci-develop-slice3d-smoke.sh against
 * a real local database (multi-role transcript: the gate review workflow, §70
 * refused at four doors, the three agents, the assurance case, and the
 * authoring paths the reachability gate found dead).
 *
 * This file pins the CONTRACT in the migration text so a later edit that
 * loosens a §70 refusal, forks an evaluator, drops a trigger arm or lets a
 * vocabulary drift from the TypeScript fails CI before it reaches a database.
 */
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  RISK_WORKFLOW_STEPS,
  SOURCE_AUTHORITY_TIERS,
  TREATMENT_STRATEGIES,
} from "../../supabase/functions/_shared/develop-agent-core";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));

/**
 * TypeScript source with comments removed. Scans for forbidden literals must
 * read the CODE: a comment that quotes the defect it fixed ("the earlier
 * `?? \"gpt-4o-mini\"`…") is documentation, not a hardcoded model id, and a
 * scanner that cannot tell them apart pushes authors to delete the explanation
 * rather than the bug.
 */
const readCode = (f: string) =>
  readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const REVIEW_FILE = "20261123090000_gate_review_workflow.sql";
const METHOD_FILE = "20261123090100_methodology_agent.sql";
const GATE_AGENT_FILE = "20261123090200_gate_agent.sql";
const RISK_AGENT_FILE = "20261123090300_risk_agent_treatment_advice.sql";
const ASSURANCE_FILE = "20261123090400_assurance_case.sql";

const review = read(REVIEW_FILE);
const method = read(METHOD_FILE);
const gateAgent = read(GATE_AGENT_FILE);
const riskAgent = read(RISK_AGENT_FILE);
const assurance = read(ASSURANCE_FILE);

const all = [review, method, gateAgent, riskAgent, assurance];
const files = [
  REVIEW_FILE,
  METHOD_FILE,
  GATE_AGENT_FILE,
  RISK_AGENT_FILE,
  ASSURANCE_FILE,
] as const;

/** Every table this slice creates ships org-scoped RLS in the same file. */
const NEW_TABLES = [
  ["gate_review_sessions", review],
  ["framework_proposals", method],
  ["gate_agent_reports", gateAgent],
  ["risk_treatment_advice", riskAgent],
  ["assurance_case_claims", assurance],
  ["assurance_claim_evidence", assurance],
] as const;

describe("house law — every new table, org-scoped and definer-written", () => {
  it.each(NEW_TABLES)(
    "%s enables RLS and carries an org-scoped read policy in its own migration",
    (table, source) => {
      expect(source).toContain(`create table if not exists public.${table} (`);
      expect(source).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(source).toMatch(
        new RegExp(
          `create policy ${table}_read on public\\.${table}[\\s\\S]{0,200}organization_id = app_current_org\\(\\)`,
        ),
      );
    },
  );

  it.each(NEW_TABLES)(
    "%s grants no client INSERT/UPDATE/DELETE policy — every mutation is a definer RPC",
    (table, source) => {
      const permissiveWrite = new RegExp(
        `create policy [a-z_]+ on public\\.${table}\\s+for (insert|update|delete|all)`,
        "g",
      );
      const matches = [...source.matchAll(permissiveWrite)].filter(
        (m) => !m[0].includes("as restrictive"),
      );
      expect(matches).toEqual([]);
    },
  );

  it("every function this slice defines is revoked from public and anon", () => {
    // Including trigger functions: PostgreSQL does not check EXECUTE on a
    // trigger function when the trigger fires, so revoking costs nothing and
    // closes a direct-call surface.
    const defined = all.flatMap((source) =>
      [
        ...source.matchAll(/create or replace function public\.([a-z_]+)\(/g),
      ].map((m) => m[1]),
    );
    expect(new Set(defined).size).toBeGreaterThan(15);
    const joined = all.join("\n");
    for (const name of new Set(defined)) {
      expect(
        new RegExp(`revoke (all|execute) on function public\\.${name}\\(`).test(
          joined,
        ),
        `${name} is not revoked from public/anon`,
      ).toBe(true);
    }
  });

  it("every enforcement trigger covers INSERT and UPDATE, and DELETE where the act can be dodged by deletion", () => {
    // House law. A guard that only fires on INSERT is a guard a second
    // statement walks around.
    const both = [
      "trg_gate_review_session_integrity",
      "trg_framework_proposal_provenance",
      "trg_gate_agent_report_provenance",
      "trg_treatment_advice_boundary",
      "trg_assurance_claim_provenance",
      "trg_assurance_claim_evidence_provenance",
    ];
    const joined = all.join("\n");
    for (const trigger of both) {
      expect(joined, `${trigger} must cover insert, update and delete`).toMatch(
        new RegExp(
          `create trigger ${trigger}\\s+before insert or update or delete on`,
        ),
      );
    }
    // The recorder wall rides on stage_gate_reviews, which has its own DELETE
    // provenance guard already; re-pointing reviewed_by is an UPDATE.
    expect(review).toMatch(
      /create trigger trg_review_recorder_is_human\s+before insert or update on public\.stage_gate_reviews/,
    );
  });
});

describe("§70 — agents propose, humans dispose", () => {
  it("adopting a project framework refuses the AI-operator identity BY NAME", () => {
    // The hole this slice closed: adopt_project_framework listed 'ai_admin'
    // among its adopting roles, so the identity that drafts a framework could
    // also put it in force — §70's "gate passed" prohibition read one level up.
    expect(review).toContain(
      "create or replace function public.adopt_project_framework(",
    );
    const body = review.slice(
      review.indexOf(
        "create or replace function public.adopt_project_framework(",
      ),
    );
    expect(body).toMatch(/if coalesce\(v_role, ''\) = 'ai_admin' then/);
    expect(body).toMatch(
      /not in \('admin','executive'\)[\s\S]{0,200}requires an executive or administrator/,
    );
    // ...and 'ai_admin' is NOT in the permitted set.
    expect(body).not.toMatch(/not in \('admin','ai_admin','executive'\)/);
  });

  it("a gate outcome can never be attributed to the AI-operator identity, for any writer", () => {
    expect(review).toContain(
      "create or replace function public.enforce_gate_review_recorder_is_human()",
    );
    // Unconditional: no marker escape, no service-path escape. A restore that
    // re-inserts such a row is re-asserting it.
    const fn = review.slice(
      review.indexOf(
        "create or replace function public.enforce_gate_review_recorder_is_human()",
      ),
      review.indexOf("drop trigger if exists trg_review_recorder_is_human"),
    );
    expect(fn).toMatch(/coalesce\(v_role, ''\) = 'ai_admin'/);
    expect(fn).not.toMatch(/current_setting\(/);
    expect(fn).not.toMatch(/current_user/);
  });

  it("opening or recording a gate review refuses that identity at the RPC too", () => {
    expect(review).toMatch(
      /create or replace function public\.open_gate_review\([\s\S]{0,3000}'ai_admin'/,
    );
    expect(review).toContain("gate_review_sod_position");
  });

  it("the SoD predicate is stated once and consumed three times", () => {
    // A screen computing its own answer and a server computing another is how
    // a readiness screen becomes decoration; the same applies to "may I
    // record this?".
    const occurrences = (review.match(/gate_review_sod_position\(/g) ?? [])
      .length;
    expect(occurrences).toBeGreaterThanOrEqual(4); // definition + 3 consumers
    for (const consumer of [
      "get_gate_review_pack",
      "record_gate_review_outcome",
      "enforce_gate_review_session_integrity",
    ]) {
      const start = review.indexOf(
        `create or replace function public.${consumer}(`,
      );
      expect(start, `${consumer} is not defined`).toBeGreaterThan(-1);
      expect(review.slice(start, start + 9000)).toContain(
        "gate_review_sod_position(",
      );
    }
  });

  it("the recorder delegates to the ONE act site and re-implements no part of the gate decision", () => {
    const start = review.indexOf(
      "create or replace function public.record_gate_review_outcome(",
    );
    const body = review.slice(
      start,
      review.indexOf(
        "revoke all on function public.record_gate_review_outcome",
      ),
    );
    expect(body).toContain("record_case_gate_review(");
    // No second mandatory block, no second insert into the review tables.
    expect(body).not.toMatch(/insert into stage_gate_reviews/);
    expect(body).not.toMatch(/insert into stage_gate_findings/);
    expect(body).not.toMatch(/is_mandatory/);
  });

  it("adopting or ruling refuses the AI-operator identity in every family this slice adds", () => {
    for (const [file, fn] of [
      [method, "withdraw_framework_proposal"],
      [riskAgent, "adopt_risk_treatment_advice"],
      [riskAgent, "dismiss_risk_treatment_advice"],
      [assurance, "set_assurance_claim_position"],
    ] as const) {
      const start = file.indexOf(`create or replace function public.${fn}(`);
      expect(start, `${fn} is not defined`).toBeGreaterThan(-1);
      expect(
        file.slice(start, start + 2500),
        `${fn} does not refuse ai_admin`,
      ).toContain("'ai_admin'");
    }
  });

  it("the treatment-advice wall refuses a machine-attributed adoption cross-table, marker and all", () => {
    const fn = riskAgent.slice(
      riskAgent.indexOf(
        "create or replace function public.enforce_treatment_advice_boundary()",
      ),
      riskAgent.indexOf("drop trigger if exists trg_treatment_advice_boundary"),
    );
    expect(fn).toContain("new.adopted_by");
    expect(fn).toContain("'ai_admin'");
    // The bound agent must be structurally incapable of approving/accepting.
    expect(fn).toContain("risk_may_approve");
    expect(fn).toContain("risk_may_accept");
    expect(fn).toContain("risk_evidence_only");
  });
});

describe("no fourth evaluator — the pack reads what already exists", () => {
  it("get_gate_review_pack calls get_gate_readiness and computes no readiness of its own", () => {
    const start = review.indexOf(
      "create or replace function public.get_gate_review_pack(",
    );
    const body = review.slice(
      start,
      review.indexOf("revoke all on function public.get_gate_review_pack"),
    );
    expect(body).toContain("get_gate_readiness(");
    // The §45 arithmetic and the mandatory rule live in ONE place. If any of
    // these appear here, a second evaluator has been born.
    expect(body).not.toMatch(/sum\(sc\.weight\)/);
    expect(body).not.toMatch(/mandatory_met/);
    expect(body).not.toMatch(/v_blocked :?=/);
  });

  it("the pack is SECURITY INVOKER so the risk-sensitivity ladder still applies", () => {
    // A SECURITY INVOKER function called from inside a DEFINER one runs as the
    // DEFINER, so wrapping get_gate_readiness in a definer pack would show
    // every reviewer every confidential risk.
    expect(review).toMatch(
      /create or replace function public\.get_gate_review_pack\([\s\S]{0,300}security invoker/,
    );
    expect(assurance).toMatch(
      /create or replace function public\.get_case_assurance_case\(p_case_id uuid\)[\s\S]{0,200}security invoker/,
    );
    expect(riskAgent).toMatch(
      /create or replace function public\.get_case_treatment_advice\(p_case_id uuid\)[\s\S]{0,200}security invoker/,
    );
  });

  it("open_gate_review does NOT snapshot the invoker-scoped readiness payload", () => {
    // Snapshotting it from a DEFINER RPC would write confidential risk titles
    // into a row every member of the organization can read.
    const start = review.indexOf(
      "create or replace function public.open_gate_review(",
    );
    const body = review.slice(
      start,
      review.indexOf("revoke all on function public.open_gate_review"),
    );
    expect(body).not.toContain("get_gate_readiness(");
    expect(body).not.toContain("get_gate_review_pack(");
    expect(body).toContain("case_gate_outstanding_obligations(");
    expect(body).toContain("gate_review_sod_position(");
  });

  it("the gate agent's report reads its numbers from the evaluator, never from the caller", () => {
    const start = gateAgent.indexOf(
      "create or replace function public.record_gate_agent_report(",
    );
    const body = gateAgent.slice(
      start,
      gateAgent.indexOf(
        "revoke all on function public.record_gate_agent_report",
      ),
    );
    expect(body).toContain("get_gate_readiness(");
    // The signature accepts a narrative and a model. Nothing else.
    expect(gateAgent).toMatch(
      /record_gate_agent_report\(\s*p_case_id uuid,\s*p_gate_id bigint,\s*p_narrative text default null,\s*p_model text default null\s*\)/,
    );
    // The risk family is counted, not named.
    expect(body).toContain("identity withheld");
  });

  it("gate_agent_reports has no column that could hold a decision", () => {
    const table = gateAgent.slice(
      gateAgent.indexOf(
        "create table if not exists public.gate_agent_reports (",
      ),
      gateAgent.indexOf(
        "create index if not exists idx_gate_agent_reports_gate",
      ),
    );
    for (const forbidden of [
      "outcome",
      "decision",
      "approved",
      "approval",
      "verdict",
      "recommendation",
      "signed_by",
    ]) {
      expect(
        table,
        `gate_agent_reports must not carry ${forbidden}`,
      ).not.toMatch(new RegExp(`^\\s+${forbidden}\\b`, "m"));
    }
    expect(table).toContain(
      "constraint gate_agent_report_is_advisory check (advisory)",
    );
  });
});

describe("D12.06 — the methodology agent proposes on the ONE framework family", () => {
  it("materializes through the SHIPPED authoring RPCs, not a private writer", () => {
    const start = method.indexOf(
      "create or replace function public.propose_framework_from_document(",
    );
    const body = method.slice(
      start,
      method.indexOf(
        "revoke all on function public.propose_framework_from_document",
      ),
    );
    for (const rpc of [
      "create_project_framework(",
      "add_framework_stage(",
      "add_framework_gate(",
      "set_gate_requirement(",
    ]) {
      expect(body, `the proposal must go through ${rpc}`).toContain(rpc);
    }
    // No direct writes to the framework family.
    expect(body).not.toMatch(/insert into project_frameworks/);
    expect(body).not.toMatch(/insert into stage_gates/);
    expect(body).not.toMatch(/insert into stage_gate_criteria/);
  });

  it("stamps EVERY proposed requirement AI_SUGGESTION — the tier is not the agent's to choose", () => {
    const start = method.indexOf("v_result := set_gate_requirement(");
    const call = method.slice(start, start + 700);
    expect(call).toContain("'AI_SUGGESTION'");
    // The proposal payload's own source_authority is never read.
    expect(method).not.toMatch(/item->>'source_authority'/);
    expect(SOURCE_AUTHORITY_TIERS).toContain("AI_SUGGESTION");
  });

  it("defaults a machine-proposed requirement to ADVISORY, not mandatory", () => {
    // set_gate_requirement's own default is true; a silently mandatory
    // AI_SUGGESTION would hard-block a gate at any readiness percentage.
    // Parsed through the helper (see the 22P02 test below), still false.
    expect(method).toMatch(
      /coalesce\(sync_text_as_boolean\(nullif\(item->>'is_mandatory',''\)\), false\)/,
    );
  });

  it("parses every caller-supplied number and flag through sync_text_as_*, never a bare cast", () => {
    // House law: a refusal names what is wrong. `"sequence": "two"` raised
    // `invalid input syntax for type integer` AT THE USER — a raw 22P02 naming
    // a Postgres type instead of the field. The helpers (20261122090000 §0)
    // return NULL instead of raising so the RPC can refuse in its own words.
    for (const field of [
      "sequence",
      "readiness_threshold",
      "minimum_confidence",
      "weight",
      "sort_order",
      "is_mandatory",
      "independent_assurance_required",
    ]) {
      expect(
        method,
        `${field} is cast bare somewhere in the methodology agent`,
      ).not.toMatch(new RegExp(`item->>'${field}'[^)]*\\)?::`));
    }
    // Same law, the other two 3D write paths.
    for (const field of ["expected_residual", "expected_introduced"]) {
      expect(riskAgent).not.toMatch(
        new RegExp(`p_advice->>'${field}'[^)]*\\)?::(numeric|int)`),
      );
    }
    for (const field of ["owner_id", "success_outcome_id", "requirement_id"]) {
      expect(assurance).not.toMatch(
        new RegExp(`p_claim->>'${field}'[^)]*\\)?::(uuid|bigint|int)`),
      );
    }
    expect(riskAgent).toContain("sync_text_as_numeric");
    expect(assurance).toContain("sync_text_as_uuid");
    expect(assurance).toContain("sync_text_as_bigint");
  });

  it("refuses a proposal that takes the name of an ADOPTED framework", () => {
    // The name is model output and the model's only input is untrusted document
    // text. adopt_project_framework supersedes every adopted framework of the
    // same name, and apply_case_governance resolves tailoring rules by name —
    // so a borrowed name would silently replace the tenant's live governance
    // model with one whose mandatory and independence flags default FALSE.
    expect(method).toMatch(
      /from project_frameworks\s+where organization_id = v_org and name = v_name and status = 'adopted'/,
    );
    expect(method).toContain("Propose it under its own name");
  });

  it("the shelf states what adoption ARMS and what it REPLACES, not just counts", () => {
    // Adoption is the one act §70 reserves to a human in this slice. A human
    // shown three counts cannot dispose of what they cannot see.
    for (const key of [
      "mandatoryRequirements",
      "independentAssuranceGates",
      "requirementTiers",
      "willSupersede",
    ]) {
      expect(method, `get_framework_shelf omits ${key}`).toContain(`'${key}'`);
    }
    const panel = readFileSync(
      "src/components/develop/FrameworkShelfPanel.tsx",
      "utf8",
    );
    expect(panel).toContain("willSupersede");
    expect(panel).toContain("confirmSupersede");
    expect(panel).toContain("mandatoryRequirements");
  });

  it("fails whole: a nested refusal RAISEs so no half-built framework survives", () => {
    const start = method.indexOf(
      "create or replace function public.propose_framework_from_document(",
    );
    const body = method.slice(
      start,
      method.indexOf(
        "revoke all on function public.propose_framework_from_document",
      ),
    );
    const raises = (body.match(/raise exception/g) ?? []).length;
    expect(raises).toBeGreaterThanOrEqual(4);
  });

  it("adoption status is read from the FRAMEWORK, never duplicated onto the proposal", () => {
    const table = method.slice(
      method.indexOf("create table if not exists public.framework_proposals ("),
      method.indexOf("create index if not exists idx_framework_proposals_org"),
    );
    expect(table).toMatch(
      /status text not null default 'proposed'\s*check \(status in \('proposed','withdrawn'\)\)/,
    );
    expect(table).not.toContain("'adopted'");
    // ...and the shelf reads it live.
    expect(method).toMatch(
      /'framework', jsonb_build_object\([\s\S]{0,200}'status', f\.status/,
    );
  });
});

describe("D13.06 — claims, and the confidence that is NOT invented", () => {
  it("reports the spread and refuses a single combined number", () => {
    const start = assurance.indexOf(
      "create or replace function public.get_case_assurance_case(",
    );
    const body = assurance.slice(start);
    expect(body).toContain("'highest'");
    expect(body).toContain("'lowest'");
    expect(body).toContain("'scoredCount'");
    expect(body).toContain("'unscoredCount'");
    // No mean, no weighted roll-up, no product across items.
    expect(body).not.toMatch(/meanConfidence/);
    expect(body).not.toMatch(/avg\(/);
  });

  it("consumes the D11.22 §46 composite rather than a second arithmetic", () => {
    expect(assurance).toContain("compute_evidence_confidence(");
    expect(assurance).not.toMatch(/quality_weights/);
    expect(assurance).not.toMatch(/freshness_half_life_days/);
  });

  it("refuses 'supported' with nothing linked, at the RPC AND at the persistence boundary", () => {
    const rpcStart = assurance.indexOf(
      "create or replace function public.set_assurance_claim_position(",
    );
    expect(assurance.slice(rpcStart, rpcStart + 3000)).toContain(
      "has no evidence linked to it",
    );
    const trigger = assurance.slice(
      assurance.indexOf(
        "create or replace function public.enforce_assurance_claim_provenance()",
      ),
      assurance.indexOf(
        "drop trigger if exists trg_assurance_claim_provenance",
      ),
    );
    expect(trigger).toContain("cannot be marked supported");
  });

  it("holds contradicting evidence as a first-class link", () => {
    expect(assurance).toMatch(
      /bearing text not null default 'supports'\s*check \(bearing in \('supports','contradicts','qualifies'\)\)/,
    );
  });

  it("uses the ONE assumption store and the ONE assurance predicate", () => {
    // Ruling 5 (risk_assumptions is the platform Assumption) and D3.16.
    expect(assurance).toContain("from risk_assumptions a");
    expect(assurance).toContain("get_case_assurance_position(c.id, null)");
    expect(assurance).not.toMatch(
      /create table if not exists public\.assurance_assumptions/,
    );
  });
});

describe("D12.12 — vocabularies match the TypeScript the agents run on", () => {
  it("the ISO 31000 workflow steps are the shipped ai_agents.risk_engine_key set", () => {
    const check = riskAgent.slice(
      riskAgent.indexOf("workflow_step text not null check"),
      riskAgent.indexOf("recommended_strategy text not null check"),
    );
    for (const step of RISK_WORKFLOW_STEPS) {
      expect(check, `${step} missing from the workflow_step enum`).toContain(
        `'${step}'`,
      );
    }
    expect(RISK_WORKFLOW_STEPS.length).toBe(12);
  });

  it("the treatment strategies are the §15 seven create_risk_treatment enforces", () => {
    const check = riskAgent.slice(
      riskAgent.indexOf("recommended_strategy text not null check"),
      riskAgent.indexOf("label text not null"),
    );
    for (const strategy of TREATMENT_STRATEGIES) {
      expect(check, `${strategy} missing from the strategy enum`).toContain(
        `'${strategy}'`,
      );
    }
    expect(TREATMENT_STRATEGIES.length).toBe(7);
  });

  it("adoption delegates to the ONE treatment writer (ruling D5.25)", () => {
    const start = riskAgent.indexOf(
      "create or replace function public.adopt_risk_treatment_advice(",
    );
    const body = riskAgent.slice(
      start,
      riskAgent.indexOf(
        "revoke all on function public.adopt_risk_treatment_advice",
      ),
    );
    expect(body).toContain("create_risk_treatment(");
    expect(body).not.toMatch(/insert into recommendations/);
    expect(body).not.toMatch(/insert into scenarios/);
    // The human must assess introduced risks themselves; the agent's
    // expectation is not an assessment.
    expect(body).toContain("introduced_risks");
  });

  it("advice is refused when the bound agent is not the shipped evidence-only one", () => {
    const start = riskAgent.indexOf(
      "create or replace function public.record_risk_treatment_advice(",
    );
    const body = riskAgent.slice(start, start + 6000);
    expect(body).toContain("risk_engine_key = 'treatment'");
    expect(body).toContain("provision_risk_advisory_agents");
    // Non-finite numerics refused by name, never rendered.
    expect(body).toContain("'NaN'::numeric");
  });
});

describe("the deployed surface", () => {
  it("the three new edge functions exist and are inside the approved deploy boundary", () => {
    const boundary = JSON.parse(
      readFileSync("config/edge-function-boundary.json", "utf8"),
    ) as { activeFunctions: string[] };
    const workflow = readFileSync(
      ".github/workflows/deploy-migrations.yml",
      "utf8",
    );
    for (const fn of [
      "develop-methodology-agent",
      "develop-gate-agent",
      "develop-risk-agent",
    ]) {
      expect(
        existsSync(`supabase/functions/${fn}/index.ts`),
        `${fn} has no handler`,
      ).toBe(true);
      expect(boundary.activeFunctions).toContain(fn);
      expect(workflow).toContain(`supabase/functions/${fn}/**`);
      expect(workflow).toContain(`supabase functions deploy ${fn}`);
    }
  });

  it("no agent hardcodes a provider or a model id — SyncAI is model-agnostic", () => {
    for (const fn of [
      "develop-methodology-agent",
      "develop-gate-agent",
      "develop-risk-agent",
    ]) {
      const source = readCode(`supabase/functions/${fn}/index.ts`);
      // The provider chain is built from environment, through the shipped
      // indirection; no vendor name is decided in the agent.
      expect(source).toContain("buildProviderChain");
      expect(source).toContain("resolveExternalGatewayUrl");
      expect(source).not.toMatch(/api\.openai\.com/);
      expect(source).not.toMatch(/api\.anthropic\.com/);
      expect(source).not.toMatch(/api\.x\.ai/);
      // Model ids appear NOWHERE in the agent — not inline in a call and not
      // as an env fallback. `?? "gpt-4o-mini"` and `?? "stigg/fast"` were both
      // present three lines under a comment saying no model id was hardcoded,
      // which is the claim this test now actually checks. The chain's own
      // defaults live in buildProviderChain, the one shipped indirection.
      const inlineModels = [
        ...source.matchAll(/model:\s*"(?!\$)[a-z0-9][^"]*"/gi),
      ];
      expect(inlineModels.map((m) => m[0])).toEqual([]);
      for (const literal of [
        /"gpt-[^"]*"/i,
        /"claude-[^"]*"/i,
        /"grok-[^"]*"/i,
        /"gemini-[^"]*"/i,
        /"o[0-9]-[^"]*"/i,
        /"stigg\/[^"]*"/i,
      ]) {
        expect(source, `${fn} names a model id`).not.toMatch(literal);
      }
    }
  });

  it("the CI job runs the slice-3d transcript in the existing pattern", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain("bash scripts/ci-develop-slice3d-smoke.sh");
    // It runs AFTER 3C: the develop transcripts build on one another's
    // fixtures order in this job.
    expect(ci.indexOf("ci-develop-slice3d-smoke.sh")).toBeGreaterThan(
      ci.indexOf("ci-develop-slice3c-smoke.sh"),
    );
  });

  it("the migrations do not touch the RE-2026.08 protected database objects", () => {
    // scripts/reliability-baseline-floor.mjs digests every migration naming
    // one of these; a mention here would move the floor's evidence without
    // changing the Reliability Engineer at all.
    for (const file of files) {
      const body = raw(file);
      for (const object of [
        "retrieve_kb_context",
        "kb_document_classes",
        "kb_claim_types",
      ]) {
        expect(body, `${file} must not name ${object}`).not.toContain(object);
      }
    }
  });
});

describe("refusals name what is missing, and no raw error code reaches a user", () => {
  it("every raise carries an explicit errcode, never a bare exception", () => {
    // Sliced to the NEXT raise, not to the next semicolon: refusal prose
    // contains semicolons, and a `;`-terminated slice would cut a statement in
    // half and then fail an otherwise-correct raise. (It did, once.)
    for (const source of all) {
      const starts = [...source.matchAll(/raise exception\b/g)].map(
        (m) => m.index ?? 0,
      );
      expect(starts.length).toBeGreaterThan(0);
      for (let i = 0; i < starts.length; i += 1) {
        const end = i + 1 < starts.length ? starts[i + 1] : starts[i] + 2000;
        const statement = source.slice(starts[i], end);
        expect(
          /using errcode = '/.test(statement),
          `a raise without an errcode: ${statement.slice(0, 140)}`,
        ).toBe(true);
      }
    }
  });

  it("no refusal string leaks a bare SQLSTATE", () => {
    for (const source of all) {
      expect(source).not.toMatch(/'23505'/);
      expect(source).not.toMatch(/'22P02'/);
      expect(source).not.toMatch(/sqlstate/i);
    }
  });

  it("array appends are explicit — an untyped literal would raise 22P02 at the user", () => {
    // `v_blocked := v_blocked || 'literal'` resolves to array-concat and fails
    // with `malformed array literal`. This transcript hit it once.
    expect(review).not.toMatch(/v_blocked := v_blocked \|\| '/);
    expect(review).toMatch(/array_append\(v_blocked, '/);
  });
});

/* ===========================================================================
 * REPAIR PASS — one test per defect the adversarial review found, each
 * written so it would have FAILED against the code as first written.
 * =========================================================================== */

const WALLS_FILE = "20261123090500_slice3d_seventy_pre_existing_walls.sql";
const walls = read(WALLS_FILE);

describe("§70 — every human-only act is walled at the DATABASE, not only at its RPC", () => {
  /**
   * The chunk's own header called framework adoption one of "four doors
   * enforced at the database". Three of the four carried an unconditional
   * persistence trigger and adoption carried none: enforce_framework_
   * immutability has an audited SERVICE PATH that returns `new`, and it never
   * looks at adopted_by. A service-key holder — and this slice adds three edge
   * functions that hold one — could write an adopted, immutable, machine-
   * attributed framework.
   */
  it.each([
    ["project_frameworks", "adopted_by", "enforce_framework_adopter_is_human"],
    ["development_cases", "sanctioned_by", "enforce_case_sanctioner_is_human"],
    ["gate_conditions", "closed_by", "enforce_gate_condition_closer_is_human"],
    [
      "lifecycle_evaluations",
      "decided_by",
      "enforce_lifecycle_decider_is_human",
    ],
  ])(
    "%s.%s cannot name the AI-operator identity, for any writer",
    (table, column, fn) => {
      const start = walls.indexOf(`create or replace function public.${fn}()`);
      expect(start, `${fn} is not defined`).toBeGreaterThan(-1);
      const body = walls.slice(start, walls.indexOf("$$;", start));
      // The attribution column, the role lookup, the refusal.
      expect(body).toContain(`new.${column}`);
      expect(body).toMatch(/select role into v_role from user_profiles/);
      expect(body).toMatch(/coalesce\(v_role, ''\) = 'ai_admin'/);
      // UNCONDITIONAL: no marker escape, no current_user escape. A governance act
      // attributed to the machine is corrupt data however it arrived.
      expect(body).not.toMatch(/current_setting\(/);
      expect(body).not.toMatch(/current_user/);
      // Both arms: re-pointing an attribution is the same claim, different verb.
      expect(walls).toMatch(
        new RegExp(
          `before insert or update on public\\.${table}\\s+for each row execute function public\\.${fn}\\(\\)`,
        ),
      );
    },
  );

  it("the treatment-advice wall covers dismissed_by, not only adopted_by", () => {
    // dismiss_risk_treatment_advice refused the identity at the RPC with
    // nothing behind it — and the dismissals are the only honest signal of
    // whether the agent is worth listening to, so the thing being measured
    // could edit the measurement.
    const start = riskAgent.indexOf(
      "create or replace function public.enforce_treatment_advice_boundary()",
    );
    const body = riskAgent.slice(start, riskAgent.indexOf("$$;", start));
    for (const column of ["adopted_by", "dismissed_by"]) {
      expect(body).toMatch(
        new RegExp(
          `new\\.${column} is not null\\s+and \\(tg_op = 'INSERT' or new\\.${column} is distinct from old\\.${column}\\)`,
        ),
      );
    }
    expect((body.match(/= 'ai_admin'/g) ?? []).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("decide_lifecycle_evaluation no longer lists ai_admin on the permissive side", () => {
    // It was the ONE rpc in the codebase that did: accepting a HIGH-uncertainty
    // recommendation. A refusal graded by uncertainty puts the grade, not the
    // human, in charge of §70.
    const start = walls.indexOf(
      "create or replace function public.decide_lifecycle_evaluation(",
    );
    const body = walls.slice(
      start,
      walls.indexOf(
        "revoke all on function public.decide_lifecycle_evaluation",
      ),
    );
    expect(body).toMatch(/'reliability_engineer', 'executive', 'admin'\)/);
    expect(body).not.toMatch(/'admin', 'ai_admin'\)/);
    expect(body).toContain("§70 human determination");
  });
});

describe("the AI-operator identity states requirements at AI_SUGGESTION and nowhere else", () => {
  it("set_gate_requirement caps the tier for ai_admin", () => {
    // The methodology agent's migration claimed a proposed requirement "can
    // never quietly arrive wearing REGULATION". That was true of
    // propose_framework_from_document and false of the product: the identity
    // could call the authoring RPC directly and mint a MANDATORY
    // REGULATION-tier requirement, which is also how promote_requirement_
    // authority's human-only tier RAISE was defeated.
    const start = walls.indexOf(
      "create or replace function public.set_gate_requirement(",
    );
    expect(start).toBeGreaterThan(-1);
    const body = walls.slice(
      start,
      walls.indexOf("revoke all on function public.set_gate_requirement"),
    );
    expect(body).toMatch(
      /coalesce\(v_role, ''\) = 'ai_admin'\s+and coalesce\(p_source_authority, ''\) <> 'AI_SUGGESTION'/,
    );
    // The cap sits BEFORE the gate lookup, so the refusal is about the tier
    // rather than about a gate the caller may not even reach.
    expect(body.indexOf("<> 'AI_SUGGESTION'")).toBeLessThan(
      body.indexOf("select * into g from stage_gates"),
    );
  });
});

describe("the gate review session decides over the DECIDER's segregation position", () => {
  it("the decided transition reads the review's own recorder, not the opener", () => {
    // open_gate_review admits 'planner'; the recorder_authority pair does not.
    // Evaluating the OPENER's position on the 'decided' transition made every
    // planner-opened session undecidable: record_case_gate_review had already
    // succeeded, the trigger rolled the whole transaction back, and the message
    // named the planner's role to a manager who may record. The same shape
    // blocks the intended §42 workflow (sponsor opens, independent reviewer
    // records).
    const start = review.indexOf(
      "create or replace function public.enforce_gate_review_session_integrity()",
    );
    const body = review.slice(start, review.indexOf("$$;", start));
    expect(body).toMatch(
      /v_decider_sod := gate_review_sod_position\(\s*new\.development_case_id, new\.gate_id, r\.reviewed_by\)/,
    );
    expect(body).toMatch(/v_decider_sod->>'mayRecord'/);
    // The opener is still checked — but only for §70, which is about who may
    // HOLD a brief, not who may close it.
    expect(body).toMatch(/v_sod->>'actorRole'.*'ai_admin'/s);
    expect(body).not.toMatch(/v_sod->>'mayRecord'/);
    // The review is loaded BEFORE the position is taken on its recorder.
    expect(
      body.indexOf("select * into r from stage_gate_reviews"),
    ).toBeLessThan(body.indexOf("v_decider_sod :="));
  });

  it("no guard is written on current_user inside a SECURITY DEFINER function", () => {
    // Verified on a live database: a definer function reports
    // current_user=postgres for anon, authenticated and service_role alike, so
    // `current_user in ('authenticated','anon')` is a test that can never be
    // true. Two guards were written on it — one dead disjunct that read as a
    // wall it did not build, and one organization check that therefore never
    // fired, letting a service-key call read any tenant's gate evidence by case
    // id. session_user ('authenticator' over the API) is the discriminator.
    for (const source of all) {
      expect(source).not.toMatch(/current_user in \('authenticated'/);
    }
    expect(review).toMatch(
      /v_caller_org is null and session_user = 'authenticator'/,
    );
    expect((review.match(/session_user = 'authenticator'/g) ?? []).length).toBe(
      2,
    );
  });
});

describe("the risk-sensitivity ladder survives every SECURITY DEFINER hop", () => {
  it("record_gate_agent_report drops risk blockers the caller may not read", () => {
    // A DEFINER function calling the INVOKER evaluator computes readiness with
    // the definer's rights. Redacting the risk's NAME left its existence, its
    // count and a persisted org-readable blocker_count — an oracle for exactly
    // what the ladder withholds. can_read_risk resolves against the JWT claims,
    // so it answers for the requester even inside a definer.
    const start = gateAgent.indexOf(
      "create or replace function public.record_gate_agent_report(",
    );
    const body = gateAgent.slice(
      start,
      gateAgent.indexOf(
        "revoke all on function public.record_gate_agent_report",
      ),
    );
    expect(body).toMatch(
      /where x->>'type' <> 'open_risk'\s+or can_read_risk\(sync_text_as_uuid\(x->>'id'\)\)/,
    );
    // And nothing else in the persisted snapshot is computed over a table with
    // a ladder above it. evidenceSummary counts evidence_items, which carry
    // evidence_items_risk_sensitive — a policy this definer does not run — so
    // storing the definer's count in an org-readable row would say how much
    // evidence the ladder hides. Every remaining field comes from criteria,
    // findings and reviews, which are org-scoped and nothing more.
    const snapshot = body.slice(
      body.indexOf("'gateName'"),
      body.indexOf("v_blockers, jsonb_array_length(v_blockers)"),
    );
    expect(snapshot.length).toBeGreaterThan(0);
    // The quoted KEY, not the bare word: stripComments preserves $$-quoted
    // function bodies, so the sentence explaining this omission is still in the
    // text and a bare-word scan would match its own rationale.
    expect(snapshot).not.toContain("'evidenceSummary'");
  });

  it("link_assurance_claim_evidence honours evidence_items_risk_sensitive", () => {
    // The link RPC is DEFINER and the read is INVOKER, so a link made to
    // evidence the linker could not read produced a claim rendering
    // "supported" and "it is an assertion" at the same time.
    const start = assurance.indexOf(
      "create or replace function public.link_assurance_claim_evidence(",
    );
    const body = assurance.slice(
      start,
      assurance.indexOf(
        "revoke all on function public.link_assurance_claim_evidence",
      ),
    );
    expect(body).toMatch(/e\.risk_id is null or can_read_risk\(e\.risk_id\)/);
  });

  it("gate_requirement_evidence filters and REPORTS what it withheld", () => {
    const start = review.indexOf(
      "create or replace function public.gate_requirement_evidence(",
    );
    const body = review.slice(
      start,
      review.indexOf("revoke all on function public.gate_requirement_evidence"),
    );
    expect(body).toMatch(/e\.risk_id is null or can_read_risk\(e\.risk_id\)/);
    expect(body).toContain("'withheldCount'");
  });

  it("the assurance read reports the links it is not showing", () => {
    expect(assurance).toContain("assurance_claim_link_total");
    expect(assurance).toContain("'withheldCount'");
  });
});

describe("the agents' work products cannot be fabricated by anyone with a login", () => {
  it.each([
    ["record_gate_agent_report", gateAgent],
    ["record_risk_treatment_advice", riskAgent],
  ])(
    "%s gates the role, not merely the existence of a profile",
    (fn, source) => {
      // `if v_role is null then forbidden` was the whole check, so a technician
      // could author an immutable, undeletable row carrying an agent key, a model
      // and a narrative — rendered under a bot icon as the agent's own output.
      const start = source.indexOf(`create or replace function public.${fn}(`);
      const body = source.slice(
        start,
        source.indexOf(`revoke all on function public.${fn}`),
      );
      expect(body).toMatch(
        /coalesce\(v_role, ''\) not in \('admin','ai_admin','executive','maintenance_manager','reliability_engineer'\)/,
      );
    },
  );

  it("the treatment-advice read names who ran the agent", () => {
    expect(riskAgent).toContain("'proposedBy'");
    const page = readFileSync("src/pages/AssuranceCasePage.tsx", "utf8");
    expect(page).toContain("a.proposedBy");
  });

  it("a gate agent narrative is bounded at the database, not only in the function", () => {
    expect(gateAgent).toMatch(
      /narrative is null or length\(narrative\) <= 6000/,
    );
    expect(gateAgent).toContain("a gate reading is capped at 6000");
  });
});

describe("adoption does not inherit the model's numbers", () => {
  it("adopt_risk_treatment_advice demands residual_risk from the human", () => {
    // The figure becomes recommendations.expected_residual_risk(_score) and
    // derives expected_risk_reduction — what a later accept_risk is judged
    // against. Inheriting it silently is the same defect the very next check
    // refuses for introduced_risks, on the identical reasoning.
    const start = riskAgent.indexOf(
      "create or replace function public.adopt_risk_treatment_advice(",
    );
    const body = riskAgent.slice(
      start,
      riskAgent.indexOf(
        "revoke all on function public.adopt_risk_treatment_advice",
      ),
    );
    expect(body).toMatch(/not \(p_option \? 'residual_risk'\)/);
    expect(body).not.toMatch(
      /'residual_risk', coalesce\(nullif\(p_option->>'residual_risk',''\), adv\.expected_residual/,
    );
    expect(body).toContain("that is its expectation, not your assessment");
    const page = readFileSync("src/pages/AssuranceCasePage.tsx", "utf8");
    expect(page).toContain("residual_risk: form.residualRisk");
    expect(page).toContain("residualRisk: String(advice.expectedResidual");
  });
});

describe("a claim's confidence sentence describes the evidence it actually has", () => {
  it("the unscored branch counts SUPPORTING links, not every link", () => {
    // It formatted with jsonb_array_length(v_evidence) — every link — while
    // calling them "supporting item(s)", so a claim with three CONTRADICTING
    // links and nothing supporting it was described to the reviewer as having
    // three supporting items.
    const start = assurance.indexOf("'statement', (case");
    const body = assurance.slice(start, start + 1800);
    expect(body).toMatch(
      /when coalesce\(array_length\(v_scored, 1\), 0\) = 0\s+then format\('%s supporting item\(s\) linked, none scored[^']*', v_supporting\)/,
    );
    expect(body).toMatch(
      /when v_supporting = 0\s+then format\('Nothing supports this claim/,
    );
  });
});

describe("a governance record cannot be erased wholesale", () => {
  it.each([
    "gate_review_sessions",
    "framework_proposals",
    "gate_agent_reports",
    "risk_treatment_advice",
    "assurance_case_claims",
    "assurance_claim_evidence",
  ])("%s revokes TRUNCATE and carries a statement-level trigger", (table) => {
    // Row triggers do not fire on TRUNCATE, and all six granted it to
    // authenticated/anon/service_role. audit_events is the shipped precedent:
    // privilege revoked AND a trigger, because a revoke alone is undone by any
    // future `grant all`.
    expect(walls).toContain(`'${table}'`);
    expect(walls).toMatch(
      /revoke truncate on table public\.%I from authenticated, anon, service_role/,
    );
    expect(walls).toMatch(
      /before truncate on public\.%I .*for each statement/s,
    );
  });
});

describe("an FK that declares a cascade gets one", () => {
  it.each([
    [
      "gate_review_sessions",
      review,
      "development_cases",
      "enforce_gate_review_session_integrity",
    ],
    [
      "framework_proposals",
      method,
      "project_frameworks",
      "enforce_framework_proposal_provenance",
    ],
    [
      "gate_agent_reports",
      gateAgent,
      "development_cases",
      "enforce_gate_agent_report_provenance",
    ],
    [
      "risk_treatment_advice",
      riskAgent,
      "risks",
      "enforce_treatment_advice_boundary",
    ],
    [
      "assurance_case_claims",
      assurance,
      "development_cases",
      "enforce_assurance_claim_provenance",
    ],
    [
      "assurance_claim_evidence",
      assurance,
      "assurance_case_claims",
      "enforce_assurance_claim_evidence_provenance",
    ],
  ])(
    "%s stands aside mid-cascade rather than pinning its parent forever",
    (table, source, parent, fn) => {
      // Every DELETE branch raised unless a transaction-local marker was set,
      // and no set_config site in the slice wraps a DELETE — so the marker
      // could never be set during a cascade and the parent became undeletable,
      // with the refusal offering advice ("withdraw it") that cannot resolve
      // one. The house idiom is enforce_framework_immutability's: a parent that
      // no longer exists means the row is mid-cascade.
      const fnStart = source.indexOf(
        `create or replace function public.${fn}()`,
      );
      expect(fnStart, `${fn} is not defined`).toBeGreaterThan(-1);
      const trigger = source.indexOf("if tg_op = 'DELETE' then", fnStart);
      expect(trigger, `${table} has no DELETE branch`).toBeGreaterThan(-1);
      const branch = source.slice(trigger, trigger + 1400);
      expect(branch).toContain(
        `not exists (select 1 from ${parent} where id =`,
      );
      expect(branch).toContain("return old;");
    },
  );
});

describe("the methodology agent's retrieval can actually match a document", () => {
  it("the default query is a disjunction, not ten AND-ed lexemes", () => {
    const source = readCode(
      "supabase/functions/develop-methodology-agent/index.ts",
    );
    // websearch_to_tsquery CONJOINS bare words. The original default —
    // `stage gate framework stages gates decision requirements ${doc.title}` —
    // compiled to ten AND-ed lexemes and matched nothing on any document, so
    // the only product path to D12.06 always reached "nothing was retrieved".
    expect(source).not.toMatch(
      /stage gate framework stages gates decision requirements/,
    );
    expect(source).toContain("DEFAULT_RETRIEVAL_QUERY");
    const start = source.indexOf("const DEFAULT_RETRIEVAL_QUERY");
    const value = source.slice(start, source.indexOf(";", start));
    expect(value).toMatch(/\bor\b/);
    // Retrieved wide enough that an unrelated higher-ranked document cannot
    // crowd the named one out before the title filter runs.
    expect(source).toContain("p_limit: 20");
    // And the query is reachable from the product.
    const panel = readFileSync(
      "src/components/develop/FrameworkShelfPanel.tsx",
      "utf8",
    );
    expect(panel).toContain("retrievalQuery");
    expect(panel).toContain("query: retrievalQuery.trim() || undefined");
  });
});

describe("D3.01 / D3.23 — framework and stage authoring are product callers", () => {
  it("createProjectFramework and addFrameworkStage are invoked from the shelf", () => {
    const panel = readFileSync(
      "src/components/develop/FrameworkShelfPanel.tsx",
      "utf8",
    );
    expect(panel).toContain("createProjectFramework");
    expect(panel).toContain("addFrameworkStage");
    expect(panel).toContain("Create a draft framework (D3.01)");
    expect(panel).toContain("Add stage");
    expect(panel).toContain('value="checkpoint"');
    expect(panel).toContain("setGateRequirement");
  });
});

describe("D12.12's UI claim is a caller, not a sentence", () => {
  it("runRiskAgent is invoked from the Assurance Case screen", () => {
    // The service function existed, the edge function existed, the adopt and
    // dismiss forms existed — and nothing in the product could produce a
    // recommendation for them to act on. `runRiskAgent` had zero callers.
    const page = readFileSync("src/pages/AssuranceCasePage.tsx", "utf8");
    expect(page).toContain("runRiskAgent,");
    expect(page).toMatch(
      /await runRiskAgent\(\{\s*riskId: r\.id,\s*record: true,\s*\}\)/,
    );
    expect(page).toContain("ask the risk agent");
  });
});
