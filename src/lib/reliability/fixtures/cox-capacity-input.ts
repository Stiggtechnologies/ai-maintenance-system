import type { CoxConditionalProfile } from "../cox-prediction";
import type { CoxInterval } from "../cox";

/** Entirely synthetic computational-boundary recipe, not customer evidence.
 * No application fitting/diagnostic function is called here or by the R
 * reference generator. The complete generated input is content-hash bound.
 */
export function coxCapacityInput() {
  let state = 1597463007;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const covariateNames = Array.from(
    { length: 8 },
    (_, j) => `synthetic_condition_${j + 1}`,
  );
  const rows: CoxInterval[] = [];
  const clusters: Array<[string, string]> = [];
  const xs = () =>
    covariateNames.map(() => Math.round((2 * random() - 1) * 1000) / 1000);
  for (let i = 0; i < 1000; i++) {
    const subjectId = `synthetic-capacity-life-${i}`;
    const stratum = `synthetic-capacity-design-${i % 4}`;
    const start = Math.floor(random() * 4);
    const split = start + 1 + Math.floor(random() * 7);
    const stop = split + 1 + Math.floor(random() * 30);
    const first = xs();
    const second = xs();
    const failed = random() < 0.65;
    clusters.push([subjectId, `synthetic-capacity-asset-${i % 32}`]);
    rows.push(
      {
        id: `${subjectId}-initial`,
        subjectId,
        stratum,
        start,
        stop: split,
        failed: false,
        covariates: first,
        observedAt: start,
      },
      {
        id: `${subjectId}-terminal`,
        subjectId,
        stratum,
        start: split,
        stop,
        failed,
        covariates: second,
        observedAt: split,
      },
    );
  }
  const profiles: CoxConditionalProfile[] = [];
  for (const [index, pieces] of [1, 2].entries()) {
    const stratum = `synthetic-capacity-design-${index}`;
    const observations = rows.filter(
      (row) => row.stratum === stratum && row.start <= 11 && row.stop >= 31,
    );
    if (observations.length < pieces)
      throw new Error("Complete explicit synthetic profile support required");
    profiles.push({
      stratum,
      originHours: 11,
      horizonHours: 31,
      path: Array.from({ length: pieces }, (_, j) => ({
        startHours: j === 0 ? 11 : 20,
        stopHours: j === pieces - 1 ? 31 : 20,
        covariates: [...observations[j].covariates],
        observedAtHours: observations[j].observedAt,
        availableAtHours: observations[j].observedAt,
        // Explicit SYNTHETIC known-at-origin validity, not an OEM limit or
        // unapproved production carry-forward assumption.
        validThroughHours: 31,
      })),
    });
  }
  return {
    provenance: "cox-capacity-synthetic/1; seed 1597463007; no customer data",
    covariateNames,
    rows,
    clusters,
    profiles,
  };
}
