/**
 * Tenant isolation, asserted against the EFFECTIVE final state of the whole
 * migration chain — not against any one file.
 *
 * WHY THE WHOLE CHAIN. `system_alerts` is policed by migration 2, then 5, then
 * 20260917000000; `production_lines` by 3, then 5, then 20260917000000. A test
 * that reads only the newest file would have passed throughout the period the
 * leak existed. Worse, the leak was generated inside a `format()` loop, so a
 * grep for `create policy` never saw it either. `resolveChainPolicies` replays
 * every create and drop in filename order — including the loops — and reports
 * what is left standing. It is validated against a live Postgres carrying the
 * full chain: the set it resolves matches `pg_policies` exactly, 272 for 272.
 *
 * WHAT WENT WRONG. Sixteen tables from migration 2's `org_scoped` loop, plus
 * production_lines from migration 5, carried
 *
 *     for all to authenticated
 *     using      (organization_id is null or organization_id = app_current_org())
 *     with check (organization_id is null or organization_id = app_current_org())
 *
 * The disjunct in the WITH CHECK made it a write channel: `update t set
 * organization_id = null` published a tenant's rows to every other tenant in
 * one statement. `for all` also handed every user UPDATE and DELETE on
 * audit_events.
 *
 * The guards below are mutation-checked — each predicate that accepts the
 * shipped policy is also shown to REJECT the weakened form it exists to catch.
 *
 * THE OTHER DIRECTION. Tightening RLS can empty a product as surely as leaking
 * data can expose one, and a table with RLS enabled and no policy denies
 * everything. An early draft of 20260917000000 retired the legacy policies with
 * `drop policy ... where policyname like '%_org_rw'`, which also matched the 29
 * correct policies migration 1 gives sites, assets, work_orders and the rest —
 * measured on a throwaway Postgres, it stripped 31 tables and would have blanked
 * every screen. `keeps every migration-1 org policy standing` and
 * `retires legacy names literally` are the regression tests for that.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  grantsAuthenticated,
  migrationFiles,
  resolveChainPolicies,
  stripComments,
  usingOf,
  withCheckOf,
} from "./support/migrationPolicies";

const MIGRATION_PATH =
  "supabase/migrations/20260917000000_tenancy_isolation.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8");
const executable = stripComments(migration);

const chain = resolveChainPolicies();
const surviving = [...chain.values()];

/** Every candidate DDL text of every policy left standing by the chain. */
const survivingStatements = surviving.flatMap((p) =>
  p.statements.map((text) => ({ ...p, text })),
);

const normalise = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

/** The seventeen tables this migration tightens. */
const BUCKET_A_READ_ONLY = [
  "asset_classes",
  "asset_locations",
  "connectors",
  "oee_measurements",
  "oee_loss_events",
  "kpi_measurements",
  "maintenance_metrics",
  "asset_health_monitoring",
  "asset_snapshots",
  "backlog_snapshots",
  "audit_events",
  "billing_subscriptions",
  "production_lines",
];
const BUCKET_A_READ_UPDATE = ["system_alerts", "notifications"];
const BUCKET_A_READ_INSERT = ["deployment_instances"];
const BUCKET_A = [
  ...BUCKET_A_READ_ONLY,
  ...BUCKET_A_READ_UPDATE,
  ...BUCKET_A_READ_INSERT,
];

/** Platform-internal tables that must not be readable by any tenant. */
const PLATFORM_INTERNAL = [
  "tenants",
  "tenant_settings",
  "trace_snapshots",
  "sir_agents",
  "sir_events",
  "sir_queue",
];

/** Child / user-scoped tables re-asserted from migration 5's idiom. */
const BUCKET_C = [
  "connector_runs",
  "work_order_tasks",
  "work_order_status_history",
  "billing_invoices",
  "user_kpi_dashboard",
  "user_preferences",
];

/** Bucket D — owned by 00000000000023, must not be re-policied here. */
const BUCKET_D = [
  "autonomous_decisions",
  "autonomous_actions",
  "approval_workflows",
];

/**
 * The one table that legitimately mixes global and tenant rows. It keeps the
 * null disjunct, and that is correct BECAUSE it is read-only: `for select`
 * with no WITH CHECK cannot be used to publish a row.
 */
const SHARED_READ_EXCEPTION = "reliability_kb_chunks";

