import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270103130000_governed_asset_service_levels.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/assetServiceLevelService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/ServiceLevelGovernancePanel.tsx",
  "utf8",
);
const workspace = readFileSync(
  "src/components/AssetInterdependency.tsx",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const auditLedger = readFileSync("supabase/migrations/20261121090000_audit_ledger_hardening.sql", "utf8");
const contractReferences = readFileSync("src/services/serviceContractRiskService.ts", "utf8");
const contractSmoke = readFileSync("scripts/ci-service-contract-risk-smoke.sh", "utf8");
const browserFixture = readFileSync("scripts/tests/asset-service-level-browser-fixture.sql", "utf8");
const legacyBrowserSpecs = ["golden-path", "material-commercial-thread", "project-fracas", "time-synchronization-assurance"];
const browserFixtureName = "      - name: Service consequence browser fixtures";
const browserBatchName = "      - name: Golden-path E2E";

// Source wiring only, not a YAML interpreter or database/browser qualification.
function assertBrowserWiring(workflow: string) {
  const blocks = workflow.split(/(?=^ {6}- name:)/m);
  const fixtureBlocks = blocks.filter(block => block.startsWith(browserFixtureName));
  const batchBlocks = blocks.filter(block => block.startsWith(browserBatchName));
  expect(fixtureBlocks).toHaveLength(1);
  expect(batchBlocks).toHaveLength(1);
  const setup = fixtureBlocks[0];
  expect(workflow.indexOf(browserFixtureName)).toBeLessThan(workflow.indexOf(browserBatchName));
  expect(setup).toMatch(/^ {8}run: \|$/m);
  expect(setup).toMatch(/^ {10}set -euo pipefail$/m);
  expect(setup).toMatch(/^ {10}test "\$\{GITHUB_ACTIONS:-\}" = true$/m);
  expect(setup).toMatch(/^ {10}unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGPASSFILE$/m);
  expect(setup).toMatch(/psql -X -h 127\.0\.0\.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1/);
  expect(setup).toMatch(/-f scripts\/tests\/asset-service-level-browser-fixture\.sql/);
  // Pin both the caller's session marker and the SQL file's own admission gate.
  const marker = browserFixture.match(/current_setting\('([^']+)',true\)[\s\S]*?<> '([^']+)'/);
  expect(marker).not.toBeNull();
  expect(setup).toContain(`PGOPTIONS='-c ${marker![1]}=${marker![2]} -c statement_timeout=15000' PGPASSWORD=postgres`);
  const batch = batchBlocks[0].match(/^ {8}run: npx playwright test ([^\n]+)$/m);
  expect(batch).not.toBeNull();
  const specs = batch![1].trim().split(/\s+/);
  for (const spec of [...legacyBrowserSpecs, "asset-service-level-governance"])
    expect(specs.filter(path => path === `tests/e2e/${spec}.spec.ts`)).toHaveLength(1);
}

describe("U2.08 governed service-level consequence contract", () => {
  it("extends the canonical model with versioned evidence and independent review", () => {
    expect(migration).toContain("alter table public.asset_service_levels");
    expect(migration).toContain("evidence_item_id uuid");
    expect(migration).toContain("recorded_by uuid");
    expect(migration).toContain("reviewed_by uuid");
    expect(migration).toContain("reviewed_by <> recorded_by");
    expect(migration).toContain("p_expected_version");
    expect(migration).toContain("insert into public.audit_events");
  });

  it("fails closed on tenant, role, evidence and analysis-admission boundaries", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("public.app_current_role()");
    expect(migration).toContain("asset_service_levels_asset_tenant_fk");
    expect(migration).toContain("asset_service_levels_evidence_tenant_fk");
    expect(migration).toContain("e.verification_status = 'verified'");
    expect(migration).toContain("e.evidence_class in");
    expect(migration).toContain("and sl.status = 'verified'");
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("preserves unknowns and does not grant operational authority", () => {
    expect(migration).toContain("or left unknown");
    expect(migration).toContain(
      "grants no work, operating, risk-acceptance or restoration authority",
    );
    expect(panel).toContain("unknown values are never invented");
    expect(panel).toContain("Any edit invalidates this verification");
  });

  it("declares customer reachability and CI smoke wiring without claiming runtime qualification", () => {
    expect(service).toContain('supabase.rpc("record_asset_service_level"');
    expect(service).toContain('supabase.rpc("verify_asset_service_level"');
    expect(workspace).toContain("<ServiceLevelGovernancePanel");
    expect(ci).toContain("bash scripts/ci-asset-service-level-smoke.sh");
  });

  it("locks and revalidates current named membership after input waits", () => {
    expect(migration).toContain("for share of p nowait");
    expect(migration).toContain("v_locked_org is distinct from v_org");
    expect(migration).toContain("auth.uid() is distinct from v_uid");
    expect(migration).toContain("'U2081'");
  });

  it("uses canonical risk visibility and exact live evidence binding standing", () => {
    expect(migration).toContain("public.can_read_risk(e.risk_id)");
    expect(migration).toContain("to_jsonb(e) = p_evidence_snapshot");
    expect(migration).toContain("asset_service_level_standing");
    expect(migration).toContain("risk_stakeholder_views");
    expect(migration).toContain("public.get_risk_secondary_origin_internal");
  });

  it("preserves canonical full history and forbids privileged authority bypass", () => {
    expect(migration).toContain("from public, anon, authenticated, service_role");
    expect(migration).toContain("previous_state, new_state");
    expect(migration).toContain("to_jsonb(v_current)");
    expect(migration).toContain("to_jsonb(v_saved)");
    const guard = auditLedger.slice(auditLedger.indexOf("create or replace function public.audit_events_append_only()"), auditLedger.indexOf("revoke all on function public.audit_events_append_only()"));
    expect(guard).toContain("raise exception");
    expect(guard).toContain("append-only for every caller, the service path included");
    expect(guard).not.toMatch(/\breturn\b/i);
    expect(auditLedger).toContain("before update or delete on public.audit_events");
    expect(auditLedger).toContain("before truncate on public.audit_events");
    expect(migration).not.toContain("create or replace function public.audit_events_append_only");
  });

  it("reconciles an exact command only from a current actor-scoped canonical receipt", () => {
    expect(migration).toContain("public.get_asset_service_level_command");
    expect(migration).toContain("a.actor = auth.uid()::text");
    expect(migration).toContain("a.event_data->>'command_id' = p_command_id::text");
    expect(migration).not.toContain("create table");
    expect(service).toContain('supabase.rpc("get_asset_service_level_command"');
  });

  it("bounds every editor read to the canonical current named membership", () => {
    expect(migration).toContain("public.get_asset_service_level_editor");
    expect(migration).toContain("p_observed_actor_id is distinct from auth.uid()");
    expect(migration).toContain("p_observed_organization_id is distinct from public.app_current_org()");
    expect(migration).toContain("'analysis_eligible'");
    expect(service).not.toContain('.from("assets")');
    expect(service).not.toContain('.from("evidence_items")');
  });

  it("dynamically rechecks standing in both graph and coverage instead of status-only admission", () => {
    const graph = migration.slice(migration.indexOf("create or replace function public.get_dependency_graph"));
    expect(graph.match(/public\.asset_service_level_standing\(/g)).toHaveLength(2);
  });
  it("limits NEW optional contract reference choices to a current RLS-preserving projection, without rewriting historical U13 bindings", () => {
    expect(migration).toContain("with (security_invoker=true)");
    expect(migration).toContain("public.current_asset_service_level_references");
    expect(contractReferences).toContain('.from("current_asset_service_level_references")');
    expect(migration).not.toContain("create or replace function public.adopt_service_contract_obligation");
  });

  it("fences both captured and current old basis and rechecks visibility before replacement", () => {
    const record = migration.slice(migration.indexOf("create or replace function public.record_asset_service_level("), migration.indexOf("create or replace function public.verify_asset_service_level("));
    const oldFence = record.indexOf("public.lock_asset_service_level_basis_internal(v_org,v_current.evidence_item_id,v_current.evidence_snapshot)");
    const newFence = record.indexOf("v_evidence_snapshot:=public.lock_asset_service_level_basis_internal(v_org,p_evidence_item_id)");
    const profile = record.indexOf("for share of p nowait");
    const oldVisibility = record.indexOf("public.asset_service_level_basis_visible(v_org,v_current.evidence_item_id,v_current.evidence_snapshot)");
    const write = record.indexOf("update public.asset_service_levels");
    expect(oldFence).toBeGreaterThan(-1);
    expect(oldFence).toBeLessThan(newFence);
    expect(oldVisibility).toBeGreaterThan(profile);
    expect(oldVisibility).toBeLessThan(write);
    const fence = migration.slice(migration.indexOf("create or replace function public.lock_asset_service_level_basis_internal("), migration.indexOf("-- The existing audit_events_append_only"));
    expect(fence).toContain("p_snapshot jsonb default null");
    expect(fence).toContain("public.sync_text_as_uuid(p_snapshot->>'risk_id')");
    expect(fence).toContain("v_path_seen");
    expect(fence).toContain("v_locked");
    expect(migration).toContain("public.lock_asset_service_level_basis_internal(v_org,v_level.evidence_item_id,v_level.evidence_snapshot)");
  });

  it("unconditionally refuses service-state TRUNCATE for every caller at statement level", () => {
    const guard = migration.slice(migration.indexOf("create or replace function public.asset_service_levels_no_truncate()"), migration.indexOf("revoke all on function public.asset_service_levels_no_truncate()"));
    expect(guard).toContain("raise exception");
    expect(guard).not.toMatch(/\b(return|if|current_user|auth\.uid)\b/i);
    expect(migration).toContain("before truncate on public.asset_service_levels");
    expect(migration).toContain("for each statement execute function public.asset_service_levels_no_truncate()");
  });

  it("sets up U13 optional service context through independent governed operational review, not owner writes or copied contractual limits", () => {
    expect(contractSmoke).not.toMatch(/insert into asset_service_levels/i);
    expect(contractSmoke).toContain('record_asset_service_level');
    expect(contractSmoke).toContain('verify_asset_service_level');
    expect(contractSmoke).toContain('synthetic-u13-field-inspection');
    expect(contractSmoke).toContain('SERVICE_CAPTURE');
    expect(contractSmoke).toContain('p_observed_actor_id');
    expect(contractSmoke).toContain('p_tolerable_downtime_hours\\":null');
    expect(contractSmoke).toContain('p_restoration_rank\\":null');
    // The distinct existing U13 source/assertions stay intact: service context
    // is not the primary normative basis for these commercial numbers.
    expect(contractSmoke).toContain("'Executed U13 service agreement with monthly availability schedule.','DOCUMENTED'");
    expect(contractSmoke).toContain("target_value']==99.5");
    expect(contractSmoke).toContain("penalty_value']==25000");
    expect(contractSmoke).toContain("incentive_value']==5000");
    expect(contractSmoke).toContain('AUDIT_BEFORE + 5');
  });

  it("declares guarded loopback browser fixture setup before the explicit legacy-plus-U2 batch without claiming runtime proof", () => {
    assertBrowserWiring(ci);
  });

  it.each([
    ["missing fixture", ci.replace(/ {6}- name: Service consequence browser fixtures[\s\S]*?(?= {6}- name: Golden-path E2E)/, "")],
    ["wrong marker", ci.replace("app.ci_u208_browser_fixture=disposable_local_only", "app.ci_u208_browser_fixture=wrong")],
    ["missing CI guard", ci.replace(/test "\$\{GITHUB_ACTIONS:-\}" = true(?=[\s\S]*?asset-service-level-browser-fixture.sql)/g, "test true")],
    ["wrong host", ci.replace("psql -X -h 127.0.0.1 -p 54322", "psql -X -h example.invalid -p 54322")],
    ["wrong port", ci.replace("psql -X -h 127.0.0.1 -p 54322", "psql -X -h 127.0.0.1 -p 54323")],
    ["psql startup file allowed", ci.replace("psql -X -h 127.0.0.1 -p 54322", "psql -h 127.0.0.1 -p 54322")],
    ["errors ignored", ci.replace(/(- name: Service consequence browser fixtures[\s\S]*?)ON_ERROR_STOP=1/, "$1ON_ERROR_STOP=0")],
    ["fixture after batch", ci.replace(/( {6}- name: Service consequence browser fixtures[\s\S]*?)( {6}- name: Golden-path E2E[^\n]*\n[^\n]*\n)/, "$2$1")],
    ...[...legacyBrowserSpecs, "asset-service-level-governance"].map(spec => [
      `missing ${spec} suite`, ci.replace(` tests/e2e/${spec}.spec.ts`, ""),
    ]),
  ])("rejects source wiring regression: %s", (_name, workflow) => {
    expect(() => assertBrowserWiring(workflow)).toThrow();
  });
});
