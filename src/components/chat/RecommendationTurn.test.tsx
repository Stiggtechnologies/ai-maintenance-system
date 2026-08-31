import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecommendationTurn } from "./RecommendationTurn";
import type { DecisionApproval } from "../../lib/decision-case";

const approvals: DecisionApproval[] = [
  {
    id: "ap-1",
    initials: "MT",
    name: "M. Tran",
    role: "Reliability Engineer",
    responsibility: "scope",
    status: "reviewing",
  },
  {
    id: "ap-2",
    initials: "SK",
    name: "S. Khan",
    role: "Maintenance Manager",
    responsibility: "execution",
    status: "next",
  },
];

const props = {
  established: [
    {
      id: "e1",
      fact: "Five seal failures in nine months.",
      sourceTitle: "CMMS work history",
      record: "WO-1",
      lineage: "P-101",
      sourceSystem: "CMMS",
    },
  ],
  notProven: ["Startup solids are not measured."],
  recommendation: "Keep the monthly interval.",
  recommendationDetail: "Run a controlled evidence plan.",
  authorityName: "M. Tran",
  authorityRole: "Reliability Engineer",
  approvals,
  onDecide: vi.fn(),
};

describe("RecommendationTurn", () => {
  it("public demo labels the grant Simulate and keeps it in the same bubble", () => {
    render(
      <RecommendationTurn
        {...props}
        publicMode
        canDispose
        frozen={null}
      />,
    );
    expect(screen.getByText("Established")).toBeTruthy();
    expect(screen.getByText("Not proven")).toBeTruthy();
    expect(screen.getByText("Recommendation · not authorization")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Simulate" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Simulate" }));
    expect(props.onDecide).toHaveBeenCalledWith("approved");
  });

  it("disables disposition when the viewer is not the named authority", () => {
    render(
      <RecommendationTurn
        {...props}
        publicMode={false}
        canDispose={false}
        frozen={null}
      />,
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(
      screen.getByText("Waiting on M. Tran, Reliability Engineer"),
    ).toBeTruthy();
  });

  it("Delegate stays in-turn", () => {
    const onDecide = vi.fn();
    render(
      <RecommendationTurn
        {...props}
        onDecide={onDecide}
        publicMode
        canDispose
        frozen={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delegate" }));
    fireEvent.click(
      screen.getByRole("button", { name: "S. Khan, Maintenance Manager" }),
    );
    expect(onDecide).toHaveBeenCalledWith("delegated", {
      delegateName: "S. Khan",
    });
  });
});
