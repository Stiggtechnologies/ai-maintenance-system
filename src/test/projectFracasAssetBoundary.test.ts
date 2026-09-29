import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

// Inspect the effective definition, not an obsolete migration that happened
// to carry a guard. Runtime mixed-subject fixtures must accompany these checks.
function latestFunction(name: string): string {
  let body = "";
  for (const file of readdirSync("supabase/migrations").sort()) {
    if (!file.endsWith(".sql")) continue;
    const sql = stripComments(
      readFileSync(`supabase/migrations/${file}`, "utf8"),
    );
    const start = new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name}\\s*\\(`,
      "ig",
    );
    for (const match of sql.matchAll(start)) {
      const tail = sql.slice(match.index);
      const delimiter = /\bas\s+(\$[a-z_0-9]*\$)/i.exec(tail);
      if (!delimiter) throw new Error(`Cannot read ${name} in ${file}`);
      const contentStart = delimiter.index + delimiter[0].length;
      const end = tail.indexOf(delimiter[1], contentStart);
      if (end < 0) throw new Error(`Unterminated ${name} in ${file}`);
      body = tail.slice(contentStart, end);
    }
  }
  if (!body) throw new Error(`No definition for ${name}`);
  return body;
}

describe("project FRACAS must not enter asset effectiveness", () => {
  for (const name of [
    "evaluate_ca_effectiveness",
    "get_ca_effectiveness_rate",
    "snapshot_ca_effectiveness_kpi",
  ]) {
    it(`${name} explicitly restricts its source to asset work orders`, () => {
      const body = latestFunction(name);
      expect(body).toMatch(/cv\.work_order_id\s+is\s+not\s+null/i);
      expect(body).toMatch(/cv\.asset_id\s+is\s+not\s+null/i);
    });
  }
});
