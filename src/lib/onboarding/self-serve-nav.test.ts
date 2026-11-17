import { describe, expect, it } from "vitest";
import { TALK_TO_US_HREF, selfServeNavLink } from "./self-serve-nav";

describe("self-serve onboarding nav", () => {
  it("keeps a person off the path until a Decision Case is saved", () => {
    const asking = selfServeNavLink({
      decisionCaseSaved: false,
      draftOpen: false,
      continueHref: "/?view=signup",
      continueLabel: "Save this Decision Case",
      askHref: "#inverted-ask",
    });
    expect(asking).toEqual({
      href: "#inverted-ask",
      label: "Ask your question",
      leavesProduct: false,
    });
    expect(asking.href).not.toBe(TALK_TO_US_HREF);

    const draft = selfServeNavLink({
      decisionCaseSaved: false,
      draftOpen: true,
      continueHref: "/?view=signup&returnTo=%2Fget-started",
      continueLabel: "Save this Decision Case",
      askHref: "#inverted-ask",
    });
    expect(draft.label).toBe("Save this Decision Case");
    expect(draft.href.startsWith("/")).toBe(true);
    expect(draft.leavesProduct).toBe(false);
    expect(draft.href).not.toContain("syncai.ca/contact");

    const saved = selfServeNavLink({
      decisionCaseSaved: true,
      draftOpen: true,
      continueHref: "/?view=signup",
      continueLabel: "Save this Decision Case",
      askHref: "#inverted-ask",
    });
    expect(saved).toEqual({
      href: TALK_TO_US_HREF,
      label: "Talk to us",
      leavesProduct: true,
    });
  });

  it("refuses an off-product href before the case is saved", () => {
    const link = selfServeNavLink({
      decisionCaseSaved: false,
      draftOpen: true,
      continueHref: "https://syncai.ca/contact",
      continueLabel: "Save this Decision Case",
      askHref: "/get-started",
    });
    expect(link.href).toBe("/get-started");
    expect(link.label).not.toMatch(/Discuss purchasing/);
    expect(link.leavesProduct).toBe(false);
  });
});
