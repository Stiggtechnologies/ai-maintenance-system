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

/* ───────────────────── reading TypeScript as code, not text ─────────────── */

/**
 * Blanks comments — and optionally string literals — out of TypeScript.
 *
 * WHY. Both judges below used to ask `\bname\b` against the raw file text, so a
 * single line of prose was indistinguishable from a call site. Appending
 * `// TODO: wire up assessAlarms later` to any live component made the gate
 * report `called from 1 reachable module(s)`, and the archetypal dead
 * capability in this gate's own header — `decide_lifecycle_evaluation`, which
 * "appears only in a comment at LifecycleDecisionsPage.tsx:6" — would have
 * passed on the strength of that very comment. A gate defeated by a comment is
 * a gate that certifies whatever a contributor is willing to type.
 *
 * Quote scanning is deliberately line-bounded for `'` and `"`. A regex literal
 * such as `/['"]/` contains an unpaired quote; letting it open a string would
 * blank the rest of the file and turn live callers invisible, which fails the
 * gate CLOSED on real code — the failure mode that gets a gate deleted.
 */
export function stripTsSource(
  text: string,
  { blankStrings = false }: { blankStrings?: boolean } = {},
): string {
  const blank = (span: string) => span.replace(/[^\n]/g, " ");
  let out = "";
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "//") {
      const nl = text.indexOf("\n", i);
      const stop = nl === -1 ? text.length : nl;
      out += blank(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += blank(text.slice(i, stop));
      i = stop;
      continue;
    }
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const nl = text.indexOf("\n", i);
      // Templates may span lines; ordinary quotes may not.
      const limit = ch === "`" ? text.length : nl === -1 ? text.length : nl;
      let j = i + 1;
      let closed = false;
      while (j < limit) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === ch) {
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) {
        // Not a string at all (regex character class, apostrophe in JSX text).
        out += ch;
        i += 1;
        continue;
      }
      out += ch + (blankStrings ? blank(text.slice(i + 1, j)) : text.slice(i + 1, j)) + ch;
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** `import {x} from "y"` names a symbol without using it; so does a re-export. */
const IMPORT_CLAUSE =
  /(?:^|\n)[ \t]*(?:import|export)\b[^;\n]*?\bfrom\s*["'`][^"'`]*["'`][ \t]*;?/g;
const BARE_REEXPORT = /(?:^|\n)[ \t]*export\s*(?:type\s*)?\{[^}]*\}[ \t]*;?/g;

/**
 * The part of a module that could actually USE a symbol: no comments, no string
 * literals, and no import or re-export clause. A barrel that re-exports a
 * symbol is not a caller of it, and an unused import is not a use.
 */
export function usageSurface(text: string): string {
  return stripTsSource(text, { blankStrings: true })
    .replace(IMPORT_CLAUSE, "")
    .replace(BARE_REEXPORT, "");
}

/* ───────────────────────────── the SQL corpus ───────────────────────────── */

export interface SqlFunctionDef {
  name: string;
  file: string;
  /** Between the closing paren of the signature and the body opener. Carries
   *  `security definer`, `returns`, `language`, `set search_path`. */
  header: string;
  /** The dollar-quoted body, or "" for a function this parser could not split. */
  body: string;
}

export interface SqlCorpus {
  /** migration filename → comment-stripped text. */
  files: Map<string, string>;
  /** function name → migration files defining it. */
  functions: Map<string, string[]>;
  /** table name → migration files creating it. */
  tables: Map<string, string[]>;
  /**
   * Every function definition in the chain, WITH ITS BODY.
   *
   * The write-path judge used to ask "does this FILE contain both an insert and
   * the words security definer", then credit the first function declared in
   * that file that had a caller. In a migration that declares a getter and a
   * writer — the normal shape — it credited the getter. Six of the nine tables
   * it passed were passed by a function that does not write them, including one
   * (`mark_structural_provenance_withdrawn`) that writes a different table
   * entirely, and one where the only insert is a hardcoded single-tenant seed
   * sitting at file top level. Bodies make the question answerable.
   */
  definitions: SqlFunctionDef[];
  /** Tables the chain ever puts under row-level security. */
  rlsEnabled: Set<string>;
}

const FUNCTION_HEAD =
  /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;

/**
 * Splits a migration into function definitions and their dollar-quoted bodies.
 *
 * Deliberately simple: find each `create function` head, take the first
 * dollar-quote tag that opens before the NEXT head, and read to its matching
 * close. A function this fails to split gets `body: ""` and is then treated as
 * proving nothing, which fails closed.
 */
export function parseFunctionDefs(file: string, sql: string): SqlFunctionDef[] {
  const heads = [...sql.matchAll(FUNCTION_HEAD)];
  const defs: SqlFunctionDef[] = [];
  heads.forEach((head, n) => {
    const from = (head.index ?? 0) + head[0].length;
    const until = heads[n + 1]?.index ?? sql.length;
    const opener = /\$([A-Za-z_]*)\$/.exec(sql.slice(from, until));
    if (!opener) {
      defs.push({ name: head[1].toLowerCase(), file, header: sql.slice(from, until), body: "" });
      return;
    }
    const tag = opener[0];
    const bodyStart = from + (opener.index ?? 0) + tag.length;
    const close = sql.indexOf(tag, bodyStart);
    defs.push({
      name: head[1].toLowerCase(),
      file,
      header: sql.slice(from, from + (opener.index ?? 0)),
      body: close === -1 ? "" : sql.slice(bodyStart, close),
    });
  });
  return defs;
}

/** Does this SQL text write the named table? */
export const writesTable = (sql: string, table: string): boolean =>
  new RegExp(
    `(?:insert\\s+into|update|delete\\s+from|merge\\s+into)\\s+(?:public\\.)?${table}\\b`,
    "i",
  ).test(sql);

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

  const definitions: SqlFunctionDef[] = [];
  const rlsEnabled = new Set<string>();

  for (const file of migrationFiles(dir)) {
    const sql = stripComments(readFileSync(join(dir, file), "utf8"));
    files.set(file, sql);
    definitions.push(...parseFunctionDefs(file, sql));
    for (const m of sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security/gi,
    )) {
      rlsEnabled.add(m[1].toLowerCase());
    }
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
  return { files, functions, tables, definitions, rlsEnabled };
}

/** Every definition of a named function, latest in the chain last. */
export const definitionsOf = (sql: SqlCorpus, name: string): SqlFunctionDef[] =>
  sql.definitions.filter((d) => d.name === name);

/** The function whose body contains `offset`, or null when at file top level. */
export function enclosingFunction(
  sql: SqlCorpus,
  file: string,
  needle: RegExp,
): SqlFunctionDef | null {
  for (const def of sql.definitions) {
    if (def.file !== file || def.body === "") continue;
    if (needle.test(def.body)) return def;
  }
  return null;
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
 * snake_case tokens sitting in unmarked prose, e.g. "human attestation via
 * attest_ca_stage (migration ..._ca_effectiveness_loop)". The register's
 * dominant house style is to name a function WITHOUT backticks: 115 of the 169
 * ✅ rows contain no backtick at all, and the eight rows naming
 * `attest_ca_stage`, `evaluate_ca_effectiveness`, `screen_similar_assets`,
 * `generate_schedule_options`, `get_work_management_health`,
 * `enforce_segregation_of_duties`, `run_control_audit` and
 * `trg_snapshot_recommendation_version` were all ✅ and all unenforced for want
 * of two backticks.
 *
 * Worse, C3.12 is ✅ and its own evidence reads "the supersede branch is
 * unreachable — propose_taxonomy_revision has zero callers". The register
 * confessed and the gate passed it.
 *
 * So prose is mined too — but ONLY for tokens the migration chain actually
 * declares as a function. That is the same "extract only what resolves" rule
 * the backticked path uses, and it is what keeps this from guessing: a word
 * that is not a function in the schema is not promoted to a citation. It also
 * removes the cheapest evasion there was, which required deleting two
 * characters and looked like formatting in review.
 */
const PROSE_TOKEN = /(?<![`\w.-])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?![\w-])/g;

