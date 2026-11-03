import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const state = vi.fn();
const adopt = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));
vi.mock("../services/stage1PilotPack", () => ({
  adoptAuthorityLimit: (...args: unknown[]) => adopt(...args),
  stateGeneralDelegation: (...args: unknown[]) => state(...args),
}));

import { AccountabilityCascade } from "./AccountabilityCascade";

const unstated = {
  role: "executive",
  viewer_id: "human-1",
  enforcement_note: "Only ADOPTED limits are enforced.",
  limits: [
    {
      id: "limit-1",
      role_key: "planner",
      tier_label: "Planning",
      max_commitment_usd: null,
      max_commitment_currency: null,
      max_risk_level: null,
      max_production_downtime_hours: null,
      commitment_stated: false,
      risk_stated: false,
      downtime_stated: false,
      ceilings_stated_by: null,
      escalates_to_role: "maintenance_manager",
      basis: "Ladder role only.",
      status: "draft",
      adopted_at: null,
    },
  ],
  packs: [],
};

describe("AccountabilityCascade Stage-1 adopt", () => {
  beforeEach(() => {
    rpc.mockReset();
    state.mockReset();
    adopt.mockReset();
    rpc.mockResolvedValue({ data: unstated, error: null });
    state.mockResolvedValue({ limit_id: "limit-1" });
  });

  it("exposes named-human adopt and an explicit ceiling statement", () => {
    const src = readFileSync(
      "src/components/AccountabilityCascade.tsx",
      "utf8",
    );
    expect(src).toContain("adoptAuthorityLimit");
    expect(src).toContain("stateGeneralDelegation");
    expect(src).toContain("stage1-doa-adopt");
    expect(src).toContain("instrument.trim().length < 10");
    expect(src).toMatch(/AI cannot state or adopt/);
  });

  it("shows unstated dimensions as unstated and submits only the human's figures", async () => {
    render(<AccountabilityCascade />);
    expect(await screen.findAllByText("Not stated")).toHaveLength(3);
    expect(screen.queryByText(/\$5,000/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("USD")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("stage1-doa-limit"), {
      target: { value: "limit-1" },
    });
    fireEvent.change(screen.getByTestId("stage1-doa-note"), {
      target: { value: "Board minute 12, delegation schedule A" },
    });
    fireEvent.change(screen.getByTestId("stage1-doa-commitment-mode"), {
      target: { value: "amount" },
    });
    fireEvent.change(screen.getByTestId("stage1-doa-ceiling"), {
      target: { value: "1500" },
    });
    fireEvent.change(screen.getByTestId("stage1-doa-currency"), {
      target: { value: "cad" },
    });
    fireEvent.change(screen.getByTestId("stage1-doa-risk-mode"), {
      target: { value: "ceiling" },
    });
    fireEvent.change(screen.getByTestId("stage1-doa-risk-level"), {
      target: { value: "Medium" },
    });
    fireEvent.change(screen.getByTestId("stage1-doa-downtime-mode"), {
      target: { value: "hours" },
    });
    fireEvent.change(screen.getByTestId("stage1-doa-downtime-hours"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByTestId("stage1-doa-state"));

    await waitFor(() => expect(state).toHaveBeenCalledOnce());
    expect(state).toHaveBeenCalledWith({
      limitId: "limit-1",
      basis: "Board minute 12, delegation schedule A",
      commitment: { mode: "amount", amount: "1500", currency: "CAD" },
      risk: { mode: "ceiling", level: "Medium" },
      downtime: { mode: "hours", hours: "6" },
    });
  });
});
