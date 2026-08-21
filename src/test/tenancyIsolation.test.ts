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
  isRestrictive,
  migrationFiles,
  type ResolvedPolicy,
  resolveChainPolicies,
  stripComments,
  usingOf,
  withCheckOf,
} from "./support/migrationPolicies";

const MIGRATION_PATH =
  "supabase/migrations/20260917000000_tenancy_isolation.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8");
const executable = stripComments(migration);

/**
 * The resolver refuses to guess: an `execute format(...)` argument it cannot
 * evaluate raises rather than being skipped, because silently dropping a
 * statement would make the chain look cleaner than it is. That is right, but
 * raising at module scope takes the whole file down with one cryptic error —
 * including the assertions that would have named the actual mistake. So the
 * failure is captured and reported as its own test, and the text-only guards
 * below ("retires legacy names literally") still run and still point at the
 * real problem. Reintroducing the wildcard sweep this file exists to prevent
 * now fails with that message rather than with `cannot evaluate format()`.
 */
let chainError: Error | null = null;
let chain = new Map<string, ResolvedPolicy>();
try {
  chain = resolveChainPolicies();
} catch (error) {
  chainError = error as Error;
}
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

describe("the chain resolved", () => {
  it("every execute in every do-block was understood", () => {
    // If this fails, nothing below it means anything: an unresolved statement
    // is a policy the resolver could not see, and the absence assertions would
    // pass vacuously. Reported separately so the cause is named rather than
    // arriving as an unhandled error before any test runs.
    expect(chainError?.message ?? null).toBeNull();
    expect(surviving.length).toBeGreaterThan(200);
  });
});

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
      // Restrictive policies are excluded: they grant nothing, so an always-true
      // arm in one cannot widen access. `using (true) with check (<denial>)` is
      // the deliberate shape for a restrictive UPDATE gate — 20260912123000's
      // header explains why a restrictive USING must not filter — and it is
      // asserted on its own terms two tests below.
      .filter((p) => !isRestrictive(p.text))
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
      const granted = policiesOn(table)
        .filter((p) => grantsAuthenticated(p.text))
        .filter((p) => !isRestrictive(p.text));
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
    "%s: every restrictive policy denies, and none of them filters an UPDATE",
    (table) => {
      // The two properties a restrictive gate must have. It must not be the
      // only thing standing between a caller and a row (it ANDs, it does not
      // grant), and on UPDATE its denial must live in WITH CHECK: a restrictive
      // USING denies by filtering to zero rows with no error, and a client that
      // reads "0 rows updated" as success turns a refusal into a green tick.
      for (const p of policiesOn(table).filter((x) => isRestrictive(x.text))) {
        const command = commandOf(p.text);
        const check = withCheckOf(p.text);
        const using = usingOf(p.text);
        if (command === "update") {
          expect(
            check,
            `${table}.${p.policy} restrictive UPDATE has no WITH CHECK`,
          ).not.toBeNull();
          expect((check as string).trim().toLowerCase()).not.toBe("true");
          expect((using ?? "true").trim().toLowerCase()).toBe("true");
        }
        // Whatever the command, the predicate must actually deny something.
        const predicate = (check ?? using ?? "").trim().toLowerCase();
        expect(predicate, `${table}.${p.policy} denies nothing`).not.toBe("");
        expect(predicate).not.toBe("true");
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
        .filter((p) => !isRestrictive(p.text))
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
        (p) => commandOf(p.text) === "update" && !isRestrictive(p.text),
      );
      expect(update, `${table} has no UPDATE policy`).toBeDefined();
      expect(withCheckOf((update as { text: string }).text)).toMatch(
        /organization_id = app_current_org\(\)/,
      );
    }
  });

  it("creating a deployment still works, and only into your own org", () => {
    // The GRANT surface, so restrictive denials are excluded — they add no
    // command a caller can reach, and counting them here would report the
    // external-role gate as new access.
    const commands = policiesOn("deployment_instances")
      .filter((p) => grantsAuthenticated(p.text))
      .filter((p) => !isRestrictive(p.text))
      .map((p) => commandOf(p.text))
      .sort();
    expect(commands).toEqual(["insert", "select"]);
    const insert = policiesOn("deployment_instances").find(
      (p) => commandOf(p.text) === "insert" && !isRestrictive(p.text),
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
      const granted = policiesOn(table)
        .filter((p) => grantsAuthenticated(p.text))
        .filter((p) => !isRestrictive(p.text));
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

  it("a connector run cannot be labelled with another tenant", () => {
    // The parent-only WITH CHECK let a tenant insert a run under its own
    // connector while stamping it with a rival's organization_id. Not a
    // disclosure — the rival's USING resolves through a connector they do not
    // own — but seven server paths filter runs on that column, so the run
    // becomes invisible to finish_connector_run and never completes.
    const runs = policiesOn("connector_runs")
      .filter((p) => grantsAuthenticated(p.text))
      .filter((p) => !isRestrictive(p.text));
    expect(runs.length).toBeGreaterThan(0);
    for (const p of runs) {
      const check = withCheckOf(p.text);
      if (check === null) continue;
      // The column must be the ROW's own, unqualified. `c.organization_id =
      // app_current_org()` inside the EXISTS is the parent's, and an
      // unanchored match accepts the parent-only form this test exists to
      // reject — which it did, until the mutation check caught it.
      expect(check, `${p.policy} does not constrain the row's own org`).toMatch(
        /(?<![\w.])organization_id\s*=\s*app_current_org\(\)/,
      );
      expect(toleratesNullOrg(check)).toBe(false);
    }
  });

  it("mutation-sanity — that assertion rejects the parent-only form", () => {
    const parentOnly =
      "exists (select 1 from connectors c where c.id = connector_id " +
      "and c.organization_id = app_current_org())";
    const own = `${parentOnly} and organization_id = app_current_org()`;
    const ownOnly = /(?<![\w.])organization_id\s*=\s*app_current_org\(\)/;
    expect(ownOnly.test(parentOnly)).toBe(false);
    expect(ownOnly.test(own)).toBe(true);
  });

  it("...but its READ predicate is unchanged, so no row disappears", () => {
    // Narrowing USING would change which runs a tenant can see. That is a
    // different decision from closing a write channel and is not made here.
    const runs = policiesOn("connector_runs")
      .filter((p) => grantsAuthenticated(p.text))
      .filter((p) => !isRestrictive(p.text));
    for (const p of runs) {
      const using = usingOf(p.text);
      if (using === null) continue;
      expect(normalise(using)).toBe(
        normalise(
          "exists (select 1 from connectors c where c.id = connector_id and c.organization_id = app_current_org())",
        ),
      );
    }
  });

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

  it("migration 23 still owns the GRANT on those tables in the resolved chain", () => {
    // Ownership of the grant, not of every policy on the table. A restrictive
    // denial layered on later (the external-role write gate, 20260920002000)
    // cannot widen anything and does not take the table over — what would be a
    // regression is a later file re-granting access, which is what this checks.
    for (const table of BUCKET_D) {
      const owners = policiesOn(table)
        .filter((p) => !isRestrictive(p.text))
        .map((p) => p.source);
      expect(owners.length).toBeGreaterThan(0);
      for (const owner of owners) {
        expect(owner).toBe("00000000000023_enforce_approval_authority.sql");
      }
    }
  });

  it("...and the only later policies on them are restrictive denials", () => {
    for (const table of BUCKET_D) {
      const later = policiesOn(table).filter(
        (p) => p.source !== "00000000000023_enforce_approval_authority.sql",
      );
      for (const p of later) {
        expect(
          isRestrictive(p.text),
          `${table}.${p.policy} from ${p.source} is a later PERMISSIVE policy`,
        ).toBe(true);
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
