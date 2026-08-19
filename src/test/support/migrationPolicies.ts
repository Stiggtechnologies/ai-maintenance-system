/**
 * Resolves the EFFECTIVE final RLS state of the migration chain from its text.
 *
 * WHY THIS EXISTS. Tenancy in this schema is not decided by any single file.
 * `system_alerts` alone is policed by migration 2, then 5, then 20260917000000;
 * `production_lines` by 3, then 5, then 20260917000000. Asserting on one
 * migration proves nothing about what a signed-in user can actually read, and
 * the defect this guards against — a policy that admits `organization_id is
 * null` — was created by a `format()` loop, so a grep for `create policy` never
 * saw it either.
 *
 * So this replays every create/drop in filename order and reports what is left
 * standing, which is the only thing that matters. It understands the four
 * shapes the chain actually uses:
 *
 *   1. literal `create policy` / `drop policy if exists`
 *   2. `foreach t in array array[…] loop execute format('… %I …', t || '_x', t)`
 *   3. the same with the array bound to a declared variable
 *   4. `execute format('… %s …', some_var)` where some_var is assigned a string
 *      literal in one or more branches — every branch is kept as a candidate,
 *      so a property asserted here must hold whichever branch runs. That is
 *      deliberately stronger than picking the branch we believe fires.
 *
 * Anything else that creates a policy raises. A parser that silently skipped a
 * construct would report "no leaks" for a chain full of them, so not
 * understanding a statement has to be a test failure, never a shrug.
 *
 * Validated against ground truth: run against a throwaway Postgres carrying the
 * full chain, the resolved set matches `pg_policies` table-for-table and
 * policy-for-policy.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const MIGRATIONS_DIR = "supabase/migrations";

export interface ResolvedPolicy {
  table: string;
  policy: string;
  /** Every candidate DDL text for this policy (>1 only for branch-valued %s). */
  statements: string[];
  /** Migration file that created the surviving version. */
  source: string;
}

/** Strips `--` comments without touching quoted or dollar-quoted text. */
export function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Splits into statements on `;` that sit outside quotes and dollar-quotes. */
function splitStatements(sql: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === ";") {
      parts.push(buf);
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf.trim()) parts.push(buf);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const unqualify = (name: string) =>
  name
    .replace(/^public\./i, "")
    .replace(/"/g, "")
    .toLowerCase();

/** Splits an argument list on top-level commas. */
function splitArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let buf = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end === -1 ? text.length : end + 1;
      buf += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      args.push(buf.trim());
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf.trim()) args.push(buf.trim());
  return args;
}

/** Concatenates adjacent SQL string literals: `'a' 'b'` and `'a' || 'b'`. */
function literalValue(expr: string): string | null {
  const pieces = [...expr.matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
    m[1].replace(/''/g, "'"),
  );
  if (pieces.length === 0) return null;
  const withoutLiterals = expr.replace(/'((?:[^']|'')*)'/g, "").trim();
  // Only `||` and whitespace may join them; anything else is a real expression.
  if (withoutLiterals.replace(/\|\|/g, "").trim() !== "") return null;
  return pieces.join("");
}

/**
 * Evaluates one `format()` argument to its possible string values, given the
 * loop variable binding and any plpgsql string variables in scope.
 */
function evalArg(
  expr: string,
  loopVar: string | null,
  loopValue: string | null,
  vars: Map<string, string[]>,
): string[] {
  const trimmed = expr.trim();
  if (loopVar && trimmed === loopVar) return [loopValue as string];
  if (loopVar) {
    const concat = new RegExp(`^${loopVar}\\s*\\|\\|\\s*'([^']*)'$`).exec(
      trimmed,
    );
    if (concat) return [(loopValue as string) + concat[1]];
    const rconcat = new RegExp(`^'([^']*)'\\s*\\|\\|\\s*${loopVar}$`).exec(
      trimmed,
    );
    if (rconcat) return [rconcat[1] + (loopValue as string)];
  }
  const lit = literalValue(trimmed);
  if (lit !== null) return [lit];
  if (vars.has(trimmed)) return vars.get(trimmed) as string[];
  throw new Error(`cannot evaluate format() argument: ${expr}`);
}

