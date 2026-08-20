import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FirstCustomerPilotPage } from "./FirstCustomerPilotPage";

describe("FirstCustomerPilotPage", () => {
  it("retires the 48-hour offer in favor of the Reliability Intelligence Assessment", () => {
    render(<FirstCustomerPilotPage />);
    expect(screen.getByText("Know what your maintenance data actually proves.")).toBeTruthy();
    expect(screen.getByText(/former 48-hour value-proof offer has been retired/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /View the assessment/i })).toHaveAttribute("href", "https://syncai.ca/reliability-assessment");
    expect(screen.getByRole("link", { name: /Try Reliability Engineer/i })).toBeTruthy();
  });
});
