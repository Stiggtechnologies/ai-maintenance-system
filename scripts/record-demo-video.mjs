#!/usr/bin/env node
/**
 * Demo video recorder — drives the LIVE product (app.syncai.ca) through the
 * 7-act demo (docs/demo-runbook-ahs-fleet.md) and records the viewport.
 *
 * Read-only by design: no approvals are made, no demo state is mutated.
 * Login: demo@syncai.ca (persona: reliability engineer).
 *
 * Output: videos/syncai-demo-walkthrough.webm (+ .mp4 via ffmpeg afterward).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "https://app.syncai.ca";
const OUT_DIR = "videos";
const EMAIL = process.env.DEMO_EMAIL || "demo@syncai.ca";
const PASSWORD = process.env.DEMO_PASSWORD || "Demo123!@#";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepMs = Number(process.env.DEMO_PACE_MS || 4000);

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: OUT_DIR, size: { width: 1600, height: 900 } },
});
const page = await context.newPage();

try {
  // Act 1 — the front door, signed out. Let it breathe.
  await page.goto(BASE, { waitUntil: "networkidle" });
  await pause(sleepMs * 2);

  // Sign in as the demo reliability engineer.
  await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /work email/i }).fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /access syncai/i }).click();
  await page.waitForURL("**/mission-control", { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle");

  // Act 2 — Mission Control: the posture.
  await pause(sleepMs * 2);
  await page.mouse.wheel(0, 400);
  await pause(sleepMs);
  await page.mouse.wheel(0, 400);
  await pause(sleepMs);
  await page.mouse.wheel(0, -800);
  await pause(sleepMs);

  // Act 3 — the fleet and its bad actor: T301.
  await page.goto(`${BASE}/assets/4b54d83f-2afc-410f-b62d-28154be6ce18`, { waitUntil: "networkidle" });
  await pause(sleepMs * 2);
  await page.mouse.wheel(0, 400);
  await pause(sleepMs);
  await page.mouse.wheel(0, 400);
  await pause(sleepMs);
  await page.mouse.wheel(0, -800);
  await pause(sleepMs);

  // Act 4 — the evidence trail (asset context tabs).
  for (const tab of ["Health History", "Work Orders", "Criticality"]) {
    const t = page.getByRole("button", { name: tab }).or(page.getByRole("tab", { name: tab }));
    if (await t.count()) {
      await t.first().click().catch(() => {});
      await pause(sleepMs);
    }
  }

  // Act 5 — the copilot work product.
  const copilot = page.getByPlaceholder(/ask/i).first();
  if (await copilot.count()) {
    await copilot.fill("What is driving unplanned downtime on this asset?");
    await copilot.press("Enter");
    await pause(sleepMs * 3); // wait for the cited answer
    await page.mouse.wheel(0, 300);
    await pause(sleepMs);
  }

  // Act 6 — governance: the human stays in command.
  await page.goto(`${BASE}/approvals`, { waitUntil: "networkidle" });
  await pause(sleepMs * 2);
  await page.mouse.wheel(0, 300);
  await pause(sleepMs);
  await page.mouse.wheel(0, -400);
  await pause(sleepMs);

  // Act 7 — the boardroom view.
  await page.goto(`${BASE}/value`, { waitUntil: "networkidle" });
  await pause(sleepMs * 2);
  await page.mouse.wheel(0, 400);
  await pause(sleepMs);

  // Act 8 — the new Knowledge Base surface (document intake).
  await page.goto(`${BASE}/knowledge`, { waitUntil: "networkidle" });
  await pause(sleepMs * 2);

  console.log("walkthrough complete — closing context to finalize video");
} finally {
  await context.close();
  await browser.close();
}
