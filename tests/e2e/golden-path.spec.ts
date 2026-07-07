import { test, expect, type Page } from "@playwright/test";

/**
 * Golden path — the SyncAI buyer-value loop, end to end, against a freshly
 * seeded local Supabase (supabase db reset):
 *
 *   Login → Mission Control (live data) → Evidence → Scenario comparison
 *   → Approve → Work Action Board (approval-gated WO) → Decision Governance
 *   → Value Realization (pending verification → operator verify)
 *   → Learning Loop (verified-value event)
 *
 * State note: these tests are sequential (workers: 1) and mutate demo state.
 * Re-running requires `supabase db reset` first.
 */

const DEMO_EMAIL = "demo@syncai.ca";
const DEMO_PASSWORD = "Demo123!@#";

const C22_REC_TITLE = "Reschedule PM on Conveyor C-22";
const C22_REC_ACTION = "Advance PM from Day 14 to Day 3 — bearing replacement";
const C22_VALUE_LABEL = "Risk mitigated — Reschedule PM on Conveyor C-22";

async function login(page: Page) {
  await page.goto("/");
  const email = page.getByRole("textbox", { name: /work email/i });
  await expect(email).toBeVisible({ timeout: 20_000 });
  await email.fill(DEMO_EMAIL);
  await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /access syncai/i }).click();
  await expect(
    page.getByRole("heading", { name: "Mission Control" }),
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("Golden path: the buyer-value loop", () => {
  test("1 — login lands on Mission Control with live seeded data", async ({
    page,
  }) => {
    await login(page);

    // Readiness hero + live stats render from Supabase
    await expect(page.getByText("MISSION READINESS", { exact: false })).toBeVisible();
    await expect(page.getByText("Top AI Recommendations")).toBeVisible();
    await expect(page.getByText(C22_REC_TITLE)).toBeVisible();
    await expect(page.getByText("Value Created")).toBeVisible();
  });

  test("2 — evidence and scenario comparison render live records", async ({
    page,
  }) => {
    await login(page);

    // Expand the C-22 recommendation card
    await page.getByText(C22_REC_TITLE).click();

    // Evidence drawer reads evidence_items
    await page.getByRole("button", { name: "Evidence" }).click();
    await expect(page.getByText("Vibration spectrum")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/BPFO/)).toBeVisible();
    await page.getByLabel("Close").click();

    // Scenario comparison reads scenarios (6 options, one recommended)
    await page.getByRole("button", { name: "Compare Scenarios" }).click();
    await expect(page.getByText("Scenario comparison")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Execute now")).toBeVisible();
    await expect(page.getByText("Run to failure")).toBeVisible();
    await expect(page.getByText("Recommended", { exact: true })).toBeVisible();
    await page.getByLabel("Close").click();
  });

  test("3 — approve drives work, governance, value, and learning", async ({
    page,
  }) => {
    await login(page);

    // Approve the critical C-22 recommendation
    await page.getByText(C22_REC_TITLE).click();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(
      page.getByText(/Approved Reschedule PM on Conveyor C-22/),
    ).toBeVisible({ timeout: 20_000 });

    // Work Action Board: safety-critical work lands approval-gated
    await page.goto("/work");
    await expect(page.getByText(C22_REC_ACTION).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByText("Awaiting Approval").first(),
    ).toBeVisible();

    // Decision Governance: the human decision is logged
    await page.goto("/governance");
    await expect(
      page.getByText(`Approved: ${C22_REC_ACTION}`).first(),
    ).toBeVisible({ timeout: 20_000 });

    // Value Realization: projected value awaits operator verification
    await page.goto("/value");
    await expect(page.getByText("Pending Verification")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(C22_VALUE_LABEL).first()).toBeVisible();

    // Operator verifies — value becomes real and feeds the Learning Loop
    await page.getByRole("button", { name: "Verify", exact: true }).first().click();
    await expect(page.getByText(/Verified \$2\.4M/)).toBeVisible({
      timeout: 20_000,
    });

    // Verified Savings Log now carries the entry
    await expect(
      page
        .locator("div")
        .filter({ hasText: "Verified Savings Log" })
        .getByText(C22_VALUE_LABEL)
        .first(),
    ).toBeVisible({ timeout: 20_000 });

    // Learning Loop shows the verified-value event
    await page.goto("/learning-loop");
    await expect(
      page.getByText(`Value verified — ${C22_VALUE_LABEL}`).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Wired controls: no dead buttons on the core loop", () => {
  test("4 — work order approve + assign + new WO all write to the database", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/work");

    // The WO created by test 3's approval is approval-gated — approve it here.
    await page.getByText(C22_REC_ACTION).first().click();
    await page.getByRole("button", { name: "Approve", exact: true }).first().click();
    await expect(page.getByText(/now scheduled/i)).toBeVisible({ timeout: 15_000 });

    // New Work Order modal creates a real row
    await page.getByRole("button", { name: /New Work Order/i }).click();
    await page.getByLabel("Title").fill("E2E inspection — HX-08 bypass valve");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText(/Work order created/i)).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("E2E inspection — HX-08 bypass valve").first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("5 — challenge AI writes real model feedback to the Learning Loop", async ({
    page,
  }) => {
    await login(page);
    // P-101 rec is still pending — challenge it
    await page.getByText("Order replacement seal kit for P-101").click();
    await page.getByRole("button", { name: "Challenge", exact: true }).click();
    await expect(page.getByText("Why are you challenging this?")).toBeVisible({
      timeout: 10_000,
    });
    await page
      .getByRole("button", { name: "Underlying data appears incorrect" })
      .click();
    const submit = page.getByRole("button", { name: /Submit Challenge/i });
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    // The modal sits in a continuously-animating framer-motion wrapper which
    // never passes Playwright's stability check — force skips only that.
    await submit.click({ force: true });
    await expect(page.getByText(/logged|Challenge Logged/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.goto("/learning-loop");
    await expect(
      page.getByText(/AI challenged — Order replacement seal kit/).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Autonomous asset onboarding: RAM checklist + HITL + go-live gate", () => {
  test("6 — assets self-onboard; humans close only the true gaps; SME gate works", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/onboarding");

    // Every seeded asset was backfilled by the migration's autonomous pass.
    const hub = page.getByTestId("onboarding-hub");
    await expect(hub).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Assets in onboarding")).toBeVisible();

    // P-101 has sensors + WO history → highest completion, listed first.
    const assetList = page.getByTestId("onboarding-asset-list");
    await expect(assetList.getByText("Pump P-101")).toBeVisible({
      timeout: 20_000,
    });
    await assetList.getByText("Pump P-101").click();

    // Go-live gate reports autonomous progress against Section-21 requirements
    const gate = page.getByTestId("golive-gate");
    await expect(gate).toBeVisible();
    await expect(gate.getByText(/of \d+ go-live requirements satisfied/)).toBeVisible({
      timeout: 20_000,
    });

    // Approve must be disabled while required items are outstanding.
    const approve = page.getByTestId("approve-golive");
    await expect(approve).toBeDisabled();

    // The HITL queue holds only what autonomy couldn't find or deduce.
    const queue = page.getByTestId("hitl-queue");
    await expect(queue).toBeVisible();

    // Human closes a real gap: asset ownership (a find-only fact).
    const ownerGap = page.getByTestId("gap-s19_asset_owner");
    await expect(ownerGap).toBeVisible({ timeout: 15_000 });
    await ownerGap
      .getByLabel("Answer for Asset owner assigned")
      .fill("Utilities Operations — J. Tremblay");
    await ownerGap.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText(/Asset owner assigned recorded/).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Checklist renders the RAM sections with autonomous fills.
    const checklistPanel = page.getByTestId("onboarding-checklist");
    await expect(
      checklistPanel.getByText("1. Asset Identification"),
    ).toBeVisible();
    await checklistPanel.getByText("1. Asset Identification").click();
    await expect(checklistPanel.getByText("Auto-filled").first()).toBeVisible();
  });
});
