import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SapApmIndicatorReadConnectorSetup } from "./SapApmIndicatorReadConnectorSetup";

const auth = vi.hoisted(() => ({ role: "admin" }));
const actions = vi.hoisted(() => ({ configure: vi.fn(), pull: vi.fn() }));
const listSites = vi.hoisted(() => vi.fn());
const sensorId = "00000000-0000-4000-8000-0000000000aa";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: auth.role } }),
}));
vi.mock("../services/sapApmIndicatorRead", () => ({
  sapApmIndicatorReadActions: actions,
  parseSapApmIndicatorBindings: (value: string) => {
    const [
      characteristicsInternalId,
      positionId,
      categoryName,
      technicalObjectType,
      sensor,
    ] = value.split("|").map((part) => part.trim());
    if (!characteristicsInternalId) throw new Error("binding required");
    return [
      {
        characteristicsInternalId,
        positionId,
        categoryName,
        technicalObjectType,
        sensorId: sensor,
      },
    ];
  },
}));
vi.mock("../services/reliabilityCallers", () => ({ listSites }));

beforeEach(() => {
  auth.role = "admin";
  listSites
    .mockReset()
    .mockResolvedValue([{ id: "site-1", name: "North Plant" }]);
  actions.configure.mockReset().mockResolvedValue({ note: "saved" });
  actions.pull.mockReset().mockResolvedValue({
    raw_rows: 1,
    mapped_rows: 1,
    pages: 1,
    status: "success",
    records_rejected: 0,
  });
});

describe("SAP APM indicator connector setup", () => {
  it("records one technical object and an explicit sensor binding", async () => {
    const onConfigured = vi.fn().mockResolvedValue(undefined);
    render(<SapApmIndicatorReadConnectorSetup onConfigured={onConfigured} />);
    await screen.findByRole("option", { name: "North Plant" });
    fireEvent.change(screen.getByPlaceholderText("SAP APM connector key"), {
      target: { value: "north-apm" },
    });
    fireEvent.change(screen.getByPlaceholderText("SAP APM display name"), {
      target: { value: "North APM" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "https://api-apm.example.com/IndicatorService/v1",
      ),
      {
        target: { value: "https://apm.example.com/IndicatorService/v1" },
      },
    );
    fireEvent.change(screen.getByLabelText("SAP APM technical object number"), {
      target: { value: "217100092" },
    });
    fireEvent.change(screen.getByLabelText("Canonical indicator site"), {
      target: { value: "site-1" },
    });
    fireEvent.change(screen.getByLabelText("SAP APM indicator bindings"), {
      target: { value: `53 | position-1 | M | EQUI | ${sensorId}` },
    });
    fireEvent.change(
      screen.getByPlaceholderText("vault://tenant/sap-apm-indicators"),
      { target: { value: "vault://north/sap-apm" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "Activation authority and exact technical-object-to-sensor mapping basis (20+ characters)",
      ),
      {
        target: {
          value:
            "The reliability engineer approved technical object 217100092 for the North Plant sensor.",
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /Save disabled/ }));
    expect(actions.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        technicalObjectNumber: "217100092",
        siteId: "site-1",
        bindings: [
          expect.objectContaining({
            characteristicsInternalId: "53",
            sensorId,
          }),
        ],
        enabled: false,
      }),
    );
  });

  it("does not offer configuration to the AI administrator", () => {
    auth.role = "ai_admin";
    render(<SapApmIndicatorReadConnectorSetup onConfigured={vi.fn()} />);
    expect(screen.queryByLabelText("SAP APM indicator bindings")).toBeNull();
  });
});
