/**
 * Sync Develop Slice 1 rows 4–8 — migration contract (static, no database).
 *
 * Live behavior is proven by scripts/ci-develop-slice1-smoke.sh steps 11–16
 * against a real local database. This file pins the CONTRACT in the migration
 * text — the canonical-store rulings, the §70-idiom triggers, the revokes —
 * so a later edit that forks a store, drops a guard or loosens a boundary
 * fails CI before it reaches a database. Companion to
 * developSlice1Migration.test.ts, which pins the #281/#282 backbone.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));

const evidence = read("20261105090000_develop_evidence_model.sql");
const deliverables = read("20261105090100_develop_deliverables.sql");
const riskBinding = read("20261105090200_develop_risk_case_binding.sql");
const decisions = read("20261105090300_develop_decision_options.sql");
const actions = read("20261105090400_develop_action_case_binding.sql");
const workspace = read("20261105090500_develop_case_workspace_read.sql");
const lowerAll = [
  evidence,
  deliverables,
  riskBinding,
  decisions,
  actions,
  workspace,
]
  .join("\n")
  .toLowerCase();

describe("evidence (D11.17 — ruling 3: ONE evidence model)", () => {
  it("the eight classes and verification land ON evidence_items — no parallel evidence table", () => {
    expect(evidence).toContain("alter table public.evidence_items");
    expect(evidence).toContain(
      "('MEASURED','INSPECTED','CALCULATED','TESTED','DOCUMENTED',\n       'HISTORICAL','EXPERT_JUDGEMENT','AI_INFERENCE')",
    );
    expect(lowerAll).not.toMatch(/create table[^(;]*evidence/);
  });

  it("the class column is nullable — legacy rows stay honestly unclassified, never back-filled with invented provenance", () => {
    expect(evidence).toContain(
      "add column if not exists evidence_class text\n    check (evidence_class is null or evidence_class in",
    );
    expect(evidence).not.toMatch(/update evidence_items\s+set evidence_class/i);
  });

  it("a verified row structurally carries who/when/method — the named CHECK", () => {
    expect(evidence).toContain("constraint evidence_verification_recorded");
    expect(evidence).toMatch(
      /verified_by is not null\s+and verified_at is not null\s+and btrim\(coalesce\(verification_method, ''\)\) <> ''/,
    );
  });

  it("D11.18: the AI_INFERENCE→verified guard fires for EVERY caller in the SAME migration as the columns", () => {
    expect(evidence).toContain("enforce_evidence_verification_provenance");
    // The AI-specific refusal sits BEFORE the service-admit branch, so the
    // service role cannot silently verify an AI inference either.
    const aiCheck = evidence.indexOf("'AI_INFERENCE'\n     and new.verification_status = 'verified'");
    const serviceBranch = evidence.indexOf(
      "if not v_client and current_user not in ('authenticated', 'anon') then",
    );
    expect(aiCheck).toBeGreaterThan(-1);
    expect(serviceBranch).toBeGreaterThan(aiCheck);
    expect(evidence).toContain("using errcode = 'check_violation'");
  });

  it("D11.18 second layer: evidence_class is frozen once verified — the relabel-after-verify laundering path is refused, in the SAME migration", () => {
    // MEASURED -> verify -> relabel AI_INFERENCE would make an AI inference
    // "verified evidence" no human examined as one. A separate BEFORE UPDATE
    // trigger freezes the class once a determination is recorded.
    expect(evidence).toContain(
      "enforce_evidence_class_immutability",
    );
    expect(evidence).toContain(
      "before update on public.evidence_items",
    );
    expect(evidence).toMatch(
      /new\.evidence_class is not distinct from old\.evidence_class\s+or old\.verification_status = 'unverified'/,
    );
    expect(evidence).toContain(
      "Evidence class is frozen once a determination is recorded",
    );
    // Refused with a check violation (a broken invariant), and the service
    // path is admitted-and-audited like the sibling trigger.
    expect(evidence).toMatch(
      /Reclassifying a[\s\S]{0,400}using errcode = 'check_violation'/,
    );
    expect(evidence).toContain("reclassified");
  });

  it("§70 idiom: marker-gated client refusal, service admitted AND audited for all three ops, BEFORE DELETE returns OLD", () => {
    expect(evidence).toContain("app.evidence_verification_write");
    expect(evidence).toContain(
      "before insert or update or delete on public.evidence_items",
    );
    expect(evidence).toContain("inserted already carrying verification state");
    expect(evidence).toContain("deleted by a service caller");
    expect(evidence).toMatch(
      /return case when tg_op = 'DELETE' then old else new end/,
    );
    expect(evidence).toContain("using errcode = 'insufficient_privilege'");
    // SECURITY INVOKER — a DEFINER trigger would make the client check a
    // tautology (20261005090100's argument).
    expect(evidence).not.toMatch(
      /create or replace function public\.enforce_evidence_verification_provenance\(\)[\s\S]{0,200}security definer/i,
    );
  });

  it("verification is a HUMAN act: ai_admin refused by name; terminal states not overwritable", () => {
    expect(evidence).toContain(
      "the AI-operator identity cannot verify evidence",
    );
    expect(evidence).toContain("not overwritable");
  });

  it("case-linked evidence writes are definer-RPC-only, and a case-linked row cannot be silently UNLINKED or deleted by a client", () => {
    expect(evidence).toContain(
      "create policy evidence_items_case_scoped on public.evidence_items as restrictive",
    );
    expect(evidence).toContain("with check (development_case_id is null)");
    // The unlink guard: `using (development_case_id is null)` on UPDATE/DELETE
    // makes a case-linked row untargetable by a client, so `SET
    // development_case_id = NULL` cannot silently sever it from the case.
    expect(evidence).toContain(
      "create policy evidence_items_case_no_upd on public.evidence_items as restrictive",
    );
    expect(evidence).toContain(
      "create policy evidence_items_case_no_del on public.evidence_items as restrictive",
    );
    expect(evidence).toMatch(
      /evidence_items_case_no_upd[\s\S]{0,120}using \(development_case_id is null\)/,
    );
  });

  it("the document linkage rides the C2.15 KB intake rail — no second upload path", () => {
    expect(evidence).toContain("references kb_intake_documents(id)");
    expect(evidence).toContain("kb_ingest_document");
    expect(lowerAll).not.toMatch(/create table[^(;]*documents?\s*\(/);
  });
});

describe("deliverables (D3.26 — the one NEW object, everything else reused)", () => {
  it("requirement_id references stage_gate_criteria — the ONE requirement store", () => {
    expect(deliverables).toContain(
      "requirement_id bigint references stage_gate_criteria(id)",
    );
    expect(lowerAll).not.toMatch(/create table[^(;]*gate_requirements/);
  });

  it("document_id references kb_intake_documents; submission refuses documents outside the intake register", () => {
    expect(deliverables).toContain(
      "document_id uuid references kb_intake_documents(id)",
    );
    expect(deliverables).toMatch(/intake register/);
  });

  it("acceptance is structural: (status='accepted') ⇔ accepted_at, with accepted_by — the sanction-record shape", () => {
    expect(deliverables).toContain("constraint deliverable_acceptance_recorded");
    expect(deliverables).toContain(
      "((status = 'accepted') = (accepted_at is not null))",
    );
    expect(deliverables).toContain(
      "(status <> 'accepted' or accepted_by is not null)",
    );
  });

  it("the acceptance trigger carries the full #282 pattern", () => {
    expect(deliverables).toContain("app.deliverable_review_write");
    expect(deliverables).toContain(
      "before insert or update or delete on public.develop_deliverables",
    );
    expect(deliverables).toContain("inserted already carrying a review record");
    expect(deliverables).toContain("deleted by a service caller");
    expect(deliverables).toMatch(
      /return case when tg_op = 'DELETE' then old else new end/,
    );
  });

  it("segregation of duties: the owner cannot accept their own deliverable; ai_admin refused by name", () => {
    expect(deliverables).toContain(
      "cannot accept their own deliverable (segregation of duties)",
    );
    expect(deliverables).toContain(
      "the AI-operator identity cannot record one",
    );
  });

  it("org-scoped RLS, select-only to clients", () => {
    expect(deliverables).toContain(
      "alter table public.develop_deliverables enable row level security",
    );
    expect(deliverables).toMatch(
      /create policy develop_deliverables_read on public\.develop_deliverables\s+for select to authenticated using \(organization_id = app_current_org\(\)\)/,
    );
  });
});

describe("risk case-binding (D5.22 — ZERO new risk tables)", () => {
  it("is one column, one index and one RPC on the ONE risks table", () => {
    expect(riskBinding).toContain("alter table public.risks");
    expect(riskBinding).toContain("add column if not exists development_case_id");
    expect(riskBinding.toLowerCase()).not.toMatch(/create table/);
  });

  it("unbinding records why — the case's risk picture is what its gates were judged against", () => {
    expect(riskBinding).toContain("unbinding a risk from its case records why");
  });
});

describe("decisions + options (D3.27/D3.28 — ruling 4)", () => {
  it("the §16 columns land ON decisions; no fourth decision store", () => {
    expect(decisions).toContain("alter table public.decisions");
    for (const col of [
      "decision_question",
      "decision_required_date",
      "selected_option_id",
      "approval_level",
    ]) {
      expect(decisions).toContain(col);
    }
    expect(lowerAll).not.toMatch(/create table[^(;]*decision/);
  });

  it("options are the EXISTING scenarios object generalized with the §17 vector — no new options table", () => {
    expect(decisions).toContain("alter table public.scenarios");
    for (const col of [
      "capex",
      "opex",
      "lifecycle_cost",
      "schedule_effect",
      "risk_effect",
      "reliability_effect",
      "environmental_effect",
      "expected_value",
    ]) {
      expect(decisions).toContain(`add column if not exists ${col}`);
    }
    expect(lowerAll).not.toMatch(/create table[^(;]*options?\s*\(/);
  });

  it("a selection structurally carries who/when/rationale", () => {
    expect(decisions).toContain("constraint decisions_selection_recorded");
    expect(decisions).toMatch(
      /selected_by is not null\s+and selected_at is not null\s+and btrim\(coalesce\(selection_rationale, ''\)\) <> ''/,
    );
  });

  it("selection is marker-gated with the #282 pattern; ai_admin refused by name; never overwritten", () => {
    expect(decisions).toContain("app.decision_select_write");
    expect(decisions).toContain(
      "before insert or update or delete on public.decisions",
    );
    expect(decisions).toContain(
      "the AI-operator identity frames and prepares, it does not select",
    );
    expect(decisions).toContain("already been made");
    expect(decisions).toMatch(
      /return case when tg_op = 'DELETE' then old else new end/,
    );
  });

  it("a DECIDED decision's option set is frozen — chosen and rejected alike", () => {
    expect(decisions).toContain("enforce_decision_option_provenance");
    expect(decisions).toContain(
      "before insert or update or delete on public.scenarios",
    );
    expect(decisions).toContain("judged against");
  });

  it("assumption links ride the EXISTING risk_assumption_dependencies family — no new link table", () => {
    expect(decisions).toContain(
      "insert into risk_assumption_dependencies (organization_id, assumption_id, subject_type, subject_id)",
    );
    expect(decisions).toContain("'decision'");
    expect(lowerAll).not.toMatch(/create table[^(;]*assumption/);
  });

  it("evidence links are validated against canonical evidence_items in THIS organization", () => {
    expect(decisions).toMatch(
      /from evidence_items e\s+where e\.id = \(x #>> '\{\}'\)::uuid and e\.organization_id = v_org/,
    );
  });

  it("case decisions and decision options are definer-RPC-only, and cannot be silently detached/hijacked by a client", () => {
    expect(decisions).toContain(
      "create policy decisions_case_scoped on public.decisions as restrictive",
    );
    expect(decisions).toContain(
      "create policy scenarios_decision_scoped on public.scenarios as restrictive",
    );
    // The detach/hijack guard: a case decision (or a decision-linked option)
    // is untargetable by a client UPDATE/DELETE, so `SET development_case_id =
    // NULL, decision_question = '...'` (or `SET decision_id = NULL`) cannot
    // silently pull it off the case and edit it.
    for (const p of [
      "create policy decisions_case_no_upd on public.decisions as restrictive",
      "create policy decisions_case_no_del on public.decisions as restrictive",
      "create policy scenarios_decision_no_upd on public.scenarios as restrictive",
      "create policy scenarios_decision_no_del on public.scenarios as restrictive",
    ]) {
      expect(decisions).toContain(p);
    }
    expect(decisions).toMatch(
      /decisions_case_no_upd[\s\S]{0,120}using \(development_case_id is null\)/,
    );
  });
});

describe("actions (D11.37 — pure reuse by ruling)", () => {
  it("the entire persistence change is one column and one index on canonical recommendations", () => {
    expect(actions).toContain("alter table public.recommendations");
    expect(actions.toLowerCase()).not.toMatch(/create table/);
    expect(lowerAll).not.toMatch(/create table[^(;]*actions?\s*\(/);
  });

  it("the case binding is guarded column-scoped: a client cannot silently unlink an action, but non-link updates pass through", () => {
    // recommendations has a PERMISSIVE client write policy (unlike risks), so
    // the case link needs a guard — but a blunt row lock would break the
    // status/lifecycle writes the register keeps. The guard fires only on a
    // development_case_id change, marker-gated to bind_recommendation_to_case.
    expect(actions).toContain(
      "enforce_recommendation_case_binding_provenance",
    );
    expect(actions).toContain(
      "before insert or update on public.recommendations",
    );
    expect(actions).toContain("app.recommendation_case_binding_write");
    // Fires only on a case-link change; everything else returns new early.
    expect(actions).toContain(
      "new.development_case_id is distinct from old.development_case_id",
    );
    expect(actions).toMatch(/if not v_changed then\s+return new/);
    expect(actions).toContain("case binding is an audited act");
    expect(actions).toContain("A silent unlink erases the action");
  });
});

describe("the workspace read (§44 sections)", () => {
  it("stays SECURITY INVOKER so the risk-sensitivity boundary applies to the aggregate", () => {
    expect(workspace).toMatch(
      /function public\.get_development_case[\s\S]*?security invoker/i,
    );
  });

  it("renders all five section keys from persisted rows", () => {
    for (const key of [
      "'deliverables'",
      "'evidence'",
      "'risks'",
      "'decisions'",
      "'actions'",
    ]) {
      expect(workspace).toContain(key);
    }
    expect(workspace).toContain("verification_obligations");
  });

  it("keeps latest-review semantics in the readback", () => {
    expect(workspace).toMatch(
      /order by r\.reviewed_at desc, r\.id desc limit 1/,
    );
  });
});

describe("definer hygiene (the ratchet)", () => {
  it("every new SECURITY DEFINER function revokes from public and anon", () => {
    for (const name of [
      "record_case_evidence",
      "verify_evidence_item",
      "create_case_deliverable",
      "submit_deliverable",
      "accept_deliverable",
      "bind_risk_to_development_case",
      "create_case_decision",
      "add_decision_option",
      "select_decision_option",
      "bind_recommendation_to_case",
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
    for (const sql of [evidence, deliverables, riskBinding, decisions, actions]) {
      const definers = sql.match(/create or replace function[\s\S]*?\$\$;/g) ?? [];
      for (const fn of definers) {
        if (!/security definer/i.test(fn)) continue;
        if (/returns trigger/i.test(fn)) continue;
        expect(fn).toMatch(/app_current_org\(\)/);
      }
    }
  });

  it("trigger functions are revoked from authenticated too — executed by the system, never called", () => {
    for (const name of [
      "enforce_evidence_verification_provenance",
      "enforce_evidence_class_immutability",
      "enforce_deliverable_acceptance_provenance",
      "enforce_decision_selection_provenance",
      "enforce_decision_option_provenance",
      "enforce_recommendation_case_binding_provenance",
    ]) {
      expect(lowerAll).toContain(
        `revoke all on function public.${name}() from public, anon, authenticated`,
      );
    }
  });
});
