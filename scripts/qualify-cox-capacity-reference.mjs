/** Independent SYNTHETIC computational-boundary qualification.
 * Usage: npx tsx scripts/qualify-cox-capacity-reference.mjs /absolute/node_modules/webr
 * Only the deterministic input recipe is shared. No application fitting,
 * diagnostic, prediction or confidence function is imported. No customer data.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format, resolveConfig } from "prettier";
import { coxCapacityInput } from "../src/lib/reliability/fixtures/cox-capacity-input.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = process.argv[2];
if (!runtime?.startsWith("/"))
  throw new Error("Explicit isolated runtime required");
const metadata = JSON.parse(
  readFileSync(resolve(runtime, "package.json"), "utf8"),
);
if (metadata.version !== "0.6.0") throw new Error("WebR 0.6.0 required");
const input = coxCapacityInput();
const { rows, covariateNames: names, profiles } = input;
if (rows.length !== 2000 || names.length !== 8)
  throw new Error("Exact declared boundary required");
const clusterBySubject = new Map(input.clusters);
const clusters = [...new Set(clusterBySubject.values())].sort();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const vec = (values) =>
  `c(${values.map((value) => JSON.stringify(value)).join(",")})`;
const { WebR } = await import(
  pathToFileURL(resolve(runtime, "dist/webr.mjs")).href
);
const r = new WebR();
try {
  await r.init();
  await r.installPackages(["survival"]);
  const versions = {
    R: await r.evalRString("as.character(getRversion())"),
    survival: await r.evalRString('as.character(packageVersion("survival"))'),
    Matrix: await r.evalRString('as.character(packageVersion("Matrix"))'),
    lattice: await r.evalRString('as.character(packageVersion("lattice"))'),
    WebR: metadata.version,
  };
  if (
    JSON.stringify(versions) !==
    JSON.stringify({
      R: "4.6.0",
      survival: "3.8.6",
      Matrix: "1.7.5",
      lattice: "0.22.9",
      WebR: "0.6.0",
    })
  )
    throw new Error("Unpinned independent runtime");
  await r.evalRVoid("library(survival)");
  const values = async (expression) => {
    const object = await r.evalR(`as.double(${expression})`);
    const array = Array.from(await object.toArray());
    if (!array.every(Number.isFinite))
      throw new Error("Finite independent output required");
    return array;
  };
  const matrix = async (expression, height, width) => {
    const flat = await values(expression);
    if (flat.length !== height * width)
      throw new Error("Exact independent matrix shape required");
    return Array.from({ length: height }, (_, i) =>
      Array.from({ length: width }, (_, j) => flat[j * height + i]),
    );
  };
  await r.evalRVoid(
    `d <- data.frame(start=${vec(rows.map((x) => x.start))},stop=${vec(rows.map((x) => x.stop))},failed=${vec(rows.map((x) => +x.failed))},stratum=${vec(rows.map((x) => x.stratum))},assetCluster=${vec(rows.map((x) => clusterBySubject.get(x.subjectId)))},${names.map((_, j) => `x${j + 1}=${vec(rows.map((x) => x.covariates[j]))}`).join(",")})`,
  );
  const nd = profiles.flatMap((profile, i) =>
    profile.path.map((path) => ({ profile, path, scenario: i + 1 })),
  );
  await r.evalRVoid(
    `nd <- data.frame(start=${vec(nd.map((x) => x.path.startHours))},stop=${vec(nd.map((x) => x.path.stopHours))},failed=0,stratum=${vec(nd.map((x) => x.profile.stratum))},scenario=${vec(nd.map((x) => x.scenario))},${names.map((_, j) => `x${j + 1}=${vec(nd.map((x) => x.path.covariates[j]))}`).join(",")})`,
  );
  const formula = `Surv(start,stop,failed) ~ ${names.map((_, j) => `x${j + 1}`).join("+")} + strata(stratum)`;
  const options =
    'data=d,ties="efron",x=TRUE,model=TRUE,singular.ok=FALSE,control=coxph.control(eps=1e-12,toler.chol=1e-14,iter.max=200)';
  await r.evalRVoid(
    `fit <- coxph(${formula},${options}); clusterFit <- coxph(${formula},cluster=assetCluster,${options}); ph <- cox.zph(fit,transform="identity",terms=TRUE,global=TRUE); hazards <- function(model) vapply(split(as.double(predict(model,newdata=nd,type="expected")),factor(nd$scenario,levels=seq_len(${profiles.length}))),sum,numeric(1))`,
  );
  const points = await values("hazards(fit)");
  const deltas = [1e-4, 1e-5, 1e-6];
  const perturbations = [];
  console.log(
    JSON.stringify({
      versions,
      intervals: rows.length,
      dimensions: names.length,
      assets: clusters.length,
      scenarios: profiles.length,
      phase: "full asset case-weight refits",
    }),
  );
  for (const delta of deltas) {
    const assets = [];
    for (const clusterId of clusters) {
      await r.evalRVoid(
        `w <- ifelse(d$assetCluster==${JSON.stringify(clusterId)},1+${delta},1); plus <- coxph(${formula},weights=w,${options}); w <- ifelse(d$assetCluster==${JSON.stringify(clusterId)},1-${delta},1); minus <- coxph(${formula},weights=w,${options})`,
      );
      const positive = await values("hazards(plus)");
      const negative = await values("hazards(minus)");
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
    console.log(JSON.stringify({ delta, completeAssetRefits: assets.length }));
  }
  const selected = perturbations[1].assets;
  let largestStabilityDifference = 0;
  for (const perturbation of perturbations)
    for (const [i, asset] of perturbation.assets.entries())
      for (const [j, value] of asset.influences.entries())
        largestStabilityDifference = Math.max(
          largestStabilityDifference,
          Math.abs(value - selected[i].influences[j]),
        );
  if (largestStabilityDifference > 2e-7)
    throw new Error(
      `Independent finite-difference instability: ${largestStabilityDifference}`,
    );
  const scenarios = [];
  for (const [index, profile] of profiles.entries()) {
    const influences = selected.map((asset) => ({
      clusterId: asset.clusterId,
      influence: asset.influences[index],
    }));
    const variance = influences.reduce(
      (sum, asset) => sum + asset.influence ** 2,
      0,
    );
    const hazard = points[index];
    const failureBounds = await values(
      `-expm1(-exp(log(${hazard})+c(-1,1)*qnorm(.975)*sqrt(${variance})/${hazard}))`,
    );
    scenarios.push({ profile, hazard, variance, influences, failureBounds });
  }
  const artifact = {
    provenance: {
      data: "Entirely synthetic computational-boundary witness, not customer evidence, model suitability, fleet latency SLA, achieved confidence coverage or operating authority.",
      inputRecipe: "src/lib/reliability/fixtures/cox-capacity-input.ts",
      inputSha256: hash(JSON.stringify(input)),
      recipeSha256: hash(
        readFileSync(
          resolve(root, "src/lib/reliability/fixtures/cox-capacity-input.ts"),
        ),
      ),
      versions,
      method:
        "Independent R coxph Efron, model and canonical-asset clustered covariance, identity PH score tests, full asset case-weight refits for joint conditional hazard, and R nominal log-hazard confidence transform. No application math and no survfit variance substitution.",
      deltas,
      selectedDelta: 1e-5,
      stabilityTolerance: 2e-7,
      largestStabilityDifference,
    },
    intervals: rows.length,
    subjects: input.clusters.length,
    failures: rows.filter((row) => row.failed).length,
    coefficients: await values("coef(fit)"),
    covariance: await matrix("vcov(fit)", 8, 8),
    clusteredCovariance: await matrix("vcov(clusterFit)", 8, 8),
    phIdentityTable: await matrix("ph$table", 9, 3),
    logLikelihood: await r.evalRNumber("tail(fit$loglik,1)"),
    scenarios,
    perturbations,
  };
  const destination = resolve(
    root,
    "src/lib/reliability/fixtures/cox-capacity-reference.json",
  );
  // Deterministic artifact formatting only; no application numerical output
  // is used to generate any reference value.
  writeFileSync(
    destination,
    await format(JSON.stringify(artifact), {
      ...(await resolveConfig(destination)),
      filepath: destination,
    }),
  );
  console.log(
    JSON.stringify({
      destination,
      sha256: hash(readFileSync(destination)),
      largestStabilityDifference,
    }),
  );
} finally {
  await r.close();
}
