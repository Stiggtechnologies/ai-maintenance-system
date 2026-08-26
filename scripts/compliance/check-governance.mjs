import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const failures = [];

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

const packageJson = JSON.parse(read("package.json"));
requireCondition(
  packageJson.private === true,
  "package.json must remain private",
);
requireCondition(
  packageJson.license === "UNLICENSED",
  "package.json license must remain UNLICENSED",
);

const license = read("LICENSE");
requireCondition(
  license.startsWith("SyncAI Proprietary Software License Notice"),
  "root LICENSE must be the proprietary notice",
);
requireCondition(
  license.includes("legacy-mit-final-2026-08-22"),
  "root LICENSE must preserve the historical MIT boundary",
);

const notice = read("NOTICE");
requireCondition(
  notice.includes("4e560153f72d80e4619d22b33a1b87706c45e5f4"),
  "NOTICE must identify the final canonical MIT main commit",
);

const readme = read("README.md");
requireCondition(
  !readme.includes("License-MIT"),
  "README must not advertise the current repository as MIT",
);
requireCondition(
  readme.includes("License-Proprietary"),
  "README must advertise the current proprietary license",
);

requireCondition(
  read(".github/CODEOWNERS").includes("* @Stiggtechnologies"),
  "CODEOWNERS must retain repository-wide ownership",
);

const gitleaksConfig = read(".gitleaks.toml");
requireCondition(
  gitleaksConfig.includes('minVersion = "8.24.0"') &&
    gitleaksConfig.includes("useDefault = true"),
  "Gitleaks must extend the default rules at the reviewed minimum version",
);
requireCondition(
  !/^\s*(?:paths|commits)\s*=/m.test(gitleaksConfig),
  "Gitleaks must not broadly allowlist paths or commits",
);
for (const reviewedFixture of [
  "YOUR_ANON_KEY",
  "SERVICE_ROLE_KEY",
  "4100xpc-hoist-rgb",
]) {
  requireCondition(
    gitleaksConfig.includes(reviewedFixture),
    `Gitleaks reviewed-fixture allowlist is missing ${reviewedFixture}`,
  );
}

// These are CREDENTIAL-INCIDENT records, and the obligation is on their content,
// not on their location. FINAL-AUDIT-REPORT.md moved to docs/archive/ on
// 2026-08-20 because its *shipped-state* claims did not survive review — the
// incident record inside it is unaffected and must still hold.
//
// So the check follows the file instead of assuming the root. It fails if the
// record is missing from BOTH places, which is the condition that actually
// matters; it must never be satisfied by the file merely having been moved or
// removed.
for (const incidentRecord of ["FINAL-AUDIT-REPORT.md", "SECRETS.md"]) {
  const homes = [incidentRecord, `docs/archive/${incidentRecord}`].filter((p) =>
    existsSync(resolve(repositoryRoot, p)),
  );
  requireCondition(
    homes.length > 0,
    `${incidentRecord} is at neither the repository root nor docs/archive/ — a credential-incident record may be archived, never dropped`,
  );
  for (const home of homes) {
    requireCondition(
      read(home).includes("rotation must be independently verified"),
      `${home} must not restore historical credential fragments`,
    );
  }
}

const workflowDirectory = resolve(repositoryRoot, ".github/workflows");
const mutableActionReferences = [];
for (const fileName of readdirSync(workflowDirectory).filter((name) =>
  name.endsWith(".yml"),
)) {
  const contents = read(`.github/workflows/${fileName}`);
  for (const match of contents.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
    const actionReference = match[1];
    if (
      actionReference.startsWith("./") ||
      actionReference.startsWith("docker://")
    ) {
      continue;
    }
    const revision = actionReference.split("@").at(-1);
    if (!/^[0-9a-f]{40}$/i.test(revision)) {
      mutableActionReferences.push(`${fileName}: ${actionReference}`);
    }
  }
}
requireCondition(
  mutableActionReferences.length === 0,
  `GitHub Actions must use immutable SHAs: ${mutableActionReferences.join(", ")}`,
);

const trackedEnvironmentFiles = execFileSync(
  "git",
  ["ls-files", "*.env", ".env", ".env.*"],
  { cwd: repositoryRoot, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter(
    (path) =>
      !path.endsWith(".example") &&
      !path.endsWith(".template") &&
      !path.endsWith(".sample"),
  );
requireCondition(
  trackedEnvironmentFiles.length === 0,
  `Tracked environment files are prohibited: ${trackedEnvironmentFiles.join(", ")}`,
);

try {
  const taggedCommit = execFileSync(
    "git",
    ["rev-parse", "legacy-mit-final-2026-08-22^{}"],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();
  requireCondition(
    taggedCommit === "4e560153f72d80e4619d22b33a1b87706c45e5f4",
    `Legacy MIT tag points to unexpected commit: ${taggedCommit}`,
  );
} catch {
  failures.push("Legacy MIT tag is missing from the checkout");
}

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Repository licensing and governance invariants passed.");
