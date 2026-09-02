#!/usr/bin/env node
/**
 * Capability-register ratchet — BOTH registers.
 *
 * The tally script catches the COUNT drifting. It does not catch a single row
 * quietly losing its status or its evidence — which is exactly what happened
 * during a merge: C8.07 went from "✅ all ten modelled (job_plans…)" back to a
 * bare "❌" while the totals still added up, because another row had moved the
 * other way. The count was consistent and the register was wrong.
 *
 * So the baseline records, per item, what has already been demonstrated. A
 * regression fails the check. A DELIBERATE downgrade is still allowed — slice 10
 * honestly demoted five decision rights — but it requires regenerating the
 * baseline in the same commit, which puts the downgrade in the diff where a
 * reviewer sees it instead of in a merge nobody reads.
 *
 * ── Why both ───────────────────────────────────────────────────────────────
 *
 * This ratchet was enterprise-only, and `docs/sync-develop/register.md` was
 * therefore the one register where a ✅ could become a ❌ with NOTHING in the
 * diff to show it. Four slices moved rows in it. `register-tally.mjs` was
 * generalized to both on 2026-08-27 for the same reason and this file is the
 * other half: the tally proves the counts add up, the baseline proves no
 * individual row went backwards. The two registers have different table shapes
 * — the D-family puts status in its own cell after a spec-ref column — so each
 * states its own pattern rather than sharing a lossy one.
 *
 * A table row that does not parse is a FAILURE, never a skip: a
 * silently-dropped row is an unratcheted row, and "reformat the row" would
 * become the cheapest way out of the ratchet. That test used to be "looks like
 * a row" — ID-shaped first cell — which left `| **D1.99** | … | ✅ | … |`
 * invisible to it. It is now every table line that is not a `|---|` rule or a
 * header above one.
 *
 *   node scripts/register-baseline.mjs           # print drift for both
 *   node scripts/register-baseline.mjs --write   # accept current state of both
 *   node scripts/register-baseline.mjs --check   # exit 1 on regression in either (CI)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REGISTERS = [
  {
    name: "enterprise-readiness",
    path: "docs/enterprise-readiness/capability-register.md",
    baseline: "docs/enterprise-readiness/capability-baseline.json",
    // | <ID> | <capability> | <status glyph><evidence> |
    row: /^\|\s*(?<id>[A-Z]\d+\.\d+)\s*\|(?<capability>[^|]*)\|\s*(?<status>✅|🟡|❌)(?<evidence>[^|]*)\|/u,
  },
  {
    name: "sync-develop",
    path: "docs/sync-develop/register.md",
    baseline: "docs/sync-develop/register-baseline.json",
    // | <ID> | <capability> | <spec ref> | <status> | <evidence> |
    //
    // Evidence is the LAST cell and deliberately not `[^|]*`: nine rows quote a
    // grep alternation (`grep 'ncr\|nonconformance'`), and a pipe-free cell
    // pattern truncates there — dropping every citation after the escaped pipe,
    // which is precisely the de-citation this ratchet counts.
    row: /^\|\s*(?<id>[A-Z]\d+\.\d+)\s*\|(?<capability>[^|]*)\|(?<specRef>[^|]*)\|\s*(?<status>✅|🟡|❌)\s*\|(?<evidence>.*?)\|?\s*$/u,
  },
];

/** The `|---|:--:|` rule under a table header. Structure, never a claim. */
const TABLE_RULE = /^[ \t]*\|[\s:|-]*-[\s:|-]*$/u;

/**
 * Every line of a register that ASSERTS something, and therefore must parse.
 *
 * This used to be "a line whose first cell is ID-shaped", which meant the
 * throw below only ever fired for lines that already looked like rows. A line
 * that did not look ID-shaped was dropped in silence:
 *
 *   | **D1.99** | Invisible capability | I.3 | ✅ | Shipped via `add_framework_gate`. |
 *
 * Two asterisks bought a ✅ row, citing a provably dead function, that this
 * ratchet never recorded and therefore could never catch going backwards.
 *
 * The rule is now absolute and structural: in a register, EVERY table line is
 * a claim except the two that cannot be one — the `|---|` rule, and the header
 * directly above a rule. There is no ignore list, and adding one would restore
 * the bypass in a form a reviewer would wave through.
 *
 * Mirrored deliberately in `src/test/support/capabilityEvidence.ts`; the two
 * are held in step by `capability-register.test.ts`, which imports this
 * function and asserts both parsers see the same row IDs in the real files.
 */
export function claimLines(source) {
  const lines = source.split("\n");
  const claims = [];
  lines.forEach((text, i) => {
    if (!/^[ \t]*\|/u.test(text)) return;
    if (TABLE_RULE.test(text)) return;
    if (TABLE_RULE.test(lines[i + 1] ?? "")) return; // a header above a rule
    claims.push({ text, line: i + 1 });
  });
  return claims;
}

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
 *
 * BACKTICKED SPANS ARE COUNTED SEPARATELY, and that is not bookkeeping. The
 * reachability gate mines unbackticked prose for snake_case names, but ONLY
 * promotes ones the migration chain declares as FUNCTIONS — tables are
 * deliberately never mined from prose, because table names in this domain are
 * ordinary noun phrases and the write-path judge is the expensive one to get
 * wrong. So deleting two backticks from a cited TABLE removes the row from the
 * gate while `total` does not move by one: the name simply reappears in the
 * prose set. `audit_events` is exactly that shape, and the one ✅ D-row naming
 * it escaped the write-path judge for six weeks on missing backticks alone.
 * The same is true of any camelCase symbol, which prose mining never touches.
 */
