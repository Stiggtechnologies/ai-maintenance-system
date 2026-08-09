/**
 * Validation for human-factors analysis.
 *
 * The roster fixture is worked out by hand against a fixed clock so every
 * consecutive-day count and hours total below is exact arithmetic rather than
 * whatever the code emitted. The refusals matter as much as the counts: an
 * unrostered worker must never read as a rested one, and an unbounded roster
 * must never read as a compliant one.
 */
import { describe, expect, it } from "vitest";
import {
  assessFatigue,
  checkCompetency,
  reconcileCapacity,
  type LabourRule,
  type RosteredMember,
} from "./index";

const NOW = new Date("2026-08-17T00:00:00Z");

const RULES: LabourRule[] = [
  {
    ruleKey: "stat_max_days",
    title: "Maximum consecutive days worked",
    source: "statutory",
    limitKind: "max_consecutive_days",
    limitValue: 7,
  },
  {
    ruleKey: "stat_rest",
    title: "Minimum rest between shifts",
    source: "statutory",
    limitKind: "min_rest_hours_between_shifts",
    limitValue: 10,
  },
  {
    ruleKey: "agreement_shift",
    title: "Maximum shift length",
    source: "labour_agreement",
    limitKind: "max_hours_per_shift",
    limitValue: 12,
  },
  {
    ruleKey: "company_7day",
    title: "Maximum hours in 7 days",
    source: "company_standard",
    limitKind: "max_hours_per_7_days",
    limitValue: 60,
  },
];

/** Eleven consecutive 12-hour days ending the day before `NOW`. */
function elevenStraight(): RosteredMember {
  const shifts = [];
  for (let d = 11; d >= 1; d--) {
    const start = new Date(NOW.getTime() - d * 86_400_000);
    start.setUTCHours(6, 0, 0, 0);
    const end = new Date(start.getTime() + 12 * 3_600_000);
    shifts.push({
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      shiftKind: "day",
    });
  }
  return { memberId: 1, displayName: "A. Worker", craft: "Millwright", shifts };
}

/** Five days on, two off, five days on — eight hours each, no breach. */
function fiveTwoFive(): RosteredMember {
  const shifts = [];
  for (const d of [14, 13, 12, 11, 10, 7, 6, 5, 4, 3]) {
    const start = new Date(NOW.getTime() - d * 86_400_000);
    start.setUTCHours(7, 0, 0, 0);
    const end = new Date(start.getTime() + 8 * 3_600_000);
    shifts.push({
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      shiftKind: "day",
    });
  }
  return { memberId: 2, displayName: "B. Steady", craft: "Millwright", shifts };
}

describe("assessFatigue", () => {
  it("finds eleven consecutive days against a seven-day statutory limit", () => {
    const r = assessFatigue([elevenStraight()], RULES, NOW);
    const days = r.breaches.find((b) => b.ruleKey === "stat_max_days");
    expect(days?.observedValue).toBe(11);
    expect(days?.limitValue).toBe(7);
    expect(days?.source).toBe("statutory");
  });

  it("counts hours in the trailing 7 days, not the whole roster", () => {
    // Days 1..7 back = 7 shifts x 12 h = 84 h, against a 60 h limit.
    const r = assessFatigue([elevenStraight()], RULES, NOW);
    const wk = r.breaches.find((b) => b.ruleKey === "company_7day");
    expect(wk?.observedValue).toBe(84);
  });

  it("puts statutory breaches first and says they cannot be waived", () => {
    const r = assessFatigue([elevenStraight()], RULES, NOW);
    expect(r.breaches[0].source).toBe("statutory");
    expect(r.statutoryBreaches.length).toBeGreaterThan(0);
    // Singular: exactly one statutory breach here.
    expect(r.reason).toMatch(
      /1 of them is STATUTORY and cannot be waived on site/,
    );
  });

  it("clears a roster that stays inside every limit", () => {
    const r = assessFatigue([fiveTwoFive()], RULES, NOW);
    expect(r.breaches).toEqual([]);
    expect(r.reason).toMatch(/No breach of 4 labour rule\(s\)/);
  });

  it("treats a rest limit as a MINIMUM, not a maximum", () => {
    // Two 12-hour shifts with only 6 hours between them.
    const s1 = {
      startsAt: "2026-08-10T06:00:00Z",
      endsAt: "2026-08-10T18:00:00Z",
      shiftKind: "day",
    };
    const s2 = {
      startsAt: "2026-08-11T00:00:00Z",
      endsAt: "2026-08-11T12:00:00Z",
      shiftKind: "night",
    };
    const r = assessFatigue(
      [{ memberId: 3, displayName: "C. Callout", shifts: [s1, s2] }],
      RULES,
      NOW,
    );
    const rest = r.breaches.find((b) => b.ruleKey === "stat_rest");
    expect(rest?.observedValue).toBe(6);
    expect(rest?.reason).toMatch(/against a 10 h minimum/);
  });

  it("does not count leave or training as time worked", () => {
    const leaveOnly: RosteredMember = {
      memberId: 4,
      displayName: "D. Onleave",
      shifts: Array.from({ length: 11 }, (_, i) => {
        const start = new Date(NOW.getTime() - (i + 1) * 86_400_000);
        start.setUTCHours(6, 0, 0, 0);
        return {
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 12 * 3_600_000).toISOString(),
          shiftKind: "leave",
        };
      }),
    };
    const r = assessFatigue([leaveOnly], RULES, NOW);
    expect(r.breaches).toEqual([]);
  });

  it("flags a thin roster rather than reading it as light work", () => {
    const barely: RosteredMember = {
      memberId: 5,
      displayName: "E. Sparse",
      shifts: [
        {
          startsAt: "2026-08-15T06:00:00Z",
          endsAt: "2026-08-15T14:00:00Z",
          shiftKind: "day",
        },
      ],
    };
    const r = assessFatigue([barely], RULES, NOW, 21);
    expect(r.membersWithThinRoster).toEqual(["E. Sparse"]);
    expect(r.reason).toMatch(/a gap in the data, not a light workload/i);
  });

  it("only applies a craft-scoped rule to that craft", () => {
    const electricianRule: LabourRule = {
      ruleKey: "elec_only",
      title: "Electrician shift cap",
      source: "company_standard",
      limitKind: "max_hours_per_shift",
      limitValue: 8,
      appliesToCraft: "Electrician",
    };
    const r = assessFatigue([elevenStraight()], [electricianRule], NOW);
    // The worker is a Millwright, so a 12-hour shift does not breach it.
    expect(r.breaches).toEqual([]);
  });

  it("REFUSES to read an unbounded roster as compliant", () => {
    const r = assessFatigue([elevenStraight()], [], NOW);
    expect(r.breaches).toEqual([]);
    expect(r.reason).toMatch(/no breaches by construction/i);
    expect(r.reason).toMatch(/not the same as a rested workforce/i);
  });

  it("REFUSES to read an absent roster as rest", () => {
    const r = assessFatigue([], RULES, NOW);
    expect(r.reason).toMatch(/an unrostered worker is not a rested one/i);
  });
});

