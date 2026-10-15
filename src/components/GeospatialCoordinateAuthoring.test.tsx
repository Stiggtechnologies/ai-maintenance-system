import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { GeospatialOperationalIntelligencePanel } from "./GeospatialOperationalIntelligencePanel";

const mocks = vi.hoisted(() => ({ load: vi.fn(), record: vi.fn() }));
vi.mock("../services/geospatialPanelData", () => ({
  loadGeospatialPanelData: mocks.load,
}));
vi.mock("../services/geospatialOperationalIntelligenceService", () => ({
  recordGeospatialFeature: mocks.record,
  recordGeospatialOperationalAssessment: vi.fn(),
  verifyGeospatialFeature: vi.fn(),
  verifyGeospatialOperationalAssessment: vi.fn(),
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({
    workspace: {
      features: [],
      assessments: [],
      basis: "Synthetic authoring test only.",
    },
    references: {
      assets: [],
      sites: [],
      evidence: [],
      recommendations: [],
      crews: [],
      materials: [],
    },
    context: {
      sources: [
        {
          id: "source-1",
          name: "Synthetic supplied geometry",
          class: "simulated_industrial",
          state: "simulated",
        },
      ],
    },
    incomplete: false,
  });
  mocks.record.mockResolvedValue({ feature_id: "draft-1", status: "draft" });
});

async function fill() {
  render(<GeospatialOperationalIntelligencePanel />);
  await screen.findByRole("option", { name: /Synthetic supplied geometry/ });
  fireEvent.change(screen.getByPlaceholderText("Stable feature key"), {
    target: { value: "survey-1" },
  });
  fireEvent.change(screen.getByPlaceholderText("Feature name"), {
    target: { value: "Supplied alignment" },
  });
  fireEvent.change(screen.getByPlaceholderText(/Source coordinates/), {
    target: { value: "[[-113.5,53.5],[-113.4,53.6]]" },
  });
  fireEvent.change(screen.getByLabelText("Governed Context source"), {
    target: { value: "source-1" },
  });
  fireEvent.change(screen.getByPlaceholderText("Source reference/version"), {
    target: { value: "synthetic-qualification-1" },
  });
  fireEvent.change(screen.getByLabelText("Observed at"), {
    target: { value: "2026-10-01T10:00" },
  });
  fireEvent.change(
    screen.getByPlaceholderText("Or explicitly name missing source evidence"),
    {
      target: {
        value: "Synthetic fixture: independent field survey unavailable.",
      },
    },
  );
}

function submit() {
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Record draft feature" })
      .closest("form")!,
  );
}

describe("SC-02 explicit coordinate authoring", () => {
  it.each([null, 0.25])(
    "shows coordinate provenance and accuracy %s before independent verification",
    async (accuracy) => {
      const original = await mocks.load();
      mocks.load.mockResolvedValue({
        ...original,
        workspace: {
          ...original.workspace,
          features: [
            {
              id: "draft-1",
              name: "Draft geometry for independent review",
              status: "draft",
              feature_type: "asset",
              source_system: "synthetic",
              source_reference: "source-version-1",
              coordinate_reference_system: "EPSG:4326",
              coordinate_axis_order: "longitude_latitude",
              coordinate_basis:
                "Synthetic source declares its encoding; independent suitability review is required.",
              horizontal_accuracy_m: accuracy,
            },
          ],
        },
      });
      render(<GeospatialOperationalIntelligencePanel />);
      const card = (
        await screen.findByText("Draft geometry for independent review")
      ).closest("article")!;
      expect(card).toHaveTextContent("EPSG:4326 · longitude latitude");
      expect(card).toHaveTextContent(
        "Synthetic source declares its encoding; independent suitability review is required.",
      );
      expect(card).toHaveTextContent(
        accuracy == null
          ? "Horizontal accuracy: unknown"
          : "0.25 metres (source supplied)",
      );
      expect(card).toHaveTextContent(
        "does not certify survey or engineering suitability",
      );
      expect(screen.getByRole("button", { name: "Verify" })).toBeVisible();
    },
  );

  it("does not default a coordinate system or invent accuracy", async () => {
    await fill();
    expect(screen.getByLabelText("Coordinate reference system")).toHaveValue(
      "",
    );
    expect(screen.getByLabelText("Source coordinate basis")).toHaveValue("");
    expect(screen.getByLabelText("Horizontal accuracy (metres)")).toHaveValue(
      null,
    );
    submit();
    await screen.findByRole("alert");
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it.each(["", "0.25"])(
    "passes declared CRS/basis and supplied accuracy %s into the canonical draft RPC",
    async (accuracy) => {
      await fill();
      fireEvent.change(screen.getByLabelText("Coordinate reference system"), {
        target: { value: "EPSG:4326" },
      });
      fireEvent.change(screen.getByLabelText("Source coordinate basis"), {
        target: {
          value:
            "Synthetic source explicitly declares longitude/latitude WGS84 encoding.",
        },
      });
      fireEvent.change(screen.getByLabelText("Horizontal accuracy (metres)"), {
        target: { value: accuracy },
      });
      submit();
      await waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          geometry: {
            type: "LineString",
            coordinates: [
              [-113.5, 53.5],
              [-113.4, 53.6],
            ],
          },
          coordinate: {
            referenceSystem: "EPSG:4326",
            axisOrder: "longitude_latitude",
            basis:
              "Synthetic source explicitly declares longitude/latitude WGS84 encoding.",
            horizontalAccuracyM: accuracy ? 0.25 : null,
          },
        }),
      );
    },
  );

  it.each(["zero accuracy", "out of bounds", "short basis"])(
    "refuses %s before any write",
    async (failure) => {
      await fill();
      fireEvent.change(screen.getByLabelText("Coordinate reference system"), {
        target: { value: "EPSG:4326" },
      });
      fireEvent.change(screen.getByLabelText("Source coordinate basis"), {
        target: {
          value:
            failure === "short basis"
              ? "guess"
              : "Synthetic source explicitly declares WGS84 longitude/latitude.",
        },
      });
      if (failure === "zero accuracy")
        fireEvent.change(
          screen.getByLabelText("Horizontal accuracy (metres)"),
          { target: { value: "0" } },
        );
      if (failure === "out of bounds")
        fireEvent.change(screen.getByPlaceholderText(/Source coordinates/), {
          target: { value: "[[181,53.5],[180,53.6]]" },
        });
      submit();
      await screen.findByRole("alert");
      expect(mocks.record).not.toHaveBeenCalled();
    },
  );
});
