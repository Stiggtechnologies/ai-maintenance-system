import { test, expect, type Page } from "@playwright/test";
import {
  actualRpc,
  createSurvivalBrowserFixture,
  installLocalBrowserSession,
} from "./fixtures/covariate-survival";

// Fixture JWTs are LOCAL synthetic assurance, never real MFA enrollment.
// Retain screenshots, not traces that could capture auth headers or sessions.
test.use({ trace: "off" });

async function openWorkbench(page: Page, component: string) {
  await page.goto("/reliability");
  await expect(
    page.getByRole("heading", {
      name: "Governed component life-data workbench",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByLabel("Component population", { exact: true })
    .fill(component);
  await page
    .getByRole("button", {
      name: "Open covariate survival workbench",
      exact: true,
    })
    .click();
  const panel = page.getByTestId("covariate-survival-workbench");
  await expect(
    panel.getByLabel("Predictor 1 name", { exact: true }),
  ).toBeEnabled();
  await panel
    .getByLabel("Predictor 1 name", { exact: true })
    .fill("synthetic_load");
  await panel.getByLabel("Predictor 1 unit", { exact: true }).fill("ratio");
  return panel;
}

test("actual installed-life browser capture, independent review, complete census and stale-meter refusal", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(180_000);
  const fixture = await createSurvivalBrowserFixture(baseURL!);
  const { author, reviewer, instanceId, meterId, component } = fixture;
  await installLocalBrowserSession(
    page.context(),
    fixture.apiUrl,
    author.session,
  );
  let panel = await openWorkbench(page, component);
  await panel
    .getByRole("button", {
      name: "Run retained survival analysis",
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Retained advisory refused",
      exact: true,
    }),
  ).toBeVisible();
  await expect(panel.getByText(/13 physical lives/)).toHaveCount(0);
  // A genuine password session remains AAL1; possession of a seeded factor
  // alone must not bypass the existing capture assurance guard.
  const aal1 = await author.aal1.rpc("record_survival_installed_overlay", {
    p_instance_id: instanceId,
    p_expected_version: 0,
    p_overlay: {},
  });
  expect(aal1.error).toBeNull();
  expect(aal1.data.error).toMatch(/verified MFA and AAL2/);
  await panel
    // Wrapped select labels include option text for getByLabel; the browser's
    // accessible combobox name excludes it and remains exact as options change.
    .getByRole("combobox", { name: "Evidence source kind", exact: true })
    .selectOption("installation");
  await panel
    .getByRole("combobox", {
      name: "Canonical component installation",
      exact: true,
    })
    .selectOption(instanceId);
  await expect(
    panel.getByLabel("Physical component life reference", { exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByText(/Canonical installation:/)).toContainText(
    meterId,
  );
  const fields: Record<string, string> = {
    "Approved design / operating stratum": "synthetic-design",
    "Observed entry operating hours": "0",
    "Evidence-backed profile valid until (ISO with timezone)":
      fixture.validUntil,
    "Interval 1 start hours": "0",
    "Interval 1 stop hours": "8",
    "Interval 1 actual start (ISO)": fixture.startedAt,
    "Interval 1 actual end (ISO)": fixture.meterTime,
    "Interval 1 predictor 1 value": "0.4",
    "Interval 1 predictor 1 observed hours": "0",
    "Interval 1 predictor 1 available hours": "0",
    "Interval 1 predictor 1 valid through hours": "15",
    "Interval 1 predictor 1 available at (ISO)": fixture.startedAt,
    "Capture evidence basis":
      "Actual browser synthetic installation, meter and condition source witness; not qualified customer data.",
  };
  await panel
    .getByRole("combobox", { name: "Installation evidence", exact: true })
    .selectOption(fixture.evidenceId);
  await panel
    .getByRole("combobox", { name: "Latest meter evidence", exact: true })
    .selectOption(fixture.meterEvidenceId);
  await panel
    .getByRole("combobox", {
      name: "Interval 1 predictor 1 evidence",
      exact: true,
    })
    .selectOption(fixture.evidenceId);
  for (const [label, value] of Object.entries(fields))
    await panel.getByLabel(label, { exact: true }).fill(value);
  await panel
    .getByRole("button", {
      name: "Submit exact overlay for review",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "Exact overlay captured for independent review.",
  );
  await panel
    .getByLabel("Independent review basis", { exact: true })
    .fill("Author attempted review; the server must refuse self-approval.");
  await panel
    .getByRole("button", { name: "Validate exact overlay", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "reviewer other than its author",
  );
  const pending = await author.client
    .from("component_instances")
    .select("survival_status,survival_approval_id,survival_overlay")
    .eq("id", instanceId)
    .single();
  expect(pending.error).toBeNull();
  expect(pending.data).toMatchObject({
    survival_status: "pending_review",
    survival_approval_id: null,
    survival_overlay: {
      meterReadingId: meterId,
      entryHours: 0,
      stratum: "synthetic-design",
    },
  });
  expect(pending.data!.survival_overlay).not.toHaveProperty("originHours");
  expect(pending.data!.survival_overlay).not.toHaveProperty("lifeRef");

  const reviewerContext = await browser.newContext({ baseURL });
  try {
    await installLocalBrowserSession(
      reviewerContext,
      fixture.apiUrl,
      reviewer.session,
    );
    const reviewerPage = await reviewerContext.newPage();
    const reviewPanel = await openWorkbench(reviewerPage, component);
    await reviewPanel
      .getByRole("combobox", { name: "Evidence source kind", exact: true })
      .selectOption("installation");
    await reviewPanel
      .getByRole("combobox", {
        name: "Canonical component installation",
        exact: true,
      })
      .selectOption(instanceId);
    await reviewPanel
      .getByText("Inspect exact recorded overlay and current source", {
        exact: true,
      })
      .click();
    const recordedSnapshot = reviewPanel
      .getByText("Inspect exact recorded overlay and current source", {
        exact: true,
      })
      .locator("..")
      .locator("pre");
    await expect(recordedSnapshot).toContainText(meterId);
    await expect(recordedSnapshot).toContainText(fixture.meterEvidenceId);
    await reviewPanel
      .getByLabel("Independent review basis", { exact: true })
      .fill(
        "Second synthetic human reviewed the exact persisted installation, current meter and measured condition.",
      );
    await reviewPanel
      .getByRole("button", { name: "Validate exact overlay", exact: true })
      .click();
    await expect(reviewPanel.getByRole("status")).toContainText(
      "Exact overlay review recorded: validated.",
    );
    await reviewerPage.screenshot({
      path: testInfo.outputPath("installed-independent-review.png"),
      fullPage: false,
    });
  } finally {
    await reviewerContext.close();
  }
  const validated = await author.client
    .from("component_instances")
    .select(
      "survival_status,survival_recorded_by,survival_reviewed_by,survival_approval_id",
    )
    .eq("id", instanceId)
    .single();
  expect(validated.error).toBeNull();
  expect(validated.data).toMatchObject({
    survival_status: "validated",
    survival_recorded_by: fixture.authorId,
    survival_reviewed_by: fixture.reviewerId,
  });
  const approval = await author.client
    .from("approvals")
    .select("approver_user_id,approval_scope")
    .eq("id", validated.data!.survival_approval_id)
    .single();
  expect(approval.error).toBeNull();
  expect(approval.data).toMatchObject({
    approver_user_id: fixture.reviewerId,
    approval_scope: {
      kind: "survival_installed_overlay",
      componentInstanceId: instanceId,
      version: 1,
      operationalAuthorization: false,
    },
  });

  await page.reload();
  panel = await openWorkbench(page, component);
  await panel
    .getByLabel("Include evidence-backed conditional scenario", { exact: true })
    .check();
  await panel
    .getByRole("combobox", { name: "Scenario profile kind", exact: true })
    .selectOption("installation");
  await panel
    .getByRole("combobox", {
      name: "Scenario installed component",
      exact: true,
    })
    .selectOption(instanceId);
  await panel
    .getByLabel("Scenario horizon operating hours", { exact: true })
    .fill("10");
  await expect(
    panel.getByLabel("Scenario survival origin operating hours", {
      exact: true,
    }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", {
      name: "Run retained survival analysis",
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Retained advisory fitted",
      exact: true,
    }),
  ).toBeVisible();
  await expect(panel.getByText(/13 physical lives · 8 failures/)).toBeVisible();
  await expect(
    panel.getByText(/Given survival to 8 operating hours/),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", {
      name: "Numerical conditional scenario · not a live asset forecast",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByText(
      /Unqualified calibration; no predictive confidence interval/,
    ),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", {
      name: "Joint conditional hazard sampling uncertainty · 3 assets",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByText(/Cumulative hazard standard error/),
  ).toBeVisible();
  const retained = await author.client
    .from("calculation_runs")
    .select("id,input_refs,inputs,outputs")
    .eq("calculation_key", "component_covariate_survival")
    .eq("inputs->source->>component", component)
    .order("computed_at", { ascending: false })
    .limit(1)
    .single();
  expect(retained.error).toBeNull();
  expect(retained.data!.input_refs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ table: "component_instances", id: instanceId }),
      expect.objectContaining({ table: "asset_meter_readings", id: meterId }),
      expect.objectContaining({
        table: "evidence_items",
        id: fixture.meterEvidenceId,
      }),
    ]),
  );
  expect(retained.data!.inputs.source).toMatchObject({
    sourceVersion: "survival-census/2/draft",
    events: expect.arrayContaining([
      expect.objectContaining({ eventKind: "scheduled" }),
    ]),
    activeInstances: [expect.objectContaining({ id: instanceId })],
    removedInstances: [],
    populationGaps: [],
  });
  expect(retained.data!.outputs).toMatchObject({
    status: "fitted",
    subjects: 13,
    failures: 8,
    conditionalScenario: {
      status: "estimated",
      calibration: "unqualified",
      confidenceInterval: null,
      predictionUncertainty: {
        status: "computed",
        uncertaintyVersion: "cox-joint-asset/1/draft",
        method: "efron_full_asset_case_weight_influence",
        authority: "advisory_only",
        clusterCount: 3,
      },
      liveAssetForecast: false,
      profile: {
        originHours: 8,
        path: [expect.objectContaining({ covariates: [0.4] })],
        source: { componentInstanceId: instanceId, meterReadingId: meterId },
      },
    },
  });
  await panel
    .getByRole("heading", {
      name: "Numerical conditional scenario · not a live asset forecast",
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("installed-derived-scenario.png"),
    fullPage: false,
  });

  await panel
    .getByLabel("Scenario horizon operating hours", { exact: true })
    .fill("16");
  await panel
    .getByRole("button", {
      name: "Run retained survival analysis",
      exact: true,
    })
    .click();
  await expect(panel.getByText(/^Conditional scenario refused:/)).toBeVisible();
  // A genuine newer meter, even with the same observed value, must invalidate
  // the previous exact approval. No UI fallback to completed lives is allowed.
  await actualRpc(author.client, "record_asset_meter_reading", {
    p_asset_id: fixture.assetId,
    p_value: fixture.installMeter + 8,
    p_recorded_at: new Date(Date.now() - 1_000).toISOString(),
    p_source_system: "Browser synthetic newer meter",
    p_basis:
      "New actual meter must invalidate the earlier approved source snapshot.",
  });
  await page.reload();
  panel = await openWorkbench(page, component);
  const instanceRow = panel
    .getByRole("row")
    .filter({ hasText: `Installation ${instanceId}` });
  await expect(instanceRow).toContainText("Source gap");
  await panel
    .getByRole("button", {
      name: "Run retained survival analysis",
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Retained advisory refused",
      exact: true,
    }),
  ).toBeVisible();
  await expect(panel.getByText(/13 physical lives · 8 failures/)).toHaveCount(
    0,
  );
  await page.screenshot({
    path: testInfo.outputPath("installed-stale-meter-refusal.png"),
    fullPage: false,
  });
});
