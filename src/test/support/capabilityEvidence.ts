/**
 * Turns the capability register's free-text evidence into checkable claims.
 *
 * WHY THIS EXISTS. `capability-register.test.ts` asserts row count, ID
 * uniqueness, tally arithmetic, a non-majority of ✅, and a ratchet against
 * silent downgrades. Every one of those is a statement about the DOCUMENT.
 * None of them is a statement about the PRODUCT. A row reading
 *
 *   | C4.08 | Verify | ✅ `record_verification_result` records the outcome |
 *
 * passes all five while the cited function has zero callers and the loop it
 * closes is structurally 0% closed. That is not hypothetical: a triage of the
 * 399 rows found 31 capabilities shipped as SELECT-only RLS plus a demo seed
 * plus a read panel — schema and a screen, no way for a customer to create the
 * record the row claims they can create.
 *
 * So this module resolves each ✅ row's evidence to code and asks two
 * questions the document cannot answer about itself:
 *
 *   1. REACHABILITY — is the cited symbol called by anything that is not a
 *      test, from a module an entry point actually imports?
 *   2. WRITE PATH — can a customer create a row in the cited table, or does
 *      the capability exist only as read-only RLS over a demo seed?
 *
 * ── The false-positive problem, and how conservatism is bought ──────────────
 *
 * Evidence is prose. "Modelled as loss of the supplying asset and cascaded
 * through the dependency graph" cites nothing greppable; `structure`,
 * `logical`, `natural`, `none` and `shrink-0` appear in backticks and are a
 * vocabulary word, a word, a word, an enum value and a CSS class. A gate that
 * guessed at those would fail on noise, get an allowlist bolted on, and the
 * allowlist would become the real policy.
 *
 * The rule is therefore: EXTRACT ONLY WHAT RESOLVES. A backticked span is
 * enforced only when it is (a) camelCase and a definition for it exists in the
 * TypeScript corpus, (b) snake_case and the migration chain actually declares
 * a function or table by that name, or (c) a repo-relative file path that
 * exists. Everything else is recorded as SKIPPED with the reason, and the
 * counts of both are asserted — because a gate that silently enforces four
 * rows is worse than no gate at all: it certifies the other 395 by implication.
 *
 * Deliberately NOT done: no transitive symbol-level call graph. Module-level
 * reachability from the entry points is cheap and exact; symbol-level would
 * need a real TS program and would fail open on re-exports. The consequence is
 * stated honestly — a symbol called only by a dead sibling in a LIVE module
 * passes this gate. That is a weaker claim than "reachable from a click", and
 * this file does not pretend otherwise.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve as resolvePath } from "node:path";
import {
  MIGRATIONS_DIR,
  migrationFiles,
  resolveChainPolicies,
  stripComments,
} from "./migrationPolicies";

export const REGISTER_PATH = "docs/enterprise-readiness/capability-register.md";

/* ─────────────────────────── the register itself ────────────────────────── */

export interface RegisterRow {
  id: string;
  capability: string;
  status: "✅" | "🟡" | "❌";
  /** Everything after the status glyph in the status cell. */
  evidence: string;
  line: number;
}

const ROW = /^\|\s*([A-Z]\d+\.\d+)\s*\|([^|]*)\|\s*(✅|🟡|❌)([^|]*)\|/u;

export function parseRegister(
  source = readFileSync(REGISTER_PATH, "utf8"),
): RegisterRow[] {
  const rows: RegisterRow[] = [];
  source.split("\n").forEach((line, i) => {
    const m = ROW.exec(line);
    if (!m) return;
    rows.push({
      id: m[1],
      capability: m[2].trim(),
      status: m[3] as RegisterRow["status"],
      evidence: m[4].trim(),
      line: i + 1,
    });
  });
  return rows;
}

/* ──────────────────────────── the code corpus ───────────────────────────── */

const TS_ROOTS = ["src", "supabase/functions"];
const CODE_EXT = new Set([".ts", ".tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".claude") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE_EXT.has(extname(full))) out.push(full);
  }
  return out;
}

export const isTestFile = (path: string): boolean =>
  /\.(test|spec)\.tsx?$/.test(path) || path.startsWith("src/test/");

export interface CodeCorpus {
  /** Every .ts/.tsx file under src/ and supabase/functions/, path → text. */
  files: Map<string, string>;
  /** Non-test files an entry point transitively imports. */
  reachable: Set<string>;
  /** Entry points reachability was computed from. */
  roots: string[];
}

