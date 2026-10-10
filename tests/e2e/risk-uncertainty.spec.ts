import { test, expect, type Page, type Response } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.beforeAll(async ({ browserName }, testInfo) => {
  // An accidental default-config invocation must not provision fixtures, log
  // in, or persist authentication diagnostics into the ordinary upload tree.
  expect(testInfo.project.name).toBe("u18-chromium");
  expect(browserName).toBe("chromium");
  expect(resolve(testInfo.project.outputDir)).toBe(
    resolve("test-results-private/u18"),
  );
  expect(testInfo.project.use.trace).toBe("off");
  expect(testInfo.project.use.video).toBe("off");
  expect(testInfo.project.use.screenshot).toBe("off");
});

// Actual disposable-browser witness. This test cannot operate on customer URLs.
// The owner connection only provisions/read-witnesses synthetic CI fixtures and
// changes one synthetic evidence revision; all product writes use human UI/RPC.
function sql(statement: string): unknown {
  expect(process.env.GITHUB_ACTIONS).toBe("true");
  expect(process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321").toBe(
    "http://127.0.0.1:54321",
  );
  expect(Object.keys(process.env).some((key) => key.startsWith("PG"))).toBe(
    false,
  );
  const result = spawnSync(
    "psql",
    [
      "-h",
      "127.0.0.1",
      "-p",
      "54322",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `do $guard$ begin
        if session_user<>'postgres' or current_user<>'postgres'
          or current_setting('app.ci_u18_browser_fixture',true) is distinct from 'github_actions_only'
          or current_database()<>'postgres' then raise exception 'isolated browser owner required'; end if;
        if not exists(select 1 from organizations where id='11111111-1111-1111-1111-111111111111'
          and name='Fort McMurray Oil Sands Demo') then raise exception 'disposable seed required'; end if;
      end $guard$; ${statement}`,
    ],
    {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        LC_ALL: "C",
        LANG: "C",
        PGPASSWORD: "postgres",
        PGHOSTADDR: "127.0.0.1",
        PGSSLMODE: "disable",
        PGOPTIONS:
          "-c app.ci_u18_browser_fixture=github_actions_only -c search_path=public",
      },
    },
  );
  expect(result.status, "isolated synthetic SQL witness must succeed").toBe(0);
  return JSON.parse(result.stdout.trim());
}
function uuid(value: unknown): asserts value is string {
  expect(value).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
}
async function receipt(response: Response) {
  expect(response.url()).toMatch(
    /^http:\/\/127\.0\.0\.1:54321\/rest\/v1\/rpc\//,
  );
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.error).toBeUndefined();
  return result;
}
const rpcResponse = (page: Page, name: string) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith(`/rpc/${name}`) &&
      response.request().method() === "POST",
  );
