import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecommendationAssumptionsDrawer } from "./RecommendationAssumptionsDrawer";

const getPacket = vi.fn();
const recordPacket = vi.fn();

vi.mock("../services/recommendationAssumptionService", () => ({
  getRecommendationAssumptionPacket: () => getPacket(),
  recordRecommendationAssumptions: (input: unknown) => recordPacket(input),
}));

const rec = {
  id: "rec-1",
  organization_id: "org-1",
  asset_id: "asset-1",
  agent_id: null,
  title: "Investigate repeated seal failures",
  issue: "Five seal failures in nine months",
  action: "Validate the failure mechanism",
  impact: "Avoid repeated downtime",
  confidence: 78,
  urgency: "action",
  status: "pending",
  approval_required: "maintenance_manager",
  accountable: null,
  responsible: null,
  consulted: null,
  informed: null,
  financial_impact: null,
  risk_impact: "High",
  rationale: "Inspections and work history",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  getPacket.mockResolvedValue({
    recommendationId: "rec-1",
    recommendationTitle: rec.title,
    recommendationStatus: "pending",
    packet: null,
    recordedBy: null,
    recordedByName: null,
    recordedAt: null,
    valid: false,
    boundary:
      "Assumption assessment does not approve the recommendation, accept risk, release work or prove an outcome.",
    operationalAuthorization: false,
  });
  recordPacket.mockResolvedValue({
    recommendationId: "rec-1",
    disposition: "none_identified",
    packetSha256: "a".repeat(64),
    recordedBy: "user-1",
    recordedAt: "2026-10-02T00:00:00Z",
  });
});

describe("RecommendationAssumptionsDrawer", () => {
  it("shows that a blank is release-blocking and preserves the non-authorizing boundary", async () => {
    render(
      <RecommendationAssumptionsDrawer
        rec={rec}
        canGovern={false}
        onClose={() => undefined}
      />,
    );

    expect(
      await screen.findByText(/a blank does not mean no assumptions/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not approve the recommendation/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /record assumption assessment/i }),
    ).not.toBeInTheDocument();
  });

  it("requires a named none-identified basis rather than manufacturing an item", async () => {
    render(
      <RecommendationAssumptionsDrawer
        rec={rec}
        canGovern
        onClose={() => undefined}
      />,
    );

    await screen.findByText(/a blank does not mean no assumptions/i);
    fireEvent.click(
      screen.getByLabelText(/No material assumptions identified/i),
    );
    fireEvent.change(screen.getByLabelText("Overall assessment basis"), {
      target: {
        value:
          "The source history and decision scope were reviewed and no unstated premise remains material.",
      },
    });
    fireEvent.change(screen.getByLabelText("Review note"), {
      target: {
        value:
          "Reviewed against the stated evidence, scope and consequence model.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /record assumption assessment/i }),
    );

    await waitFor(() => expect(recordPacket).toHaveBeenCalledTimes(1));
    expect(recordPacket).toHaveBeenCalledWith({
      recommendationId: "rec-1",
      packet: {
        disposition: "none_identified",
        basis:
          "The source history and decision scope were reviewed and no unstated premise remains material.",
        items: [],
      },
      note: "Reviewed against the stated evidence, scope and consequence model.",
    });
  });

  it("renders every field of an existing assumption packet", async () => {
    getPacket.mockResolvedValue({
      recommendationId: "rec-1",
      recommendationTitle: rec.title,
      recommendationStatus: "pending",
      packet: {
        disposition: "recorded",
        basis:
          "This packet isolates the unverified operating premise that drives the recommendation.",
        items: [
          {
            statement:
              "Startup solids exposure is representative of the next operating period.",
            basis:
              "Failure timing clusters after startup but the historian is incomplete.",
            consequence_if_wrong:
              "The proposed inspection timing may miss the actual damaging condition.",
            validation_method:
              "Capture solids concentration and seal condition through ten startups.",
          },
        ],
      },
      recordedBy: "user-1",
      recordedByName: "Reliability Engineer",
      recordedAt: "2026-10-02T00:00:00Z",
      valid: true,
      boundary:
        "Assumption assessment does not approve the recommendation, accept risk, release work or prove an outcome.",
      operationalAuthorization: false,
    });

    render(
      <RecommendationAssumptionsDrawer
        rec={rec}
        canGovern={false}
        onClose={() => undefined}
      />,
    );

    expect(
      await screen.findByText(/Startup solids exposure is representative/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/historian is incomplete/i)).toBeInTheDocument();
    expect(screen.getByText(/ten startups/i)).toBeInTheDocument();
  });
});
