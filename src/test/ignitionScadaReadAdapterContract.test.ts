import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read(
  "supabase/migrations/20271028100000_ignition_scada_read_adapter.sql",
);
const edge = read("supabase/functions/ignition-scada-read-pull/index.ts");
const shared = read("supabase/functions/_shared/ignition-scada-read.ts");
const page = read("src/pages/IntegrationsPage.tsx");
const service = read("src/services/ignitionScadaRead.ts");
const docs = read("docs/ignition-scada-read-adapter.md");

describe("C2.20 Ignition SCADA read contract", () => {
  it("reuses the canonical connector, run, staging and watermark planes", () => {
    for (const token of [
      "public.connectors",
      "public.connector_runs",
      "public.ingest_staging",
      "public.ingest_watermarks",
    ]) {
      expect(migration).toContain(token);
    }
    expect(migration).not.toMatch(/create table/i);
    expect(migration).toContain("connector_type = 'scada_read'");
    expect(migration).toContain("system_kind = 'historian'");
    expect(migration).toContain("connector_profile = 'ignition_tag_read'");
    expect(migration).toContain("register_ref = 'C2.20'");
  });

  it("is service-attested, tenant-bound and permanently read-only", () => {
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration).toContain(
      "a named human administrator must configure or enable an Ignition source",
    );
    expect(migration).toContain("direction = 'read_only'");
    expect(migration).toContain("not write_enabled");
    expect(migration).toContain("'sourceWriteBack', false");
    expect(migration).toContain("c.organization_id = r.organization_id");
    expect(migration).toContain("from public, anon, authenticated");
    expect(shared).toContain('method: "GET"');
    expect(shared).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(edge).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(edge).toContain("writeEnabled: false");
    expect(edge).toContain("allowLoopback: false");
    expect(edge).not.toContain("allowLoopback: true");
    expect(shared).toContain("system.tag.readBlocking");
    expect(shared).not.toContain("system.tag.write");
  });

  it("keeps the approved tag list and refuses write resources", () => {
    expect(shared).toContain(
      "Ignition tag read escaped the approved tag path.",
    );
    expect(shared).toContain(
      "Ignition resource must be a published read WebDev path, not a write or staging resource.",
    );
    expect(migration).toContain("must not name a write");
    expect(migration).toContain(
      "Ignition rows must exactly reconcile to the approved tag list",
    );
    expect(docs.toLowerCase()).toContain("mock");
    expect(docs.toLowerCase()).toMatch(/not certified\s+against a live/);
    expect(docs).toContain("docs.inductiveautomation.com");
  });

  it("wires the Integrations entry to the setup screen without a deploy allowlist change", () => {
    expect(page).toContain("IgnitionScadaReadConnectorSetup");
    expect(page).toContain('getElementById("ignition-scada-read-setup")');
    expect(page).toContain('c.connector_type === "scada_read"');
    expect(service).toContain('"configure_ignition_scada_source"');
    expect(service).toContain('"ignition-scada-read-pull"');
    const component = read(
      "src/components/IgnitionScadaReadConnectorSetup.tsx",
    );
    expect(component).toContain("Dry-run tag read");
    expect(component).toContain("Read tag snapshot");
    expect(component).toContain("cannot write tags");
    expect(component.replace(/\s+/g, " ")).toContain(
      "not certified against a live Ignition server",
    );
    const boundary = read("config/edge-function-boundary.json");
    const workflow = read(".github/workflows/deploy-migrations.yml");
    expect(boundary).not.toContain("ignition-scada-read-pull");
    expect(workflow).not.toContain("ignition-scada-read-pull");
    expect(read("supabase/config.toml")).toContain(
      "[functions.ignition-scada-read-pull]\nverify_jwt = true",
    );
  });
});
