/**
 * Validation for supplier and contractor analysis.
 *
 * The three failures being guarded against are all "a number that looks
 * decidable and is not": a bid ranking with no productivity assumption behind
 * it, an obsolescence list sorted by date instead of by exposure, and a
 * sole-source list that mixes a genuine single point of failure with a
 * sourcing job somebody has not finished.
 */
import { describe, expect, it } from "vitest";
import {
  compareBids,
  assessObsolescence,
  soleSourceRisk,
  type Bid,
  type PackageClarity,
} from "./index";

const NOW = new Date("2026-08-17T00:00:00Z");

const CLEAR: PackageClarity = {
  scopeStated: true,
  exclusionsStated: true,
  acceptanceStated: true,
  siteConditionsStated: true,
};

describe("compareBids", () => {
  it("REFUSES to rank when a productivity assumption is missing", () => {
    const bids: Bid[] = [
      {
        supplier: "Alpha",
        price: 100_000,
        labourHours: 1000,
        assumedProductivityFactor: 1.0,
      },
      { supplier: "Bravo", price: 85_000, labourHours: 1000 },
    ];
    const r = compareBids(bids, CLEAR);
    expect(r.comparable).toBe(false);
    expect(r.bestValue).toBeNull();
    expect(r.cheapest).toBe("Bravo");
    expect(r.reason).toMatch(
      /no way to tell whether a lower price reflects efficiency/i,
    );
    // The cheapest is still reported — as a fact, explicitly not a recommendation.
    expect(r.reason).toMatch(/a fact about the prices, not a recommendation/i);
  });

  it("normalises hours to a common productivity assumption", () => {
    // Alpha: 1000 h at 1.0 = 1000 reference-hours, $100/h.
    // Bravo: 1600 h at 0.5 =  800 reference-hours, $106.25/h — dearer per hour
    // of assumed work despite the lower headline price.
    const bids: Bid[] = [
      {
        supplier: "Alpha",
        price: 100_000,
        labourHours: 1000,
        assumedProductivityFactor: 1.0,
      },
      {
        supplier: "Bravo",
        price: 85_000,
        labourHours: 1600,
        assumedProductivityFactor: 0.5,
      },
    ];
    const r = compareBids(bids, CLEAR, 1.0);
    expect(r.comparable).toBe(true);
    const alpha = r.bids.find((b) => b.supplier === "Alpha");
    const bravo = r.bids.find((b) => b.supplier === "Bravo");
    expect(alpha?.normalisedHours).toBe(1000);
    expect(bravo?.normalisedHours).toBe(800);
    expect(alpha?.pricePerNormalisedHour).toBe(100);
    expect(bravo?.pricePerNormalisedHour).toBeCloseTo(106.25, 6);
    expect(r.cheapest).toBe("Bravo");
    expect(r.bestValue).toBe("Alpha");
    expect(r.reason).toMatch(/the productivity assumption doing its job/i);
  });

  it("says so plainly when cheapest and best value are the same bid", () => {
    const bids: Bid[] = [
      {
        supplier: "Alpha",
        price: 90_000,
        labourHours: 1000,
        assumedProductivityFactor: 1.0,
      },
      {
        supplier: "Bravo",
        price: 120_000,
        labourHours: 1000,
        assumedProductivityFactor: 1.0,
      },
    ];
    const r = compareBids(bids, CLEAR);
    expect(r.cheapest).toBe("Alpha");
    expect(r.bestValue).toBe("Alpha");
    expect(r.reason).toMatch(/cheapest on both price and normalised hours/i);
  });

  it("reports scope clarity gaps as the thing that becomes a claim later", () => {
    const r = compareBids(
      [
        {
          supplier: "Alpha",
          price: 100_000,
          labourHours: 1000,
          assumedProductivityFactor: 1,
        },
        {
          supplier: "Bravo",
          price: 95_000,
          labourHours: 950,
          assumedProductivityFactor: 1,
        },
      ],
      {
        scopeStated: true,
        exclusionsStated: false,
        acceptanceStated: false,
        siteConditionsStated: false,
      },
    );
    expect(r.clarityGaps).toHaveLength(3);
    expect(r.reason).toMatch(/3 clarity gap\(s\)/);
  });

  it("REFUSES to treat a single bid as a market test", () => {
    const r = compareBids([{ supplier: "Alpha", price: 100_000 }], CLEAR);
    expect(r.comparable).toBe(false);
    expect(r.reason).toMatch(/a price, not a market test/i);
  });

  it("handles no bids without inventing a winner", () => {
    const r = compareBids([], CLEAR);
    expect(r.cheapest).toBeNull();
    expect(r.reason).toMatch(/No bids are recorded/);
  });
});

