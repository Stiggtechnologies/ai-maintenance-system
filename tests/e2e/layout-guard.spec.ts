import { test, expect, type Page } from "@playwright/test";

/**
 * Layout guard — the premium-build regression net.
 *
 * Catches the defect class reported on 2026-08-27 (management-question text
 * colliding with the fact-card row at a short viewport): elements occupying
 * the same screen space, and horizontal overflow, on the pages buyers see.
 *
 * Runs at three viewports — including the short 1626x624 window the defect
 * was reported at — so a future change that makes any guarded pair collide
 * fails CI with a named pair instead of reaching a human screenshot.
 *
 * Conservative by design: only solid, known-good element pairs are guarded,
 * intersections must exceed a 4px band on both axes, and parent/child pairs
 * are ignored.
 */

const DEMO_EMAIL = "demo@syncai.ca";
const DEMO_PASSWORD = "Demo123!@#";
const DEMO_ASSESSMENT = "/assessments/44444444-0000-0000-0000-000000000001";

const VIEWPORTS = [
  { name: "short-desktop", width: 1626, height: 624 },
  { name: "standard", width: 1280, height: 720 },
  { name: "mobile", width: 390, height: 844 },
];

type GuardedPair = { path: string; a: string; b: string; label: string };

const GUARDED_PAIRS: GuardedPair[] = [
  {
    path: DEMO_ASSESSMENT,
    a: "blockquote",
    b: ".grid .rounded-xl",
    label: "management question vs fact cards",
  },
  {
    path: DEMO_ASSESSMENT,
    a: "h1",
    b: "blockquote",
    label: "scope title vs management question",
  },
  {
    path: "/knowledge",
    a: "form",
    b: "ul",
    label: "ingest form vs document list",
  },
];

const GUARDED_PAGES = [
  "/mission-control",
  DEMO_ASSESSMENT,
  "/knowledge",
  "/approvals",
];

async function login(page: Page) {
  await page.goto("/signin");
  const email = page.getByRole("textbox", { name: /work email/i });
  await expect(email).toBeVisible({ timeout: 20_000 });
  await email.fill(DEMO_EMAIL);
  await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /access syncai/i }).click();
  await expect(
    page.getByRole("heading", { name: "Mission Control" }),
  ).toBeVisible({ timeout: 30_000 });
}

async function assertNoOverlap(page: Page, aSel: string, bSel: string) {
  const overlap = await page.evaluate(
    ([aSel, bSel]) => {
      const visible = (sel: string) =>
        Array.from(document.querySelectorAll(sel)).filter((el) => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return (
            r.width > 2 &&
            r.height > 2 &&
            st.visibility !== "hidden" &&
            st.display !== "none"
          );
        });
      const A = visible(aSel);
      const B = visible(bSel);
      for (const a of A) {
        for (const b of B) {
          if (a.contains(b) || b.contains(a)) continue;
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (ox > 4 && oy > 4) {
            return {
              a: (a.textContent ?? "").slice(0, 60),
              b: (b.textContent ?? "").slice(0, 60),
              ox: Math.round(ox),
              oy: Math.round(oy),
            };
          }
        }
      }
      return null;
    },
    [aSel, bSel],
  );
  expect(overlap, `layout overlap between "${aSel}" and "${bSel}"`).toBeNull();
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "horizontal overflow of the document").toBeLessThanOrEqual(
    8,
  );
}

for (const vp of VIEWPORTS) {
  test.describe(`layout guard @ ${vp.name} (${vp.width}x${vp.height})`, () => {
    test.describe.configure({ mode: "serial" });

    test("login", async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await login(page);
    });

    for (const path of GUARDED_PAGES) {
      test(`no horizontal overflow on ${path}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await assertNoHorizontalOverflow(page);
      });
    }

    for (const pair of GUARDED_PAIRS) {
      test(`no overlap: ${pair.label} @ ${pair.path}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(pair.path);
        await page.waitForLoadState("networkidle");
        await assertNoOverlap(page, pair.a, pair.b);
      });
    }
  });
}

/**
 * Unauthenticated /setup landing — the iPhone screenshot of 2026-08-31
 * showed the hero lede stamped on itself because leading-8 resolves to
 * --spacing-8 (8px) in this repo's Tailwind theme.
 * These tests do not sign in and must not depend on demo fixtures.
 */