/** Substitutes %I / %s placeholders left-to-right. */
function applyFormat(template: string, args: string[]): string {
  let n = 0;
  return template.replace(/%[IsL]/g, () => {
    const value = args[n];
    n += 1;
    if (value === undefined) throw new Error(`format() missing arg ${n}`);
    return value;
  });
}

/** Cartesian product of candidate values per argument. */
function combine(candidates: string[][]): string[][] {
  return candidates.reduce<string[][]>(
    (acc, options) =>
      acc.flatMap((prefix) => options.map((o) => [...prefix, o])),
    [[]],
  );
}

type Action =
  | { kind: "create"; table: string; policy: string; text: string }
  | { kind: "drop"; table: string; policy: string };

/** Reads every `execute` inside a do-block and turns it into create/drop actions. */
function actionsFromDoBlock(block: string): Action[] {
  const actions: Action[] = [];

  // Declared arrays: `name text[] := array[ 'a','b' ];`
  const arrays = new Map<string, string[]>();
  for (const m of block.matchAll(
    /(\w+)\s+text\[\]\s*:=\s*array\s*\[([\s\S]*?)\]/gi,
  )) {
    arrays.set(
      m[1],
      [...m[2].matchAll(/'([^']*)'/g)].map((q) => q[1]),
    );
  }

  // String variables, all branches kept: `name := 'literal';`
  const vars = new Map<string, string[]>();
  for (const m of block.matchAll(/(\w+)\s*:=\s*('(?:[^']|'')*')\s*;/g)) {
    const value = literalValue(m[2]);
    if (value === null) continue;
    const existing = vars.get(m[1]) ?? [];
    if (!existing.includes(value)) existing.push(value);
    vars.set(m[1], existing);
  }

  /** Reads `execute [format](...)` statements out of a chunk of plpgsql. */
  const readExecutes = (
    chunk: string,
    loopVar: string | null,
    loopValue: string | null,
  ) => {
    for (const m of chunk.matchAll(/\bexecute\s+/gi)) {
      const rest = chunk.slice(m.index + m[0].length);
      let sql: string[];
      const fmt = /^format\s*\(/i.exec(rest);
      if (fmt) {
        // Balance the parens of format(...).
        let depth = 0;
        let i = rest.indexOf("(");
        const open = i;
        for (; i < rest.length; i += 1) {
          if (rest[i] === "'") {
            const end = rest.indexOf("'", i + 1);
            i = end === -1 ? rest.length : end;
            continue;
          }
          if (rest[i] === "(") depth += 1;
          else if (rest[i] === ")") {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        const args = splitArgs(rest.slice(open + 1, i));
        const template = literalValue(args[0]);
        if (template === null) continue;
        const evaluated = args
          .slice(1)
          .map((a) => evalArg(a, loopVar, loopValue, vars));
        sql = combine(evaluated).map((combo) => applyFormat(template, combo));
      } else {
        // Up to, but NOT including, the terminating semicolon — literalValue
        // rejects anything outside the quotes, and a trailing `;` counts.
        const semi = rest.indexOf(";");
        const lit = literalValue(semi === -1 ? rest : rest.slice(0, semi));
        if (lit === null) continue;
        sql = [lit];
      }
      for (const statement of sql) {
        const drop =
          /^\s*drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|\w+)\s+on\s+([\w".]+)/i.exec(
            statement,
          );
        if (drop) {
          actions.push({
            kind: "drop",
            table: unqualify(drop[2]),
            policy: unqualify(drop[1]),
          });
          continue;
        }
        const create =
          /^\s*create\s+policy\s+("[^"]+"|\w+)\s+on\s+([\w".]+)/i.exec(
            statement,
          );
        if (create) {
          actions.push({
            kind: "create",
            table: unqualify(create[2]),
            policy: unqualify(create[1]),
            text: statement,
          });
        }
      }
    }
  };

  // Loop bodies first, then the block with loops removed.
  let remainder = block;
  for (const loop of block.matchAll(
    /foreach\s+(\w+)\s+in\s+array\s+(array\s*\[[\s\S]*?\]|\w+)\s+loop([\s\S]*?)end\s+loop/gi,
  )) {
    const [whole, loopVar, source, body] = loop;
    const values = source.trim().toLowerCase().startsWith("array")
      ? [...source.matchAll(/'([^']*)'/g)].map((q) => q[1])
      : (arrays.get(source.trim()) ?? []);
    if (values.length === 0) {
      // Only a problem if the body actually policies something; the chain also
      // loops over numeric arrays for unrelated backfills.
      if (/\b(create|drop)\s+policy/i.test(body)) {
        throw new Error(
          `foreach over an array this parser cannot read: ${source}`,
        );
      }
      remainder = remainder.replace(whole, "");
      continue;
    }
    for (const value of values) readExecutes(body, loopVar, value);
    remainder = remainder.replace(whole, "");
  }
  readExecutes(remainder, null, null);

  // Nothing may create a policy without being seen.
  const seenCreates = actions.filter((a) => a.kind === "create").length;
  const textCreates = (block.match(/create\s+policy/gi) ?? []).length;
  if (textCreates > 0 && seenCreates === 0) {
    throw new Error("do-block creates a policy this parser did not resolve");
  }
  return actions;
}

export function migrationFiles(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Replays the chain and returns the policies left standing. */
export function resolveChainPolicies(
  dir = MIGRATIONS_DIR,
): Map<string, ResolvedPolicy> {
  const live = new Map<string, ResolvedPolicy>();

  for (const file of migrationFiles(dir)) {
    const sql = stripComments(readFileSync(join(dir, file), "utf8"));
    for (const statement of splitStatements(sql)) {
      const isDoBlock = /^do\s*\$/i.test(statement);
      if (isDoBlock) {
        for (const action of actionsFromDoBlock(statement)) {
          const key = `${action.table}.${action.policy}`;
          if (action.kind === "drop") live.delete(key);
          else {
            const prior = live.get(key);
            live.set(key, {
              table: action.table,
              policy: action.policy,
              statements:
                prior && prior.source === file
                  ? [...prior.statements, action.text]
                  : [action.text],
              source: file,
            });
          }
        }
        continue;
      }

      const drop =
        /^drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|\w+)\s+on\s+([\w".]+)/i.exec(
          statement,
        );
      if (drop) {
        live.delete(`${unqualify(drop[2])}.${unqualify(drop[1])}`);
        continue;
      }

      const create = /^create\s+policy\s+("[^"]+"|\w+)\s+on\s+([\w".]+)/i.exec(
        statement,
      );
      if (create) {
        const table = unqualify(create[2]);
        const policy = unqualify(create[1]);
        live.set(`${table}.${policy}`, {
          table,
          policy,
          statements: [statement],
          source: file,
        });
        continue;
      }

      if (/create\s+policy/i.test(statement)) {
        throw new Error(
          `${file}: statement creates a policy but was not parsed:\n${statement.slice(0, 200)}`,
        );
      }
    }
  }
  return live;
}

/** The `with check ( … )` predicate of a create-policy statement, or null. */
export function withCheckOf(statement: string): string | null {
  const at = statement.toLowerCase().indexOf("with check");
  if (at === -1) return null;
  const open = statement.indexOf("(", at);
  if (open === -1) return null;
  let depth = 0;
  let i = open;
  for (; i < statement.length; i += 1) {
    if (statement[i] === "(") depth += 1;
    else if (statement[i] === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return statement.slice(open + 1, i).trim();
}

/** The `using ( … )` predicate of a create-policy statement, or null. */
export function usingOf(statement: string): string | null {
  const lower = statement.toLowerCase();
  // `using` that is not the tail of `with check ... using`, i.e. the first one.
  const at = lower.search(/\busing\s*\(/);
  if (at === -1) return null;
  const open = statement.indexOf("(", at);
  let depth = 0;
  let i = open;
  for (; i < statement.length; i += 1) {
    if (statement[i] === "(") depth += 1;
    else if (statement[i] === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return statement.slice(open + 1, i).trim();
}

/** True when the policy is granted `to authenticated`. */
export function grantsAuthenticated(statement: string): boolean {
  return /\bto\s+[^()]*?\bauthenticated\b/i.test(statement);
}