describe("assessObsolescence", () => {
  it("ranks by uncovered asset life, not by the end-of-life date", () => {
    const r = assessObsolescence(
      [
        {
          // Goes obsolete sooner, but the machine is retired before it matters.
          materialCode: "SOON-OK",
          description: "",
          lifecycleStatus: "last_time_buy",
          lastTimeBuyDate: "2028-08-17",
          assetRemainingLifeYears: 1,
          assetsUsing: 2,
        },
        {
          // Goes obsolete later, and the machine runs for 20 more years.
          materialCode: "LATER-BAD",
          description: "",
          lifecycleStatus: "last_time_buy",
          lastTimeBuyDate: "2030-08-17",
          assetRemainingLifeYears: 20,
          assetsUsing: 5,
          criticality: "critical",
        },
      ],
      NOW,
    );
    // Sorted by exposure: the later date is the urgent one.
    expect(r[0].materialCode).toBe("LATER-BAD");
    expect(r[0].urgency).toBe("urgent");
    expect(r[0].yearsUncovered).toBeCloseTo(16, 0);
    expect(r[1].materialCode).toBe("SOON-OK");
    expect(r[1].urgency).toBe("none");
    expect(r[1].reason).toMatch(/Nothing to do/);
  });

  it("treats an obsolete part with no last-time buy as having no supply left", () => {
    const r = assessObsolescence(
      [
        {
          materialCode: "GONE",
          description: "",
          lifecycleStatus: "obsolete",
          assetRemainingLifeYears: 5,
          assetsUsing: 1,
        },
      ],
      NOW,
    );
    expect(r[0].yearsUncovered).toBe(5);
    expect(r[0].reason).toMatch(/no source behind them/i);
  });

  it("REFUSES to rate urgency without the asset's remaining life", () => {
    const r = assessObsolescence(
      [
        {
          materialCode: "UNKNOWN-LIFE",
          description: "",
          lifecycleStatus: "end_of_life",
          assetsUsing: 3,
        },
      ],
      NOW,
    );
    expect(r[0].urgency).toBe("watch");
    expect(r[0].yearsUncovered).toBeNull();
    expect(r[0].reason).toMatch(
      /only a problem for as long as the machine outlives it/i,
    );
  });

  it("does not read an unknown lifecycle status as active", () => {
    const r = assessObsolescence(
      [
        {
          materialCode: "X",
          description: "",
          lifecycleStatus: "unknown",
          assetsUsing: 1,
        },
      ],
      NOW,
    );
    expect(r[0].urgency).toBe("none");
    expect(r[0].reason).toMatch(
      /not the same as active — nobody has asked the supplier/i,
    );
  });
});

describe("soleSourceRisk", () => {
  const COUNTS = [
    {
      materialCode: "FD-900",
      criticality: "critical",
      leadTimeDays: 120,
      approvedSuppliers: 1,
      recordedSuppliers: 1,
    },
    {
      materialCode: "SEAL-77",
      criticality: "routine",
      leadTimeDays: 45,
      approvedSuppliers: 1,
      recordedSuppliers: 3,
    },
    {
      materialCode: "BRG-12",
      criticality: "essential",
      leadTimeDays: 30,
      approvedSuppliers: 0,
      recordedSuppliers: 2,
    },
    {
      materialCode: "NUT-1",
      criticality: "routine",
      leadTimeDays: 5,
      approvedSuppliers: 0,
      recordedSuppliers: 0,
    },
    {
      materialCode: "PMP-3",
      criticality: "critical",
      leadTimeDays: 200,
      approvedSuppliers: 2,
      recordedSuppliers: 4,
    },
  ];

  const r = soleSourceRisk(COUNTS);

  it("separates the three cases rather than merging them into one list", () => {
    expect(r.soleApproved.map((x) => x.materialCode)).toEqual([
      "FD-900",
      "SEAL-77",
    ]);
    expect(r.unfinishedSourcing.map((x) => x.materialCode)).toEqual(["BRG-12"]);
    expect(r.noSource.map((x) => x.materialCode)).toEqual(["NUT-1"]);
  });

  it("does not flag a material with two approved suppliers", () => {
    expect(r.soleApproved.map((x) => x.materialCode)).not.toContain("PMP-3");
  });

  it("ranks the critical long-lead item first and names the consequence", () => {
    expect(r.soleApproved[0].materialCode).toBe("FD-900");
    expect(r.reason).toMatch(/FD-900 \(critical\) at 120 days' lead time/);
    expect(r.reason).toMatch(/no second call to make/i);
  });

  it("calls unfinished sourcing what it is", () => {
    expect(r.reason).toMatch(/unfinished sourcing rather than sole source/i);
  });

  it("says nothing can be assessed when there are no supplier records", () => {
    expect(soleSourceRisk([]).reason).toMatch(/cannot be assessed/i);
  });
});
