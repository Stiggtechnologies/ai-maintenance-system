import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
function luminance(hex: string) {
  return (hex.match(/[a-f\d]{2}/gi) ?? [])
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
    .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
}
describe("public decision record contrast", () => {
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
});
