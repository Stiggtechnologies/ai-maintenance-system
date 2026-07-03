import { describe, it, expect } from "vitest";
import {
  buildAssetOnboardingExports,
  createAssetOnboardingSession,
  parseAssetOnboardingCommand,
  type AssetOnboardingSession,
} from "../lib/asset-onboarding";
import {
  deriveAssetIntelligence,
  deriveGovernanceRecords,
  deriveMissionSignal,
  deriveOperatingLoop,
  deriveReliability,
  deriveValueBaseline,
  deriveWorkActions,
  deriveWorkspace,
} from "./onboardingOperatingLoop";

const COMMAND = "/onboard used pump P-101 oil-sands deep";

function session(): AssetOnboardingSession {
  return createAssetOnboardingSession({ commandText: COMMAND });
}

describe("onboarding command → session", () => {
  it("parses the canonical onboarding command", () => {
    const command = parseAssetOnboardingCommand(COMMAND);
    expect(command.isOnboarding).toBe(true);
    expect(command.assetId).toBe("P-101");
    expect(command.assetClass).toBe("pump");
    expect(command.lifecycle).toBe("used");
    expect(command.industry).toBe("oil_sands");
    expect(command.mode).toBe("deep");
  });

  it("creates a session from the command", () => {
    const s = session();
    expect(s.assetId).toBe("P-101");
    expect(s.status).toBe("active");
    expect(s.profile.failureModes.length).toBeGreaterThan(0);
  });
});

describe("deriveAssetIntelligence", () => {
  it("produces a full asset-intelligence record", () => {
    const asset = deriveAssetIntelligence(session());
    expect(asset.assetId).toBe("P-101");
    expect(Object.keys(asset.identity).length).toBeGreaterThan(0);
    expect(asset.hierarchy.length).toBeGreaterThan(0);
    expect(Object.keys(asset.functionalDefinition).length).toBeGreaterThan(0);
    expect(Object.keys(asset.operatingContext).length).toBeGreaterThan(0);
    expect(asset.criticality.criticalityClass).toBeTruthy();
    expect(asset.reliabilityBaseline).toBeDefined();
    expect(asset.lifecycle).toBeDefined();
    expect(asset.riskSafeguards).toBeDefined();
    expect(Array.isArray(asset.dataGaps)).toBe(true);
    expect(["Onboarding", "Watch", "Ready"]).toContain(asset.status);
    expect(asset.failureModes.length).toBeGreaterThan(0);
  });
});

describe("deriveReliability", () => {
  it("surfaces failure modes, strategy, RCA triggers, FRACAS and PM blockers", () => {
    const reliability = deriveReliability(session());
    expect(reliability.failureModes.length).toBeGreaterThan(0);
    expect(reliability.strategyRecommendations.length).toBeGreaterThan(0);
    expect(reliability.rcaTriggers.length).toBeGreaterThan(0);
    expect(
      reliability.fracasReadiness.failureEventIntakeFields.length,
    ).toBeGreaterThan(0);
    expect(reliability.pmOptimizationBlockers.length).toBeGreaterThan(0);
  });
});

describe("deriveWorkActions", () => {
  it("creates draft work actions and never auto-approves safety-critical work", () => {
    const actions = deriveWorkActions(session());
    expect(actions.length).toBeGreaterThan(0);

    // Approval gates must be respected: any safety-critical action is routed to
    // the approval queue, never silently approved.
    for (const action of actions) {
      if (action.safetyFlag) {
        expect(action.status).toBe("approval");
        expect(action.approvalRequired).toBe(true);
      }
    }
  });
});

describe("deriveGovernanceRecords", () => {
  it("creates approval workflow records with full governance metadata", () => {
    const records = deriveGovernanceRecords(session());
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.requiredApproval).toBeTruthy();
      expect(record.ownerRole).toBeTruthy();
      expect(record.reason).toBeTruthy();
      expect(record.consequenceOfWrong).toBeTruthy();
      expect(record.requiredValidation).toBeTruthy();
      expect(record.status).toBe("required");
    }
  });

  it("reflects recorded approval decisions", () => {
    const s = session();
    const records = deriveGovernanceRecords(s);
    const targetId = records[0].id;
    const updated = deriveGovernanceRecords(s, { [targetId]: "approved" });
    expect(updated.find((r) => r.id === targetId)?.status).toBe("approved");
  });
});

describe("deriveMissionSignal", () => {
  it("flags a readiness risk for a freshly onboarded critical asset", () => {
    const signal = deriveMissionSignal(session());
    expect(signal).not.toBeNull();
    expect(signal?.assetId).toBe("P-101");
    expect(signal?.reasons.length).toBeGreaterThan(0);
    expect(signal?.reasons.some((r) => /failure history/i.test(r))).toBe(true);
  });
});

describe("deriveValueBaseline", () => {
  it("creates a baseline pending validation", () => {
    const baseline = deriveValueBaseline(session());
    expect(baseline.assetId).toBe("P-101");
    expect(baseline.status).toBe("baseline_pending_validation");
    expect(baseline.riskExposureBaseline).toBeTruthy();
    expect(baseline.downtimeExposurePlaceholder).toBeTruthy();
    expect(baseline.projectedAnnualizedValuePlaceholder).toBeTruthy();
  });
});

describe("deriveWorkspace", () => {
  it("represents the onboarding session as a cowork workspace", () => {
    const workspace = deriveWorkspace(session());
    expect(workspace.title).toContain("P-101");
    expect(workspace.objective).toBeTruthy();
    expect(workspace.agents.length).toBeGreaterThan(0);
    expect(typeof workspace.progress).toBe("number");
    expect(workspace.nextAction).toBeTruthy();
    expect(["active", "completed"]).toContain(workspace.status);
  });
});

describe("onboarding exports", () => {
  it("generates all export formats from the package", () => {
    const exports = buildAssetOnboardingExports(session());
    expect(exports.markdown).toContain("P-101");
    expect(exports.json.length).toBeGreaterThan(0);
    expect(exports.cmmsImportCsv.length).toBeGreaterThan(0);
  });
});

describe("deriveOperatingLoop (Mission Control / Asset Intelligence service load)", () => {
  it("aggregates onboarding-derived data across the operating loop", () => {
    const bundle = deriveOperatingLoop([session()]);
    expect(bundle.assetIntelligence.length).toBe(1);
    expect(bundle.reliability.length).toBe(1);
    expect(bundle.workActions.length).toBeGreaterThan(0);
    expect(bundle.governance.length).toBeGreaterThan(0);
    expect(bundle.missionSignals.length).toBe(1);
    expect(bundle.valueBaselines.length).toBe(1);
    expect(bundle.workspaces.length).toBe(1);
  });

  it("returns empty collections for no sessions", () => {
    const bundle = deriveOperatingLoop([]);
    expect(bundle.assetIntelligence).toHaveLength(0);
    expect(bundle.missionSignals).toHaveLength(0);
    expect(bundle.workActions).toHaveLength(0);
  });
});