/** True when a predicate tolerates a null organization_id. */
function toleratesNullOrg(predicate: string): boolean {
  return /organization_id\s+is\s+null/i.test(predicate);
}

const policiesOn = (table: string) =>
  survivingStatements.filter((p) => p.table === table);

/** The command a create-policy statement applies to. */
function commandOf(statement: string): string {
  const m = /\bfor\s+(all|select|insert|update|delete)\b/i.exec(statement);
  return (m ? m[1] : "all").toLowerCase();
}

// ---------------------------------------------------------------------------

describe("the null-organization escape hatch is gone from the whole chain", () => {
  it("no surviving policy tolerates a null organization_id in a WITH CHECK", () => {
    const offenders = survivingStatements
      .filter((p) => {
        const check = withCheckOf(p.text);
        return check !== null && toleratesNullOrg(check);
      })
      .map((p) => `${p.table}.${p.policy} (${p.source})`);
    expect(offenders).toEqual([]);
  });

  it("the only surviving null-org READ is the read-only shared KB", () => {
    const readers = survivingStatements
      .filter((p) => {
        const using = usingOf(p.text);
        return using !== null && toleratesNullOrg(using);
      })
      .map((p) => p.table);
    expect([...new Set(readers)]).toEqual([SHARED_READ_EXCEPTION]);
  });

  it("...and that exception cannot be used to publish a row", () => {
    const kb = policiesOn(SHARED_READ_EXCEPTION).filter((p) =>
      toleratesNullOrg(usingOf(p.text) ?? ""),
    );
    expect(kb).toHaveLength(1);
    expect(commandOf(kb[0].text)).toBe("select");
    expect(withCheckOf(kb[0].text)).toBeNull();
  });

  it("mutation-sanity — the guard rejects the policy shape that leaked", () => {
    const leaked =
      "create policy t_org_rw on t for all to authenticated " +
      "using (organization_id is null or organization_id = app_current_org()) " +
      "with check (organization_id is null or organization_id = app_current_org())";
    expect(toleratesNullOrg(withCheckOf(leaked) as string)).toBe(true);

    const fixed =
      "create policy t_org_read on t for select to authenticated " +
      "using (organization_id = app_current_org())";
    expect(withCheckOf(fixed)).toBeNull();
    expect(toleratesNullOrg(usingOf(fixed) as string)).toBe(false);
  });
});

describe("the tightened tables are scoped, and scoped to app_current_org()", () => {
  it.each(BUCKET_A)("%s carries no always-true policy", (table) => {
    const alwaysTrue = policiesOn(table)
      .filter((p) => grantsAuthenticated(p.text))
      .filter((p) => {
        const using = usingOf(p.text);
        const check = withCheckOf(p.text);
        return (
          (using !== null && using.trim().toLowerCase() === "true") ||
          (check !== null && check.trim().toLowerCase() === "true")
        );
      });
    expect(alwaysTrue).toEqual([]);
  });

  it.each(BUCKET_A)(
    "%s names app_current_org() in every predicate",
    (table) => {
      const granted = policiesOn(table).filter((p) =>
        grantsAuthenticated(p.text),
      );
      expect(granted.length).toBeGreaterThan(0);
      for (const p of granted) {
        for (const predicate of [usingOf(p.text), withCheckOf(p.text)]) {
          if (predicate === null) continue;
          expect(
            predicate,
            `${table}.${p.policy} predicate is unscoped`,
          ).toMatch(/app_current_org\(\)/);
        }
      }
    },
  );

  it.each(BUCKET_A)(
    "%s no longer carries the legacy _org_rw policy",
    (table) => {
      expect(chain.has(`${table}.${table}_org_rw`)).toBe(false);
    },
  );

  it("read-only tables grant authenticated nothing but SELECT", () => {
    for (const table of BUCKET_A_READ_ONLY) {
      const commands = policiesOn(table)
        .filter((p) => grantsAuthenticated(p.text))
        .map((p) => commandOf(p.text))
        .sort();
      expect(commands, `${table}`).toEqual(["select"]);
    }
  });

  it("audit_events is append-only from the client — no UPDATE, no DELETE", () => {
    // An audit log a user can rewrite is not an audit log. `for all` used to
    // grant exactly that within the caller's own organization.
    const commands = policiesOn("audit_events")
      .filter((p) => grantsAuthenticated(p.text))
      .map((p) => commandOf(p.text));
    expect(commands).toEqual(["select"]);
    expect(commands).not.toContain("all");
  });

  it("acknowledge/resolve and mark-read still have their UPDATE", () => {
    for (const table of BUCKET_A_READ_UPDATE) {
      const commands = policiesOn(table)
        .filter((p) => grantsAuthenticated(p.text))
        .map((p) => commandOf(p.text))
        .sort();
      expect(commands, `${table}`).toEqual(["select", "update"]);
    }
  });

  it("an UPDATE cannot move a row out of its tenant", () => {
    // The WITH CHECK must repeat the org predicate; without it,
    // `set organization_id = null` was a one-statement tenant export.
    for (const table of BUCKET_A_READ_UPDATE) {
      const update = policiesOn(table).find(
        (p) => commandOf(p.text) === "update",
      );
      expect(update, `${table} has no UPDATE policy`).toBeDefined();
      expect(withCheckOf((update as { text: string }).text)).toMatch(
        /organization_id = app_current_org\(\)/,
      );
    }
  });

  it("creating a deployment still works, and only into your own org", () => {
    const commands = policiesOn("deployment_instances")
      .filter((p) => grantsAuthenticated(p.text))
      .map((p) => commandOf(p.text))
      .sort();
    expect(commands).toEqual(["insert", "select"]);
    const insert = policiesOn("deployment_instances").find(
      (p) => commandOf(p.text) === "insert",
    );
    expect(withCheckOf((insert as { text: string }).text)).toMatch(
      /organization_id = app_current_org\(\)/,
    );
  });
});

