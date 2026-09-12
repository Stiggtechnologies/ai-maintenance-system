import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219156000_develop_digital_asset_maintainability.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/digitalAssetMaintainabilityService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/DigitalAssetMaintainabilityPanel.tsx",
  "utf8",
);
const surface = readFileSync("src/components/ConfigurationControl.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-develop-digital-asset-maintainability-smoke.sh",
  "utf8",
);

describe("D4.15 digital asset maintainability", () => {
  const fields = [
    "firmware",
    "software_version",
    "dependencies",
    "licenses",
    "patches",
    "vendor_support_horizon",
    "backup",
    "restore_procedures",
    "configuration_files",
  ];

  it("pins the exact nine-field contract on canonical configuration items", () => {
    for (const field of fields) {
      expect(migration).toContain(`'${field}'`);
      expect(service).toContain(`"${field}"`);
    }
    expect(migration).toContain("alter table public.configuration_items");
    expect(migration).toContain("alter table public.configuration_baselines");
    expect(migration).not.toContain("create table public.digital");
  });

  it("distinguishes unknown from an evidenced human not-applicable decision", () => {
    expect(migration).toContain(
      "digital_maintainability_applicability is null",
    );
    expect(migration).toContain("'NOT_ASSESSED'");
    expect(migration).toContain("'NOT_APPLICABLE'");
    expect(migration).toContain(
      "same-tenant applicability evidence is required",
    );
    expect(migration).toContain("lower(coalesce(v_role,'')) not in");
    expect(migration).toContain("'ai_admin'");
  });

  it("fails closed on direct digital writes and preserves tenant evidence", () => {
    expect(
      migration.match(
        /coalesce\(current_setting\('app\.digital_maintainability_write',true\),''\)<>'allowed'/g,
      ),
    ).toHaveLength(2);
    expect(migration).toContain(
      "configuration item must remain in its baseline tenant",
    );
    expect(migration).toContain(
      "digital configuration evidence must remain in the item tenant",
    );
    expect(smoke).toContain(
      "direct digital baseline rewrite unexpectedly succeeded",
    );
    expect(smoke).toContain(
      "cross-tenant digital evidence unexpectedly succeeded",
    );
  });

  it("feeds one computed readiness result into the canonical handover wall", () => {
    expect(migration).toContain("get_system_digital_maintainability");
    expect(migration).toContain("get_system_handover_readiness_pre_digital");
    expect(migration).toContain(
      "Digital asset maintainability is not complete for every system asset.",
    );
    expect(migration).toContain("'{canAccept}'");
    expect(migration).toContain(
      "v_not_applicable=v_total then 'NOT_APPLICABLE'",
    );
    expect(migration).toContain("not in ('READY','NOT_APPLICABLE')");
    expect(smoke).toContain(
      "handover unexpectedly remained acceptable before digital completion",
    );
    expect(smoke).toContain(
      "handover did not become acceptable after digital completion",
    );
  });

  it("has a customer-reachable human write and read path", () => {
    expect(panel).toContain("assessAssetDigitalMaintainability");
    expect(panel).toContain("recordDigitalConfigurationItem");
    expect(panel).toContain("getAssetDigitalMaintainability");
    expect(surface).toContain("<DigitalAssetMaintainabilityPanel />");
  });
});
