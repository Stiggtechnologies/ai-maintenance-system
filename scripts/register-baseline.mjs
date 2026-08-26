#!/usr/bin/env node
/**
 * Capability-register ratchet.
 *
 * The tally script catches the COUNT drifting. It does not catch a single row
 * quietly losing its status or its evidence — which is exactly what happened
 * during a merge: C8.07 went from "✅ all ten modelled (job_plans…)" back to a
 * bare "❌" while the totals still added up, because another row had moved the
 * other way. The count was consistent and the register was wrong.
 *
 * So the baseline records, per item, what has already been demonstrated. A
 * regression fails the test. A DELIBERATE downgrade is still allowed — slice 10
 * honestly demoted five decision rights — but it requires regenerating the
 * baseline in the same commit, which puts the downgrade in the diff where a
 * reviewer sees it instead of in a merge nobody reads.
 *
 *   node scripts/register-baseline.mjs           # print drift
 *   node scripts/register-baseline.mjs --write   # accept current state
 *   node scripts/register-baseline.mjs --check   # exit 1 on regression (CI)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const REGISTER = "docs/enterprise-readiness/capability-register.md";
const BASELINE = "docs/enterprise-readiness/capability-baseline.json";
const ROW = /^\|\s*([A-Z]\d+\.\d+)\s*\|([^|]*)\|\s*(✅|🟡|❌)([^|]*)\|/u;
const RANK = { "❌": 0, "🟡": 1, "✅": 2 };

/**
 * How many machine-checkable names this row's evidence carries.
 *
 * The reachability gate can only enforce a row that NAMES something: a
 * backticked span, or a snake_case function name in prose. That makes
 * de-citation the cheapest possible evasion — deleting two backticks keeps the
 * sentence, keeps the `evidence` flag below true, satisfies every existing
 * check, and silently removes the row from the gate's scope. Stripping the
 * backticks off five rows dropped the gate's enforced-✅ count by 20% with the
 * whole suite green and `register:check` reporting "no regression".
 *
 * So citations are counted and ratcheted like status is. The gate and the
 * ratchet were each assuming the other was watching this.
 */
export function countCitations(evidence) {
  const backticked = evidence.match(/`[^`]+`/g) ?? [];
  const prose = evidence.replace(/`[^`]+`/g, " ");
  const snake = prose.match(/(?<![\w.-])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![\w-])/g) ?? [];
  return new Set([...backticked.map((b) => b.slice(1, -1).trim()), ...snake]).size;
}

export function readRegister(source = readFileSync(REGISTER, "utf8")) {
  const items = {};
  for (const line of source.split("\n")) {
    const m = ROW.exec(line);
    if (!m) continue;
    items[m[1]] = {
      status: m[3],
      // "Evidence" means the status glyph is followed by a substantive claim.
      // A bare glyph asserts a capability exists without saying where.
      evidence: m[4].trim().length >= 12,
      citations: countCitations(m[4].trim()),
    };
  }
  return items;
}

const current = readRegister();

if (process.argv.includes("--write")) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
  console.log(`wrote baseline — ${Object.keys(current).length} items`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`No baseline. Run: node scripts/register-baseline.mjs --write`);
  process.exit(1);
}

const base = JSON.parse(readFileSync(BASELINE, "utf8"));
const problems = [];

for (const [id, was] of Object.entries(base)) {
  const now = current[id];
  if (!now) {
    problems.push(`${id}: REMOVED from the register — items may never be dropped`);
    continue;
  }
  if (RANK[now.status] < RANK[was.status]) {
    problems.push(`${id}: status regressed ${was.status} → ${now.status}`);
  }
  if (was.evidence && !now.evidence) {
    problems.push(`${id}: evidence removed — now a bare ${now.status} with nothing behind it`);
  }
  if ((now.citations ?? 0) < (was.citations ?? 0)) {
    problems.push(
      `${id}: citations dropped ${was.citations} → ${now.citations} — the prose may be intact, ` +
        `but the reachability gate can no longer check this row`,
    );
  }
}

if (problems.length > 0) {
  console.error("Capability register regressed:\n  " + problems.join("\n  "));
  console.error(
    "\nIf a downgrade is intentional and honest, say so in the commit and run:\n" +
      "  node scripts/register-baseline.mjs --write",
  );
  process.exit(1);
}

const gained = Object.entries(current).filter(
  ([id, n]) => base[id] && RANK[n.status] > RANK[base[id].status],
);
console.log(
  `no regression — ${Object.keys(current).length} items, ${gained.length} improved since baseline`,
);
