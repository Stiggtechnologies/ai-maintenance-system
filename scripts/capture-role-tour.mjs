#!/usr/bin/env node
/**
 * Capture the product as each layer of the maintenance organization sees it.
 *
 * Outreach needs pictures, and the pictures have to be honest ones: the real
 * fleet, the real numbers, the real build stamp. Hand-taking them means a
 * different crop and a different scroll position every time, and it means
 * re-taking the whole set the moment a screen changes. This does the tour the
 * same way every time, signed in as each role, so the deck for the next
 * prospect costs one command instead of an afternoon.
 *
 * Two artifacts per role, from one pass:
 *   - full-page PNGs at 2x, which is what goes in an email; and
 *   - a silent screen recording, for when someone asks to see it move.
 *
 * Credentials are PARSED FROM THE DEMO RUNBOOK rather than repeated here.
 * The runbook is the published source of truth for the demo tier, and a
 * second copy in a script is a second thing to rotate and forget.
 *
 *   node scripts/capture-role-tour.mjs
 *   node scripts/capture-role-tour.mjs --base http://localhost:5173 --roles executive,technician
 */
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const RUNBOOK = path.join(REPO, "docs/demo-runbook-ahs-fleet.md");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const BASE = arg("base", "https://app.syncai.ca").replace(/\/$/, "");
const OUT = path.resolve(arg("out", path.join(REPO, "artifacts/role-tour")));
const ONLY = arg("roles", "")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);

/**
 * The tour, ordered the way the story is told: the field first, the boardroom
 * last. `routes` are that role's own command centers — the surfaces its
 * navigation actually exposes, not every page in the product.
 */
const TOUR = [
  {
    key: "technician",
    title: "Technician — the field",
    question: "What am I working on, and what does it need?",
    routes: ["/work", "/emergency"],
  },
  {
    key: "planner",
    title: "Planner — the week",
    question: "Is next week's plan executable?",
    routes: ["/briefing", "/work", "/assets"],
  },
  {
    key: "reliability_engineer",
    title: "Reliability engineer — the fleet",
    question: "Which assets are hurting us, and why?",
    routes: ["/mission-control", "/assets", "/reliability", "/risk"],
  },
  {
    key: "executive",
    title: "Executive — the boardroom",
    question: "Are we meeting the commitments we are accountable for?",
    routes: ["/executive", "/value", "/performance"],
  },
];

/** Pull the demo logins out of the runbook's credentials table. */
async function credentialsFromRunbook() {
  const md = await readFile(RUNBOOK, "utf8");
  const byEmail = new Map();
  for (const line of md.split("\n")) {
    const m = line.match(/\|\s*([^|]+?)\s*\|\s*(\S+@\S+)\s*\|\s*(\S+)\s*\|/);
    if (m) byEmail.set(m[2].toLowerCase(), { label: m[1], password: m[3] });
  }
  if (byEmail.size === 0) {
    throw new Error(
      `No credentials table found in ${RUNBOOK}. The tour reads its logins from ` +
        `that table so there is only one copy to rotate.`,
    );
  }
  return byEmail;
}

/** Map a tour role key onto the demo account that has it. */
const ACCOUNT = {
  technician: "technician@syncai.ca",
  planner: "planner@syncai.ca",
  reliability_engineer: "demo@syncai.ca",
  executive: "executive@syncai.ca",
};

async function signIn(page, email, password) {
  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/signin"), {
      timeout: 45_000,
    }),
    page.click('button[type="submit"]'),
  ]);
}

async function signOut(page) {
  const link = page.getByRole("button", { name: /sign out/i });
  if (await link.count()) {
    await link.first().click();
    await page.waitForURL(/\/(signin)?$/, { timeout: 20_000 }).catch(() => {});
  }
  await page.context().clearCookies();
}

/**
 * Wait for the screen to stop moving. Counters animate up and charts settle;
 * a shot taken mid-animation shows a number nobody will ever see in the
 * product, which is exactly the kind of detail a prospect notices.
 */
async function settle(page) {
  await page
    .waitForLoadState("networkidle", { timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(2_500);
}

const slug = (route) => route.replace(/^\//, "").replace(/\//g, "-") || "home";

/**
 * Tallest a shot may be, in CSS pixels. Several screens reserve scroll room
 * far below their last row — `fullPage` on those returns a strip of empty
 * canvas eighteen thousand pixels long, which is useless in an email and
 * reads as a broken page. Roughly two and a half screens is as much as
 * anyone scrolls through in a forwarded message anyway.
 */
const MAX_SHOT_HEIGHT = 2600;

/**
 * Height of the actual content, as opposed to the height of the scroll area.
 * Measured from the lowest element that renders something a reader can see,
 * so the crop lands just under the last card rather than at the bottom of
 * whatever padding the layout happens to reserve.
 */
async function contentHeight(page) {
  return page.evaluate(() => {
    const root = document.querySelector("main") ?? document.body;
    let lowest = 0;
    for (const el of root.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const paints =
        (el.textContent ?? "").trim().length > 0 ||
        el.tagName === "IMG" ||
        el.tagName === "SVG" ||
        el.tagName === "CANVAS";
      if (paints) lowest = Math.max(lowest, rect.bottom + window.scrollY);
    }
    return Math.ceil(lowest);
  });
}

async function main() {
  const creds = await credentialsFromRunbook();
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.join(OUT, stamp);
  await mkdir(outDir, { recursive: true });

  const roles = TOUR.filter((r) => ONLY.length === 0 || ONLY.includes(r.key));
  const browser = await chromium.launch();
  const manifest = [];

  for (const role of roles) {
    const email = ACCOUNT[role.key];
    const cred = creds.get(email);
    if (!cred) {
      console.error(`  ! no runbook credentials for ${email} — skipping`);
      continue;
    }

    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
      colorScheme: "dark",
      recordVideo: {
        dir: path.join(outDir, "video"),
        size: { width: 1600, height: 1000 },
      },
    });
    const page = await context.newPage();

    console.log(`\n${role.title}  (${email})`);
    try {
      await signIn(page, email, cred.password);
    } catch (err) {
      console.error(`  ! sign-in failed: ${err.message}`);
      await context.close();
      continue;
    }

    for (const route of role.routes) {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      await settle(page);

      const name = `${role.key}--${slug(route)}.png`;
      const file = path.join(outDir, name);
      const viewport = page.viewportSize();
      const height = Math.min(
        Math.max((await contentHeight(page)) + 24, viewport.height),
        MAX_SHOT_HEIGHT,
      );
      await page.screenshot({
        path: file,
        clip: { x: 0, y: 0, width: viewport.width, height },
      });

      // Record what the page actually said, so a caption can never drift from
      // the screen it claims to describe.
      const heading = await page
        .locator("h1, h2")
        .first()
        .innerText()
        .catch(() => "");
      manifest.push({
        role: role.key,
        roleTitle: role.title,
        question: role.question,
        route,
        file: name,
        heading: heading.trim().split("\n")[0] ?? "",
      });
      console.log(`  ✓ ${route.padEnd(22)} → ${name}`);
    }

    await signOut(page);
    await context.close();
  }

  await browser.close();

  const manifestPath = path.join(outDir, "manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify({ base: BASE, capturedAt: stamp, shots: manifest }, null, 2)}\n`,
  );
  console.log(`\n${manifest.length} shots → ${outDir}`);
  console.log(`manifest → ${manifestPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