export function countCitations(evidence) {
  const backticked = evidence.match(/`[^`]+`/g) ?? [];
  const prose = evidence.replace(/`[^`]+`/g, " ");
  const snake = prose.match(/(?<![\w.-])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![\w-])/g) ?? [];
  const marked = new Set(backticked.map((b) => b.slice(1, -1).trim()));
  return {
    total: new Set([...marked, ...snake]).size,
    backticked: marked.size,
  };
}

export function readRegister(register, source = readFileSync(register.path, "utf8")) {
  const items = {};
  const unparsed = [];
  for (const { text, line } of claimLines(source)) {
    const m = register.row.exec(text);
    if (!m?.groups) {
      unparsed.push(`  ${register.path}:${line}  ${text.trim().slice(0, 160)}`);
      continue;
    }
    // The develop pattern captures greedily to end of line (it was quadratic
    // when lazy), so the row's trailing table pipe rides along and is stripped.
    const evidence = m.groups.evidence.replace(/\s*\|\s*$/, "").trim();
    const counted = countCitations(evidence);
    items[m.groups.id] = {
      status: m.groups.status,
      // "Evidence" means the status glyph is followed by a substantive claim.
      // A bare glyph asserts a capability exists without saying where.
      evidence: evidence.length >= 12,
      citations: counted.total,
      backticked: counted.backticked,
    };
  }
  if (unparsed.length > 0) {
    throw new Error(
      `${register.name}: ${unparsed.length} table row(s) in this register do not parse. ` +
        `An unparseable row is an UNRATCHETED row — fix the row or the pattern, never drop it, ` +
        `and never teach the parser to ignore a table:\n` +
        unparsed.join("\n"),
    );
  }
  if (Object.keys(items).length === 0) {
    throw new Error(
      `${register.name}: parsed ZERO rows from ${register.path}. An empty baseline ` +
        `ratchets nothing — the pattern and the file have diverged.`,
    );
  }
  return items;
}

/** Every way `was` may have gone backwards to `now`, named precisely. */
export function regressions(base, current) {
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
    if ((now.backticked ?? 0) < (was.backticked ?? 0)) {
      problems.push(
        `${id}: backticked citations dropped ${was.backticked} → ${now.backticked} — a cited ` +
          `TABLE or camelCase symbol moved out of backticks leaves the gate's reach while the ` +
          `citation total does not move, because prose mining promotes functions only`,
      );
    }
  }
  return problems;
}

function main() {
  const mode = process.argv.includes("--write")
    ? "write"
    : process.argv.includes("--check")
      ? "check"
      : "print";

  let failed = 0;
  for (const register of REGISTERS) {
    const current = readRegister(register);

    if (mode === "write") {
      writeFileSync(register.baseline, JSON.stringify(current, null, 2) + "\n");
      console.log(
        `wrote ${register.baseline} — ${Object.keys(current).length} items`,
      );
      continue;
    }

    if (!existsSync(register.baseline)) {
      console.error(
        `No baseline for ${register.name} at ${register.baseline}.\n` +
          `  Run:  node scripts/register-baseline.mjs --write\n` +
          `  Then: git add ${register.baseline}\n` +
          `The baseline is read at module scope by src/test/capability-register.test.ts, ` +
          `so an unstaged baseline takes that whole file — including the ${register.name} ` +
          `assertions that have nothing to do with it — down at collection time.`,
      );
      failed += 1;
      continue;
    }

    const base = JSON.parse(readFileSync(register.baseline, "utf8"));
    const problems = regressions(base, current);

    if (problems.length > 0) {
      console.error(
        `${register.name} register regressed:\n  ` + problems.join("\n  "),
      );
      failed += 1;
      continue;
    }

    const gained = Object.entries(current).filter(
      ([id, n]) => base[id] && RANK[n.status] > RANK[base[id].status],
    );
    console.log(
      `no regression in ${register.name} — ${Object.keys(current).length} items, ` +
        `${gained.length} improved since baseline`,
    );
  }

  if (failed > 0) {
    console.error(
      "\nIf a downgrade is intentional and honest, say so in the commit and run:\n" +
        "  node scripts/register-baseline.mjs --write",
    );
    process.exit(1);
  }
}

/**
 * Run only as a script, never on import.
 *
 * `readRegister` and `claimLines` are the ratchet's half of a parser that
 * `src/test/support/capabilityEvidence.ts` states a second time in TypeScript,
 * and two copies of a rule drift. The test that holds them in step has to
 * import this file — and importing it used to run the whole check, print to
 * the test log and, with a baseline missing, call `process.exit(1)` from
 * inside the test runner.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
