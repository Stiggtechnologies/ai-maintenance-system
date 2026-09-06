import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandWordmark } from "./BrandWordmark";

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const WORDMARK = "public/brand/wordmark-ink.png";

function pngColorType(bytes: Buffer): number {
  const ihdr = bytes.indexOf(Buffer.from("IHDR"));
  expect(ihdr).toBeGreaterThan(-1);
  return bytes[ihdr + 4 + 8 + 1];
}

describe("BrandWordmark", () => {
  it("commits a PNG with an alpha channel and no opaque black box", () => {
    const bytes = readFileSync(WORDMARK);
    expect(bytes.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(pngColorType(bytes)).toBe(6);
  });

  it("renders the wordmark image at nav-row size without a background plate", () => {
    const { container } = render(<BrandWordmark />);
    const img = screen.getByRole("img", { name: "SyncAI" });
    expect(img).toHaveAttribute("src", "/brand/wordmark-ink.png");
    expect(img.className).toMatch(/\bh-9\b/);
    expect(img.className).toMatch(/\bshrink-0\b/);
    expect(img.className).not.toMatch(/bg-|rounded-lg|shadow-/);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("is the header mark in AppShell and PublicProductHeader, not Zap or Activity", () => {
    const appShell = readFileSync("src/components/AppShell.tsx", "utf8");
    const publicHeader = readFileSync(
      "src/components/PublicProductHeader.tsx",
      "utf8",
    );
    expect(appShell).toContain("BrandWordmark");
    expect(publicHeader).toContain("BrandWordmark");
    expect(appShell).not.toMatch(/<Zap[\s/>]/);
    expect(publicHeader).not.toMatch(/<Activity[\s/>]/);
    expect(publicHeader).not.toMatch(/<Zap[\s/>]/);
    expect(appShell).not.toMatch(/<Activity[\s/>]/);
  });

  it("is the mark on every customer header, footer, and public chrome lockup", () => {
    const chrome = [
      "src/components/AppShell.tsx",
      "src/components/PublicProductHeader.tsx",
      "src/components/AuthShell.tsx",
      "src/components/LoadingScreen.tsx",
      "src/components/HelpCenterWidget.tsx",
      "src/pages/ReliabilityEngineerPage.tsx",
      "src/pages/RiaAssessmentWorkspacePage.tsx",
      "src/pages/Security.tsx",
      "src/pages/Privacy.tsx",
      "src/pages/Terms.tsx",
    ];
    for (const path of chrome) {
      const src = readFileSync(path, "utf8");
      expect(src, `${path} must use BrandWordmark`).toContain("BrandWordmark");
      expect(src, `${path} must not use the wifi-arc`).not.toMatch(
        /wifi-arc|300x300|wordmark-gold/i,
      );
    }

    const appShell = readFileSync("src/components/AppShell.tsx", "utf8");
    expect(appShell).not.toContain("SyncAI Platform");
    expect(appShell).toMatch(/BrandWordmark className="h-5"/);

    const help = readFileSync("src/components/HelpCenterWidget.tsx", "utf8");
    expect(help).not.toContain("SyncAI Help");

    const ria = readFileSync(
      "src/pages/RiaAssessmentWorkspacePage.tsx",
      "utf8",
    );
    expect(ria).not.toContain("SyncAI · Reliability Intelligence Assessment");

    const field = readFileSync("src/pages/FieldPage.tsx", "utf8");
    expect(field).not.toMatch(/<Zap[\s/>]/);
    expect(field).not.toMatch(/<Activity[\s/>]/);
    expect(field).not.toMatch(/dw-brand|S-tile/);
  });
});
