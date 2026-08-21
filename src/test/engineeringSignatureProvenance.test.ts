/**
 * The engineering signature may only be written by the function that checks
 * the signer (register E4.06).
 *
 * WHY THIS EXISTS. 20260809140000 built the control correctly — a required
 * discipline per change class, an RPC that verifies the caller holds it and
 * demands a written basis, a trigger that refuses approval while the signature
 * is null — and then stored the signature in three ordinary columns on
 * `recommendations`, a table carrying `for all to authenticated` since
 * 00000000000001:488. Any role outside the two that 20260912123000 narrowed
 * could satisfy the whole control with a single PATCH setting
 * engineering_signed_by to its own uid. `sign_engineering_review` had zero
 * callers, so the forged path was not an alternative to the real one — it was
 * the only one.
 *
 * These assertions are about the SHAPE of the guard, because the shape is
 * where it silently dies:
 *
 *   * a SECURITY DEFINER trigger reports its own owner as current_user
 *     whoever fired it, which turns the client-role check into a tautology
 *     while still reading like a check;
 *   * a marker set without `is_local` survives into the next statement on a
 *     pooled connection, so one legitimate signature would arm the next
 *     request on that connection to forge one;
 *   * any other migration that writes these columns directly re-opens the
 *     hole from inside the schema, where no policy is looking.
 *
 * The behaviour itself was verified against a real Postgres 16: a technician's
 * direct UPDATE refused, the same technician refused by the RPC for want of
 * the discipline, a reliability engineer's direct UPDATE refused, the RPC
 * accepted for that engineer with a basis recorded, and the signature cleared
 * when the change class moves underneath it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIGRATIONS_DIR,
  migrationFiles,
  stripComments,
} from "./support/migrationPolicies";

const SIGNATURE_COLUMNS = [
  "engineering_signed_by",
  "engineering_signed_at",
  "engineering_note",
];

const GUARD = "20260921001000_engineering_signature_definer_only.sql";
/** The repair that closed four defects in GUARD; holds the live definitions. */
const REPAIR = "20260921003000_signature_and_contract_gate_repair.sql";

const chain = migrationFiles().map((file) => ({
  file,
  sql: stripComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
}));

const text = (file: string) =>
  chain.find((c) => c.file === file)?.sql ??
  (() => {
    throw new Error(`${file} is missing`);
  })();

/** The last definition of a function in filename order — what the DB has. */
function finalFunction(name: string): { body: string; file: string } | null {
  let found: { body: string; file: string } | null = null;
  for (const { file, sql } of chain) {
    const at = sql.search(
      new RegExp(
        `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name}\\s*\\(`,
        "i",
      ),
    );
    if (at === -1) continue;
    const end = sql.indexOf("\n$$;", at);
    if (end === -1) continue;
    found = { body: sql.slice(at, end + 4), file };
  }
  return found;
}

