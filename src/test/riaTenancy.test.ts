/**
 * Tenant isolation for the assessment workspace, asserted against the
 * EFFECTIVE final state of the whole migration chain.
 *
 * WHY THE CHAIN AND NOT THE FILE. 20260920000000 REPLACES two policies
 * 20260918100000 created (`ria_data_sources_org_insert` and the two storage
 * policies). A test that read only the newest file would pass while an older
 * migration's looser version was the one actually standing, and a test that
 * read only the older file would report a leak that has since been closed.
 * `resolveChainPolicies` replays every create and drop in filename order and
 * reports what survives — the same resolver 20260917000000's guards use, which
 * is validated against a live Postgres carrying the full chain.
 *
 * THE TWO-ORG PROPERTY. Nine assessment tables plus three data-room tables
 * plus the evidence join table hold one customer's maintenance history, their
 * failure analysis and the commercial terms of their engagement. The property
 * asserted here is the one that makes a second tenant impossible to reach:
 * every surviving policy is scoped to `app_current_org()`, none tolerates a
 * null organization, none is `using (true)`, and no table is left with RLS
 * enabled and a write policy nobody gated.
 *
 * Each guard is mutation-checked against the shape it exists to refuse.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  grantsAuthenticated,
  isRestrictive,
  resolveChainPolicies,
  stripComments,
  usingOf,
  withCheckOf,
} from "./support/migrationPolicies";

/** Every assessment-workspace table that holds one customer's engagement. */
const RIA_TABLES = [
  "ria_assessments",
  "ria_data_sources",
  "ria_baseline_metrics",
  "ria_criticality_items",
  "ria_findings",
  "ria_finding_evidence",
  "ria_opportunities",
  "ria_decisions",
  "ria_actions",
  "ria_verifications",
  "ria_dataset_slots",
  "ria_clarifications",
  "ria_asset_aliases",
];

let chainError: Error | null = null;
let chain = new Map<
  string,
  ReturnType<typeof resolveChainPolicies> extends Map<string, infer V>
    ? V
    : never
>();
try {
  chain = resolveChainPolicies();
} catch (error) {
  chainError = error as Error;
}

const surviving = [...chain.values()].filter((p) =>
  RIA_TABLES.includes(p.table),
);
const survivingStatements = surviving.flatMap((p) =>
  p.statements.map((text) => ({ ...p, text })),
);

/**
 * The GRANT surface. Restrictive policies are excluded from every assertion
 * that asks "is this scoped / is this open / does this exist", because a
 * restrictive policy grants nothing: it ANDs into the permissive ones and can
 * only ever narrow. Requiring `app_current_org()` inside a policy whose job is
 * to DENY would be asserting the wrong property, and the way to satisfy it
 * would be to write a tenancy scope into a denial. They get their own
 * assertions instead.
 */
const permissiveStatements = survivingStatements.filter(
  (p) => !isRestrictive(p.text),
);

const normalise = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

const GOVERNING = stripComments(
  readFileSync(
    "supabase/migrations/20260920000000_ria_governing_rules.sql",
    "utf8",
  ),
).toLowerCase();
const DATA_ROOM = stripComments(
  readFileSync("supabase/migrations/20260920001000_ria_data_room.sql", "utf8"),
).toLowerCase();

describe("the chain resolved", () => {
  it("understood every policy statement in the chain", () => {
    expect(chainError?.message ?? null).toBeNull();
  });

  it("finds the assessment surface, and it is not empty", () => {
    // Guards against this whole file passing because RIA_TABLES matched
    // nothing — the failure mode of every list-driven test.
    expect(surviving.length).toBeGreaterThanOrEqual(RIA_TABLES.length);
  });

  it("every assessment table that exists carries at least one policy", () => {
    // RLS enabled with no policy denies everything and blanks the screen; RLS
    // disabled exposes everything. Both are failures, and a table with no
    // surviving policy is one or the other.
    const covered = new Set(surviving.map((p) => p.table));
    const uncovered = RIA_TABLES.filter((t) => !covered.has(t));
    expect(uncovered).toEqual([]);
  });
});

