import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_RIA_LEDE,
  FirstCustomerPilotPage,
} from "./FirstCustomerPilotPage";

describe("FirstCustomerPilotPage", () => {
  it("states the canonical Reliability Intelligence Assessment lede", () => {
    render(<FirstCustomerPilotPage />);
    expect(
      screen.getByText("Know what your maintenance data actually proves."),
    ).toBeTruthy();
    const lede = screen.getByTestId("assessment-hero-lede");
    expect(lede).toHaveTextContent(CANONICAL_RIA_LEDE);
    expect(lede.textContent).not.toMatch(/48-hour/i);
    expect(lede.textContent).not.toMatch(/US\$35,000/);
    const price = screen.getByTestId("assessment-hero-price");
    expect(price).toHaveTextContent(/US\$35,000/);
    expect(
      screen.getByText(/No software installation or production credentials/i),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /No unsupported ROI or engineering conclusion is presented as fact/i,
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /View the assessment/i }),
    ).toHaveAttribute("href", "https://syncai.ca/reliability-assessment");
    const tryEngineer = screen.getByRole("link", {
      name: /Try Reliability Engineer/i,
    });
    expect(tryEngineer).toHaveAttribute("href", "/workspace");
    expect(tryEngineer.getAttribute("href")).not.toMatch(/\/demo/);
  });

  it("does not advertise a /demo share link from the landing CTAs", () => {
    render(<FirstCustomerPilotPage />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/\/demo/);
    }
  });

  it("keeps the lede price-free and shows the canonical US$35,000 fee line", () => {
    const src = readFileSync("src/pages/FirstCustomerPilotPage.tsx", "utf8");
    expect(src).toContain(CANONICAL_RIA_LEDE);
    expect(CANONICAL_RIA_LEDE).not.toMatch(/48-hour/);
    expect(CANONICAL_RIA_LEDE).not.toMatch(/US\$35,000/);
    expect(src).not.toMatch(/48-hour/);
    expect(src).not.toMatch(/former 48-hour value-proof offer has been retired/);
    expect(src).toMatch(/data-testid="assessment-hero-price"/);
    expect(src).toMatch(/US\$35,000/);
  });

  it("renders the hero lede once, in normal flow, with a unitless line-height", () => {
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
