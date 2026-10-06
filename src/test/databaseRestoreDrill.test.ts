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
