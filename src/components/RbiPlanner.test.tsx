/**
 * Reachability of risk-based inspection planning (BOK-05, register E2.06):
 * the calculation runs on the shared kernel and a plan is recorded only when a
 * person adopts it through the existing record_inspection_plan door.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RbiPlanner } from "./RbiPlanner";

const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fillValid(target = "0.05") {
  fill("Corrosion circuit ID", "7");
  fill("Generic failure frequency (per year)", "0.00003");
  fill(
    "GFF source (licensed table, edition)",
    "Licensed API 581 Part 2 Table 3.1",
  );
  fill("Damage mechanism", "Internal thinning");
  fill(
    "Damage-factor source (assessment, CML trend)",
    "CML trend 2018–2025 owner assessment",
  );
  fill("Damage factor now", "1");
  fill("Assessed horizon (years)", "10");
  fill("Damage factor at horizon", "101");
  fill("Why this combination (procedure ref.)", "Integrity procedure IP-4 §3");
  fill("Management-system factor", "1");
  fill("F_MS source (audit, score)", "2025 PSM audit score");
  fill("Consequence of failure", "100");
  fill("Consequence source (study ref.)", "Consequence study CA-22");
  fill("Risk target", target);
  fill("Risk-target source (owner criterion)", "Integrity risk target IRT-1");
}

describe("RbiPlanner", () => {
  beforeEach(() => rpc.mockReset());

  it("calculates without recording, then adopts through record_inspection_plan", async () => {
    rpc.mockResolvedValue({
      data: { id: 42, status: "recorded" },
      error: null,
    });
    render(<RbiPlanner />);
    fillValid();
    fireEvent.click(screen.getByText("Calculate risk"));
    expect(
      await screen.findByText(/Proposed plan: every 18 months/),
    ).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Adopt as inspection plan"));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const [name, args] = rpc.mock.calls[0] as [
      string,
      { p_plan: Record<string, string> },
    ];
    expect(name).toBe("record_inspection_plan");
    expect(args.p_plan.circuit_id).toBe("7");
    expect(args.p_plan.interval_months).toBe("18");
    expect(args.p_plan.interval_basis).toContain(
      "Licensed API 581 Part 2 Table 3.1",
    );
    expect(
      await screen.findByText("Inspection plan 42 recorded."),
    ).toBeTruthy();
  });

  it("offers no interval when risk is already over target", async () => {
    render(<RbiPlanner />);
    fillValid("0.001");
    fireEvent.click(screen.getByText("Calculate risk"));
    expect(await screen.findByText(/No interval proposed/)).toBeTruthy();
    expect(screen.queryByText("Adopt as inspection plan")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the kernel's refusal when a source is too thin", async () => {
    render(<RbiPlanner />);
    fillValid();
    fill("GFF source (licensed table, edition)", "table");
    fireEvent.click(screen.getByText("Calculate risk"));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /stated basis/,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a server refusal from the governed door", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "process-safety authority is required" },
    });
    render(<RbiPlanner />);
    fillValid();
    fireEvent.click(screen.getByText("Calculate risk"));
    fireEvent.click(await screen.findByText("Adopt as inspection plan"));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /process-safety authority/,
    );
  });
});
