export const QUALITY_METRIC_DEFINITIONS = [
  {
    key: "first_pass_yield_pct",
    label: "First-pass yield",
    formula: "first-pass accepted quantity / inspected quantity × 100",
  },
  {
    key: "defect_rate_pct",
    label: "Defect rate",
    formula: "defective quantity / inspected quantity × 100",
  },
  {
    key: "rework_rate_pct",
    label: "Rework rate",
    formula: "reworked quantity / inspected quantity × 100",
  },
  {
    key: "scrap_rate_pct",
    label: "Scrap rate",
    formula: "scrapped quantity / inspected quantity × 100",
  },
  {
    key: "acceptance_pass_rate_pct",
    label: "Acceptance-test pass rate",
    formula:
      "passed samples / tested samples × 100; test outcomes are used only when sample counts are absent",
  },
  {
    key: "ncr_closure_rate_pct",
    label: "NCR closure rate",
    formula: "closed NCRs / NCRs detected × 100",
  },
  {
    key: "overdue_ncr_rate_pct",
    label: "Overdue open-NCR rate",
    formula: "open NCRs past due / open NCRs × 100",
  },
] as const;

export type QualityMetricKey =
  (typeof QUALITY_METRIC_DEFINITIONS)[number]["key"];

export interface QualityDefectObservation {
  inspectedQuantity: number;
  defectiveQuantity: number;
  firstPassAcceptedQuantity: number;
  reworkedQuantity: number;
  scrappedQuantity: number;
  scrapCost?: number;
  currency?: string;
}

export interface QualityAcceptanceObservation {
  outcome: "pass" | "pass_with_punch" | "fail" | "not_performed" | null;
  testedSamples?: number;
  passedSamples?: number;
}

export interface QualityNcrObservation {
  detectedAt: string;
  dueAt?: string | null;
  closedAt?: string | null;
  status:
    | "open"
    | "contained"
    | "dispositioned"
    | "corrective_action"
    | "verification"
    | "closed"
    | "cancelled";
}

export interface QualityReworkCost {
  currency: string;
  labourCost: number;
  materialCost: number;
  equipmentCost: number;
  downtimeCost: number;
  externalCost: number;
}

export interface QualityCostEntry {
  currency: string;
  category:
    "prevention" | "appraisal" | "internal_failure" | "external_failure";
  amount: number;
}

export interface QualityMetricValue {
  key: QualityMetricKey;
  label: string;
  value: number | null;
  unit: "%";
  numerator: number;
  denominator: number;
  formula: string;
}

export interface QualityCostOfQuality {
  currency: string;
  prevention: number;
  appraisal: number;
  internalFailure: number;
  externalFailure: number;
  costOfPoorQuality: number;
  totalCostOfQuality: number;
}

export interface QualityScorecard {
  metrics: QualityMetricValue[];
  ncrAging: {
    open: number;
    overdue: number;
    averageOpenAgeDays: number | null;
    oldestOpenAgeDays: number | null;
  };
  costByCurrency: QualityCostOfQuality[];
  basis: string;
}

const DAY_MS = 86_400_000;

function safeNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be a finite non-negative number.`);
  return value;
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0
    ? Math.round((numerator / denominator) * 100 * 100) / 100
    : null;
}

function ageDays(from: string, to: Date): number {
  const start = new Date(from);
  if (Number.isNaN(start.getTime()))
    throw new Error(`Invalid NCR detected date: ${from}`);
  return Math.max(0, Math.floor((to.getTime() - start.getTime()) / DAY_MS));
}

export function computeQualityScorecard(input: {
  defects: QualityDefectObservation[];
  acceptanceTests: QualityAcceptanceObservation[];
  ncrs: QualityNcrObservation[];
  reworkCosts: QualityReworkCost[];
  costEntries: QualityCostEntry[];
  asOf?: Date;
}): QualityScorecard {
  const asOf = input.asOf ?? new Date();
  const totals = input.defects.reduce(
    (result, defect, index) => {
      const inspected = safeNonNegative(
        defect.inspectedQuantity,
        `defects[${index}].inspectedQuantity`,
      );
      const defective = safeNonNegative(
        defect.defectiveQuantity,
        `defects[${index}].defectiveQuantity`,
      );
      const firstPass = safeNonNegative(
        defect.firstPassAcceptedQuantity,
        `defects[${index}].firstPassAcceptedQuantity`,
      );
      const reworked = safeNonNegative(
        defect.reworkedQuantity,
        `defects[${index}].reworkedQuantity`,
      );
      const scrapped = safeNonNegative(
        defect.scrappedQuantity,
        `defects[${index}].scrappedQuantity`,
      );
      if (defective > inspected || firstPass > inspected)
        throw new Error(
          "Defective and first-pass quantities cannot exceed inspected quantity.",
        );
      if (reworked + scrapped > defective)
        throw new Error(
          "Reworked plus scrapped quantity cannot exceed defective quantity.",
        );
      result.inspected += inspected;
      result.defective += defective;
      result.firstPass += firstPass;
      result.reworked += reworked;
      result.scrapped += scrapped;
      return result;
    },
    { inspected: 0, defective: 0, firstPass: 0, reworked: 0, scrapped: 0 },
  );

  let testedSamples = 0;
  let passedSamples = 0;
  let outcomeTests = 0;
  let outcomePasses = 0;
  for (const test of input.acceptanceTests) {
    if ((test.testedSamples ?? 0) > 0) {
      const tested = safeNonNegative(test.testedSamples!, "testedSamples");
      const passed = safeNonNegative(test.passedSamples ?? 0, "passedSamples");
      if (passed > tested)
        throw new Error("Passed samples cannot exceed tested samples.");
      testedSamples += tested;
      passedSamples += passed;
    } else if (test.outcome && test.outcome !== "not_performed") {
      outcomeTests += 1;
      if (test.outcome === "pass") outcomePasses += 1;
    }
  }
  const acceptanceNumerator = testedSamples > 0 ? passedSamples : outcomePasses;
  const acceptanceDenominator =
    testedSamples > 0 ? testedSamples : outcomeTests;

  const activeNcrs = input.ncrs.filter((ncr) => ncr.status !== "cancelled");
  const closedNcrs = activeNcrs.filter(
    (ncr) => ncr.status === "closed" && Boolean(ncr.closedAt),
  );
  const openNcrs = activeNcrs.filter((ncr) => ncr.status !== "closed");
  const overdueNcrs = openNcrs.filter(
    (ncr) => ncr.dueAt && new Date(ncr.dueAt).getTime() < asOf.getTime(),
  );
  const openAges = openNcrs.map((ncr) => ageDays(ncr.detectedAt, asOf));

  const metricNumbers: Record<
    QualityMetricKey,
    { numerator: number; denominator: number }
  > = {
    first_pass_yield_pct: {
      numerator: totals.firstPass,
      denominator: totals.inspected,
    },
    defect_rate_pct: {
      numerator: totals.defective,
      denominator: totals.inspected,
    },
    rework_rate_pct: {
      numerator: totals.reworked,
      denominator: totals.inspected,
    },
    scrap_rate_pct: {
      numerator: totals.scrapped,
      denominator: totals.inspected,
    },
    acceptance_pass_rate_pct: {
      numerator: acceptanceNumerator,
      denominator: acceptanceDenominator,
    },
    ncr_closure_rate_pct: {
      numerator: closedNcrs.length,
      denominator: activeNcrs.length,
    },
    overdue_ncr_rate_pct: {
      numerator: overdueNcrs.length,
      denominator: openNcrs.length,
    },
  };

  const costs = new Map<
    string,
    Omit<
      QualityCostOfQuality,
      "currency" | "costOfPoorQuality" | "totalCostOfQuality"
    >
  >();
  const bucket = (currency: string) => {
    const code = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code))
      throw new Error(`Currency must be a three-letter code: ${currency}`);
    const existing = costs.get(code) ?? {
      prevention: 0,
      appraisal: 0,
      internalFailure: 0,
      externalFailure: 0,
    };
    costs.set(code, existing);
    return existing;
  };

  for (const defect of input.defects) {
    if ((defect.scrapCost ?? 0) > 0) {
      if (!defect.currency) throw new Error("Scrap cost requires a currency.");
      bucket(defect.currency).internalFailure += safeNonNegative(
        defect.scrapCost!,
        "scrapCost",
      );
    }
  }
  for (const rework of input.reworkCosts) {
    bucket(rework.currency).internalFailure +=
      safeNonNegative(rework.labourCost, "labourCost") +
      safeNonNegative(rework.materialCost, "materialCost") +
      safeNonNegative(rework.equipmentCost, "equipmentCost") +
      safeNonNegative(rework.downtimeCost, "downtimeCost") +
      safeNonNegative(rework.externalCost, "externalCost");
  }
  for (const entry of input.costEntries) {
    const target = bucket(entry.currency);
    const amount = safeNonNegative(entry.amount, "quality cost amount");
    if (entry.category === "prevention") target.prevention += amount;
    if (entry.category === "appraisal") target.appraisal += amount;
    if (entry.category === "internal_failure") target.internalFailure += amount;
    if (entry.category === "external_failure") target.externalFailure += amount;
  }

  return {
    metrics: QUALITY_METRIC_DEFINITIONS.map((definition) => {
      const values = metricNumbers[definition.key];
      return {
        ...definition,
        value: percentage(values.numerator, values.denominator),
        unit: "%" as const,
        ...values,
      };
    }),
    ncrAging: {
      open: openNcrs.length,
      overdue: overdueNcrs.length,
      averageOpenAgeDays: openAges.length
        ? Math.round(
            (openAges.reduce((sum, age) => sum + age, 0) / openAges.length) *
              10,
          ) / 10
        : null,
      oldestOpenAgeDays: openAges.length ? Math.max(...openAges) : null,
    },
    costByCurrency: [...costs.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, values]) => ({
        currency,
        ...values,
        costOfPoorQuality: values.internalFailure + values.externalFailure,
        totalCostOfQuality:
          values.prevention +
          values.appraisal +
          values.internalFailure +
          values.externalFailure,
      })),
    basis:
      "Seven metrics are derived from recorded quantities, test outcomes and NCR dates. Cost of poor quality includes internal and external failure cost only; prevention and appraisal remain visible but excluded. Currencies are never combined.",
  };
}
