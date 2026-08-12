import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Guards the one divergence CI cannot otherwise see: the `migrations` job proves
// the chain applies in VERSION order from empty, while production applies it in
// MERGE order on top of whatever is already deployed. Those agree only while every
// newly merged migration sorts after the deployed head. When a long-lived branch
// merges with an older timestamp they diverge, `supabase db push` refuses the
// batch, and deployment stops silently while CI stays green — which is how 26
// migrations accumulated undeployed behind PR #185.

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const migrationDir = "supabase/migrations";
const baseRef = process.env.MIGRATION_ORDER_BASE_REF ?? "origin/main";

const git = (...args) =>
  execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();

const versionOf = (file) => path.basename(file).split("_")[0];
const isMigration = (file) =>
  file.startsWith(`${migrationDir}/`) && file.endsWith(".sql");

let mergeBase;
try {
  mergeBase = git("merge-base", "HEAD", baseRef);
} catch {
  console.log(
    `Migration order: ${baseRef} unavailable (shallow clone or detached history) — skipping.`,
  );
  process.exit(0);
}

// Migrations this branch adds, versus those already on the deployment branch.
const added = git("diff", "--name-only", "--diff-filter=A", `${mergeBase}..HEAD`)
  .split("\n")
  .filter(isMigration);

if (added.length === 0) {
  console.log("Migration order: no new migrations on this branch.");
  process.exit(0);
}

const baseVersions = git("ls-tree", "-r", "--name-only", baseRef, migrationDir)
  .split("\n")
  .filter(isMigration)
  .map(versionOf)
  .sort();

const deployedHead = baseVersions.at(-1) ?? "";

const offenders = added
  .map((file) => ({ file, version: versionOf(file) }))
  .filter(({ version }) => version <= deployedHead)
  .sort((left, right) => left.version.localeCompare(right.version));

if (offenders.length > 0) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suggested = stamp > deployedHead ? stamp : `${Number(deployedHead) + 1}`;
  console.error(
    `Migration order check failed against ${baseRef} (deployed head ${deployedHead}):`,
  );
  for (const { file, version } of offenders) {
    console.error(`- ${file} (${version}) sorts at or before the deployed head`);
  }
  console.error(
    `\nProduction would have to apply these out of order, which is not what CI proves.` +
      `\nRename each file to a version after ${deployedHead} — e.g. ${suggested}_<name>.sql — and rebase.`,
  );
  process.exit(1);
}

const newest = added.map(versionOf).sort().at(-1);
console.log(
  `Migration order verified: ${added.length} new migration(s), ${deployedHead || "(none)"} -> ${newest}.`,
);
