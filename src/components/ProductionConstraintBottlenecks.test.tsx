import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { load, record, listAssets } = vi.hoisted(() => ({
  load: vi.fn(),
  record: vi.fn(),
  listAssets: vi.fn(),
}));

vi.mock("../services/productionConstraintService", () => ({
  loadProductionConstraintWorkspace: () => load(),
  recordProductionConstraintStudy: (...args: unknown[]) => record(...args),
  listConstraintAssets: (...args: unknown[]) => listAssets(...args),
}));

import { ProductionConstraintBottlenecks } from "./ProductionConstraintBottlenecks";

const study = {
  id: "study-1",
  title: "Week 12 crusher limit",
  siteId: "site-1",
  siteName: "North",
  horizonStart: "2026-11-01T00:00:00Z",
  horizonEnd: "2026-11-08T00:00:00Z",
  requiredQuantity: "50",
  unitOfMeasure: "t",
  basis: "Operations committed this tonne total for the week.",
  assessable: true,
  result: {
    assessable: true,
    reasons: [],
    method: "tightest_declared_limit",
    limitsAreAdditive: false,
    bottleneckKeys: ["crusher"],
    primaryKey: "crusher",
    availableQuantity: "40",
    headroom: "-10",
    binding: true,
    demonstratedOutput: "12",
    demonstratedRecordCount: 2,
    demonstratedOutputUsedAsCapacity: false,
    releasesWork: false,
    changesOperatingLimit: false,
    forecastsLoss: false,
  },
  supersedesStudyId: null,
  recordedBy: "user-1",
  recordedAt: "2026-11-01T12:00:00Z",
  constraints: [
    {
      id: "limit-1",
      key: "crusher",
      kind: "equipment",
      assetId: null,
      assetTag: null,
      constraintSignalId: null,
      availableQuantity: "40",
      unitOfMeasure: "t",
      basis: "The crusher crew stated the week limit from the current liner.",
      provenance: { stateConvertedToQuantity: false },
    },
  ],
};

describe("ProductionConstraintBottlenecks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAssets.mockResolvedValue([
      { id: "asset-1", name: "Primary crusher", assetTag: "CR-1" },
    ]);
    record.mockResolvedValue({
      recorded: true,
      idempotent: false,
      study: {
        ...study,
        assessable: false,
        result: {
          ...study.result,
          assessable: false,
          reasons: ["no_limits_declared"],
          primaryKey: null,
          binding: null,
        },
      },
    });
    load.mockResolvedValue({
      studies: [study],
      sites: [{ id: "site-1", name: "North" }],
      method:
        "The bottleneck is the lowest declared limit in the study unit. Declared limits are alternative ceilings and are not added together.",
      authority:
        "Recording a bottleneck does not release work, change an operating limit, adopt a production plan, or forecast loss.",
    });
  });

  it("shows the binding bottleneck and that recorded output is not capacity", async () => {
    render(<ProductionConstraintBottlenecks />);
    expect(
      await screen.findByRole("heading", {
        name: /production constraints and bottlenecks/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/bottleneck crusher/i)).toBeInTheDocument();
    expect(screen.getByText(/10 t short/i)).toBeInTheDocument();
    expect(screen.getByText(/not the capacity/i)).toBeInTheDocument();
    expect(screen.getByText(/are not added together/i)).toBeInTheDocument();
    expect(screen.getByText(/does not release work/i)).toBeInTheDocument();
  });

  it("records a study with text quantities and leaves an unknown limit blank", async () => {
    render(<ProductionConstraintBottlenecks />);
    await screen.findByRole("heading", { name: /production constraints/i });
    fireEvent.change(screen.getByLabelText("Study title"), {
      target: { value: "Week 13 feed limit" },
    });
    fireEvent.change(screen.getByLabelText("Site"), {
      target: { value: "site-1" },
    });
    fireEvent.change(screen.getByLabelText("Horizon start"), {
      target: { value: "2026-11-08T00:00" },
    });
    fireEvent.change(screen.getByLabelText("Horizon end"), {
      target: { value: "2026-11-15T00:00" },
    });
    fireEvent.change(screen.getByLabelText("Required quantity"), {
      target: { value: "80" },
    });
    fireEvent.change(screen.getByLabelText("Unit of measure"), {
      target: { value: "t" },
    });
    fireEvent.change(screen.getByLabelText("Evidence basis"), {
      target: {
        value: "Operations committed eighty tonnes for the following week.",
      },
    });
    fireEvent.change(screen.getByLabelText("Constraint key 1"), {
      target: { value: "feed" },
    });
    fireEvent.change(screen.getByLabelText("Available quantity 1"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Limit unit 1"), {
      target: { value: "t" },
    });
    fireEvent.change(screen.getByLabelText("Limit basis 1"), {
      target: {
        value: "The feed rate was not quantified in the operations note.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record constraint study" }),
    );

    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: "site-1",
        requiredQuantity: "80",
        unitOfMeasure: "t",
        limits: [
          expect.objectContaining({
            key: "feed",
            availableQuantity: null,
            unitOfMeasure: "t",
          }),
        ],
      }),
    );
    expect(await screen.findByText(/not assessable/i)).toBeInTheDocument();
  });

  it("keeps a short basis off the server", async () => {
    render(<ProductionConstraintBottlenecks />);
    await screen.findByLabelText("Study title");
    fireEvent.change(screen.getByLabelText("Study title"), {
      target: { value: "Week 13 feed limit" },
    });
    fireEvent.change(screen.getByLabelText("Site"), {
      target: { value: "site-1" },
    });
    fireEvent.change(screen.getByLabelText("Horizon start"), {
      target: { value: "2026-11-08T00:00" },
    });
    fireEvent.change(screen.getByLabelText("Horizon end"), {
      target: { value: "2026-11-15T00:00" },
    });
    fireEvent.change(screen.getByLabelText("Required quantity"), {
      target: { value: "80" },
    });
    fireEvent.change(screen.getByLabelText("Unit of measure"), {
      target: { value: "t" },
    });
    fireEvent.change(screen.getByLabelText("Evidence basis"), {
      target: { value: "Too short" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record constraint study" }),
    );
    expect(
      await screen.findByText(/evidence basis of at least 20 characters/i),
    ).toBeInTheDocument();
    expect(record).not.toHaveBeenCalled();
  });
});