async function login(
  page: Page,
  actor: "author" | "reviewer",
  attempt: number,
) {
  await page.goto("/signin");
  const token = page.waitForResponse((response) =>
    response.url().includes("/auth/v1/token?grant_type=password"),
  );
  await page
    .getByRole("textbox", { name: /work email/i })
    .fill(`u18-browser-${actor}-${attempt}@syncai-ci.invalid`);
  await page
    .locator('input[type="password"]')
    .fill("U18BrowserSynthetic123!@#");
  await page.getByRole("button", { name: /access syncai/i }).click();
  expect((await token).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Mission Control" }),
  ).toBeVisible({ timeout: 30_000 });
}
async function openRisk(page: Page, attempt: number) {
  await page.goto("/risk");
  const read = rpcResponse(page, "get_risk_uncertainty_workspace");
  await page
    .getByRole("button", { name: "Risk portfolio", exact: true })
    .click();
  const response = await read;
  const data = await receipt(response);
  const detailHeading = page.getByRole("heading", {
    name: `U18 browser synthetic cooling risk ${attempt}`,
    exact: true,
    level: 2,
  });
  await expect(detailHeading).toHaveCount(1);
  await expect(detailHeading).toBeVisible();
  const panel = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Governed uncertainty analysis",
      exact: true,
    }),
  });
  await expect(panel).toHaveCount(1);
  return { data, panel, response };
}
async function fillAnalysis(panel: ReturnType<Page["locator"]>) {
  await panel
    .getByPlaceholder("Method", { exact: true })
    .fill("Synthetic three-point bounded estimate");
  await panel.getByPlaceholder("Currency (CAD)", { exact: true }).fill("CAD");
  await panel
    .getByPlaceholder("Source, assumption and method basis")
    .fill(
      "Explicit synthetic browser inspection and assumptions; no customer engineering calibration.",
    );
  for (const [group, labels, values] of [
    ["Probability", ["Lower", "Central", "Upper"], ["0.15", "0.30", "0.55"]],
    [
      "Confidence",
      ["Level", "Interval lower", "Interval upper"],
      ["0.90", "0.10", "0.60"],
    ],
    ["Loss cases", ["Best", "Expected", "Worst"], ["10000", "60000", "250000"]],
  ] as const) {
    const fieldset = panel.getByRole("group", { name: group, exact: true });
    for (let index = 0; index < labels.length; index++)
      await fieldset
        .getByPlaceholder(labels[index], { exact: true })
        .fill(values[index]);
  }
  await panel
    .getByPlaceholder("Factor name")
    .fill("Synthetic startup exposure");
  await panel
    .getByPlaceholder("Evidence or assumption basis")
    .fill("Synthetic exact-risk startup and inspection assumptions.");
  for (const [name, value] of [
    ["low Input", "2"],
    ["base Input", "5"],
    ["high Input", "8"],
    ["low Output", "10000"],
    ["base Output", "60000"],
    ["high Output", "180000"],
  ])
    await panel.getByPlaceholder(name, { exact: true }).fill(value);
  await panel
    .getByPlaceholder("One measurable reassessment trigger per line")
    .fill("Two synthetic startups occur in one operating shift");
  await panel
    .getByLabel("Review due", { exact: true })
    .fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 16));
  await panel
    .getByPlaceholder("Information-gathering action")
    .fill("Synthetic seal inspection during a planned outage");
  for (const [name, value] of [
    ["Information cost", "10000"],
    ["Decision cost if wrong", "250000"],
    ["Uncertainty reduction (0–1)", "0.5"],
    ["Probability the decision changes (0–1)", "0.3"],
  ])
    await panel.getByPlaceholder(name, { exact: true }).fill(value);
  await panel
    .getByRole("checkbox", {
      name: /U18 browser synthetic exact-risk inspection/,
    })
    .check();
}

