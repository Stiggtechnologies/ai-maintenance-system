/**
 * Model shortlisting and twin-depth assessment.
 *
 * Two questions that look like one and are not:
 *
 *   "What model is this machine?"  — a fact about the fleet. Research cannot
 *   answer it. The most a catalogue can do is narrow the field and say how far
 *   it narrowed, which is what shortlistModels does.
 *
 *   "Is the twin we compiled worth anything?" — a fact about the library. A
 *   twin built from a template with no components is a shell: it has a name and
 *   a class and nothing to reason about. assessTwinDepth exists because a
 *   coverage percentage counts shells as covered, and that reads as progress.
 *
 * Pure functions. No database, no network.
 */

export type Maturity =
  | "draft"
  | "ai_extracted"
  | "engineer_reviewed"
  | "field_validated"
  | "approved";

export interface CatalogueEntry {
  manufacturer: string;
  model: string;
  assetClass: string;
  sizeClass?: string | null;
  maturity: Maturity;
}

export interface AssetForMatching {
  id: string;
  name: string;
  assetClass: string | null;
  manufacturer: string | null;
  model: string | null;
}

export type ShortlistVerdict =
  | "already_known"
  | "no_candidates"
  | "single_candidate"
  | "ambiguous_model"
  | "ambiguous_manufacturer";

