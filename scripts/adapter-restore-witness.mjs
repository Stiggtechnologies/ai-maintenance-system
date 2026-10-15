// Disposable CI only. Keep full inventories private; report only constraint
// identifiers already declared in checked-in migrations, never SQL or data.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runRestoreDrill, fingerprint } from "./database-restore-drill.mjs";
const migrations = "supabase/migrations";
const declared = new Map();
for (const file of readdirSync(migrations).filter((name) =>
  name.endsWith(".sql"),
)) {
  const sql = readFileSync(join(migrations, file), "utf8");
  for (const match of sql.matchAll(/\bconstraint\s+([a-z_][a-z0-9_]*)/gi)) {
    const name = match[1].toLowerCase();
    if (!declared.has(name)) declared.set(name, file);
  }
}
let output;
await runRestoreDrill({
  log(message) {
    const match =
      /^Recovery drill (?:PASS|FAIL); private artifacts: (\/tmp\/syncai-database-dr-[A-Za-z0-9]+)$/.exec(
        message,
      );
    if (match) output = match[1];
    console.log(message);
  },
  onReport(report) {
    console.log(
      JSON.stringify({
        verdict: report.verdict,
        failedPhase: report.failedPhase,
        failureCategory: report.failureCategory,
        inventoryMismatchSummary: report.inventoryMismatchSummary,
        targetRemoved: report.targetRemoved,
      }),
    );
    if (report.failedPhase !== "inventory_comparison" || !output) return;
    const before = JSON.parse(
      readFileSync(join(output, "source-inventory.json"), "utf8"),
    );
    const after = new Map(
      JSON.parse(
        readFileSync(join(output, "restored-inventory.json"), "utf8"),
      ).map((row) => [`${row.kind}:${row.key}`, row]),
    );
    const hints = before
      .filter(
        (row) =>
          row.kind === "constraint" &&
          after.has(`constraint:${row.key}`) &&
          fingerprint(row.value) !==
            fingerprint(after.get(`constraint:${row.key}`).value),
      )
      .map((row) => {
        const name = row.key.split(".").at(-1);
        return declared.has(name)
          ? {
              repositoryConstraint: name,
              migration: declared.get(name),
              validated: row.value[0],
            }
          : { repositoryConstraint: "unresolved", validated: row.value[0] };
      });
    console.log(JSON.stringify({ repositoryConstraintHints: hints }));
  },
});
