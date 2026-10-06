import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102380000_verification_evidence_loop.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/operatingLoopService.ts", "utf8");
const loop = readFileSync("src/components/VerificationLoop.tsx", "utf8");
const mission = readFileSync("src/pages/MissionControl.tsx", "utf8");
const drawer = readFileSync(
  "src/components/RecommendationVerificationPlanDrawer.tsx",
  "utf8",
);

describe("C4.08 evidence-linked verification contract", () => {
  it("keeps the plan on the canonical recommendation and obligation records", () => {
    expect(migration).toContain("alter table public.recommendations");
    expect(migration).toContain("verification_intended_outcome");
    expect(migration).toContain("verification_acceptance_criteria");
    expect(migration).toContain("verification_owner_id");
    expect(migration).toContain("alter table public.verification_obligations");
    expect(migration).toContain(
      "work_order_id uuid references public.work_orders",
    );
    expect(migration).not.toMatch(/create table[^;]*(verification|evidence)/);
  });

  it("blocks recommendation approval until a named human supplied every plan element", () => {
    expect(migration).toContain(
      "enforce_recommendation_verification_plan_on_release",
    );
    expect(migration).toContain(
      "new.status in ('approved','released','scheduled')",
    );
    expect(migration).toContain(
      "length(btrim(coalesce(r.verification_method,'')))>=10",
    );
    expect(migration).toContain(
      "length(btrim(coalesce(r.verification_acceptance_criteria,'')))>=20",
    );
    expect(migration).toContain(
      "length(btrim(coalesce(r.verification_intended_outcome,'')))>=10",
    );
    expect(migration).toContain("coalesce(owner.role,'')<>'ai_admin'");
    expect(migration).toContain("coalesce(planner.role,'')<>'ai_admin'");
  });

  it("never derives a new recommendation verification date from plus 30 days", () => {
    const triggerStart = migration.indexOf(
      "create or replace function public.create_verification_obligation()",
    );
    const triggerEnd = migration.indexOf(
      "create or replace function public.verification_evidence_item_eligible",
    );
    const triggerBody = migration.slice(triggerStart, triggerEnd);
    expect(triggerBody).toContain("new.verification_due_date,false");
    expect(triggerBody).not.toMatch(/interval\s*'30 days'|\+\s*30/);
    expect(migration).toContain(
      "syncai will not invent a +30-day verification date",
    );
  });

  it("requires the named owner and exactly one independently governed source", () => {
    expect(migration).toContain(
      "auth.uid() is distinct from o.verification_owner_id",
    );
    expect(migration).toContain(
      "(p_evidence_id is null)=(p_work_order_id is null)",
    );
    expect(migration).toContain("recommendation_provenance_status='validated'");
    expect(migration).toContain("e.recommendation_id=p_recommendation_id");
    expect(migration).toContain(
      "recommendation_provenance_reviewed_by is not null",
    );
    expect(migration).toContain("approval.status='approved'");
    expect(migration).toContain(
      "approval.approval_scope->>'evidenceid'=e.id::text",
    );
    expect(migration).toContain("e.ts>=p_not_before");
    expect(migration).toContain("e.ts<=now()");
  });

  it("admits only completed same-asset CMMS records with approved read-only provenance", () => {
    expect(migration).toContain("w.asset_id=p_asset_id");
    expect(migration).toContain("w.completed_at is not null");
    expect(migration).toContain(
      "lower(btrim(coalesce(w.status,''))) in ('completed','closed')",
    );
    expect(migration).toContain("w.completed_at>=p_not_before");
    expect(migration).toContain("w.completed_at<=now()");
    expect(migration).toContain("c.connector_type='cmms_read'");
    expect(migration).toContain("c.status='active'");
    expect(migration).toContain("c.direction='read_only'");
    expect(migration).toContain("not c.write_enabled");
    expect(migration).toContain("m.entity_type='work_order'");
    expect(migration).toContain("m.status='approved'");
    expect(migration).toContain("mapping_approver.role='admin'");
    expect(migration).toContain("s.status='accepted'");
    expect(migration).toContain("cr.status in ('success','partial')");
    expect(migration).toContain(
      "cr.source_contract_hash=public.cmms_read_contract_hash(c.id)",
    );
    expect(migration).toContain("run_actor.id=cr.triggered_by");
    expect(migration).toContain(
      "lower(btrim(s.payload->>'status'))=lower(btrim(w.status))",
    );
    expect(migration).toContain(
      "nullif(s.payload->>'completed_at','')::timestamptz=w.completed_at",
    );
    expect(migration).toContain("source_asset.id=w.asset_id");
  });

  it("preserves requirement audit vocabulary and the source facts reviewed for verification", () => {
    expect(migration).toContain("'verification_status',d.verification_status");
    expect(migration).toContain("'verification_status',v_new_status");
    expect(migration).toContain(
      "'supersedes_obligation_id',o.supersedes_obligation_id",
    );
    expect(migration).toContain("§70 human act");
    expect(migration).toContain("stays failed");
    expect(migration).toContain("protect_verification_evidence_observation");
    expect(migration).toContain("new.ts is distinct from old.ts");
    expect(migration).toContain(
      "new.description is distinct from old.description",
    );
    expect(migration).toContain("p_result is null or p_result not in");
    expect(migration).toContain("new.evidence_required:=true");
    expect(migration).toContain(
      "where status='completed' and evidence_required",
    );
    expect(migration).toContain(
      "historical completed outcomes predate that gate",
    );
  });

  it("leaves shared requirement and pre-gate citation governance with its existing provenance wall", () => {
    const planGuard = migration.slice(
      migration.indexOf(
        "create or replace function public.enforce_verification_plan_write()",
      ),
      migration.indexOf(
        "revoke all on function public.enforce_verification_plan_write()",
      ),
    );
    expect(planGuard).toContain("if old.recommendation_id is null then");
    const sourceGuard = migration.slice(
      migration.indexOf(
        "create or replace function public.enforce_verification_evidence_link()",
      ),
      migration.indexOf(
        "revoke all on function public.enforce_verification_evidence_link()",
      ),
    );
    expect(sourceGuard).toContain(
      "if new.recommendation_id is null or not new.evidence_required then",
    );
    expect(sourceGuard.indexOf("new.evidence_required:=true")).toBeLessThan(
      sourceGuard.indexOf(
        "if new.recommendation_id is null or not new.evidence_required then",
      ),
    );
    expect(sourceGuard).toContain(
      "cmms work-order evidence is supported only for recommendation outcome verification",
    );
    // The existing guard still freezes closed methods and records FK citation
    // severance. This slice must not replace or disable that backstop.
    expect(migration).not.toContain(
      "drop trigger if exists trg_verification_result_provenance",
    );
    expect(migration).not.toContain(
      "disable trigger trg_verification_result_provenance",
    );
  });

  it("recovers an unwatched action as new open debt, never a fabricated prior outcome", () => {
    expect(migration).toContain("v_created_obligation boolean:=false");
    expect(migration).toContain("if o.status<>'open' then");
    expect(migration).toContain("v_created_obligation:=true");
    expect(migration).toContain("'previously_unwatched',v_created_obligation");
    expect(migration).toContain("'unwatched_action'");
    expect(migration).toContain("public.get_unwatched_verification_actions");
    expect(migration).toContain("not exists(");
    expect(migration).toContain(
      "limit greatest(1,least(coalesce(p_limit,20),200))",
    );
    expect(loop).toContain("Plan missing verification");
    expect(drawer).toContain("New evidence must be observed after");
  });

  it("enforces tenancy and immutability behind the RPC door", () => {
    expect(migration).toContain("trg_verification_evidence_link");
    expect(migration).toContain(
      "verification work-order evidence must belong to the same organization",
    );
    expect(migration).toContain(
      "verification evidence links are written through record_verification_result",
    );
    expect(migration).toContain("app.verification_result_write");
    expect(migration).toContain("app.verification_plan_write");
    for (const helper of [
      "recommendation_verification_plan_valid",
      "verification_obligation_plan_valid",
      "verification_evidence_item_eligible",
      "verification_work_order_eligible",
    ]) {
      expect(migration).toContain(`revoke all on function public.${helper}`);
      expect(migration).not.toMatch(
        new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${helper}`),
      );
    }
  });

  it("preserves failed-result learning and does not grant plant authority", () => {
    expect(migration).toContain("'verification_failed'");
    expect(migration).toContain("'operational_authorization',false");
    expect(migration).toContain(
      "this migration does not enable plant execution or source-system write-back",
    );
    expect(migration).not.toMatch(
      /execute[_ ]plant|write[_ -]?back\s*=\s*true/,
    );
  });

  it("wires planning before approval and governed evidence selection at closure", () => {
    expect(service).toContain("recordRecommendationVerificationPlan");
    expect(service).toContain("p_work_order_id: workOrderId ?? null");
    expect(mission).toContain("RecommendationVerificationPlanDrawer");
    expect(mission).toContain("Verification plan");
    expect(loop).toContain("Governed evidence source");
    expect(loop).toContain("Complete verification plan");
    expect(drawer).toContain("Approval is blocked until this plan is complete");
    expect(drawer).toContain("The customer retains those");
  });
});
