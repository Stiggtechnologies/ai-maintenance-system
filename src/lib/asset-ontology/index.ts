/**
 * Universal asset ontology (capability register U3.03–U3.07, U3.09–U3.16).
 *
 * The point of this module is to make the platform DECLINE to compute things
 * rather than compute them wrongly.
 *
 * Every analysis already built here — Weibull age replacement, MTBF, P-F
 * intervals, spares holding — assumes a discrete machine with running hours
 * and a serial number. That assumption is right for a pump and wrong for a
 * 40 km pipeline, a population of 40,000 pole-top devices, a bridge, and a
 * firmware image. Running the same arithmetic over those produces numbers that
 * are confidently wrong, which is worse than an empty panel, because a number
 * gets used.
 *
 * So `checkApplicability` gates the analysis and `normaliseRate` fixes the
 * denominator. A rate is only a rate once you know what it is per: a route's
 * failures belong per kilometre-year, a population's per unit-year, and
 * neither is comparable to a machine's per asset-year.
 *
 * `defectDensity` is the analysis a point model cannot express at all: WHERE
 * along the route the failures are. A single MTBF for a whole line averages
 * that away, and the average is exactly the information you needed.
 *
 * Pure: no database, no network.
 */

export type MeasurementBasis =
  "point" | "linear" | "population" | "structure" | "logical" | "natural";

export interface ApplicabilityRule {
  analysisKey: string;
  applicable: boolean;
  reason: string;
}

export interface ClassProfile {
  classKey: string;
  label: string;
  measurementBasis: MeasurementBasis;
  exposureUnit?: string | null;
  failureMeaning?: string | null;
  notes?: string | null;
  applicability: ApplicabilityRule[];
}

export interface ApplicabilityVerdict {
  applicable: boolean;
  reason: string;
}

/**
 * May this analysis be run against this class of asset?
 *
 * An UNKNOWN analysis is refused rather than allowed. The permissive default
 * is the dangerous one: it means every analysis added later silently applies
 * to every asset class until someone remembers to say otherwise.
 */
export function checkApplicability(
  profile: ClassProfile | null | undefined,
  analysisKey: string,
): ApplicabilityVerdict {
  if (!profile) {
    return {
      applicable: false,
      reason:
        "This asset carries no class profile, so there is no basis for deciding whether the analysis applies to it. Classify it first — the default of treating everything as a discrete machine is right for rotating equipment and wrong for everything else.",
    };
  }
  const rule = profile.applicability.find((r) => r.analysisKey === analysisKey);
  if (!rule) {
    return {
      applicable: false,
      reason:
        `No applicability rule is recorded for "${analysisKey}" against a ${profile.measurementBasis} asset. ` +
        `Refused rather than allowed: a permissive default means every analysis added later silently applies ` +
        `to every class until someone remembers to say otherwise.`,
    };
  }
  return { applicable: rule.applicable, reason: rule.reason };
}

export interface RateResult {
  rate: number | null;
  unit: string | null;
  exposure: number | null;
  reason: string;
}

/**
 * Express a failure count as a rate over the denominator its class requires.
 *
 * `exposure` means different things per basis and the caller must supply the
 * right one: asset-years for a point asset, kilometre-years for a route,
 * unit-years for a population. Where a rate is not a meaningful summary at
 * all, no number is returned.
 */
export function normaliseRate(
  basis: MeasurementBasis,
  failures: number,
  exposure: number,
  exposureUnit?: string | null,
): RateResult {
  const refuse = (reason: string): RateResult => ({
    rate: null,
    unit: null,
    exposure: null,
    reason,
  });

  if (basis === "structure") {
    return refuse(
      "A failure rate is not how a structure's condition is expressed. Structures deteriorate against an inspection rating scale rather than producing a series of discrete failures to average between.",
    );
  }
  if (basis === "natural") {
    return refuse(
      "A natural asset has no repair cycle to measure between. Its state is capacity, containment and quality against thresholds, not a failure rate.",
    );
  }
  if (!(exposure > 0)) {
    return refuse(
      `A rate needs a denominator. ${failures} failure(s) over no recorded exposure is a count, and presenting it as a rate would invite comparison with assets that have one.`,
    );
  }
  if (failures < 0) {
    return refuse("A negative failure count is not a measurement.");
  }

  const unit =
    basis === "linear"
      ? (exposureUnit ?? "km-year")
      : basis === "population"
        ? (exposureUnit ?? "unit-year")
        : "asset-year";

  const rate = failures / exposure;
  return {
    rate,
    unit,
    exposure,
    reason:
      `${failures} failure(s) over ${exposure} ${unit.replace("-year", "")}-years is ${rate.toFixed(4)} per ${unit}.` +
      (basis === "linear"
        ? " Expressed per unit length because a single figure for a whole route hides where the failures are and makes routes of different lengths look comparable."
        : basis === "population"
          ? " Expressed per unit because population members are not individually tracked, so a per-asset figure would not correspond to anything."
          : ""),
  };
}

