import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSurvivalAnalysis } from "./survivalCovariateService";
import type { SurvivalScenarioSelection } from "../lib/reliability/survival-source";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { functions: { invoke } } }));
describe("survival calculation client boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invoke.mockResolvedValue({
      data: { calculationRunId: "synthetic", result: { status: "refused" } },
      error: null,
    });
  });
  it("sends only optional selection identity and user-stated window, never a trusted measurement or model", async () => {
    await runSurvivalAnalysis(
      "synthetic component",
      [{ name: "synthetic_load", unit: "ratio" }],
      {
        eventId: 12,
        intervalIndex: 0,
        originHours: 2,
        horizonHours: 10,
        covariates: [999],
        sourceCurrent: true,
      } as SurvivalScenarioSelection,
    );
    expect(invoke).toHaveBeenCalledWith("calculation-service", {
      body: {
        action: "reliability_survival",
        component: "synthetic component",
        covariates: [{ name: "synthetic_load", unit: "ratio" }],
        scenario: {
          eventId: 12,
          intervalIndex: 0,
          originHours: 2,
          horizonHours: 10,
        },
      },
    });
  });
  it("does not invent a default conditional scenario", async () => {
    await runSurvivalAnalysis("synthetic component", [
      { name: "synthetic_load", unit: "ratio" },
    ]);
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty("scenario");
  });
});
