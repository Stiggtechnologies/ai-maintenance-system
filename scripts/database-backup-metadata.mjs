import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAlias, isMap, isScalar, parseDocument, visit } from "yaml";
import { JSDOM, VirtualConsole } from "jsdom";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const refPattern = /^[a-z]{20}$/;
const regionPattern = /^[a-z]{2}-(?:[a-z]+-)*[a-z]+-[1-9]$/;
const appUrl = "https://app.syncai.ca";
const jsonLimit = 2 * 1024 * 1024;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const refused = () =>
  new Error("Unqualified private backup metadata observation");
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Parse the actual YAML authority, including quoted/flow keys. Duplicate keys,
 * alias/anchor/merge/tag indirection and job/step target overrides fail closed. */
export function parseProductionIdentity(source, env = {}) {
  try {
    if (
      typeof source !== "string" ||
      Buffer.byteLength(source) > 256 * 1024 ||
      source.includes("\0") ||
      !record(env)
    )
      throw refused();
    const doc = parseDocument(source, {
      strict: true,
      uniqueKeys: true,
      stringKeys: true,
      prettyErrors: false,
      logLevel: "error",
    });
    if (doc.errors.length || doc.warnings.length || !isMap(doc.contents))
      throw refused();
    const environment = doc.contents.items.find(
      (pair) => isScalar(pair.key) && pair.key.value === "env",
    )?.value;
    if (!isMap(environment) || environment.items.length !== 2) throw refused();
    const allowed = new Set(environment.items);
    const values = {};
    for (const pair of environment.items) {
      if (
        !isScalar(pair.key) ||
        !["SUPABASE_PROJECT_ID", "APP_URL"].includes(pair.key.value) ||
        !isScalar(pair.value) ||
        typeof pair.value.value !== "string"
      )
        throw refused();
      values[pair.key.value] = pair.value.value;
    }
    visit(doc, {
      Node(_, node, path) {
        if (isAlias(node) || node.anchor || node.tag || path.length > 64)
          throw refused();
      },
      Pair(_, pair) {
        if (!isScalar(pair.key) || pair.key.value === "<<") throw refused();
        if (
          ["SUPABASE_PROJECT_ID", "APP_URL", "SUPABASE_PROJECT_REF"].includes(
            pair.key.value,
          ) &&
          !allowed.has(pair)
        )
          throw refused();
      },
    });
    if (
      !refPattern.test(values.SUPABASE_PROJECT_ID ?? "") ||
      values.APP_URL !== appUrl
    )
      throw refused();
    for (const [key, expected] of [
      ["SUPABASE_PROJECT_ID", values.SUPABASE_PROJECT_ID],
      ["SUPABASE_PROJECT_REF", values.SUPABASE_PROJECT_ID],
      ["APP_URL", appUrl],
    ]) {
      if (env[key] !== undefined && env[key] !== "" && env[key] !== expected)
        throw refused();
    }
    return { projectRef: values.SUPABASE_PROJECT_ID, appUrl };
  } catch {
    throw refused();
  }
}

function instant(value) {
  if (typeof value !== "string") throw refused();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) throw refused();
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    throw refused();
  if (match[8] !== "Z") {
    const [offsetHour, offsetMinute] = match[8].slice(1).split(":").map(Number);
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    )
      throw refused();
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw refused();
  // Date.parse truncates provider microseconds. Keep an exact integer instant
  // for identity, ordering and anomaly detection; no BigInt enters the report.
  const fraction = (match[7] ?? "").padEnd(6, "0");
  const us = BigInt(Math.floor(ms / 1000) * 1000) * 1000n + BigInt(fraction);
  const iso = new Date(ms).toISOString();
  return {
    us,
    iso: fraction.endsWith("000")
      ? iso
      : iso.replace(/\.\d{3}Z$/, `.${fraction}Z`),
  };
}

