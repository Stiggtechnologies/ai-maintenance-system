/**
 * Human error probability by HEART (BOK-13) — Human Error Assessment and
 * Reduction Technique (Williams 1986, 1988; HSE RR679 review, 2009).
 *
 * The platform already defines maintenance-induced failure (C3.05) and checks
 * fatigue and competency, but cannot put a number on a human action, so a
 * fault tree or LOPA scenario with an operator response has a hole in it.
 * HEART fills it:
 *
 *   HEP = nominal HEP(generic task type) × Π [ (EPC_max − 1) × APOA + 1 ]
 *
 * where each error-producing condition (EPC) has a published maximum effect
 * and an assessed proportion of affect (APOA, 0–1) judged by the analyst.
 *
 * The generic task nominal values and EPC maxima are published in Williams'
 * tables; this kernel does not embed them. They arrive as inputs with a
 * basis (table and row), and the APOA judgement must carry a rationale,
 * because HEART's known weakness is unrecorded analyst judgement.
 *
 * Pure: no I/O, no randomness, no LLM.
 */

export interface GenericTask {
  description: string;
  nominalHep: number;
  /** Table and row the nominal value is taken from. */
  basis: string;
}

export interface ErrorProducingCondition {
  description: string;
  maxMultiplier: number;
  assessedProportion: number;
  /** Table/row for the multiplier. */
  basis: string;
  /** Why this proportion was judged, in the analyst's words. */
  rationale: string;
}

export interface HeartResult {
  task: string;
  nominalHep: number;
  hep: number;
  capped: boolean;
  contributions: { description: string; factor: number }[];
  dominant: string | null;
  reason: string;
}

export function heartHep(
  task: GenericTask,
  epcs: ErrorProducingCondition[],
): HeartResult {
  if (!task.basis || task.basis.trim().length < 8)
    throw new Error(
      "The generic task's nominal HEP must cite the HEART table row it comes from.",
    );
  if (!(task.nominalHep > 0 && task.nominalHep <= 1))
    throw new Error("The nominal HEP must be in (0, 1].");
  const contributions = epcs.map((e) => {
    if (!e.basis || e.basis.trim().length < 8)
      throw new Error(
        `EPC "${e.description}" must cite the table row for its maximum multiplier.`,
      );
    if (!e.rationale || e.rationale.trim().length < 15)
      throw new Error(
        `EPC "${e.description}" needs a recorded rationale for its assessed proportion of affect.`,
      );
    if (!(e.maxMultiplier >= 1))
      throw new Error(
        `EPC "${e.description}": the maximum multiplier must be ≥ 1.`,
      );
    if (!(e.assessedProportion >= 0 && e.assessedProportion <= 1))
      throw new Error(
        `EPC "${e.description}": the assessed proportion must be in [0, 1].`,
      );
    return {
      description: e.description,
      factor: (e.maxMultiplier - 1) * e.assessedProportion + 1,
    };
  });
  const raw = contributions.reduce((p, c) => p * c.factor, task.nominalHep);
  const capped = raw > 1;
  const hep = Math.min(1, raw);
  const dominant = contributions.length
    ? contributions.reduce((a, b) => (b.factor > a.factor ? b : a)).description
    : null;
  return {
    task: task.description,
    nominalHep: task.nominalHep,
    hep,
    capped,
    contributions,
    dominant,
    reason: capped
      ? "The error-producing conditions push the estimate past certainty; the task design, not the estimate, is the problem."
      : `HEP ${hep.toExponential(2)}${dominant ? `; the largest single driver is "${dominant}", which is where error reduction effort pays most` : ""}.`,
  };
}