/**
 * Pulls the citable identifiers out of one row's evidence.
 *
 * Backticked spans are considered first; prose is then mined for snake_case
 * names the schema declares as functions. Prose that names a concept without
 * marking it as code ("cascaded through the dependency graph") is still not a
 * citation — inventing an identifier out of prose is exactly the false-positive
 * class that would sink this gate.
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

  // Unbackticked prose, functions only. Tables are deliberately NOT mined from
  // prose: table names are ordinary noun phrases in this domain ("work orders",
  // "asset populations") and the write-path judge is the expensive one to get
  // wrong. Function names are not English.
  const prose = row.evidence.replace(BACKTICKED, " ");
  for (const m of prose.matchAll(PROSE_TOKEN)) {
    const bare = m[1];
    if (seen.has(bare)) continue;
    seen.add(bare);
    if (!sql.functions.has(bare)) continue;
    enforceable.push({
      id: row.id,
      raw: bare,
      name: bare,
      kind: "sql-function",
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
  // `usageSurface` — not the raw text. A comment naming the symbol is not a
  // caller, and neither is an import that nothing goes on to use.
  const callers = [...code.files]
    .filter(
      ([path, text]) =>
        !isTestFile(path) && !definedIn.includes(path) && re.test(usageSurface(text)),
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
  const mentionedOnlyInProse = [...code.files]
    .filter(
      ([path, text]) =>
        !isTestFile(path) && !definedIn.includes(path) && re.test(text),
    )
    .map(([path]) => path);
  return {
    citation,
    ok: false,
    detail:
      `ZERO non-test callers (defined in ${definedIn.join(", ") || "?"}; ${testOnly} test file(s) reference it) — the capability exists only in its own test` +
      (mentionedOnlyInProse.length > 0
        ? `; named only in a comment or import in ${mentionedOnlyInProse.slice(0, 2).join(", ")}`
        : ""),
  };
}

/**
 * A cited SQL function needs a caller: an RPC from live code, or a trigger, or
 * another SQL function that is itself reachable.
 *
 * A client invokes a Postgres function by NAME IN A STRING —
 * `supabase.rpc("sign_engineering_review", …)`. So the TypeScript test is for a
 * quoted occurrence in code, not a bare word anywhere in the file. That is what
 * makes it immune to a comment: `sign_engineering_review` previously "passed"
 * on the strength of a sentence in `MissionControl.tsx` explaining that it used
 * to have no callers.
 *
 * The SQL-caller branch recurses, because a dead function calling another dead
 * function used to certify both.
 */
