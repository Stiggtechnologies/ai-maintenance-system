import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20271105143000_records_retention_adoption.sql",
  "utf8",
);
const page = readFileSync("src/pages/DecisionGovernance.tsx", "utf8");
const panel = readFileSync("src/components/ControlAssurance.tsx", "utf8");
const lower = sql.toLowerCase();

const RECORD_TABLES = [
  "work_orders",
  "recommendations",
  "recommendation_screenings",
  "board_packs",
  "audit_events",
];

function body(name: string): string {
  const marker = `function public.${name}`;
  const start = lower.indexOf(marker);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const next = lower.indexOf(
    "create or replace function",
    start + marker.length,
  );
  return lower.slice(start, next === -1 ? lower.length : next);
}

describe("E4.08 records retention adoption", () => {
  it("reuses the retention catalogue and the audit ledger", () => {
    expect(lower).toContain("alter table public.retention_policies");
    expect(lower).not.toContain("create table");
    expect(lower).toContain("insert into public.audit_events");
    expect(lower).toContain("previous_state");
    expect(lower).toContain("new_state");
    expect(page).toContain("<ControlAssurance />");
    expect(panel).toContain("adoptRetentionPolicy");
    expect(panel).toContain("setRetentionLegalHold");
    expect(panel).toContain("recordRetentionReview");
    expect(panel).toContain('"get_control_assurance"');
  });

  it("lets a named administrator or executive adopt, hold and review", () => {
    const governor = body("retention_named_governor");
    expect(governor).toContain("security definer");
    expect(governor).toContain("app_current_org()");
    expect(governor).toContain("ai_admin");
    expect(governor).toContain("named human");
    expect(governor).toContain("v_role not in ('admin', 'executive')");
    for (const name of [
      "adopt_retention_policy",
      "set_retention_legal_hold",
      "record_retention_review",
    ]) {
      const fn = body(name);
      expect(fn).toContain("security definer");
      expect(fn).toContain("retention_named_governor()");
      expect(fn).toContain("organization_id = v_org");
      expect(fn).toContain("insert into public.audit_events");
    }
    expect(body("set_retention_legal_hold")).toContain(
      "the human who placed the legal hold cannot release it",
    );
    expect(body("record_retention_review")).toContain(
      "adopt a retention period before recording a review",
    );
    expect(body("adopt_retention_policy")).toContain("for update");
    expect(lower).toContain("organization_id = v_org");
  });

  it("reports the position and never deletes the five record classes", () => {
    const position = body("get_retention_position");
    expect(position).toContain("app_current_org()");
    expect(position).toContain("beyond_policy");
    expect(position).toContain("oldest_record");
    expect(position).toContain("legal_hold");
    expect(position).toContain("it never deletes");
    for (const table of RECORD_TABLES) {
      expect(position).toContain(`from ${table}`);
      expect(position).toContain("organization_id = v_org");
      expect(lower).not.toMatch(
        new RegExp(`delete\\s+from\\s+(public\\.)?${table}\\b`, "i"),
      );
      expect(lower).not.toMatch(
        new RegExp(`truncate\\s+(table\\s+)?(public\\.)?${table}\\b`, "i"),
      );
    }
  });

  it("refuses direct catalogue writes and keeps the governed functions off anon", () => {
    expect(lower).toContain("syncai.retention_policy_write");
    expect(lower).toContain("before update or delete");
    expect(lower).toContain("before truncate");
    expect(lower).toContain("retention policies are not deleted");
    const flat = lower.replace(/\s+/g, " ");
    for (const signature of [
      "public.adopt_retention_policy(uuid, numeric, text, uuid)",
      "public.set_retention_legal_hold(uuid, boolean, text, uuid)",
      "public.record_retention_review(uuid, text, uuid)",
      "public.get_retention_position()",
      "public.get_control_assurance()",
      "public.retention_named_governor()",
    ]) {
      expect(flat).toContain(
        `revoke all on function ${signature} from public, anon, authenticated, service_role`,
      );
    }
    expect(lower).not.toContain(
      "grant execute on function public.retention_named_governor()",
    );
    expect(body("get_control_assurance")).toContain(
      "can_govern_retention', v_role in ('admin', 'executive')",
    );
    expect(body("get_control_assurance")).not.toContain(
      "can_govern_retention', v_role in ('admin', 'ai_admin', 'executive')",
    );
  });
});
