import { describe, expect, it } from "vitest";
import {
  detectKnowledgeConflicts,
  type KnowledgeConflictSource,
} from "./knowledge-conflicts";

const source = (
  overrides: Partial<KnowledgeConflictSource>,
): KnowledgeConflictSource => ({
  sourceId: "s1",
  revision: "1",
  authorityLevel: "oem_authorized",
  reviewState: "approved",
  mappingReviewState: "approved",
  replacementInTenant: true,
  replacementReviewState: "approved",
  ...overrides,
});

describe("engineering knowledge conflict detection", () => {
  it("names revision and authority disagreements without choosing a winner", () => {
    const findings = detectKnowledgeConflicts([
      source({
        sourceId: "b",
        revision: "2",
        authorityLevel: "internal_approved",
      }),
      source({
        sourceId: "a",
        revision: "1",
        authorityLevel: "oem_authorized",
      }),
    ]);
    expect(findings.map((finding) => finding.kind)).toEqual([
      "revision_conflict",
      "authority_conflict",
    ]);
    expect(findings[0]?.sourceIds).toEqual(["a", "b"]);
  });

  it("treats a missing revision as unstated rather than a conflict", () => {
    expect(
      detectKnowledgeConflicts([
        source({ sourceId: "a", revision: "1" }),
        source({
          sourceId: "b",
          revision: null,
          authorityLevel: "oem_authorized",
        }),
      ]).some((finding) => finding.kind === "revision_conflict"),
    ).toBe(false);
  });

  it("reports a superseded source with no approved replacement and a stale mapping", () => {
    const findings = detectKnowledgeConflicts([
      source({
        sourceId: "old",
        reviewState: "superseded",
        supersededBySourceId: null,
        replacementReviewState: null,
      }),
    ]);
    expect(findings.map((finding) => finding.kind)).toEqual([
      "supersession_gap",
      "superseded_mapping_still_approved",
    ]);
  });

  it("reports a replacement pointer that was not applied", () => {
    const findings = detectKnowledgeConflicts([
      source({
        sourceId: "old",
        reviewState: "approved",
        supersededBySourceId: "new",
      }),
    ]);
    expect(findings.map((finding) => finding.kind)).toContain(
      "successor_not_applied",
    );
  });
});
