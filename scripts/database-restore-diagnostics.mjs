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

function captureQualification(capture) {
  // Every reason is a fixed label, never a field value, identity or array index.
  // These are the original strict predicates, not per-routine acceptance.
  const refused = (captureReason) => ({
    captureStatus: "REFUSED",
    captureReason,
  });
  if (capture === undefined)
    return { captureStatus: "MISSING", captureReason: "missing_capture" };
  if (!record(capture)) return refused("capture_shape");
  if (capture.schemaVersion !== 1) return refused("schema_version");
  if (capture.oidJsonRepresentationQualified !== true)
    return refused("oid_representation");
  if (!record(capture.environment)) return refused("environment_shape");
  if (!settings.every((key) => typeof capture.environment[key] === "string"))
    return refused("environment_field");
  if (!Array.isArray(capture.functions)) return refused("functions_shape");
  if (capture.functions.length > 10000) return refused("function_limit");
  const seen = new Set();
  for (const routine of capture.functions) {
    if (!record(routine)) return refused("routine_shape");
    if (typeof routine.identity !== "string") return refused("identity_shape");
    if (seen.has(routine.identity)) return refused("duplicate_identity");
    if (
      typeof routine.oid !== "string" ||
      !/^[1-9][0-9]{0,9}$/.test(routine.oid ?? "") ||
      Number(routine.oid) > 4294967295
    )
      return refused("oid");
    if (
      typeof routine.tupleVersion !== "string" ||
      !/^(0|[1-9][0-9]{0,9})$/.test(routine.tupleVersion ?? "") ||
      Number(routine.tupleVersion) > 4294967295
    )
      return refused("tuple_version");
    if (typeof routine.definition !== "string") return refused("definition");
    if (!record(routine.catalog)) return refused("catalog_shape");
    if (routine.catalog.oid !== routine.oid) return refused("catalog_oid");
    if (typeof routine.catalog.prosrc !== "string") return refused("body");
    if (!nullableText(routine.catalog.probin)) return refused("binary");
    if (!nullableText(routine.catalog.proargdefaults))
      return refused("argument_defaults");
    if (!nullableText(routine.catalog.prosqlbody)) return refused("sql_body");
    if (!(
      routine.catalog.proconfig === null ||
      (Array.isArray(routine.catalog.proconfig) &&
        routine.catalog.proconfig.every((value) => typeof value === "string"))
    ))
      return refused("configuration");
    seen.add(routine.identity);
  }
  return { captureStatus: "QUALIFIED", captureReason: "none" };
}

function correlated(capture, entry, qualification) {
  if (qualification.captureStatus !== "QUALIFIED")
    return { correlationStatus: "UNAVAILABLE" };
  const routine = capture.functions.find((item) => item.identity === entry.key);
  if (!routine) return { correlationStatus: "IDENTITY_MISSING" };
  if (routine.definition !== definition(entry))
    return { correlationStatus: "DEFINITION_MISMATCH" };
  return { correlationStatus: "MATCHED", routine };
}

export function sourceFunctionDriftHints(
  source,
  target,
  beforeCapture,
  afterCapture,
  freshCapture,
  freshReadStatus = "NOT_RECORDED",
) {
  const changed = changedFunctions(source, target);
  if (!changed.length) return [];
  const beforeQualification = captureQualification(beforeCapture);
  const afterQualification = captureQualification(afterCapture);
  const freshQualification = captureQualification(freshCapture);
  return changed.map((entry) => {
    const other = target.find(
      (item) => item.kind === entry.kind && item.key === entry.key,
    );
    const beforeObservation = correlated(
        beforeCapture,
        entry,
        beforeQualification,
      ),
      afterObservation = correlated(afterCapture, other, afterQualification);
    const before = beforeObservation.routine,
      after = afterObservation.routine;
    // A successful fresh read can be reported even when either snapshot fails
    // correlation. It must not enable catalog/equality comparisons in that case.
    const fresh =
      freshQualification.captureStatus === "QUALIFIED"
        ? freshCapture.functions.find((item) => item.identity === entry.key)
        : undefined;
    const hint = {
      kind: entry.kind,
      snapshotDiagnosticStatus: "UNAVAILABLE",
      freshDiagnosticStatus: "UNAVAILABLE",
      snapshotQualification: {
        before: {
          ...beforeQualification,
          correlationStatus: beforeObservation.correlationStatus,
        },
        after: {
          ...afterQualification,
          correlationStatus: afterObservation.correlationStatus,
        },
      },
      freshQualification: {
        readStatus: ["SUCCEEDED", "FAILED"].includes(freshReadStatus)
          ? freshReadStatus
          : "NOT_RECORDED",
        ...freshQualification,
        identityStatus:
          freshQualification.captureStatus !== "QUALIFIED"
            ? "UNAVAILABLE"
            : fresh
              ? "FOUND"
              : "MISSING",
      },
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
    if (freshQualification.captureStatus === "QUALIFIED") {
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
  let freshReadStatus = "FAILED";
  try {
    fresh = await readFresh();
    freshReadStatus = "SUCCEEDED";
  } catch {
    /* Never swallow the original failed comparison. */
  }
  return sourceFunctionDriftHints(
    source,
    target,
    beforeCapture,
    afterCapture,
    fresh,
    freshReadStatus,
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
