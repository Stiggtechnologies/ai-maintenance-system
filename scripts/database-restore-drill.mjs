import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceName = "supabase_db_ai-maintenance-system";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const inventorySql = readFileSync(
  join(here, "database-restore-inventory.sql"),
  "utf8",
);

export function fingerprint(value) {
  const canonical = (v) =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return sha(JSON.stringify(canonical(value)));
}

export function prepareRolesRestore(script, bootstrap) {
  if (!["postgres", "supabase_admin"].includes(bootstrap))
    throw new Error("Unqualified source bootstrap identity");
  const creation = `CREATE ROLE ${bootstrap};`;
  const lines = script.split("\n");
  if (lines.filter((line) => line === creation).length !== 1)
    throw new Error("Expected exactly one source bootstrap creation");
  // OID 10 is the grant graph root, not an interchangeable superuser. initdb
  // already created this exact identity. Preserve every ALTER, GRANT and grantor.
  return lines
    .map((line) =>
      line === creation
        ? "-- Bootstrap role was created by isolated initdb with the source identity."
        : line,
    )
    .join("\n");
}

export function databaseRestoreArgs(targetId, bootstrap) {
  if (
    !/^[a-f0-9]{64}$/.test(targetId) ||
    !["postgres", "supabase_admin"].includes(bootstrap)
  )
    throw new Error("Unqualified restore identity");
  // Default pg_restore creates objects as the restore authority, then applies
  // their original owners. Creating each schema as its limited owner instead
  // incorrectly assumes that every historical owner can CREATE on the database.
  return [
    "exec",
    "-i",
    "--user",
    "postgres",
    targetId,
    "pg_restore",
    "--exit-on-error",
    "--verbose",
    "--clean",
    "--if-exists",
    "--create",
    "-U",
    bootstrap,
    "-h",
    "/tmp",
    "-d",
    "template1",
  ];
}

export function isolatedPostgresStartup(bootstrap) {
  if (!["postgres", "supabase_admin"].includes(bootstrap))
    throw new Error("Unqualified source bootstrap identity");
  return `initdb -D /tmp/dr-data --username=${bootstrap} --auth=trust --no-instructions >/tmp/initdb.log; exec postgres -D /tmp/dr-data -c listen_addresses= -c unix_socket_directories=/tmp -c shared_preload_libraries=pg_stat_statements,pg_cron,pg_net -c cron.launch_active_jobs=off -c max_worker_processes=0 -c max_parallel_workers=0`;
}

export function validateSource(source, endpoint, env) {
  if (env.DOCKER_HOST || env.DOCKER_CONTEXT)
    throw new Error("Docker context override is refused");
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix:///"))
    throw new Error("A local Docker Unix socket is required");
  if (
    source.Name !== `/${sourceName}` ||
    !source.State?.Running ||
    source.Config?.Labels?.["com.supabase.cli.project"] !==
      "ai-maintenance-system" ||
    !/^[a-f0-9]{64}$/.test(source.Id) ||
    !/^sha256:[a-f0-9]{64}$/.test(source.Image)
  ) {
    throw new Error("Unqualified local Supabase source");
  }
  return { id: source.Id, image: source.Image };
}

export function validateTarget(target, runId) {
  if (
    !/^[a-f0-9]{32}$/.test(runId) ||
    target.Name !== `/syncai-dr-${runId}` ||
    target.Config?.Labels?.["com.syncai.dr.run"] !== runId ||
    !/^[a-f0-9]{64}$/.test(target.Id) ||
    target.HostConfig?.NetworkMode !== "none" ||
    Object.keys(target.HostConfig?.PortBindings ?? {}).length ||
    !Array.isArray(target.Mounts) ||
    target.Mounts.some(
      (mount) => mount.Type === "bind" || mount.Type === "volume",
    )
  ) {
    throw new Error(
      "Restore target ownership or isolation could not be verified",
    );
  }
  return target.Id;
}

export function createPrivateOutput(parent = tmpdir()) {
  const output = mkdtempSync(join(parent, "syncai-database-dr-"));
  chmodSync(output, 0o700);
  return output;
}

