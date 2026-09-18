import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MissionOutcomeModels } from "./MissionOutcomeModels";

const getWorkspace = vi.fn();
const author = vi.fn();
const decide = vi.fn();
vi.mock("../services/missionOutcomeModels", () => ({
  getMissionOutcomeWorkspace: () => getWorkspace(),
  authorMissionOutcomeModel: (value: unknown) => author(value),
  decideMissionOutcomeModel: (...values: unknown[]) => decide(...values),
}));

const template = {
  organizationType: "mining",
  title: "Mining production outcomes",
  missionPattern:
    "Deliver safe, responsible and predictable mineral production while protecting people and environment.",
  outcomes: [
    { code: "safe_production", name: "Safe production" },
    { code: "throughput", name: "Throughput" },
  ],
  measures: [
    { code: "lost_tonnes", name: "Lost tonnes" },
    { code: "availability", name: "Availability" },
  ],
  consequenceDimensions: ["worker_safety", "environment", "production"],
  evidenceRequirements: ["production reconciliation", "safety events"],
  limitations: "Site operating limits remain authoritative.",
  version: 1,
};

const workspace = {
  templates: [template],
  callerRole: "admin",
  canApprove: true,
  control:
    "Only the latest independently adopted tenant model is effective. Templates are starting points.",
  models: [
    {
      id: "model-1",
      organizationType: "mining",
      templateVersion: 1,
      title: "Mine mission model",
      missionStatement:
        "Deliver safe and predictable production within approved operating limits.",
      outcomes: template.outcomes,
      measures: template.measures,
      consequenceDimensions: template.consequenceDimensions,
      evidenceRequirements: template.evidenceRequirements,
      evidenceBasis: "Board strategy and approved annual operating plan.",
      applicabilityNotes: "Applies to the mine and processing facilities this year.",
      status: "draft",
      version: 1,
      createdBy: "engineer@example.com",
      createdAt: "2026-09-12",
      approvalId: "approval-1",
      approvalStatus: "required",
      adoptedBy: null,
      adoptedAt: null,
      decisionNote: null,
      isOwnDraft: false,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue(workspace);
  author.mockResolvedValue({ status: "draft" });
  decide.mockResolvedValue({ status: "adopted" });
});

describe("MissionOutcomeModels", () => {
  it("previews a governed organization template and submits evidence", async () => {
    render(<MissionOutcomeModels />);
    await screen.findByText(/Mine mission model/);
    expect(screen.getByText(/Template defaults are not authority/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Organization type"), {
      target: { value: "mining" },
    });
    expect(screen.getByText("Safe production · Throughput")).toBeInTheDocument();
    expect(screen.getByText(/Site operating limits remain authoritative/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Evidence basis"), {
      target: { value: "Board strategy and approved annual operating plan." },
    });
    fireEvent.change(screen.getByLabelText("Applicability and limitations"), {
      target: {
        value: "Applies to the mine and processing facilities this year.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit for independent adoption" }),
    );
    await waitFor(() =>
      expect(author).toHaveBeenCalledWith(
        expect.objectContaining({
          template: expect.objectContaining({ organizationType: "mining" }),
          evidenceBasis: "Board strategy and approved annual operating plan.",
        }),
      ),
    );
  });

  it("supports an independent human adoption decision", async () => {
    render(<MissionOutcomeModels />);
    await screen.findByText(/Mine mission model/);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.change(screen.getByLabelText("Decision basis for version 1"), {
      target: {
        value: "Confirmed against the board strategy and current service obligations.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adopt" }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(
        "model-1",
        "approved",
        "Confirmed against the board strategy and current service obligations.",
      ),
    );
  });
});
