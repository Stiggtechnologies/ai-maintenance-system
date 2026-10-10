import {
  test,
  expect,
  request,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

// Real GoTrue/PostgREST + actual AppShell/browser, using disposable synthetic
// fixtures. No intercepted responses, injected sessions or production claim.
const ORG = "11111111-1111-1111-1111-111111111111";
const SITE_A = "ee020000-0000-4000-8000-000000000201";
const SITE_B = "ee020000-0000-4000-8000-000000000202";
const ASSET_A = "ee020000-0000-4000-8000-000000000211";
const ASSET_B = "ee020000-0000-4000-8000-000000000212";
const EVIDENCE = "98100000-0000-0000-0000-000000000021";
const FOREIGN_ORG = "99999999-9999-4999-8999-999999999931";
const API_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
// Public, standard Supabase CLI local anon key, not a customer credential.
const ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const operatingResponse = (response: {
  url(): string;
  request(): { method(): string };
}) =>
  response.url().endsWith("/rpc/get_sync_context_operating_picture") &&
  response.request().method() === "POST";

async function authenticatedApi(email: string, password: string) {
  const url = new URL(API_URL);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== "54321"
  )
    throw new Error("Context browser qualification refuses non-local Supabase");
  const loginApi = await request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { apikey: ANON_KEY },
  });
  try {
    const response = await loginApi.post("/auth/v1/token?grant_type=password", {
      data: { email, password },
    });
    expect(response.status()).toBe(200);
    const session = await response.json();
    expect(typeof session.access_token).toBe("string");
    expect(session.access_token.length).toBeGreaterThan(20);
    return {
      id: session.user.id as string,
      api: await request.newContext({
        baseURL: API_URL,
        extraHTTPHeaders: {
          apikey: ANON_KEY,
          authorization: `Bearer ${session.access_token}`,
        },
      }),
    };
  } finally {
    await loginApi.dispose();
  }
}
async function rpc(
  api: APIRequestContext,
  name: string,
  data: Record<string, unknown>,
) {
  const response = await api.post(`/rest/v1/rpc/${name}`, { data });
  expect(response.status(), `actual ${name} HTTP status`).toBe(200);
  const result = await response.json();
  expect(result.error, `actual ${name} governance refusal`).toBeUndefined();
  return result;
}
async function login(
  page: Page,
  email: string,
  password: string,
  home = "Mission Control",
) {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: /work email/i }).fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /access syncai/i }).click();
  await expect(
    page.getByRole("heading", { name: home, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}
async function chooseSite(page: Page, site: "A" | "B", mobile: boolean) {
  if (mobile)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  // Use the one real AppShell selector; no Context-only selector or URL scope.
  const picker = page.locator("aside button:has(svg.lucide-map-pin)");
  await expect(picker).toBeVisible({ timeout: 15_000 });
  await picker.click();
  await page
    .getByRole("button", {
      name: new RegExp(`^SC-02 Browser Site ${site} \\(`),
    })
    .click();
}

for (const surface of [
  { name: "desktop", viewport: { width: 1440, height: 900 }, mobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true },
]) {
  test(`Context ${surface.name}: native scope, independently reviewed geometry, inspector and rights revocation`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(surface.viewport);
    const author = await authenticatedApi("demo@syncai.ca", "Demo123!@#");
    const reviewer = await authenticatedApi("admin@syncai.ca", "Admin123!@#");
    expect(author.id).not.toBe(reviewer.id);
    try {
      const key = `sc02-browser-${surface.name}-${testInfo.retry}`;
      const found = await reviewer.api.get(
        `/rest/v1/connectors?select=id,context_source_class&connector_key=eq.${key}`,
      );
      expect(found.status()).toBe(200);
      const rows = await found.json();
      expect(rows).toHaveLength(1);
      expect(rows[0].context_source_class).toBeNull();
      const sourceId = rows[0].id as string;
      await rpc(reviewer.api, "register_context_source", {
        p_connector_id: sourceId,
        p_source_class: "customer_operational",
        p_authority: "tenant_authorized",
        p_purpose:
          "Synthetic isolated browser qualification of customer-class canonical geometry; no customer deployment or field feed is asserted.",
        p_rights_state: "customer_authorized",
        p_rights_reference: `SC02-BROWSER-${surface.name}-${testInfo.retry}`,
        p_basis:
          "Named CI administrator declares disposable synthetic fixture ownership for browser tests only, not survey certification or production rights.",
      });
      const registeredHttp = await reviewer.api.get(
        `/rest/v1/connectors?select=context_checked_at&id=eq.${sourceId}`,
      );
      expect(registeredHttp.status()).toBe(200);
      const registeredRows = await registeredHttp.json();
      expect(registeredRows).toHaveLength(1);
      // Derive from the actual registration's server time, not the browser
      // clock. The intervening HTTP read and health write advance server time.
      const registrationTime = Date.parse(registeredRows[0].context_checked_at);
      expect(Number.isFinite(registrationTime)).toBe(true);
      const checkedAt = new Date(registrationTime + 1).toISOString();
      const observedAt = new Date(registrationTime - 1_000).toISOString();
      await rpc(reviewer.api, "record_context_source_health", {
        p_connector_id: sourceId,
        p_state: "connected",
        p_checked_at: checkedAt,
        p_observed_at: observedAt,
        p_detail:
          "Synthetic browser fixture; connected does not mean a live field feed.",
      });
      const names = {
        A: `${key} reviewed A`,
        B: `${key} reviewed B`,
        draft: `${key} unreviewed A`,
      };
      for (const target of [
        { suffix: "a", name: names.A, asset: ASSET_A, reviewed: true },
        { suffix: "b", name: names.B, asset: ASSET_B, reviewed: true },
        { suffix: "draft", name: names.draft, asset: ASSET_A, reviewed: false },
      ]) {
        const created = await rpc(author.api, "record_geospatial_feature", {
          p_feature: {
            coordinate: {
              referenceSystem: "EPSG:4326",
              axisOrder: "longitude_latitude",
              basis:
                "Synthetic browser source explicitly declares WGS84 longitude/latitude encoding; no real survey claim.",
              horizontalAccuracyM: null,
            },
            feature_type: "asset",
            feature_key: `${key}-${target.suffix}`,
            name: target.name,
            geometry_type: "Point",
            geometry: { type: "Point", coordinates: [-111.38, 56.73] },
            source_connector_id: sourceId,
            source_reference: `SC02-BROWSER-${target.suffix}`,
            observed_at: observedAt,
            validity_kind: "permanent",
            data_quality: "good",
            evidence_item_ids: [EVIDENCE],
          },
        });
        if (target.reviewed)
          await rpc(reviewer.api, "verify_geospatial_feature", {
            p_feature_id: created.feature_id,
            p_note:
              "Independent synthetic browser fixture review; no real survey suitability or operational authority is asserted.",
          });
        await rpc(author.api, "link_geospatial_subject", {
          p_link: {
            feature_id: created.feature_id,
            relationship_type: "located_at",
            asset_id: target.asset,
            basis:
              "Canonical asset-to-site membership determines browser scope; identical coordinates never establish site membership.",
          },
        });
      }
      await login(page, "demo@syncai.ca", "Demo123!@#");
      await chooseSite(page, "A", surface.mobile);
      const firstRead = page.waitForResponse(operatingResponse);
      await page
        .getByRole("button", { name: "Sync Context", exact: true })
        .click();
      const firstResponse = await firstRead;
      expect(firstResponse.status()).toBe(200);
      const first = await firstResponse.json();
      expect(first.error).toBeUndefined();
      expect(first.organizationId).toBe(ORG);
      expect(first.scope.siteId).toBe(SITE_A);
      expect(first.operationalAuthority).toBe(false);
      expect(
        first.objects.some(
          (object: { name: string }) => object.name === names.A,
        ),
      ).toBe(true);
      expect(
        first.objects.some((object: { name: string }) =>
          [names.B, names.draft].includes(object.name),
        ),
      ).toBe(false);
      const firstSource = first.sources.find(
        (source: { id: string }) => source.id === sourceId,
      );
      expect(firstSource).toMatchObject({
        class: "customer_operational",
        authority: "tenant_authorized",
        rightsState: "customer_authorized",
        state: "connected",
        displayAsLive: false,
      });
      expect(Date.parse(firstSource.observedAt)).toBe(Date.parse(observedAt));
      expect(Date.parse(firstSource.checkedAt)).toBe(Date.parse(checkedAt));
      expect(Date.parse(firstSource.checkedAt)).toBeLessThanOrEqual(
        Date.parse(first.generatedAt),
      );
      const workspace = page.getByRole("region", {
        name: "Sync Context workspace",
      });
      await expect(
        workspace.getByRole("heading", { name: "Sync Context", exact: true }),
      ).toBeVisible();
      await expect(
        workspace.getByRole("group", {
          name: "Authorized source geometry",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        workspace.getByRole("button", {
          name: `Inspect ${names.A}`,
          exact: true,
        }),
      ).toBeVisible();
      const objects = workspace.getByRole("list", {
        name: "Accessible returned object list",
      });
      const target = objects.getByRole("button", { name: new RegExp(names.A) });
      await expect(target).toBeVisible();
      await target.click();
      const inspector = workspace.getByRole("complementary", {
        name: "Selected object inspector",
      });
      await expect(
        inspector.getByRole("heading", { name: names.A, exact: true }),
      ).toBeVisible();
      await expect(
        inspector.getByText("Unknown — not supplied; not zero", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        inspector.getByText(/No operational authority/),
      ).toBeVisible();
      await expect(
        inspector.getByText("customer operational", { exact: true }),
      ).toBeVisible();
      await expect(
        inspector.getByText("tenant authorized", { exact: true }),
      ).toBeVisible();
      await expect(
        inspector.getByText("rights: customer authorized", { exact: true }),
      ).toBeVisible();
      await expect(
        inspector.getByText("connected", { exact: true }),
      ).toBeVisible();
      await expect(
        inspector.getByRole("link", { name: "Open Asset", exact: true }),
      ).toHaveAttribute("href", `/assets/${ASSET_A}`);
      await expect(
        inspector.getByText(EVIDENCE, { exact: true }),
      ).toBeVisible();
      await expect(
        inspector.getByText(/unavailable — not retrieved by this projection/),
      ).toBeVisible();
      for (const theme of ["light", "dark"]) {
        if ((await workspace.getAttribute("data-theme")) !== theme)
          await workspace
            .getByRole("button", { name: `Switch Context to ${theme} mode` })
            .click();
        await expect(workspace).toHaveAttribute("data-theme", theme);
        expect(
          await workspace.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ).toBe(true);
      }
      await inspector
        .getByRole("button", { name: "Close object inspector" })
        .click();
      await expect(target).toBeFocused();
      const siteBRead = page.waitForResponse(
        (response) =>
          operatingResponse(response) &&
          response.request().postDataJSON().p_site_id === SITE_B,
      );
      await chooseSite(page, "B", surface.mobile);
      if (surface.mobile) await page.keyboard.press("Escape");
      const siteBResponse = await siteBRead;
      const atB = await siteBResponse.json();
      expect(atB.scope.siteId).toBe(SITE_B);
      expect(
        atB.objects.some((object: { name: string }) => object.name === names.B),
      ).toBe(true);
      expect(
        atB.objects.some((object: { name: string }) => object.name === names.A),
      ).toBe(false);
      await expect(
        objects.getByRole("button", { name: new RegExp(names.B) }),
      ).toBeVisible();
      await expect(
        objects.getByRole("button", { name: new RegExp(names.A) }),
      ).toHaveCount(0);
      await rpc(reviewer.api, "transition_context_source_rights", {
        p_connector_id: sourceId,
        p_rights_state: "blocked",
        p_rights_reference: `SC02-BROWSER-REVOKED-${surface.name}`,
        p_basis:
          "Named administrator revokes this disposable synthetic source to prove fresh browser reads immediately remove ineligible geometry.",
      });
      const revokedRead = page.waitForResponse(operatingResponse);
      await workspace
        .getByRole("button", { name: "Refresh authorized data" })
        .click();
      const revoked = await (await revokedRead).json();
      expect(revoked.error).toBeUndefined();
      expect(revoked.scope.siteId).toBe(SITE_B);
      expect(revoked.organizationId).toBe(ORG);
      expect(revoked.coverage.objects.rightsBlocked).toBeGreaterThanOrEqual(1);
      expect(
        revoked.objects.some(
          (object: { source: { id: string } }) => object.source.id === sourceId,
        ),
      ).toBe(false);
      const assetsLayer = revoked.layers.find(
        (layer: { id: string }) => layer.id === "assets_sites",
      );
      expect(assetsLayer.empty).toBe(false);
      expect(assetsLayer.candidateCount).toBeGreaterThanOrEqual(1);
      const revokedSource = revoked.sources.find(
        (source: { id: string }) => source.id === sourceId,
      );
      expect(revokedSource).toMatchObject({
        class: "customer_operational",
        authority: "tenant_authorized",
        rightsState: "blocked",
        state: "unavailable",
        displayAsLive: false,
      });
      expect(Date.parse(revokedSource.observedAt)).toBe(
        Date.parse(firstSource.observedAt),
      );
      expect(Date.parse(revokedSource.checkedAt)).toBeGreaterThan(
        Date.parse(firstSource.checkedAt),
      );
      expect(Date.parse(revokedSource.checkedAt)).toBeLessThanOrEqual(
        Date.parse(revoked.generatedAt),
      );
      // Disappearance alone would also pass on a client parser/render failure.
      // Require the new snapshot's ready UI and retained unavailable source.
      await expect(
        workspace.getByRole("region", { name: "Query coverage" }),
      ).toBeVisible();
      await expect(workspace.getByRole("alert")).toHaveCount(0);
      await expect(
        workspace.getByText(
          /Previous geometry is hidden until this read succeeds/,
        ),
      ).toHaveCount(0);
      await expect(
        workspace
          .getByRole("region", { name: "Query coverage" })
          .getByText(revoked.generatedAt, { exact: true }),
      ).toBeVisible();
      const summary = workspace
        .locator("summary")
        .filter({ hasText: "Source health and governance" });
      await summary.click();
      const sourcePanel = workspace
        .locator(".context-source-panel article")
        .filter({
          has: page.getByRole("heading", {
            name: revokedSource.name,
            exact: true,
          }),
        });
      await expect(
        sourcePanel.getByText("rights: blocked", { exact: true }),
      ).toBeVisible();
      await expect(
        sourcePanel.getByText("unavailable", { exact: true }),
      ).toBeVisible();
      await expect(
        sourcePanel.getByText(revokedSource.checkedAt, { exact: true }),
      ).toBeVisible();
      await expect(
        sourcePanel.getByText(revokedSource.observedAt, { exact: true }),
      ).toBeVisible();
      await expect(
        objects.getByRole("button", { name: new RegExp(names.B) }),
      ).toHaveCount(0);
      await expect(inspector).toHaveCount(0);
      await testInfo.attach("context-authenticated-browser-receipt", {
        contentType: "application/json",
        body: Buffer.from(
          JSON.stringify({
            synthetic: true,
            production: false,
            surface: surface.name,
            organizationId: ORG,
            independentFeatureReview: true,
            canonicalSiteScope: true,
            identicalCoordinatesDoNotInferMembership: true,
            draftHidden: true,
            unknownAccuracy: true,
            operationalAuthority: false,
            rightsRevoked: true,
            rightsBlocked: revoked.coverage.objects.rightsBlocked,
          }),
        ),
      });
    } finally {
      await author.api.dispose();
      await reviewer.api.dispose();
    }
  });
}

test("Context real foreign tenant never receives local subjects, and technician experience does not request Context", async ({
  page,
}) => {
  await login(page, "sync-context-foreign@syncai.ca", "Foreign123!@#");
  const foreignRead = page.waitForResponse(operatingResponse);
  await page.goto("/context");
  const foreignResponse = await foreignRead;
  expect(foreignResponse.status()).toBe(200);
  const foreign = await foreignResponse.json();
  expect(foreign.error).toBeUndefined();
  expect(foreign.organizationId).toBe(FOREIGN_ORG);
  expect(
    foreign.objects.some((object: { subjects: { id: string }[] }) =>
      object.subjects.some((subject) =>
        [ASSET_A, ASSET_B, SITE_A, SITE_B].includes(subject.id),
      ),
    ),
  ).toBe(false);
  await expect(
    page.getByRole("heading", { name: "Sync Context", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(
    page,
    "sync-context-tech@syncai.ca",
    "Tech123!@#",
    "Work Action Board",
  );
  const requests: string[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/rpc/get_sync_context_operating_picture"))
      requests.push(req.url());
  });
  await page.goto("/context");
  await expect(page).toHaveURL(/\/work$/);
  await expect(
    page.getByRole("heading", { name: "Work Action Board", exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
  await expect(
    page.getByRole("region", { name: "Sync Context workspace" }),
  ).toHaveCount(0);
});
