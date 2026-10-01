import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INGEST_ENTITIES } from "../lib/ingest-entities";

const importer = readFileSync("src/components/ContractImport.tsx", "utf8");
const demandReview = readFileSync(
  "src/components/P6ResourceDemandReview.tsx",
  "utf8",
);
const parser = readFileSync("src/lib/p6-xer.ts", "utf8");
const ingest = readFileSync(
  "supabase/migrations/20261202090300_develop_slice4c_repair.sql",
  "utf8",
);

describe("D5.28 / D11.33 native P6 XER reachability", () => {
  it("routes XER through the one customer-reachable ingest contract", () => {
    expect(importer).toContain(
      'accept={entity.key === "schedule_activity" ? ".csv,.xer"',
    );
    expect(importer).toContain("parseP6Xer(text");
    expect(importer).toContain('"begin_manual_import"');
    expect(importer).toContain('"ingest_rows"');
    expect(importer).toContain('"finish_connector_run"');
    expect(importer).not.toMatch(/fetch\(|method:\s*["'](?:PATCH|PUT|DELETE)/);
  });

  it("carries every existing schedule-analysis input into the database door", () => {
    const names = INGEST_ENTITIES.schedule_activity.columns.map(
      (column) => column.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "total_float_hours",
        "constraint_type",
        "constraint_date",
        "relationships",
      ]),
    );
    for (const field of [
      "total_float_hours",
      "constraint_type",
      "constraint_date",
    ]) {
      expect(parser).toContain(`${field}:`);
      expect(ingest).toContain(`row_in->>'${field}'`);
    }
    expect(parser).toContain("relationships:");
    expect(ingest).toContain("row_in->'relationships'");
    expect(ingest).toContain("jsonb_typeof(row_in->'relationships') = 'array'");
  });

  it("routes assignments to unapproved canonical demand without inferring commitment", () => {
    expect(parser).toContain("not imported as approved resource demand");
    expect(parser).not.toMatch(
      /record_resource_demand|approve_resource_demand/,
    );
    expect(importer).toMatch(/SyncAI will not guess\s+either/);
    expect(importer).toContain("P6ResourceDemandReview");
    expect(demandReview).toContain("recordResourceDemand");
    expect(demandReview).toContain('sourceKind: "estimate"');
    expect(demandReview).toContain("Record as unapproved demand");
    expect(demandReview).toContain("Choose governed category");
    expect(demandReview).not.toMatch(
      /approveResourceDemand|approve_resource_demand/,
    );
  });

  it("contains no network, persistence or source-system write capability", () => {
    expect(parser).not.toMatch(
      /supabase|fetch\(|\.rpc\(|localStorage|sessionStorage/,
    );
    expect(parser).not.toMatch(/PATCH|PUT|DELETE/);
  });
});