export function writePrivateArtifact(output, name, value) {
  if (
    !/^(report\.json|source-inventory\.json|restored-inventory\.json|roles\.sql|database\.dump)$/.test(
      name,
    )
  ) {
    throw new Error("Unsupported recovery artifact name");
  }
  writeFileSync(join(output, name), value, { flag: "wx", mode: 0o600 });
}

export function compareManifests(source, target) {
  if (!source.length || !target.length)
    throw new Error("Restore inventory is empty");
  const index = (entries) => {
    const map = new Map();
    for (const entry of entries) {
      const key = `${entry.kind}:${entry.key}`;
      if (map.has(key)) throw new Error("Duplicate inventory identity");
      map.set(key, fingerprint(entry.value));
    }
    return map;
  };
  const a = index(source),
    b = index(target);
  if (
    a.size !== b.size ||
    [...a].some(([key, value]) => b.get(key) !== value)
  ) {
    throw new Error(
      "Restored data or control inventory differs from the source",
    );
  }
  for (const schema of ["public", "auth", "storage", "supabase_migrations"]) {
    if (
      !source.some((e) => e.kind === "data" && e.key.startsWith(`${schema}.`))
    )
      throw new Error("Required canonical namespace is absent");
  }
  const tables = source.filter((e) => e.kind === "data");
  return {
    entries: a.size,
    tables: tables.length,
    rows: tables.reduce((n, e) => n + Number(e.value.count), 0),
  };
}

// Never invoke a shell or propagate provider diagnostics. Raw SQL and database
// bytes stay in an exclusive 0600 artifact, not terminal/Actions output.
export function diagnosticCategory(diagnostic) {
  for (const [pattern, category] of [
    [
      /is being accessed by other users|other sessions using the database/i,
      "active_database_sessions",
    ],
    [
      /preloaded|shared_preload_libraries|unrecognized configuration parameter/i,
      "preload_configuration",
    ],
    [/role [^\r\n]{0,200} does not exist/i, "missing_role"],
    [/already exists/i, "existing_object"],
    [
      /must be owner|must be superuser|permission denied|not permitted|must have admin option|reserved role/i,
      "permission_denied",
    ],
    [
      /extension[^\r\n]{0,200}not available|could not open extension control file/i,
      "missing_extension",
    ],
    [/does not exist/i, "missing_object"],
    [/violates [^\r\n]{0,200}constraint/i, "constraint_failure"],
  ])
    if (pattern.test(diagnostic)) return category;
  return "subprocess_failure";
}

