import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskCockpit } from "../types/risk";
import { RiskOperatingSystemPage } from "./RiskOperatingSystemPage";

const service = vi.hoisted(() => ({
  getRiskOperatingCockpit: vi.fn(),
  getRiskParticipants: vi.fn(),
  getRiskEnterpriseArchitecture: vi.fn(),
  getRiskDecisionOperations: vi.fn(),
}));
const operating = vi.hoisted(() => ({ getAssets: vi.fn() }));

vi.mock("../services/riskOperatingService", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../services/riskOperatingService")>();
  return {
    ...original,
    getRiskOperatingCockpit: service.getRiskOperatingCockpit,
    getRiskParticipants: service.getRiskParticipants,
    getRiskEnterpriseArchitecture: service.getRiskEnterpriseArchitecture,
    getRiskDecisionOperations: service.getRiskDecisionOperations,
  };
});
vi.mock("../services/operatingLoopService", () => ({
  getAssets: operating.getAssets,
}));
vi.mock("./RiskConsequence", () => ({
  RiskConsequence: () => <div>Asset risk signals</div>,
}));
vi.mock("../components/AssetInterdependency", () => ({
  AssetInterdependency: () => <div>Interdependency</div>,
}));
vi.mock("../components/ConfigurationControl", () => ({
  ConfigurationControl: () => <div>Configuration control</div>,
}));
vi.mock("../components/ProcessSafety", () => ({
  ProcessSafety: () => <div>Process safety</div>,
}));

const cockpit: RiskCockpit = {
  generated_at: "2026-08-22T00:00:00Z",
  risks: [],
  contexts: [
    {
      id: "context-1",
      parent_id: null,
      kind: "enterprise",
      name: "Enterprise risk context",
      mission: "Safe production",
      objectives: ["Safe production"],
      stakeholders: ["Operations"],
      regulations: ["Operating approval"],
      financial_constraints: [],
      safety_requirements: [],
      environmental_obligations: [],
      operating_limits: [],
      policies: [],
      dependencies: [],
      authority: { risk_owner_role: "reliability_engineer" },
      status: "adopted",
      review_date: null,
    },
  ],
  criteria: [
    {
      id: "criteria-1",
      context_id: "context-1",
      name: "Adopted criteria",
      industry_code: "mining",
      jurisdiction: "Alberta",
      version: 1,
      status: "adopted",
      dimensions: ["safety", "production"],
      likelihood_scale: [1, 2, 3, 4, 5],
      thresholds: { low: 20, medium: 40, high: 60, critical: 80 },
      decision_thresholds: { treat: 70, escalate: 85 },
      capacity: { capacity_limit: 100 },
      basis: "Approved test criteria",
      review_date: null,
    },
  ],
  maturity: null,
  framework_reviews: [],
  aggregate: {
    individual_exposure: 0,
    combined_exposure: 0,
    open_risks: 0,
    connections: 0,
    common_dependencies: [],
    capacity_limit: 100,
    committed_capacity: 0,
    capacity_remaining: 100,
    within_capacity: true,
    basis: "No open risks",
  },
  effectiveness: {
    effectiveness_index: null,
    risks_realized_despite_controls: 0,
    overdue_treatments: 0,
    repeated_control_failures: 0,
    overdue_risk_reviews: 0,
    decisions_overturned_or_treatments_failed: 0,
    accepted_risks_above_acceptance: 0,
    treatments_verified: 0,
    treatments_verified_effective: 0,
    treatment_effectiveness_rate: null,
    significant_decisions_total: 0,
    significant_decisions_with_risk_assessment: 0,
    emerging_risks_detected: 0,
    average_decision_cycle_hours: null,
    average_risk_to_action_cycle_hours: null,
    basis: "Insufficient evidence",
  },
  portfolio_breakdown: {
    value_at_risk_by_currency: [],
    risk_reduction_achieved: 0,
    accepted_risks: 0,
    by_site: [],
    by_objective: [],
  },
  authority_profiles: [],
  positioning:
    "Risk operating system aligned to ISO 31000; not a certification claim.",
};

describe("RiskOperatingSystemPage", () => {
  beforeEach(() => {
    service.getRiskOperatingCockpit.mockResolvedValue(cockpit);
    service.getRiskParticipants.mockResolvedValue([
      { id: "user-1", full_name: "Risk Owner", role: "admin" },
    ]);
    operating.getAssets.mockResolvedValue([]);
    service.getRiskEnterpriseArchitecture.mockResolvedValue({
      objectives: [],
      stakeholders: [],
      obligations: [],
      assumptions: [],
      sources: [],
      consequences: [],
      likelihood_estimates: [],
      event_scenarios: [],
      stress_tests: [],
      treatment_dependencies: [],
      challenges: [],
      assurance_reviews: [],
      communications: [],
      learning_transfers: [],
      reassessment_queue: [],
      expiring_controls: [],
      learning_events: [],
      integrations: [],
      agents: [],
    });
    service.getRiskDecisionOperations.mockResolvedValue({
      my_decisions: [],
      treatment_portfolio: [],
      emerging_risks: [],
      decision_history: [],
      board_evidence_pack: {
        open_challenges: 0,
        independent_assurance_completed: 0,
        reassessment_required: 0,
        temporary_controls_expiring: 0,
        learning_transfers_pending: 0,
      },
      culture_signals: [],
    });
  });

  it("renders the leadership operating loop and controlled positioning", async () => {
    render(<RiskOperatingSystemPage />);

    expect(
      await screen.findByRole("heading", { name: "Risk Operating System" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Not a certification claim")).toBeInTheDocument();
    expect(screen.getByText("Objective")).toBeInTheDocument();
    expect(screen.getByText("Learning")).toBeInTheDocument();
    expect(
      screen.getByText("Portfolio value and objective exposure"),
    ).toBeInTheDocument();
  });

  it("exposes governed context and criteria version actions", async () => {
    render(<RiskOperatingSystemPage />);
    await screen.findByRole("heading", { name: "Risk Operating System" });

    fireEvent.click(screen.getByRole("button", { name: "Context & criteria" }));
    expect(screen.getByText("Organizational context")).toBeInTheDocument();
    expect(screen.getByText("Twelve coordinated engines")).toBeInTheDocument();
    expect(screen.getAllByText("New version")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "+ Add context" }));
    expect(
      screen.getByRole("heading", { name: "Create governed context" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Context level")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Residual-risk acceptance role/),
    ).toBeInTheDocument();
  });

  it("records maturity as explicit evidence rather than inferred capability", async () => {
    render(<RiskOperatingSystemPage />);
    await screen.findByRole("heading", { name: "Risk Operating System" });

    fireEvent.click(
      screen.getByRole("button", { name: "Maturity & oversight" }),
    );
    expect(
      screen.getByText("Level 0–5 is never inferred from feature presence."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record assessment" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "Record evidence-based maturity",
        }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("integrated")).toBeInTheDocument();
    expect(screen.getByLabelText("record report")).toBeInTheDocument();
  });

  it("exposes dedicated decision operations and the complete enterprise architecture", async () => {
    render(<RiskOperatingSystemPage />);
    await screen.findByRole("heading", { name: "Risk Operating System" });

    fireEvent.click(
      screen.getByRole("button", { name: "Decision operations" }),
    );
    expect(
      await screen.findByRole("heading", { name: "My Decisions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Emerging Risk feed")).toBeInTheDocument();
    expect(screen.getByText("Decision history")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Enterprise architecture" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Enterprise risk architecture",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Add enterprise risk record"),
    ).toBeInTheDocument();
    expect(screen.getByText("Stress and reverse stress")).toBeInTheDocument();
  });
});
