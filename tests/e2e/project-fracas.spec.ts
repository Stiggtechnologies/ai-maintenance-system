import { test, expect } from "@playwright/test";

test("planner records execution and a separate human adopts the learning revision", async ({ page, browser }, testInfo) => {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: /work email/i }).fill("planner@syncai.ca");
  await page.locator('input[type="password"]').fill("Planner123!@#");
  await page.getByRole("button", { name: /access syncai/i }).click();
  await expect(page.getByRole("heading", { name: "Operational Briefing", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.goto("/develop/cases/98550000-0000-4000-8000-000000000001#realize");
  const panel = page.getByRole("region", { name: "Standard-work learning", exact: true });
  await panel.getByText("Record actual execution and learning", { exact: true }).click();
  const procedure = panel.getByRole("combobox", { name: "Procedure version", exact: true });
  await expect(procedure).toBeEnabled();
  const latest = procedure.getByRole("option", { name: /Flush acceptance/ }).last();
  await expect(latest).toHaveAttribute("value", /\d+/);
  await procedure.selectOption((await latest.getAttribute("value"))!);
  await panel.getByRole("combobox", { name: "Actual work order", exact: true }).selectOption({ label: "CI-LEARNING-OBS · Witnessed procedure execution · completed" });
  await panel.getByLabel("Observed at (local time)", { exact: true }).fill("2026-09-01T10:00");
  const title = `Browser witnessed learning ${testInfo.retry}`;
  await panel.getByLabel("Title", { exact: true }).fill(title);
  await panel.getByLabel("Actual execution", { exact: true }).fill("Witnessed acceptance record retained during execution");
  await panel.getByLabel("Variation basis", { exact: true }).fill("Intermediate steps not fully visible; conformance undetermined");
  await panel.getByLabel("Observed outcome and attribution limits", { exact: true }).fill("Inspection record retained; improved performance not established");
  await panel.getByLabel("Learning", { exact: true }).fill("Clarify retention location in the controlled procedure");
  await panel.getByLabel("Applicability", { exact: true }).fill("Equivalent flush acceptance activities only");
  for (const label of ["Execution evidence", "Outcome evidence"]) {
    await panel.getByRole("combobox", { name: label, exact: true }).selectOption("98551000-0000-4000-8000-000000000001");
  }
  await panel.getByRole("button", { name: "Record observation", exact: true }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Observation recorded:" })).toBeVisible();
  const observation = panel.locator("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(observation).toBeVisible();
  await observation.getByRole("button", { name: "Review procedure revisions" }).click();
  await observation.getByLabel("Changed procedure content").fill("Retain witnessed flush acceptance evidence in the controlled handover record");
  await observation.getByLabel("Change summary").fill("Clarify evidence retention location");
  await observation.getByLabel("Evidence and applicability basis").fill("Observed execution evidence; applies to equivalent flush acceptance work");
  await observation.getByRole("button", { name: "Request procedure revision" }).click();
  await expect(observation.getByRole("status")).toContainText("Draft revision");
  await expect(observation.getByText(/Flush acceptance · version .* · required/)).toBeVisible();
  await page.reload();
  await observation.getByRole("button", { name: "Review procedure revisions" }).click();
  await expect(observation.getByText(/Flush acceptance · version .* · required/)).toBeVisible();
  await expect(observation.getByText("Clarify evidence retention location", { exact: true })).toBeVisible();
  const approverContext = await browser.newContext();
  const approver = await approverContext.newPage();
  try {
    await approver.goto(new URL("/signin", page.url()).toString());
    await approver.getByRole("textbox", { name: /work email/i }).fill("admin@syncai.ca");
    await approver.locator('input[type="password"]').fill("Admin123!@#");
    await approver.getByRole("button", { name: /access syncai/i }).click();
    // Admin and planner have different authenticated landing pages.
    await expect(approver.getByRole("heading", { name: "Mission Control", exact: true })).toBeVisible({ timeout: 30_000 });
    await approver.goto(new URL("/develop/cases/98550000-0000-4000-8000-000000000001#realize", page.url()).toString());
    const review = approver.getByRole("region", { name: "Standard-work learning", exact: true }).locator("article")
      .filter({ has: approver.getByRole("heading", { name: title, exact: true }) });
    await review.getByRole("button", { name: "Review procedure revisions" }).click();
    await review.getByRole("combobox", { name: "Decision", exact: true }).selectOption("approved");
    await review.getByLabel("Decision basis", { exact: true }).fill("Second human reviewed source observation, evidence and exact changed procedure");
    await review.getByRole("button", { name: "Record human decision" }).click();
    await expect(review.getByText(/Flush acceptance · version .* · approved/)).toBeVisible();
  } finally {
    await approverContext.close();
  }
  await page.reload();
  await observation.getByRole("button", { name: "Review procedure revisions" }).click();
  await expect(observation.getByText(/Flush acceptance · version .* · approved/)).toBeVisible();
  await expect(observation.getByRole("button", { name: "Record human decision" })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1600 });
  await observation.evaluate(element => element.scrollIntoView({ block: "center" }));
  await observation.screenshot({ path: testInfo.outputPath("standard-work-learning.png") });
});

// CI seeds this chain through authenticated RPCs, not client response mocks.
test("planner inspects completed project closure and its screening provenance", async ({ page }, testInfo) => {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: /work email/i }).fill("planner@syncai.ca");
  await page.locator('input[type="password"]').fill("Planner123!@#");
  await page.getByRole("button", { name: /access syncai/i }).click();
  await expect(page.getByRole("heading", { name: "Operational Briefing", exact: true }))
    .toBeVisible({ timeout: 30_000 });
  await page.goto("/develop/cases/98550000-0000-4000-8000-000000000001#realize");
  await expect(page.locator("#realize").getByText("Seal failure at first start", { exact: true })).toBeVisible();
  const failureLesson = page.locator("#realize").getByText("Seal failure at first start", { exact: true }).locator("..");
  await failureLesson.getByRole("button", { name: "Project closure", exact: true }).click();
  await expect(page.getByText(/Governed project workflow completed through/)).toBeVisible();
  await expect(page.getByText(/Effectiveness and failure prevention are not established/)).toBeVisible();
  const panel = failureLesson.getByRole("region", { name: "Project standard change" });
  await expect(panel.getByText(/Adopted standard reference:/)).toBeVisible();
  await panel.getByText("Inspect screening receipt", { exact: true }).click();
  await expect(panel.getByText(/^Screening basis:/)).toBeVisible();
  await expect(panel.getByText("Source lifecycle: brownfield", { exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "98550000-0000-4000-8000-000000000002", exact: true }))
    .toHaveAttribute("href", "/develop/cases/98550000-0000-4000-8000-000000000002");
  await expect(panel.getByRole("link", { name: "98559999-0000-4000-8000-000000000001", exact: true })).toHaveCount(0);
  const basis = "Browser acceptance: reviewed current project exposure";
  await panel.getByLabel("Screening basis", { exact: true }).fill(basis);
  await panel.getByRole("button", { name: "Screen project exposure", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Screened 2 projects; 1 applicable matches.");
  await expect(panel.getByText(`Screening basis: ${basis}`, { exact: true })).toBeVisible();
  await page.reload();
  await failureLesson.getByRole("button", { name: "Project closure", exact: true }).click();
  await expect(page.getByText(/Governed project workflow completed through/)).toBeVisible();
  await panel.getByText("Inspect screening receipt", { exact: true }).click();
  await expect(panel.getByText(`Screening basis: ${basis}`, { exact: true })).toBeVisible();
  await expect(panel.getByText(/not proof of adoption by matched projects/)).toBeVisible();
  // Keep the real sticky application chrome in place while giving this tall
  // evidence panel enough room for an unobscured visual-review artifact.
  await page.setViewportSize({ width: 1440, height: 1600 });
  await panel.evaluate(element => element.scrollIntoView({ block: "center" }));
  await panel.screenshot({ path: testInfo.outputPath("project-fracas-screening.png") });
});
