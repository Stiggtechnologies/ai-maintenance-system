import { describe, expect, it } from "vitest";
import {
  publicJourneyParameters,
  publicJourneyPath,
} from "./public-journey-context";

describe("public acquisition context", () => {
  it("preserves approved industry, attribution and standard UTM fields", () => {
    const path = publicJourneyPath(
      "/get-started",
      "?industry=mining&source=website&campaign=launch&utm_source=partner&utm_medium=referral&utm_campaign=launch&utm_term=maintenance&utm_content=hero&utm_id=42",
    );
    const params = new URL(path, "https://syncai.invalid").searchParams;
    expect(params.get("industry")).toBe("mining");
    expect(params.get("source")).toBe("website");
    expect(params.get("utm_source")).toBe("partner");
    expect(params.get("utm_id")).toBe("42");
    expect([...params.keys()]).toHaveLength(9);
  });

  it("drops tokens, arbitrary fields, case IDs and unsafe redirects", () => {
    const params = publicJourneyParameters(
      "?industry=manufacturing&token=secret&x-amzn-marketplace-token=secret&code=secret&email=private&returnTo=https://evil.invalid&case=tenant-case&view=signup",
    );
    expect(params.toString()).toBe("industry=manufacturing");
  });

  it("keeps a restored case industry authoritative and bounds tag values", () => {
    const params = publicJourneyParameters(
      `?industry=mining&source=${"x".repeat(200)}%00`,
      "manufacturing",
    );
    expect(params.get("industry")).toBe("manufacturing");
    expect(params.get("source")).toHaveLength(120);
  });

  it.each(["//evil.invalid", "https://evil.invalid", "/\\evil.invalid"])(
    "refuses external destination %s",
    (path) => expect(() => publicJourneyPath(path, "")).toThrow("local paths"),
  );
});
