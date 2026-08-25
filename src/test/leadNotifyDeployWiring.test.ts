import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  ".github/workflows/deploy-migrations.yml",
  "utf8",
);
const docs = readFileSync("docs/lead-response-sla.md", "utf8");

describe("lead-notify production wiring", () => {
  it("uses the service-role RPC without copying a database password to GitHub", () => {
    expect(workflow).toContain("LEAD_NOTIFY_SERVICE_KEY");
    expect(workflow).toContain("rest/v1/rpc/configure_lead_notify");
    expect(workflow).toContain("authorization: Bearer");
    expect(workflow).toContain("LEAD_CONFIG_PAYLOAD=$(jq -cn");
    expect(workflow).not.toContain("SUPABASE_DB_URL");
    expect(workflow).not.toContain('psql "$SUPABASE_DB_URL"');
  });

  it("accepts only a successful PostgREST response", () => {
    expect(workflow).toContain('"$LEAD_CONFIG_STATUS" != "200"');
    expect(workflow).toContain('"$LEAD_CONFIG_STATUS" != "204"');
    expect(workflow).toContain("lead-notify configuration failed");
  });

  it("documents the reduced production secret boundary", () => {
    expect(docs).toContain("service-role-only configuration RPC");
    expect(docs).toContain(
      "database password/`SUPABASE_DB_URL` is intentionally not copied",
    );
  });
});
