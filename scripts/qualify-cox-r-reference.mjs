/**
 * Independent SYNTHETIC R survival qualification, never a production runtime.
 * Usage: node scripts/qualify-cox-r-reference.mjs /absolute/isolated/node_modules/webr
 * Install webr@0.6.0 in an isolated directory, not the application dependency tree.
 * All engineering observations remain local. Only R package binaries download.
 * No R/survival implementation source is copied into SyncAI.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = process.argv[2];
if (!runtime || !runtime.startsWith("/")) {
  throw new Error(
    "An explicit isolated absolute WebR runtime path is required.",
  );
}
const metadata = JSON.parse(
  readFileSync(resolve(runtime, "package.json"), "utf8"),
);
if (metadata.version !== "0.6.0")
  throw new Error("Qualification requires WebR 0.6.0.");
const inputPath = "src/lib/reliability/fixtures/cox-reference.json";
const bytes = readFileSync(resolve(root, inputPath));
const input = JSON.parse(bytes.toString("utf8"));
if (input.provenance.statsmodels !== "0.14.6" || input.cases.length !== 3) {
  throw new Error("Pinned complete synthetic PHReg inputs required.");
}
const { WebR } = await import(
  pathToFileURL(resolve(runtime, "dist/webr.mjs")).href
);
const r = new WebR();
const vector = (values) =>
  `c(${values.map((value) => JSON.stringify(value)).join(",")})`;
const cases = [];
try {
  await r.init();
  await r.installPackages(["survival"]);
  const version = await r.evalRString(
    'as.character(packageVersion("survival"))',
  );
  const rVersion = await r.evalRString("as.character(getRversion())");
  const matrixVersion = await r.evalRString(
    'as.character(packageVersion("Matrix"))',
  );
  const latticeVersion = await r.evalRString(
    'as.character(packageVersion("lattice"))',
  );
  if (
    version !== "3.8.6" ||
    rVersion !== "4.6.0" ||
    matrixVersion !== "1.7.5" ||
    latticeVersion !== "0.22.9"
  ) {
    throw new Error(`Unpinned reference: R ${rVersion}; survival ${version}.`);
  }
  await r.evalRVoid("library(survival)");
  const values = async (expression) => {
    const result = await r.evalR(`as.double(${expression})`);
    return Array.from(await result.toArray());
  };
  const matrix = async (expression, rows, columns) => {
    const flat = await values(expression);
    if (flat.length !== rows * columns || !flat.every(Number.isFinite)) {
      throw new Error(`Malformed independent matrix ${expression}.`);
    }
    return Array.from({ length: rows }, (_, i) =>
      Array.from({ length: columns }, (_, j) => flat[j * rows + i]),
    );
  };
  for (const fixture of input.cases) {
    const rows = fixture.rows;
    const names = fixture.covariateNames;
    const subjects = [...new Set(rows.map((row) => row.subjectId))];
    // Three component lives per synthetic asset; explicit independent clusters.
    const assetClusters = rows.map((row) =>
      Math.floor(subjects.indexOf(row.subjectId) / 3),
    );
    const clusters = [...new Set(assetClusters)].sort((a, b) => a - b);
    const p = names.length;
    const columns = [
      `start=${vector(rows.map((row) => row.start))}`,
      `stop=${vector(rows.map((row) => row.stop))}`,
      `failed=${vector(rows.map((row) => +row.failed))}`,
      `stratum=${vector(rows.map((row) => row.stratum))}`,
      `assetCluster=${vector(assetClusters)}`,
      ...names.map(
        (_, j) => `x${j + 1}=${vector(rows.map((row) => row.covariates[j]))}`,
      ),
    ];
    await r.evalRVoid(`d <- data.frame(${columns.join(",")})`);
    const formula = `Surv(start,stop,failed) ~ ${names.map((_, j) => `x${j + 1}`).join(" + ")} + strata(stratum)`;
    await r.evalRVoid(
      `fit <- coxph(${formula}, data=d, ties="efron", x=TRUE, model=TRUE, singular.ok=FALSE, control=coxph.control(eps=1e-12,toler.chol=1e-14,iter.max=200))`,
    );
    await r.evalRVoid(
      `clusterFit <- coxph(${formula}, data=d, ties="efron", cluster=assetCluster, x=TRUE, model=TRUE, singular.ok=FALSE, control=coxph.control(eps=1e-12,toler.chol=1e-14,iter.max=200))`,
    );
    // Identity transform is declared, not confused with the default KM transform.
    await r.evalRVoid(
      'ph <- cox.zph(fit,transform="identity",terms=TRUE,global=TRUE)',
    );
    const coefficients = await values("coef(fit)");
    coefficients.forEach((coefficient, j) => {
      if (Math.abs(coefficient - fixture.expected.coefficients[j]) > 1e-7) {
        throw new Error(
          `Independent R/PHReg coefficient disagreement: ${fixture.name}.`,
        );
      }
    });
    cases.push({
      name: fixture.name,
      covariateNames: names,
      assetClusters,
      clusterIds: clusters,
      expected: {
        coefficients,
        covariance: await matrix("vcov(fit)", p, p),
        clusterCovariance: await matrix("vcov(clusterFit)", p, p),
        scoreResiduals: await matrix(
          'residuals(fit,type="score")',
          rows.length,
          p,
        ),
        clusterDfbeta: await matrix(
          'residuals(fit,type="dfbeta",collapse=d$assetCluster)',
          clusters.length,
          p,
        ),
        phIdentityTable: await matrix("ph$table", p + 1, 3),
        logLikelihood: await r.evalRNumber("tail(fit$loglik,1)"),
      },
    });
  }
  const artifact = {
    provenance: {
      data: "Entirely synthetic; exact complete retained input fixture; three physical lives per synthetic asset cluster. Not customer evidence or engineering limits.",
      inputPath,
      inputSha256: createHash("sha256").update(bytes).digest("hex"),
      webr: metadata.version,
      webrNpmIntegrity:
        "sha512-M2b8m3/ZBk7XMIR7LD97s5k/9jUla83Z0Hl4b+WnrK7XmSMpZdajCiP3XkSzHKHDUgscHKe+lVUvk3aym8q0bw==",
      r: rVersion,
      survival: version,
      Matrix: matrixVersion,
      lattice: latticeVersion,
      method:
        "survival::coxph Efron; clustered infinitesimal-jackknife covariance; survival::cox.zph actual score test, identity time transform.",
      phTableColumns: ["chisq", "df", "p"],
      phTableRows: "Covariates in fixture order followed by GLOBAL.",
      noPredictiveQualification: true,
      noOperationalAuthority: true,
      sources: [
        "https://www.stat.ethz.ch/R-manual/R-devel/library/survival/html/coxph.html",
        "https://www.stat.ethz.ch/R-manual/R-devel/library/survival/html/cox.zph.html",
        "https://docs.r-wasm.org/webr/latest/downloading.html",
      ],
    },
    chiSquareTails: await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const degreesOfFreedom = index + 1;
        const statistics = [0, 0.01, 1, 3, 10, 25, 100, 1000];
        return {
          degreesOfFreedom,
          statistics,
          expected: await values(
            `pchisq(${vector(statistics)},df=${degreesOfFreedom},lower.tail=FALSE)`,
          ),
        };
      }),
    ),
    cases,
  };
  const destination = resolve(
    root,
    "src/lib/reliability/fixtures/cox-r-reference.json",
  );
  writeFileSync(destination, JSON.stringify(artifact, null, 2) + "\n");
  console.log(
    JSON.stringify({
      destination,
      cases: cases.length,
      provenance: artifact.provenance,
    }),
  );
} finally {
  await r.close();
}
