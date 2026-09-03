import { describe, expect, it } from "vitest";
import {
  BID_EVALUATION_KINDS,
  CONTRACT_TYPES,
  PROCUREMENT_KERNEL_VERSION,
  PROCUREMENT_STATUS_DIMENSIONS,
  PROCUREMENT_STATUS_VALUES,
  awardReadiness,
  commitmentTotal,
  contractTypeLabel,
  sealedBidDisclosure,
  statusHeadline,
  statusLabel,
  unknownStatusValues,
} from "./procurement";

describe("the §25 vocabulary", () => {
  it("names all four dimensions and nothing else", () => {
    expect([...PROCUREMENT_STATUS_DIMENSIONS]).toEqual([
      "technical",
      "commercial",
      "manufacturing",
      "delivery",
    ]);
  });

  it("gives every dimension its own non-empty vocabulary", () => {
    for (const d of PROCUREMENT_STATUS_DIMENSIONS) {
      expect(PROCUREMENT_STATUS_VALUES[d].length).toBeGreaterThan(1);
      expect(new Set(PROCUREMENT_STATUS_VALUES[d]).size).toBe(
        PROCUREMENT_STATUS_VALUES[d].length,
      );
    }
  });

  it("keeps the commercial `awarded` value, which only the award act writes", () => {
    expect(PROCUREMENT_STATUS_VALUES.commercial).toContain("awarded");
  });

  it("gives manufacturing a not_applicable value, because a services package has no manufacturing leg", () => {
    // Without it, "not_started" forever reads as a stalled package.
    expect(PROCUREMENT_STATUS_VALUES.manufacturing).toContain("not_applicable");
  });

  it("pins the kernel version the lineage row quotes", () => {
    expect(PROCUREMENT_KERNEL_VERSION).toBe(
      "develop-procurement/6A/2026-12-08",
    );
  });
});

describe("statusHeadline names ALL FOUR dimensions, always", () => {
  it("reports every dimension even when three have never moved", () => {
    const line = statusHeadline({
      technical: "technically_approved",
      commercial: "not_started",
      manufacturing: "not_started",
      delivery: "not_started",
    });
    for (const d of PROCUREMENT_STATUS_DIMENSIONS) {
      expect(line).toContain(d);
    }
  });

  it("says `not recorded` rather than dropping an empty dimension", () => {
    // A dimension quietly omitted reads as a dimension that is fine.
    expect(statusLabel("")).toBe("not recorded");
    expect(statusLabel(null)).toBe("not recorded");
    expect(
      statusHeadline({
        technical: "",
        commercial: "tendered",
        manufacturing: "not_applicable",
        delivery: "not_started",
      }),
    ).toContain("technical not recorded");
  });

  it("NAMES a value the vocabulary does not know instead of hiding it", () => {
    expect(
      unknownStatusValues({
        technical: "sparing",
        commercial: "tendered",
        manufacturing: "not_applicable",
        delivery: "not_started",
      }),
    ).toEqual(["technical: sparing"]);
  });
});

describe("contractTypeLabel", () => {
  it("labels all seven I.17 strategies without inventing one", () => {
    expect(CONTRACT_TYPES).toHaveLength(7);
    for (const t of CONTRACT_TYPES) {
      expect(contractTypeLabel(t)).not.toBe("no contract type recorded");
    }
  });

  it("says a missing contract type is missing", () => {
    expect(contractTypeLabel(null)).toBe("no contract type recorded");
  });
});

describe("the lateness rule has exactly ONE implementation", () => {
  it("does not export a client copy of case_procurement_gate_obligations", async () => {
    // A CLIENT COPY OF A SERVER PREDICATE IS THE DEFECT, NOT THE COVERAGE.
    // `packageLateness` claimed to mirror the gate-blocker predicate and did
    // not: it omitted the discharge term and did not require the mandatory
    // flag, so on one rendered payload the package headline said "delivery is
    // forecast 45 day(s) late" directly above an empty blocker list from the
    // server. This test fails if anybody adds a second implementation back.
    const kernel = await import("./procurement");
    for (const banned of [
      "packageLateness",
      "awardOverdue",
      "deliveryLate",
      "packageBlockers",
    ]) {
      expect(Object.keys(kernel)).not.toContain(banned);
    }
  });
});

