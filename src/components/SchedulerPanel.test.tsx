import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SchedulerPanel } from "./SchedulerPanel";

const chain = {
  select: vi.fn(),
  neq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
};
chain.select.mockReturnValue(chain);
chain.neq.mockReturnValue(chain);
chain.order.mockReturnValue(chain);
chain.limit.mockResolvedValue({
  data: [
    {
      id: "opt-1",
      week_start: "2026-11-02",
      label: "Risk-first",
      strategy: "Eligible work after the constraints.",
      items: [],
      total_hours: 0,
      capacity_hours: 0,
      status: "draft",
      released_at: null,
      constraint_posture: {
        capacity_basis:
          "No caller-stated daily bound. Placement uses skilled-trades capacity in force for this week.",
        deferred_counts: { material_unassessable: 2, safety_gate: 1 },
        production_not_assessable: 0,
        authority: "Draft option only.",
      },
    },
  ],
  error: null,
});

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: () => chain,
    rpc: vi.fn(),
  },
}));

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: "planner" } }),
}));

describe("SchedulerPanel constrained drafts", () => {
  it("shows why work was deferred instead of a fabricated daily crew", async () => {
    render(<SchedulerPanel />);
    expect(await screen.findByText("Risk-first")).toBeInTheDocument();
    expect(
      screen.getByText(/skilled-trades capacity in force/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 material unassessable/i)).toBeInTheDocument();
    expect(screen.getByText(/1 safety gate/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 h\/day capacity/)).not.toBeInTheDocument();
    expect(screen.getByText(/cannot freeze the week/i)).toBeInTheDocument();
  });
});