test("U18 human browser loop retains stale history, reconciles a committed lost response, and independently reviews without operating authority", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const attempt = testInfo.retry;
  expect([0, 1]).toContain(attempt);
  const f =
    sql(`select jsonb_build_object('org',a.organization_id,'author',a.id,'reviewer',p.id,'risk',r.id,'evidence',e.id)
    from user_profiles a join user_profiles p on p.organization_id=a.organization_id
    join risks r on r.organization_id=a.organization_id join evidence_items e on e.risk_id=r.id
    where a.email='u18-browser-author-${attempt}@syncai-ci.invalid'
      and p.email='u18-browser-reviewer-${attempt}@syncai-ci.invalid'
      and r.title='U18 browser synthetic cooling risk ${attempt}'
      and e.description='U18 browser synthetic exact-risk inspection';`) as Record<
      string,
      string
    >;
  for (const value of Object.values(f)) uuid(value);
  expect(new Set(Object.values(f)).size).toBe(5);
  const operations = () =>
    sql(`select jsonb_build_object(
    -- Only the existing canonical VOI projection/timestamp may change.
    -- Every other risk field (including acceptance/operating status) is frozen.
    'risks',(select jsonb_agg(to_jsonb(r)-'value_of_information'-'updated_at' order by id) from risks r where organization_id='${f.org}'),
    'decisions',(select jsonb_agg(to_jsonb(d) order by id) from decisions d where organization_id='${f.org}'),
    'work_orders',(select jsonb_agg(to_jsonb(w) order by id) from work_orders w where organization_id='${f.org}'),
    'risk_stakeholder_views',(select jsonb_agg(to_jsonb(s) order by id) from risk_stakeholder_views s where organization_id='${f.org}'),
    'scenarios',(select jsonb_agg(to_jsonb(s) order by id) from scenarios s where organization_id='${f.org}'));`);
  const beforeOperations = operations();
  await login(page, "author", attempt);
  let author = await openRisk(page, attempt);
  expect(author.data).toMatchObject({
    organizationId: f.org,
    actorId: f.author,
    operationalAuthorization: false,
    risk: { id: f.risk, status: "draft" },
    analyses: [],
  });
  const foreignRisk = sql(
    `select to_jsonb(id) from risks where title='U18 browser synthetic cooling risk ${1 - attempt}';`,
  );
  uuid(foreignRisk);
  const observedHeaders = await author.response.request().allHeaders();
  const foreignRead = await page.request.post(
    "http://127.0.0.1:54321/rest/v1/rpc/get_risk_uncertainty_workspace",
    {
      headers: {
        apikey: observedHeaders.apikey,
        authorization: observedHeaders.authorization,
      },
      data: { p_risk_id: foreignRisk },
    },
  );
  expect(foreignRead.status()).toBe(200);
  expect(await foreignRead.json()).toEqual({
    error: "risk not found in this organization",
  });
  await fillAnalysis(author.panel);
  const submittedResponse = rpcResponse(
    page,
    "submit_risk_uncertainty_analysis",
  );
  await author.panel
    .getByRole("button", { name: "Submit for independent review", exact: true })
    .click();
  const submitted = await receipt(await submittedResponse);
  expect(submitted).toMatchObject({
    riskId: f.risk,
    version: 1,
    validationStatus: "pending_review",
    operationalAuthorization: false,
  });
  uuid(submitted.analysisId);
  await expect(
    author.panel.getByText("Author cannot review this packet.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    author.panel.getByRole("button", { name: "Review packet", exact: true }),
  ).toHaveCount(0);
  const frozen = sql(
    `select to_jsonb(a) from risk_uncertainty_analyses a where id='${submitted.analysisId}' and organization_id='${f.org}' and author_id='${f.author}';`,
  ) as Record<string, unknown>;
  expect(frozen).toMatchObject({
    status: "pending_review",
    version: 1,
    digest_version: 2,
    reviewer_id: null,
    approval_id: null,
  });

  // Separate genuine GoTrue human session, not token swapping or UI role mocking.
  const reviewerContext = await browser.newContext({
    baseURL: "http://localhost:5173",
  });
  const reviewerPage = await reviewerContext.newPage();
  try {
    await login(reviewerPage, "reviewer", attempt);
    let reviewer = await openRisk(reviewerPage, attempt);
    expect(reviewer.data).toMatchObject({
      organizationId: f.org,
      actorId: f.reviewer,
      operationalAuthorization: false,
    });
    expect(reviewer.data.analyses[0]).toMatchObject({
      id: submitted.analysisId,
      authorId: f.author,
      reviewStanding: "reviewable",
      storedStatus: "pending_review",
    });
    await expect(
      reviewer.panel.getByRole("button", {
        name: "Review packet",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      sql(`with changed as (update evidence_items set revision='BROWSER-R2'
      where id='${f.evidence}' and organization_id='${f.org}' and risk_id='${f.risk}'
        and revision='BROWSER-R1' returning id) select jsonb_build_object('changed',count(*)) from changed;`),
    ).toEqual({ changed: 1 });
    author = await openRisk(page, attempt);
    const stale = author.data.analyses[0];
    const storedAnalysisDigest = stale.analysisDigest;
    const currentAnalysisDigest = stale.currentDigest;
    expect(storedAnalysisDigest).toBe(submitted.analysisDigest);
    expect(currentAnalysisDigest).not.toBe(storedAnalysisDigest);
    expect(stale).toMatchObject({
      id: submitted.analysisId,
      storedStatus: "pending_review",
      validationStatus: "stale",
      reviewStanding: "replacement_required",
      operationalAuthorization: false,
    });
    reviewer = await openRisk(reviewerPage, attempt);
    await expect(
      reviewer.panel.getByRole("button", {
        name: "Review packet",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      reviewer.panel.getByRole("button", {
        name: "Replace stale analysis",
        exact: true,
      }),
    ).toHaveCount(0);
    await author.panel
      .getByRole("button", { name: "Replace stale analysis", exact: true })
      .click();
    const reason =
      "Synthetic evidence revision changed; explicit original-author replacement for independent review.";
    await author.panel
      .getByPlaceholder("Replacement reason (minimum 20 characters)")
      .fill(reason);
    // beginReplacement prefills the frozen analysis; the author explicitly replaces it.
    let replacementWrites = 0;
    let committed: Record<string, unknown> | undefined;
    let requestText = "";
    await page.route(
      "**/rest/v1/rpc/replace_risk_uncertainty_analysis",
      async (route) => {
        replacementWrites++;
        requestText = route.request().postDataJSON().p_request_text;
        const actual = await route.fetch();
        expect(actual.status()).toBe(200);
        committed = await actual.json();
        expect(committed).toMatchObject({
          commitStatus: "committed",
          organizationId: f.org,
          actorId: f.author,
          riskId: f.risk,
          predecessorAnalysisId: submitted.analysisId,
          version: 2,
          operationalAuthorization: false,
        });
        uuid(committed!.analysisId);
        // Verify actual database commit before deliberately dropping its delivery.
        expect(
          sql(`select jsonb_build_object('count',count(*)) from risk_uncertainty_analyses
        where id='${committed!.analysisId}' and organization_id='${f.org}' and replaces_analysis_id='${submitted.analysisId}';`),
        ).toEqual({ count: 1 });
        await route.abort("failed");
      },
    );
    const replacementForm = author.panel.locator("form").filter({
      has: page.getByPlaceholder("Replacement reason (minimum 20 characters)", {
        exact: true,
      }),
    });
    await expect(replacementForm).toHaveCount(1);
    const replacementSubmit = replacementForm.getByRole("button", {
      name: "Replace stale analysis",
      exact: true,
    });
    await expect(replacementSubmit).toHaveCount(1);
    await replacementSubmit.click();
    await expect(author.panel.getByRole("alert")).toContainText(
      "Do not resend it.",
    );
    expect(replacementWrites).toBe(1);
    expect(committed).toBeDefined();
    expect(committed!.requestFingerprint).toBe(
      createHash("sha256").update(requestText, "utf8").digest("hex"),
    );
    const request = JSON.parse(requestText);
    expect(request).toMatchObject({
      organizationId: f.org,
      actorId: f.author,
      riskId: f.risk,
      reason,
      evidenceItemIds: [f.evidence],
    });
    const reconciliation = rpcResponse(
      page,
      "get_risk_uncertainty_replacement_receipt",
    );
    await author.panel
      .getByRole("button", { name: "Reconcile replacement", exact: true })
      .click();
    expect(await receipt(await reconciliation)).toEqual(committed);
    await expect(
      author.panel.getByText("Retained replacement history", { exact: true }),
    ).toBeVisible();
    expect(
      replacementWrites,
      "read-only reconciliation must not resend a product write",
    ).toBe(1);
    author = await openRisk(page, attempt);
    const predecessor = author.data.analyses.find(
      (a: { id: string }) => a.id === submitted.analysisId,
    );
    const successor = author.data.analyses.find(
      (a: { id: string }) => a.id === committed!.analysisId,
    );
    expect(predecessor).toMatchObject({
      storedStatus: "superseded",
      validationStatus: "stale",
      reviewerId: null,
      approvalId: null,
      supersession: {
        successorAnalysisId: committed!.analysisId,
        byUserId: f.author,
      },
    });
    expect(successor).toMatchObject({
      version: 2,
      authorId: f.author,
      reviewStanding: "reviewable",
      storedStatus: "pending_review",
      operationalAuthorization: false,
      replacement: {
        predecessorAnalysisId: submitted.analysisId,
        requestFingerprint: committed!.requestFingerprint,
        compareAndSwap: committed!.compareAndSwap,
        reason,
      },
    });
    const retained = sql(
      `select to_jsonb(a) from risk_uncertainty_analyses a where id='${submitted.analysisId}' and organization_id='${f.org}';`,
    ) as Record<string, unknown>;
    const immutablePacket = (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).filter(
          ([key]) =>
            ![
              "status",
              "superseded_by_analysis_id",
              "superseded_at",
              "superseded_by_user_id",
            ].includes(key),
        ),
      );
    expect(immutablePacket(retained)).toEqual(immutablePacket(frozen));
    expect(retained.superseded_by_analysis_id).toBe(committed!.analysisId);
    expect(retained.superseded_by_user_id).toBe(f.author);
    expect(retained.superseded_at).toBeTruthy();
    await expect(
      author.panel.getByText("Author cannot review this packet.", {
        exact: true,
      }),
    ).toBeVisible();

    reviewer = await openRisk(reviewerPage, attempt);
    await reviewer.panel
      .getByRole("button", { name: "Review packet", exact: true })
      .click();
    const note =
      "Independent synthetic browser human reviewed the frozen replacement packet; no operating approval.";
    await reviewer.panel
      .getByPlaceholder("Independent review basis (minimum 20 characters)")
      .fill(note);
    const reviewedResponse = rpcResponse(
      reviewerPage,
      "review_risk_uncertainty_analysis",
    );
    await reviewer.panel
      .getByRole("button", { name: "Record review", exact: true })
      .click();
    const reviewed = await receipt(await reviewedResponse);
    expect(reviewed).toMatchObject({
      analysisId: committed!.analysisId,
      riskId: f.risk,
      decision: "validated",
      analysisDigest: committed!.analysisDigest,
      operationalAuthorization: false,
    });
    uuid(reviewed.approvalId);
    uuid(reviewed.derivedEvidenceItemId);
    reviewer = await openRisk(reviewerPage, attempt);
    const validated = reviewer.data.analyses.find(
      (a: { id: string }) => a.id === committed!.analysisId,
    );
    expect(validated).toMatchObject({
      storedStatus: "validated",
      validationStatus: "validated",
      reviewerId: f.reviewer,
      authorId: f.author,
      approvalId: reviewed.approvalId,
      reviewNote: note,
      operationalAuthorization: false,
    });
    const reviewedBy =
      sql(`select jsonb_build_object('reviewerId',a.reviewer_id,'organizationId',a.organization_id,
      'role',p.role,'approvalId',a.approval_id,'derivedEvidenceItemId',a.derived_evidence_item_id)
      from risk_uncertainty_analyses a join user_profiles p on p.id=a.reviewer_id and p.organization_id=a.organization_id
      where a.id='${committed!.analysisId}' and a.organization_id='${f.org}';`);
    expect(reviewedBy).toEqual({
      reviewerId: f.reviewer,
      organizationId: f.org,
      role: "reliability_engineer",
      approvalId: reviewed.approvalId,
      derivedEvidenceItemId: reviewed.derivedEvidenceItemId,
    });
    const afterOperations = operations();
    expect(afterOperations).toEqual(beforeOperations);
    const projection = sql(
      `select value_of_information from risks where id='${f.risk}' and organization_id='${f.org}';`,
    );
    expect(projection).toMatchObject({
      analysis_id: committed!.analysisId,
      validation_status: "validated",
      reviewed_by: f.reviewer,
      human_decision_required: true,
      operational_authorization: false,
    });
    const screenshot = testInfo.outputPath("u18-retained-reviewed-history.png");
    await reviewer.panel.screenshot({ path: screenshot });
    await testInfo.attach("u18-retained-reviewed-history", {
      path: screenshot,
      contentType: "image/png",
    });
  } finally {
    await reviewerContext.close();
  }
});
