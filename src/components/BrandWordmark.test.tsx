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
    // PNG color type 6 = RGBA. The header slot must not ship a black plate.
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

  it("is the header mark in AppShell and Decision Workspace chrome", () => {
    const appShell = readFileSync("src/components/AppShell.tsx", "utf8");
    const publicHeader = readFileSync(
      "src/components/PublicProductHeader.tsx",
      "utf8",
    );
    expect(appShell).toContain("BrandWordmark");
    expect(publicHeader).toContain("BrandWordmark");
    expect(appShell).not.toMatch(/<Zap /);
    expect(publicHeader).not.toMatch(/<Activity /);
    // #311 empty-first-paint: Sign in stays a header prop, not always-on.
    expect(publicHeader).toMatch(/showSignIn/);
  });
});
