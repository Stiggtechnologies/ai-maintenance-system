import { test, expect } from "@playwright/test";

// Actual seeded Supabase/browser witness, not a mocked RPC or a production claim.
test("clock assurance is customer-reachable, has no invented defaults and retains its draft boundary", async ({
  page,
}, testInfo) => {
  await page.goto("/signin");
  await page
    .getByRole("textbox", { name: /work email/i })
    .fill("admin@syncai.ca");
  await page.locator('input[type="password"]').fill("Admin123!@#");
  await page.getByRole("button", { name: /access syncai/i }).click();
  await expect(
    page.getByRole("heading", { name: "Mission Control" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.goto("/integrations");
  const clock = page.getByRole("region", { name: "Event-time assurance" });
  await expect(clock).toBeVisible({ timeout: 30_000 });
  await expect(
    clock.getByText(/an opaque evidence reference is not verified/i),
  ).toBeVisible();
  const tolerance = clock.getByLabel("Recorded tolerance in milliseconds");
  const freshness = clock.getByLabel("Maximum observation age in minutes");
  const save = clock.getByRole("button", { name: "Save clock contract" });
  await expect(tolerance).toHaveValue("");
  await expect(freshness).toHaveValue("");
  await expect(save).toBeDisabled();
  const connector = clock.getByLabel("Time-assurance connector");
  const options = await connector
    .locator("option")
    .evaluateAll((rows) =>
      rows.map((row) => (row as HTMLOptionElement).value).filter(Boolean),
    );
  expect(options.length).toBeGreaterThan(0);
  await connector.selectOption(options[0]);
  await clock
    .getByPlaceholder(/Authoritative source/i)
    .fill("E2E draft grandmaster");
  await tolerance.fill("25");
  await freshness.fill("10");
  await clock
    .getByPlaceholder(/Evidence reference/i)
    .fill("E2E-DRAFT-TIME-REFERENCE");
  await clock
    .getByPlaceholder(/Clock authority/i)
    .fill(
      "Synthetic browser fixture; canonical engineering evidence approval is not claimed.",
    );
  await expect(save).toBeEnabled();
  const configuredResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/rpc/configure_connector_time_assurance") &&
      response.request().method() === "POST",
  );
  await save.click();
  const response = await configuredResponse;
  expect(response.status()).toBe(200);
  const recorded = await response.json();
  expect(recorded.error).toBeUndefined();
  expect(recorded.ok).toBe(true);
  expect(recorded.state).toBe("unproven");
  expect(recorded.operational_authority).toBe(false);
  await expect(
    clock.getByText(/Clock contract recorded. A current service observation/i),
  ).toBeVisible();

  const statusResponse = page.waitForResponse((r) =>
    r.url().endsWith("/rpc/get_connector_time_assurance"),
  );
  await page.reload();
  const status = await (await statusResponse).json();
  const retained = status.connectors.find(
    (row: { connectorId: string }) => row.connectorId === options[0],
  );
  expect(retained.configurationEvidenceReference).toBe(
    "E2E-DRAFT-TIME-REFERENCE",
  );
  expect(retained.configurationRevision).toBe(recorded.configuration_revision);
  expect(retained.toleranceMs).toBe(25);
  expect(retained.maxObservationAgeMinutes).toBe(10);
  expect(retained.configurationEvidenceVerified).toBe(false);
  expect(retained.eligibleForTimeSensitiveEvidence).toBe(false);
  expect(retained.state).toBe("unproven");
  await expect(
    page.getByRole("region", { name: "Event-time assurance" }),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "Event-time assurance" })
    .screenshot({ path: testInfo.outputPath("draft-clock-assurance.png") });
});
