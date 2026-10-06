// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const diagnostics = await import(
  new URL("../../scripts/database-restore-diagnostics.mjs", import.meta.url)
    .href
);
const drill = await import(
  new URL("../../scripts/database-restore-drill.mjs", import.meta.url).href
);
const identity = "public.DO_NOT_DISCLOSE_FUNCTION()";
const entry = (definition: string) => ({
  kind: "function",
  key: identity,
  value: ["postgres", false, null, null, definition],
});
const before = [entry("DO_NOT_DISCLOSE_OLD_SQL")];
const after = [entry("DO_NOT_DISCLOSE_NEW_SQL")];
const capture = (definition = "DO_NOT_DISCLOSE_OLD_SQL") => ({
  schemaVersion: 1,
  oidJsonRepresentationQualified: true,
  environment: {
    search_path: "pg_catalog",
    quote_all_identifiers: "off",
    standard_conforming_strings: "on",
    DateStyle: "ISO, MDY",
    IntervalStyle: "postgres",
    TimeZone: "UTC",
    extra_float_digits: "3",
    client_encoding: "UTF8",
    server_version_num: "170006",
  },
  functions: [
    {
      identity,
      oid: "1234",
      tupleVersion: "5678",
      definition,
      catalog: {
        oid: "1234",
        prosrc: "DO_NOT_DISCLOSE_SOURCE",
        probin: null,
        proargdefaults: null,
        prosqlbody: null,
        proconfig: null,
        proowner: "10",
        provolatile: "s",
      },
    },
  ],
});
const baselineHints = {
  kind: "function",
  snapshotDiagnosticStatus: "AVAILABLE",
  bodyChanged: false,
  binaryChanged: false,
  argumentDefaultsChanged: false,
  sqlBodyTreeChanged: false,
  configurationChanged: false,
  catalogChanged: false,
  catalogTupleChanged: false,
  renderingEnvironmentChanged: false,
  freshDiagnosticStatus: "UNAVAILABLE",
};

