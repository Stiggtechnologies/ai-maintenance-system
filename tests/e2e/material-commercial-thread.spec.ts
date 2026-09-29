import { test, expect } from "@playwright/test";

// playwright.config.ts pins this to the disposable local Supabase stack.
test("planner creates a material, links supplier and BOM, then reads provenance", async ({
  page,
}, testInfo) => {
  await page.goto("/signin");
  await page
    .getByRole("textbox", { name: /work email/i })
    .fill("planner@syncai.ca");
  await page.locator('input[type="password"]').fill("Planner123!@#");
  await page.getByRole("button", { name: /access syncai/i }).click();
  // Planners land on Operational Briefing, not the engineer's Mission Control.
  await expect(
    page.getByRole("heading", { name: "Operational Briefing", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page.goto("/materials");
  const code = `E2E-MATERIAL-${Date.now()}`;
  const source = `Drawing for ${code}`;
  await page.getByLabel("Material code", { exact: true }).fill(code);
  await page
    .getByLabel("Description", { exact: true })
    .fill("E2E traceable seal");
  await page.getByLabel("Unit of measure", { exact: true }).fill("each");
  await page.getByLabel("Source / basis", { exact: true }).fill(source);
  await page
    .getByRole("button", { name: "Create material", exact: true })
    .click();
  await expect(
    page.getByText(`Material ${code} created.`, { exact: false }),
  ).toBeVisible();

  const supplierPanel = page.getByRole("region", {
    name: "Supplier relationship",
    exact: true,
  });
  await expect(
    supplierPanel.getByRole("combobox", {
      name: "Catalogue material",
      exact: true,
    }),
  ).toBeEnabled();
  await supplierPanel
    .getByRole("combobox", { name: "Catalogue material", exact: true })
    .selectOption({ label: `${code} — E2E traceable seal` });
  await supplierPanel
    .getByRole("combobox", { name: "Supplier", exact: true })
    .selectOption({ index: 1 });
  await supplierPanel
    .getByLabel("Relationship source / basis")
    .fill(`Quote for ${code}`);
  await supplierPanel
    .getByRole("button", { name: "Record supplier relationship" })
    .click();
  await expect(supplierPanel.getByRole("status")).toContainText(
    "recorded as unapproved",
  );

  const bomPanel = page.getByRole("region", {
    name: "Bill of materials",
    exact: true,
  });
  await bomPanel
    .getByRole("combobox", { name: "BOM material", exact: true })
    .selectOption({ label: `${code} — E2E traceable seal` });
  await bomPanel
    .getByRole("combobox", { name: "BOM asset", exact: true })
    .selectOption({ index: 1 });
  await bomPanel.getByLabel("Quantity per asset / component").fill("2");
  await bomPanel.getByLabel("Position note (optional)").fill(code);
  await bomPanel.getByLabel("BOM source / basis").fill(source);
  await bomPanel
    .getByRole("button", { name: "Record BOM relationship" })
    .click();
  await expect(bomPanel.getByRole("status")).toContainText(
    "BOM relationship recorded",
  );

  const history = page.getByRole("region", {
    name: "Catalogue relationship history",
  });
  await history
    .getByRole("button", { name: "Refresh relationship history" })
    .click();
  await expect(
    history.getByText(`Source / basis: ${source}`).first(),
  ).toBeVisible();
  await expect(
    history.getByText(`Source / basis: Quote for ${code}`),
  ).toBeVisible();
  await testInfo.attach("material-commercial-workflow", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
