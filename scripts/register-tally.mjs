#!/usr/bin/env node
/**
 * Capability-register tally.
 *
 * The register's headline count is derived FROM THE TABLES, never hand-typed.
 * A hand-typed figure once under-counted the register by 90 items (307 vs the
 * true 397) and, because two workstreams edit the register in parallel, the
 * tally line became the single most frequent merge conflict in the repo.
 *
 *   node scripts/register-tally.mjs          # print the tally
 *   node scripts/register-tally.mjs --write  # rewrite the tally line in place
 *   node scripts/register-tally.mjs --check  # exit 1 if the line is stale (CI)
 */
import { readFileSync, writeFileSync } from "node:fs";

const PATH = "docs/enterprise-readiness/capability-register.md";
// A register row: | <ID> | <capability> | <status glyph + optional evidence> |
const ROW = /^\|\s*([A-Z]\d+\.\d+)\s*\|[^|]*\|\s*(✅|🟡|❌)/u;
const TALLY = /Current tally: ✅ \d+ · 🟡 \d+ · ❌ \d+\./u;

const source = readFileSync(PATH, "utf8");
const counts = { "✅": 0, "🟡": 0, "❌": 0 };
const ids = new Set();

for (const line of source.split("\n")) {
  const m = ROW.exec(line);
  if (!m) continue;
  if (ids.has(m[1])) throw new Error(`Duplicate register ID: ${m[1]}`);
  ids.add(m[1]);
  counts[m[2]] += 1;
}

const total = ids.size;
const line = `Current tally: ✅ ${counts["✅"]} · 🟡 ${counts["🟡"]} · ❌ ${counts["❌"]}.`;
const summary = `${total} items | ${line}`;

if (process.argv.includes("--write")) {
  if (!TALLY.test(source)) throw new Error("Tally sentence not found in register");
  writeFileSync(PATH, source.replace(TALLY, line));
  console.log(`wrote — ${summary}`);
} else if (process.argv.includes("--check")) {
  const found = TALLY.exec(source)?.[0];
  if (found !== line) {
    console.error(`Register tally is stale.\n  in file: ${found}\n  actual:  ${line}\nRun: node scripts/register-tally.mjs --write`);
    process.exit(1);
  }
  console.log(`up to date — ${summary}`);
} else {
  console.log(summary);
}
