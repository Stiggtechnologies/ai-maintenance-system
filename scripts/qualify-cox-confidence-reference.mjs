/** Independent R transformation of pinned synthetic full-asset uncertainty.
 * Usage: node scripts/qualify-cox-confidence-reference.mjs /absolute/node_modules/webr
 * No application math, customer data or app dependency is imported.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = process.argv[2];
if (!runtime?.startsWith("/"))
  throw new Error("Explicit isolated runtime required.");
const metadata = JSON.parse(
  readFileSync(resolve(runtime, "package.json"), "utf8"),
);
if (metadata.version !== "0.6.0") throw new Error("WebR 0.6.0 required.");
const path = "src/lib/reliability/fixtures/cox-uncertainty-reference.json";
const bytes = readFileSync(resolve(root, path));
const input = JSON.parse(bytes.toString("utf8"));
if (input.provenance.versions.R !== "4.6.0" || input.cases.length !== 3)
  throw new Error("Pinned independent uncertainty references required.");
const { WebR } = await import(
  pathToFileURL(resolve(runtime, "dist/webr.mjs")).href
);
const r = new WebR();
const hash = (value) => createHash("sha256").update(value).digest("hex");
try {
  await r.init();
  const R = await r.evalRString("as.character(getRversion())");
  if (R !== "4.6.0") throw new Error("Unpinned R runtime.");
  const criticalValue = await r.evalRNumber("qnorm(0.975)");
  // A declared mathematical transform, not survfit's variance convention or
  // empirical coverage. Variance comes from the prior full R case-weight refits.
  await r.evalRVoid(`bounds <- function(H,V) {
    delta <- qnorm(0.975)*sqrt(V)/H
    limits <- exp(log(H)+c(-delta,delta))
    c(delta,log(H)-delta,log(H)+delta,limits,
      -expm1(-limits),exp(-rev(limits)))
  }`);
  const cases = [];
  for (const cohort of input.cases) {
    const scenarios = [];
    for (const [scenarioIndex, scenario] of cohort.scenarios.entries()) {
      const H = scenario.cumulativeHazardIncrement;
      const V = scenario.cumulativeHazardVariance;
      const object = await r.evalR(`bounds(${H},${V})`);
      const values = Array.from(await object.toArray());
      if (values.length !== 9 || !values.every(Number.isFinite))
        throw new Error("Independent finite transformed bounds required.");
      scenarios.push({
        scenarioIndex,
        cumulativeHazardIncrement: H,
        cumulativeHazardVariance: V,
        logHazardHalfWidth: values[0],
        logCumulativeHazard: { lower: values[1], upper: values[2] },
        cumulativeHazard: { lower: values[3], upper: values[4] },
        conditionalFailureProbability: { lower: values[5], upper: values[6] },
        conditionalSurvivalProbability: { lower: values[7], upper: values[8] },
      });
    }
    cases.push({ name: cohort.name, scenarios });
  }
  const artifact = {
    provenance: {
      data: "Entirely synthetic. Mathematical transformation qualification only, not empirical coverage, customer calibration, model adequacy, a future-event prediction interval or operational authority.",
      R,
      WebR: metadata.version,
      input: { path, sha256: hash(bytes) },
      nominalConfidenceLevel: 0.95,
      criticalValue,
      method:
        "Pointwise asymptotic log-cumulative-hazard delta method using full asset case-weight variance; exp(log(H) +/- qnorm(0.975)*sqrt(V)/H), monotonically transformed to failure and survival probabilities. No clipping and no survfit variance substitution.",
      sources: [
        "https://stat.ethz.ch/R-manual/R-devel/library/survival/html/survfit.formula.html",
        "https://stat.ethz.ch/R-manual/R-devel/library/stats/html/Normal.html",
      ],
    },
    cases,
  };
  const destination = resolve(
    root,
    "src/lib/reliability/fixtures/cox-confidence-reference.json",
  );
  writeFileSync(destination, JSON.stringify(artifact, null, 2) + "\n");
  console.log(
    JSON.stringify({
      destination,
      R,
      criticalValue,
      scenarios: cases.reduce(
        (sum, cohort) => sum + cohort.scenarios.length,
        0,
      ),
      sha256: hash(readFileSync(destination)),
    }),
  );
} finally {
  await r.close();
}
