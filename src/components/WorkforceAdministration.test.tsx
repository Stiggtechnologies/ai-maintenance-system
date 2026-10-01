import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCompetencyRequirements,
  recordCapacityDeduction,
  recordCompetency,
  recordMemberCompetency,
  recordResourceCapacity,
  recordShiftAssignment,
  recordWorkforceMember,
  setWorkforceMemberActive,
} from "../services/developService";
import { WorkforceAdministration } from "./WorkforceAdministration";

vi.mock("../services/developService", () => ({
  getCompetencyRequirements: vi.fn(),
  recordCapacityDeduction: vi.fn(),
  recordCompetency: vi.fn(),
  recordMemberCompetency: vi.fn(),
  recordResourceCapacity: vi.fn(),
  recordShiftAssignment: vi.fn(),
  recordWorkforceMember: vi.fn(),
  setWorkforceMemberActive: vi.fn(),
}));

const catalogue = {
  answered: true,
  requirements: [],
  competencies: [
    {
      competencyId: 9,
      competencyKey: "confined_space",
      title: "Confined-space entrant",
      kind: "certification",
      isStatutory: true,
      validityMonths: 12,
    },
  ],
  members: [
    {
      memberId: 7,
      displayName: "A. Technician",
      craft: "Millwright",
      employeeRef: "MW-007",
      active: true,
    },
  ],
};

describe("WorkforceAdministration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCompetencyRequirements).mockResolvedValue(catalogue);
    for (const write of [
      recordCapacityDeduction,
      recordCompetency,
      recordMemberCompetency,
      recordResourceCapacity,
      recordShiftAssignment,
      recordWorkforceMember,
      setWorkforceMemberActive,
    ]) {
      vi.mocked(write).mockResolvedValue({ answered: true, note: "Recorded." });
    }
  });

  it("makes every canonical workforce control reachable from the scheduling surface", async () => {
    render(<WorkforceAdministration />);
    fireEvent.click(screen.getByText("Manage workforce evidence"));

    expect(await screen.findByRole("button", { name: "Record workforce member" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Define competency" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify competency holding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Roster shift" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record delivered capacity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record capacity deduction" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record roster status" })).toBeInTheDocument();

    expect(screen.getAllByRole("option", { name: "A. Technician" })).toHaveLength(2);
    expect(screen.getByRole("option", { name: "Confined-space entrant" })).toBeInTheDocument();
    expect(
      screen.getByText(/human-only competency act are enforced again at the database/i),
    ).toBeInTheDocument();
  });

  it("records a workforce member through the existing governed RPC wrapper and refreshes the catalogue", async () => {
    const onChanged = vi.fn();
    render(<WorkforceAdministration onChanged={onChanged} />);
    fireEvent.click(screen.getByText("Manage workforce evidence"));

    await screen.findByRole("button", { name: "Record workforce member" });
    fireEvent.change(screen.getByLabelText("Employee reference"), { target: { value: "EL-101" } });
    fireEvent.change(screen.getByLabelText("Workforce member name"), { target: { value: "E. Lin" } });
    fireEvent.change(screen.getByLabelText("Craft or discipline"), { target: { value: "Electrician" } });
    fireEvent.change(screen.getByLabelText("Employment type"), { target: { value: "contractor" } });
    fireEvent.change(screen.getByLabelText("Employer"), { target: { value: "North Grid Services" } });
    fireEvent.click(screen.getByRole("button", { name: "Record workforce member" }));

    await waitFor(() =>
      expect(recordWorkforceMember).toHaveBeenCalledWith({
        employeeRef: "EL-101",
        displayName: "E. Lin",
        craft: "Electrician",
        employmentType: "contractor",
        employer: "North Grid Services",
        fte: "1",
      }),
    );
    expect(getCompetencyRequirements).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("will not submit a qualification without the evidence the canonical writer requires", async () => {
    render(<WorkforceAdministration />);
    fireEvent.click(screen.getByText("Manage workforce evidence"));
    await waitFor(() =>
      expect(screen.getAllByRole("option", { name: "A. Technician" })).toHaveLength(2),
    );

    fireEvent.change(screen.getByLabelText("Qualified member"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Verified competency"), { target: { value: "9" } });
    const button = screen.getByRole("button", { name: "Verify competency holding" });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Competency evidence reference"), {
      target: { value: "Certificate CS-2026-0042 verified against issuer register" },
    });
    fireEvent.click(button);

    await waitFor(() =>
      expect(recordMemberCompetency).toHaveBeenCalledWith({
        memberId: 7,
        competencyId: 9,
        grantedOn: undefined,
        expiresOn: undefined,
        evidenceReference: "Certificate CS-2026-0042 verified against issuer register",
      }),
    );
  });

  it("keeps delivered capacity and its deductions as separate governed facts", async () => {
    render(<WorkforceAdministration />);
    fireEvent.click(screen.getByText("Manage workforce evidence"));
    await screen.findByRole("button", { name: "Record delivered capacity" });

    fireEvent.change(screen.getByLabelText("Capacity pool"), { target: { value: "Millwright" } });
    fireEvent.change(screen.getByLabelText("Delivered weekly hours"), { target: { value: "320" } });
    fireEvent.change(screen.getByLabelText("Capacity basis"), {
      target: { value: "Approved eight-person roster after known leave and training" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record delivered capacity" }));

    await waitFor(() =>
      expect(recordResourceCapacity).toHaveBeenCalledWith({
        category: "labour",
        pool: "Millwright",
        weeklyHours: "320",
        basis: "Approved eight-person roster after known leave and training",
      }),
    );

    fireEvent.change(screen.getByLabelText("Deduction pool"), { target: { value: "Millwright" } });
    fireEvent.change(screen.getByLabelText("Deduction weekly hours"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Capacity deduction basis"), {
      target: { value: "Training plan TR-14 removes one person from delivered capacity" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record capacity deduction" }));

    await waitFor(() =>
      expect(recordCapacityDeduction).toHaveBeenCalledWith({
        category: "labour",
        pool: "Millwright",
        deductionKind: "leave",
        weeklyHours: "40",
        basis: "Training plan TR-14 removes one person from delivered capacity",
      }),
    );
  });
});