function recoveryWindow(raw, observed) {
  if (raw === undefined || raw === null)
    return { observationStatus: "UNAVAILABLE" };
  if (!record(raw)) throw refused();
  const early = raw.earliest_physical_backup_date_unix;
  const late = raw.latest_physical_backup_date_unix;
  if (early === undefined && late === undefined)
    return { observationStatus: "UNAVAILABLE" };
  if (
    !Number.isSafeInteger(early) ||
    !Number.isSafeInteger(late) ||
    early <= 0 ||
    early > late ||
    !Number.isFinite(new Date(late * 1000).getTime())
  )
    throw refused();
  return {
    observationStatus: "PROVIDER_REPORTED",
    earliestReportedRestorePoint: new Date(early * 1000).toISOString(),
    latestReportedRestorePoint: new Date(late * 1000).toISOString(),
    futureTimestampObserved: BigInt(late) * 1000000n > observed,
    restoreExecutionProven: false,
  };
}

/** Allowlisted private report: never spread or persist a provider payload. */
export function projectBackupMetadata(raw, context) {
  if (
    !record(raw) ||
    !record(context) ||
    !refPattern.test(context.projectRef ?? "") ||
    !regionPattern.test(context.region ?? "")
  )
    throw refused();
  const observed = instant(context.observedAt);
  if (
    raw.region !== context.region ||
    typeof raw.walg_enabled !== "boolean" ||
    typeof raw.pitr_enabled !== "boolean" ||
    !Array.isArray(raw.backups) ||
    raw.backups.length > 10000
  )
    throw refused();
  const seen = new Set();
  const entries = raw.backups.map((entry) => {
    if (
      !record(entry) ||
      typeof entry.is_physical_backup !== "boolean" ||
      typeof entry.status !== "string" ||
      !entry.status.trim() ||
      entry.status.length > 128
    )
      throw refused();
    const inserted = instant(entry.inserted_at);
    const identity = `${inserted.us}:${entry.is_physical_backup}`;
    if (seen.has(identity)) throw refused();
    seen.add(identity);
    return {
      inserted,
      completed: entry.status === "COMPLETED",
      physical: entry.is_physical_backup,
    };
  });
  const completed = entries
    .filter((entry) => entry.completed)
    .sort((a, b) =>
      a.inserted.us < b.inserted.us
        ? -1
        : a.inserted.us > b.inserted.us
          ? 1
          : 0,
    );
  const newest = completed.at(-1)?.inserted;
  const window = recoveryWindow(raw.physical_backup_data, observed.us);
  const futureTimestampCount = entries.filter(
    (entry) => entry.inserted.us > observed.us,
  ).length;
  const warnings = ["backup_insertion_time_is_not_recoverable_data_cut"];
  if (!completed.length) warnings.push("no_completed_backups_observed");
  if (futureTimestampCount || window.futureTimestampObserved)
    warnings.push("provider_clock_anomaly_observed");
  if (window.observationStatus === "UNAVAILABLE")
    warnings.push("provider_restore_window_not_reported");
  return {
    schemaVersion: 1,
    scope: "production_backup_metadata_observation",
    observationStatus: "CAPTURED",
    recoveryQualification: "UNPROVEN",
    observedAt: observed.iso,
    projectRef: context.projectRef,
    region: context.region,
    providerConfiguration: {
      walgEnabled: raw.walg_enabled,
      pitrEnabled: raw.pitr_enabled,
    },
    backups: {
      observedCount: entries.length,
      completedCount: completed.length,
      nonCompletedCount: entries.length - completed.length,
      physicalCount: entries.filter((entry) => entry.physical).length,
      futureTimestampCount,
      oldestCompletedInsertedAt: completed[0]?.inserted.iso ?? null,
      newestCompletedInsertedAt: newest?.iso ?? null,
      newestCompletedInsertionAgeHours:
        newest && newest.us <= observed.us
          ? Number(observed.us - newest.us) / 3600000000
          : null,
    },
    physicalRecoveryWindow: window,
    productionRestored: false,
    backupBytesRestored: false,
    storageBytesRestored: false,
    retentionPolicyProven: false,
    providerRestoreAccessProven: false,
    custodianRecoveryProven: false,
    rpoProven: false,
    rtoProven: false,
    capabilityComplete: false,
    warnings,
  };
}

