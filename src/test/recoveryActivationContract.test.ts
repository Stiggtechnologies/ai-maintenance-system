import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261003090000_recovery_activation_kit.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/syncRecoveryService.ts", "utf8");
const component = readFileSync(
  "src/components/RecoveryActivationKit.tsx",
  "utf8",
);
const page = readFileSync("src/pages/SyncRecoveryPage.tsx", "utf8");
const edge = readFileSync(
  "supabase/functions/recovery-activation-pull/index.ts",
  "utf8",
);
const workflow = readFileSync(
  ".github/workflows/deploy-migrations.yml",
  "utf8",
);

describe("Recovery Activation Kit contract", () => {
  it("extends the canonical connector contract for all first-tenant inputs", () => {
    for (const entity of [
      "site",
      "asset",
      "work_order",
      "material",
      "material_stock",
      "craft_capacity",
      "operating_state",
      "production_record",
    ]) {
      expect(migration).toContain(`'${entity}'`);
    }
    expect(migration).toContain("public.connectors");
    expect(migration).toContain("public.connector_runs");
    expect(migration).toContain("public.ingest_staging");
    expect(migration).not.toContain("create table recovery_work_orders");
  });

  it("makes mapping approval, dry-run and retained rejects explicit", () => {
    expect(migration).toContain("connector_entity_mappings");
    expect(migration).toContain("approved_by");
    expect(migration).toContain("preview_recovery_activation_batch");
    expect(migration).toContain("ingest_recovery_activation_batch");
    expect(migration).toContain("get_recovery_activation_rejects");
    expect(migration).toContain(
      "a dry run never writes canonical or staging rows",
    );
    expect(migration).toContain("external_id");
  });

  it("keeps the adapter read-only, secretless in SQL and tenant-bound", () => {
    expect(migration).toContain("direction='read_only'");
    expect(migration).toContain("write_enabled=false");
    expect(migration).toContain("credential_binding_ref");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("from public,anon");
    expect(migration).not.toMatch(/grant execute[^;]+to anon/);
    expect(edge).toContain("RECOVERY_CONNECTOR_CREDENTIALS_JSON");
    expect(edge).toContain("RECOVERY_CONNECTOR_ALLOWED_HOSTS");
    expect(edge).not.toContain("write_enabled: true");
  });

  it("ships a product path from activation to a governed draft plan", () => {
    expect(page).toContain('id: "activate"');
    expect(page).toContain("RecoveryActivationKit");
    expect(component).toContain("Dry-run validation");
    expect(component).toContain("Create governed draft plan");
    expect(service).toContain("get_recovery_activation_readiness");
    expect(service).toContain("prepare_first_recovery_plan");
    expect(migration).toContain("plan_status','draft'");
    expect(migration).toContain("existing approval and release gates");
  });

  it("deploys and boundary-probes the JWT-protected REST adapter", () => {
    expect(workflow).toContain(
      "supabase/functions/recovery-activation-pull/**",
    );
    expect(workflow).toContain(
      "supabase functions deploy recovery-activation-pull",
    );
    expect(workflow).toContain("Recovery Activation adapter is deployed");
  });
});
