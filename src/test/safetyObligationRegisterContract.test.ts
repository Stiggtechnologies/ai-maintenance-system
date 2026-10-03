import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20270101800000_safety_obligation_register.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/safetyObligationService.ts", "utf8");
const panel = readFileSync(
  "src/components/SafetyObligationRegister.tsx",
  "utf8",
);
const host = readFileSync("src/components/ProcessSafety.tsx", "utf8");

describe("C2.11 safety-critical regulatory obligation register", () => {
  it("adds only an applicability edge between canonical nouns", () => {
    expect(sql).toContain("references public.safety_critical_elements");
    expect(sql).toContain("references public.regulatory_requirements");
    expect(sql).not.toContain(
      "create table if not exists public.regulatory_requirements (",
    );
    expect(sql).not.toContain(
      "create table if not exists public.safety_critical_elements (",
    );
    expect(sql).not.toContain("create table if not exists public.audit_");
    expect(sql).not.toContain("create table if not exists public.approval");
  });
  it("preserves tenant, human authority and verified-evidence gates", () => {
    expect(sql).toContain("organization_id=v_org");
    expect(sql).toContain("auth.uid() is null");
    expect(sql).toContain(
      "determinate applicability requires independently verified canonical evidence",
    );
    expect(sql).toContain(
      "e.verification_status is distinct from 'verified'",
    );
    expect(sql).toContain(
      "undetermined applicability must name the missing evidence",
    );
    expect(sql).toContain("insert into public.audit_events");
    expect(sql).toContain(
      "returning to_jsonb(safety_critical_element_obligations)",
    );
    expect(sql).toContain("revoke insert,update,delete,truncate");
  });
  it("does not change regulatory or operational state", () => {
    expect(sql).not.toMatch(/update\s+public\.regulatory_requirements/);
    expect(sql).not.toContain("insert into public.regulatory_approvals");
    expect(sql).not.toContain("insert into public.work_orders");
    expect(sql).toContain("applicability record only; no permit decision");
  });
  it("is reachable on the shipped Process Safety surface", () => {
    expect(service).toContain('"get_safety_obligation_register"');
    expect(service).toContain('"save_safety_critical_obligation"');
    expect(panel).toContain("Safety-critical regulatory obligations");
    expect(panel).toContain("Save applicability");
    expect(host).toContain("<SafetyObligationRegister />");
  });
});
