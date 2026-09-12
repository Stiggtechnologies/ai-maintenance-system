import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SIGNUP_INDUSTRY_OPTIONS } from "../lib/industry-catalog";
import { Signup } from "./Signup";

vi.mock("../components/visual/OperationsLattice", () => ({
  OperationsLattice: () => null,
}));

describe("Signup industry selection", () => {
  it("uses the canonical catalog and captures a custom industry name", () => {
    render(<Signup onSuccess={vi.fn()} onTabChange={vi.fn()} />);

    const industry = screen.getByLabelText("Industry") as HTMLSelectElement;
    // One unselected placeholder plus every governed catalog option. Keeping
    // this derived prevents a newly shipped pack from being rejected by an
    // unrelated stale cardinality assertion.
    expect(industry.querySelectorAll("option")).toHaveLength(
      SIGNUP_INDUSTRY_OPTIONS.length + 1,
    );
    expect(
      screen.getByRole("option", { name: "Oil Sands" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Buildings & Infrastructure" }),
    ).toBeInTheDocument();

    fireEvent.change(industry, { target: { value: "custom" } });
    expect(screen.getByLabelText("Industry name")).toBeRequired();
  });
});
