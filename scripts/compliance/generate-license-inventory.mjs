import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const lockPath = resolve(repositoryRoot, "package-lock.json");
const markdownPath = resolve(
  repositoryRoot,
  "docs/investor-diligence/open-source-inventory.md",
);
const jsonPath = resolve(
  repositoryRoot,
  "docs/investor-diligence/open-source-inventory.json",
);
const mode = process.argv.includes("--write") ? "write" : "check";

const lockBytes = readFileSync(lockPath);
const lock = JSON.parse(lockBytes.toString("utf8"));
const rootPackage = lock.packages?.[""] ?? {};
const productionDependencies = rootPackage.dependencies ?? {};
const developmentDependencies = rootPackage.devDependencies ?? {};

function packageNameFromPath(packagePath) {
  return packagePath.split("node_modules/").at(-1);
}

const records = Object.entries(lock.packages ?? {})
  .filter(([packagePath]) => packagePath !== "")
  .map(([packagePath, metadata]) => {
    const name = packageNameFromPath(packagePath);
    const direct = Object.hasOwn(productionDependencies, name)
      ? "production"
      : Object.hasOwn(developmentDependencies, name)
        ? "development"
        : "transitive";
    return {
      name,
      version: metadata.version ?? "UNKNOWN",
      license: metadata.license ?? "UNKNOWN",
      direct,
      packagePath,
    };
  })
  .sort((left, right) =>
    `${left.name}@${left.version}:${left.packagePath}`.localeCompare(
      `${right.name}@${right.version}:${right.packagePath}`,
    ),
  );

const prohibitedLicensePattern =
  /(?:^|\b)(?:AGPL|GPL|LGPL|SSPL|BUSL|BSL|Elastic-2\.0|Commons-Clause)(?:\b|$)/i;
const prohibited = records.filter((record) =>
  prohibitedLicensePattern.test(record.license),
);
const unknown = records.filter((record) => record.license === "UNKNOWN");
const reviewLicenses = new Set(["MPL-2.0", "CC-BY-4.0", "OFL-1.1"]);

const licenseCounts = Object.entries(
  records.reduce((counts, record) => {
    counts[record.license] = (counts[record.license] ?? 0) + 1;
    return counts;
  }, {}),
).sort(([left], [right]) => left.localeCompare(right));

const directRecords = records.filter(
  (record) => record.direct !== "transitive",
);
const reviewRecords = records.filter((record) =>
  reviewLicenses.has(record.license),
);
const lockfileSha256 = createHash("sha256").update(lockBytes).digest("hex");

const inventory = {
  schemaVersion: 1,
  source: "package-lock.json",
  lockfileSha256,
  packageInstances: records.length,
  directProductionDependencies: Object.keys(productionDependencies).length,
  directDevelopmentDependencies: Object.keys(developmentDependencies).length,
  prohibitedCount: prohibited.length,
  unknownCount: unknown.length,
  licenseCounts: Object.fromEntries(licenseCounts),
  policy: {
    prohibitedIdentifiers: [
      "AGPL",
      "GPL",
      "LGPL",
      "SSPL",
      "BUSL/BSL",
      "Elastic-2.0",
      "Commons-Clause",
    ],
    manualReviewIdentifiers: [...reviewLicenses].sort(),
  },
  packages: records,
};

const directRows = directRecords
  .map(
    (record) =>
      `| ${record.name} | ${record.version} | ${record.direct} | ${record.license} |`,
  )
  .join("\n");
const licenseRows = licenseCounts
  .map(
    ([license, count]) =>
      `| ${license} | ${count} | ${reviewLicenses.has(license) ? "Manual notice review" : "Permitted by automated baseline"} |`,
  )
  .join("\n");
const reviewRows = reviewRecords.length
  ? reviewRecords
      .map(
        (record) =>
          `| ${record.name} | ${record.version} | ${record.license} | ${record.direct} |`,
      )
      .join("\n")
  : "| None | — | — | — |";

const markdown = `# Open-source dependency inventory

This inventory is generated deterministically from \`package-lock.json\` by
\`scripts/compliance/generate-license-inventory.mjs\`. It is technical
diligence evidence, not a legal opinion.

- Lockfile SHA-256: \`${lockfileSha256}\`
- Package instances: **${records.length}**
- Direct production dependencies: **${Object.keys(productionDependencies).length}**
- Direct development dependencies: **${Object.keys(developmentDependencies).length}**
- Prohibited-license matches: **${prohibited.length}**
- Missing license metadata: **${unknown.length}**
- Machine-readable inventory: \`open-source-inventory.json\`

## Policy result

The automated baseline rejects missing license metadata and identifiers that
match AGPL, GPL, LGPL, SSPL, BUSL/BSL, Elastic-2.0, or Commons Clause. MPL,
font, and attribution licenses are retained for manual notice review. Passing
this check does not replace counsel review of bundled assets, transitive terms,
patents, trademarks, or customer distribution obligations.

## License summary

| License | Package instances | Baseline treatment |
| --- | ---: | --- |
${licenseRows}

## Direct dependencies

| Package | Version | Scope | License |
| --- | --- | --- | --- |
${directRows}

## Manual notice review queue

| Package | Version | License | Scope |
| --- | --- | --- | --- |
${reviewRows}
`;

const json = `${JSON.stringify(inventory, null, 2)}\n`;

if (prohibited.length || unknown.length) {
  console.error(
    `License policy failed: ${prohibited.length} prohibited, ${unknown.length} unknown.`,
  );
  process.exitCode = 1;
}

if (mode === "write") {
  writeFileSync(markdownPath, markdown);
  writeFileSync(jsonPath, json);
  console.log(`Wrote ${markdownPath}`);
  console.log(`Wrote ${jsonPath}`);
} else {
  const currentMarkdown = readFileSync(markdownPath, "utf8");
  const currentJson = readFileSync(jsonPath, "utf8");
  if (currentMarkdown !== markdown || currentJson !== json) {
    console.error(
      "Open-source inventory is stale. Run npm run compliance:licenses:write.",
    );
    process.exitCode = 1;
  } else {
    console.log("Open-source inventory matches package-lock.json.");
  }
}