function qualifiedJson(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > jsonLimit)
    throw refused();
  const value = JSON.parse(text);
  // JSON.parse accepts duplicate keys. Reject them, including escaped spellings,
  // before any provider field is used as authority. Grammar is checked above.
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") stack.push(new Set());
    else if (text[i] === "[") stack.push(null);
    else if (text[i] === "}" || text[i] === "]") stack.pop();
    else if (text[i] === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") i++;
        i++;
      }
      let next = i + 1;
      while (/\s/.test(text[next] ?? "") && next < text.length) next++;
      if (text[next] === ":") {
        const key = JSON.parse(text.slice(start, i + 1));
        const keys = stack.at(-1);
        if (!keys || keys.has(key)) throw refused();
        keys.add(key);
      }
    }
    if (stack.length > 32) throw refused();
  }
  return value;
}

function defaultRunSupabase(args) {
  return new Promise((resolveOutput, reject) => {
    execFile(
      "supabase",
      args,
      { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: jsonLimit },
      (error, stdout) => {
        if (error) reject(refused());
        else resolveOutput(stdout);
      },
    );
  });
}

async function publicText(fetchImpl, url, type, limit) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });
  const mediaType = response?.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  const allowedTypes =
    type === "text/html"
      ? ["text/html"]
      : ["application/javascript", "text/javascript"];
  if (
    !response ||
    response.status !== 200 ||
    (response.url && response.url !== url) ||
    !allowedTypes.includes(mediaType)
  )
    throw refused();
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > limit)
  )
    throw refused();
  if (!response.body) throw refused();
  const reader = response.body.getReader();
  const buffers = [];
  let count = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    count += next.value.byteLength;
    if (count > limit) {
      await reader.cancel();
      throw refused();
    }
    buffers.push(Buffer.from(next.value));
  }
  return Buffer.concat(buffers).toString("utf8");
}

function modulePath(html) {
  const paths = [];
  // Parse the original bounded document, never sanitize it by deletion: doing
  // so can assemble new tags or promote inert text into module authority.
  // The existing dev dependency's defaults disable scripts and resource loads;
  // an unforwarded console prevents page diagnostics reaching operator output.
  const document = new JSDOM(html, {
    includeNodeLocations: true,
    virtualConsole: new VirtualConsole(),
  });
  try {
    for (const script of document.window.document.querySelectorAll("script")) {
      if (script.namespaceURI !== "http://www.w3.org/1999/xhtml")
        throw refused();
      const location = document.nodeLocation(script)?.startTag;
      if (!location) throw refused();
      const attributes = new Map();
      // Retain strict duplicate/attribute qualification on the exact source tag,
      // rather than accepting the HTML parser's first-attribute-wins projection.
      const raw = html.slice(location.startOffset + 7, location.endOffset - 1);
      const attribute =
        /\s+([a-zA-Z][a-zA-Z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+)))?/gy;
      let offset = 0;
      while (offset < raw.length) {
        if (!raw.slice(offset).trim()) break;
        attribute.lastIndex = offset;
        const found = attribute.exec(raw);
        if (!found || attributes.has(found[1].toLowerCase())) throw refused();
        attributes.set(
          found[1].toLowerCase(),
          found[2] ?? found[3] ?? found[4] ?? "",
        );
        offset = attribute.lastIndex;
      }
      // Refuse ambiguous source/DOM interpretation, including entity-encoded
      // authority and noncanonical module type spelling, instead of silently
      // ignoring a second module that a browser could treat as active.
      if (
        script.getAttribute("type") !== (attributes.get("type") ?? null) ||
        script.getAttribute("src") !== (attributes.get("src") ?? null) ||
        (attributes.get("type")?.trim().toLowerCase() === "module" &&
          attributes.get("type") !== "module")
      )
        throw refused();
      if (attributes.get("type") !== "module") continue;
      const path = attributes.get("src");
      if (
        typeof path !== "string" ||
        !/^\/assets\/[A-Za-z0-9_-]+\.js$/.test(path)
      )
        throw refused();
      paths.push(path);
    }
  } finally {
    document.window.close();
  }
  if (paths.length !== 1) throw refused();
  return paths[0];
}

