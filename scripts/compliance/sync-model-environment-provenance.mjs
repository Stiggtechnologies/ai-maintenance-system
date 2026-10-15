import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const lockPath = resolve(repositoryRoot, "package-lock.json");
const modelPackPath = resolve(
  repositoryRoot,
  "src/lib/engineering-models/resonance.ts",
);
const mode = process.argv.includes("--write") ? "write" : "check";

const lockDigest = createHash("sha256")
  .update(readFileSync(lockPath))
  .digest("hex");
const currentModelPack = readFileSync(modelPackPath, "utf8");
const digestPattern = /(packageLockSha256:\s*\n\s*")([a-f0-9]{64})(")/i;
const match = currentModelPack.match(digestPattern);

if (!match) {
  console.error(
    "Unable to locate the packageLockSha256 environment pin in the resonance model pack.",
  );
  process.exitCode = 1;
} else if (match[2] === lockDigest) {
  console.log("Engineering-model environment pin matches package-lock.json.");
} else if (mode === "write") {
  const updatedModelPack = currentModelPack.replace(
    digestPattern,
    `$1${lockDigest}$3`,
  );
  writeFileSync(modelPackPath, updatedModelPack);
  console.log(`Updated ${modelPackPath} to ${lockDigest}.`);
} else {
  console.error(
    "Engineering-model environment pin is stale. Run npm run compliance:model-provenance:write.",
  );
  process.exitCode = 1;
}
