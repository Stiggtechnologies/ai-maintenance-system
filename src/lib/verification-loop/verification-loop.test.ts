import { describe, expect, it } from "vitest";
import { assessLoop, type VerificationPosture } from "./index";

const posture = (
  o: Partial<VerificationPosture> = {},
): VerificationPosture => ({
  actionedRecommendations: 10,
  withObligation: 8,
  openObligations: 4,
  overdue: 1,
  achieved: 3,
  notAchieved: 1,
  inconclusive: 0,
  waived: 0,
  actionedWithoutObligation: 2,
  ...o,
});

describe("assessLoop — the three open states must never render alike", () => {
  it("computes closure over ACTIONED recommendations, not over obligations", () => {
    const r = assessLoop(posture());
    // 4 executed of 10 actioned. Dividing by obligations (8) would flatter the
    // rate by excluding exactly the unwatched loops.
    expect(r.loopClosureRate).toBeCloseTo(0.4, 6);
    expect(r.outcomeSuccessRate).toBeCloseTo(3 / 4, 6);
  });

  it("separates unwatched, overdue and pending", () => {
    const r = assessLoop(posture());
    expect(r.unwatched).toBe(2);
    expect(r.overdue).toBe(1);
    expect(r.pending).toBe(3);
    expect(r.reason).toMatch(
      /unwatched loop renders exactly like a closed one/,
    );
    expect(r.reason).toMatch(/indistinguishable from one that passed/);
  });

  it("treats a recorded failure as the system working", () => {
    const r = assessLoop(posture());
    expect(r.hasRecordedFailure).toBe(true);
    expect(r.reason).toMatch(/the system working, not failing/);
  });

  it("calls an all-pass history unproven, not healthy", () => {
    const r = assessLoop(posture({ notAchieved: 0, achieved: 4 }));
    expect(r.hasRecordedFailure).toBe(false);
    expect(r.reason).toMatch(/unproven against the case it exists for/);
  });

  it("names the dominant problem when most loops are unwatched", () => {
    const r = assessLoop(
      posture({
        withObligation: 2,
        actionedWithoutObligation: 8,
        achieved: 1,
        notAchieved: 0,
      }),
    );
    expect(r.healthiest).toBe("unwatched");
  });

  it("does not read an empty system as a closed loop", () => {
    const r = assessLoop(posture({ actionedRecommendations: 0 }));
    expect(r.loopClosureRate).toBeNull();
    expect(r.healthiest).toBe("empty");
    expect(r.reason).toMatch(/absence of activity, not a closed loop/);
  });

  it("handles a null posture the same as empty", () => {
    expect(assessLoop(null).healthiest).toBe("empty");
  });

  it("does not claim a success rate before anything executed", () => {
    const r = assessLoop(
      posture({
        achieved: 0,
        notAchieved: 0,
        inconclusive: 0,
        openObligations: 8,
        overdue: 0,
      }),
    );
    expect(r.outcomeSuccessRate).toBeNull();
    expect(r.healthiest).toBe("collecting");
  });
});
