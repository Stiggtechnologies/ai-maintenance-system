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

const GUARDED_PAGES = ["/mission-control", DEMO_ASSESSMENT, "/knowledge", "/approvals"];

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
  expect(overflow, "horizontal overflow of the document").toBeLessThanOrEqual(8);
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
