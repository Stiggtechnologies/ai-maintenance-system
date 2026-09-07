import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateShaftResonance, shaftResonanceModelPack } from "./resonance";

describe("shaft resonance reference pack", () => {
  it("keeps every declared durable artifact pinned to its content digest", () => {
    for (const artifact of shaftResonanceModelPack.artifacts) {
      const digest = createHash("sha256")
        .update(readFileSync(artifact.path))
        .digest("hex");
      expect(digest, artifact.path).toBe(artifact.sha256);
    }
    const lockDigest = createHash("sha256")
      .update(readFileSync("package-lock.json"))
      .digest("hex");
    expect(lockDigest).toBe(
      shaftResonanceModelPack.environment.packageLockSha256,
    );
  });

  it("passes the pinned frequency benchmark and regression case", () => {
    const result = evaluateShaftResonance({
      rpm: 1_800,
      forcingOrder: 1,
      dominantPeakHz: 30,
      modalMassKg: 100,
      modalStiffnessNPerM: 3_553_057.584,
      approvedMatchTolerancePct: 2,
      toleranceSourceReference: "evidence:approved-site-tolerance",
    });
    expect(result.shaftFrequencyHz).toBe(30);
    expect(result.forcingFrequencyHz).toBe(30);
    expect(result.naturalFrequencyHz).toBeCloseTo(30, 6);
    expect(result.conclusion).toBe("screen_supports_resonance_hypothesis");
    expect(result.humanApprovalRequired).toBe(true);
  });

  it("refuses classification when the tolerance is not sourced", () => {
    const result = evaluateShaftResonance({
      rpm: 1_800,
      forcingOrder: 1,
      dominantPeakHz: 30,
      modalMassKg: 100,
      modalStiffnessNPerM: 3_553_057.584,
    });
    expect(result.conclusion).toBe("refused");
    expect(result.forcingMatch).toBeNull();
    expect(result.refusals).toContainEqual(
      expect.objectContaining({ code: "approved_match_tolerance_missing" }),
    );
  });

  it("rejects non-physical and non-finite values", () => {
    expect(() =>
      evaluateShaftResonance({
        rpm: 0,
        forcingOrder: 1,
        dominantPeakHz: 30,
        modalMassKg: 100,
        modalStiffnessNPerM: 3_553_057.584,
      }),
    ).toThrow(/rpm/);
    expect(() =>
      evaluateShaftResonance({
        rpm: 1_800,
        forcingOrder: Number.NaN,
        dominantPeakHz: 30,
        modalMassKg: 100,
        modalStiffnessNPerM: 3_553_057.584,
      }),
    ).toThrow(/forcingOrder/);
    expect(() =>
      evaluateShaftResonance({
        rpm: Number.MAX_VALUE,
        forcingOrder: Number.MAX_VALUE,
        dominantPeakHz: 30,
        modalMassKg: Number.MIN_VALUE,
        modalStiffnessNPerM: Number.MAX_VALUE,
      }),
    ).toThrow(/numerically stable range/);
  });
});
