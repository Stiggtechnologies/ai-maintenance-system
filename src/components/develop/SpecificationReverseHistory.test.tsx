import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SpecificationReverseHistory } from "./SpecificationReverseHistory";

describe("SpecificationReverseHistory", () => {
  it("shows originating evidence even when the forward procurement thread refuses", () => {
    render(
      <SpecificationReverseHistory
        thread={{
          requirementRef: "R1",
          requirement: "Seal requirement",
          derivedFromFailureMode: "seal leakage",
          answered: false,
          refusal: "No awarded package",
          backward: [
            {
              failureMode: "seal leakage",
              occurrences: 3,
              assetsAffected: 2,
              requirementsReferencing: 1,
              loopClosed: true,
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByText(/seal leakage: 3 corrective work order/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not proof that the failure has been prevented/),
    ).toBeInTheDocument();
  });
  it("shows the missing-evidence explanation without inventing zero failures", () => {
    render(
      <SpecificationReverseHistory
        thread={{
          requirementRef: "R2",
          requirement: "Other requirement",
          derivedFromFailureMode: null,
          answered: false,
          backward: [],
          backwardNote: "No originating failure mode was recorded.",
        }}
      />,
    );
    expect(
      screen.getByText("No originating failure mode was recorded."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 corrective/)).not.toBeInTheDocument();
  });
});
