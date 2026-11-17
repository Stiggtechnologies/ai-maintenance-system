import { describe, expect, it } from "vitest";
import {
  combineHybridRetrievalScore,
  hybridCandidateMatchesFilter,
} from "./hybrid-retrieval";

describe("hybrid engineering retrieval ranking", () => {
  it("blends cosine similarity with a squashed lexical rank", () => {
    const lexical = 1;
    const semantic = 1;
    expect(combineHybridRetrievalScore(semantic, lexical)).toBeCloseTo(
      0.55 + 0.45 * (1 / 2),
    );
  });

  it("uses whichever signal is present", () => {
    expect(combineHybridRetrievalScore(0.8, 0)).toBe(0.8);
    expect(combineHybridRetrievalScore(null, 1)).toBeCloseTo(0.5);
    expect(combineHybridRetrievalScore(null, 0)).toBe(0);
  });

  it("requires an approved non-superseded mapping when a canonical filter is set", () => {
    const candidate = {
      entityType: "asset_class",
      canonicalId: "ROT-CENT-PUMP",
      assetClass: "ROT-CENT-PUMP",
      reviewState: "approved",
      sourceReviewState: "approved",
      superseded: false,
    };
    expect(hybridCandidateMatchesFilter(candidate, {})).toBe(true);
    expect(
      hybridCandidateMatchesFilter(candidate, {
        entityType: "asset_class",
        canonicalId: "ROT-CENT-PUMP",
      }),
    ).toBe(true);
    expect(
      hybridCandidateMatchesFilter(
        { ...candidate, reviewState: "draft" },
        { entityType: "asset_class", canonicalId: "ROT-CENT-PUMP" },
      ),
    ).toBe(false);
    expect(
      hybridCandidateMatchesFilter(candidate, {
        entityType: "failure_mode",
        canonicalId: "OTHER",
      }),
    ).toBe(false);
    expect(
      hybridCandidateMatchesFilter(
        { ...candidate, superseded: true },
        { assetClass: "ROT-CENT-PUMP" },
      ),
    ).toBe(false);
  });
});
