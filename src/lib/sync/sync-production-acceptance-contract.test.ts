import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const harness = read("scripts/sync-production-acceptance.mjs");
const workflow = read(".github/workflows/sync-production-acceptance.yml");
const runtime = read("supabase/functions/sync-investigation-runtime/index.ts");
const investigation = read("supabase/functions/_shared/sync-investigation.ts");
const conversation = read(
  "supabase/migrations/20260921110000_sync_investigation_v2.sql",
);
const app = read("src/App.tsx");

describe("Sync authenticated production acceptance contract", () => {
  it("runs the deterministic harness self-test without production secrets", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/sync-production-acceptance.mjs", "--self-test"],
      { cwd: root, encoding: "utf8" },
    );
    expect(output).toContain("Sync production acceptance self-test passed");
  });

  it("keeps the live job skipped when founder secrets are absent", () => {
    expect(workflow).toContain("secrets.SUPABASE_ACCESS_TOKEN != ''");
    expect(workflow).toContain("github.event_name != 'pull_request'");
    expect(workflow).toContain(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    );
    expect(workflow).toContain(
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    );
    expect(workflow).not.toMatch(/uses:\s+actions\/checkout@v\d/);
    expect(workflow).not.toMatch(/uses:\s+actions\/setup-node@v\d/);
  });

  it("does not persist production-derived commissioning evidence to the filesystem", () => {
    expect(harness).not.toMatch(/writeFile\s*\(/);
    expect(harness).not.toContain("SYNC_COMMISSIONING_EVIDENCE_PATH");
    expect(harness).toContain("archive_sync_conversation");
  });

  it("still targets the live Sync investigation surface after Stage-1 and manufacturing packs", () => {
    expect(harness).toContain("sync-investigation-runtime");
    expect(harness).toContain("create_sync_conversation");
    expect(harness).toContain("raise_maintenance_notification");
    expect(harness).toContain("screen_maintenance_notification");
    expect(harness).toContain("/assets/${DEMO_ASSET_ID}");
    expect(app).toContain('path="/assets/:assetId"');
    expect(conversation).toContain(
      "create or replace function public.create_sync_conversation",
    );
    expect(runtime).toContain('flags.has("sync_global_shell")');
    expect(runtime).toContain('flags.has("sync_tools")');
    for (const checkId of [
      "operational-kpis",
      "asset-data-integrity",
      "safety-indicators",
      "open-recommendations",
      "risk-ranking",
    ]) {
      expect(harness).toContain(checkId);
      expect(`${runtime}\n${investigation}`).toContain(`id: "${checkId}"`);
    }
  });

  it("requires the Management API token for live commissioning and does not invent one", () => {
    expect(harness).toContain('requiredEnv("SUPABASE_ACCESS_TOKEN")');
    expect(harness).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(workflow).toContain("secrets.SUPABASE_ACCESS_TOKEN");
    expect(workflow).not.toContain("secrets.SYNC_COMMISSIONING_PASSWORD");
  });
});
