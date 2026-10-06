#!/usr/bin/env node
/**
 * Mobile audit — sweeps the declared 49 routes at 390x844 (demo persona,
 * read-only) and reports: horizontal overflow, elements wider than the
 * viewport, and clipped-text candidates. Screenshots every route.
 *
 * Output: owner-only report and screenshots in a unique private temp directory.
 * Credentials must be explicitly supplied for the authorized demo persona.
 */
import { chromium } from "playwright";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = "https://app.syncai.ca";

const ROUTES = [
  "/",
  "/mission-control",
  "/command-centers",
  "/readiness",
  "/assessments",
  "/executive",
  "/oee",
  "/value",
  "/overview",
  "/performance",
  "/benchmarking",
  "/assets",
  "/assets/ontology",
  "/assets/twins",
  "/onboarding",
  "/reliability",
  "/reliability/intervals",
  "/reliability-copilot",
  "/risk",
  "/job-plans",
  "/pm-programme",
  "/lifecycle",
  "/lifecycle/decisions",
  "/design",
  "/work",
  "/notifications",
  "/scheduling",
  "/recovery",
  "/materials",
  "/handover",
  "/briefing",
  "/playbooks",
  "/approvals",
  "/governance",
  "/decision-governance",
  "/learning-loop",
  "/integrations",
  "/integration-health",
  "/knowledge",
  "/settings",
  "/turnarounds",
  "/emergency",
  "/demo/copilot",
  "/cowork",
  "/artifacts",
  "/autonomy-maturity",
  "/ai-workforce",
  "/develop",
  "/setup",
];

export function createAuditOutput() {
  // mkdtemp atomically allocates an unpredictable directory. No reuse of the
  // old shared location: authenticated screenshots may contain tenant data.
  const directory = mkdtempSync(join(tmpdir(), "syncai-mobile-audit-"));
  chmodSync(directory, 0o700);
  return directory;
}

export function writeAuditArtifact(directory, name, content) {
  if (!/^[a-zA-Z0-9_-]+\.(?:png|json)$/.test(name)) {
    throw new Error("Unsupported audit artifact name");
  }
  // Exclusive creation refuses existing files AND symlinks; no truncate or
  // overwrite of another run's report. Screenshots use the same write path.
  writeFileSync(join(directory, name), content, { flag: "wx", mode: 0o600 });
}

export async function runMobileAudit({
  env = process.env,
  log = console.log,
} = {}) {
  const email = env.DEMO_EMAIL;
  const password = env.DEMO_PASSWORD;
  if (!email?.trim() || !password?.trim()) {
    throw new Error(
      "DEMO_EMAIL and DEMO_PASSWORD are required for an authorized demo account",
    );
  }
  const directory = createAuditOutput();
  const reportPath = join(directory, "mobile-audit-report.json");
  log(`artifacts: ${directory}`);
  const report = [];
  let browser;
  let context;
  let currentRoute = "/signin";
  let authenticated = false;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: /work email/i }).fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: /access syncai/i }).click();
    // A timeout must not turn a sweep of signed-out pages into a PASS report.
    await page.waitForURL(`${BASE}/mission-control`, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    if (page.url() !== `${BASE}/mission-control`)
      throw new Error("Workspace not reached");
    authenticated = true;

    for (const route of ROUTES) {
      currentRoute = route;
      const slug = route === "/" ? "index" : route.replaceAll("/", "_");
      let response;
      try {
        response = await page.goto(`${BASE}${route}`, {
          waitUntil: "networkidle",
          timeout: 25_000,
        });
      } catch {
        report.push({
          route,
          verdict: "LOAD_FAIL",
          note: "timeout/error loading",
        });
        continue;
      }
      await page.waitForTimeout(800);
      const observed = new URL(page.url());
      if (observed.origin !== BASE || observed.pathname !== route) {
        report.push({
          route,
          verdict: "REDIRECTED",
          finalPath: observed.pathname,
        });
        continue;
      }
      const httpStatus = response?.status();
      if (httpStatus === undefined || httpStatus >= 400) {
        report.push({
          route,
          verdict: "HTTP_FAIL",
          httpStatus: httpStatus ?? null,
        });
        continue;
      }
      const checks = await page.evaluate(() => {
        const vw = window.innerWidth;
        const overflow = document.documentElement.scrollWidth - vw;
        const wide = Array.from(document.querySelectorAll("body *"))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return (
              r.width > 4 &&
              r.right > vw + 8 &&
              st.position !== "fixed" &&
              st.display !== "none" &&
              st.visibility !== "hidden"
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
              st.overflow === "hidden" &&
              el.scrollHeight > el.clientHeight + 4 &&
              el.clientHeight > 0 &&
              el.scrollHeight > 30
            );
          })
          .slice(0, 5)
          .map(
            (el) =>
              `${el.tagName.toLowerCase()} h=${el.clientHeight}/s=${el.scrollHeight}`,
          );
        return { overflow, wide, clipped };
      });
      const screenshot = await page.screenshot({ fullPage: false });
      writeAuditArtifact(directory, `${slug}.png`, screenshot);
      const verdict =
        checks.overflow > 8
          ? "OVERFLOW"
          : checks.wide.length > 0
            ? "WIDE"
            : checks.clipped.length > 0
              ? "CLIPPED-CANDIDATES"
              : "PASS";
      report.push({ route, verdict, ...checks });
      log(
        `${verdict.padEnd(18)} ${route}  overflow=${checks.overflow}px wide=${checks.wide.length} clipped=${checks.clipped.length}`,
      );
    }
    return { directory, reportPath, report };
  } catch {
    report.push(
      authenticated
        ? {
            route: currentRoute,
            verdict: "AUDIT_FAIL",
            note: "Route inspection or artifact capture failed",
          }
        : {
            route: "/signin",
            verdict: "AUTH_FAIL",
            note: "Demo sign-in did not reach the authenticated workspace",
          },
    );
    // Never put browser/provider diagnostics or credential values in reports.
    throw new Error(
      "Mobile audit did not complete; inspect the private report",
    );
  } finally {
    try {
      writeAuditArtifact(
        directory,
        "mobile-audit-report.json",
        JSON.stringify(report, null, 2),
      );
      log(`report: ${reportPath}`);
    } finally {
      try {
        await context?.close();
      } finally {
        await browser?.close();
      }
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const result = await runMobileAudit();
    if (result.report.some((row) => row.verdict !== "PASS"))
      process.exitCode = 1;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Mobile audit failed",
    );
    process.exitCode = 1;
  }
}
