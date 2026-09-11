import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Signup } from "./Signup";

vi.mock("../components/visual/OperationsLattice", () => ({
  OperationsLattice: () => null,
}));

describe("Signup industry selection", () => {
  it("uses the canonical catalog and captures a custom industry name", () => {
    render(<Signup onSuccess={vi.fn()} onTabChange={vi.fn()} />);

    const industry = screen.getByLabelText("Industry") as HTMLSelectElement;
    expect(industry.querySelectorAll("option")).toHaveLength(19);
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