describe("platform-internal tables are not tenant-readable", () => {
  it.each(PLATFORM_INTERNAL)("%s grants authenticated nothing", (table) => {
    const granted = policiesOn(table).filter((p) =>
      grantsAuthenticated(p.text),
    );
    expect(granted.map((p) => p.policy)).toEqual([]);
  });

  it("the customer list in particular is not enumerable by tenants", () => {
    // `tenants` is (id, name): every customer could read every other
    // customer's name through tenants_read's `using (true)`.
    expect(chain.has("tenants.tenants_read")).toBe(false);
    expect(chain.has("tenants.tenants_authed_rw")).toBe(false);
  });
});

describe("child and user-scoped tables keep migration 5's idiom", () => {
  it.each(BUCKET_C)(
    "%s survives the chain, applied any number of times",
    (table) => {
      const granted = policiesOn(table).filter((p) =>
        grantsAuthenticated(p.text),
      );
      expect(granted.length).toBeGreaterThan(0);
      for (const p of granted) {
        const predicates = [usingOf(p.text), withCheckOf(p.text)].filter(
          (x): x is string => x !== null,
        );
        expect(predicates.length).toBeGreaterThan(0);
        for (const predicate of predicates) {
          expect(predicate, `${table}.${p.policy}`).toMatch(
            /app_current_org\(\)|auth\.uid\(\)/,
          );
          expect(predicate.trim().toLowerCase()).not.toBe("true");
        }
      }
    },
  );

  it("no `_authed_rw` policy survives anywhere in the chain", () => {
    // Migration 2 re-creates these unconditionally. Before the drop guards
    // were added to migrations 5 and 19, a replayed chain left six of them
    // standing beside the tightened policy — and permissive policies OR
    // together, so the tightened one became decorative. Asserting their
    // ABSENCE is the property; asserting the tightened ones are present is not
    // enough, and was exactly the gap.
    const residue = surviving
      .filter((p) => p.policy.endsWith("_authed_rw"))
      .map((p) => `${p.table}.${p.policy}`);
    expect(residue).toEqual([]);
  });
});

describe("the approval path is left to migration 23", () => {
  it.each(BUCKET_D)("%s is not re-policied by this migration", (table) => {
    const statements = normalise(executable);
    expect(statements).not.toMatch(
      new RegExp(`create\\s+policy\\s+\\S*\\s+on\\s+(public\\.)?${table}\\b`),
    );
  });

  it("migration 23 still owns those policies in the resolved chain", () => {
    for (const table of BUCKET_D) {
      const owners = policiesOn(table).map((p) => p.source);
      expect(owners.length).toBeGreaterThan(0);
      for (const owner of owners) {
        expect(owner).toBe("00000000000023_enforce_approval_authority.sql");
      }
    }
  });
});

