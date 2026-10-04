import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102130000_historian_paginated_read.sql",
  "utf8",
);
const edge = readFileSync(
  "supabase/functions/plant-historian-pull/index.ts",
  "utf8",
);
const service = readFileSync("src/services/plantHistorian.ts", "utf8");
const setup = readFileSync(
  "src/components/PlantHistorianConnectorSetup.tsx",
  "utf8",
);

describe("plant historian paginated read contract", () => {
  it("reuses the canonical connector pagination profile and ingest plane", () => {
    expect(migration).toContain("public.connectors");
    expect(migration).toContain("pagination_mode");
    expect(migration).toContain("pagination_next_path");
    expect(migration).toContain("pagination_max_pages");
    expect(migration).toContain("public.connector_entity_mappings");
    expect(migration).not.toMatch(
      /create table[^;]+(?:historian|connector|integration)/i,
    );
    expect(edge).toContain('"begin_plant_historian_run"');
    expect(edge).toContain('"ingest_plant_historian_batch"');
    expect(edge).toContain('"finish_connector_run"');
  });

  it("keeps the pagination profile administrator-owned and fail-closed", () => {
    expect(migration).toContain(
      "configuring a plant historian source requires a named human administrator",
    );
    expect(migration).toContain("coalesce(p_system_kind, '') not in");
    expect(migration).toContain("192\\.168\\.");
    expect(migration).toContain("v_ref ~ '[@?=#]'");
    expect(migration).toContain("pagination mode must be none or next_url");
    expect(migration).toContain(
      "next_url pagination requires a safe dotted next-page path",
    );
    expect(migration).toMatch(/between 2 and 100/i);
    expect(migration).toContain(
      "'pagination_mode', v_connector.pagination_mode",
    );
    expect(migration).toContain(
      "'pagination_next_path', v_connector.pagination_next_path",
    );
    expect(migration).toContain(
      "'pagination_max_pages', v_connector.pagination_max_pages",
    );
  });

  it("binds approval, promotion, completion, and credentials to the tenant and named humans", () => {
    expect(migration).toContain("coalesce(v_role, '') <> 'admin'");
    expect(migration).toContain("approver.role = 'admin'");
    expect(migration).toContain("source_contract_hash");
    expect(migration).toContain("plant_historian_contract_hash");
    expect(migration).toContain("cr.triggered_by = auth.uid()");
    expect(migration).toContain(
      "c.connector_type in ('cmms_read', 'plant_historian')",
    );
    expect(edge).toContain("credential.tenant_id !== expectedTenantId");
    expect(edge).toContain("source.credential_tenant_id");
    expect(edge).toContain("p_expected_contract_hash: source.contract_hash");
    expect(edge).toContain('p_status: "failure"');
    expect(setup).toContain('const isAdmin = role === "admin"');
  });

  it("uses one canonical validator for no-write preview and commit", () => {
    expect(migration).toContain("public.plant_historian_validate_row(");
    expect(
      migration.match(/:= public\.plant_historian_validate_row\(/g),
    ).toHaveLength(2);
    expect(migration).toContain(
      "Dry run used the canonical commit validator and wrote no canonical or staging rows.",
    );
    expect(migration).toContain("public.record_condition_reading(");
    expect(migration).toContain("v_run.source_contract_hash is distinct from");
    expect(edge).toContain("!dryRun &&");
    expect(edge).toContain('source.mapping_status !== "approved"');
  });

  it("traverses only bounded same-origin GET pages without silent truncation", () => {
    expect(edge).toContain("MAX_TOTAL_ROWS = 50_000");
    expect(edge).toContain("MAX_TOTAL_BYTES = 50 * 1024 * 1024");
    expect(edge).toContain("MAX_TOTAL_DURATION_MS = 55_000");
    expect(edge).toContain("visited.has(current.href)");
    expect(edge).toContain("next.origin !== initial.origin");
    expect(edge).toContain("/^(?:fc|fd)[0-9a-f]{2}:/i");
    expect(edge).toContain("/^fe[89ab][0-9a-f]:/i");
    expect(edge).toContain(
      "Historian pagination exceeded its approved page limit",
    );
    expect(edge).toContain("Historian pagination loop detected");
    expect(edge).toContain(
      "Historian pagination exceeded its total transport time limit",
    );
    expect(edge).toContain("Math.min(FETCH_TIMEOUT_MS, remainingMs)");
    expect(edge).toContain('redirect: "error"');
    expect(edge).toMatch(/method:\s*"GET"/);
    expect(edge).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  });

  it("fetches the complete approved window before opening a canonical run", () => {
    const fetched = edge.indexOf("transportComplete = true");
    const begin = edge.indexOf('"begin_plant_historian_run"');
    expect(fetched).toBeGreaterThan(-1);
    expect(begin).toBeGreaterThan(fetched);
    expect(edge).toContain("transport_complete: transportComplete");
    expect(edge).toContain("pages: pageCount");
  });

  it("exposes the approved pagination profile to administrators", () => {
    expect(service).toContain("paginationMode");
    expect(service).toContain("p_pagination_next_path");
    expect(service).toContain("p_pagination_max_pages");
    expect(setup).toContain("Same-origin next-link pagination");
    expect(setup).toContain("Next-link JSON path");
    expect(setup).toContain("Maximum pages per pull");
  });
});
