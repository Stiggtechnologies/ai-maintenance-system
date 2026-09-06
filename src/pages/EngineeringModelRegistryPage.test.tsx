import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EngineeringModelRegistryPage } from "./EngineeringModelRegistryPage";

let role = "reliability_engineer";
const getRegistry = vi.fn();
const register = vi.fn();

vi.mock("../components/AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));
vi.mock("../services/engineeringModelService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/engineeringModelService")
  >("../services/engineeringModelService");
  return {
    ...actual,
    getEngineeringModelRegistry: (...args: unknown[]) => getRegistry(...args),
    registerBuiltInResonancePack: (...args: unknown[]) => register(...args),
  };
});
vi.mock("../lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => ({ returns: async () => ({ data: [], error: null }) }),
        }),
      }),
    }),
  },
}));

const emptyRegistry = {
  models: [],
  posture: {
    registered: 0,
    productionEligible: 0,
    revalidationRequired: 0,
    openBlockingDebt: 0,
    outcomesRecorded: 0,
    basis: "Strict promotion basis.",
  },
};

describe("EngineeringModelRegistryPage", () => {
  beforeEach(() => {
    role = "reliability_engineer";
    getRegistry.mockReset().mockResolvedValue(emptyRegistry);
    register
      .mockReset()
      .mockResolvedValue({ persisted: { model_register_id: 1 } });
  });

  it("registers the bounded pilot through the controlled service", async () => {
    render(<EngineeringModelRegistryPage />);
    const button = await screen.findByRole("button", {
      name: "Register vibration pilot",
    });
    fireEvent.click(button);
    expect(
      await screen.findByText(
        "Vibration/resonance pilot registered as a draft.",
      ),
    ).toBeTruthy();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("keeps non-engineering roles read-only", async () => {
    role = "board";
    render(<EngineeringModelRegistryPage />);
    expect(
      await screen.findByText(/No engineering model packs are registered/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Register vibration pilot" }),
    ).toBeNull();
  });
});
