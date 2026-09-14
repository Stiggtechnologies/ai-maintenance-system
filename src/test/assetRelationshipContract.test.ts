import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261219340000_asset_relationship_accountability.sql",
  "utf8",
).toLowerCase();

describe("U12 asset relationship and party accountability contract", () => {
  it("extends the canonical tenure and stakeholder models with the complete vocabularies", () => {
    expect(sql).toContain("alter table public.asset_tenure");
    expect(sql).toContain("references public.risk_stakeholders");
    for (const relationship of [
      "owned",
      "leased",
      "rented",
      "concession",
      "oem_maintained",
      "third_party",
      "shared",
      "ppp",
      "customer_owned",
      "supplier_managed",
    ]) {
      expect(sql).toContain(`'${relationship}'`);
    }
    for (const role of [
      "owner",
      "operator",
      "maintainer",
      "engineering_authority",
      "risk_owner",
      "regulator",
      "insurer",
      "warranty_provider",
      "payer",
    ]) {
      expect(sql).toContain(`'${role}'`);
    }
  });

  it("enforces tenant-scoped writes and canonical evidence references", () => {
    expect(sql).toContain("organization_id=public.app_current_org()");
    expect(sql).toContain("e.organization_id=v_org");
    expect(sql).toContain("stakeholder not found in this organization");
    expect(sql).toContain("asset not found in this organization");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke insert,update,delete,truncate");
  });

  it("requires named humans and independent review", () => {
    expect(sql).toContain("ai identity is not accepted");
    expect(sql).toContain("author cannot independently verify");
    expect(sql).toContain("relationship_status='verified'");
    expect(sql).toContain("assigned_by<>verified_by");
    expect(sql).not.toContain("'ai_admin'");
  });

  it("keeps responsibility labels outside operational authority", () => {
    expect(sql).toContain(
      "no permission, work, operating or approval authority granted",
    );
    expect(sql).toContain("no product permission or operating authority");
    expect(sql).not.toContain("insert into public.approvals");
    expect(sql).not.toContain("insert into public.work_orders");
    expect(sql).not.toContain("insert into public.recommendations");
  });
});
