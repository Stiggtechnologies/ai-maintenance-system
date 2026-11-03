import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataLineagePanel } from "./DataLineagePanel";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const stockId = "11111111-1111-4111-8111-111111111111";
const siteId = "22222222-2222-4222-8222-222222222222";
const edgeId = "33333333-3333-4333-8333-333333333333";

const boundary = {
  writesSourceSystem: false,
  changesCanonicalValues: false,
  authorizesWork: false,
};

const emptyRegister = { edges: [], ...boundary };

function edge(overrides: Record<string, unknown> = {}) {
  return {
    id: edgeId,
    domainId: 12,
    relationship: "sourced_from",
    subjectClass: "material_stock",
    subjectId: stockId,
    sourceSystem: "sap_s4_material_stock",
    sourceObject: "MaterialStock",
    sourceKey: "1000:0001:MAT-1",
    transformation: "Loaded from the reviewed mapping.",
    observedAt: "2026-01-01T00:00:00Z",
    parentEdgeId: null,
    supersedesEdgeId: null,
    createdAt: "2026-01-02T00:00:00Z",
    current: true,
    ...overrides,
  };
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) => {
    if (name === "get_data_lineage_register") {
      return { data: emptyRegister, error: null };
    }
    return { data: null, error: { message: `unexpected ${name}` } };
  });
});

async function fillAttestation() {
  fireEvent.change(screen.getByLabelText("Data domain id"), {
    target: { value: "12" },
  });
  fireEvent.change(screen.getByLabelText("Canonical subject id"), {
    target: { value: stockId },
  });
  fireEvent.change(screen.getByLabelText("Source system"), {
    target: { value: "cmms" },
  });
  fireEvent.change(screen.getByLabelText("Source object"), {
    target: { value: "Equipment" },
  });
  fireEvent.change(screen.getByLabelText("Source key"), {
    target: { value: "EQ-100" },
  });
  fireEvent.change(screen.getByLabelText("Observation time"), {
    target: { value: "2026-01-01T00:00:00Z" },
  });
  fireEvent.change(screen.getByLabelText("Transformation"), {
    target: {
      value: "The equipment record was loaded as this canonical asset.",
    },
  });
  fireEvent.change(screen.getByLabelText("Lineage basis"), {
    target: {
      value: "Named human compared the source key with the asset tag.",
    },
  });
  fireEvent.change(screen.getByLabelText("Lineage evidence reference"), {
    target: { value: "WO-14" },
  });
}

describe("DataLineagePanel", () => {
  it("loads the register and records an edge without contacting a source system", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_data_lineage_register") {
        return { data: emptyRegister, error: null };
      }
      if (name === "record_data_lineage_edge") {
        return {
          data: { edgeId, status: "recorded", ...boundary },
          error: null,
        };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    });
    render(<DataLineagePanel />);
    expect(
      await screen.findByText(/No lineage edges are recorded/),
    ).toBeVisible();
    await fillAttestation();
    fireEvent.click(
      screen.getByRole("button", { name: "Record lineage edge" }),
    );
    expect(
      await screen.findByText(/No source system was contacted/),
    ).toBeVisible();
    const recordCall = rpc.mock.calls.find(
      (call) => call[0] === "record_data_lineage_edge",
    );
    expect(recordCall?.[1]).toMatchObject({
      p_domain_id: 12,
      p_relationship: "sourced_from",
      p_subject_class: "asset",
      p_subject_id: stockId,
      p_source_system: "cmms",
      p_parent_edge_id: null,
      p_connector_id: null,
    });
  });

  it("refuses a raw SAP payload before any write", async () => {
    render(<DataLineagePanel />);
    await screen.findByText(/No lineage edges are recorded/);
    await fillAttestation();
    fireEvent.change(screen.getByLabelText("Reviewed SAP stock mapping"), {
      target: {
        value: JSON.stringify({ Material: "MAT-1", Plant: "1000" }),
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Prefill from reviewed SAP mapping" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /does not call SAP/,
    );
    expect(
      rpc.mock.calls.some((call) => call[0] === "record_data_lineage_edge"),
    ).toBe(false);
  });

  it("prefills from a reviewed mapping and shows a read gap without inventing the subject", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_data_lineage_register") {
        return { data: emptyRegister, error: null };
      }
      if (name === "get_data_lineage") {
        return {
          data: {
            subjectClass: "material_stock",
            subjectId: stockId,
            subjectPresent: false,
            currentEdges: [],
            history: [],
            ancestors: [],
            gaps: ["canonical subject is not in this tenant"],
            truncated: false,
            ...boundary,
          },
          error: null,
        };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    });
    render(<DataLineagePanel />);
    await screen.findByText(/No lineage edges are recorded/);
    fireEvent.change(screen.getByLabelText("Data domain id"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Canonical subject class"), {
      target: { value: "material_stock" },
    });
    fireEvent.change(screen.getByLabelText("Canonical subject id"), {
      target: { value: stockId },
    });
    fireEvent.change(screen.getByLabelText("Lineage basis"), {
      target: { value: "The stock row was loaded from this reviewed mapping." },
    });
    fireEvent.change(screen.getByLabelText("Lineage evidence reference"), {
      target: { value: "MAP-1" },
    });
    fireEvent.change(screen.getByLabelText("Reviewed SAP stock mapping"), {
      target: {
        value: JSON.stringify({
          external_id: "1000:0001:MAT-1",
          material_code: "MAT-1",
          unit_of_measure: "EA",
          qty_on_hand: 4,
          site_id: siteId,
          observed_at: "2026-01-01T00:00:00Z",
        }),
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Prefill from reviewed SAP mapping" }),
    );
    expect(
      await screen.findByDisplayValue("sap_s4_material_stock"),
    ).toBeVisible();
    expect(screen.getByLabelText("Source key")).toHaveValue("1000:0001:MAT-1");
    fireEvent.click(screen.getByRole("button", { name: "Read lineage chain" }));
    expect(
      await screen.findByText("Canonical subject is not in this tenant."),
    ).toBeVisible();
    expect(
      screen.getByText("canonical subject is not in this tenant"),
    ).toBeVisible();
    expect(
      rpc.mock.calls.some((call) => call[0] === "record_data_lineage_edge"),
    ).toBe(false);
  });

  it("shows a governed refusal instead of an empty success", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_data_lineage_register") {
        return {
          data: { edges: [edge()], ...boundary },
          error: null,
        };
      }
      if (name === "record_data_lineage_edge") {
        return {
          data: { error: "named human data-lineage authority is required" },
          error: null,
        };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    });
    render(<DataLineagePanel />);
    expect(await screen.findByText(/sap_s4_material_stock/)).toBeVisible();
    await fillAttestation();
    fireEvent.click(
      screen.getByRole("button", { name: "Record lineage edge" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /named human data-lineage authority is required/,
    );
  });
});