describe("the fix cannot blank the product", () => {
  it("keeps every migration-1 org policy standing", () => {
    // Read the array out of migration 1 so the list cannot drift from reality.
    const baseline = readFileSync(
      "supabase/migrations/00000000000001_operating_loop_baseline.sql",
      "utf8",
    );
    const arrayText =
      /org_scoped\s+text\[\]\s*:=\s*array\s*\[([\s\S]*?)\]/i.exec(baseline);
    expect(arrayText, "migration 1 org_scoped array not found").not.toBeNull();
    const tables = [
      ...(arrayText as RegExpExecArray)[1].matchAll(/'([^']*)'/g),
    ].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(20);

    const stripped = tables.filter(
      (t) =>
        policiesOn(t).filter((p) => grantsAuthenticated(p.text)).length === 0,
    );
    expect(stripped).toEqual([]);
  });

  it("retires legacy names literally, never by matching pg_policies", () => {
    // A pattern sweep on `%_org_rw` also matches migration 1's 29 correct
    // policies. RLS stays enabled when the policy goes, so those tables would
    // deny every read and the app would go blank for signed-in users.
    expect(executable).not.toMatch(/pg_policies/i);
    expect(normalise(executable)).not.toMatch(/policyname\s+like/);
  });

  it("every table it re-policies is named as a literal, not derived", () => {
    // Each drop must be against a table this migration also lists; nothing is
    // discovered from the catalog at runtime.
    expect(executable).not.toMatch(/information_schema/i);
    expect(executable).not.toMatch(/pg_class/i);
  });

  it("leaves the shared reference tables alone", () => {
    for (const table of [
      "deployment_templates",
      "kpi_definitions",
      "kpis_kois",
      "asset_twin_templates",
      "oem_model_catalogue",
      "standards_register",
    ]) {
      const readable = policiesOn(table).filter(
        (p) => grantsAuthenticated(p.text) && commandOf(p.text) === "select",
      );
      expect(readable.length, `${table} lost its read policy`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("the chain can be applied more than once", () => {
  it("every create policy in the chain is preceded by a drop guard", () => {
    // 00000000000002 re-creates every `_authed_rw` on replay. If a later
    // migration aborts partway through, the wide policy is restored and the
    // tightened one is ORed away. Two files used to abort exactly that way:
    // 00000000000005:38 (guard named the wrong policy) and
    // 00000000000019:60 (no guard at all).
    const unguarded: string[] = [];
    for (const file of migrationFiles()) {
      const sql = stripComments(
        readFileSync(`supabase/migrations/${file}`, "utf8"),
      );
      const dropped = new Set(
        [
          ...sql.matchAll(
            /drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|[\w]+)/gi,
          ),
        ].map((m) => m[1].replace(/"/g, "").toLowerCase()),
      );
      // Literal creates.
      for (const m of sql.matchAll(/create\s+policy\s+("[^"]+"|[\w]+)/gi)) {
        const name = m[1].replace(/"/g, "").toLowerCase();
        if (!dropped.has(name)) unguarded.push(`${file}: ${name}`);
      }
      // Loop-generated creates: `create policy %I` fed by `t || '_suffix'`.
      for (const m of sql.matchAll(
        /create\s+policy\s+%I[^']*',\s*t\s*\|\|\s*'([^']*)'/gi,
      )) {
        const suffix = m[1].toLowerCase();
        const guarded = [...dropped].some((d) => d.endsWith(suffix));
        const loopGuard = /drop\s+policy\s+if\s+exists\s+%I/i.test(sql);
        if (!guarded && !loopGuard) unguarded.push(`${file}: %I${suffix}`);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("this migration guards every policy it creates", () => {
    const dropped = new Set(
      [...executable.matchAll(/drop\s+policy\s+if\s+exists\s+([\w]+)/gi)].map(
        (m) => m[1].toLowerCase(),
      ),
    );
    const created = [...executable.matchAll(/create\s+policy\s+([\w]+)/gi)].map(
      (m) => m[1].toLowerCase(),
    );
    expect(created.length).toBeGreaterThan(0);
    expect(created.filter((name) => !dropped.has(name))).toEqual([]);
  });
});
