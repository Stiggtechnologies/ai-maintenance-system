#!/usr/bin/env node
/**
 * Register tallies — derived from the tables, never hand-typed.
 *
 * The enterprise register's headline count is derived because a hand-typed
 * figure once under-counted it by 90 items (307 vs the true 397) and, because
 * two workstreams edit it in parallel, the tally line became the single most
 * frequent merge conflict in the repo.
 *
 * The sync-develop register carries the SAME headline sentence and had the
 * same failure for the same reason: it was maintained by hand, and slice 3B
 * shipped ten status changes while the line still read the slice-3A figures
 * (✅ 40 · 🟡 126 · ❌ 68 against a true ✅ 50 · 🟡 117 · ❌ 67). That register
 * even tells its reader "the tally is derived, never hand-typed" — which was
 * the claim, not the mechanism. It is now the mechanism: both registers are
 * counted here, and `--check` fails CI on either one drifting.
 *
 * The two registers have different table shapes, so each states its own row
 * pattern and its own tally sentence rather than sharing a lossy one:
 *
 *   enterprise-readiness  | <ID> | <capability> | <status> …
 *   sync-develop          | <ID> | <capability> | <spec ref> | <status> …
 *
 *   node scripts/register-tally.mjs          # print both tallies
 *   node scripts/register-tally.mjs --write  # rewrite the tally lines in place
 *   node scripts/register-tally.mjs --check  # exit 1 if either is stale (CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { claimLines } from "./register-baseline.mjs";

const REGISTERS = [
  {
    path: "docs/enterprise-readiness/capability-register.md",
    // | <ID> | <capability> | <status glyph + optional evidence> |
    row: /^\|\s*([A-Z]\d+\.\d+)\s*\|[^|]*\|\s*(✅|🟡|❌)/u,
    tally: /Current tally: ✅ \d+ · 🟡 \d+ · ❌ \d+\./u,
    render: (counts) =>
      `Current tally: ✅ ${counts["✅"]} · 🟡 ${counts["🟡"]} · ❌ ${counts["❌"]}.`,
  },
  {
    path: "docs/sync-develop/register.md",
    // | <ID> | <capability> | <spec ref> | <status glyph> | <evidence> |
    row: /^\|\s*([A-Z]\d+\.\d+)\s*\|[^|]*\|[^|]*\|\s*(✅|🟡|❌)/u,
    tally: /Current tally: ✅ \d+ · 🟡 \d+ · ❌ \d+ \(\d+ items\)\./u,
    render: (counts, total) =>
      `Current tally: ✅ ${counts["✅"]} · 🟡 ${counts["🟡"]} · ❌ ${counts["❌"]} (${total} items).`,
  },
];

/**
 * Counted over the register's CLAIM LINES, not over "lines that happen to
 * match" — every table line that is not a `|---|` rule or the header above
 * one. A line that does not parse is a throw, never a skip.
 *
 * The old loop skipped silently, so `| **D1.99** | … | ✅ | … |` was not
 * counted, the total stayed 234, and the derived tally agreed with the
 * hand-written sentence about a register that had 235 rows in it. All three
 * register mechanisms — this tally, the per-row ratchet and the reachability
 * gate — shared that blind spot, so "write the row slightly differently" left
 * all three at once.
 */
export function tallyRegister(register, source) {
  const counts = { "✅": 0, "🟡": 0, "❌": 0 };
  const ids = new Set();
  const unparsed = [];
  for (const { text, line } of claimLines(source)) {
    const m = register.row.exec(text);
    if (!m) {
      unparsed.push(`  ${register.path}:${line}  ${text.trim().slice(0, 160)}`);
      continue;
    }
    if (ids.has(m[1])) {
      throw new Error(`Duplicate register ID in ${register.path}: ${m[1]}`);
    }
    ids.add(m[1]);
    counts[m[2]] += 1;
  }
  if (unparsed.length > 0) {
    throw new Error(
      `${register.path}: ${unparsed.length} table row(s) do not parse. An ` +
        `uncounted row is a row outside the tally, the ratchet and the ` +
        `reachability gate at once — fix the row or the pattern, never drop it:\n` +
        unparsed.join("\n"),
    );
  }
  return { counts, total: ids.size, line: register.render(counts, ids.size) };
}

function main() {
  const mode = process.argv.includes("--write")
    ? "write"
    : process.argv.includes("--check")
      ? "check"
      : "print";

  let stale = 0;
  for (const register of REGISTERS) {
    const source = readFileSync(register.path, "utf8");
    const { line, total } = tallyRegister(register, source);
    const summary = `${register.path} — ${total} items | ${line}`;

    if (mode === "write") {
      if (!register.tally.test(source)) {
        throw new Error(`Tally sentence not found in ${register.path}`);
      }
      writeFileSync(register.path, source.replace(register.tally, line));
      console.log(`wrote — ${summary}`);
    } else if (mode === "check") {
      const found = register.tally.exec(source)?.[0];
      if (found !== line) {
        console.error(
          `Register tally is stale in ${register.path}.\n  in file: ${found}\n  actual:  ${line}\nRun: node scripts/register-tally.mjs --write`,
        );
        stale += 1;
      } else {
        console.log(`up to date — ${summary}`);
      }
    } else {
      console.log(summary);
    }
  }

  if (stale > 0) process.exit(1);
}

/** Run as a script, never on import — see the note in register-baseline.mjs. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
