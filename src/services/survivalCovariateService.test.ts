import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runSurvivalAnalysis,
  loadSurvivalWorkspace,
  captureSurvivalInstalledOverlay,
  reviewSurvivalInstalledOverlay,
} from "./survivalCovariateService";
import type {
  SurvivalScenarioSelection,
  SurvivalActiveScenarioSelection,
  SurvivalActiveInstance,
} from "../lib/reliability/survival-source";

const { invoke, rpc, from } = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  supabase: { functions: { invoke }, rpc, from },
}));
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
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty("activeScenario");
  });
  it("sends only installed UUID and user horizon, never caller age, measurements or standing", async () => {
    await runSurvivalAnalysis(
      "synthetic component",
      [{ name: "synthetic_load", unit: "ratio" }],
      undefined,
      {
        componentInstanceId: "aaaaaaaa-0000-0000-0000-000000000001",
        horizonHours: 15,
        originHours: 999,
        covariates: [999],
        sourceCurrent: true,
      } as SurvivalActiveScenarioSelection,
    );
    expect(invoke.mock.calls[0][1].body.activeScenario).toEqual({
      componentInstanceId: "aaaaaaaa-0000-0000-0000-000000000001",
      horizonHours: 15,
    });
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty("scenario");
  });
  it("rejects ambiguous historical and installed selections before invoking the service", async () => {
    await expect(
      runSurvivalAnalysis(
        "synthetic component",
        [],
        { eventId: 1, intervalIndex: 0, originHours: 1, horizonHours: 2 },
        { componentInstanceId: "uuid", horizonHours: 2 },
      ),
    ).rejects.toThrow(/Choose one/);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("refuses outdated completed-only workspace source before fetching any client evidence", async () => {
    rpc.mockResolvedValue({
      data: { component: "synthetic", events: [] },
      error: null,
    });
    await expect(loadSurvivalWorkspace("synthetic")).rejects.toThrow(
      /complete physical-life census/,
    );
    expect(from).not.toHaveBeenCalled();
  });
  it("captures and reviews only the exact installed identity and optimistic version through governed RPCs", async () => {
    rpc.mockResolvedValue({ data: { version: 4 }, error: null });
    const instance = {
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      overlayVersion: 3,
    } as SurvivalActiveInstance;
    const overlay = {
      mode: "exclude" as const,
      basis: "Independent evidence-backed exclusion.",
      evidenceItemId: "evidence",
    };
    await captureSurvivalInstalledOverlay(instance, overlay);
    expect(rpc).toHaveBeenCalledWith("record_survival_installed_overlay", {
      p_instance_id: instance.id,
      p_expected_version: 3,
      p_overlay: overlay,
    });
    await reviewSurvivalInstalledOverlay(
      instance,
      "validated",
      "Independent exact-source review basis.",
    );
    expect(rpc).toHaveBeenCalledWith("review_survival_installed_overlay", {
      p_instance_id: instance.id,
      p_expected_version: 3,
      p_decision: "validated",
      p_basis: "Independent exact-source review basis.",
    });
    expect(from).not.toHaveBeenCalled();
  });
});