describe("commitmentTotal REFUSES rather than summing what it has", () => {
  it("refuses over an empty line set — zero lines is not a commitment of zero", () => {
    const r = commitmentTotal([], "S6A-P1");
    expect(r.answered).toBe(false);
    if (r.answered) throw new Error("unreachable");
    expect(r.total).toBeNull();
    expect(r.refusal).toContain("not a commitment of zero");
  });

  it("refuses while ANY line is unpriced, and NAMES the line", () => {
    const r = commitmentTotal(
      [
        {
          lineRef: "L1",
          description: "Pump skid",
          amount: 400_000,
          currency: "CAD",
        },
        {
          lineRef: "L2",
          description: "Site erection",
          amount: null,
          currency: "CAD",
        },
      ],
      "S6A-P1",
    );
    expect(r.answered).toBe(false);
    if (r.answered) throw new Error("unreachable");
    expect(r.total).toBeNull();
    expect(r.unpricedLines).toEqual(["L2 (Site erection)"]);
    expect(r.refusal).toContain("L2 (Site erection)");
    expect(r.refusal).toContain("understates it");
    // The priced total is NOT leaked as a fallback.
    expect(r.refusal).not.toContain("400000");
  });

  it("refuses NaN by name rather than producing a NaN total", () => {
    const r = commitmentTotal(
      [
        {
          lineRef: "L1",
          description: "Pump skid",
          amount: Number.NaN,
          currency: "CAD",
        },
      ],
      "S6A-P1",
    );
    expect(r.answered).toBe(false);
    if (r.answered) throw new Error("unreachable");
    expect(r.refusal).toContain("L1");
    expect(r.refusal).toContain("NaN");
  });

  it("refuses Infinity", () => {
    const r = commitmentTotal(
      [
        {
          lineRef: "L1",
          description: "Pump skid",
          amount: Number.POSITIVE_INFINITY,
          currency: "CAD",
        },
      ],
      "S6A-P1",
    );
    expect(r.answered).toBe(false);
  });

  it("refuses a negative amount — a credit is a separate line", () => {
    const r = commitmentTotal(
      [
        {
          lineRef: "L1",
          description: "Pump skid",
          amount: -1,
          currency: "CAD",
        },
      ],
      "S6A-P1",
    );
    expect(r.answered).toBe(false);
    if (r.answered) throw new Error("unreachable");
    expect(r.refusal).toContain("at least zero");
  });

  it("refuses a mixed-currency sum", () => {
    const r = commitmentTotal(
      [
        {
          lineRef: "L1",
          description: "Pump skid",
          amount: 100,
          currency: "CAD",
        },
        {
          lineRef: "L2",
          description: "Import duty",
          amount: 100,
          currency: "USD",
        },
      ],
      "S6A-P1",
    );
    expect(r.answered).toBe(false);
    if (r.answered) throw new Error("unreachable");
    expect(r.refusal).toContain("no exchange rate");
  });

  it("answers when every line carries a finite, non-negative amount in one currency", () => {
    const r = commitmentTotal(
      [
        {
          lineRef: "L1",
          description: "Pump skid",
          amount: 400_000,
          currency: "CAD",
        },
        {
          lineRef: "L2",
          description: "Site erection",
          amount: 120_000,
          currency: "CAD",
        },
      ],
      "S6A-P1",
    );
    expect(r.answered).toBe(true);
    if (!r.answered) throw new Error("unreachable");
    expect(r.total).toBe(520_000);
    expect(r.currency).toBe("CAD");
    expect(r.lines).toBe(2);
  });

  it("accepts a genuine zero-amount line", () => {
    // Zero is a real agreed amount (a no-charge line). It is the ABSENCE of an
    // amount that refuses, and the two must not be conflated.
    const r = commitmentTotal(
      [
        {
          lineRef: "L1",
          description: "Free-issue spares",
          amount: 0,
          currency: "CAD",
        },
      ],
      "S6A-P1",
    );
    expect(r.answered).toBe(true);
    if (!r.answered) throw new Error("unreachable");
    expect(r.total).toBe(0);
  });
});

