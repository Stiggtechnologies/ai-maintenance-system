import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SQL = readFileSync(
  join(
    ROOT,
    "supabase/migrations/20270101455000_atomic_operating_recommendation_approval.sql",
  ),
  "utf8",
);
const SERVICE = readFileSync(
  join(ROOT, "src/services/operatingLoopService.ts"),
  "utf8",
);

describe("atomic operating recommendation approval", () => {
  it("keeps the buyer-value act in one database transaction", () => {
    expect(SQL).toContain(
      "create or replace function public.approve_operating_recommendation",
    );
    expect(SQL).toContain("update public.recommendations");
    expect(SQL).toContain("insert into public.decisions");
    expect(SQL).toContain("insert into public.approvals");
    expect(SQL).toContain("insert into public.work_orders");
    expect(SQL).toContain("insert into public.value_metrics");
    expect(SQL).toContain("insert into public.learning_events");
    expect(SQL).not.toMatch(/create\s+table/i);
  });

  it("preserves tenant, named-human and authority boundaries", () => {
    expect(SQL).toContain("v_org uuid := public.app_current_org()");
    expect(SQL).toContain("auth.uid() is null");
    expect(SQL).toMatch(/coalesce\(v_role,\s*''\)\s*=\s*'ai_admin'/i);
    expect(SQL).toContain("set status = 'approved'");
    expect(SQL).toContain("trg_recommendation_contract");
    expect(SQL).toContain("trg_enforce_authority_limit");
    expect(SQL).toContain("for update");
  });

  it("does not convert approval into verified outcome or execution", () => {
    expect(SQL).toContain("'recommendation_approved'");
    expect(SQL).toContain("'projected'");
    expect(SQL).toContain("'outcomeVerified', false");
    expect(SQL).not.toContain("recommendation_accepted");
    expect(SQL).not.toContain("'verified'");
  });

  it("routes the UI service through the atomic RPC rather than client writes", () => {
    const start = SERVICE.indexOf("export async function approveRecommendation");
    const end = SERVICE.indexOf("export async function setRecommendationStatus", start);
    const body = SERVICE.slice(start, end);

    expect(body).toContain('"approve_operating_recommendation"');
    expect(body).not.toContain('.from("recommendations")');
    expect(body).not.toContain('.from("work_orders")');
    expect(body).not.toContain('.from("decisions")');
  });
});