/** Resolves a relative import specifier to a file in the corpus. */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolvePath(fromFile, "..", spec);
  const cwd = process.cwd() + "/";
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    // `allowImportingTsExtensions` is off in the edge-function tsconfig, so a
    // few specifiers carry `.js` for a `.ts` file.
    base.replace(/\.js$/, ".ts"),
  ];
  for (const c of candidates) {
    if (!existsSync(c) || statSync(c).isDirectory()) continue;
    return c.startsWith(cwd) ? c.slice(cwd.length) : c;
  }
  return null;
}

const IMPORT_SPEC =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s*["']([^"']+)["']/g;

export function loadCorpus(): CodeCorpus {
  const files = new Map<string, string>();
  for (const root of TS_ROOTS) {
    for (const path of walk(root)) files.set(path, readFileSync(path, "utf8"));
  }

  // Entry points: the SPA bootstrap and every deployed edge-function handler.
  // Anything neither transitively imports is dead as far as a customer is
  // concerned, however well it is written or tested.
  const roots = [
    "src/main.tsx",
    ...[...files.keys()].filter((f) =>
      /^supabase\/functions\/[^/]+\/index\.ts$/.test(f),
    ),
  ].filter((f) => files.has(f));

  const reachable = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (reachable.has(file) || isTestFile(file)) continue;
    reachable.add(file);
    const text = files.get(file);
    if (!text) continue;
    for (const m of text.matchAll(IMPORT_SPEC)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec) continue;
      const target = resolveImport(file, spec);
      if (target && files.has(target) && !reachable.has(target)) {
        queue.push(target);
      }
    }
  }
  return { files, reachable, roots };
}

/* ───────────────────────────── the SQL corpus ───────────────────────────── */

export interface SqlCorpus {
  /** migration filename → comment-stripped text. */
  files: Map<string, string>;
  /** function name → migration files defining it. */
  functions: Map<string, string[]>;
  /** table name → migration files creating it. */
  tables: Map<string, string[]>;
}

/** A demo/seed migration is not a customer write path; it is furniture. */
export const isDemoMigration = (file: string): boolean =>
  /demo|seed|backfill|purge/i.test(file);

export function loadSql(dir = MIGRATIONS_DIR): SqlCorpus {
  const files = new Map<string, string>();
  const functions = new Map<string, string[]>();
  const tables = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, file: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(file)) list.push(file);
    map.set(key, list);
  };

  for (const file of migrationFiles(dir)) {
    const sql = stripComments(readFileSync(join(dir, file), "utf8"));
    files.set(file, sql);
    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi,
    )) {
      add(functions, m[1].toLowerCase(), file);
    }
    for (const m of sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    )) {
      add(tables, m[1].toLowerCase(), file);
    }
  }
  return { files, functions, tables };
}

/* ──────────────────────────── citation extraction ───────────────────────── */

export type CitationKind = "ts-symbol" | "sql-function" | "sql-table" | "file";

export interface Citation {
  id: string;
  /** The backticked text as written in the register. */
  raw: string;
  /** The identifier after normalisation (parens and paths stripped). */
  name: string;
  kind: CitationKind;
}

export interface SkippedCitation {
  id: string;
  raw: string;
  reason: string;
}