export interface LinearDefect {
  atMeasure: number;
  defectType: string;
  severity?: string | null;
  repairedAt?: string | null;
}

export interface DensityBand {
  fromMeasure: number;
  toMeasure: number;
  defectCount: number;
  densityPerUnit: number;
}

export interface DefectDensityResult {
  totalLength: number;
  openDefects: number;
  overallDensity: number;
  bands: DensityBand[];
  /** Bands carrying a disproportionate share, worst first. */
  hotspots: DensityBand[];
  reason: string;
}

/**
 * Where along the route the defects actually are (U3.03).
 *
 * This is the finding a point model cannot produce: one MTBF for the whole
 * line averages the concentration away, and the concentration is the thing you
 * would act on. Bands are fixed-width so a hotspot cannot be an artefact of
 * choosing convenient boundaries.
 */
export function defectDensity(
  startMeasure: number,
  endMeasure: number,
  defects: LinearDefect[],
  bandWidth = 1,
): DefectDensityResult {
  const totalLength = endMeasure - startMeasure;
  if (!(totalLength > 0)) {
    return {
      totalLength: 0,
      openDefects: 0,
      overallDensity: 0,
      bands: [],
      hotspots: [],
      reason:
        "The route has no length recorded, so density cannot be computed. Length is the denominator this whole analysis rests on.",
    };
  }
  if (!(bandWidth > 0)) {
    return {
      totalLength,
      openDefects: 0,
      overallDensity: 0,
      bands: [],
      hotspots: [],
      reason: "Band width must be positive.",
    };
  }

  const open = defects.filter((d) => !d.repairedAt);
  const bandCount = Math.ceil(totalLength / bandWidth);
  const bands: DensityBand[] = [];
  for (let i = 0; i < bandCount; i++) {
    const from = startMeasure + i * bandWidth;
    const to = Math.min(from + bandWidth, endMeasure);
    const width = to - from;
    // The final band is usually short; counting its defects against a full
    // band width would understate its density.
    const count = open.filter(
      (d) =>
        d.atMeasure >= from &&
        (i === bandCount - 1 ? d.atMeasure <= to : d.atMeasure < to),
    ).length;
    bands.push({
      fromMeasure: from,
      toMeasure: to,
      defectCount: count,
      densityPerUnit: width > 0 ? count / width : 0,
    });
  }

  const overallDensity = open.length / totalLength;
  // A hotspot carries at least twice the route's average density and is not a
  // single defect on a short final band.
  const hotspots = bands
    .filter((b) => b.defectCount > 0 && b.densityPerUnit >= 2 * overallDensity)
    .sort((a, b) => b.densityPerUnit - a.densityPerUnit);

  const hotspotDefects = hotspots.reduce((n, b) => n + b.defectCount, 0);
  const hotspotLength = hotspots.reduce(
    (n, b) => n + (b.toMeasure - b.fromMeasure),
    0,
  );

  return {
    totalLength,
    openDefects: open.length,
    overallDensity,
    bands,
    hotspots,
    reason:
      open.length === 0
        ? `No open defects are recorded over ${totalLength} units of route. That is a real result only if the route has actually been inspected — an uninspected route also has no recorded defects.`
        : hotspots.length === 0
          ? `${open.length} open defect(s) over ${totalLength} units, ${overallDensity.toFixed(3)} per unit, spread without a concentration at this band width.`
          : `${open.length} open defect(s) over ${totalLength} units. ${hotspotDefects} of them — ${((hotspotDefects / open.length) * 100).toFixed(0)}% — fall in ${hotspotLength} unit(s) of route, ${((hotspotLength / totalLength) * 100).toFixed(0)}% of its length. A single figure for the whole route would have averaged that away.`,
  };
}