describe("no assessment policy can be entered from another tenant", () => {
  it("every surviving policy scopes on app_current_org()", () => {
    const unscoped = permissiveStatements
      .filter((p) => !normalise(p.text).includes("app_current_org()"))
      .map((p) => `${p.table}.${p.policy} (${p.source})`);
    expect(unscoped).toEqual([]);
  });

  it("none tolerates a null organization_id", () => {
    // The disjunct 20260917000000 spent a migration removing. In a WITH CHECK
    // it is a write channel: `update t set organization_id = null` publishes a
    // tenant's rows to every other tenant in one statement.
    const tolerant = survivingStatements
      .filter((p) => {
        const predicates = [usingOf(p.text), withCheckOf(p.text)]
          .filter((x): x is string => x !== null)
          .map(normalise);
        return predicates.some((x) => /organization_id\s+is\s+null/.test(x));
      })
      .map((p) => `${p.table}.${p.policy} (${p.source})`);
    expect(tolerant).toEqual([]);
  });

  it("none is using (true)", () => {
    const open = permissiveStatements
      .filter((p) => {
        const predicate = usingOf(p.text);
        return predicate !== null && normalise(predicate) === "true";
      })
      .map((p) => `${p.table}.${p.policy} (${p.source})`);
    expect(open).toEqual([]);
  });

  it("the external-role gate is restrictive, and therefore cannot widen anything", () => {
    // 20260920002000 introduces a customer-side identity into an operating
    // tenant. Its write denial must be RESTRICTIVE: a permissive policy with
    // the same predicate would be a new grant to everyone who is not external.
    const gates = survivingStatements.filter((p) =>
      /_ext_no_(ins|upd|del)$/.test(p.policy),
    );
    expect(gates.length).toBeGreaterThan(0);
    for (const p of gates) {
      expect(isRestrictive(p.text), `${p.table}.${p.policy}`).toBe(true);
      const predicate = normalise(withCheckOf(p.text) ?? usingOf(p.text) ?? "");
      expect(predicate).toContain("app_current_role_is_external()");
    }
  });

  it("its UPDATE arm denies in WITH CHECK, never by filtering", () => {
    // 20260912123000's reason, restated: a restrictive USING denies by
    // filtering to zero rows with no error, and a client that reads "0 rows
    // updated" as success turns a refusal into a green tick.
    for (const p of survivingStatements.filter((x) =>
      /_ext_no_upd$/.test(x.policy),
    )) {
      expect(normalise(usingOf(p.text) ?? "true")).toBe("true");
      expect(normalise(withCheckOf(p.text) ?? "")).toContain(
        "not public.app_current_role_is_external()",
      );
    }
  });

  it("mutation-sanity — the guards reject the shapes that leaked", () => {
    const leaked =
      "create policy x on public.ria_findings for all to authenticated using (organization_id is null or organization_id = app_current_org()) with check (organization_id is null or organization_id = app_current_org());";
    const shipped =
      "create policy x on public.ria_findings for select to authenticated using (organization_id = public.app_current_org());";
    const tolerant = (sql: string) =>
      [usingOf(sql), withCheckOf(sql)]
        .filter((x): x is string => x !== null)
        .some((x) => /organization_id\s+is\s+null/.test(normalise(x)));
    expect(tolerant(leaked)).toBe(true);
    expect(tolerant(shipped)).toBe(false);

    const openPolicy =
      "create policy x on public.ria_findings for select using (true);";
    expect(normalise(usingOf(openPolicy) ?? "")).toBe("true");
    expect(normalise(usingOf(shipped) ?? "")).not.toBe("true");
  });
});

describe("writes are governed, not granted", () => {
  it("no assessment table hands authenticated a blanket `for all`", () => {
    // `for all` also hands every user UPDATE and DELETE — which on
    // ria_data_sources would mean deleting the audit stub.
    const blanket = survivingStatements
      .filter(
        (p) => /\bfor\s+all\b/i.test(p.text) && grantsAuthenticated(p.text),
      )
      .map((p) => `${p.table}.${p.policy} (${p.source})`);
    expect(blanket).toEqual([]);
  });

  it("no assessment table has a surviving DELETE policy", () => {
    // The audit stub survives because deletion has no client path at all —
    // and a BEFORE DELETE trigger refuses it even from a service-role script.
    const deletes = permissiveStatements
      .filter((p) => /\bfor\s+delete\b/i.test(p.text))
      .map((p) => `${p.table}.${p.policy} (${p.source})`);
    expect(deletes).toEqual([]);
    expect(GOVERNING).toContain("before delete on public.ria_data_sources");
  });

  it("the one direct insert is the customer's export, and it is role-gated", () => {
    const inserts = permissiveStatements.filter((p) =>
      /\bfor\s+insert\b/i.test(p.text),
    );
    expect(inserts.map((p) => `${p.table}.${p.policy}`)).toEqual([
      "ria_data_sources.ria_data_sources_org_insert",
    ]);
    const predicate = normalise(withCheckOf(inserts[0].text) ?? "");
    expect(predicate).toContain("organization_id = public.app_current_org()");
    // Role gate, and the parent assessment checked against the same org — so
    // a row cannot be parented onto another tenant's engagement.
    expect(predicate).toContain("public.app_can_supply_ria_sources()");
    expect(predicate).toContain("from public.ria_assessments a");
  });

  it("the surviving insert policy is the tightened one, not #231's", () => {
    // The whole reason this file resolves the chain: 20260918100000 created a
    // policy of the same name with no role gate.
    const insert = surviving.find(
      (p) => p.policy === "ria_data_sources_org_insert",
    );
    expect(insert?.source).toBe("20260920000000_ria_governing_rules.sql");
  });

  it("evidence links have no client write path", () => {
    const writes = survivingStatements
      .filter(
        (p) =>
          p.table === "ria_finding_evidence" &&
          !/\bfor\s+select\b/i.test(p.text),
      )
      .map((p) => p.policy);
    expect(writes).toEqual([]);
    // …and the only door checks the role and both parents.
    expect(GOVERNING).toContain(
      "create or replace function public.link_ria_finding_evidence",
    );
  });

  it("the data-room tables are read-only by policy", () => {
    for (const table of [
      "ria_dataset_slots",
      "ria_clarifications",
      "ria_asset_aliases",
    ]) {
      const nonSelect = survivingStatements
        .filter((p) => p.table === table && !/\bfor\s+select\b/i.test(p.text))
        .map((p) => p.policy);
      expect(nonSelect, `${table} has a direct write policy`).toEqual([]);
    }
  });
});