const BACKTICKED = /`([^`]+)`/g;
/** camelCase: starts lower, contains an upper. Excludes bare words. */
const CAMEL = /^[a-z][A-Za-z0-9]*$/;
const HAS_UPPER = /[A-Z]/;
/** snake_case with at least one underscore. Excludes bare words. */
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
const FILE_PATH = /^[\w./-]+\.(?:ts|tsx|mjs|sql|json)$/;

export interface Extraction {
  enforceable: Citation[];
  skipped: SkippedCitation[];
}

/**
 * Pulls the citable identifiers out of one row's evidence.
 *
 * Only backticked spans are considered. Prose that names a concept without
 * marking it as code ("cascaded through the dependency graph") is not a
 * citation and is not treated as one — inventing an identifier out of prose is
 * exactly the false-positive class that would sink this gate.
 */
export function extractCitations(
  row: RegisterRow,
  code: CodeCorpus,
  sql: SqlCorpus,
  tsSymbols: Map<string, string[]>,
): Extraction {
  const enforceable: Citation[] = [];
  const skipped: SkippedCitation[] = [];
  const seen = new Set<string>();

  for (const m of row.evidence.matchAll(BACKTICKED)) {
    const raw = m[1].trim();
    if (seen.has(raw)) continue;
    seen.add(raw);
    const bare = raw.replace(/\(\s*\)$/, "").trim();

    if (FILE_PATH.test(bare) || bare.includes("/")) {
      if (existsSync(bare) || code.files.has(bare)) {
        enforceable.push({ id: row.id, raw, name: bare, kind: "file" });
      } else {
        skipped.push({
          id: row.id,
          raw,
          reason: "path-shaped but no such file in the repo",
        });
      }
      continue;
    }

    if (CAMEL.test(bare) && HAS_UPPER.test(bare)) {
      if (tsSymbols.has(bare)) {
        enforceable.push({ id: row.id, raw, name: bare, kind: "ts-symbol" });
      } else {
        skipped.push({
          id: row.id,
          raw,
          reason:
            "camelCase but no TypeScript definition — may name a column, a JSON key or a concept",
        });
      }
      continue;
    }

    if (SNAKE.test(bare)) {
      if (sql.functions.has(bare)) {
        enforceable.push({ id: row.id, raw, name: bare, kind: "sql-function" });
      } else if (sql.tables.has(bare)) {
        enforceable.push({ id: row.id, raw, name: bare, kind: "sql-table" });
      } else {
        skipped.push({
          id: row.id,
          raw,
          reason:
            "snake_case but the migration chain declares no such function or table — almost always a column name",
        });
      }
      continue;
    }

    skipped.push({
      id: row.id,
      raw,
      reason: "not identifier-shaped (prose, enum value, CSS class or literal)",
    });
  }
  return { enforceable, skipped };
}

/** Where each exported/declared TypeScript symbol is defined. */
export function indexTsSymbols(code: CodeCorpus): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const DECL =
    /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const [path, text] of code.files) {
    if (isTestFile(path)) continue;
    for (const m of text.matchAll(DECL)) {
      const list = index.get(m[1]) ?? [];
      if (!list.includes(path)) list.push(path);
      index.set(m[1], list);
    }
  }
  return index;
}

/* ───────────────────────────── the two verdicts ─────────────────────────── */

export interface Verdict {
  citation: Citation;
  ok: boolean;
  detail: string;
}

const wordRe = (name: string) =>
  new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);

/** A cited TypeScript symbol needs a non-test caller in a reachable module. */
export function judgeTsSymbol(
  citation: Citation,
  code: CodeCorpus,
  defs: Map<string, string[]>,
): Verdict {
  const definedIn = defs.get(citation.name) ?? [];
  const re = wordRe(citation.name);
  const callers = [...code.files]
    .filter(
      ([path, text]) =>
        !isTestFile(path) && !definedIn.includes(path) && re.test(text),
    )
    .map(([path]) => path);
  const liveCallers = callers.filter((c) => code.reachable.has(c));

  if (liveCallers.length > 0) {
    return {
      citation,
      ok: true,
      detail: `called from ${liveCallers.length} reachable module(s), e.g. ${liveCallers[0]}`,
    };
  }
  if (callers.length > 0) {
    return {
      citation,
      ok: false,
      detail: `called only from modules no entry point imports (${callers.slice(0, 3).join(", ")}) — dead code calling dead code`,
    };
  }
  const testOnly = [...code.files].filter(
    ([path, text]) => isTestFile(path) && re.test(text),
  ).length;
  return {
    citation,
    ok: false,
    detail: `ZERO non-test callers (defined in ${definedIn.join(", ") || "?"}; ${testOnly} test file(s) reference it) — the capability exists only in its own test`,
  };
}

/** A cited SQL function needs a caller: an RPC from live code, or a trigger. */
export function judgeSqlFunction(
  citation: Citation,
  code: CodeCorpus,
  sql: SqlCorpus,
): Verdict {
  const name = citation.name;
  const definedIn = sql.functions.get(name) ?? [];
  const re = wordRe(name);

  const tsCallers = [...code.files]
    .filter(([path, text]) => !isTestFile(path) && re.test(text))
    .map(([path]) => path);
  const liveTs = tsCallers.filter((p) => code.reachable.has(p));
  if (liveTs.length > 0) {
    return {
      citation,
      ok: true,
      detail: `invoked from ${liveTs[0]}`,
    };
  }

  // A trigger attachment is a caller even with no client ever naming it.
  const trigger = [...sql.files].filter(([, text]) =>
    new RegExp(
      `execute\\s+(?:function|procedure)\\s+(?:public\\.)?${name}\\s*\\(`,
      "i",
    ).test(text),
  );
  if (trigger.length > 0) {
    return {
      citation,
      ok: true,
      detail: `attached to a trigger in ${trigger[0][0]}`,
    };
  }

  // Called by another SQL function, in a migration that is not its own.
  const sqlCallers = [...sql.files].filter(
    ([file, text]) =>
      !definedIn.includes(file) &&
      !isDemoMigration(file) &&
      new RegExp(`\\b${name}\\s*\\(`, "i").test(text),
  );
  if (sqlCallers.length > 0) {
    return {
      citation,
      ok: true,
      detail: `called from SQL in ${sqlCallers[0][0]}`,
    };
  }

  return {
    citation,
    ok: false,
    detail: `ZERO callers — defined and granted in ${definedIn.join(", ")}, invoked by nothing; ${tsCallers.length} non-reachable TS mention(s)`,
  };
}

/** The command a surviving policy applies to. Absent `for` means ALL. */
export function policyCommand(statement: string): string {
  const m = /\bfor\s+(all|select|insert|update|delete)\b/i.exec(statement);
  return (m?.[1] ?? "all").toLowerCase();
}

const WRITE_COMMANDS = new Set(["all", "insert", "update", "delete"]);

/**
 * A cited table needs a write path a customer can actually take.
 *
 * SELECT-only policies plus a demo seed is the exact shape that produced 31
 * false ✅s: the schema is real, the panel renders, and no user of the product
 * can create the record the row claims they create. `service_role` does not
 * count — the customer does not hold that key.
 */
export function judgeSqlTable(
  citation: Citation,
  code: CodeCorpus,
  sql: SqlCorpus,
  policies = resolveChainPolicies(),
): Verdict {
  const table = citation.name;
  const onTable = [...policies.values()].filter((p) => p.table === table);

  if (onTable.length === 0) {
    // No RLS policy at all: either RLS is off (out of scope for this gate — the
    // tenancy suite owns that) or the table is not client-facing.
    return {
      citation,
      ok: true,
      detail: "no RLS policy resolved; write-path enforcement not applicable",
    };
  }

  const writable = onTable.filter((p) =>
    p.statements.some(
      (s) =>
        WRITE_COMMANDS.has(policyCommand(s)) &&
        !/\bto\s+service_role\b/i.test(s),
    ),
  );
  if (writable.length > 0) {
    return {
      citation,
      ok: true,
      detail: `policy ${writable[0].policy} (${writable[0].source}) admits writes`,
    };
  }

  // An edge function holding the service key bypasses RLS entirely, so a
  // SELECT-only policy set does NOT prove there is no write path. If live code
  // writes the table directly, that is a real path and the gate must see it —
  // otherwise the gate goes red the moment the feature lane fixes the problem.
  for (const [path, text] of code.files) {
    if (isTestFile(path) || !code.reachable.has(path)) continue;
    for (const m of text.matchAll(
      new RegExp(`from\\(\\s*["'\`]${table}["'\`]\\s*\\)`, "g"),
    )) {
      const window = text.slice(m.index, m.index + 240);
      if (/\.(insert|upsert|update|delete)\s*\(/.test(window)) {
        return { citation, ok: true, detail: `written directly from ${path}` };
      }
    }
  }

  // A SECURITY DEFINER function may write on the caller's behalf. It only
  // counts if something outside a demo seed can invoke it.
  const writers = [...sql.files].filter(
    ([file, text]) =>
      !isDemoMigration(file) &&
      new RegExp(
        `(?:insert\\s+into|update)\\s+(?:public\\.)?${table}\\b`,
        "i",
      ).test(text) &&
      /security\s+definer/i.test(text),
  );
  for (const [file, text] of writers) {
    for (const m of text.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi,
    )) {
      const fn = m[1].toLowerCase();
      const verdict = judgeSqlFunction(
        { ...citation, name: fn, kind: "sql-function" },
        code,
        sql,
      );
      if (
        verdict.ok &&
        new RegExp(
          `(?:insert\\s+into|update)\\s+(?:public\\.)?${table}\\b`,
          "i",
        ).test(text)
      ) {
        return {
          citation,
          ok: true,
          detail: `definer write path via ${fn}() in ${file}`,
        };
      }
    }
  }

  const seeded = [...sql.files]
    .filter(
      ([file, text]) =>
        isDemoMigration(file) &&
        new RegExp(`insert\\s+into\\s+(?:public\\.)?${table}\\b`, "i").test(
          text,
        ),
    )
    .map(([file]) => file);

  return {
    citation,
    ok: false,
    detail:
      `NO WRITE PATH — ${onTable.length} surviving polic(ies), all ${[
        ...new Set(onTable.flatMap((p) => p.statements.map(policyCommand))),
      ].join("/")}-only; ` +
      (seeded.length > 0
        ? `the only rows come from the demo seed ${seeded[0]}`
        : "and no reachable definer writer"),
  };
}

/* ──────────────────────────────── allowlist ─────────────────────────────── */

export interface Exemption {
  /** `<ID>:<citation>` — never a bare ID, never a bare symbol. */
  key: string;
  reason: string;
  /** ISO date the exemption was granted. Stale ones are meant to be noticed. */
  granted: string;
}

/**
 * Every entry carries a reason and a date. A bare exemption list is how a gate
 * becomes decoration: the list grows, nobody remembers why an entry is there,
 * and the gate ends up certifying precisely the rows that needed checking.
 * The test asserts the shape, so an entry cannot be added without both.
 */
export const EXEMPTIONS: Exemption[] = [];
