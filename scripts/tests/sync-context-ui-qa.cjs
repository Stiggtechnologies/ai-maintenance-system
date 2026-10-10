const { chromium, expect } = require("@playwright/test");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const artifactDir = mkdtempSync(join(tmpdir(), "syncai-context-ui-qa-"));
(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const [name, width, height] of [
      ["desktop", 1440, 900],
      ["tablet", 820, 1180],
      ["mobile320", 320, 812],
      ["mobile360", 360, 812],
      ["mobile", 375, 812],
      ["mobile390", 390, 844],
      ["mobile400", 400, 844],
      ["mobile430", 430, 932],
      ["landscape", 812, 375],
    ]) {
      const touch = name.startsWith("mobile") || name === "landscape";
      const context = await browser.newContext({
        viewport: { width, height },
        isMobile: touch,
        hasTouch: touch,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const errors = [],
        external = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (req) => {
        if (
          !req.url().startsWith("http://127.0.0.1:5189/") &&
          !req.url().startsWith("data:")
        )
          external.push(req.url());
      });
      await page.goto("http://127.0.0.1:5189/context-visual-qa.html");
      const canvas = page.getByRole("group", {
        name: "Authorized source geometry",
      });
      await expect(canvas).toBeVisible();
      await expect(page.getByText(/2 drawn shapes/)).toBeVisible();
      for (const label of await page.locator(".context-layer label").all()) {
        const box = await label.boundingBox();
        if (!box || box.height < 44)
          throw new Error(`${name}: layer label touch target below 44px`);
      }
      for (const button of await page
        .locator(".context-workspace button")
        .all()) {
        const box = await button.boundingBox();
        if (box && (box.width < 44 || box.height < 44))
          throw new Error(`${name}: button touch target below 44px`);
      }
      const target = page.getByRole("button", {
        name: "Inspect Synthetic Pump A",
      });
      await target.focus();
      await page.keyboard.press("Enter");
      const inspector = page.getByRole("complementary", {
        name: "Selected object inspector",
      });
      await expect(inspector).toBeVisible();
      await expect(
        inspector.getByText(/Unknown — not supplied; not zero/),
      ).toBeVisible();
      await page.screenshot({
        path: join(artifactDir, `${name}-light.png`),
        fullPage: true,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      if (overflow) throw new Error(`${name}: horizontal overflow`);
      await page
        .getByRole("button", { name: "Close object inspector" })
        .click();
      await expect(target).toBeFocused();
      const original = await canvas.getAttribute("viewBox");
      await canvas.focus();
      await page.keyboard.press("ArrowRight");
      if (original === (await canvas.getAttribute("viewBox")))
        throw new Error(`${name}: keyboard pan did not change viewport`);
      await page.getByRole("button", { name: "Fit returned shapes" }).click();
      await canvas.scrollIntoViewIfNeeded();
      const point = await canvas.locator("path").first().boundingBox();
      if (!point)
        throw new Error(`${name}: missing point for pointer-over-shape test`);
      const x = point.x + point.width * 0.2,
        y = point.y + point.height * 0.2;
      const beforeDrag = await canvas.getAttribute("viewBox");
      if (touch) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y }],
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + 30, y: y + 20 }],
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await cdp.detach();
      } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 30, y + 20, { steps: 3 });
        await page.mouse.up();
      }
      if (beforeDrag === (await canvas.getAttribute("viewBox")))
        throw new Error(`${name}: drag over source shape did not pan`);
      await expect(inspector).toHaveCount(0);
      await page.getByRole("button", { name: "World", exact: true }).click();
      await expect(canvas).toHaveAttribute("viewBox", "0 0 1000 500");
      await page
        .getByRole("button", { name: "Switch Context to dark mode" })
        .click();
      await expect(
        page.getByRole("region", { name: "Sync Context workspace" }),
      ).toHaveAttribute("data-theme", "dark");
      await page.reload();
      await expect(canvas).toHaveAttribute("viewBox", "0 0 1000 500");
      await expect(
        page.getByRole("region", { name: "Sync Context workspace" }),
      ).toHaveAttribute("data-theme", "dark");
      await page.getByRole("button", { name: "Fit returned shapes" }).click();
      await target.click();
      await page.screenshot({
        path: join(artifactDir, `${name}-dark.png`),
        fullPage: true,
      });
      if (errors.length || external.length)
        throw new Error(`${name}: ${JSON.stringify({ errors, external })}`);
      results.push({
        name,
        width,
        height,
        noHorizontalOverflow: true,
        keyboardSelectPan: true,
        pointerOverShapePan: true,
        touch,
        dragDoesNotSelect: true,
        inspectorCloseReturnsFocus: true,
        metadataReload: true,
        themes: ["light", "dark"],
        externalRequests: external.length,
        pageErrors: errors.length,
      });
      await context.close();
    }
    console.log(
      JSON.stringify(
        {
          qualification:
            "synthetic rendered UI only; not authentication/RLS/customer-feed evidence",
          artifactDir,
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
