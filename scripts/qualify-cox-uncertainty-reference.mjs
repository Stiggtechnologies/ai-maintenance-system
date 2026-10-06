/** Independent local SYNTHETIC qualification, not an application runtime.
 * Usage: node scripts/qualify-cox-uncertainty-reference.mjs /absolute/node_modules/webr
 * Refits the full R model under physical-asset case-weight perturbations.
 * No customer data, R implementation source, or app dependency is imported.
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
const paths = [
  "src/lib/reliability/fixtures/cox-reference.json",
  "src/lib/reliability/fixtures/cox-r-reference.json",
];
const bytes = paths.map((path) => readFileSync(resolve(root, path)));
const [input, reference] = bytes.map((value) =>
  JSON.parse(value.toString("utf8")),
);
if (
  input.cases.length !== 3 ||
  reference.cases.length !== 3 ||
  input.provenance.statsmodels !== "0.14.6" ||
  reference.provenance.survival !== "3.8.6"
)
  throw new Error("Complete pinned synthetic references required.");
const { WebR } = await import(
  pathToFileURL(resolve(runtime, "dist/webr.mjs")).href
);
const r = new WebR();
const vec = (values) =>
  `c(${values.map((value) => JSON.stringify(value)).join(",")})`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const deltas = [1e-4, 1e-5, 1e-6];
const cases = [];
try {
  await r.init();
  await r.installPackages(["survival"]);
  const versions = {
    R: await r.evalRString("as.character(getRversion())"),
    survival: await r.evalRString('as.character(packageVersion("survival"))'),
    Matrix: await r.evalRString('as.character(packageVersion("Matrix"))'),
    lattice: await r.evalRString('as.character(packageVersion("lattice"))'),
  };
  if (
    versions.R !== "4.6.0" ||
    versions.survival !== "3.8.6" ||
    versions.Matrix !== "1.7.5" ||
    versions.lattice !== "0.22.9"
  )
    throw new Error("Unpinned numerical reference runtime.");
  await r.evalRVoid("library(survival)");
  const values = async (expression) => {
    const value = await r.evalR(`as.double(${expression})`);
    const result = Array.from(await value.toArray());
    if (!result.every(Number.isFinite))
      throw new Error("Non-finite independent output.");
    return result;
  };
  for (const [index, fixture] of input.cases.entries()) {
    const witness = reference.cases[index],
      rows = fixture.rows,
      p = fixture.covariateNames.length;
    if (
      witness.name !== fixture.name ||
      witness.assetClusters.length !== rows.length
    )
      throw new Error("Exact cohort/asset mapping required.");
    const profiles = witness.conditionalScenarios.map((item) =>
      structuredClone(item.profile),
    );
    // Explicit synthetic known-at-origin two-piece paths, including a change
    // at an observed failure boundary. No customer validity limit is inferred.
    for (const stratum of [...new Set(rows.map((row) => row.stratum))]) {
      const initial = profiles.find(
        (profile) => profile.stratum === stratum && profile.originHours === 0,
      );
      if (!initial)
        throw new Error("Complete initial reference path required.");
      const other = rows.find(
        (row) =>
          row.stratum === stratum &&
          row.start === 0 &&
          row.covariates.some(
            (value, j) => value !== initial.path[0].covariates[j],
          ),
      );
      const split = rows
        .filter(
          (row) =>
            row.stratum === stratum &&
            row.failed &&
            row.stop > 0 &&
            row.stop < initial.horizonHours,
        )
        .map((row) => row.stop)
        .sort((a, b) => a - b)[0];
      if (!other || split === undefined)
        throw new Error("Explicit synthetic piecewise profile required.");
      profiles.push({
        ...initial,
        path: [
          { ...initial.path[0], stopHours: split },
          {
            ...initial.path[0],
            startHours: split,
            covariates: other.covariates,
            validThroughHours: initial.horizonHours,
          },
        ],
      });
    }
    const columns = [
      `start=${vec(rows.map((row) => row.start))}`,
      `stop=${vec(rows.map((row) => row.stop))}`,
      `failed=${vec(rows.map((row) => +row.failed))}`,
      `stratum=${vec(rows.map((row) => row.stratum))}`,
      `assetCluster=${vec(witness.assetClusters)}`,
      ...fixture.covariateNames.map(
        (_, j) => `x${j + 1}=${vec(rows.map((row) => row.covariates[j]))}`,
      ),
    ];
    await r.evalRVoid(`d <- data.frame(${columns.join(",")})`);
    const nd = profiles.flatMap((profile, i) =>
      profile.path.map((path) => ({ profile, path, scenario: i + 1 })),
    );
    await r.evalRVoid(
      `nd <- data.frame(start=${vec(nd.map((x) => x.path.startHours))},stop=${vec(nd.map((x) => x.path.stopHours))},failed=0,stratum=${vec(nd.map((x) => x.profile.stratum))},scenario=${vec(nd.map((x) => x.scenario))},${fixture.covariateNames.map((_, j) => `x${j + 1}=${vec(nd.map((x) => x.path.covariates[j]))}`).join(",")})`,
    );
    // Single-stratum equivalent avoids survfit's single-level strata issue;
    // the reference here uses predict.coxph, not its variance convention.
    const strata =
      new Set(rows.map((row) => row.stratum)).size > 1
        ? " + strata(stratum)"
        : "";
    const formula = `Surv(start,stop,failed) ~ ${fixture.covariateNames.map((_, j) => `x${j + 1}`).join(" + ")}${strata}`;
    const options =
      'data=d,ties="efron",x=TRUE,model=TRUE,singular.ok=FALSE,control=coxph.control(eps=1e-12,toler.chol=1e-14,iter.max=200)';
    await r.evalRVoid(`fit <- coxph(${formula},${options})`);
    const coefficients = await values("coef(fit)");
    if (
      coefficients.some(
        (value, j) => Math.abs(value - witness.expected.coefficients[j]) > 1e-7,
      )
    )
      throw new Error("Independent reference coefficients disagree.");
    await r.evalRVoid(
      `hazards <- function(model) vapply(split(as.double(predict(model,newdata=nd,type="expected")),factor(nd$scenario,levels=seq_len(${profiles.length}))),sum,numeric(1))`,
    );
    const point = await values("hazards(fit)");
    const perturbations = [];
    for (const delta of deltas) {
      const assets = [];
      for (const clusterId of witness.clusterIds) {
        await r.evalRVoid(
          `w <- ifelse(d$assetCluster==${clusterId},1+${delta},1); plus <- coxph(${formula},weights=w,${options}); w <- ifelse(d$assetCluster==${clusterId},1-${delta},1); minus <- coxph(${formula},weights=w,${options})`,
        );
        const positive = await values("hazards(plus)"),
          negative = await values("hazards(minus)");
        assets.push({
          clusterId,
          positive,
          negative,
          influences: positive.map(
            (value, j) => (value - negative[j]) / (2 * delta),
          ),
        });
      }
      perturbations.push({ delta, assets });
    }
    for (let j = 0; j < profiles.length; j++) {
      const baseline = perturbations[1].assets.map(
        (asset) => asset.influences[j],
      );
      for (const perturbation of perturbations)
        if (
          perturbation.assets.some(
            (asset, k) => Math.abs(asset.influences[j] - baseline[k]) > 2e-7,
          )
        )
          throw new Error("Independent finite-difference stability failed.");
    }
    cases.push({
      name: fixture.name,
      covariateNames: fixture.covariateNames,
      assetClusters: witness.assetClusters,
      clusterIds: witness.clusterIds,
      scenarios: profiles.map((profile, j) => ({
        profile,
        cumulativeHazardIncrement: point[j],
        clusterInfluences: perturbations[1].assets.map((asset) => ({
          clusterId: asset.clusterId,
          influence: asset.influences[j],
        })),
        cumulativeHazardVariance: perturbations[1].assets.reduce(
          (sum, asset) => sum + asset.influences[j] ** 2,
          0,
        ),
      })),
      perturbations,
    });
  }
  const artifact = {
    provenance: {
      data: "Entirely synthetic; full exact cohorts and asset clusters. No customer calibration, coverage guarantee or operational authority.",
      versions,
      WebR: metadata.version,
      inputs: paths.map((path, i) => ({ path, sha256: hash(bytes[i]) })),
      method:
        "Independent R coxph Efron refits under asset case-weight central differences; sum of actual predict.coxph expected hazards across exact contiguous (start,stop] paths. Full joint baseline/coefficient influences, not survfit's variance convention.",
      deltas,
      stabilityTolerance: 2e-7,
      selectedDelta: 1e-5,
      sources: [
        "https://www.stat.ethz.ch/R-manual/R-devel/library/survival/html/coxph.html",
        "https://www.stat.ethz.ch/R-manual/R-devel/library/survival/html/predict.coxph.html",
      ],
    },
    cases,
  };
  const destination = resolve(
    root,
    "src/lib/reliability/fixtures/cox-uncertainty-reference.json",
  );
  writeFileSync(destination, JSON.stringify(artifact, null, 2) + "\n");
  console.log(
    JSON.stringify({
      destination,
      cases: cases.length,
      scenarios: cases.reduce((sum, item) => sum + item.scenarios.length, 0),
      sha256: hash(readFileSync(destination)),
      versions,
    }),
  );
} finally {
  await r.close();
}
