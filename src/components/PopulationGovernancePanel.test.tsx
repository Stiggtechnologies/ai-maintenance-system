import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listAssetPopulations,
  listPopulationEvidence,
  listPopulationFailureEvents,
  listPopulationObservationPeriods,
  listPopulationSites,
  recordAssetPopulation,
  recordPopulationFailureEvent,
  recordPopulationObservationPeriod,
} from "../services/assetOntologyService";
import { PopulationGovernancePanel } from "./PopulationGovernancePanel";

vi.mock("../services/assetOntologyService", () => ({
  listAssetPopulations: vi.fn(),
  listPopulationEvidence: vi.fn(),
  listPopulationFailureEvents: vi.fn(),
  listPopulationObservationPeriods: vi.fn(),
  listPopulationSites: vi.fn(),
  recordAssetPopulation: vi.fn(),
  recordPopulationFailureEvent: vi.fn(),
  recordPopulationObservationPeriod: vi.fn(),
}));

const siteId = "11111111-1111-4111-8111-111111111111";
const evidenceId = "22222222-2222-4222-8222-222222222222";

describe("PopulationGovernancePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listPopulationSites).mockResolvedValue([
      { id: siteId, name: "North utility district" },
    ]);
    vi.mocked(listPopulationEvidence).mockResolvedValue([
      {
        id: evidenceId,
        asset_id: null,
        description: "Verified population register and event extract",
        evidence_class: "DOCUMENTED",
        source_system: "distribution-register",
        ts: "2026-10-03T00:00:00Z",
      },
    ]);
    vi.mocked(listAssetPopulations).mockResolvedValue([
      {
        id: 44,
        site_id: siteId,
        population_code: "POLES-NORTH-01",
        description: "North pole-top transformer population",
        unit_count: 100,
        members_individually_tracked: false,
        install_period_start: "2020-01-01",
        install_period_end: "2022-12-31",
        basis: "Verified population register; individual identity incomplete.",
        evidence_item_id: evidenceId,
      },
    ]);
    vi.mocked(listPopulationObservationPeriods).mockResolvedValue([
      {
        id: 55,
        population_id: 44,
        observed_from: "2025-01-01T00:00:00.000Z",
        observed_to: "2026-01-01T06:00:00.000Z",
        units_exposed: 100,
        basis: "Verified annual exposure extract with stable membership.",
        evidence_item_id: evidenceId,
      },
    ]);
    vi.mocked(listPopulationFailureEvents).mockResolvedValue([
      {
        id: 66,
        population_id: 44,
        observation_period_id: 55,
        occurred_at: "2025-06-01T00:00:00.000Z",
        failure_count: 5,
        failure_mode: "loss of supply",
        note: "Five aggregate events after duplicate removal.",
        evidence_item_id: evidenceId,
      },
    ]);
    vi.mocked(recordAssetPopulation).mockResolvedValue({ status: "recorded" });
    vi.mocked(recordPopulationObservationPeriod).mockResolvedValue({
      status: "recorded",
    });
    vi.mocked(recordPopulationFailureEvent).mockResolvedValue({
      status: "recorded",
    });
  });

  it("records an aggregate population from verified non-asset evidence", async () => {
    const onRecorded = vi.fn();
    render(<PopulationGovernancePanel revision={0} onRecorded={onRecorded} />);

    fireEvent.change(await screen.findByLabelText("Site (optional)"), {
      target: { value: siteId },
    });
    fireEvent.change(screen.getByLabelText("Population code"), {
      target: { value: "METERS-NORTH-01" },
    });
    fireEvent.change(screen.getByLabelText("Population description"), {
      target: { value: "North advanced-meter population" },
    });
    fireEvent.change(screen.getByLabelText("Current recorded unit count"), {
      target: { value: "2500" },
    });
    fireEvent.change(
      screen.getByLabelText("Population basis and limitations"),
      {
        target: {
          value:
            "Verified register extract establishes the current count; individual identities are not retained.",
        },
      },
    );
    fireEvent.change(screen.getByLabelText("Verified population evidence"), {
      target: { value: evidenceId },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record governed population" }),
    );

    await waitFor(() =>
      expect(recordAssetPopulation).toHaveBeenCalledWith({
        siteId,
        populationCode: "METERS-NORTH-01",
        description: "North advanced-meter population",
        unitCount: 2500,
        membersIndividuallyTracked: false,
        installPeriodStart: null,
        installPeriodEnd: null,
        basis:
          "Verified register extract establishes the current count; individual identities are not retained.",
        evidenceItemId: evidenceId,
      }),
    );
    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
    expect(
      screen.getByText(/exposure and failures remain separate/i),
    ).toBeInTheDocument();
  });

  it("calculates a unit-year rate and records only failures inside its denominator window", async () => {
    render(<PopulationGovernancePanel revision={0} onRecorded={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("tab", { name: "Record failure" }),
    );
    fireEvent.change(screen.getByLabelText("Canonical population"), {
      target: { value: "44" },
    });
    expect(await screen.findByText(/0\.0500 per unit-year/i)).toBeInTheDocument();
    expect(
      screen.getByText(/individual-asset MTBF is not available/i),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Observation period"), {
      target: { value: "55" },
    });
    fireEvent.change(screen.getByLabelText("Failure occurred at"), {
      target: { value: "2025-06-01T12:00" },
    });
    fireEvent.change(screen.getByLabelText("Aggregate failure count"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Observed failure mode"), {
      target: { value: "loss of supply" },
    });
    fireEvent.change(screen.getByLabelText("Observation and limitations"), {
      target: {
        value:
          "Two aggregate events after duplicate removal; individual member identity is unavailable.",
      },
    });
    fireEvent.change(screen.getByLabelText("Verified population evidence"), {
      target: { value: evidenceId },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record aggregate failure" }),
    );

    await waitFor(() =>
      expect(recordPopulationFailureEvent).toHaveBeenCalledWith({
        populationId: 44,
        observationPeriodId: 55,
        occurredAt: "2025-06-01T12:00",
        failureCount: 2,
        failureMode: "loss of supply",
        note:
          "Two aggregate events after duplicate removal; individual member identity is unavailable.",
        evidenceItemId: evidenceId,
      }),
    );
    expect(
      screen.getByText(/without inventing individual member identity/i),
    ).toBeInTheDocument();
  });
});
