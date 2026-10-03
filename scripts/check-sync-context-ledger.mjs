#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const ledgerPath = resolve(root, "docs/sync-context/capability-ledger.json");
const baselinePath = resolve(
  root,
  "docs/sync-context/capability-ledger-baseline.json",
);

const STATUS = new Set([
  "existing_foundation",
  "prototype_only",
  "missing",
  "external_dependency",
]);
const COMPLETION = new Set(["not_started", "partial", "complete"]);
const CONSTRAINTS = new Set([
  "accessibility",
  "canonical_identity",
  "clock_integrity",
  "evidence_provenance",
  "human_approval",
  "licensing",
  "no_invented_data",
  "no_parallel_store",
  "non_surveillance",
  "privacy",
  "source_authority",
  "source_health",
  "tenant_isolation",
]);

function fail(message) {
  throw new Error(`Sync Context ledger: ${message}`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read ${path.replace(`${root}/`, "")}: ${error.message}`);
  }
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sorted(item)]),
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(sorted(value)))
    .digest("hex");
}

function nonEmptyStrings(value, field, id, minimum = 1) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    fail(`${id}.${field} must contain at least ${minimum} non-empty string(s)`);
  }
}

function validateEvidencePath(path, id) {
  if (path.startsWith("/") || path.includes("..")) {
    fail(`${id}.evidence must use a repository-relative path: ${path}`);
  }
  if (!existsSync(resolve(root, path))) {
    fail(`${id}.evidence does not exist: ${path}`);
  }
}

export function validateLedger(ledger) {
  if (ledger.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (ledger.ledgerId !== "sync-context-godseye-integration-contract") {
    fail("unexpected ledgerId");
  }
  nonEmptyStrings(
    ledger.sourceCatalog?.map((source) => source.id),
    "sourceCatalog",
    "ledger",
    4,
  );
  const sourceIds = new Set(ledger.sourceCatalog.map((source) => source.id));
  if (
    !ledger.provenanceAnchors ||
    typeof ledger.provenanceAnchors !== "object" ||
    Array.isArray(ledger.provenanceAnchors)
  ) {
    fail("provenanceAnchors must be an object");
  }
  const sequenceIds = new Set(
    ledger.implementationSequence?.map((slice) => slice.id),
  );
  if (sequenceIds.size !== 11)
    fail("implementationSequence must contain SC-00 through SC-10");
  for (let index = 0; index <= 10; index += 1) {
    const id = `SC-${String(index).padStart(2, "0")}`;
    if (!sequenceIds.has(id)) fail(`implementationSequence is missing ${id}`);
  }
  if (!Array.isArray(ledger.capabilities) || ledger.capabilities.length === 0) {
    fail("capabilities must be a non-empty array");
  }

  const ids = new Set();
  for (const item of ledger.capabilities) {
    const id = item?.id ?? "<missing-id>";
    if (!/^SCX-[A-Z]+-\d{3}$/.test(id)) fail(`invalid capability id ${id}`);
    if (ids.has(id)) fail(`duplicate capability id ${id}`);
    ids.add(id);
    for (const field of ["category", "title", "requirement", "gap", "pr"]) {
      if (typeof item[field] !== "string" || !item[field].trim()) {
        fail(`${id}.${field} must be a non-empty string`);
      }
    }
    if (!STATUS.has(item.status))
      fail(`${id} has invalid status ${item.status}`);
    if (!sequenceIds.has(item.pr))
      fail(`${id}.pr references unknown slice ${item.pr}`);
    nonEmptyStrings(item.provenance, "provenance", id);
    for (const provenance of item.provenance) {
      const prefix = provenance.split(":", 1)[0];
      if (!sourceIds.has(prefix) && prefix !== "AGENTS.md") {
        fail(`${id}.provenance has unknown source prefix ${prefix}`);
      }
      if (
        typeof ledger.provenanceAnchors[provenance] !== "string" ||
        !ledger.provenanceAnchors[provenance].trim()
      ) {
        fail(`${id}.provenance has no authoritative anchor: ${provenance}`);
      }
    }
    nonEmptyStrings(item.canonicalReuse, "canonicalReuse", id);
    nonEmptyStrings(item.acceptance, "acceptance", id, 2);
    nonEmptyStrings(item.constraints, "constraints", id);
    for (const constraint of item.constraints) {
      if (!CONSTRAINTS.has(constraint)) {
        fail(`${id}.constraints has unknown value ${constraint}`);
      }
    }
    if (!Array.isArray(item.evidence)) fail(`${id}.evidence must be an array`);
    item.evidence.forEach((path) => validateEvidencePath(path, id));
    if (!Array.isArray(item.prototypeEvidence)) {
      fail(`${id}.prototypeEvidence must be an array`);
    }
    if (!Array.isArray(item.externalDependencies)) {
      fail(`${id}.externalDependencies must be an array`);
    }
    if (item.status === "existing_foundation" && item.evidence.length === 0) {
      fail(`${id} claims an existing foundation without repository evidence`);
    }
    if (
      item.status === "prototype_only" &&
      item.prototypeEvidence.length === 0
    ) {
      fail(`${id} claims prototype-only without prototype evidence`);
    }
    if (
      item.status === "external_dependency" &&
      item.externalDependencies.length === 0
    ) {
      fail(`${id} claims an external dependency without naming one`);
    }
    if (!item.completion || !COMPLETION.has(item.completion.state)) {
      fail(`${id}.completion.state is invalid`);
    }
    if (!Array.isArray(item.completion.verifiedBy)) {
      fail(`${id}.completion.verifiedBy must be an array`);
    }
    if (item.completion.state === "partial" && item.evidence.length === 0) {
      fail(`${id} claims partial delivery without main-repository evidence`);
    }
    if (item.completion.state === "complete") {
      if (item.status !== "existing_foundation") {
        fail(
          `${id} cannot be complete unless its status is existing_foundation`,
        );
      }
      if (item.evidence.length < 2 || item.completion.verifiedBy.length === 0) {
        fail(
          `${id} cannot be complete without at least two evidence paths and automated verification`,
        );
      }
      for (const verifier of item.completion.verifiedBy) {
        if (
          !verifier.startsWith("npm ") &&
          !verifier.startsWith("node ") &&
          !existsSync(resolve(root, verifier))
        ) {
          fail(`${id}.completion.verifiedBy does not exist: ${verifier}`);
        }
      }
    }
  }
  return ledger;
}

export function buildBaseline(ledger) {
  const capabilities = [...ledger.capabilities].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const governedContract = {
    sourceCatalog: ledger.sourceCatalog,
    provenanceAnchors: ledger.provenanceAnchors,
    statusDefinitions: ledger.statusDefinitions,
    completionDefinitions: ledger.completionDefinitions,
    implementationSequence: ledger.implementationSequence,
    capabilities,
  };
  const statusCounts = Object.fromEntries(
    [...STATUS]
      .sort()
      .map((status) => [
        status,
        capabilities.filter((item) => item.status === status).length,
      ]),
  );
  const completionCounts = Object.fromEntries(
    [...COMPLETION]
      .sort()
      .map((state) => [
        state,
        capabilities.filter((item) => item.completion.state === state).length,
      ]),
  );
  return {
    schemaVersion: 1,
    ledgerId: ledger.ledgerId,
    acceptedCapabilityCount: capabilities.length,
    acceptedContractDigest: digest(governedContract),
    acceptedCapabilityDigest: digest(capabilities),
    acceptedIdDigest: digest(capabilities.map((item) => item.id)),
    statusCounts,
    completionCounts,
  };
}

export function checkBaseline(ledger, baseline) {
  const actual = buildBaseline(ledger);
  for (const field of [
    "schemaVersion",
    "ledgerId",
    "acceptedCapabilityCount",
    "acceptedContractDigest",
    "acceptedCapabilityDigest",
    "acceptedIdDigest",
  ]) {
    if (baseline[field] !== actual[field]) {
      fail(
        `${field} differs from the accepted baseline; inspect the ledger diff and run npm run sync-context:accept in the same reviewed change if intentional`,
      );
    }
  }
  if (
    JSON.stringify(baseline.statusCounts) !==
    JSON.stringify(actual.statusCounts)
  ) {
    fail("status counts differ from the accepted baseline");
  }
  if (
    JSON.stringify(baseline.completionCounts) !==
    JSON.stringify(actual.completionCounts)
  ) {
    fail("completion counts differ from the accepted baseline");
  }
  return actual;
}

function main() {
  const ledger = validateLedger(readJson(ledgerPath));
  const actual = buildBaseline(ledger);
  if (process.argv.includes("--write")) {
    writeFileSync(baselinePath, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(
      `Accepted ${actual.acceptedCapabilityCount} Sync Context capabilities (${actual.acceptedCapabilityDigest.slice(0, 12)}).`,
    );
    return;
  }
  checkBaseline(ledger, readJson(baselinePath));
  console.log(
    `Sync Context ledger verified: ${actual.acceptedCapabilityCount} capabilities; ${actual.completionCounts.complete} complete.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
