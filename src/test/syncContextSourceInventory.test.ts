import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const path =
  "supabase/migrations/20270103170000_sync_context_source_inventory.sql";

describe("Context source inventory migration wiring (not runtime qualification)", () => {
  it("wires canonical missing-profile, commercial suspension, state and budget probes without disabling guards", () => {
    const probes = readFileSync(
      "scripts/tests/sync-context-source-inventory-gates.sql",
      "utf8",
    );
    for (const witness of [
      "canonical_commercial_suspension",
      "missing_profile_refusal",
      "stored_health_states",
      "exact_500_sources",
      "refuse_501_sources",
      "preallocation_inventory_budget",
      "overlong_metadata_refusal",
    ])
      expect(probes).toContain(witness);
    expect(probes).not.toMatch(/disable\s+(?:trigger|row\s+level\s+security)/i);
    expect(probes).toContain("rollback;");
  });
  it("refuses non-CI and ambient database/container transport before discovery or network calls", () => {
    const script = "scripts/ci-sync-context-operating-picture-smoke.sh";
    for (const env of [
      { GITHUB_ACTIONS: "false" },
      { GITHUB_ACTIONS: "true", PGHOSTADDR: "outside.example" },
      { GITHUB_ACTIONS: "true", PGSERVICE: "production" },
      { GITHUB_ACTIONS: "true", PGOPTIONS: "-c search_path=bad" },
      { GITHUB_ACTIONS: "true", DOCKER_HOST: "tcp://outside.example:2375" },
    ]) {
      const result = spawnSync("bash", [script], {
        env: { PATH: process.env.PATH, ...env },
        encoding: "utf8",
        timeout: 1000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(
        /refuses (?:execution outside|ambient transport)/,
      );
    }
    const source = readFileSync(script, "utf8");
    expect(source).toContain(
      '"$API_URL" = http://127.0.0.1:54321 || "$API_URL" = http://localhost:54321',
    );
    expect(source).not.toContain("http://127.0.0.1:*");
    // -q must be curl's first argument: a clean environment alone does not
    // prevent its user-home fallback from loading ambient .curlrc settings.
    expect(source).toContain('env -i PATH="$PATH" curl -q --noproxy');
    expect(source).toContain(
      "--noproxy '*' --proxy '' --connect-timeout 5 --max-time 30 --max-redirs 0",
    );
    expect(source).toContain(
      "DOCKER_HOST=unix:///var/run/docker.sock supabase status",
    );
    expect(source).toContain("psql -X");
  });
  it("uses current commercially gated identity and canonical connector RLS", () => {
    const sql = readFileSync(path, "utf8");
    const inventory = sql.slice(
      sql.indexOf("function public.get_sync_context_source_inventory("),
    );
    expect(inventory).toMatch(/security invoker/i);
    expect(inventory).toContain("public.app_current_org()");
    expect(inventory).toContain("u.id=auth.uid()");
    expect(inventory).toContain("u.organization_id=v_org and u.role=v_role");
    expect(inventory).toContain(
      "c.organization_id=v_org and c.context_source_class is not null",
    );
    expect(inventory).not.toMatch(
      /insert into|update public|delete from|audit_events|config|endpoint|geospatial_features/i,
    );
    expect(inventory).toContain("from public,anon,service_role");
  });

  it("shares effective source classification without changing the operating signature", () => {
    const sql = readFileSync(path, "utf8");
    expect(sql).toContain("public.sync_context_source_rights_permit(p_source)");
    expect(sql).toContain(
      "public.sync_context_source_health_permits_emission(p_source)",
    );
    expect(
      sql.match(/public.sync_context_source_read_state\(c,v_generated_at\)/g),
    ).toHaveLength(2);
    expect(sql).toContain(
      "p_site_id uuid default null, p_object_limit integer default 250, p_event_limit integer default 250",
    );
    // All inventory entries remain included, regardless of emission eligibility.
    const inventory = sql.slice(
      sql.indexOf("function public.get_sync_context_source_inventory("),
    );
    const population = inventory.slice(
      inventory.indexOf("with source_states"),
      inventory.indexOf("select jsonb_build_object('organizationId'"),
    );
    expect(population).not.toMatch(
      /where[^)]*(?:rights_ok|health_ok|clock_ok)/i,
    );
  });

  it("keeps coverage/check success unknown and refuses over-budget complete inventories", () => {
    const sql = readFileSync(path, "utf8");
    expect(sql).toContain("'lastSuccessfulCheckAt',null");
    expect(sql).toContain("'unknown_no_transport_receipt'");
    expect(sql).not.toContain("last_success_at");
    expect(sql).toContain("'no_governed_coverage_measurement'");
    expect(sql).toContain("v_count>500");
    expect(sql).toContain("v_bytes>8388608");
    expect(sql).toContain("octet_length(v_result::text)>8388608");
    expect(sql).toContain("'scope','organization'");
    expect(sql).toContain("'complete',true");
  });

  it("retains every operating gate after the shared-classifier extraction", () => {
    const old = readFileSync(
      "supabase/migrations/20270103160000_sync_context_operating_picture.sql",
      "utf8",
    );
    const next = readFileSync(path, "utf8");
    const marker = "  ), raw_subjects as materialized (";
    const end = "notify pgrst,'reload schema';";
    const oldTail = old.slice(old.indexOf(marker), old.indexOf(end)).trim();
    const nextTail = next
      .slice(next.indexOf(marker), next.indexOf("-- Separate metadata read"))
      .trim();
    expect(nextTail).toBe(oldTail);
    const signature =
      "create or replace function public.get_sync_context_operating_picture(";
    const oldHead = old.slice(
      old.indexOf(signature),
      old.indexOf("  with source_checks"),
    );
    const nextHead = next.slice(
      next.indexOf(signature),
      next.indexOf("  with effective_sources"),
    );
    expect(nextHead).toBe(oldHead);
  });
});
