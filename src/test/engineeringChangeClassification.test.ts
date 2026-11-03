/**
 * E4.06 — a recommendation's engineering change class has a producer.
 *
 * enforce_authority_limit already refuses approval of a classified,
 * unsigned recommendation, and the provenance trigger already pins
 * change_class against a direct client write. Nothing assigned the class,
 * so the branch never fired. classify_recommendation_change is that
 * assignment, and it is the only client path allowed to make it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIGRATIONS_DIR,
  migrationFiles,
  stripComments,
} from "./support/migrationPolicies";

const MIGRATION =
  "20271105152000_recommendation_engineering_classification.sql";

const chain = migrationFiles().map((file) => ({
  file,
  sql: stripComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
}));

function finalFunction(
  name: string,
): { body: string; header: string; file: string } | null {
  let found: { body: string; header: string; file: string } | null = null;
  const head = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name}\\s*\\(([\\s\\S]*?)\\)\\s*returns([\\s\\S]*?)\\$([A-Za-z_]*)\\$`,
    "i",
  );
  for (const { file, sql } of chain) {
    const match = head.exec(sql);
    if (!match || match.index === undefined) continue;
    const tag = `$${match[3]}$`;
    const bodyStart = match.index + match[0].length;
    const bodyEnd = sql.indexOf(tag, bodyStart);
    if (bodyEnd === -1) continue;
    found = {
      body: sql.slice(bodyStart, bodyEnd),
      header: match[2],
      file,
    };
  }
  return found;
}

describe("engineering change classification", () => {
  const migration = chain.find((entry) => entry.file === MIGRATION)?.sql ?? "";
  const classifier = finalFunction("classify_recommendation_change");
  const trigger = finalFunction("enforce_engineering_signature_provenance");

  it("is the last definition of both functions", () => {
    expect(migration.length).toBeGreaterThan(500);
    expect(classifier?.file).toBe(MIGRATION);
    expect(trigger?.file).toBe(MIGRATION);
  });

  it("keeps the provenance trigger invoker and still pins a client class write", () => {
    expect(trigger?.header).not.toMatch(/security\s+definer/i);
    expect(trigger?.body).toMatch(
      /new\.change_class\s*:=\s*old\.change_class/i,
    );
    expect(trigger?.body).toMatch(/record_security_event\s*\(/i);
    expect(trigger?.body).toContain("access_denied");
    expect(trigger?.body).toMatch(
      /old\.status\s+in\s*\(\s*'approved'\s*,\s*'released'\s*,\s*'scheduled'\s*\)/i,
    );
    expect(trigger?.body).toContain("app.engineering_signature_write");
    expect(trigger?.body).toContain("app.engineering_class_write");
    expect(trigger?.body).toMatch(
      /current_user\s+not\s+in\s*\(\s*'authenticated'\s*,\s*'anon'\s*\)/i,
    );
  });

  it("does not let a class pin swallow a signature write in the same statement", () => {
    expect(trigger?.body).toMatch(
      /new\.change_class\s*:=\s*old\.change_class;\s*if\s+not\s+v_changed\s+then\s*return\s+new;/i,
    );
  });

  it("admits only the transaction-local marker set by the classifier", () => {
    expect(classifier?.header).toMatch(/security\s+definer/i);
    expect(classifier?.header).toMatch(/set\s+search_path\s*=\s*public/i);
    expect(classifier?.body).toMatch(
      /set_config\s*\(\s*'app\.engineering_class_write'\s*,\s*'granted'\s*,\s*true\s*\)/,
    );
    expect(classifier?.body).toMatch(
      /set_config\s*\(\s*'app\.engineering_class_write'\s*,\s*''\s*,\s*true\s*\)/,
    );
    expect(classifier?.body).toMatch(
      /update\s+public\.recommendations\s+set\s+change_class\s*=\s*v_class/i,
    );
    expect(classifier?.body).not.toMatch(
      /update\s+public\.recommendations[\s\S]{0,200}engineering_signed_/i,
    );
  });

  it("refuses an AI operator, a missing session, a short basis, and a superseded rule", () => {
    expect(classifier?.body).toMatch(/auth\.uid\(\)\s+is\s+null/i);
    expect(classifier?.body).toContain("app_current_org()");
    expect(classifier?.body).toMatch(/v_role\s*=\s*'ai_admin'/);
    expect(classifier?.body).toMatch(/length\(v_basis\)\s*<\s*20/);
    expect(classifier?.body).toMatch(
      /status\s+is\s+distinct\s+from\s+'superseded'/i,
    );
    expect(classifier?.body).toMatch(/organization_id\s*=\s*v_org/i);
    expect(classifier?.body).not.toMatch(/p_org|p_organization|p_tenant/i);
  });

  it("records the act and does not grant it to anonymous callers", () => {
    expect(classifier?.body).toMatch(/insert\s+into\s+public\.audit_events/i);
    expect(classifier?.body).toContain("engineering_change_classification");
    expect(migration).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.classify_recommendation_change\(uuid,\s*text,\s*text\)\s+from\s+public,\s*anon/i,
    );
    expect(migration).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.classify_recommendation_change\(uuid,\s*text,\s*text\)\s+to\s+authenticated/i,
    );
    expect(migration).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.classify_recommendation_change[\s\S]{0,80}to\s+anon/i,
    );
  });

  it("is called from the mission-control service, not only from this test", () => {
    const service = readFileSync(
      "src/services/operatingLoopService.ts",
      "utf8",
    );
    const page = readFileSync("src/pages/MissionControl.tsx", "utf8");
    expect(service).toContain('"classify_recommendation_change"');
    expect(service).toContain(
      "export async function classifyEngineeringChange",
    );
    expect(page).toContain("classifyEngineeringChange");
    expect(page).not.toContain(".update({ change_class");
  });
});
