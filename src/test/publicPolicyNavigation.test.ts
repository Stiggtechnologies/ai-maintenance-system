import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("app policy navigation", () => {
  it.each(["privacy", "terms", "security"])(
    "routes %s to app content",
    (path) => {
      const app = readFileSync("src/App.tsx", "utf8");
      const name = path[0].toUpperCase() + path.slice(1);
      expect(app).toMatch(
        new RegExp(`path="/${path}"[\\s\\S]{0,170}<${name} onNavigate`),
      );
      expect(
        readFileSync("src/components/public-ask/PublicAskEmpty.tsx", "utf8"),
      ).toContain(`href="/${path}"`);
    },
  );
});
