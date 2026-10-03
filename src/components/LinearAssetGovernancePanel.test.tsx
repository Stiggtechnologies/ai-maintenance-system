import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listLinearAssetRoutes,
  listLinearRouteDefects,
  listOntologyAssets,
  listOntologyEvidence,
  recordLinearAssetRoute,
  recordLinearDefect,
  recordLinearSegment,
} from "../services/assetOntologyService";
import { LinearAssetGovernancePanel } from "./LinearAssetGovernancePanel";

vi.mock("../services/assetOntologyService", () => ({
  listLinearAssetRoutes: vi.fn(),
  listLinearRouteDefects: vi.fn(),
  listOntologyAssets: vi.fn(),
  listOntologyEvidence: vi.fn(),
  recordLinearAssetRoute: vi.fn(),
  recordLinearDefect: vi.fn(),
  recordLinearSegment: vi.fn(),
}));

const assetId = "11111111-1111-4111-8111-111111111111";
const evidenceId = "22222222-2222-4222-8222-222222222222";

describe("LinearAssetGovernancePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listOntologyAssets).mockResolvedValue([
      {
        id: assetId,
        name: "North transmission line",
        tag: "TL-07",
        asset_class: "Transmission",
        assignment: {
          class_key: "linear",
          basis: "Verified corridor register and route survey.",
          evidence_item_id: evidenceId,
          assigned_at: "2026-10-03T00:00:00Z",
        },
      },
    ]);
    vi.mocked(listLinearAssetRoutes).mockResolvedValue([
      {
        id: 17,
        asset_id: assetId,
        route_code: "TL-07-NORTH",
        measure_unit: "km",
        start_measure: 0,
        end_measure: 12,
        description: "North transmission corridor",
        basis: "Verified corridor register and route survey.",
        evidence_item_id: evidenceId,
      },
    ]);
    vi.mocked(listLinearRouteDefects).mockResolvedValue([
      {
        atMeasure: 3.4,
        defectType: "coating loss",
        severity: "moderate",
        repairedAt: null,
      },
    ]);
    vi.mocked(listOntologyEvidence).mockResolvedValue([
      {
        id: evidenceId,
        asset_id: assetId,
        description: "Qualified route survey and asset register",
        evidence_class: "MEASURED",
        source_system: "survey-control",
        ts: "2026-10-03T00:00:00Z",
      },
    ]);
    vi.mocked(recordLinearAssetRoute).mockResolvedValue({ status: "recorded" });
    vi.mocked(recordLinearSegment).mockResolvedValue({ status: "recorded" });
    vi.mocked(recordLinearDefect).mockResolvedValue({ status: "recorded" });
  });

  it("records a verified-evidence route for an already governed linear asset", async () => {
    const onRecorded = vi.fn();
    render(
      <LinearAssetGovernancePanel revision={0} onRecorded={onRecorded} />,
    );

    fireEvent.change(await screen.findByLabelText("Governed linear asset"), {
      target: { value: assetId },
    });
    fireEvent.change(screen.getByLabelText("Route code"), {
      target: { value: "PIPE-07-NORTH" },
    });
    fireEvent.change(screen.getByLabelText("End measure"), {
      target: { value: "42.5" },
    });
    fireEvent.change(screen.getByLabelText("Route description"), {
      target: { value: "North process-water pipeline corridor" },
    });
    fireEvent.change(screen.getByLabelText("Extent basis and limitations"), {
      target: {
        value:
          "Verified alignment sheet and survey establish the endpoints; field coordinate reconciliation remains open.",
      },
    });
    fireEvent.change(
      await screen.findByLabelText("Verified canonical evidence"),
      { target: { value: evidenceId } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Record governed route" }),
    );

    await waitFor(() =>
      expect(recordLinearAssetRoute).toHaveBeenCalledWith({
        assetId,
        routeCode: "PIPE-07-NORTH",
        measureUnit: "km",
        startMeasure: 0,
        endMeasure: 42.5,
        description: "North process-water pipeline corridor",
        basis:
          "Verified alignment sheet and survey establish the endpoints; field coordinate reconciliation remains open.",
        evidenceItemId: evidenceId,
      }),
    );
    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
    expect(
      screen.getByText(/engineering and operating determinations remain separate/i),
    ).toBeInTheDocument();
  });

  it("captures a located observation without claiming fitness for service", async () => {
    render(<LinearAssetGovernancePanel revision={0} onRecorded={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("tab", { name: "Record defect" }),
    );
    fireEvent.change(screen.getByLabelText("Canonical route"), {
      target: { value: "17" },
    });
    fireEvent.change(screen.getByLabelText("Defect location"), {
      target: { value: "3.4" },
    });
    fireEvent.change(screen.getByLabelText("Observed defect type"), {
      target: { value: "coating loss" },
    });
    fireEvent.change(screen.getByLabelText("Human-classified severity"), {
      target: { value: "moderate" },
    });
    fireEvent.change(screen.getByLabelText("Detection method"), {
      target: { value: "qualified patrol inspection" },
    });
    fireEvent.change(
      await screen.findByLabelText("Verified canonical evidence"),
      { target: { value: evidenceId } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Record observed defect" }),
    );

    await waitFor(() =>
      expect(recordLinearDefect).toHaveBeenCalledWith({
        routeId: 17,
        atMeasure: 3.4,
        defectType: "coating loss",
        severity: "moderate",
        detectionMethod: "qualified patrol inspection",
        detectedAt: "",
        evidenceItemId: evidenceId,
      }),
    );
    expect(
      screen.getByText(/has not determined fitness for service/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/route length is location, not exposure by itself/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Defect density along TL-07-NORTH" }),
    ).toBeInTheDocument();
  });
});
