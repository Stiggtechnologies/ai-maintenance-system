/**
 * Turning an RBI result into an inspection-plan proposal (BOK-05 consumer).
 *
 * planRiskBasedInspection() says WHEN risk reaches the owner's target. This
 * module converts that into the three fields the existing human-only
 * `record_inspection_plan` door requires — interval in months, next due date,
 * and an interval basis — and nothing else. It never records anything: the
 * named engineer submits the proposal through the existing door, which
 * enforces process-safety authority, tenancy and the 20-character basis.
 *
 * Rules (each one a refusal rather than a guess):
 *   - risk already over target → no interval: inspect or mitigate now;
 *   - risk below target for the whole assessed horizon → no interval: the
 *     owner's damage curve does not reach far enough to justify one;
 *   - less than one whole month to target → no interval: inspect now;
 *   - otherwise the interval is rounded DOWN to whole months, so the plan is
 *     never later than the calculation.
 *
 * The basis text carries every input and its stated source, so the adopted
 * plan can be recomputed from its own audit record.
 *
 * Pure: no I/O, no randomness, no LLM.
 */

import type { RbiInput, RbiResult } from "./rbi";

export interface RbiAdoption {
  adoptable: boolean;
  intervalMonths: number | null;
  nextDue: string | null;
  intervalBasis: string;
  reason: string;
}

function addMonths(from: Date, months: number): string {
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

/** Every input with its basis, in a stable order, for the audit record. */
export function describeRbiInputs(input: RbiInput): string {
  const mech = input.mechanisms
    .map(
      (m) =>
        `${m.mechanism} D_f ${m.curve.map((p) => `${p.years}y=${p.df}`).join(", ")} (${m.basis.trim()})`,
    )
    .join("; ");
  return [
    `gff ${input.genericFailureFrequency.perYear}/yr (${input.genericFailureFrequency.basis.trim()})`,
    `mechanisms: ${mech}`,
    `combination ${input.combination} (${input.combinationBasis.trim()})`,
    `F_MS ${input.managementSystemFactor.value} (${input.managementSystemFactor.basis.trim()})`,
    `CoF ${input.consequence.value} ${input.consequence.unit} (${input.consequence.basis.trim()})`,
    `risk target ${input.riskTarget.value} (${input.riskTarget.basis.trim()})`,
  ].join(" | ");
}

export function buildRbiAdoption(
  input: RbiInput,
  result: RbiResult,
  today: Date,
): RbiAdoption {
  const header = `RBI (API 580-aligned kernel BOK-05; API 581 values owner-supplied) for ${result.componentId}.`;
  const inputs = describeRbiInputs(input);
  const refuse = (reason: string): RbiAdoption => ({
    adoptable: false,
    intervalMonths: null,
    nextDue: null,
    intervalBasis: `${header} ${reason} Inputs: ${inputs}`,
    reason,
  });
  if (result.exceedsTargetNow)
    return refuse(
      `Risk ${result.riskNow.toPrecision(3)} already exceeds the target ${result.riskTarget.toPrecision(3)}: inspect or mitigate now and record the completion, rather than planning an interval.`,
    );
  if (result.yearsToTarget === null)
    return refuse(
      `Risk stays below target across the whole ${result.horizonYears}-year damage curve supplied; extend the owner's damage assessment before an interval can be justified.`,
    );
  const months = Math.floor(result.yearsToTarget * 12);
  if (months < 1)
    return refuse(
      `Risk reaches the target in ${(result.yearsToTarget * 12).toFixed(1)} months, less than one whole month: inspect now.`,
    );
  return {
    adoptable: true,
    intervalMonths: months,
    nextDue: addMonths(today, months),
    intervalBasis: `${header} Risk now ${result.riskNow.toPrecision(3)}, reaches target ${result.riskTarget.toPrecision(3)} in ${result.yearsToTarget.toFixed(2)} years (governing: ${result.governingMechanism}); interval rounded down to ${months} months. Inputs: ${inputs}`,
    reason: `Inspect within ${months} months, by ${addMonths(today, months)}.`,
  };
}