describe("every assessment row is anchored to an organization", () => {
  it("each new table declares organization_id not null against organizations", () => {
    const creates = [
      ...`${GOVERNING}\n${DATA_ROOM}`.matchAll(
        /create table if not exists public\.(ria_\w+)\s*\(([\s\S]*?)\n\);/g,
      ),
    ];
    expect(creates.length).toBeGreaterThan(3);
    for (const [, table, columns] of creates) {
      expect(
        columns.replace(/\s+/g, " "),
        `${table} is not anchored to an organization`,
      ).toContain(
        "organization_id uuid not null references public.organizations(id)",
      );
    }
  });

  it("the evidence link's organization is verified against BOTH parents", () => {
    // A not-null FK proves the column points at SOME organization. It does not
    // prove it points at the same one as the finding and the source, which is
    // the property that stops a definer function stitching two tenants
    // together. That is a trigger.
    expect(GOVERNING).toContain("create trigger trg_ria_evidence_tenancy");
    expect(GOVERNING).toContain(
      "before insert or update on public.ria_finding_evidence",
    );
    expect(GOVERNING).toContain("crosses a tenant boundary");
  });

  it("no assessment RPC lets a signed-in caller name another tenant", () => {
    // definerTenancy.test.ts pins the whole-chain surface to three legacy
    // functions. This is the local statement of the same property, so a
    // regression is attributed here rather than showing up as a list diff.
    const signatures = [
      ...`${GOVERNING}\n${DATA_ROOM}`.matchAll(
        /create or replace function public\.(\w+)\s*\(([^)]*)\)/g,
      ),
    ];
    const offenders = signatures
      .filter(
        ([, , args]) =>
          /uuid/i.test(args) &&
          /(^|[^a-z])(p_)?(org|organization|tenant)/i.test(args),
      )
      .map(([, name]) => name);
    expect(offenders).toEqual([]);
  });

  it("every client-reachable RPC resolves the caller from the session", () => {
    // The property is about what a BROWSER can call. A definer function the
    // chain never grants to `authenticated` is reachable only by the service
    // role or by a trigger, and holding it to the same predicate would be
    // theatre — seed_ria_dataset_slots() legitimately takes an assessment id
    // and reads that assessment's org, because nothing untrusted can call it.
    //
    // For everything a signed-in caller CAN reach, the identity must come from
    // the session: app_current_org() for tenancy, auth.uid() for the role
    // lookup. Never from an argument — that is the shape 20260917001000 exists
    // to have removed.
    const combined = `${GOVERNING}\n${DATA_ROOM}`;
    const granted = new Set(
      [...combined.matchAll(/grant execute on function public\.(\w+)/g)].map(
        (m) => m[1],
      ),
    );
    expect(granted.size).toBeGreaterThan(5);

    const definers = [
      ...combined.matchAll(
        /create or replace function public\.(\w+)[\s\S]*?as \$\$([\s\S]*?)\$\$/g,
      ),
    ].filter(([whole]) => whole.includes("security definer"));
    expect(definers.length).toBeGreaterThan(5);

    const checked: string[] = [];
    for (const [, name, body] of definers) {
      if (!granted.has(name)) continue;
      checked.push(name);
      expect(
        /app_current_org\(\)|auth\.uid\(\)/.test(body),
        `${name} resolves neither the org nor the user from the session`,
      ).toBe(true);
    }
    // Every RPC the UI calls is on this list; if one drops off, the loop above
    // silently stops checking it.
    for (const rpcName of [
      "retire_ria_data_source",
      "link_ria_finding_evidence",
      "record_ria_source_profile",
      "set_ria_dataset_readiness",
      "open_ria_clarification",
      "answer_ria_clarification",
      "upsert_ria_asset_alias",
      "get_ria_readiness",
    ]) {
      expect(checked, `${rpcName} was not checked`).toContain(rpcName);
    }
  });
});