export interface Shortlist {
  assetId: string;
  verdict: ShortlistVerdict;
  candidates: CatalogueEntry[];
  /** True only when the verdict narrows to exactly one plausible model. */
  actionable: boolean;
  reason: string;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Narrow an asset to catalogue candidates.
 *
 * `aliases` translates the operator's local class label into the catalogue's
 * vocabulary. It is a parameter rather than a constant because every operator
 * names classes differently, and baking one customer's words into this function
 * would make it wrong for the next one.
 */
export function shortlistModels(
  asset: AssetForMatching,
  catalogue: CatalogueEntry[],
  aliases: Record<string, string> = {},
): Shortlist {
  if (asset.model && asset.model.trim() !== "") {
    return {
      assetId: asset.id,
      verdict: "already_known",
      candidates: [],
      actionable: false,
      reason: `Model already recorded as "${asset.model}". Nothing to propose; a catalogue must not overwrite a recorded fact.`,
    };
  }

  const local = norm(asset.assetClass);
  const catalogueClass = norm(
    aliases[asset.assetClass ?? ""] ?? asset.assetClass,
  );
  const translated = catalogueClass !== local && catalogueClass !== "";
  const prefix = translated
    ? `Read as catalogue class "${aliases[asset.assetClass ?? ""]}". `
    : "";

  const byClass = catalogue.filter(
    (c) => norm(c.assetClass) === catalogueClass,
  );
  const make = norm(asset.manufacturer);
  const candidates = make
    ? byClass.filter((c) => norm(c.manufacturer) === make)
    : byClass;

  if (candidates.length === 0) {
    return {
      assetId: asset.id,
      verdict: "no_candidates",
      candidates: [],
      actionable: false,
      reason:
        prefix +
        `No catalogue entry for class "${asset.assetClass ?? "(none)"}"` +
        (asset.manufacturer ? ` from ${asset.manufacturer}` : "") +
        `. Research has not established what models exist here, so nothing is proposed.`,
    };
  }

  const makes = new Set(candidates.map((c) => norm(c.manufacturer)));

  if (!make && makes.size > 1) {
    return {
      assetId: asset.id,
      verdict: "ambiguous_manufacturer",
      candidates,
      actionable: false,
      reason:
        prefix +
        `${candidates.length} candidate(s) across ${makes.size} manufacturer(s). The asset does not record a make, so the catalogue cannot narrow this. Naming the manufacturer first is the cheaper half of the problem.`,
    };
  }

  if (candidates.length === 1) {
    return {
      assetId: asset.id,
      verdict: "single_candidate",
      candidates,
      // Actionable means "worth putting in front of a person", not "safe to
      // write". A fleet can run a model the catalogue does not list.
      actionable: true,
      reason:
        prefix +
        `Exactly one catalogued ${candidates[0].manufacturer} model matches this class. That makes it the only candidate, not a confirmed fact — a fleet can run a model the catalogue does not list. A person assigns it.`,
    };
  }

  return {
    assetId: asset.id,
    verdict: "ambiguous_model",
    candidates,
    actionable: false,
    reason:
      prefix +
      `${candidates.length} catalogued models match this class. Distinguishing them needs something this register does not hold — a serial number, a nameplate photograph or the purchase record.`,
  };
}

export interface TwinInstanceSummary {
  templateKey: string;
  fit: "direct" | "approximate" | "none";
  /** Components the compiled template actually carries. */
  componentCount: number;
  failureModeCount: number;
  hasOverlay: boolean;
  assetCount: number;
}

export interface TwinDepthVerdict {
  templateKey: string;
  /** Carried through so two rows on the same template stay distinguishable. */
  fit: "direct" | "approximate" | "none";
  assetCount: number;
  /**
   * shell   — template carries no components; the twin can name the machine
   *           and nothing else.
   * partial — has components but no failure modes, or rests on an approximate
   *           class fit.
   * usable  — components and failure modes, direct fit.
   */
  depth: "shell" | "partial" | "usable";
  reason: string;
}

export interface TwinCoverage {
  assetsTotal: number;
  assetsWithTwin: number;
  /** Assets whose twin is a shell. Counted OUT of meaningful coverage. */
  assetsOnShellTwins: number;
  /** Coverage that survives the shell test. The honest number. */
  meaningfulCoveragePct: number;
  /** Naive coverage — stated only so the gap between the two is visible. */
  nominalCoveragePct: number;
  verdicts: TwinDepthVerdict[];
  reason: string;
}

export function assessTwinDepth(
  instances: TwinInstanceSummary[],
  assetsTotal: number,
): TwinCoverage {
  const verdicts: TwinDepthVerdict[] = instances.map((i) => {
    if (i.componentCount === 0) {
      return {
        templateKey: i.templateKey,
        fit: i.fit,
        assetCount: i.assetCount,
        depth: "shell",
        reason: `${i.templateKey} carries no components. A twin compiled from it names the machine and its functions and has nothing to reason about — no failure modes, no detection methods, no intervals. It is scaffolding, not a model.`,
      };
    }
    if (i.failureModeCount === 0) {
      return {
        templateKey: i.templateKey,
        fit: i.fit,
        assetCount: i.assetCount,
        depth: "partial",
        reason: `${i.templateKey} has ${i.componentCount} component(s) but no failure modes, so it can describe the machine and cannot predict anything about it.`,
      };
    }
    if (i.fit === "approximate") {
      return {
        templateKey: i.templateKey,
        fit: i.fit,
        assetCount: i.assetCount,
        depth: "partial",
        reason: `${i.templateKey} is a complete template applied on an approximate class fit. The failure modes transfer; the intervals, component sizes and duty assumptions do not. Usable as structure, not as numbers.`,
      };
    }
    return {
      templateKey: i.templateKey,
      fit: i.fit,
      assetCount: i.assetCount,
      depth: "usable",
      reason: `${i.templateKey} carries ${i.componentCount} component(s) and ${i.failureModeCount} failure mode(s) on a direct class fit.`,
    };
  });

  const withTwin = instances.reduce((n, i) => n + i.assetCount, 0);
  const shells = verdicts
    .filter((v) => v.depth === "shell")
    .reduce((n, v) => n + v.assetCount, 0);
  const meaningful = withTwin - shells;

  const pct = (n: number) =>
    assetsTotal > 0 ? Math.round((n / assetsTotal) * 1000) / 10 : 0;

  const noOverlay = instances.filter((i) => !i.hasOverlay).length;

  return {
    assetsTotal,
    assetsWithTwin: withTwin,
    assetsOnShellTwins: shells,
    meaningfulCoveragePct: pct(meaningful),
    nominalCoveragePct: pct(withTwin),
    verdicts: verdicts.sort((a, b) => b.assetCount - a.assetCount),
    reason:
      assetsTotal === 0
        ? "No assets to assess."
        : withTwin === 0
          ? // Zero twins is not a clean bill of health, and the sentences below
            // would read as one: "every twin rests on a good template" is
            // vacuously true of no twins at all.
            `None of the ${assetsTotal} asset(s) have a twin. Nothing here has been assessed — this is an absence of coverage, not evidence of good coverage. Twins are provisioned per organization from a class-to-template mapping; if that mapping has not been set up, no twin exists to judge.`
          : `${withTwin} of ${assetsTotal} asset(s) have a twin, which is ${pct(withTwin)}% nominal coverage. ` +
            (shells > 0
              ? `${shells} of those rest on a template with no components, so meaningful coverage is ${pct(meaningful)}%. The gap between those two numbers is the work still to do, and reporting only the first would hide it. `
              : `Every twin rests on a template that carries components. `) +
            (noOverlay === instances.length
              ? `No twin carries an OEM model overlay: the specific model each machine is has not been established, and a researched guess would be indistinguishable from a fact once written.`
              : `${instances.length - noOverlay} template group(s) carry an OEM overlay.`),
  };
}
