#!/usr/bin/env node
/**
 * Mobile audit — sweeps every navigable surface at 390x844 (demo persona,
 * read-only) and reports: horizontal overflow, elements wider than the
 * viewport, and clipped-text candidates. Screenshots every route.
 *
 * Output: mobile-audit-report.json + screenshots in /tmp/mobile-audit/
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://app.syncai.ca";
const OUT = "/tmp/mobile-audit";
const EMAIL = process.env.DEMO_EMAIL || "demo@syncai.ca";
const PASSWORD = process.env.DEMO_PASSWORD || "Demo123!@#";

const ROUTES = [
  "/", "/mission-control", "/command-centers", "/readiness", "/assessments",
  "/executive", "/oee", "/value", "/overview", "/performance", "/benchmarking",
  "/assets", "/assets/ontology", "/assets/twins", "/onboarding",
  "/reliability", "/reliability/intervals", "/reliability-copilot", "/risk",
  "/job-plans", "/pm-programme", "/lifecycle", "/lifecycle/decisions", "/design",
  "/work", "/notifications", "/scheduling", "/recovery", "/materials", "/handover",
  "/briefing", "/playbooks", "/approvals", "/governance", "/decision-governance",
  "/learning-loop", "/integrations", "/integration-health", "/knowledge",
  "/settings", "/turnarounds", "/emergency", "/demo/copilot", "/cowork",
  "/artifacts", "/autonomy-maturity", "/ai-workforce", "/develop", "/setup",
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const report = [];

try {
  await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /work email/i }).fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /access syncai/i }).click();
  await page.waitForURL("**/mission-control", { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle");

  for (const route of ROUTES) {
    const slug = route === "/" ? "index" : route.replaceAll("/", "_");
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 25_000 });
    } catch {
      report.push({ route, verdict: "LOAD_FAIL", note: "timeout/error loading" });
      continue;
    }
    await page.waitForTimeout(800);
    const checks = await page.evaluate(() => {
      const vw = window.innerWidth;
      const overflow = document.documentElement.scrollWidth - vw;
      const wide = Array.from(document.querySelectorAll("body *"))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return (
            r.width > 4 && r.right > vw + 8 && st.position !== "fixed" &&
            st.display !== "none" && st.visibility !== "hidden"
          );
        })
        .slice(0, 6)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 2).join(".") : ""} (right=${Math.round(r.right)})`;
        });
      const clipped = Array.from(document.querySelectorAll("body *"))
        .filter((el) => {
          const st = getComputedStyle(el);
          return (
            st.overflow === "hidden" && el.scrollHeight > el.clientHeight + 4 &&
            el.clientHeight > 0 && el.scrollHeight > 30
          );
        })
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()} h=${el.clientHeight}/s=${el.scrollHeight}`);
      return { overflow, wide, clipped };
    });
    await page.screenshot({ path: `${OUT}/${slug}.png`, fullPage: false });
    const verdict =
      checks.overflow > 8 ? "OVERFLOW"
        : checks.wide.length > 0 ? "WIDE"
          : checks.clipped.length > 0 ? "CLIPPED-CANDIDATES" : "PASS";
    report.push({ route, verdict, ...checks });
    console.log(`${verdict.padEnd(18)} ${route}  overflow=${checks.overflow}px wide=${checks.wide.length} clipped=${checks.clipped.length}`);
  }
} finally {
  writeFileSync(`${OUT}/mobile-audit-report.json`, JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
  console.log(`\nreport: ${OUT}/mobile-audit-report.json`);
}
