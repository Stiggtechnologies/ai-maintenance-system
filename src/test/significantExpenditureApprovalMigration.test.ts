import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261219200000_significant_expenditure_approval.sql",
  "utf8",
).toLowerCase();
const page = readFileSync("src/pages/DecisionGovernance.tsx", "utf8");

describe("C5.16 significant expenditure approval", () => {
  it("uses the canonical approval and authority stores", () => {
    expect(sql).toContain("action_type='commit_expenditure'");
    expect(sql).toContain("references public.approvals");
    expect(sql).toContain("references public.authority_limits");
    expect(sql).toContain("insert into public.approvals");
    expect(sql).not.toContain("create table public.expenditure_approvals");
  });
  it("refuses every unsafe amount decision", () => {
    expect(sql).toContain("no adopted expenditure delegation");
    expect(sql).toContain("blank is unfinished, not unlimited");
    expect(sql).toContain("syncai holds no exchange rate");
    expect(sql).toContain("exceeds the %s expenditure ceiling");
    expect(sql).toContain("requester may not approve or reject their own");
    expect(sql).toContain("an ai or system identity may not commit funds");
  });
  it("binds tenant, exact approval, and immutable authority evidence", () => {
    expect(sql).toContain("organization_id=public.app_current_org()");
    expect(sql).toContain("org_node_in_scope");
    expect(sql).toContain("canonical same-tenant approval back-reference");
    expect(sql).toContain("authority_ceiling");
    expect(sql).toContain("authority_currency");
    expect(sql).toContain("approvals_expenditure_sensitive");
    expect(sql).toContain("insert into public.audit_events");
    expect(sql).toContain("insert into public.security_events");
  });
  it("never claims or performs financial execution", () => {
    expect(sql).toContain(
      "does not execute procurement, payment, or a ledger posting",
    );
    expect(sql).toContain(
      "no purchase, payment, or ledger posting has occurred",
    );
    expect(sql).not.toContain("insert into public.purchase_orders");
    expect(page).toContain("<ExpenditureApprovalPanel />");
  });
});