describe("engineering signature provenance", () => {
  const trigger = finalFunction("enforce_engineering_signature_provenance");
  const rpc = finalFunction("sign_engineering_review");

  it("guards the signature with a trigger on insert AND update", () => {
    // Update alone would let a pre-signed row be inserted.
    expect(text(REPAIR)).toMatch(
      /create\s+trigger\s+trg_engineering_signature_provenance[\s\S]{0,200}before\s+insert\s+or\s+update\s+on\s+public\.recommendations/i,
    );
    expect(trigger?.body).toBeDefined();
  });

  it("keeps the trigger SECURITY INVOKER", () => {
    // The single most important line in the guard. A DEFINER trigger would
    // report its owner as current_user no matter who fired it, so the
    // client-role check below would pass for a forging client — and would
    // still read, in review, exactly like a working check.
    expect(trigger?.body).not.toMatch(/security\s+definer/i);
  });

  it("requires BOTH the marker and a non-client current_user", () => {
    expect(trigger?.body).toContain("app.engineering_signature_write");
    expect(trigger?.body).toMatch(
      /current_user\s+in\s*\(\s*'authenticated'\s*,\s*'anon'\s*\)/i,
    );
    // Refusal, not a silent no-op: a filtered update reports success.
    expect(trigger?.body).toMatch(/raise\s+exception/i);
    expect(trigger?.body).toMatch(/insufficient_privilege/);
  });

  it("watches every signature column, not just the uid", () => {
    for (const column of SIGNATURE_COLUMNS) {
      expect(trigger?.body, `${column} unguarded`).toContain(column);
    }
  });

  it("clears the signature when the change class moves under it", () => {
    // The discipline check was answered about the OLD class.
    expect(trigger?.body).toMatch(
      /new\.change_class\s+is\s+distinct\s+from\s+old\.change_class/i,
    );
  });

  it("sets the marker transaction-locally, so it cannot arm the next request", () => {
    // set_config(..., false) would persist for the session, and PostgREST
    // pools connections: one honest signature would leave the next request on
    // that connection able to write a signature directly.
    expect(rpc?.file).toBe(REPAIR);
    expect(rpc?.body).toMatch(
      /set_config\s*\(\s*'app\.engineering_signature_write'\s*,\s*'granted'\s*,\s*true\s*\)/,
    );
    expect(rpc?.body).toMatch(
      /set_config\s*\(\s*'app\.engineering_signature_write'\s*,\s*''\s*,\s*true\s*\)/,
    );
  });

  it("still checks the discipline and demands a written basis", () => {
    // Closing the forgery is worthless if the sanctioned path stopped
    // checking anything on the way past.
    expect(rpc?.body).toMatch(
      /coalesce\(v_role,\s*''\)\s+is\s+distinct\s+from\s+e\.required_role/i,
    );
    expect(rpc?.body).toMatch(/length\(trim\(p_note\)\).{0,10}<\s*20/);
    expect(rpc?.body).toMatch(/security\s+definer/i);
  });

  /**
   * The four defects an adversarial review found in GUARD, each reproduced
   * against a real PostgreSQL 16 and each pinned here. Three of the four were
   * reachable by any authenticated member of the organisation.
   */
  it("does not let a NULL role sign as an engineer", () => {
    // `v_role not in ('admin','ai_admin')` is NULL when v_role is NULL, so
    // `TRUE and NULL` → NULL, the branch never fired, and an account with no
    // role at all was handed the signature. user_profiles.role is nullable
    // with no CHECK. Same three-valued-logic class definerTenancy.test.ts
    // already documents.
    expect(rpc?.file).toBe(REPAIR);
    expect(rpc?.body).toMatch(
      /coalesce\(v_role,\s*''\)\s+not\s+in\s*\(\s*'admin'\s*,\s*'ai_admin'\s*\)/i,
    );
    expect(
      rpc?.body,
      "a bare `v_role not in (...)` is NULL-permissive",
    ).not.toMatch(/[^)]\bv_role\s+not\s+in\s*\(/i);
  });

  it("refuses to overwrite a signature, and records the one it writes", () => {
    // The RPC never asked whether the row was already signed. MissionControl
    // only renders the form when it is not; PostgREST does not care, and the
    // function is granted to `authenticated`.
    expect(rpc?.body).toMatch(/r\.engineering_signed_at\s+is\s+not\s+null/i);
    expect(rpc?.body).toMatch(/not overwritable/i);
    // Signing is an act of authority; it leaves a record either way.
    expect(rpc?.body).toContain("security_events");
  });

  it("will not let a reclassification leave an approval standing", () => {
    // sign → approve → reclassify used to clear the signature and return
    // before any re-validation. enforce_authority_limit is BEFORE UPDATE OF
    // STATUS, so nothing re-fired, and the result was an approved
    // recommendation with no engineering signature — a state the schema
    // previously could not represent.
    expect(trigger?.body).toMatch(
      /old\.status\s+in\s*\(\s*'approved'\s*,\s*'released'\s*,\s*'scheduled'\s*\)/i,
    );
    expect(trigger?.body).toMatch(/raise\s+exception/i);
  });

  it("pins change_class, so the gate is not an off switch its subject holds", () => {
    // enforce_authority_limit skips the engineering check entirely when
    // change_class is null (20260809140000), and change_class sat under the
    // same `for all to authenticated` policy the signature columns did. So
    // E4.06 was not a gate a technician had to pass; it was a flag a
    // technician could clear. Verified on Postgres 16: pre-repair, a
    // technician cleared the class and approved an unsigned engineering
    // change; post-repair the class is pinned and the approval is refused.
    expect(trigger?.body).toMatch(/new\.change_class\s*:=\s*old\.change_class/i);
    // Recorded, then neutralised — the 20260910090000 idiom. A `raise` here
    // would abort the transaction and discard the audit row with it, and the
    // insert must go through the DEFINER recorder because this trigger is
    // INVOKER and security_events' own RLS refuses `authenticated`.
    expect(trigger?.body).toMatch(/record_security_event\s*\(/i);
    expect(trigger?.body).toContain("access_denied");
  });

  it("audits the service path it deliberately admits", () => {
    // GUARD refused postgres and service_role too. That reads stricter and is
    // not: a service-key holder can disable the trigger in the same breath, so
    // it bought nothing and guaranteed that any restore or future migration
    // touching these columns aborts, with no way to correct a bad signature.
    // The exemption is this schema's established idiom, and it is logged.
    expect(trigger?.body).toMatch(/auth\.uid\(\)\s+is\s+not\s+null/i);
    expect(trigger?.body).toMatch(/service caller|service \(/i);
  });

  it("is the only thing in the chain that writes a signature column", () => {
    // A second writer inside the schema re-opens the hole where no policy is
    // looking. The trigger's own assignments and the RPC's update are the
    // sanctioned two.
    const offenders: string[] = [];
    for (const { file, sql } of chain) {
      if (file === GUARD || file === REPAIR) continue;
      for (const column of SIGNATURE_COLUMNS) {
        const writes = new RegExp(`(?:set|,)\\s*${column}\\s*=(?!=)`, "i").test(
          sql,
        );
        if (writes) offenders.push(`${file} writes ${column}`);
      }
    }
    // 20260809140000 defines the original RPC, which 20260921001000 and then
    // 20260921003000 replace; its text is still in the chain, superseded.
    expect(offenders.filter((o) => !o.startsWith("20260809140000_"))).toEqual(
      [],
    );
  });
});
