import { isDeepStrictEqual as same } from "node:util";

// Reuse, rather than copy, the canonical inventory's rendering SETs. No
// arbitrary statement or incomplete/duplicate setting preamble is executable.
export function inventoryRenderingSessionSql(source) {
  const fail = () => new Error("Unqualified inventory rendering session");
  if (typeof source !== "string" || Buffer.byteLength(source) > 1024 * 1024)
    throw fail();
  const boundary = source.search(/^select\b/im);
  if (boundary < 0) throw fail();
  const prefix = source.slice(0, boundary);
  const lines = prefix
    .replace(/^--[^\r\n]*(?:\r?\n|$)/gm, "")
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const required = new Set([
    "timezone",
    "extra_float_digits",
    "search_path",
    "statement_timeout",
  ]);
  if (lines.length !== required.size) throw fail();
  for (const line of lines) {
    const match =
      /^\s*set\s+(timezone|extra_float_digits|search_path|statement_timeout)\s*=\s*(?:'[A-Za-z0-9_./ -]+'|[A-Za-z0-9_]+);\s*$/i.exec(
        line,
      );
    if (!match || !required.delete(match[1].toLowerCase())) throw fail();
  }
  if (required.size) throw fail();
  return prefix;
}

// These private observations never qualify a restore or alter its comparison.
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const settings = [
  "search_path",
  "quote_all_identifiers",
  "standard_conforming_strings",
  "DateStyle",
  "IntervalStyle",
  "TimeZone",
  "extra_float_digits",
  "client_encoding",
  "server_version_num",
];
const nullableText = (value) => value === null || typeof value === "string";
const definition = (entry) =>
  entry.kind === "function" ? entry.value?.[4] : entry.value?.definition;
const changedFunctions = (source, target) =>
  source.filter((entry) => {
    if (!["function", "platform_function"].includes(entry.kind)) return false;
    const matches = target.filter(
      (other) => other.kind === entry.kind && other.key === entry.key,
    );
    return (
      matches.length === 1 && !same(definition(entry), definition(matches[0]))
    );
  });

function qualifiedCapture(capture) {
  if (
    !record(capture) ||
    capture.schemaVersion !== 1 ||
    !record(capture.environment) ||
    !settings.every((key) => typeof capture.environment[key] === "string") ||
    !Array.isArray(capture.functions) ||
    capture.functions.length > 10000
  )
    return false;
  const seen = new Set();
  for (const routine of capture.functions) {
    if (
      !record(routine) ||
      typeof routine.identity !== "string" ||
      seen.has(routine.identity) ||
      !/^[1-9][0-9]{0,9}$/.test(routine.oid ?? "") ||
      Number(routine.oid) > 4294967295 ||
      !/^(0|[1-9][0-9]{0,9})$/.test(routine.tupleVersion ?? "") ||
      Number(routine.tupleVersion) > 4294967295 ||
      typeof routine.definition !== "string" ||
      !record(routine.catalog) ||
      routine.catalog.oid !== Number(routine.oid) ||
      typeof routine.catalog.prosrc !== "string" ||
      !["probin", "proargdefaults", "prosqlbody"].every((key) =>
        nullableText(routine.catalog[key]),
      ) ||
      !(
        routine.catalog.proconfig === null ||
        (Array.isArray(routine.catalog.proconfig) &&
          routine.catalog.proconfig.every((value) => typeof value === "string"))
      )
    )
      return false;
    seen.add(routine.identity);
  }
  return true;
}

function correlated(capture, entry) {
  if (!qualifiedCapture(capture)) return undefined;
  const routine = capture.functions.find((item) => item.identity === entry.key);
  return routine && routine.definition === definition(entry)
    ? routine
    : undefined;
}

export function sourceFunctionDriftHints(
  source,
  target,
  beforeCapture,
  afterCapture,
  freshCapture,
) {
  return changedFunctions(source, target).map((entry) => {
    const other = target.find(
      (item) => item.kind === entry.kind && item.key === entry.key,
    );
    const before = correlated(beforeCapture, entry),
      after = correlated(afterCapture, other);
    const hint = {
      kind: entry.kind,
      snapshotDiagnosticStatus: "UNAVAILABLE",
      freshDiagnosticStatus: "UNAVAILABLE",
    };
    if (!before || !after) return hint;
    Object.assign(hint, {
      snapshotDiagnosticStatus: "AVAILABLE",
      bodyChanged: !same(before.catalog.prosrc, after.catalog.prosrc),
      binaryChanged: !same(before.catalog.probin, after.catalog.probin),
      argumentDefaultsChanged: !same(
        before.catalog.proargdefaults,
        after.catalog.proargdefaults,
      ),
      sqlBodyTreeChanged: !same(
        before.catalog.prosqlbody,
        after.catalog.prosqlbody,
      ),
      configurationChanged: !same(
        before.catalog.proconfig,
        after.catalog.proconfig,
      ),
      catalogChanged: !same(before.catalog, after.catalog),
      catalogTupleChanged:
        before.oid !== after.oid || before.tupleVersion !== after.tupleVersion,
      renderingEnvironmentChanged: !same(
        beforeCapture.environment,
        afterCapture.environment,
      ),
    });
    if (qualifiedCapture(freshCapture)) {
      const fresh = freshCapture.functions.find(
        (item) => item.identity === entry.key,
      );
      if (!fresh) hint.freshDiagnosticStatus = "MISSING";
      else {
        const environmentChanged = !same(
          afterCapture.environment,
          freshCapture.environment,
        );
        Object.assign(hint, {
          freshDiagnosticStatus: "AVAILABLE",
          freshCatalogChanged: !same(before.catalog, fresh.catalog),
          freshCatalogTupleChanged:
            before.oid !== fresh.oid ||
            before.tupleVersion !== fresh.tupleVersion,
          freshRenderingEnvironmentChanged: environmentChanged,
          ...(!environmentChanged
            ? {
                freshDefinitionEqualsSecondObservation:
                  fresh.definition === definition(other),
              }
            : {}),
        });
      }
    }
    return hint;
  });
}

export async function diagnoseSourceFunctionDrift(
  source,
  target,
  beforeCapture,
  afterCapture,
  readFresh,
) {
  if (!changedFunctions(source, target).length) return [];
  let fresh;
  try {
    fresh = await readFresh();
  } catch {
    /* Never swallow the original failed comparison. */
  }
  return sourceFunctionDriftHints(
    source,
    target,
    beforeCapture,
    afterCapture,
    fresh,
  );
}

export function parseSourceInventoryCapture(text) {
  try {
    if (typeof text !== "string" || Buffer.byteLength(text) > 32 * 1024 * 1024)
      throw new Error();
    const rows = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const envelope = rows.pop();
    if (
      !record(envelope) ||
      Object.keys(envelope).length !== 1 ||
      !Object.hasOwn(envelope, "privateFunctionDiagnostics") ||
      !record(envelope.privateFunctionDiagnostics) ||
      envelope.privateFunctionDiagnostics.schemaVersion !== 1 ||
      !rows.length ||
      rows.some(
        (row) =>
          !record(row) ||
          typeof row.kind !== "string" ||
          typeof row.key !== "string" ||
          !Object.hasOwn(row, "value"),
      )
    )
      throw new Error();
    return {
      inventory: rows,
      diagnostics: envelope.privateFunctionDiagnostics,
    };
  } catch {
    throw new Error("Unqualified source diagnostic envelope");
  }
}
