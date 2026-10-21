import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReferenceHierarchyPlanPanel } from "./ReferenceHierarchyPlanPanel";

describe("ReferenceHierarchyPlanPanel", () => {
  it("offers only the area first and fills the form without proposing anything", () => {
    const onUseStep = vi.fn();
    render(<ReferenceHierarchyPlanPanel existing={[]} onUseStep={onUseStep} />);
    const list = screen.getByRole("list", { name: "Reference hierarchy steps" });
    const buttons = within(list).getAllByRole("button", { name: "Use this step" });
    expect(buttons.filter((b) => !(b as HTMLButtonElement).disabled)).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onUseStep).toHaveBeenCalledWith(expect.objectContaining({ kind: "area", code: "DH1" }), null);
    expect(screen.getByText(/nothing is\s+created automatically/)).toBeTruthy();
  });

  it("passes the verified parent id for a ready system step", () => {
    const onUseStep = vi.fn();
    render(
      <ReferenceHierarchyPlanPanel
        existing={[{ id: "loc-area", code: "DH1", status: "verified" }]}
        onUseStep={onUseStep}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Use this step" }).find((b) => !(b as HTMLButtonElement).disabled)!);
    expect(onUseStep).toHaveBeenCalledWith(expect.objectContaining({ kind: "system" }), "loc-area");
  });

  it("shows an error for an invalid area code instead of a plan", () => {
    render(<ReferenceHierarchyPlanPanel existing={[]} onUseStep={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Area code"), { target: { value: "bad code!" } });
    expect(screen.getByRole("alert").textContent).toMatch(/Area code/);
  });
});
