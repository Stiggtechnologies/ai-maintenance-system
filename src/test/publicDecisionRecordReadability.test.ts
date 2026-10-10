import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
function luminance(hex: string) {
  return (hex.match(/[a-f\d]{2}/gi) ?? [])
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
    .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
}
describe("public decision record contrast", () => {
  it("uses explicit readable light warning and markdown pairs", () => {
    const page = readFileSync(
      "src/pages/DecisionCaseWorkspacePage.tsx",
      "utf8",
    );
    expect(page).toContain("bg-amber-50 p-3 text-sm text-amber-950");
    expect(
      (luminance("fffbeb") + 0.05) / (luminance("451a03") + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
    const css = readFileSync(
      "src/components/public-ask/public-ask.css",
      "utf8",
    );
    expect(css).toMatch(
      /\.bolt-public\s+\.dw-message-markdown\s+:is\(\s*p,\s*ul,\s*ol,\s*li,\s*blockquote,\s*td,\s*th,\s*strong,\s*em\s*\)\s*\{\s*color: #3a4048;/,
    );
    expect(
      (luminance("ffffff") + 0.05) / (luminance("3a4048") + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("sets a scoped readable foreground on the existing dark packet", () => {
    const css = readFileSync(
      "src/components/public-ask/public-ask.css",
      "utf8",
    );
    expect(css).toMatch(/\.bolt-public \.dw-packet\s*\{\s*color: #dce5ec;/);
    expect(css).toMatch(
      /\.bolt-public \.dw-packet strong\s*\{\s*color: #dce5ec;/,
    );
    const light = luminance("dce5ec"),
      dark = luminance("0b1015");
    expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps dark product example buttons readable", () => {
    const css = readFileSync(
      "src/components/public-ask/public-ask.css",
      "utf8",
    );
    expect(css).toMatch(
      /\.bolt-empty\.is-dark \.bolt-hero-capabilities button\s*\{\s*color: #e2e8ea;\s*background: #141d22;/,
    );
    expect(
      (luminance("e2e8ea") + 0.05) / (luminance("141d22") + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
