import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafetyObligationRegister } from "./SafetyObligationRegister";

const getRegister = vi.fn();
const saveObligation = vi.fn();

vi.mock("../services/safetyObligationService", () => ({
  getSafetyObligationRegister: (...args: unknown[]) => getRegister(...args),
  saveSafetyCriticalObligation: (...args: unknown[]) => saveObligation(...args),
}));

const workspace = {
  elements: [
    {
      id: 11,
      ref: "SCE-11",
      label: "High-pressure shutdown",
      barrier_kind: "instrumented",
      barrier_role: "preventive",
      performance_standard: "Trip on verified high pressure.",
      asset_id: "asset-1",
      asset_name: "Feed pump",
    },
  ],
  requirements: [
    {
      id: 22,
      ref: "REG-22",
      regulator: "Energy Regulator",
      jurisdiction: "Alberta",
      instrument: "Operating approval",
      permit_type: "Operating authorization",
      description: "Maintain the named safety-critical barrier.",
      status: "active",
      case_id: "case-1",
      case_title: "Regulatory applicability case",
    },
  ],
  links: [],
  evidence: [
    {
      id: "evidence-verified",
      description: "Approved permit schedule",
      verification_status: "verified",
    },
    {
      id: "evidence-unverified",
      description: "Unreviewed field note",
      verification_status: "unverified",
    },
  ],
  authority_boundary:
    "This register records applicability only; it does not authorize work.",
};

beforeEach(() => {
  vi.clearAllMocks();
  getRegister.mockResolvedValue(workspace);
  saveObligation.mockResolvedValue({ status: "saved" });
});

describe("SafetyObligationRegister", () => {
  it("records an explicit evidence gap without changing authority", async () => {
    render(<SafetyObligationRegister />);

    expect(await screen.findByText(workspace.authority_boundary)).toBeVisible();
    expect(screen.getByText(/Absence is not treated as proof/)).toBeVisible();
    expect(screen.getByText(/Approved permit schedule/)).toBeVisible();
    expect(screen.queryByText(/Unreviewed field note/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Safety-critical element"), {
      target: { value: "11" },
    });
    fireEvent.change(screen.getByLabelText("Regulatory requirement"), {
      target: { value: "22" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Substantive applicability basis"),
      {
        target: {
          value:
            "Applicability remains open until the current equipment schedule is reconciled.",
        },
      },
    );
    fireEvent.change(
      screen.getByPlaceholderText("Missing evidence; separate with semicolons"),
      {
        target: {
          value: "Current equipment schedule; Regulator cross-reference",
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save applicability" }));

    await waitFor(() =>
      expect(saveObligation).toHaveBeenCalledWith({
        sceId: 11,
        requirementId: 22,
        applicabilityStatus: "undetermined",
        basis:
          "Applicability remains open until the current equipment schedule is reconciled.",
        evidenceItemIds: [],
        missingEvidence: [
          "Current equipment schedule",
          "Regulator cross-reference",
        ],
      }),
    );
    expect(
      await screen.findByText(
        "Applicability saved without changing regulatory or operational authority.",
      ),
    ).toBeVisible();
  });
});