export function safeDiagnostic(diagnostic) {
  const sqlState = diagnostic.match(/\bERROR:\s+([0-9A-Z]{5})\b/)?.[1];
  const missingObjectHint = diagnostic
    .match(
      /\b(schema|relation|function|database|type|collation|language|operator|tablespace|extension) [^\r\n]{0,200}does not exist/i,
    )?.[1]
    .toLowerCase();
  const canonicalSchemaHint =
    missingObjectHint === "schema"
      ? [
          "public",
          "auth",
          "storage",
          "supabase_migrations",
          "extensions",
          "realtime",
          "_realtime",
          "vault",
          "graphql",
          "graphql_public",
          "net",
          "cron",
        ].find((schema) =>
          diagnostic.includes(`schema "${schema}" does not exist`),
        )
      : undefined;
  const restoreObjectTypeHint = diagnostic.match(
    /from TOC entry \d+; \d+ \d+ (DEFAULT ACL|EVENT TRIGGER|TABLE DATA|ACL|COMMENT|FUNCTION|EXTENSION|DATABASE|SCHEMA|TABLE|SEQUENCE|VIEW|INDEX|CONSTRAINT|TRIGGER|POLICY)\b/,
  )?.[1];
  const platformFunctionHint =
    missingObjectHint === "function"
      ? [
          "gen_random_uuid",
          "uuid_generate_v4",
          "digest",
          "hmac",
          "uuid_generate_v1",
          "uuid_generate_v1mc",
          "uuid_generate_v3",
          "uuid_generate_v5",
          "pg_stat_statements_reset",
          "pg_stat_statements",
          "pg_stat_statements_info",
        ].find((name) =>
          new RegExp(
            `\\bfunction (?:(?:extensions|public|pg_catalog)\\.)?${name}\\([^\\r\\n]{0,200}\\) does not exist`,
          ).test(diagnostic),
        )
      : undefined;
  // pg_restore can prefix a command with archive comments. Never return those
  // comments, the command text, TOC names or arbitrary function identifiers.
  const restoreCommand = (diagnostic.split(/Command was:\s*/)[1] ?? "").replace(
    /^(?:--[^\r\n]*\r?\n\s*)+/,
    "",
  );
  const statementHint = [
    [/^DROP DATABASE\b/i, "drop_database"],
    [/^CREATE DATABASE\b/i, "create_database"],
    [/^CREATE EXTENSION\b/i, "create_extension"],
    [/^CREATE SCHEMA\b/i, "create_schema"],
    [/^CREATE TABLE\b/i, "create_table"],
    [/^ALTER TABLE\b/i, "alter_table"],
    [/^CREATE (?:OR REPLACE )?FUNCTION\b/i, "create_function"],
    [/^ALTER FUNCTION\b/i, "alter_function"],
    [/^CREATE EVENT TRIGGER\b/i, "create_event_trigger"],
    [/^COMMENT\b/i, "comment"],
    [/^GRANT\b/i, "grant"],
    [/^REVOKE\b/i, "revoke"],
    [/^COPY\b/i, "copy_data"],
  ].find(([pattern]) => pattern.test(restoreCommand))?.[1];
  const permissionHint = [
    [/permission denied to grant privileges as role/i, "grantor_permission"],
    [/must have admin option/i, "role_admin_option"],
    [/must be superuser/i, "superuser_required"],
    [/permission denied to set parameter/i, "parameter_permission"],
    [/reserved role/i, "reserved_role"],
  ].find(([pattern]) => pattern.test(diagnostic))?.[1];
  const extensionHint = [
    "pg_cron",
    "pg_net",
    "pgsodium",
    "supabase_vault",
    "postgis",
    "vector",
    "pg_graphql",
  ].find((name) => diagnostic.includes(name));
  return {
    category: diagnosticCategory(diagnostic),
    ...(sqlState ? { sqlState } : {}),
    ...(missingObjectHint ? { missingObjectHint } : {}),
    ...(canonicalSchemaHint ? { canonicalSchemaHint } : {}),
    ...(restoreObjectTypeHint ? { restoreObjectTypeHint } : {}),
    ...(platformFunctionHint ? { platformFunctionHint } : {}),
    ...(statementHint ? { statementHint } : {}),
    ...(permissionHint ? { permissionHint } : {}),
    ...(extensionHint ? { extensionHint } : {}),
  };
}
async function command(
  binary,
  args,
  { input, outputFd, timeout = 300000 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: root,
      stdio: ["pipe", outputFd ?? "pipe", "pipe"],
    });
    let output = "",
      diagnostic = "",
      bytes = 0,
      finished = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeout);
    child.stdout?.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 32 * 1024 * 1024) child.kill("SIGKILL");
      else output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      if (diagnostic.length < 1024 * 1024) diagnostic += chunk.toString("utf8");
    });
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      finished = true;
      reject(new Error("Recovery subprocess could not start"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (finished) return;
      if (code !== 0 || bytes > 32 * 1024 * 1024)
        reject(
          Object.assign(new Error("Recovery subprocess failed"), {
            ...safeDiagnostic(diagnostic),
          }),
        );
      else resolve(output.trim());
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

const inspect = async (name) =>
  JSON.parse(await command("docker", ["inspect", name]))[0];
const psqlArgs = (id, user, host) => [
  "exec",
  "-i",
  "--user",
  "postgres",
  id,
  "psql",
  "-XqAt",
  "-v",
  "ON_ERROR_STOP=1",
  "-v",
  "VERBOSITY=verbose",
  "-U",
  user,
  "-h",
  host,
  "-d",
  "postgres",
];
const sql = (id, user, host, query) =>
  command("docker", psqlArgs(id, user, host), { input: query });
const parseInventory = (output) =>
  output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

async function exportedSnapshot(id) {
  const child = spawn(
    "docker",
    psqlArgs(id, "postgres", "/var/run/postgresql"),
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let buffer = "",
    done = false;
  child.stderr.on("data", () => {});
  child.stdin.on("error", () => {});
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Snapshot export timed out"));
    }, 30000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (!buffer.includes("\n") || done) return;
      const snapshot = buffer.split("\n")[0].trim();
      clearTimeout(timer);
      done = true;
      if (!/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9]+$/i.test(snapshot)) {
        child.kill("SIGKILL");
        reject(new Error("Invalid exported snapshot"));
      } else resolve(snapshot);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Snapshot exporter could not start"));
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (!done)
        reject(new Error("Snapshot exporter closed before qualification"));
    });
  });
  child.stdin.write(
    "begin isolation level repeatable read read only; select pg_export_snapshot();\n",
  );
  try {
    const snapshot = await ready;
    return {
      snapshot,
      close: () =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error("Snapshot cleanup timed out"));
          }, 10000);
          child.once("close", (code) => {
            clearTimeout(timer);
            code === 0
              ? resolve()
              : reject(new Error("Snapshot cleanup failed"));
          });
          if (child.exitCode !== null || child.signalCode !== null) {
            clearTimeout(timer);
            reject(new Error("Snapshot session ended unexpectedly"));
            return;
          }
          child.stdin.end("rollback;\n\\q\n");
        }),
    };
  } catch {
    child.kill("SIGKILL");
    throw new Error("Snapshot export failed");
  }
}

