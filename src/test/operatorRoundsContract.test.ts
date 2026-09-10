import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219130000_operator_rounds_activation.sql",
  "utf8",
);
const surface = readFileSync("src/components/OperatorRounds.tsx", "utf8");
const host = readFileSync("src/pages/AssetDetailPage.tsx", "utf8");

const WORKFLOWS = [
  "define_operator_round",
  "start_operator_round",
  "record_operator_round_observation",
  "complete_operator_round",
] as const;

describe("operator rounds activation contract", () => {
  it("models approved definitions, executions, and observations", () => {
    for (const table of [
      "operator_round_definitions",
      "operator_round_executions",
      "operator_round_observations",
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it("reuses canonical assets, evidence, process events, and audit", () => {
    for (const table of [
      "assets",
      "evidence_items",
      "process_events",
      "audit_events",
    ])
      expect(migration).toContain(`public.${table}`);
    expect(migration).not.toContain("operator_round_alerts");
    expect(migration).toContain("'operator_round','field_observation'");
    expect(migration).toContain("'excursion'");
  });

  it("keeps definitions and field attestations human governed", () => {
    expect(migration).toContain(
      "AI cannot %; a named human must perform and attest the round",
    );
    expect(migration).toContain(
      "owner-approved cadence and evidence basis are required",
    );
    expect(migration).toContain("SyncAI does not invent checks or limits");
    expect(migration).toContain("must be chosen by the human observer");
  });

  it("tenant scopes every reference and prevents incomplete closeout", () => {
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("name an asset in this organization");
    expect(migration).toContain("required checks are missing");
    expect(migration).toContain("unique (execution_id, check_key)");
    expect(migration).toContain("supersedes_definition_id");
    expect(migration).toContain(
      "finish the in-progress round before approving a revised definition",
    );
  });

  it("keeps direct writes closed and exposes every workflow", () => {
    for (const workflow of WORKFLOWS) {
      expect(migration).toContain(`revoke all on function public.${workflow}`);
      expect(migration).toContain(
        `grant execute on function public.${workflow}`,
      );
      expect(surface).toContain(workflow);
    }
    expect(migration).toContain(
      "revoke insert, update, delete on public.operator_round_definitions",
    );
  });

  it("mounts the workflow in the live asset workspace", () => {
    expect(host).toContain(
      'import { OperatorRounds } from "../components/OperatorRounds"',
    );
    expect(host).toContain("<OperatorRounds assetId={asset.id}");
  });
});