export async function runProductionBackupMetadata(options = {}) {
  // Intentionally never a public CI observation or artifact.
  const env = options.env ?? process.env;
  const authorities = [process.env, env];
  if (
    !record(env) ||
    env.SYNC_DR_PRODUCTION_METADATA !== "read_only" ||
    authorities.some((authority) =>
      [
        "CI",
        "GITHUB_ACTIONS",
        "VERCEL",
        "TF_BUILD",
        "TEAMCITY_VERSION",
        "JENKINS_URL",
        "GITLAB_CI",
      ].some((key) => Boolean(authority[key])),
    )
  )
    throw refused();
  if (
    authorities.some((authority) =>
      Object.keys(authority).some(
        (key) => key.startsWith("SUPABASE_API_") && authority[key],
      ),
    )
  )
    throw refused();
  try {
    const workflowSource =
      options.workflowSource ??
      readFileSync(
        join(root, ".github/workflows/deploy-migrations.yml"),
        "utf8",
      );
    const identity = parseProductionIdentity(workflowSource, env);
    // The real CLI inherits process.env; injected env must never hide it.
    parseProductionIdentity(workflowSource, process.env);
    const observerSource = readFileSync(fileURLToPath(import.meta.url));
    const runSupabase = options.runSupabase ?? defaultRunSupabase;
    const fetchImpl = options.fetchImpl ?? fetch;
    const projects = qualifiedJson(
      await runSupabase(["projects", "list", "--output", "json"]),
    );
    if (!Array.isArray(projects) || projects.length > 1000) throw refused();
    const matches = projects.filter(
      (project) => record(project) && project.id === identity.projectRef,
    );
    if (
      matches.length !== 1 ||
      matches[0].status !== "ACTIVE_HEALTHY" ||
      !regionPattern.test(matches[0].region ?? "")
    )
      throw refused();
    const html = await publicText(
      fetchImpl,
      `${appUrl}/`,
      "text/html",
      1024 * 1024,
    );
    const entrypoint = modulePath(html);
    const bundle = await publicText(
      fetchImpl,
      `${appUrl}${entrypoint}`,
      "javascript",
      12 * 1024 * 1024,
    );
    const refs = new Set(
      [
        ...bundle.matchAll(
          /(?:https?|wss?):\/\/([a-z0-9-]+)\.supabase\.co(?=[:/?#"'`\s]|$)/gi,
        ),
      ].map((match) => match[1]),
    );
    if (
      refs.size !== 1 ||
      !refs.has(identity.projectRef) ||
      !bundle.includes(`https://${identity.projectRef}.supabase.co`)
    )
      throw refused();
    const raw = qualifiedJson(
      await runSupabase([
        "backups",
        "list",
        "--project-ref",
        identity.projectRef,
        "--output",
        "json",
      ]),
    );
    const now = (options.now ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
      throw refused();
    const report = projectBackupMetadata(raw, {
      projectRef: identity.projectRef,
      region: matches[0].region,
      observedAt: now.toISOString(),
    });
    report.provenance = {
      observerSha256: sha(observerSource),
      canonicalWorkflowSha256: sha(workflowSource),
      publicBundleSha256: sha(bundle),
      publicModuleEntrypoint: entrypoint,
      publicBundleContainsProjectRef: true,
      frontendRuntimeBindingProven: false,
      providerMetadataReadSucceeded: true,
    };
    if (
      sha(readFileSync(fileURLToPath(import.meta.url))) !== sha(observerSource)
    )
      throw refused();
    const parent = realpathSync(options.outputParent ?? tmpdir());
    const fromRepository = relative(realpathSync(root), parent);
    if (
      fromRepository === "" ||
      (!isAbsolute(fromRepository) &&
        fromRepository !== ".." &&
        !fromRepository.startsWith(
          `..${process.platform === "win32" ? "\\" : "/"}`,
        ))
    )
      throw refused();
    const output = mkdtempSync(join(parent, "syncai-backup-metadata-"));
    chmodSync(output, 0o700);
    writeFileSync(
      join(output, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    if (
      (statSync(output).mode & 0o777) !== 0o700 ||
      (statSync(join(output, "report.json")).mode & 0o777) !== 0o600
    )
      throw refused();
    (options.log ?? console.log)(
      "Private backup metadata observation captured; recovery qualification remains UNPROVEN.",
    );
    return { output, report };
  } catch {
    // Never emit arbitrary CLI stderr, signed URLs, credentials or payloads.
    throw refused();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.length !== 2) {
    console.error(
      "This private read-only observer accepts no command-line targets or options.",
    );
    process.exitCode = 1;
  } else {
    runProductionBackupMetadata().catch(() => {
      console.error(
        "Private backup metadata observation refused; no recovery qualification recorded.",
      );
      process.exitCode = 1;
    });
  }
}
