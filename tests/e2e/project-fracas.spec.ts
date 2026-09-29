import { test, expect } from "@playwright/test";

// CI seeds this chain through authenticated RPCs, not client response mocks.
test("planner inspects completed project closure and its screening provenance", async ({ page }, testInfo) => {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: /work email/i }).fill("planner@syncai.ca");
  await page.locator('input[type="password"]').fill("Planner123!@#");
  await page.getByRole("button", { name: /access syncai/i }).click();
  await expect(page.getByRole("heading", { name: "Operational Briefing", exact: true }))
    .toBeVisible({ timeout: 30_000 });
  await page.goto("/develop/cases/98550000-0000-4000-8000-000000000001#realize");
  await expect(page.getByText("Seal failure at first start", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Project closure", exact: true }).click();
  await expect(page.getByText(/Governed project workflow completed through/)).toBeVisible();
  await expect(page.getByText(/Effectiveness and failure prevention are not established/)).toBeVisible();
  const panel = page.getByRole("region", { name: "Project standard change" });
  await expect(panel.getByText(/Adopted standard reference:/)).toBeVisible();
  await panel.getByText("Inspect screening receipt", { exact: true }).click();
  await expect(panel.getByText("Screening basis: Review current project exposure", { exact: true })).toBeVisible();
  await expect(panel.getByText("Source lifecycle: brownfield", { exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "98550000-0000-4000-8000-000000000002", exact: true }))
    .toHaveAttribute("href", "/develop/cases/98550000-0000-4000-8000-000000000002");
  await expect(panel.getByRole("link", { name: "98559999-0000-4000-8000-000000000001", exact: true })).toHaveCount(0);
  await panel.screenshot({ path: testInfo.outputPath("project-fracas-screening.png") });
});
