import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/deploy-migrations.yml", "utf8");
const marketplace = readFileSync("docs/azure-marketplace.md", "utf8");
const leads = readFileSync("docs/lead-response-sla.md", "utf8");

const unchanged =
  "Configuration unchanged by this run; existing runtime/database configuration and end-to-end outcomes were not verified.";

describe("deploy configuration honesty", () => {
  it("does not treat absent GitHub inputs as observed runtime state", () => {
    expect(workflow).toContain(unchanged);
    expect(workflow.match(/Configuration unchanged by this run/g)?.length).toBe(
      3,
    );
    expect(workflow).not.toContain(
      "Hourly dispatch remains unconfigured and no usage will be submitted.",
    );
    expect(workflow).not.toContain(
      "lead-notify will mark every incoming lead 'failed'",
    );
    expect(workflow).not.toContain("private.lead_notify_config stays empty");
    expect(workflow).toContain(
      "Incomplete Azure Marketplace metering configuration",
    );
    expect(workflow).toContain("Incomplete Azure Marketplace configuration");
    expect(workflow).toContain("lead-notify configuration failed");
  });

  it("distinguishes marketplace provisioning inputs from stored dispatcher configuration", () => {
    const prose = marketplace.replace(/\s+/g, " ");
    expect(prose).not.toContain(
      "Production dispatch remains a deliberate no-op until these repository settings",
    );
    expect(prose).toContain(
      "does not inspect or clear dispatcher configuration already stored",
    );
    expect(prose).toContain(
      "observed publisher authentication, subscription and meter",
    );
    expect(prose).toContain(
      "No live usage event has been submitted to Microsoft",
    );
    const leadProse = leads.replace(/\s+/g, " ");
    expect(leadProse).toContain(
      "Absence of a GitHub secret is not evidence that mail transport is missing",
    );
    expect(leadProse).not.toContain(
      "They are no-ops with a `::warning::` in the Actions log",
    );
  });
});
