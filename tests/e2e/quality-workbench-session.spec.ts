import { expect, test, type Page } from "@playwright/test";

const REQUIREMENT = "Q7D-QR-1 · Controlled dimensional acceptance";
const NCR = "Q7D-NCR-1 · Controlled dimension out of tolerance";

// Real browser and seeded local Supabase read qualification. The second test
// injects a network failure only after the real authenticated read succeeds.
// No mutation, response fixture, production tenant or U8 causal claim is used.
async function openQuality(page: Page) {
  await page.goto("/signin");
  await page
    .getByRole("textbox", { name: /work email/i })
    .fill("demo@syncai.ca");
  await page.locator('input[type="password"]').fill("Demo123!@#");
  await page.getByRole("button", { name: /access syncai/i }).click();
  await expect(
    page.getByRole("heading", { name: "Mission Control" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.goto("/risk");
  const read = page.waitForResponse(
    (response) =>
      response.url().endsWith("/rpc/get_quality_cockpit") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Quality assurance", exact: true })
    .click();
  const response = await read;
  expect(response.status()).toBe(200);
  const cockpit = await response.json();
  expect(cockpit.error).toBeUndefined();
  expect(cockpit.metrics).toHaveLength(7);
  expect(Array.isArray(cockpit.requirements)).toBe(true);
  expect(Array.isArray(cockpit.ncrs)).toBe(true);
  expect(cockpit.requirements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        requirement_ref: "Q7D-QR-1",
        title: "Controlled dimensional acceptance",
      }),
    ]),
  );
  expect(cockpit.ncrs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ncr_ref: "Q7D-NCR-1",
        title: "Controlled dimension out of tolerance",
      }),
    ]),
  );
  await expect(
    page.getByRole("heading", { name: "Quality management & assurance" }),
  ).toBeVisible();
  await expect(page.getByText(REQUIREMENT, { exact: true })).toBeVisible();
  await expect(page.getByText(NCR, { exact: true })).toBeVisible();
  return cockpit;
}

test("quality records are reachable through the real Risk tab and remain read-only", async ({
  page,
}, testInfo) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      /\/rpc\/(record_quality_|approve_quality_|release_quality_|transition_quality_)/.test(
        path,
      )
    )
      writes.push(path);
  });
  const cockpit = await openQuality(page);
  for (const metric of cockpit.metrics)
    await expect(page.getByText(metric.label, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Quality action").locator("option")).toHaveCount(
    13,
  );
  await expect(page.getByLabel("Governed quality payload")).toBeVisible();
  await expect(
    page.getByText(/does not certify compliance or authorize operation/),
  ).toBeVisible();
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith("/rpc/get_quality_cockpit"),
  );
  await page.getByRole("button", { name: "Refresh quality records" }).click();
  expect((await refreshed).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Quality management & assurance" }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  await testInfo.attach("quality-read-qualification", {
    contentType: "application/json",
    body: JSON.stringify({
      basis: "Seeded local Supabase, authenticated browser read only",
      metricCount: cockpit.metrics.length,
      actionCount: 13,
      qualityWrites: writes.length,
      fullU8Qualified: false,
    }),
  });
});

test("failed refresh authentication hides the real cockpit and private draft without replay", async ({
  page,
}) => {
  await openQuality(page);
  await page
    .getByLabel("Governed quality payload")
    .fill('{"title":"CI private draft must disappear"}');
  let cockpitReads = 0;
  let qualityWrites = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/rpc/get_quality_cockpit")) cockpitReads += 1;
    if (
      request.method() === "POST" &&
      /\/rpc\/(record_quality_|approve_quality_|release_quality_|transition_quality_)/.test(
        path,
      )
    )
      qualityWrites += 1;
  });
  let denied = 0;
  await page.route("**/auth/v1/user", async (route) => {
    denied += 1;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Refresh quality records" }).click();
  await expect(
    page.getByText("Showing no data rather than stale values."),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Quality management & assurance" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Governed quality payload")).toHaveCount(0);
  await expect(page.getByText(REQUIREMENT, { exact: true })).toHaveCount(0);
  await expect(page.getByText(NCR, { exact: true })).toHaveCount(0);
  expect(denied).toBeGreaterThan(0);
  expect(cockpitReads).toBe(0);
  expect(qualityWrites).toBe(0);
  await page.unroute("**/auth/v1/user");
  const retry = page.waitForResponse((response) =>
    response.url().endsWith("/rpc/get_quality_cockpit"),
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  expect((await retry).status()).toBe(200);
  await expect(page.getByLabel("Governed quality payload")).not.toHaveValue(
    '{"title":"CI private draft must disappear"}',
  );
  expect(qualityWrites).toBe(0);
});
