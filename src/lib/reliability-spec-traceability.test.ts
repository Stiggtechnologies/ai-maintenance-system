import {
  getP0Gaps,
  getRequirementsByCategory,
  SPEC_REQUIREMENTS,
  SPEC_STATUS_LABELS,
  summarizeSpecTraceability,
  type SpecStatus,
} from "./reliability-spec-traceability";
import { describe, expect, it } from "vitest";

describe("reliability spec traceability", () => {
  it("keeps every requirement uniquely identified and actionable", () => {
    const ids = new Set<string>();

    for (const requirement of SPEC_REQUIREMENTS) {
      expect(requirement.id).toMatch(/^[A-Z]+-\d{3}$/);
      expect(ids.has(requirement.id)).toBe(false);
      ids.add(requirement.id);
      expect(requirement.category).toBeTruthy();
      expect(requirement.requirement).toBeTruthy();
      expect(requirement.phase).toBeTruthy();
      expect(requirement.evidence.length).toBeGreaterThan(0);
      expect(requirement.gap).toBeTruthy();
      expect(requirement.nextAction).toBeTruthy();
    }
  });

  it("covers all current status classes", () => {
    const summary = summarizeSpecTraceability();
    const statuses = Object.keys(SPEC_STATUS_LABELS) as SpecStatus[];

    for (const status of statuses) {
      expect(summary[status]).toBeGreaterThan(0);
    }
  });

  it("captures the user supplied commercial spec breadth", () => {
    expect(SPEC_REQUIREMENTS.length).toBeGreaterThanOrEqual(100);

    const requiredCategories = [
      "Positioning",
      "Assistant Behavior",
      "Reliability Chat Assistant",
      "Deterministic Calculations",
      "FRACAS / DCACAS",
      "Standards-Aware Knowledge Base",
      "Architecture",
      "MVP Phase 1",
      "Database Schema",
      "Safety And Governance",
      "Evaluation Suite",
      "Microsoft Distribution",
      "Commercial Packaging",
      "Closed-Loop Reliability Workflow",
    ];

    for (const category of requiredCategories) {
      expect(getRequirementsByCategory(category).length).toBeGreaterThan(0);
    }
  });

  it("does not let P0 gaps hide without a next action", () => {
    for (const requirement of getP0Gaps()) {
      expect(requirement.nextAction.length).toBeGreaterThan(20);
      expect(requirement.gap).not.toMatch(/no material/i);
    }
  });

  it("explicitly tracks the most important missing commercial product gates", () => {
    const byId = new Map(
      SPEC_REQUIREMENTS.map((requirement) => [requirement.id, requirement]),
    );

    expect(byId.get("ARCH-017")?.status).toBe("captured-not-implemented");
    expect(byId.get("RAG-008")?.status).toBe("partial");
    expect(byId.get("FRACAS-001")?.status).toBe("partial");
    expect(byId.get("MVP-002")?.status).toBe("partial");
    expect(byId.get("MS-005")?.status).toBe("owner-gate");
    expect(byId.get("CLOSED-003")?.status).toBe("missing");
  });
});
