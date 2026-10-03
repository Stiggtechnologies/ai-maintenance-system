import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepairableUnitRegister } from "./RepairableUnitRegister";
import {
  getRepairableUnitRegister,
  recordRepairableUnitEvent,
  registerRepairableUnit,
  type RepairableUnitRegisterPayload,
} from "../services/repairableMaterialsService";

vi.mock("../services/repairableMaterialsService", () => ({
  getRepairableUnitRegister: vi.fn(),
  recordRepairableUnitEvent: vi.fn(),
  registerRepairableUnit: vi.fn(),
}));

const payload: RepairableUnitRegisterPayload = {
  materials: [
    {
      id: "m-1",
      materialCode: "FD-100",
      description: "Final drive",
      classification: "rotable",
      masterVersion: 2,
      leadTimeDays: 120,
      criticality: "critical",
      stockRows: 1,
      bomRows: 2,
    },
  ],
  assets: [{ id: "a-1", tag: "TRK-001", name: "Haul truck 1" }],
  suppliers: [{ id: 9, code: "REP-9", name: "Drive Rebuilders" }],
  authority:
    "Human evidence recording only; no stock receipt or repair acceptance is inferred.",
  units: [
    {
      id: "u-1",
      materialId: "m-1",
      materialCode: "FD-100",
      description: "Final drive",
      classification: "rotable",
      serialNumber: "SN-007",
      currentState: "removed",
      version: 3,
      sourceSystem: "SAP",
      sourceRef: "SER-7",
      basis: "Verified serialized component register.",
      registeredAt: "2026-01-01T00:00:00Z",
      currentComponentInstanceId: null,
      currentAssetId: null,
      currentAsset: null,
      currentComponent: null,
      currentPosition: null,
      repairTurnaroundHours: null,
      turnaroundBasis:
        "Repair turnaround is not measurable until a complete repair pair exists.",
      events: [
        {
          id: 3,
          sequence: 3,
          eventType: "removed",
          fromState: "installed",
          toState: "removed",
          occurredAt: "2026-01-03T00:00:00Z",
          componentInstanceId: "ci-1",
          workOrderId: null,
          supplierId: null,
          meterHours: 1000,
          repairCostUsd: null,
          repairOrderRef: null,
          evidenceRef: "WO-3",
          sourceSystem: "SAP",
          basis: "Removed under governed work order WO-3.",
          actor: "Planner",
        },
      ],
    },
  ],
};

describe("RepairableUnitRegister", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepairableUnitRegister).mockResolvedValue(payload);
  });

  it("registers a serialized identity without implying stock or installation", async () => {
    vi.mocked(registerRepairableUnit).mockResolvedValue({
      repairableUnitId: "u-2",
      version: 1,
      currentState: "available",
      operationalAuthorization: false,
    });
    render(<RepairableUnitRegister />);
    await screen.findByText("1 serialized identities");
    fireEvent.change(screen.getByLabelText("Repairable material"), {
      target: { value: "m-1" },
    });
    fireEvent.change(screen.getByLabelText("Serial number"), {
      target: { value: "SN-008" },
    });
    fireEvent.change(screen.getByLabelText("Source reference"), {
      target: { value: "SER-8" },
    });
    fireEvent.change(screen.getByLabelText("Registration basis"), {
      target: { value: "Verified serialized component register row eight." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register unit" }));
    await screen.findByRole("status");
    expect(registerRepairableUnit).toHaveBeenCalledWith({
      materialId: "m-1",
      serialNumber: "SN-008",
      sourceSystem: "customer_component_register",
      sourceRef: "SER-8",
      basis: "Verified serialized component register row eight.",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "no stock receipt or installation was inferred",
    );
  });

  it("shows unknown turnaround and sends an optimistic, supplier-bound repair event", async () => {
    vi.mocked(recordRepairableUnitEvent).mockResolvedValue({
      repairableUnitId: "u-1",
      eventType: "sent_for_repair",
      currentState: "in_repair",
      version: 4,
      sequence: 4,
      operationalAuthorization: false,
    });
    render(<RepairableUnitRegister />);
    expect(await screen.findByText("Not measurable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record event" }));
    expect(screen.getByLabelText("Event")).toHaveValue("sent_for_repair");
    fireEvent.change(screen.getByLabelText("Repair supplier"), {
      target: { value: "9" },
    });
    fireEvent.change(screen.getByLabelText("Repair order reference"), {
      target: { value: "RO-100" },
    });
    fireEvent.change(screen.getByLabelText("Evidence reference"), {
      target: { value: "Dispatch-100" },
    });
    fireEvent.change(screen.getByLabelText("Event basis"), {
      target: { value: "Vendor dispatch transaction accepted by stores." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record Send for repair" }),
    );
    await screen.findByRole("status");
    expect(recordRepairableUnitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        repairableUnitId: "u-1",
        eventType: "sent_for_repair",
        expectedVersion: 3,
        supplierId: 9,
        repairOrderRef: "RO-100",
        evidenceRef: "Dispatch-100",
      }),
    );
  });
});
