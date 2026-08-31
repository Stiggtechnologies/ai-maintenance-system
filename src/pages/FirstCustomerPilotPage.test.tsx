import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FirstCustomerPilotPage } from "./FirstCustomerPilotPage";

describe("FirstCustomerPilotPage", () => {
  it("retires the 48-hour offer in favor of the Reliability Intelligence Assessment", () => {
    render(<FirstCustomerPilotPage />);
    expect(
      screen.getByText("Know what your maintenance data actually proves."),
    ).toBeTruthy();
    expect(
      screen.getByText(/former 48-hour value-proof offer has been retired/i),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /View the assessment/i }),
    ).toHaveAttribute("href", "https://syncai.ca/reliability-assessment");
    expect(
      screen.getByRole("link", { name: /Try Reliability Engineer/i }),
    ).toBeTruthy();
  });

  it("renders the retired-offer lede once, in normal flow, with a unitless line-height", () => {
    render(<FirstCustomerPilotPage />);

    const ledes = screen.getAllByTestId("assessment-hero-lede");
    expect(ledes).toHaveLength(1);

    const lede = ledes[0];
    expect(lede.tagName).toBe("P");
    expect(lede).toHaveClass("leading-[1.7]");
    expect(lede.className.split(/\s+/)).not.toContain("leading-8");
    expect(lede.className.split(/\s+/)).not.toContain("absolute");
    expect(lede.className.split(/\s+/)).not.toContain("fixed");

    const constraints = screen.getByTestId("assessment-hero-constraints");
    const cta = screen.getByTestId("assessment-hero-cta");
    expect(
      lede.compareDocumentPosition(constraints) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      constraints.compareDocumentPosition(cta) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(lede.parentElement?.contains(constraints)).toBe(true);
    expect(lede.parentElement?.contains(cta)).toBe(true);
  });
});