describe("awardReadiness refuses an award nobody could defend", () => {
  const ready = {
    packageCode: "S6A-P1",
    bidsOpened: true,
    liveBidCount: 2,
    withdrawnBidCount: 0,
    evaluationsOnWinner: [...BID_EVALUATION_KINDS],
    outcomesOnWinner: ["compliant", "compliant"],
    awarderEvaluated: false,
  };

  it("is ready when the envelope is open, bids exist and both evaluations stand", () => {
    const r = awardReadiness(ready);
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("refuses before the envelope is opened", () => {
    const r = awardReadiness({ ...ready, bidsOpened: false });
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toContain("have not been opened");
  });

  it("REFUSES over zero bids rather than reporting `0 bids evaluated`", () => {
    const r = awardReadiness({
      ...ready,
      liveBidCount: 0,
      withdrawnBidCount: 1,
      evaluationsOnWinner: [],
      outcomesOnWinner: [],
    });
    expect(r.ready).toBe(false);
    const text = r.blockers.join(" ");
    expect(text).toContain("There is nothing to award");
    expect(text).toContain("not a tender whose bids were evaluated");
    expect(text).not.toContain("0 bids evaluated");
  });

  it("names the MISSING evaluation kind, one or both", () => {
    expect(
      awardReadiness({
        ...ready,
        evaluationsOnWinner: ["technical"],
      }).blockers.join(" "),
    ).toContain("no commercial evaluation");
    expect(
      awardReadiness({
        ...ready,
        evaluationsOnWinner: ["commercial"],
      }).blockers.join(" "),
    ).toContain("no technical evaluation");
    expect(
      awardReadiness({ ...ready, evaluationsOnWinner: [] }).blockers.join(" "),
    ).toContain("no commercial and technical evaluation");
  });

  it("refuses a bid an evaluation called non-compliant", () => {
    const r = awardReadiness({
      ...ready,
      outcomesOnWinner: ["compliant", "non_compliant"],
    });
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toContain("NON-COMPLIANT");
  });

  it("refuses when the awarder evaluated a bid on the package", () => {
    const r = awardReadiness({ ...ready, awarderEvaluated: true });
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toContain("ceremonial");
  });

  it("does not report a missing evaluation when there are no bids at all", () => {
    // Two refusals for the same absence would read as two separate problems.
    const r = awardReadiness({
      ...ready,
      liveBidCount: 0,
      withdrawnBidCount: 0,
      evaluationsOnWinner: [],
      outcomesOnWinner: [],
    });
    expect(r.blockers).toHaveLength(1);
  });
});

describe("sealedBidDisclosure never turns an absent sealed price into zero", () => {
  it("says SEALED and shows no number while the envelope is closed", () => {
    const text = sealedBidDisclosure({
      bidRef: "S6A-P1-SUP-A",
      supplier: "Contractor A",
      sealed: true,
      price: null,
      currency: null,
      withdrawn: false,
    });
    expect(text).toContain("SEALED");
    expect(text).not.toContain("0");
  });

  it("shows the price once the envelope is open", () => {
    const text = sealedBidDisclosure({
      bidRef: "S6A-P1-SUP-A",
      supplier: "Contractor A",
      sealed: false,
      price: 240_000,
      currency: "CAD",
      withdrawn: false,
    });
    expect(text).toContain("CAD");
    expect(text).toContain("240,000");
  });

  it("says a withdrawn bid is withdrawn, never that it is cheap", () => {
    const text = sealedBidDisclosure({
      bidRef: "S6A-P1-SUP-B",
      supplier: "Contractor B",
      sealed: false,
      price: 205_000,
      currency: "CAD",
      withdrawn: true,
    });
    expect(text).toContain("withdrawn");
    expect(text).not.toContain("205,000");
  });

  it("says an open bid with no readable price has none, rather than showing 0", () => {
    const text = sealedBidDisclosure({
      bidRef: null,
      supplier: "Contractor C",
      sealed: false,
      price: null,
      currency: "CAD",
      withdrawn: false,
    });
    expect(text).toContain("no readable price");
  });
});