describe("checkCompetency", () => {
  const REQUIRED = [
    {
      competencyKey: "conf_space",
      title: "Confined space entry",
      isStatutory: true,
    },
    { competencyKey: "rigging", title: "Rigging level 2", isStatutory: false },
  ];

  it("passes when everything is held and current", () => {
    const v = checkCompetency(
      REQUIRED,
      [
        { competencyKey: "conf_space", expiresOn: "2027-06-01" },
        { competencyKey: "rigging", expiresOn: null },
      ],
      NOW,
    );
    expect(v.qualified).toBe(true);
    expect(v.blockedByStatutory).toBe(false);
  });

  it("blocks hard on an expired STATUTORY authorisation", () => {
    const v = checkCompetency(
      REQUIRED,
      [
        { competencyKey: "conf_space", expiresOn: "2026-01-01" },
        { competencyKey: "rigging" },
      ],
      NOW,
    );
    expect(v.qualified).toBe(false);
    expect(v.blockedByStatutory).toBe(true);
    expect(v.reason).toMatch(/cannot be waived on site/i);
  });

  it("does not escalate a lapsed non-statutory skill to a statutory block", () => {
    const v = checkCompetency(
      REQUIRED,
      [
        { competencyKey: "conf_space", expiresOn: "2027-06-01" },
        { competencyKey: "rigging", expiresOn: "2026-01-01" },
      ],
      NOW,
    );
    expect(v.qualified).toBe(false);
    expect(v.blockedByStatutory).toBe(false);
    expect(v.expired).toEqual(["Rigging level 2"]);
  });

  it("warns on an expiry inside the window without failing it", () => {
    const v = checkCompetency(
      REQUIRED,
      [
        { competencyKey: "conf_space", expiresOn: "2026-10-01" },
        { competencyKey: "rigging" },
      ],
      NOW,
      90,
    );
    expect(v.qualified).toBe(true);
    expect(v.expiringSoon).toEqual(["Confined space entry"]);
  });

  it("REFUSES to read no stated requirement as no requirement", () => {
    const v = checkCompetency([], [], NOW);
    expect(v.reason).toMatch(/not the same as none being needed/i);
    expect(v.reason).toMatch(/has not been assessed/i);
  });
});

describe("reconcileCapacity", () => {
  it("reconciles when the deductions explain the gap", () => {
    // 8 FTE x 40 h = 320; deductions 110; declared 210.
    const r = reconcileCapacity(
      8,
      40,
      [
        { kind: "leave", hours: 32 },
        { kind: "training", hours: 16 },
        { kind: "indirect_time", hours: 40 },
        { kind: "toolbox_and_permits", hours: 22 },
      ],
      210,
    );
    expect(r.theoretical).toBe(320);
    expect(r.deducted).toBe(110);
    expect(r.reconciles).toBe(true);
  });

  it("names the discrepancy and says which number wins", () => {
    const r = reconcileCapacity(8, 40, [{ kind: "leave", hours: 32 }], 210);
    expect(r.reconciles).toBe(false);
    expect(r.reason).toMatch(/78.0-hour discrepancy/);
    expect(r.reason).toMatch(/declared figure is the one the scheduler uses/i);
  });

  it("calls an unexplained gap unexplained rather than wrong", () => {
    const r = reconcileCapacity(8, 40, [], 210);
    expect(r.reason).toMatch(/unexplained rather than justified/i);
    expect(r.reason).toMatch(
      /probably right, and nothing here can show that it is/i,
    );
  });

  it("REFUSES to treat theoretical hours as a capacity", () => {
    const r = reconcileCapacity(8, 40, [], null);
    expect(r.declared).toBeNull();
    expect(r.reason).toMatch(/320 theoretical hours is not a capacity/);
  });
});
