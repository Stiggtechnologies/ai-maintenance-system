/**
 * Reachability of request_standard_variance, decide_standard_variance and
 * accept_risk (six-argument form) from Standards & Site Authority.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GovernanceStandards } from "./GovernanceStandards";

const listSites = vi.fn();
const requestStandardVariance = vi.fn();
const decideStandardVariance = vi.fn();
const acceptRisk = vi.fn();
const rpc = vi.fn();
let role = "reliability_engineer";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

vi.mock("../services/reliabilityCallers", async () => {
  const actual = await vi.importActual<
    typeof import("../services/reliabilityCallers")
  >("../services/reliabilityCallers");
  return {
    ...actual,
    listSites: () => listSites(),
    requestStandardVariance: (...args: unknown[]) =>
      requestStandardVariance(...args),
    decideStandardVariance: (...args: unknown[]) =>
      decideStandardVariance(...args),
    acceptRisk: (...args: unknown[]) => acceptRisk(...args),
  };
});

const STANDARD = {
  id: "s1",
  standard_key: "isolation",
  title: "Isolation before intrusive work",
  requirement: "Isolate and prove dead before breaking containment.",
  mandatory: true,
  owner_role: "reliability_engineer",
  variance_approver_role: "reliability_engineer",
  status: "adopted",
  basis: "Seeded draft.",
  variances: [
    {
      id: "v1",
      site: "Mill A",
      status: "pending",
      justification: "Cannot isolate this header until the outage.",
      compensating_controls: "Double block and additional permit holder.",
      expires_at: "2027-01-01T00:00:00Z",
      decision_note: null,
    },
  ],
};

beforeEach(() => {
  role = "reliability_engineer";
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    data: {
      standards: [STANDARD],
      risk_acceptances: [],
      engineering_rules: [],
    },
    error: null,
  });
  listSites.mockResolvedValue([{ id: "site1", name: "Mill A" }]);
});

describe("GovernanceStandards write paths", () => {
  it("requests a variance through requestStandardVariance", async () => {
    requestStandardVariance.mockResolvedValue({
      variance_id: "v2",
      status: "pending",
      approver_role: "reliability_engineer",
    });
    render(<GovernanceStandards />);
    fireEvent.click(await screen.findByText("Request variance"));
    fireEvent.change(screen.getByLabelText("Variance site"), {
      target: { value: "site1" },
    });
    fireEvent.change(screen.getByLabelText("Variance justification"), {
      target: {
        value: "The site cannot meet the isolation standard this quarter.",
      },
    });
    fireEvent.change(screen.getByLabelText("Variance compensating controls"), {
      target: { value: "Additional permit holder and double isolation." },
    });
    fireEvent.change(screen.getByLabelText("Variance expiry"), {
      target: { value: "2027-06-01" },
    });
    fireEvent.click(screen.getByText("Submit request"));
    await waitFor(() =>
      expect(requestStandardVariance).toHaveBeenCalledWith({
        standardId: "s1",
        siteId: "site1",
        justification:
          "The site cannot meet the isolation standard this quarter.",
        compensatingControls: "Additional permit holder and double isolation.",
        expiresAt: new Date("2027-06-01").toISOString(),
      }),
    );
    expect(
      await screen.findByText(/A request is not a grant/),
    ).toBeInTheDocument();
  });

  it("decides a pending variance through decideStandardVariance", async () => {
    decideStandardVariance.mockResolvedValue({
      variance_id: "v1",
      status: "approved",
    });
    render(<GovernanceStandards />);
    fireEvent.click(await screen.findByText("Decide"));
    expect(screen.getByText("Approve variance")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Variance decision note"), {
      target: {
        value: "Compensating controls reviewed against the isolation standard.",
      },
    });
    fireEvent.click(screen.getByText("Approve variance"));
    await waitFor(() =>
      expect(decideStandardVariance).toHaveBeenCalledWith(
        "v1",
        true,
        "Compensating controls reviewed against the isolation standard.",
      ),
    );
  });

  it("records residual risk through acceptRisk and hides the act from ai_admin", async () => {
    acceptRisk.mockResolvedValue({
      acceptance_id: "ra1",
      expires_at: "2027-03-01T00:00:00Z",
      ceiling_checked: false,
    });
    render(<GovernanceStandards />);
    fireEvent.click(await screen.findByText("Accept residual risk"));
    fireEvent.change(screen.getByLabelText("Risk acceptance rationale"), {
      target: {
        value: "Residual leak risk is tolerable with weekly visual checks.",
      },
    });
    fireEvent.change(
      screen.getByLabelText("Risk acceptance compensating controls"),
      {
        target: {
          value: "Weekly visual plus vibration route on this class.",
        },
      },
    );
    fireEvent.change(screen.getByLabelText("Risk acceptance expiry"), {
      target: { value: "2027-03-01" },
    });
    fireEvent.click(screen.getByText("Record acceptance"));
    await waitFor(() =>
      expect(acceptRisk).toHaveBeenCalledWith({
        subjectType: "standard",
        subjectId: "s1",
        riskLevel: "Medium",
        rationale: "Residual leak risk is tolerable with weekly visual checks.",
        compensatingControls:
          "Weekly visual plus vibration route on this class.",
        expiresAt: new Date("2027-03-01").toISOString(),
      }),
    );
    expect(screen.getByTestId("governance-honesty")).toHaveTextContent(
      /not an approval of work/,
    );
  });

  it("hides accept-risk for the AI-operator identity", async () => {
    role = "ai_admin";
    render(<GovernanceStandards />);
    await screen.findByText("Isolation before intrusive work");
    expect(screen.queryByText("Accept residual risk")).not.toBeInTheDocument();
  });
});