test.describe("public assessment landing @ mobile (390x844)", () => {
  test("hero lede is a single readable block above the cards and CTA", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/setup");
    await page.waitForLoadState("networkidle");

    const ledes = page.getByTestId("assessment-hero-lede");
    await expect(ledes).toHaveCount(1);
    await expect(ledes).toHaveText(
      "SyncAI uses one bounded entry product: a 6–8 week Reliability Intelligence Assessment, built from customer-provided exports, with evidence-graded findings and a 90-day action plan.",
    );
    await expect(ledes).not.toContainText(/48-hour/i);
    await expect(ledes).not.toContainText(/US\$35,000/);
    const price = page.getByTestId("assessment-hero-price");
    await expect(price).toHaveCount(1);
    await expect(price).toContainText(/US\$35,000/);

    const metrics = await ledes.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        position: style.position,
        fontSize: parseFloat(style.fontSize),
        lineHeight: parseFloat(style.lineHeight),
        height: rect.height,
        bottom: rect.bottom,
      };
    });

    expect(metrics.position, "lede must stay in normal flow").toBe("static");
    expect(metrics.lineHeight).toBeGreaterThanOrEqual(metrics.fontSize);
    expect(
      metrics.height,
      "lede must wrap onto separate lines instead of stacking on one line",
    ).toBeGreaterThan(metrics.lineHeight * 2);

    const constraints = page.getByTestId("assessment-hero-constraints");
    const cta = page.getByTestId("assessment-hero-cta");
    const ledeBox = await ledes.boundingBox();
    const constraintBox = await constraints.boundingBox();
    const ctaBox = await cta.boundingBox();
    expect(ledeBox).toBeTruthy();
    expect(constraintBox).toBeTruthy();
    expect(ctaBox).toBeTruthy();
    expect(constraintBox!.y).toBeGreaterThan(ledeBox!.y + ledeBox!.height - 1);
    expect(ctaBox!.y).toBeGreaterThan(
      constraintBox!.y + constraintBox!.height - 1,
    );

    await assertNoOverlap(
      page,
      "[data-testid='assessment-hero-lede']",
      "[data-testid='assessment-hero-constraints']",
    );
    await assertNoOverlap(
      page,
      "[data-testid='assessment-hero-lede']",
      "[data-testid='assessment-hero-cta']",
    );
    await assertNoHorizontalOverflow(page);
  });
});

/**
 * E6.13 — the authenticated shell must give the page the whole phone viewport.
 * A document-overflow check alone cannot catch the historical failure: the
 * fixed-width sidebar consumed 240px without overflowing the document, leaving
 * only 135px for the actual application at 375px. These assertions measure the
 * content viewport and prove navigation is an overlay, not a competing column.
 */
test.describe("authenticated application shell @ phone (375x812)", () => {
  test("keeps full-width content and exposes reachable thumb navigation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page);

    const content = page.locator("main").first();
    const sidebar = page.locator("aside").first();
    const bottomNav = page.getByRole("navigation", {
      name: "Primary mobile navigation",
    });

    await expect(bottomNav).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).toBeVisible();

    const closedContentBox = await content.boundingBox();
    const closedSidebarBox = await sidebar.boundingBox();
    expect(closedContentBox).toBeTruthy();
    expect(closedSidebarBox).toBeTruthy();
    expect(closedContentBox!.width).toBeGreaterThanOrEqual(374);
    expect(closedContentBox!.y).toBeLessThan(220);
    expect(closedContentBox!.height).toBeGreaterThan(500);
    expect(closedSidebarBox!.x + closedSidebarBox!.width).toBeLessThanOrEqual(
      1,
    );

    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    const openContentBox = await content.boundingBox();
    const openSidebarBox = await sidebar.boundingBox();
    expect(openContentBox).toBeTruthy();
    expect(openSidebarBox).toBeTruthy();
    expect(openContentBox!.width).toBeGreaterThanOrEqual(374);
    expect(openContentBox!.y).toBeLessThan(220);
    expect(openContentBox!.height).toBeGreaterThan(500);
    expect(openSidebarBox!.x).toBeGreaterThanOrEqual(-1);
    expect(openSidebarBox!.width).toBeGreaterThanOrEqual(239);

    // Close the overlay from the unobscured side, then prove a thumb tab
    // reaches the mobile-first field workflow without narrowing the page.
    await page.mouse.click(330, 100);
    await expect(
      page.getByRole("button", { name: "Sign out" }),
    ).not.toBeVisible();
    await bottomNav.getByRole("button", { name: "Field", exact: true }).click();
    await expect(page).toHaveURL(/\/field$/);
    await expect(content).toBeVisible();
    expect((await content.boundingBox())!.width).toBeGreaterThanOrEqual(374);
    await assertNoHorizontalOverflow(page);
  });
});