const restoredWitness = `
begin;
insert into public.organizations(id,name) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Restore drill foreign tenant');
insert into public.assets(id,organization_id,name,tag) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Foreign restore witness','DR-FOREIGN');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  if public.get_current_user_context()->>'organization_id' is distinct from '11111111-1111-1111-1111-111111111111' then raise exception 'restored tenant context mismatch'; end if;
  if not exists(select 1 from public.assets where organization_id='11111111-1111-1111-1111-111111111111') then raise exception 'positive tenant read missing'; end if;
  if exists(select 1 from public.assets where organization_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') then raise exception 'foreign tenant read allowed'; end if;
  begin
    insert into public.assets(organization_id,name) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Forbidden cross-tenant insert');
    raise exception 'foreign tenant write allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'restored-tenant-witness-passed';
`;

export async function runRestoreDrill({
  env = process.env,
  log = console.log,
  onReport = () => {},
} = {}) {
  if (
    env.SYNC_DR_LOCAL_SOURCE !== sourceName ||
    env.DOCKER_HOST ||
    env.DOCKER_CONTEXT ||
    process.env.DOCKER_HOST ||
    process.env.DOCKER_CONTEXT
  ) {
    throw new Error(
      "Explicit local Supabase source is required; Docker overrides are refused",
    );
  }
  let phase = "source_identity",
    snapshotSession,
    targetId,
    output;
  const runId = randomBytes(16).toString("hex");
  const startedAt = new Date().toISOString(),
    started = performance.now();
  const report = {
    schemaVersion: 1,
    scope: "local_logical_database_drill",
    runId,
    startedAt,
    verdict: "FAIL",
    productionRestored: false,
    capabilityComplete: false,
    rtoProven: false,
    rpoProven: false,
    exclusions: [
      "storage_file_bytes",
      "custom_role_passwords",
      "vault_root_key",
      "edge_functions",
      "auth_provider_configuration",
      "live_sign_in",
      "realtime_configuration",
      "application_failover",
      "external_integrations",
      "managed_backup_and_PITR_recovery",
    ],
    phases: {},
  };
  let failure = false;
  const timed = async (name, fn) => {
    phase = name;
    const start = performance.now();
    const result = await fn();
    report.phases[name] = Math.round(performance.now() - start);
    return result;
  };
  try {
    const endpoint = JSON.parse(
      await command(
        "docker",
        ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
        { timeout: 15000 },
      ),
    );
    const source = validateSource(await inspect(sourceName), endpoint, env);
    const bootstrap = await sql(
      source.id,
      "postgres",
      "/var/run/postgresql",
      "select rolname from pg_roles where oid=10 and rolsuper;",
    );
    if (!["postgres", "supabase_admin"].includes(bootstrap))
      throw new Error("Unqualified source bootstrap identity");
    output = createPrivateOutput();
    report.sourceImage = source.image;
    report.sourceBootstrapRole = bootstrap;
    report.sourceCommit = await command("git", ["rev-parse", "HEAD"]);
    const migrationFiles = readdirSync(join(root, "supabase", "migrations"))
      .filter((f) => /^\d{14}_.+\.sql$/.test(f))
      .sort();
    report.migrationChainSha256 = fingerprint(
      migrationFiles.map((file) => [
        file,
        sha(readFileSync(join(root, "supabase", "migrations", file))),
      ]),
    );
    const actualVersions = (
      await sql(
        source.id,
        "postgres",
        "/var/run/postgresql",
        "select version from supabase_migrations.schema_migrations order by version;",
      )
    ).split("\n");
    if (
      JSON.stringify(actualVersions) !==
      JSON.stringify(migrationFiles.map((f) => f.slice(0, 14)))
    )
      throw new Error("Source is not the exact full migration chain");
    report.migrations = migrationFiles.length;
    snapshotSession = await timed("snapshot", () =>
      exportedSnapshot(source.id),
    );
    const before = await timed("source_inventory", async () =>
      parseInventory(
        await sql(
          source.id,
          "postgres",
          "/var/run/postgresql",
          `begin isolation level repeatable read read only; set transaction snapshot '${snapshotSession.snapshot}';\n${inventorySql}\ncommit;`,
        ),
      ),
    );
    writePrivateArtifact(
      output,
      "source-inventory.json",
      JSON.stringify(before),
    );
    await timed("backup", async () => {
      for (const [name, args] of [
        [
          "roles.sql",
          [
            "pg_dumpall",
            "--roles-only",
            "--no-role-passwords",
            "-U",
            "postgres",
            "-h",
            "/var/run/postgresql",
          ],
        ],
        [
          "database.dump",
          [
            "pg_dump",
            "--format=custom",
            `--snapshot=${snapshotSession.snapshot}`,
            "-U",
            "postgres",
            "-h",
            "/var/run/postgresql",
            "-d",
            "postgres",
          ],
        ],
      ]) {
        const fd = openSync(join(output, name), "wx", 0o600);
        try {
          await command(
            "docker",
            ["exec", "--user", "postgres", source.id, ...args],
            { outputFd: fd },
          );
        } finally {
          closeSync(fd);
        }
      }
    });
    await snapshotSession.close();
    snapshotSession = undefined;
    report.backupSha256 = sha(readFileSync(join(output, "database.dump")));
    report.rolesSha256 = sha(readFileSync(join(output, "roles.sql")));
    // New process, empty initdb, no image's managed-schema initialization, no
    // host mounts/ports, no production endpoints, and no outgoing network.
    targetId = await timed("target_create", () =>
      command("docker", [
        "create",
        "--name",
        `syncai-dr-${runId}`,
        "--label",
        `com.syncai.dr.run=${runId}`,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "128",
        "--memory",
        "2g",
        "--cpus",
        "2",
        "--tmpfs",
        "/tmp:rw,nosuid,mode=1777,size=2g",
        "--tmpfs",
        "/var/lib/postgresql/data:rw,nosuid,size=16m",
        "--user",
        "postgres",
        "--entrypoint",
        "/bin/sh",
        source.image,
        "-ceu",
        isolatedPostgresStartup(bootstrap),
      ]),
    );
    validateTarget(await inspect(targetId), runId);
    await command("docker", ["start", targetId]);
    await timed("target_ready", async () => {
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          await command(
            "docker",
            [
              "exec",
              targetId,
              "pg_isready",
              "-U",
              bootstrap,
              "-h",
              "/tmp",
              "-d",
              "postgres",
            ],
            { timeout: 10000 },
          );
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      throw new Error("Isolated target did not start");
    });
    await timed("target_authority", async () => {
      const authority = await sql(
        targetId,
        bootstrap,
        "/tmp",
        `select current_user='${bootstrap}' and oid=10 and rolsuper,
          current_setting('max_worker_processes')::integer=0,
          current_setting('cron.launch_active_jobs')::boolean=false
          from pg_roles where rolname=current_user;`,
      );
      if (authority !== "t|t|t")
        throw new Error(
          "Isolated restore authority or worker containment is unqualified",
        );
      report.targetBootstrapSuperuser = true;
      report.targetWorkerSlotsDisabled = true;
      report.targetCronJobsDisabled = true;
    });
    await timed("restore", async () => {
      phase = "restore_roles";
      const rolesRestore = prepareRolesRestore(
        readFileSync(join(output, "roles.sql"), "utf8"),
        bootstrap,
      );
      report.rolesRestoreSha256 = sha(rolesRestore);
      await sql(targetId, bootstrap, "/tmp", rolesRestore);
      phase = "restore_database";
      await command("docker", databaseRestoreArgs(targetId, bootstrap), {
        input: readFileSync(join(output, "database.dump")),
      });
    });
    const after = await timed("restored_inventory", async () =>
      parseInventory(
        await sql(
          targetId,
          bootstrap,
          "/tmp",
          `begin isolation level repeatable read read only;\n${inventorySql}\ncommit;`,
        ),
      ),
    );
    writePrivateArtifact(
      output,
      "restored-inventory.json",
      JSON.stringify(after),
    );
    report.comparison = compareManifests(before, after);
    const witness = await timed("tenant_runtime", () =>
      sql(targetId, bootstrap, "/tmp", restoredWitness),
    );
    if (!witness.endsWith("restored-tenant-witness-passed"))
      throw new Error("Restored tenant witness missing");
    report.tenantRuntimeWitness = true;
    report.verdict = "PASS";
  } catch (error) {
    failure = true;
    report.failedPhase = phase;
    report.failureCategory = error.category ?? "qualification_failure";
    if (error.sqlState) report.sqlState = error.sqlState;
    if (error.missingObjectHint)
      report.missingObjectHint = error.missingObjectHint;
    if (error.canonicalSchemaHint)
      report.canonicalSchemaHint = error.canonicalSchemaHint;
    if (error.statementHint) report.statementHint = error.statementHint;
    if (error.restoreObjectTypeHint)
      report.restoreObjectTypeHint = error.restoreObjectTypeHint;
    if (error.platformFunctionHint)
      report.platformFunctionHint = error.platformFunctionHint;
    if (error.permissionHint) report.permissionHint = error.permissionHint;
    if (error.extensionHint) report.extensionHint = error.extensionHint;
  } finally {
    if (snapshotSession) {
      try {
        await snapshotSession.close();
      } catch {
        failure = true;
        report.snapshotCleanupFailed = true;
      }
    }
    if (targetId) {
      try {
        validateTarget(await inspect(targetId), runId);
        await command("docker", ["rm", "-f", targetId], { timeout: 30000 });
        report.targetRemoved = true;
      } catch {
        failure = true;
        report.targetCleanupFailed = true;
      }
    }
    if (failure) report.verdict = "FAIL";
    report.elapsedMs = Math.round(performance.now() - started);
    report.finishedAt = new Date().toISOString();
    if (output) {
      try {
        writePrivateArtifact(
          output,
          "report.json",
          JSON.stringify(report, null, 2),
        );
      } catch {
        throw new Error("Recovery drill failed to save its private report");
      }
      log(`Recovery drill ${report.verdict}; private artifacts: ${output}`);
    }
    try {
      onReport(structuredClone(report));
    } catch {
      throw new Error("Recovery drill could not preserve its bounded summary");
    }
  }
  if (failure)
    throw new Error(
      `Recovery drill failed in ${report.failedPhase ?? "cleanup"}; production recovery is not qualified`,
    );
  return { output, report };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runRestoreDrill().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
