import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResilienceConfigurationPanel } from "./ResilienceConfigurationPanel";

const getWorkspace = vi.fn();
const saveScenario = vi.fn();
const saveMode = vi.fn();

vi.mock("../services/resilienceConfigurationService", () => ({
  THREAT_KINDS: [
    "wildfire",
    "smoke",
    "flood",
    "extreme_cold",
    "grid_interruption",
    "cyber_incident",
    "supply_chain",
    "utility_failure",
    "labour_shortage",
    "major_equipment_loss",
    "site_evacuation",
    "emergency_shutdown",
    "communications_failure",
  ],
  ENTERPRISE_OPERATING_MODES: ["normal", "degraded", "emergency", "recovery"],
  getResilienceConfigurationWorkspace: (...args: unknown[]) =>
    getWorkspace(...args),
  saveThreatScenarioWithExposure: (...args: unknown[]) => saveScenario(...args),
  saveOperatingModeDefinition: (...args: unknown[]) => saveMode(...args),
}));

const workspace = {
  scenarios: [],
  modes: [],
  assets: [{ id: "asset-1", name: "Main air handler", site_id: "site-1" }],
  sites: [{ id: "site-1", name: "North plant" }],
  evidence: [
    {
      id: "evidence-1",
      description: "Approved regional hazard review",
      verification_status: "verified",
    },
  ],
  continuity_procedures: [],
  suppliers: [],
  authority_boundary:
    "Configuration only; named humans retain operating authority.",
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue(workspace);
  saveScenario.mockResolvedValue({
    scenario_id: 41,
    scenario_key: "SMOKE-REGIONAL",
    mapped_assets: 0,
    mapping_status: "not_mapped",
    status: "saved",
  });
  saveMode.mockResolvedValue({
    definition_id: 9,
    mode: "normal",
    status: "saved",
  });
});

describe("ResilienceConfigurationPanel", () => {
  it("saves a governed scenario, then replaces its canonical exposure map", async () => {
    render(<ResilienceConfigurationPanel />);
    fireEvent.click(
      screen.getByText("Configure scenarios and operating-mode policy"),
    );
    expect(await screen.findByText(workspace.authority_boundary)).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("Scenario key"), {
      target: { value: "SMOKE-REGIONAL" },
    });
    fireEvent.change(screen.getByDisplayValue("wildfire"), {
      target: { value: "smoke" },
    });
    fireEvent.change(screen.getByPlaceholderText("Scenario title"), {
      target: { value: "Regional smoke exposure" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Observed threat mechanism and bounded scope",
      ),
      { target: { value: "Regional smoke enters site outdoor-air intakes." } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("Governance and exposure-mapping basis"),
      {
        target: {
          value:
            "Named human review of site intake layout and regional hazard evidence.",
        },
      },
    );
    fireEvent.change(
      screen.getAllByPlaceholderText(
        "Missing evidence; separate with semicolons",
      )[0],
      { target: { value: "Current intake smoke test; Seasonal drill" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save scenario and exposure" }),
    );

    await waitFor(() =>
      expect(saveScenario).toHaveBeenCalledWith(
        expect.objectContaining({
          scenario_key: "SMOKE-REGIONAL",
          threat_kind: "smoke",
          missing_evidence: ["Current intake smoke test", "Seasonal drill"],
        }),
        [],
        "Named human review of site intake layout and regional hazard evidence.",
        undefined,
      ),
    );
    expect(
      await screen.findByText(
        "Scenario saved; no directly exposed asset is mapped, so impact cannot yet be computed.",
      ),
    ).toBeVisible();
  });

  it("saves operating-mode policy without presenting it as a state change", async () => {
    render(<ResilienceConfigurationPanel />);
    fireEvent.click(
      screen.getByText("Configure scenarios and operating-mode policy"),
    );
    await screen.findByText(workspace.authority_boundary);
    expect(
      screen.getByText(/This does not change operating state/),
    ).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("Observable entry criteria"), {
      target: { value: "All governed site operating limits remain stable." },
    });
    fireEvent.change(screen.getByPlaceholderText("Observable exit criteria"), {
      target: { value: "A governed threshold is independently confirmed." },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Role authorized to declare this mode"),
      { target: { value: "Site manager" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("Which decision authorities change"),
      {
        target: {
          value:
            "Normal approval limits and accountable decision rights apply.",
        },
      },
    );
    fireEvent.change(
      screen.getByPlaceholderText("Policy source and governance basis"),
      {
        target: {
          value:
            "Approved site emergency-management policy and authority matrix.",
        },
      },
    );
    const missingInputs = screen.getAllByPlaceholderText(
      "Missing evidence; separate with semicolons",
    );
    fireEvent.change(missingInputs[1], {
      target: { value: "Current accountable-role signature" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save policy definition" }),
    );

    await waitFor(() =>
      expect(saveMode).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "normal",
          missing_evidence: ["Current accountable-role signature"],
        }),
      ),
    );
    expect(
      await screen.findByText("normal policy definition saved."),
    ).toBeVisible();
  });
});
