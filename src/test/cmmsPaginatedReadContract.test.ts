import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102110000_cmms_paginated_read.sql",
  "utf8",
);
const edge = readFileSync("supabase/functions/cmms-read-pull/index.ts", "utf8");
const service = readFileSync("src/services/cmmsRead.ts", "utf8");
const setup = readFileSync("src/components/CmmsReadConnectorSetup.tsx", "utf8");

describe("CMMS paginated read contract", () => {
  it("extends the canonical connector instead of creating another integration store", () => {
    expect(migration).toContain("alter table public.connectors");
    expect(migration).toContain("pagination_mode");
    expect(migration).toContain("pagination_next_path");
    expect(migration).toContain("pagination_max_pages");
    expect(migration).toContain("connector_profile");
    expect(migration).not.toMatch(
      /create table[^;]+(?:connector|integration)/i,
    );
    expect(migration).toContain("public.connector_entity_mappings");
    expect(migration).toContain("public.connector_runs");
    expect(migration).toContain("public.ingest_watermarks");
  });

  it("keeps pagination administrator-owned, bounded, and fail-closed", () => {
    expect(migration).toContain(
      "configuring a CMMS source requires an administrator",
    );
    expect(migration).toContain(
      "v_profile not in ('sap_pm','maximo','oracle_eam','generic_cmms')",
    );
    expect(migration).toContain("when 'generic_cmms' then 'cmms'");
    expect(migration).toContain("when 'sap_pm' then 'cmms'");
    expect(migration).toContain("else 'eam'");
    expect(migration).toContain("'source_profile',v_connector.connector_profile");
    expect(migration).toContain("192\\.168\\.");
    expect(migration).toContain("v_ref ~ '[@?=#]'");
    expect(migration).toContain("pagination mode must be none or next_url");
    expect(migration).toContain(
      "next_url pagination requires a safe dotted next-page path",
    );
    expect(migration).toContain("pagination_next_path is not null");
    expect(migration).toMatch(/between 2 and 100/i);
    expect(migration).toContain(
      "'pagination_mode',v_connector.pagination_mode",
    );
    expect(migration).toContain(
      "'pagination_next_path',v_connector.pagination_next_path",
    );
    expect(migration).toContain(
      "'pagination_max_pages',v_connector.pagination_max_pages",
    );
  });

  it("promotes through the canonical external-asset validator with retained outcomes", () => {
    expect(migration).toContain("public.recovery_activation_validate_row");
    expect(migration).toContain("and external_id=v_ext");
    expect(migration).toContain("public.work_orders");
    expect(migration).toContain("public.ingest_staging");
    expect(migration).toContain("'rejected'");
    expect(migration).toContain("'duplicate'");
    expect(migration).toContain("'accepted'");
    expect(migration).not.toContain(
      "return public.ingest_batch(p_run_id,p_rows)",
    );
  });

  it("traverses only bounded, same-origin GET pages and refuses loops or truncation", () => {
    expect(edge).toContain("MAX_TOTAL_ROWS = 50_000");
    expect(edge).toContain("MAX_TOTAL_BYTES = 50 * 1024 * 1024");
    expect(edge).toContain("MAX_TOTAL_DURATION_MS = 55_000");
    expect(edge).toContain("visited.has(current.href)");
    expect(edge).toContain("next.origin !== initial.origin");
    expect(edge).toContain("CMMS pagination exceeded its approved page limit");
    expect(edge).toContain("CMMS pagination loop detected");
    expect(edge).toContain(
      "CMMS pagination exceeded its total transport time limit",
    );
    expect(edge).toContain("Math.min(20_000, remainingMs)");
    expect(edge).toContain('redirect: "error"');
    expect(edge).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  });

  it("fetches every page before opening a canonical ingest run", () => {
    const begin = edge.indexOf('"begin_cmms_read_run"');
    const fetched = edge.indexOf("transportComplete = true");
    expect(fetched).toBeGreaterThan(-1);
    expect(begin).toBeGreaterThan(fetched);
    expect(edge).toContain('"ingest_cmms_read_batch"');
    expect(edge).toContain('"finish_connector_run"');
  });

  it("exposes the governed pagination profile to an administrator", () => {
    expect(service).toContain("paginationMode");
    expect(service).toContain("p_pagination_next_path");
    expect(service).toContain("p_pagination_max_pages");
    expect(setup).toContain("Same-origin next-link pagination");
    expect(setup).toContain("Next-link JSON path");
    expect(setup).toContain("Maximum pages per pull");
  });
});
