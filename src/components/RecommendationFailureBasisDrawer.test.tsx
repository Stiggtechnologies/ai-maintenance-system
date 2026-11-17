import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecommendationRow } from "../types/operating";
import { RecommendationFailureBasisDrawer } from "./RecommendationFailureBasisDrawer";

const getBasis = vi.fn();
const recordBasis = vi.fn();

vi.mock("../services/recommendationFailureBasisService", () => ({
  getRecommendationFailureBasis: (...args: unknown[]) => getBasis(...args),
  recordRecommendationFailureBasis: (...args: unknown[]) =>
    recordBasis(...args),
}));

const recommendation = {
  id: "rec-1",
  title: "Validate the startup seal mechanism",
  status: "pending",
} as RecommendationRow;

const workspace = {
  recommendationId: "rec-1",
  recommendationTitle: recommendation.title,
  kind: "risk_scenario",
  note: "The identified startup event is the governed current basis.",
  recordedBy: "user-1",
  recordedAt: "2026-10-05T12:00:00Z",
  valid: true,
  failureMode: null,
  riskScenario: {
    id: "risk-1",
    label: "Seal loss during startup",
    event: "A solids-heavy startup abrades the seal faces.",
    assetId: "asset-1",
    status: "identified",
  },
  eligibleFailureModes: [
    {
      id: "failure-1",
      label: "Seal face abrasion",
      assetId: "asset-1",
      functionalFailure: "Loss of containment",
    },
  ],
  eligibleRiskScenarios: [],
  boundary: "Classification only; no operational or approval authority.",
  operationalAuthorization: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  getBasis.mockResolvedValue(workspace);
  recordBasis.mockResolvedValue({ valid: true });
});

describe("RecommendationFailureBasisDrawer", () => {
  it("records an explicit not-applicable disposition without a subject id", async () => {
    render(
      <RecommendationFailureBasisDrawer
        rec={recommendation}
        canGovern
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("Seal loss during startup")).toBeVisible();
    expect(
      screen.getByText(/no operational or approval authority/i),
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText("Basis type"), {
      target: { value: "not_applicable" },
    });
    fireEvent.change(screen.getByLabelText("Engineering basis"), {
      target: {
        value:
          "This commercial recommendation is not driven by an asset failure.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record governed basis" }),
    );

    await waitFor(() =>
      expect(recordBasis).toHaveBeenCalledWith({
        recommendationId: "rec-1",
        kind: "not_applicable",
        subjectId: null,
        note: "This commercial recommendation is not driven by an asset failure.",
      }),
    );
    expect(getBasis).toHaveBeenCalledTimes(2);
  });

  it("keeps the governance editor hidden from a read-only viewer", async () => {
    render(
      <RecommendationFailureBasisDrawer
        rec={recommendation}
        canGovern={false}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("Seal loss during startup")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Record governed basis" }),
    ).not.toBeInTheDocument();
  });

  it("makes stale governed provenance explicit to the reviewer", async () => {
    getBasis.mockResolvedValueOnce({ ...workspace, valid: false });
    render(
      <RecommendationFailureBasisDrawer
        rec={recommendation}
        canGovern
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /basis is no longer current/i,
    );
  });
});