export function judgeSqlFunction(
  citation: Citation,
  code: CodeCorpus,
  sql: SqlCorpus,
  seen: Set<string> = new Set(),
): Verdict {
  const name = citation.name;
  const definedIn = sql.functions.get(name) ?? [];
  if (seen.has(name)) {
    return { citation, ok: false, detail: `recursive call cycle through ${name}()` };
  }
  seen.add(name);

  const quoted = new RegExp(`["'\`]${name}["'\`]`);
  const tsCallers = [...code.files]
    .filter(
      ([path, text]) =>
        !isTestFile(path) && quoted.test(stripTsSource(text)),
    )
    .map(([path]) => path);
  const liveTs = tsCallers.filter((p) => code.reachable.has(p));
  if (liveTs.length > 0) {
    return { citation, ok: true, detail: `invoked from ${liveTs[0]}` };
  }

  // A trigger attachment is a caller even with no client ever naming it.
  const trigger = [...sql.files].filter(([, text]) =>
    new RegExp(
      `execute\\s+(?:function|procedure)\\s+(?:public\\.)?${name}\\s*\\(`,
      "i",
    ).test(text),
  );
  if (trigger.length > 0) {
    return { citation, ok: true, detail: `attached to a trigger in ${trigger[0][0]}` };
  }

  // A pg_cron schedule is a caller too, and for the loop's own producers it is
  // the ONLY caller by design — `evaluate_ca_effectiveness` is deliberately
  // revoked from `authenticated` and driven at '15 * * * *'. Missing this would
  // fail the gate closed on working code, which is how a gate gets deleted.
  const scheduled = [...sql.files].filter(([, text]) =>
    new RegExp(
      `cron\\.schedule\\s*\\([^)]*?['"\`]\\s*select\\s+(?:public\\.)?${name}\\s*\\(`,
      "is",
    ).test(text),
  );
  if (scheduled.length > 0) {
    return { citation, ok: true, detail: `scheduled with pg_cron in ${scheduled[0][0]}` };
  }

  // Called from the BODY of another function that is itself reachable. Scoping
  // this to bodies (not whole files) is what stops a getter in the same
  // migration from vouching for a writer, and vice versa.
  const call = new RegExp(`\\b${name}\\s*\\(`, "i");
  for (const def of sql.definitions) {
    if (def.name === name || def.body === "" || isDemoMigration(def.file)) continue;
    if (!call.test(def.body)) continue;
    const upstream = judgeSqlFunction(
      { ...citation, name: def.name, kind: "sql-function" },
      code,
      sql,
      seen,
    );
    if (upstream.ok) {
      return {
        citation,
        ok: true,
        detail: `called from ${def.name}() in ${def.file}, which is ${upstream.detail}`,
      };
    }
  }

  const proseOnly = [...code.files].filter(
    ([path, text]) => !isTestFile(path) && new RegExp(`\\b${name}\\b`).test(text),
  ).length;
  return {
    citation,
    ok: false,
    detail:
      `ZERO callers — defined and granted in ${definedIn.join(", ")}, invoked by nothing` +
      (proseOnly > 0
        ? `; ${proseOnly} TypeScript file(s) name it in prose or a comment only`
        : ""),
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
 * SELECT-only policies plus a demo seed is the exact shape that produced the
 * false ✅s: the schema is real, the panel renders, and no user of the product
 * can create the record the row claims they create. `service_role` does not
 * count — the customer does not hold that key.
 *
 * Every acceptance below is FUNCTION-SCOPED or POLICY-SCOPED. The first version
 * asked whether a migration FILE contained an insert and the words
 * `security definer`, then credited the first function in that file with a
 * caller. Six of the nine tables it passed were vouched for by a getter, and
 * `asset_class_aliases` was certified as customer-writable on the strength of a
 * top-level `do $guard$` block hardcoded to one organisation UUID — the exact
 * "SELECT-only RLS plus a seed" shape this judge exists to catch, escaping only
 * because the seed lived inside a feature migration rather than a file with
 * "demo" in its name.
 */
export function judgeSqlTable(
  citation: Citation,
  code: CodeCorpus,
  sql: SqlCorpus,
  policies = resolveChainPolicies(),
): Verdict {
  const table = citation.name;
  const onTable = [...policies.values()].filter((p) => p.table === table);

  if (onTable.length === 0 && !sql.rlsEnabled.has(table)) {
    // RLS was never switched on, so the table's grants are the only gate and
    // the tenancy suite owns that question, not this gate.
    return {
      citation,
      ok: true,
      detail: "no row-level security on this table; write-path enforcement not applicable",
    };
  }

  const writable = onTable.filter((p) =>
    p.statements.some(
      (s) =>
        WRITE_COMMANDS.has(policyCommand(s)) && !/\bto\s+service_role\b/i.test(s),
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
    const source = stripTsSource(text);
    for (const m of source.matchAll(
      new RegExp(`from\\(\\s*["'\`]${table}["'\`]\\s*\\)`, "g"),
    )) {
      const window = source.slice(m.index, m.index + 240);
      if (/\.(insert|upsert|update|delete)\s*\(/.test(window)) {
        return { citation, ok: true, detail: `written directly from ${path}` };
      }
    }
  }

  // A SECURITY DEFINER function may write on the caller's behalf. It counts
  // only when ITS OWN BODY writes this table and something outside a demo seed
  // can invoke it.
  for (const def of sql.definitions) {
    if (isDemoMigration(def.file) || def.body === "") continue;
    if (!/security\s+definer/i.test(def.header)) continue;
    if (!writesTable(def.body, table)) continue;
    const verdict = judgeSqlFunction(
      { ...citation, name: def.name, kind: "sql-function" },
      code,
      sql,
    );
    if (verdict.ok) {
      return {
        citation,
        ok: true,
        detail: `definer write path via ${def.name}() in ${def.file} — ${verdict.detail}`,
      };
    }
  }

  // Nothing. Say precisely WHAT was found instead, so the failure is a work
  // item rather than a puzzle.
  const seeded = [...sql.files]
    .filter(
      ([file, text]) =>
        isDemoMigration(file) &&
        new RegExp(`insert\\s+into\\s+(?:public\\.)?${table}\\b`, "i").test(text),
    )
    .map(([file]) => file);
  const unreachableWriters = sql.definitions
    .filter((d) => d.body !== "" && writesTable(d.body, table))
    .map((d) => `${d.name}()`);
  const topLevelSeed = [...sql.files]
    .filter(
      ([file, text]) =>
        !isDemoMigration(file) &&
        writesTable(text, table) &&
        !sql.definitions.some(
          (d) => d.file === file && d.body !== "" && writesTable(d.body, table),
        ),
    )
    .map(([file]) => file);

  const because =
    onTable.length === 0
      ? "row-level security is on and no policy survives the chain"
      : `${onTable.length} surviving polic(ies), all ${[
          ...new Set(onTable.flatMap((p) => p.statements.map(policyCommand))),
        ].join("/")}-only`;

  return {
    citation,
    ok: false,
    detail:
      `NO WRITE PATH — ${because}; ` +
      (unreachableWriters.length > 0
        ? `the only writer(s) ${[...new Set(unreachableWriters)].slice(0, 3).join(", ")} are themselves unreachable`
        : topLevelSeed.length > 0
          ? `the only rows come from top-level seed statements in ${topLevelSeed[0]}`
          : seeded.length > 0
            ? `the only rows come from the demo seed ${seeded[0]}`
            : "and no reachable definer writer"),
  };
}

/**
 * A cited file must be REACHED, not merely exist.
 *
 * `existsSync` was the whole test, so a row citing a 900-line component that no
 * entry point imports would have passed — and twenty-one such components are
 * sitting in `src/` right now. A path outside the TypeScript corpus (a
 * migration, a build script) cannot be import-traced, so it must instead be
 * referenced by something that runs: package.json, a workflow, or live code.
 */
export function judgeFile(citation: Citation, code: CodeCorpus): Verdict {
  const bare = citation.name.replace(/\/$/, "");
  const candidates = [
    bare,
    `${bare}.ts`,
    `${bare}.tsx`,
    `${bare}/index.ts`,
    `${bare}/index.tsx`,
  ];
  const inCorpus = candidates.find((c) => code.files.has(c));
  if (inCorpus) {
    return {
      citation,
      ok: code.reachable.has(inCorpus),
      detail: code.reachable.has(inCorpus)
        ? `${inCorpus} is imported from an entry point`
        : `${inCorpus} exists but no entry point imports it — the file is dead`,
    };
  }
  if (!existsSync(bare)) {
    return { citation, ok: false, detail: "no such file in the repo" };
  }
  // Outside src/ and supabase/functions: prove something invokes it.
  const invokers = ["package.json", ".github/workflows", "supabase/config.toml"]
    .flatMap((root) =>
      existsSync(root)
        ? statSync(root).isDirectory()
          ? readdirSync(root).map((f) => join(root, f))
          : [root]
        : [],
    )
    .filter((f) => statSync(f).isFile() && readFileSync(f, "utf8").includes(bare));
  return {
    citation,
    ok: invokers.length > 0,
    detail:
      invokers.length > 0
        ? `outside the import graph but invoked by ${invokers[0]}`
        : "outside the import graph and invoked by no script, workflow or module",
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
