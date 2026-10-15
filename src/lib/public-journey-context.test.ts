import { describe, expect, it } from "vitest";
import {
  publicDecisionJourneyPaths,
  publicJourneyParameters,
  publicJourneyPath,
  publicAuthJourneySearch,
} from "./public-journey-context";

describe("public acquisition context", () => {
  it("recovers only allowlisted context from a safe nested auth return", () => {
    const search = `?view=signup&returnTo=${encodeURIComponent("/workspace/cases/draft-1?industry=mining&utm_source=partner&token=private")}`;
    expect(
      publicJourneyPath(
        "/get-started",
        publicAuthJourneySearch(search, "https://app.syncai.ca"),
      ),
    ).toBe("/get-started?industry=mining&utm_source=partner");
  });

  it.each([
    "https://evil.invalid/?industry=mining",
    "//evil.invalid/?industry=mining",
    "/\\\\evil.invalid/?industry=mining",
  ])("rejects unsafe nested auth context %s", (returnTo) => {
    expect(
      publicAuthJourneySearch(
        `?returnTo=${encodeURIComponent(returnTo)}&source=outer`,
        "https://app.syncai.ca",
      ),
    ).toBe("source=outer");
  });
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

describe("decision journey header paths", () => {
  it("retains a committed browser case and bounded context without tokens", () => {
    const paths = publicDecisionJourneyPaths(
      "?case=draft-05214&view=evaluation&industry=mining&token=secret",
      "https://app.syncai.ca",
    );
    expect(paths.assistant).toBe(
      "/workspace/cases/draft-05214?industry=mining&origin=evaluation",
    );
    expect(paths.firstDecision).toContain("case=draft-05214");
    expect(paths.firstDecision).not.toContain("secret");
  });
  it("recovers a case from a validated sign-in return but refuses external handoffs", () => {
    const paths = publicDecisionJourneyPaths(
      "?returnTo=" +
        encodeURIComponent("/workspace/cases/draft-05214?industry=mining"),
      "https://app.syncai.ca",
    );
    expect(paths.firstDecision).toContain("case=draft-05214");
    expect(
      publicDecisionJourneyPaths(
        "?returnTo=" +
          encodeURIComponent("//evil.invalid/workspace/cases/draft-05214"),
        "https://app.syncai.ca",
      ).assistant,
    ).toBe("/workspace");
  });
});
