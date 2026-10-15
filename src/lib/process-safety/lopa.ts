/**
 * Layer of Protection Analysis (BOK-06) — the step that sets the SIL target
 * that verifySIF() then checks.
 *
 * verifySIF computes the PFD a safety-instrumented function ACHIEVES. Without
 * LOPA nothing says what it must achieve, so a "SIL 2 verified" result has no
 * defensible target behind it. LOPA per CCPS (Layer of Protection Analysis,
 * 2001) and IEC 61511-3 Annex F:
 *
 *   mitigated frequency = IEF × Π(enabling / conditional modifiers) × Π(IPL PFD)
 *   required SIF PFD    = tolerable frequency / mitigated frequency
 *
 * Every number is the customer's, with a basis: initiating-event frequencies,
 * modifier probabilities, IPL PFDs and the tolerable-frequency criterion are
 * never defaulted here. An IPL earns credit only if it is independent of the
 * initiating cause and of the other IPLs, specific to the scenario, and
 * auditable (CCPS ch. 6 "core attributes"). A layer that fails any attribute
 * is listed as NOT credited, not silently dropped, so a reviewer sees it.
 *
 * Pure: no I/O, no randomness, no LLM.
 */

import { silForPfd } from "./index";
import type { SIL } from "./index";

export interface Basis {
  basis: string;
}

export interface InitiatingEvent extends Basis {
  description: string;
  frequencyPerYear: number;
}

export interface Modifier extends Basis {
  description: string;
  probability: number;
}

export interface ProtectionLayer extends Basis {
  name: string;
  pfd: number;
  independent: boolean;
  specific: boolean;
  auditable: boolean;
  /** True when the layer shares equipment or cause with the initiating event. */
  sharesInitiatingCause?: boolean;
}

export interface LopaScenario {
  id: string;
  consequence: string;
  initiatingEvent: InitiatingEvent;
  modifiers?: Modifier[];
  layers: ProtectionLayer[];
  tolerableFrequencyPerYear: number;
  /** The corporate risk criterion the tolerable frequency comes from. */
  criteriaBasis: string;
}

export interface LopaResult {
  scenarioId: string;
  unmitigatedFrequency: number;
  mitigatedFrequency: number;
  creditedLayers: string[];
  uncreditedLayers: { name: string; why: string }[];
  tolerableFrequency: number;
  sifRequired: boolean;
  /** Required SIF PFD; null when no SIF is required. */
  requiredSifPfd: number | null;
  requiredRiskReduction: number | null;
  silTarget: SIL | null;
  /** True when the gap exceeds what a SIL 3 function can credibly close. */
  beyondSil3: boolean;
  reason: string;
}

const needBasis = (what: string, b: Basis) => {
  if (!b.basis || b.basis.trim().length < 10)
    throw new Error(
      `${what} needs a stated basis (data source, study, or standard reference).`,
    );
};

export function analyseLopa(s: LopaScenario): LopaResult {
  const ie = s.initiatingEvent;
  needBasis(`Initiating event "${ie.description}"`, ie);
  if (!(ie.frequencyPerYear > 0))
    throw new Error("The initiating-event frequency must be positive.");
  if (!(s.tolerableFrequencyPerYear > 0))
    throw new Error("The tolerable frequency must be positive.");
  if (!s.criteriaBasis || s.criteriaBasis.trim().length < 10)
    throw new Error(
      "The tolerable frequency must cite the corporate risk criterion it comes from.",
    );

  let f = ie.frequencyPerYear;
  for (const m of s.modifiers ?? []) {
    needBasis(`Modifier "${m.description}"`, m);
    if (!(m.probability > 0 && m.probability <= 1))
      throw new Error(
        `Modifier "${m.description}" must be a probability in (0, 1].`,
      );
    f *= m.probability;
  }
  const unmitigated = f;

  const credited: string[] = [];
  const uncredited: { name: string; why: string }[] = [];
  for (const l of s.layers) {
    needBasis(`Layer "${l.name}"`, l);
    if (!(l.pfd > 0 && l.pfd <= 1))
      throw new Error(`Layer "${l.name}" needs a PFD in (0, 1].`);
    const why: string[] = [];
    if (!l.independent) why.push("not independent");
    if (!l.specific) why.push("not specific to this scenario");
    if (!l.auditable) why.push("not auditable");
    if (l.sharesInitiatingCause) why.push("shares the initiating cause");
    if (why.length) {
      uncredited.push({ name: l.name, why: why.join(", ") });
      continue;
    }
    credited.push(l.name);
    f *= l.pfd;
  }

  const tol = s.tolerableFrequencyPerYear;
  if (f <= tol) {
    return {
      scenarioId: s.id,
      unmitigatedFrequency: unmitigated,
      mitigatedFrequency: f,
      creditedLayers: credited,
      uncreditedLayers: uncredited,
      tolerableFrequency: tol,
      sifRequired: false,
      requiredSifPfd: null,
      requiredRiskReduction: null,
      silTarget: null,
      beyondSil3: false,
      reason: `Credited layers bring the frequency to ${f.toExponential(2)}/yr, within the tolerable ${tol.toExponential(2)}/yr; no SIF is required for this scenario.`,
    };
  }
  const pfd = tol / f;
  const rrf = 1 / pfd;
  const sil = pfd >= 0.1 ? 0 : silForPfd(pfd);
  // SIL 3 covers PFD in [1e-4, 1e-3); anything below 1e-4 needs SIL 4.
  const beyondSil3 = pfd < 1e-4;
  return {
    scenarioId: s.id,
    unmitigatedFrequency: unmitigated,
    mitigatedFrequency: f,
    creditedLayers: credited,
    uncreditedLayers: uncredited,
    tolerableFrequency: tol,
    sifRequired: true,
    requiredSifPfd: pfd,
    requiredRiskReduction: rrf,
    silTarget: sil,
    beyondSil3,
    reason: beyondSil3
      ? `A risk reduction of ${rrf.toFixed(0)} is needed: beyond SIL 3. Process-industry practice (IEC 61511) treats this as a signal to redesign or add independent layers rather than rely on one SIF.`
      : sil === 0
        ? `A risk reduction of ${rrf.toFixed(1)} is needed; that is below SIL 1, so a SIL-rated function is not required, but the layer providing it must still be specified and tested.`
        : `A SIF with PFD ≤ ${pfd.toExponential(2)} (risk reduction ${rrf.toFixed(0)}) is required: SIL ${sil}.`,
  };
}

/** Does an achieved SIF PFD (e.g. verifySIF's) close the LOPA gap? */
export function sifMeetsLopa(
  result: LopaResult,
  achievedPfd: number,
): { meets: boolean; margin: number | null; reason: string } {
  if (!result.sifRequired || result.requiredSifPfd === null)
    return {
      meets: true,
      margin: null,
      reason: "No SIF is required for this scenario.",
    };
  if (!(achievedPfd > 0 && achievedPfd <= 1))
    throw new Error("The achieved PFD must be in (0, 1].");
  const margin = result.requiredSifPfd / achievedPfd;
  return {
    meets: achievedPfd <= result.requiredSifPfd,
    margin,
    reason:
      achievedPfd <= result.requiredSifPfd
        ? `Achieved PFD ${achievedPfd.toExponential(2)} meets the required ${result.requiredSifPfd.toExponential(2)} with a margin of ${margin.toFixed(1)}×.`
        : `Achieved PFD ${achievedPfd.toExponential(2)} does NOT meet the required ${result.requiredSifPfd.toExponential(2)}; the scenario's risk exceeds the tolerable frequency by ${(1 / margin).toFixed(1)}×.`,
  };
}
