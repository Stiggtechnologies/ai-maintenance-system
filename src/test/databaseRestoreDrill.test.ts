// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const drill = await import(
  new URL("../../scripts/database-restore-drill.mjs", import.meta.url).href
);

const local = {
  Id: "a".repeat(64),
  Name: "/supabase_db_ai-maintenance-system",
  Image: `sha256:${"b".repeat(64)}`,
  State: { Running: true },
  Config: { Labels: { "com.supabase.cli.project": "ai-maintenance-system" } },
};

describe("database restore-drill boundaries", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("inventories live column order rather than physical tombstone slots, retaining all column controls", () => {
    const inventory = readFileSync(
      new URL("../../scripts/database-restore-inventory.sql", import.meta.url),
      "utf8",
    );
    expect(inventory).toContain(
      "row_number() over (partition by a.attrelid order by a.attnum)",
    );
    expect(inventory).toContain("a.attnum>0 and not a.attisdropped");
    expect(inventory).not.toContain("jsonb_build_array(a.attnum,");
    expect(inventory).toContain("a.attidentity,a.attgenerated");
    expect(inventory).toContain("unnest(a.attacl)");
    expect(inventory).toContain("pg_get_expr(d.adbin,d.adrelid)");
  });
  it("partitions every archive entry exactly once, without excluding any ACL or database property", () => {
    const toc = `; private header\n1; 1262 7 DATABASE - postgres private_owner\n2; 0 0 DATABASE PROPERTIES - postgres private_owner\n3; 2615 8 SCHEMA - graphql_public private_owner\n4; 3079 9 EXTENSION - pg_graphql private_owner\n5; 0 0 ACL graphql_public FUNCTION graphql(text, text, jsonb, jsonb) private_owner\n6; 0 0 TABLE DATA public evidence private_owner\n`;
    const split = drill.partitionRestoreToc(toc);
    expect(split.counts).toEqual({ total: 6, bootstrap: 4, remaining: 2 });
    expect(split.bootstrap).toContain("1; 1262 7 DATABASE");
    expect(split.bootstrap).toContain("DATABASE PROPERTIES");
    expect(split.remaining).not.toContain("DATABASE PROPERTIES");
    expect(split.remaining).toContain("ACL graphql_public FUNCTION graphql");
    expect(split.remaining).toContain("TABLE DATA public evidence");
  });
  it("restores database ACL, comments and security labels in the only create-enabled pass", () => {
    const toc = `1; 1262 7 DATABASE - postgres owner\n2; 0 0 ACL - DATABASE postgres owner\n3; 0 0 COMMENT - DATABASE postgres owner\n4; 0 0 SECURITY LABEL - DATABASE postgres owner\n5; 0 0 COMMENT - EXTENSION pg_graphql owner\n6; 0 0 ACL public TABLE evidence owner\n`;
    const split = drill.partitionRestoreToc(toc);
    expect(split.counts).toEqual({ total: 6, bootstrap: 4, remaining: 2 });
    for (const type of ["ACL", "COMMENT", "SECURITY LABEL"]) {
      expect(split.bootstrap).toContain(`${type} - DATABASE postgres`);
      expect(split.remaining).not.toContain(`${type} - DATABASE postgres`);
    }
    expect(split.remaining).toContain("COMMENT - EXTENSION pg_graphql");
    expect(split.remaining).toContain("ACL public TABLE evidence");
  });
  it.each([
    "1; 0 0 SCHEMA - public owner\n1; 0 0 ACL - public owner",
    "unrecognized private content",
    "; no entries",
    "1; 3079 9 EXTENSION - pg_graphql owner",
  ])("refuses unqualified archive partitions: %s", (toc) => {
    expect(() => drill.partitionRestoreToc(toc)).toThrow("archive");
  });
  it("reconstructs the captured GraphQL wrapper definition, original owner and membership without inventing grants", () => {
    const definition =
      'CREATE OR REPLACE FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) RETURNS jsonb LANGUAGE sql AS $fn$ SELECT NULL::jsonb $fn$;';
    const script = drill.graphqlOverlayScript({
      definition,
      owner: 'source"owner',
      extension: "pg_graphql",
    });
    expect(script).toContain(definition);
    expect(script).toContain('OWNER TO "source""owner";');
    expect(script).toContain(
      "ALTER EXTENSION pg_graphql ADD FUNCTION graphql_public.graphql(text,text,jsonb,jsonb);",
    );
    expect(script).not.toContain("GRANT");
    expect(script).not.toContain("SUPERUSER");
    expect(
      drill.graphqlOverlayScript({
        definition: definition.slice(0, -1),
        owner: "postgres",
        extension: "pg_graphql",
      }),
    ).toContain("$fn$;\nALTER FUNCTION");
    expect(() =>
      drill.graphqlOverlayScript({
        definition: "CREATE FUNCTION arbitrary()",
        owner: "postgres",
        extension: "pg_graphql",
      }),
    ).toThrow("overlay");
  });
  it("contains extension workers and scheduled execution before any source SQL is restored", () => {
    const command = drill.isolatedPostgresStartup("supabase_admin");
    expect(command).toContain("--username=supabase_admin");
    expect(command).toContain("-c max_worker_processes=0");
    expect(command).toContain("-c max_parallel_workers=0");
    expect(command).toContain("-c cron.launch_active_jobs=off");
    expect(command).toContain("-c listen_addresses=");
    expect(command).toContain("-c unix_socket_directories=/tmp");
    expect(() => drill.isolatedPostgresStartup("arbitrary; unsafe")).toThrow(
      "Unqualified",
    );
  });
  it("restores with PostgreSQL default ownership reconstruction, never stripping owners or ACLs", () => {
    const args = drill.databaseRestoreArgs("c".repeat(64), "supabase_admin");
    expect(args).toContain("--exit-on-error");
    expect(args).toContain("--verbose");
    expect(args).toContain("--clean");
    expect(args).toContain("--create");
    expect(args.slice(-2)).toEqual(["-d", "template1"]);
    expect(args).not.toContain("--use-set-session-authorization");
    expect(args).not.toContain("--no-owner");
    expect(args).not.toContain("--no-acl");
    expect(args).not.toContain("--no-privileges");
    const remaining = drill.databaseRestoreArgs(
      "c".repeat(64),
      "supabase_admin",
      "remaining",
    );
    expect(remaining).not.toContain("--create");
    expect(remaining).toContain("--use-list=/tmp/remaining.toc");
    expect(remaining).not.toContain("--clean");
    expect(remaining).not.toContain("--if-exists");
    expect(
      remaining.slice(remaining.indexOf("-d"), remaining.indexOf("-d") + 2),
    ).toEqual(["-d", "postgres"]);
  });
  it("rejects arbitrary restore identities before constructing command arguments", () => {
    expect(() =>
      drill.databaseRestoreArgs("production", "supabase_admin"),
    ).toThrow("Unqualified");
    expect(() =>
      drill.databaseRestoreArgs("c".repeat(64), "arbitrary"),
    ).toThrow("Unqualified");
  });
  it.each(["postgres", "supabase_admin"])(
    "preserves the source bootstrap %s while removing only its duplicate creation",
    (bootstrap) => {
      const script = `-- source roles\nCREATE ROLE ${bootstrap};\nALTER ROLE ${bootstrap} WITH SUPERUSER;\nCREATE ROLE customer_role;\nGRANT customer_role TO postgres GRANTED BY ${bootstrap};\n`;
      const restored = drill.prepareRolesRestore(script, bootstrap);
      expect(restored).toBe(
        script.replace(
          `CREATE ROLE ${bootstrap};`,
          "-- Bootstrap role was created by isolated initdb with the source identity.",
        ),
      );
      expect(restored).toContain(`ALTER ROLE ${bootstrap} WITH SUPERUSER;`);
      expect(restored).toContain(`GRANTED BY ${bootstrap};`);
    },
  );
  it("refuses missing, duplicate or arbitrary bootstrap creation", () => {
    expect(() =>
      drill.prepareRolesRestore(
        "ALTER ROLE postgres WITH SUPERUSER;",
        "postgres",
      ),
    ).toThrow("exactly one");
    expect(() =>
      drill.prepareRolesRestore(
        "CREATE ROLE postgres;\nCREATE ROLE postgres;",
        "postgres",
      ),
    ).toThrow("exactly one");
    expect(() =>
      drill.prepareRolesRestore("CREATE ROLE unsafe;", "unsafe"),
    ).toThrow("Unqualified");
  });
  it.each(["DOCKER_HOST", "DOCKER_CONTEXT"])(
    "cannot hide actual process %s through a partial environment argument",
    async (key) => {
      vi.stubEnv(
        key,
        key === "DOCKER_HOST" ? "tcp://production.example:2376" : "remote",
      );
      await expect(
        drill.runRestoreDrill({
          env: { SYNC_DR_LOCAL_SOURCE: "supabase_db_ai-maintenance-system" },
          log: () => {},
        }),
      ).rejects.toThrow("overrides");
    },
  );
  it("extracts only a fixed SQLSTATE and allowlisted extension hint", () => {
    expect(
      drill.safeDiagnostic(
        "ERROR: 42501 sensitive-test-secret pg_cron /private/path",
      ),
    ).toEqual({
      category: "subprocess_failure",
      sqlState: "42501",
      extensionHint: "pg_cron",
    });
    expect(
      JSON.stringify(
        drill.safeDiagnostic(
          "ERROR: permission denied sensitive-test-secret unapproved_private_extension",
        ),
      ),
    ).toBe('{"category":"permission_denied"}');
  });
  it("classifies active database sessions without disclosing database names or PIDs", () => {
    expect(
      drill.safeDiagnostic(
        'pg_restore: error: ERROR: database "private-db" is being accessed by other users\nDETAIL: There are 2 other sessions using the database.\nCommand was: DROP DATABASE IF EXISTS private_db;',
      ),
    ).toEqual({
      category: "active_database_sessions",
      statementHint: "drop_database",
    });
  });
  it.each([
    "schema",
    "relation",
    "function",
    "database",
    "type",
    "collation",
    "language",
  ])(
    "reports only the fixed missing %s object class, never its private identifier",
    (kind) => {
      expect(
        drill.safeDiagnostic(
          `ERROR: ${kind} "private-sensitive-identifier" does not exist\nCommand was: CREATE TABLE private_sensitive_table(id int);`,
        ),
      ).toEqual({
        category: "missing_object",
        missingObjectHint: kind,
        statementHint: "create_table",
      });
    },
  );
  it("allows only a fixed canonical schema hint, not private identifiers", () => {
    expect(
      drill.safeDiagnostic(
        'ERROR: schema "extensions" does not exist sensitive-test-secret',
      ),
    ).toEqual({
      category: "missing_object",
      missingObjectHint: "schema",
      canonicalSchemaHint: "extensions",
    });
  });
  it("classifies an archive object and commented restore statement without leaking identifiers", () => {
    expect(
      drill.safeDiagnostic(`pg_restore: from TOC entry 912; 0 0 ACL FUNCTION private_function() private_owner
pg_restore: error: could not execute query: ERROR: function private_function() does not exist
Command was: -- private object comment
GRANT EXECUTE ON FUNCTION private_function() TO private_recipient;`),
    ).toEqual({
      category: "missing_object",
      missingObjectHint: "function",
      restoreObjectTypeHint: "ACL",
      statementHint: "grant",
    });
  });
  it.each([
    "gen_random_uuid",
    "uuid_generate_v4",
    "digest",
    "pg_stat_statements_reset",
  ])("identifies only approved platform primitive %s", (name) => {
    expect(
      drill.safeDiagnostic(
        `ERROR: function extensions.${name}() does not exist`,
      ),
    ).toEqual({
      category: "missing_object",
      missingObjectHint: "function",
      platformFunctionHint: name,
    });
  });
  it("does not disclose unknown TOC types or private function identifiers", () => {
    expect(
      drill.safeDiagnostic(`pg_restore: from TOC entry 1; 0 0 SECRET_TYPE private_identifier
ERROR: function private_uuid_generate_v4() does not exist`),
    ).toEqual({ category: "missing_object", missingObjectHint: "function" });
  });
  it("does not mistake earlier verbose extension messages for the failing dependency", () => {
    expect(
      drill.safeDiagnostic(`pg_restore: creating EXTENSION pg_cron
pg_restore: from TOC entry 3; 0 0 ACL FUNCTION private_name() private_owner
pg_restore: error: ERROR: function private_name() does not exist
Command was: GRANT EXECUTE ON FUNCTION private_name() TO private_role;`),
    ).toEqual({
      category: "missing_object",
      missingObjectHint: "function",
      restoreObjectTypeHint: "ACL",
      statementHint: "grant",
    });
  });
  it("reports only fixed platform extension names for actual version differences", () => {
    expect(
      drill.platformExtensionVersionMismatches(
        [
          {
            kind: "extension",
            key: "pg_stat_statements",
            value: ["1.10", "extensions", "postgres"],
          },
          {
            kind: "extension",
            key: "pg_cron",
            value: ["1.6", "pg_catalog", "postgres"],
          },
          {
            kind: "extension",
            key: "private_name",
            value: ["sensitive", "public", "postgres"],
          },
        ],
        [
          { name: "pg_stat_statements", version: "1.11" },
          { name: "pg_cron", version: "1.6" },
          { name: "private_name", version: "other" },
        ],
      ),
    ).toEqual(["pg_stat_statements"]);
  });
  it("classifies source routine metadata without exposing unknown namespace or extension names", () => {
    expect(
      drill.classifyMissingFunctionCatalog({
        schema: "pg_catalog",
        extension: null,
        builtin: false,
      }),
    ).toEqual({
      missingFunctionSourceHint: "catalog_custom",
      missingFunctionNamespaceHint: "pg_catalog",
    });
    expect(
      drill.classifyMissingFunctionCatalog({
        schema: "private_schema",
        extension: "private_extension",
        builtin: false,
      }),
    ).toEqual({ missingFunctionSourceHint: "extension_member" });
    expect(drill.classifyMissingFunctionCatalog(null)).toEqual({
      missingFunctionSourceHint: "not_found",
    });
  });
  it.each([
    [
      "permission denied to grant privileges as role private-grantor",
      "grantor_permission",
    ],
    ["must have admin option on role private-role", "role_admin_option"],
    ["must be superuser to alter superuser roles", "superuser_required"],
    [
      "permission denied to set parameter private_parameter",
      "parameter_permission",
    ],
    [
      "private-role is a reserved role, only superusers can modify it",
      "reserved_role",
    ],
  ])(
    "classifies permission failures without disclosing their identifiers: %s",
    (reason, permissionHint) => {
      expect(
        drill.safeDiagnostic(
          `psql:<stdin>:19: ERROR: 42501: ${reason}; password=sensitive-test-secret`,
        ),
      ).toEqual({
        category: "permission_denied",
        sqlState: "42501",
        permissionHint,
      });
    },
  );
  it("reports only fixed failure categories, not database diagnostics or secrets", () => {
    const privateDiagnostic =
      'ERROR: permission denied for password="sensitive-test-secret" at /private/provider/path';
    expect(drill.diagnosticCategory(privateDiagnostic)).toBe(
      "permission_denied",
    );
    expect(
      drill.diagnosticCategory(
        "ERROR: must be preloaded shared_preload_libraries secret",
      ),
    ).toBe("preload_configuration");
    expect(
      drill.diagnosticCategory('ERROR: role "private-role" does not exist'),
    ).toBe("missing_role");
    expect(
      drill.diagnosticCategory(
        "unrecognized provider diagnostic sensitive-test-secret",
      ),
    ).toBe("subprocess_failure");
  });
  it("refuses execution without explicit local-source intent before any Docker command", async () => {
    await expect(
      drill.runRestoreDrill({ env: {}, log: () => {} }),
    ).rejects.toThrow("Explicit local");
    await expect(
      drill.runRestoreDrill({
        env: { SYNC_DR_LOCAL_SOURCE: "production" },
        log: () => {},
      }),
    ).rejects.toThrow("Explicit local");
    await expect(
      drill.runRestoreDrill({
        env: {
          SYNC_DR_LOCAL_SOURCE: "supabase_db_ai-maintenance-system",
          DOCKER_CONTEXT: "remote",
        },
        log: () => {},
      }),
    ).rejects.toThrow("overrides");
  });
  it("accepts only the explicit local CLI database identity", () => {
    expect(
      drill.validateSource(local, "unix:///var/run/docker.sock", {}),
    ).toEqual({ id: local.Id, image: local.Image });
  });
  it.each([
    "tcp://127.0.0.1:2375",
    "ssh://host",
    "tcp://production.example:2376",
  ])("refuses remote or TCP Docker context %s", (endpoint) => {
    expect(() => drill.validateSource(local, endpoint, {})).toThrow(
      "local Docker",
    );
  });
  it.each([
    { DOCKER_HOST: "unix:///other.sock" },
    { DOCKER_CONTEXT: "remote" },
  ])("refuses environment context overrides %j", (env) => {
    expect(() =>
      drill.validateSource(local, "unix:///var/run/docker.sock", env),
    ).toThrow("override");
  });
  it.each([
    { ...local, Name: "/production" },
    { ...local, State: { Running: false } },
    { ...local, Config: { Labels: {} } },
    { ...local, Image: "postgres:latest" },
    { ...local, Id: "../elsewhere" },
  ])("refuses an unqualified source %j", (source) => {
    expect(() =>
      drill.validateSource(source, "unix:///var/run/docker.sock", {}),
    ).toThrow();
  });
  it("requires a nonempty manifest and all four canonical namespaces", () => {
    expect(() => drill.compareManifests([], [])).toThrow("empty");
    const entries = ["public", "auth", "storage", "supabase_migrations"].map(
      (schema) => ({
        kind: "data",
        key: `${schema}.t`,
        value: { count: 1, digest: "c".repeat(64) },
      }),
    );
    expect(drill.compareManifests(entries, entries)).toEqual({
      entries: 4,
      tables: 4,
      rows: 4,
    });
    expect(() =>
      drill.compareManifests(entries.slice(1), entries.slice(1)),
    ).toThrow("namespace");
  });
  it("reports only fixed inventory classes, field labels and aggregate counts, never identities or values", () => {
    const source = [
      {
        kind: "extension",
        key: "private extension",
        value: ["1", "private schema", "private owner"],
      },
      {
        kind: "data",
        key: "private table",
        value: { count: 3, digest: "private digest" },
      },
      { kind: "private kind", key: "private object", value: "private value" },
      {
        kind: "schema",
        key: "private absent schema",
        value: ["private owner", null],
      },
    ];
    const target = [
      {
        kind: "extension",
        key: "private extension",
        value: ["1", "private schema", "changed private owner"],
      },
      {
        kind: "data",
        key: "private table",
        value: { count: 3, digest: "changed private digest" },
      },
      {
        kind: "private kind",
        key: "private object",
        value: "changed private value",
      },
      {
        kind: "schema",
        key: "private new schema",
        value: ["private owner", null],
      },
    ];
    expect(drill.inventoryMismatchSummary(source, target)).toEqual({
      sourceEntries: 4,
      restoredEntries: 4,
      differences: [
        {
          kind: "data",
          missing: 0,
          unexpected: 0,
          changed: 1,
          duplicates: 0,
          fields: { digest: 1 },
        },
        {
          kind: "extension",
          missing: 0,
          unexpected: 0,
          changed: 1,
          duplicates: 0,
          fields: { owner: 1 },
        },
        {
          kind: "other",
          missing: 0,
          unexpected: 0,
          changed: 1,
          duplicates: 0,
          fields: { value: 1 },
        },
        {
          kind: "schema",
          missing: 1,
          unexpected: 1,
          changed: 0,
          duplicates: 0,
          fields: {},
        },
      ],
    });
    expect(
      JSON.stringify(drill.inventoryMismatchSummary(source, target)),
    ).not.toContain("private");
    expect(() => drill.compareManifests(source, target)).toThrow("differs");
  });
  it("counts duplicate inventory identities without exposing their keys or suppressing the qualification failure", () => {
    const entry = { kind: "role", key: "private role", value: [true] };
    expect(
      drill.inventoryMismatchSummary([entry, entry], [entry]).differences,
    ).toEqual([
      {
        kind: "role",
        missing: 0,
        unexpected: 0,
        changed: 0,
        duplicates: 1,
        fields: {},
      },
    ]);
    expect(() => drill.compareManifests([entry, entry], [entry])).toThrow(
      "Duplicate",
    );
  });
  it("bounds schema ACL and constraint diagnostics to fixed namespaces, role hints and booleans, without printing definitions or grants", () => {
    const source = [
      {
        kind: "schema",
        key: "net",
        value: ["postgres", ["private-role=U/postgres"]],
      },
      { kind: "schema", key: "private-schema", value: ["private-owner", null] },
      {
        kind: "constraint",
        key: "private-constraint",
        value: [false, false, false, "CHECK (private_column > 1) NOT VALID"],
      },
    ];
    const target = [
      {
        kind: "schema",
        key: "net",
        value: ["postgres", ["private-role=U/supabase_admin"]],
      },
      { kind: "schema", key: "private-schema", value: ["private-owner", []] },
      {
        kind: "constraint",
        key: "private-constraint",
        value: [false, false, false, "CHECK (private_column > 1)"],
      },
    ];
    const result = drill.inventoryMismatchSummary(source, target);
    expect(result.schemaAclHints).toEqual([
      {
        namespace: "net",
        sourceOwner: "postgres",
        restoredOwner: "postgres",
        sourceDefaultAcl: false,
        restoredDefaultAcl: false,
        sourceAclEntries: 1,
        restoredAclEntries: 1,
        sourceOnlyEntries: 1,
        restoredOnlyEntries: 1,
        sourceGrantors: { postgres: 1 },
        restoredGrantors: { supabase_admin: 1 },
      },
      {
        namespace: "other",
        sourceOwner: "other",
        restoredOwner: "other",
        sourceDefaultAcl: true,
        restoredDefaultAcl: false,
        sourceAclEntries: 0,
        restoredAclEntries: 0,
        sourceOnlyEntries: 0,
        restoredOnlyEntries: 0,
        sourceGrantors: {},
        restoredGrantors: {},
      },
    ]);
    expect(result.constraintDefinitionHints).toEqual([
      {
        sourceType: "check",
        restoredType: "check",
        sourceNotValid: true,
        restoredNotValid: false,
        trailingNotValidOnly: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(() => drill.compareManifests(source, target)).toThrow("differs");
  });
  it("retains missing-field differences and never treats inherited object keys as diagnostic classes", () => {
    const before = [
      {
        kind: "platform_function",
        key: "private function",
        value: { owner: "private owner", acl: null },
      },
    ];
    const after = [
      {
        kind: "platform_function",
        key: "private function",
        value: { owner: "private owner" },
      },
    ];
    expect(
      drill.inventoryMismatchSummary(before, after).differences[0].fields,
    ).toEqual({ acl: 1 });
    expect(
      drill.inventoryMismatchSummary(
        [{ kind: "toString", key: "private key", value: 1 }],
        [],
      ).differences[0].kind,
    ).toBe("other");
  });
  it("refuses missing, unexpected, duplicate and altered restored entries", () => {
    const entries = ["public", "auth", "storage", "supabase_migrations"].map(
      (schema) => ({
        kind: "data",
        key: `${schema}.t`,
        value: { count: 1, digest: "c".repeat(64) },
      }),
    );
    for (const target of [
      entries.slice(1),
      [...entries, { kind: "role", key: "extra", value: {} }],
      [...entries, entries[0]],
      entries.map((entry, i) =>
        i ? entry : { ...entry, value: { count: 1, digest: "d".repeat(64) } },
      ),
    ]) {
      expect(() => drill.compareManifests(entries, target)).toThrow();
    }
  });
  it("preserves array order and canonicalizes object key order", () => {
    expect(drill.fingerprint({ a: 1, b: [2, 3] })).toBe(
      drill.fingerprint({ b: [2, 3], a: 1 }),
    );
    expect(drill.fingerprint([2, 3])).not.toBe(drill.fingerprint([3, 2]));
  });
  it("detects changes in RLS, tenant policy and SECURITY DEFINER ownership or search path", () => {
    const data = ["public", "auth", "storage", "supabase_migrations"].map(
      (schema) => ({
        kind: "data",
        key: `${schema}.t`,
        value: { count: 1, digest: "c".repeat(64) },
      }),
    );
    const controls = [
      {
        kind: "relation",
        key: "public.assets",
        value: { rls: true, owner: "postgres" },
      },
      {
        kind: "policy",
        key: "public.assets.tenant",
        value: { expression: "organization_id = current_organization_id()" },
      },
      {
        kind: "function",
        key: "public.get_current_user_context()",
        value: { definer: true, owner: "postgres", searchPath: ["public"] },
      },
    ];
    const original = [...data, ...controls];
    for (const changed of [
      { rls: false, owner: "postgres" },
      { expression: "true" },
      { definer: true, owner: "authenticated", searchPath: ["public"] },
      { definer: true, owner: "postgres", searchPath: ["$user", "public"] },
    ]) {
      const index = "rls" in changed ? 0 : "expression" in changed ? 1 : 2;
      const target = [
        ...data,
        ...controls.map((control, i) =>
          i === index ? { ...control, value: changed } : control,
        ),
      ];
      expect(() => drill.compareManifests(original, target)).toThrow("differs");
    }
  });
  it("creates private exclusive artifacts and refuses symlink replacement", () => {
    const parent = mkdtempSync(join(tmpdir(), "syncai-dr-test-"));
    const output = drill.createPrivateOutput(parent);
    expect(statSync(output).mode & 0o777).toBe(0o700);
    drill.writePrivateArtifact(output, "report.json", "{}");
    expect(statSync(join(output, "report.json")).mode & 0o777).toBe(0o600);
    expect(() =>
      drill.writePrivateArtifact(output, "report.json", "overwrite"),
    ).toThrow();
    const victim = join(parent, "victim");
    writeFileSync(victim, "untouched");
    symlinkSync(victim, join(output, "roles.sql"));
    expect(() =>
      drill.writePrivateArtifact(output, "roles.sql", "overwrite"),
    ).toThrow();
    expect(readFileSync(victim, "utf8")).toBe("untouched");
    expect(() =>
      drill.writePrivateArtifact(output, "../escape.json", "{}"),
    ).toThrow();
  });
  it("requires exact target ownership, network isolation, no ports and no host mounts before cleanup", () => {
    const runId = "c".repeat(32);
    const target = {
      Id: "d".repeat(64),
      Name: `/syncai-dr-${runId}`,
      HostConfig: { NetworkMode: "none", PortBindings: {} },
      Mounts: [],
      Config: { Labels: { "com.syncai.dr.run": runId } },
    };
    expect(drill.validateTarget(target, runId)).toBe(target.Id);
    for (const candidate of [
      { ...target, Name: "/other" },
      { ...target, Config: { Labels: {} } },
      { ...target, HostConfig: { NetworkMode: "bridge", PortBindings: {} } },
      {
        ...target,
        HostConfig: { NetworkMode: "none", PortBindings: { "5432/tcp": [{}] } },
      },
      { ...target, Mounts: [{ Type: "bind", Source: "/private/data" }] },
      { ...target, Mounts: undefined },
    ]) {
      expect(() => drill.validateTarget(candidate, runId)).toThrow();
    }
  });
});
