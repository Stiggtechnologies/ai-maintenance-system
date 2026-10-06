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

export function platformExtensionVersionMismatches(source, target) {
  const platforms = [
    "pg_stat_statements",
    "pg_cron",
    "pg_net",
    "pgsodium",
    "supabase_vault",
    "postgis",
    "vector",
    "pg_graphql",
    "pgcrypto",
    "uuid-ossp",
    "pgjwt",
  ];
  return platforms.filter((name) => {
    const before = source.find(
      (entry) => entry.kind === "extension" && entry.key === name,
    );
    const after = target.find((entry) => entry.name === name);
    return before && after && before.value[0] !== after.version;
  });
}

export function classifyMissingFunctionCatalog(metadata) {
  if (!metadata) return { missingFunctionSourceHint: "not_found" };
  if (
    typeof metadata.schema !== "string" ||
    typeof metadata.builtin !== "boolean" ||
    !(metadata.extension === null || typeof metadata.extension === "string")
  )
    throw new Error("Unqualified routine diagnostic metadata");
  const namespace = [
    "pg_catalog",
    "public",
    "auth",
    "storage",
    "extensions",
    "net",
    "cron",
    "vault",
    "graphql",
    "graphql_public",
  ].includes(metadata.schema)
    ? metadata.schema
    : undefined;
  const extension = [
    "pg_stat_statements",
    "pg_cron",
    "pg_net",
    "pgsodium",
    "supabase_vault",
    "postgis",
    "vector",
    "pg_graphql",
    "pgcrypto",
    "uuid-ossp",
    "pgjwt",
  ].includes(metadata.extension)
    ? metadata.extension
    : undefined;
  return {
    missingFunctionSourceHint: metadata.extension
      ? "extension_member"
      : metadata.schema === "pg_catalog"
        ? metadata.builtin
          ? "catalog_builtin"
          : "catalog_custom"
        : "custom_routine",
    ...(namespace ? { missingFunctionNamespaceHint: namespace } : {}),
    ...(extension ? { missingFunctionExtensionHint: extension } : {}),
  };
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

export function partitionRestoreToc(toc) {
  const bootstrap = [],
    remaining = [],
    ids = new Set();
  for (const line of toc.split("\n")) {
    if (!line.trim() || line.startsWith(";")) {
      bootstrap.push(line);
      remaining.push(line);
      continue;
    }
    const entry = line.match(/^(\d+);\s+\d+\s+\d+\s+(.+)$/);
    if (!entry || ids.has(entry[1])) throw new Error("Unqualified archive TOC");
    ids.add(entry[1]);
    (/^(DATABASE(?: PROPERTIES)?|SCHEMA|EXTENSION) - /.test(entry[2]) ||
    /^(ACL|COMMENT|SECURITY LABEL) - DATABASE /.test(entry[2])
      ? bootstrap
      : remaining
    ).push(line);
  }
  if (!ids.size) throw new Error("Empty archive TOC");
  if (
    bootstrap.filter((line) =>
      /^\d+;\s+\d+\s+\d+\s+DATABASE - postgres /.test(line),
    ).length !== 1
  )
    throw new Error("Unqualified archive database identity");
  const count = (lines) => lines.filter((line) => /^\d+;/.test(line)).length;
  const counts = {
    total: ids.size,
    bootstrap: count(bootstrap),
    remaining: count(remaining),
  };
  if (counts.bootstrap + counts.remaining !== counts.total)
    throw new Error("Incomplete archive partition");
  return {
    bootstrap: bootstrap.join("\n"),
    remaining: remaining.join("\n"),
    counts,
  };
}

export function graphqlOverlayScript(overlay) {
  if (
    !overlay ||
    overlay.extension !== "pg_graphql" ||
    typeof overlay.owner !== "string" ||
    !overlay.owner.length ||
    overlay.owner.includes("\0") ||
    typeof overlay.definition !== "string" ||
    !overlay.definition.startsWith(
      "CREATE OR REPLACE FUNCTION graphql_public.graphql(",
    )
  )
    throw new Error("Unqualified GraphQL overlay");
  const owner = `"${overlay.owner.replaceAll('"', '""')}"`;
  const definition = overlay.definition.trimEnd();
  return `${definition}${definition.endsWith(";") ? "" : ";"}\nALTER FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) OWNER TO ${owner};
DO $overlay$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid WHERE d.classid='pg_proc'::regclass AND d.objid='graphql_public.graphql(text,text,jsonb,jsonb)'::regprocedure AND d.deptype='e' AND e.extname='pg_graphql') THEN
    ALTER EXTENSION pg_graphql ADD FUNCTION graphql_public.graphql(text,text,jsonb,jsonb);
  END IF;
END $overlay$;\n`;
}

export function graphqlSchemaAclScript(entries, bootstrap) {
  if (
    !Array.isArray(entries) ||
    !["postgres", "supabase_admin"].includes(bootstrap)
  )
    throw new Error("Unqualified GraphQL schema ACL capture");
  if (!entries.length) return "";
  const seen = new Set(),
    statements = ["BEGIN;"];
  const role = (name) => {
    if (typeof name !== "string" || !name.length || name.includes("\0"))
      throw new Error("Unqualified GraphQL ACL role");
    return `"${name.replaceAll('"', '""')}"`;
  };
  for (const entry of entries) {
    const value = entry.value,
      schema = entry.key;
    if (
      entry.kind !== "platform_schema_acl" ||
      !["graphql", "graphql_public"].includes(schema) ||
      seen.has(schema) ||
      !value ||
      value.owner !== bootstrap ||
      typeof value.defaultAcl !== "boolean" ||
      !Array.isArray(value.privileges) ||
      (value.defaultAcl && value.privileges.length)
    )
      throw new Error("Unqualified GraphQL schema ACL capture");
    seen.add(schema);
    statements.push(
      `DO $schema_guard$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='${schema}' AND nspowner='${bootstrap}'::regrole AND nspacl IS NULL) THEN RAISE EXCEPTION 'Unqualified target schema ACL baseline'; END IF; END $schema_guard$;`,
    );
    if (value.defaultAcl) continue;
    const grantees = new Set(["PUBLIC", role(bootstrap)]);
    for (const grant of value.privileges) {
      if (
        !grant ||
        grant.grantor !== bootstrap ||
        !["USAGE", "CREATE"].includes(grant.privilege) ||
        typeof grant.isGrantable !== "boolean" ||
        (grant.grantee === null && grant.isGrantable)
      )
        throw new Error("Unqualified GraphQL ACL grant");
      grantees.add(grant.grantee === null ? "PUBLIC" : role(grant.grantee));
    }
    statements.push(
      `SET LOCAL ROLE ${role(bootstrap)};`,
      `REVOKE ALL ON SCHEMA "${schema}" FROM ${[...grantees].join(", ")};`,
    );
    for (const grant of value.privileges)
      statements.push(
        `GRANT ${grant.privilege} ON SCHEMA "${schema}" TO ${grant.grantee === null ? "PUBLIC" : role(grant.grantee)}${grant.isGrantable ? " WITH GRANT OPTION" : ""};`,
      );
  }
  statements.push("COMMIT;");
  return statements.join("\n") + "\n";
}

export function definitionDifferenceShape(source, target) {
  let prefix = 0,
    suffix = 0;
  while (
    prefix < source.length &&
    prefix < target.length &&
    source[prefix] === target[prefix]
  )
    prefix++;
  while (
    suffix < source.length - prefix &&
    suffix < target.length - prefix &&
    source[source.length - 1 - suffix] === target[target.length - 1 - suffix]
  )
    suffix++;
  const before = source.slice(prefix, source.length - suffix),
    after = target.slice(prefix, target.length - suffix);
  const classes = (value) =>
    [
      ...new Set(
        [...value].map((c) =>
          /\s/.test(c)
            ? "whitespace"
            : /[0-9]/.test(c)
              ? "digit"
              : /[a-zA-Z_]/.test(c)
                ? "letter"
                : "punctuation",
        ),
      ),
    ].sort();
  return {
    sourceChangedLength: before.length,
    restoredChangedLength: after.length,
    sourceClasses: classes(before),
    restoredClasses: classes(after),
  };
}

export function constraintReferenceScript(entry, runId) {
  const identity = entry?.key?.match(
    /^(public|auth|storage|supabase_migrations)\.([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/,
  );
  if (
    entry?.kind !== "constraint" ||
    !identity ||
    !/^[a-f0-9]{32}$/.test(runId) ||
    !Array.isArray(entry.value) ||
    entry.value.length !== 4 ||
    entry.value.slice(0, 3).some((value) => value !== false) ||
    typeof entry.value[3] !== "string" ||
    !entry.value[3].startsWith("CHECK (") ||
    !entry.value[3].endsWith(" NOT VALID") ||
    entry.value[3].includes("\0")
  )
    throw new Error("Unqualified CHECK reference input");
  const [, schema, table] = identity;
  const alias = `syncai_dr_ref_${runId.slice(0, 16)}`;
  // Source SQL comes only from pg_get_constraintdef on the trusted migrated
  // local source, never from a supplied backup or external expression.
  return `BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL timezone='UTC';
SET LOCAL extra_float_digits=3;
SET LOCAL statement_timeout='10s';
ALTER TABLE ONLY "${schema}"."${table}" ADD CONSTRAINT "${alias}" ${entry.value[3]};
SELECT jsonb_build_object('key','${entry.key}','checkType',contype='c','relationMatches',conrelid='"${schema}"."${table}"'::regclass,'value',jsonb_build_array(convalidated,condeferrable,condeferred,pg_get_constraintdef(oid))) FROM pg_constraint WHERE conrelid='"${schema}"."${table}"'::regclass AND conname='${alias}';
ROLLBACK;\n`;
}

export function qualifyConstraintReference(source, restored, reference) {
  constraintReferenceScript(source, "0".repeat(32));
  if (
    restored?.kind !== "constraint" ||
    restored.key !== source.key ||
    reference?.key !== source.key ||
    reference.checkType !== true ||
    reference.relationMatches !== true ||
    !Array.isArray(reference.value) ||
    reference.value.length !== 4 ||
    fingerprint(reference.value.slice(0, 3)) !==
      fingerprint(source.value.slice(0, 3)) ||
    fingerprint(reference.value) !== fingerprint(restored.value)
  )
    throw new Error("Constraint reference did not qualify");
  // Only the compiler-confirmed representation of the captured source CHECK
  // changes. Never substitute a restored predicate without this runtime proof.
  return {
    ...source,
    value: [...source.value.slice(0, 3), reference.value[3]],
  };
}

export function databaseRestoreArgs(targetId, bootstrap, stage = "full") {
  if (
    !/^[a-f0-9]{64}$/.test(targetId) ||
    !["postgres", "supabase_admin"].includes(bootstrap) ||
    !["full", "bootstrap", "remaining"].includes(stage)
  )
    throw new Error("Unqualified restore identity");
  // Default pg_restore creates objects as the restore authority, then applies
  // their original owners. Creating each schema as its limited owner instead
  // incorrectly assumes that every historical owner can CREATE on the database.
  const args = [
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
  if (stage === "full") return args;
  args.push(`--use-list=/tmp/${stage}.toc`);
  if (stage === "bootstrap") return args;
  // PostgreSQL restores DATABASE and DATABASE PROPERTIES independently of the
  // TOC filter when --create is enabled. Their ACL/comments/security labels are
  // also create-gated, so all database entries belong to the first pass only.
  return args
    .filter((arg) => !["--clean", "--if-exists", "--create"].includes(arg))
    .map((arg) => (arg === "template1" ? "postgres" : arg));
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

const targetTmpfs = {
  "/tmp": "rw,nosuid,mode=1777,size=2g",
  "/var/lib/postgresql/data": "rw,nosuid,size=16m",
};

export function validateTarget(target, runId, sourceImage) {
  const host = target?.HostConfig ?? {};
  const config = target?.Config ?? {};
  const network = target?.NetworkSettings;
  const record = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const emptyList = (value) =>
    value === null ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0);
  const boundedInteger = (value, ceiling) =>
    Number.isSafeInteger(value) && value > 0 && value <= ceiling;
  // Inspect actual Docker metadata, not the requested launch arguments. Hints
  // are fixed labels only; never return configuration values or private paths.
  const violations = [];
  if (
    !/^[a-f0-9]{32}$/.test(runId) ||
    target?.Name !== `/syncai-dr-${runId}` ||
    config.Labels?.["com.syncai.dr.run"] !== runId ||
    !/^[a-f0-9]{64}$/.test(target?.Id)
  )
    violations.push("ownership");
  if (
    !/^sha256:[a-f0-9]{64}$/.test(sourceImage) ||
    target?.Image !== sourceImage
  )
    violations.push("immutable_image");
  if (
    host.NetworkMode !== "none" ||
    host.PublishAllPorts !== false ||
    !(host.PortBindings === null || record(host.PortBindings)) ||
    Object.keys(host.PortBindings ?? {}).length ||
    !record(network?.Networks) ||
    Object.keys(network.Networks).some((name) => name !== "none") ||
    !(network?.Ports === null || record(network?.Ports)) ||
    Object.values(network.Ports ?? {}).some((bindings) => bindings !== null)
  )
    violations.push("network");
  if (
    config.User !== "postgres" ||
    host.Privileged !== false ||
    host.ReadonlyRootfs !== true ||
    !Array.isArray(host.CapDrop) ||
    host.CapDrop.length !== 1 ||
    host.CapDrop[0] !== "ALL" ||
    !emptyList(host.CapAdd) ||
    !emptyList(host.GroupAdd) ||
    !Array.isArray(host.SecurityOpt) ||
    host.SecurityOpt.length !== 1 ||
    ![
      "no-new-privileges",
      "no-new-privileges=true",
      "no-new-privileges:true",
    ].includes(host.SecurityOpt[0])
  )
    violations.push("privilege");
  if (
    !boundedInteger(host.Memory, 2147483648) ||
    host.MemorySwap !== host.Memory ||
    !boundedInteger(host.NanoCpus, 2000000000) ||
    !boundedInteger(host.PidsLimit, 128) ||
    host.OomKillDisable !== false
  )
    violations.push("resource_limits");
  if (
    !host.Tmpfs ||
    fingerprint(host.Tmpfs) !== fingerprint(targetTmpfs) ||
    !emptyList(host.Binds) ||
    !emptyList(host.VolumesFrom) ||
    !emptyList(host.Mounts) ||
    !Array.isArray(target?.Mounts) ||
    target.Mounts.some(
      (mount) =>
        !mount ||
        mount.Type !== "tmpfs" ||
        !Object.hasOwn(targetTmpfs, mount.Destination) ||
        mount.RW !== true ||
        (mount.Source !== undefined && mount.Source !== ""),
    )
  )
    violations.push("mounts");
  if (
    !emptyList(host.Devices) ||
    !emptyList(host.DeviceRequests) ||
    !emptyList(host.DeviceCgroupRules)
  )
    violations.push("devices");
  if (
    host.IpcMode !== "private" ||
    host.CgroupnsMode !== "private" ||
    host.PidMode !== "" ||
    host.UTSMode !== "" ||
    host.UsernsMode !== ""
  )
    violations.push("namespaces");
  if (
    !Array.isArray(config.Healthcheck?.Test) ||
    config.Healthcheck.Test.length !== 1 ||
    config.Healthcheck.Test[0] !== "NONE"
  )
    violations.push("healthcheck");
  if (violations.length) {
    const error = new Error(
      "Restore target ownership or isolation could not be verified",
    );
    error.category = "target_isolation_unqualified";
    error.targetIsolationHints = violations;
    throw error;
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
    !/^(report\.json|source-inventory\.json|source-after-backup-inventory\.json|restored-inventory\.json|post-reference-inventory\.json|constraint-references\.json|roles\.sql|database\.dump|graphql-overlay\.sql|graphql-schema-acl\.sql)$/.test(
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

// Diagnostics must not expose source identities, SQL, owners, ACLs or digests.
// These labels describe the fixed inventory contract; values remain private.
export function inventoryMismatchSummary(source, target) {
  const layouts = {
    database: [
      "owner",
      "encoding",
      "collation",
      "ctype",
      "template",
      "allowConnections",
      "connectionLimit",
      "acl",
    ],
    database_role_setting: null,
    parameter_acl: null,
    role: [
      "superuser",
      "inherit",
      "createRole",
      "createDatabase",
      "login",
      "replication",
      "bypassRls",
      "connectionLimit",
      "validUntil",
      "settings",
    ],
    membership: ["grantor", "adminOption", "inheritOption", "setOption"],
    default_acl: null,
    extension: ["version", "schema", "owner"],
    platform_function: {
      definition: "definition",
      owner: "owner",
      securityDefiner: "securityDefiner",
      searchPath: "searchPath",
      extension: "extension",
      acl: "acl",
    },
    platform_schema_acl: {
      owner: "owner",
      defaultAcl: "defaultAcl",
      privileges: "privileges",
    },
    schema: ["owner", "acl"],
    relation: [
      "kind",
      "persistence",
      "owner",
      "rowSecurity",
      "forceRowSecurity",
      "acl",
      "options",
      "populated",
    ],
    sequence: {
      dataType: "dataType",
      start: "start",
      increment: "increment",
      minimum: "minimum",
      maximum: "maximum",
      cache: "cache",
      cycle: "cycle",
      ownedBy: "ownedBy",
      lastValue: "lastValue",
      isCalled: "isCalled",
    },
    view: null,
    column: [
      "position",
      "type",
      "notNull",
      "identity",
      "generated",
      "acl",
      "default",
    ],
    policy: ["command", "permissive", "roles", "using", "withCheck"],
    function: ["owner", "securityDefiner", "searchPath", "acl", "definition"],
    constraint: ["validated", "deferrable", "deferred", "definition"],
    trigger: ["enabled", "definition"],
    index: null,
    data: { count: "count", digest: "digest" },
  };
  const groups = new Map(),
    schemaAclHints = [],
    constraintDefinitionHints = [],
    definitionShapeHints = [];
  const roleHint = (name) =>
    [
      "postgres",
      "supabase_admin",
      "anon",
      "authenticated",
      "service_role",
    ].includes(name)
      ? name
      : "other";
  const grantors = (acl) => {
    const counts = {};
    for (const item of acl) {
      const role = roleHint(item.slice(item.lastIndexOf("/") + 1));
      counts[role] = (counts[role] ?? 0) + 1;
    }
    return counts;
  };
  const constraintType = (definition) => {
    for (const [prefix, type] of [
      ["FOREIGN KEY ", "foreign_key"],
      ["CHECK ", "check"],
      ["PRIMARY KEY ", "primary_key"],
      ["UNIQUE ", "unique"],
      ["EXCLUDE ", "exclusion"],
    ])
      if (definition.startsWith(prefix)) return type;
    return "other";
  };
  const group = (entry) => {
    const kind = Object.hasOwn(layouts, entry.kind) ? entry.kind : "other";
    if (!groups.has(kind))
      groups.set(kind, {
        kind,
        missing: 0,
        unexpected: 0,
        changed: 0,
        duplicates: 0,
        fields: {},
      });
    return groups.get(kind);
  };
  const index = (entries) => {
    const result = new Map();
    for (const entry of entries) {
      const key = `${entry.kind}:${entry.key}`;
      if (result.has(key)) group(entry).duplicates++;
      else result.set(key, entry);
    }
    return result;
  };
  const before = index(source),
    after = index(target);
  for (const [key, entry] of before) {
    const restored = after.get(key);
    if (!restored) {
      group(entry).missing++;
      continue;
    }
    if (fingerprint(entry.value) === fingerprint(restored.value)) continue;
    const difference = group(entry);
    difference.changed++;
    const layout = Object.hasOwn(layouts, entry.kind)
      ? layouts[entry.kind]
      : null;
    const changedFields = [];
    if (layout) {
      for (const [position, label] of Object.entries(layout)) {
        if (
          fingerprint({ value: entry.value?.[position] }) !==
          fingerprint({ value: restored.value?.[position] })
        )
          changedFields.push(label);
      }
    }
    for (const field of changedFields.length ? changedFields : ["value"])
      difference.fields[field] = (difference.fields[field] ?? 0) + 1;
    if (entry.kind === "schema" && changedFields.includes("acl")) {
      const sourceAcl = entry.value[1] ?? [],
        restoredAcl = restored.value[1] ?? [];
      schemaAclHints.push({
        namespace: [
          "public",
          "auth",
          "storage",
          "extensions",
          "graphql",
          "graphql_public",
          "net",
          "cron",
          "vault",
          "supabase_functions",
          "supabase_migrations",
        ].includes(entry.key)
          ? entry.key
          : "other",
        sourceOwner: roleHint(entry.value[0]),
        restoredOwner: roleHint(restored.value[0]),
        sourceDefaultAcl: entry.value[1] === null,
        restoredDefaultAcl: restored.value[1] === null,
        sourceAclEntries: sourceAcl.length,
        restoredAclEntries: restoredAcl.length,
        sourceOnlyEntries: sourceAcl.filter(
          (item) => !restoredAcl.includes(item),
        ).length,
        restoredOnlyEntries: restoredAcl.filter(
          (item) => !sourceAcl.includes(item),
        ).length,
        sourceGrantors: grantors(sourceAcl),
        restoredGrantors: grantors(restoredAcl),
      });
    }
    if (entry.kind === "constraint" && changedFields.includes("definition")) {
      const original = entry.value[3],
        recovered = restored.value[3];
      constraintDefinitionHints.push({
        sourceType: constraintType(original),
        restoredType: constraintType(recovered),
        sourceNotValid: original.endsWith(" NOT VALID"),
        restoredNotValid: recovered.endsWith(" NOT VALID"),
        trailingNotValidOnly:
          original.replace(/ NOT VALID$/, "") ===
          recovered.replace(/ NOT VALID$/, ""),
      });
    }
    if (
      ["constraint", "function", "platform_function"].includes(entry.kind) &&
      changedFields.includes("definition")
    ) {
      const position =
        entry.kind === "constraint"
          ? 3
          : entry.kind === "function"
            ? 4
            : "definition";
      definitionShapeHints.push({
        kind: entry.kind,
        ...definitionDifferenceShape(
          entry.value[position],
          restored.value[position],
        ),
      });
    }
  }
  for (const [key, entry] of after)
    if (!before.has(key)) group(entry).unexpected++;
  return {
    sourceEntries: source.length,
    restoredEntries: target.length,
    differences: [...groups.values()].sort((a, b) =>
      a.kind.localeCompare(b.kind),
    ),
    ...(schemaAclHints.length ? { schemaAclHints } : {}),
    ...(constraintDefinitionHints.length ? { constraintDefinitionHints } : {}),
    ...(definitionShapeHints.length ? { definitionShapeHints } : {}),
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
  const tocContext = diagnostic.lastIndexOf("pg_restore: from TOC entry ");
  if (tocContext >= 0) diagnostic = diagnostic.slice(tocContext);
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
  { input, outputFd, timeout = 300000, onFailureDiagnostic } = {},
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
    child.on("close", async (code) => {
      clearTimeout(timer);
      if (finished) return;
      if (code !== 0 || bytes > 32 * 1024 * 1024) {
        if (onFailureDiagnostic) {
          try {
            await onFailureDiagnostic(diagnostic);
          } catch {
            // Diagnostic failure must never swallow the original restore failure.
          }
        }
        reject(
          Object.assign(new Error("Recovery subprocess failed"), {
            ...safeDiagnostic(diagnostic),
          }),
        );
      } else resolve(output.trim());
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
    const graphqlOverlay = before.find(
      (entry) => entry.kind === "platform_function",
    )?.value;
    const graphqlScript = graphqlOverlay
      ? graphqlOverlayScript(graphqlOverlay)
      : undefined;
    if (graphqlScript) {
      writePrivateArtifact(output, "graphql-overlay.sql", graphqlScript);
      report.graphqlOverlaySha256 = sha(graphqlScript);
    }
    const graphqlAclScript = graphqlSchemaAclScript(
      before.filter((entry) => entry.kind === "platform_schema_acl"),
      bootstrap,
    );
    if (graphqlAclScript) {
      writePrivateArtifact(output, "graphql-schema-acl.sql", graphqlAclScript);
      report.graphqlSchemaAclSha256 = sha(graphqlAclScript);
    }
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
    const afterBackup = await timed("source_backup_inventory", async () =>
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
      "source-after-backup-inventory.json",
      JSON.stringify(afterBackup),
    );
    try {
      compareManifests(before, afterBackup);
    } catch (error) {
      report.inventoryMismatchSummary = inventoryMismatchSummary(
        before,
        afterBackup,
      );
      throw error;
    }
    report.sourceBackupInventoryStable = true;
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
        "--ipc",
        "private",
        "--cgroupns",
        "private",
        "--no-healthcheck",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "128",
        "--memory",
        "2g",
        "--memory-swap",
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
    validateTarget(await inspect(targetId), runId, source.image);
    await command("docker", ["start", targetId]);
    validateTarget(await inspect(targetId), runId, source.image);
    report.targetContainmentVerified = true;
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
      validateTarget(await inspect(targetId), runId, source.image);
      const rolesRestore = prepareRolesRestore(
        readFileSync(join(output, "roles.sql"), "utf8"),
        bootstrap,
      );
      report.rolesRestoreSha256 = sha(rolesRestore);
      await sql(targetId, bootstrap, "/tmp", rolesRestore);
      phase = "restore_database";
      const archive = readFileSync(join(output, "database.dump"));
      const toc = await command(
        "docker",
        [
          "exec",
          "-i",
          "--user",
          "postgres",
          targetId,
          "pg_restore",
          "--create",
          "--list",
        ],
        { input: archive },
      );
      const partitions = partitionRestoreToc(toc);
      report.archivePartition = partitions.counts;
      for (const stage of ["bootstrap", "remaining"]) {
        validateTarget(await inspect(targetId), runId, source.image);
        await command(
          "docker",
          [
            "exec",
            "-i",
            "--user",
            "postgres",
            targetId,
            "/bin/sh",
            "-ceu",
            `umask 077; test ! -e /tmp/${stage}.toc; cat > /tmp/${stage}.toc`,
          ],
          { input: partitions[stage] },
        );
      }
      try {
        await command(
          "docker",
          databaseRestoreArgs(targetId, bootstrap, "bootstrap"),
          { input: archive },
        );
        if (graphqlAclScript) {
          phase = "restore_graphql_schema_acl";
          await sql(targetId, bootstrap, "/tmp", graphqlAclScript);
          report.graphqlSchemaAclRestored = true;
        }
        if (graphqlScript) {
          phase = "restore_graphql_overlay";
          await sql(targetId, bootstrap, "/tmp", graphqlScript);
          report.graphqlOverlayRestored = true;
        }
        phase = "restore_database";
        await command(
          "docker",
          databaseRestoreArgs(targetId, bootstrap, "remaining"),
          {
            input: archive,
            onFailureDiagnostic: async (diagnostic) => {
              const identity = diagnostic.match(
                /ERROR:\s+(?:[0-9A-Z]{5}:\s+)?function ([^\r\n]{1,2000}) does not exist/,
              )?.[1];
              if (!identity) return;
              try {
                // Encode the literal rather than interpolate identifiers or SQL.
                // Metadata stays in memory; only fixed classifications enter reports.
                const identityHex = Buffer.from(identity, "utf8").toString(
                  "hex",
                );
                const metadata = JSON.parse(
                  await sql(
                    source.id,
                    "postgres",
                    "/var/run/postgresql",
                    `set statement_timeout='5s'; select coalesce((select jsonb_build_object('schema',n.nspname,'extension',e.extname,'builtin',p.oid<16384) from pg_proc p join pg_namespace n on n.oid=p.pronamespace left join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e' left join pg_extension e on e.oid=d.refobjid where p.oid=to_regprocedure(convert_from(decode('${identityHex}','hex'),'UTF8'))),'null'::jsonb);`,
                  ),
                );
                Object.assign(report, classifyMissingFunctionCatalog(metadata));
              } catch {
                report.functionCatalogDiagnosticUnavailable = true;
              }
            },
          },
        );
      } catch (error) {
        // Read-only diagnosis of the partial throwaway target. A regular archive
        // uses the installed default extension version, not necessarily the source
        // version. Return fixed platform names only, never private catalog values.
        try {
          const targetExtensions = JSON.parse(
            await sql(
              targetId,
              bootstrap,
              "/tmp",
              "select coalesce(jsonb_agg(jsonb_build_object('name',extname,'version',extversion)),'[]'::jsonb) from pg_extension;",
            ),
          );
          report.extensionVersionMismatchHints =
            platformExtensionVersionMismatches(before, targetExtensions);
        } catch {
          report.extensionVersionDiagnosticUnavailable = true;
        }
        throw error;
      }
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
    const comparisonBefore = [...before],
      constraintReferences = [];
    try {
      await timed("constraint_reference", async () => {
        const restoredByKey = new Map(
          after
            .filter((entry) => entry.kind === "constraint")
            .map((entry) => [entry.key, entry]),
        );
        for (let index = 0; index < before.length; index++) {
          const entry = before[index],
            restored = restoredByKey.get(entry.key);
          if (
            entry.kind !== "constraint" ||
            !restored ||
            fingerprint(entry.value) === fingerprint(restored.value) ||
            fingerprint(entry.value.slice(0, 3)) !==
              fingerprint(restored.value.slice(0, 3)) ||
            !entry.value[3].startsWith("CHECK (") ||
            !entry.value[3].endsWith(" NOT VALID") ||
            entry.value.slice(0, 3).some((value) => value !== false)
          )
            continue;
          validateTarget(await inspect(targetId), runId, source.image);
          const reference = JSON.parse(
            await sql(
              targetId,
              bootstrap,
              "/tmp",
              constraintReferenceScript(entry, runId),
            ),
          );
          comparisonBefore[index] = qualifyConstraintReference(
            entry,
            restored,
            reference,
          );
          constraintReferences.push(reference);
        }
      });
    } catch (error) {
      report.inventoryMismatchSummary = inventoryMismatchSummary(before, after);
      throw error;
    }
    if (constraintReferences.length) {
      const artifact = JSON.stringify(constraintReferences);
      writePrivateArtifact(output, "constraint-references.json", artifact);
      report.constraintReferencesSha256 = sha(artifact);
      const afterReference = await timed("post_reference_inventory", async () =>
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
        "post-reference-inventory.json",
        JSON.stringify(afterReference),
      );
      compareManifests(after, afterReference);
      report.constraintsReparsed = constraintReferences.length;
      report.constraintParserWitness = true;
      report.referenceRollbackInventoryUnchanged = true;
    }
    try {
      report.comparison = await timed("inventory_comparison", async () =>
        compareManifests(comparisonBefore, after),
      );
    } catch (error) {
      report.inventoryMismatchSummary = inventoryMismatchSummary(before, after);
      throw error;
    }
    report.sequenceCountersCompared = before.filter(
      (entry) => entry.kind === "sequence",
    ).length;
    report.materializedViewsCompared = before.filter(
      (entry) => entry.kind === "relation" && entry.value[0] === "m",
    ).length;
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
    if (error.targetIsolationHints)
      report.targetIsolationHints = error.targetIsolationHints;
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
        validateTarget(await inspect(targetId), runId, report.sourceImage);
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