describe("private restore source-function diagnostics", () => {
  it("qualifies the actual PostgreSQL JSON OID string without coercing catalog data", () => {
    const result = diagnostics.sourceFunctionDriftHints(
      before,
      after,
      capture(),
      capture("DO_NOT_DISCLOSE_NEW_SQL"),
    );
    expect(result).toEqual([baselineHints]);
    expect(() => drill.compareManifests(before, after)).toThrow("differs");
  });
  it.each([false, true])(
    "rethrows the same rollback comparison error even when summary formatting fails: %s",
    (formatterFails) => {
      const runner = readFileSync(
        new URL("../../scripts/database-restore-drill.mjs", import.meta.url),
        "utf8",
      );
      const start = runner.indexOf(
        "      try {\n        compareManifests(after, afterReference);",
      );
      expect(start).toBeGreaterThan(0);
      const end = runner.indexOf("      report.constraintsReparsed", start);
      expect(end).toBeGreaterThan(start);
      // Execute only the exact committed comparison/catch boundary in memory;
      // no Docker, SQL, artifact writer or provider call is reachable here.
      const boundary = new Function(
        "compareManifests",
        "inventoryMismatchSummary",
        "report",
        "after",
        "afterReference",
        runner.slice(start, end),
      );
      const report: Record<string, unknown> = {};
      const original = new Error("DO_NOT_DISCLOSE_ORIGINAL_FAILURE");
      const compare = vi.fn(() => {
        throw original;
      });
      const summarize = vi.fn(() => {
        if (formatterFails)
          throw new Error("DO_NOT_DISCLOSE_FORMATTER_FAILURE");
        return drill.inventoryMismatchSummary(before, after);
      });
      let thrown: unknown;
      try {
        boundary(compare, summarize, report, before, after);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(original);
      expect(compare).toHaveBeenCalledExactlyOnceWith(before, after);
      expect(summarize).toHaveBeenCalledTimes(1);
      if (!formatterFails)
        expect(report.inventoryMismatchContext).toBe("post_reference_rollback");
      expect(JSON.stringify(report)).not.toContain("DO_NOT_DISCLOSE");
      expect(report).not.toHaveProperty("referenceRollbackInventoryUnchanged");
    },
  );
  it.each([1234, null, "01234", "1235", "4294967296", "1234.0"])(
    "refuses unqualified or mismatched raw catalog OIDs: %s",
    (oid) => {
      const second = capture("DO_NOT_DISCLOSE_NEW_SQL");
      Object.assign(second.functions[0].catalog, { oid });
      expect(
        diagnostics.sourceFunctionDriftHints(before, after, capture(), second),
      ).toEqual([
        {
          kind: "function",
          snapshotDiagnosticStatus: "UNAVAILABLE",
          freshDiagnosticStatus: "UNAVAILABLE",
        },
      ]);
      expect(() => drill.compareManifests(before, after)).toThrow("differs");
    },
  );
  it("requires the fixed engine serializer witness, not an inferred catalog representation", () => {
    const second = capture("DO_NOT_DISCLOSE_NEW_SQL");
    second.oidJsonRepresentationQualified = false;
    expect(
      diagnostics.sourceFunctionDriftHints(before, after, capture(), second),
    ).toEqual([
      {
        kind: "function",
        snapshotDiagnosticStatus: "UNAVAILABLE",
        freshDiagnosticStatus: "UNAVAILABLE",
      },
    ]);
    const sql = readFileSync(
      new URL(
        "../../scripts/database-restore-function-diagnostics.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain("jsonb_typeof(to_jsonb(1234::oid))='string'");
    expect(sql).toContain("(to_jsonb(1234::oid)#>>'{}')='1234'");
  });
  it("retains exact rollback inventory comparison with fixed redacted mismatch evidence", () => {
    const runner = readFileSync(
      new URL("../../scripts/database-restore-drill.mjs", import.meta.url),
      "utf8",
    );
    expect(runner).toContain(`try {
        compareManifests(after, afterReference);
      } catch (error) {
        try {
          report.inventoryMismatchSummary = inventoryMismatchSummary(
            after,
            afterReference,
          );
          report.inventoryMismatchContext = "post_reference_rollback";
        } catch {
          /* Preserve the original qualification failure. */
        }
        throw error;
      }`);
    const summary = drill.inventoryMismatchSummary(before, after);
    expect(JSON.stringify(summary)).not.toContain("DO_NOT_DISCLOSE");
    expect(() => drill.compareManifests(before, after)).toThrow("differs");
  });
  it("reuses the canonical read-only rendering preamble for the fresh catalog read", () => {
    const inventory = readFileSync(
      new URL("../../scripts/database-restore-inventory.sql", import.meta.url),
      "utf8",
    );
    const setup = diagnostics.inventoryRenderingSessionSql(inventory);
    expect(setup).toBe(
      inventory.slice(0, inventory.indexOf("select jsonb_build_object")),
    );
    for (const setting of [
      "set timezone = 'UTC';",
      "set extra_float_digits = 3;",
      "set search_path = pg_catalog;",
      "set statement_timeout = '5min';",
    ])
      expect(setup).toContain(setting);
    const runner = readFileSync(
      new URL("../../scripts/database-restore-drill.mjs", import.meta.url),
      "utf8",
    );
    expect(runner).toContain(
      "${inventorySessionSql}\nset statement_timeout='30s';",
    );
  });
  it.each([
    "select 1;",
    "set timezone = 'UTC';\nselect 1;",
    "set timezone = 'UTC';\nset timezone = 'UTC';\nset extra_float_digits = 3;\nset search_path = pg_catalog;\nset statement_timeout = '5min';\nselect 1;",
    "set timezone = 'UTC';\nset extra_float_digits = 3;\nset search_path = pg_catalog;\nset statement_timeout = '5min';\ndelete from private;\nselect 1;",
  ])(
    "refuses missing, duplicate or non-setting diagnostic preambles",
    (source) => {
      expect(() => diagnostics.inventoryRenderingSessionSql(source)).toThrow(
        "Unqualified inventory rendering session",
      );
    },
  );
  it("uses only bounded read-only catalog SQL and the existing canonical routine identities", () => {
    const sql = readFileSync(
      new URL(
        "../../scripts/database-restore-function-diagnostics.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain("p.xmin::text");
    expect(sql).toContain("'catalog', to_jsonb(p)");
    expect(sql).toContain("'definition', pg_get_functiondef(p.oid)");
    expect(sql).toContain(
      "then 'graphql_public.graphql(text,text,jsonb,jsonb)'",
    );
    expect(sql).not.toMatch(
      /\b(?:insert|update|delete|create|alter|drop|truncate|grant|revoke|call)\s/i,
    );
  });
  it("reports fixed equality flags without substituting them for the exact FAIL", () => {
    const result = diagnostics.sourceFunctionDriftHints(
      before,
      after,
      capture(),
      capture("DO_NOT_DISCLOSE_NEW_SQL"),
    );
    expect(result).toEqual([baselineHints]);
    expect(() => drill.compareManifests(before, after)).toThrow("differs");
    expect(JSON.stringify(result)).not.toMatch(
      /DO_NOT_DISCLOSE|1234|5678|170006/,
    );
  });
  it.each([
    ["prosrc", "DO_NOT_DISCLOSE_CHANGED_BODY", "bodyChanged"],
    ["probin", "DO_NOT_DISCLOSE_LIBRARY", "binaryChanged"],
    ["proargdefaults", "DO_NOT_DISCLOSE_DEFAULT", "argumentDefaultsChanged"],
    ["prosqlbody", "DO_NOT_DISCLOSE_OID_TREE", "sqlBodyTreeChanged"],
    ["proconfig", ["DO_NOT_DISCLOSE_SETTING"], "configurationChanged"],
  ])("classifies actual private %s drift", (field, value, flag) => {
    const second = capture("DO_NOT_DISCLOSE_NEW_SQL");
    Object.assign(second.functions[0].catalog, { [field]: value });
    const result = diagnostics.sourceFunctionDriftHints(
      before,
      after,
      capture(),
      second,
    );
    expect(result).toEqual([
      { ...baselineHints, [flag]: true, catalogChanged: true },
    ]);
    expect(() => drill.compareManifests(before, after)).toThrow();
    expect(JSON.stringify(result)).not.toContain("DO_NOT_DISCLOSE");
  });
  it("classifies tuple and session changes without exposing their values", () => {
    const second = capture("DO_NOT_DISCLOSE_NEW_SQL");
    second.functions[0].tupleVersion = "9999";
    second.environment.search_path = "DO_NOT_DISCLOSE_SETTING";
    expect(
      diagnostics.sourceFunctionDriftHints(before, after, capture(), second),
    ).toEqual([
      {
        ...baselineHints,
        catalogTupleChanged: true,
        renderingEnvironmentChanged: true,
      },
    ]);
  });
  it("observes fresh raw catalog drift without calling it a harmless renderer change", () => {
    const fresh = capture("DO_NOT_DISCLOSE_NEW_SQL");
    fresh.functions[0].catalog.prosrc = "DO_NOT_DISCLOSE_CHANGED_BODY";
    fresh.functions[0].tupleVersion = "9999";
    const result = diagnostics.sourceFunctionDriftHints(
      before,
      after,
      capture(),
      capture("DO_NOT_DISCLOSE_NEW_SQL"),
      fresh,
    );
    expect(result).toEqual([
      {
        ...baselineHints,
        freshDiagnosticStatus: "AVAILABLE",
        freshCatalogChanged: true,
        freshCatalogTupleChanged: true,
        freshRenderingEnvironmentChanged: false,
        freshDefinitionEqualsSecondObservation: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /DO_NOT_DISCLOSE|PASS|harmless|cause/,
    );
  });
  it("does not claim rendered equality under a different fresh rendering environment", () => {
    const fresh = capture("DO_NOT_DISCLOSE_NEW_SQL");
    fresh.environment.standard_conforming_strings = "off";
    const result = diagnostics.sourceFunctionDriftHints(
      before,
      after,
      capture(),
      capture("DO_NOT_DISCLOSE_NEW_SQL"),
      fresh,
    );
    expect(result[0].freshRenderingEnvironmentChanged).toBe(true);
    expect(result[0]).not.toHaveProperty(
      "freshDefinitionEqualsSecondObservation",
    );
  });
  it.each([
    "missing",
    "schema",
    "duplicate",
    "uncorrelated",
    "invalid-catalog",
    "invalid-settings",
  ])("does not invent equality from %s private diagnostics", (mode) => {
    const second = capture("DO_NOT_DISCLOSE_NEW_SQL");
    if (mode === "schema") second.schemaVersion = 2;
    if (mode === "duplicate") second.functions.push({ ...second.functions[0] });
    if (mode === "uncorrelated")
      second.functions[0].definition = "DO_NOT_DISCLOSE_UNRELATED";
    if (mode === "invalid-catalog")
      Object.assign(second.functions[0].catalog, { prosrc: null });
    if (mode === "invalid-settings")
      Object.assign(second.environment, { search_path: null });
    expect(
      diagnostics.sourceFunctionDriftHints(
        before,
        after,
        capture(),
        mode === "missing" ? undefined : second,
      ),
    ).toEqual([
      {
        kind: "function",
        snapshotDiagnosticStatus: "UNAVAILABLE",
        freshDiagnosticStatus: "UNAVAILABLE",
      },
    ]);
  });
  it("ignores unknown output metadata and never publishes arbitrary fields", () => {
    const first = { ...capture(), credential: "DO_NOT_DISCLOSE_TOKEN" };
    const second = {
      ...capture("DO_NOT_DISCLOSE_NEW_SQL"),
      credential: "DO_NOT_DISCLOSE_NEW_TOKEN",
    };
    second.functions[0].catalog = {
      ...second.functions[0].catalog,
      unknown: "DO_NOT_DISCLOSE_EXTRA",
    } as ReturnType<typeof capture>["functions"][number]["catalog"];
    const result = diagnostics.sourceFunctionDriftHints(
      before,
      after,
      first,
      second,
    );
    expect(result[0].catalogChanged).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /DO_NOT_DISCLOSE|credential|unknown/,
    );
  });
  it("never fetches fresh catalog data for an unchanged function", async () => {
    const readFresh = vi.fn();
    expect(
      await diagnostics.diagnoseSourceFunctionDrift(
        before,
        before,
        capture(),
        capture(),
        readFresh,
      ),
    ).toEqual([]);
    expect(readFresh).not.toHaveBeenCalled();
  });
  it("bounds a mismatch to one fresh read and suppresses raw diagnostic failure", async () => {
    const readFresh = vi.fn(async () => {
      throw new Error("DO_NOT_DISCLOSE_PROVIDER_ERROR");
    });
    const result = await diagnostics.diagnoseSourceFunctionDrift(
      before,
      after,
      capture(),
      capture("DO_NOT_DISCLOSE_NEW_SQL"),
      readFresh,
    );
    expect(readFresh).toHaveBeenCalledTimes(1);
    expect(result).toEqual([baselineHints]);
    expect(() => drill.compareManifests(before, after)).toThrow("differs");
    expect(JSON.stringify(result)).not.toContain("DO_NOT_DISCLOSE");
  });
  it("separates only the fixed terminal diagnostic envelope from canonical inventory", () => {
    const privateCapture = capture();
    const source = [...before, { privateFunctionDiagnostics: privateCapture }]
      .map((row) => JSON.stringify(row))
      .join("\n");
    expect(diagnostics.parseSourceInventoryCapture(source)).toEqual({
      inventory: before,
      diagnostics: privateCapture,
    });
  });
  it.each(["missing", "nonterminal", "extra-envelope-fields", "invalid-json"])(
    "fails closed on an unqualified capture envelope: %s",
    (mode) => {
      const envelope = { privateFunctionDiagnostics: capture() };
      let rows: unknown[] = mode === "missing" ? before : [...before, envelope];
      if (mode === "nonterminal") rows = [envelope, ...before];
      if (mode === "extra-envelope-fields")
        rows = [...before, { ...envelope, leaked: "DO_NOT_DISCLOSE" }];
      const source =
        mode === "invalid-json"
          ? "DO_NOT_DISCLOSE_INVALID_JSON"
          : rows.map((row) => JSON.stringify(row)).join("\n");
      expect(() => diagnostics.parseSourceInventoryCapture(source)).toThrow(
        "Unqualified source diagnostic envelope",
      );
    },
  );
  it("keeps all new catalog artifacts private, exclusive and filename-qualified", () => {
    const output = drill.createPrivateOutput();
    for (const name of [
      "source-function-diagnostics.json",
      "source-after-backup-function-diagnostics.json",
      "source-current-function-diagnostics.json",
    ]) {
      drill.writePrivateArtifact(output, name, "DO_NOT_DISCLOSE_SOURCE");
      expect(statSync(join(output, name)).mode & 0o777).toBe(0o600);
      expect(() =>
        drill.writePrivateArtifact(output, name, "overwrite"),
      ).toThrow();
    }
  });
  it("captures diagnostics in the same backend but never relaxes the source comparison", () => {
    const source = readFileSync(
      new URL("../../scripts/database-restore-drill.mjs", import.meta.url),
      "utf8",
    );
    expect(source).toContain("${inventorySql}\n${functionDiagnosticsSql}");
    expect(source).toContain("compareManifests(before, afterBackup)");
    expect(source).toContain("await diagnoseSourceFunctionDrift(");
    expect(source).toContain("throw error;");
    const workflow = readFileSync(
      new URL(
        "../../.github/workflows/database-restore-drill.yml",
        import.meta.url,
      ),
      "utf8",
    );
    expect(workflow).toContain("path: drill-summary.json");
    expect(workflow).not.toMatch(
      /path:\s*(?:.*function-diagnostics|.*inventory|\*)/,
    );
  });
});
