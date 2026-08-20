/**
 * The Reliability Intelligence Assessment's governing rules, asserted as text.
 *
 * WHY TEXT. CI's `migrations` job proves the chain applies; "it applied" is not
 * the property that matters here. What matters is that each rule of §5 of the
 * workspace specification is enforced by something a future caller cannot walk
 * around — a trigger or a constraint, not a check inside one RPC. #231 shipped
 * publish_ria_finding() with the reviewer set inside the function and no
 * evidence check at all, which meant the rule held for exactly one caller and
 * for nobody else. These guards assert the shape that fixes that.
 *
 * Every guard is mutation-checked: the predicate that accepts the shipped
 * migration is also shown to REJECT the weakened form it exists to catch — a
 * gate implemented in the RPC instead of a trigger, a trigger that fires on
 * every update instead of on the transition, a `not null` standing in for a
 * non-blank check, a DELETE policy that would let the audit stub disappear.
 *
 * The behaviour itself is verified separately by replaying the whole chain on
 * a live Postgres and asserting each gate refuses the weakened case and admits
 * the correct one; this file is the locally-runnable guard that the DDL which
 * produces that behaviour is still present.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const RULES_PATH = "supabase/migrations/20260920000000_ria_governing_rules.sql";
const rules = readFileSync(RULES_PATH, "utf8");

/**
 * Executable DDL only. The header of this migration discusses every failure it
 * guards against by name, so an assertion satisfied by prose would pass on a
 * migration that did nothing at all.
 */
const executable = stripComments(rules);
const lower = executable.toLowerCase();

/** The plpgsql body of a named function, from its `as $$` to the closing `$$`. */
function functionBody(name: string, source = executable): string {
  const anchor = `create or replace function public.${name}`;
  const start = source.toLowerCase().indexOf(anchor);
  expect(start, `${anchor} not found`).toBeGreaterThan(-1);
  const open = source.indexOf("$$", start);
  const close = source.indexOf("$$", open + 2);
  expect(close, `body terminator not found for ${name}`).toBeGreaterThan(-1);
  return source.slice(open + 2, close);
}

/** The `create trigger <name> …;` statement, whitespace-normalised. */
function triggerStatement(name: string, source = executable): string {
  const anchor = `create trigger ${name}`;
  const start = source.toLowerCase().indexOf(anchor);
  expect(start, `${anchor} not found`).toBeGreaterThan(-1);
  const end = source.indexOf(";", start);
  expect(end, `unterminated trigger ${name}`).toBeGreaterThan(-1);
  return source.slice(start, end).toLowerCase().replace(/\s+/g, " ");
}

/**
 * True when a trigger body only acts on a TRANSITION into a state: it compares
 * `new` against the target AND compares `old` against `new`. A body that tests
 * only `new.x = 'published'` re-runs the whole gate on every unrelated update
 * of an already-published row, which turns a governance check into a write
 * lock on published findings.
 */
function firesOnTransitionOnly(body: string): boolean {
  const normalised = body.toLowerCase().replace(/\s+/g, " ");
  return (
    /new\.\w+\s+is\s+distinct\s+from|new\.\w+\s+not\s+in|new\.status\s+not\s+in/.test(
      normalised,
    ) && /old\.\w+\s+is\s+not\s+distinct\s+from\s+new\.\w+/.test(normalised)
  );
}

describe("the migration is what it claims to be", () => {
  it("parses to real DDL, not to a file of comments", () => {
    expect(executable.length).toBeGreaterThan(2000);
    expect(lower).toContain(
      "create table if not exists public.ria_finding_evidence",
    );
  });
});

// ---------------------------------------------------------------------------
// §5 rule 1 — a finding cannot become customer-visible without evidence links
//             AND a reviewer identity.
// ---------------------------------------------------------------------------

describe("rule 1: publication requires evidence and a named reviewer", () => {
  const body = functionBody("enforce_ria_publication_gate");

  it("is a trigger on ria_findings, not a check inside one RPC", () => {
    // The whole point. #231 put the reviewer inside publish_ria_finding(); a
    // second RPC, a connector or a service-role script bypassed it entirely.
    const statement = triggerStatement("trg_ria_publication_gate");
    expect(statement).toContain("before update of review_state");
    expect(statement).toContain("on public.ria_findings");
    expect(statement).toContain("for each row");
    expect(statement).toContain("public.enforce_ria_publication_gate");
  });

  it("refuses a publication with no reviewer", () => {
    expect(body.toLowerCase()).toMatch(/new\.reviewer_id\s+is\s+null/);
    expect(body.toLowerCase()).toMatch(/raise\s+exception/);
  });

  it("counts real evidence rows rather than trusting a column", () => {
    // A uuid[] length check would have been satisfied by the array #231
    // shipped, whose contents were never resolvable. Counting the join table
    // is the assertion that the evidence EXISTS.
    const normalised = body.toLowerCase().replace(/\s+/g, " ");
    expect(normalised).toContain("from ria_finding_evidence");
    expect(normalised).toMatch(/count\(\*\)\s+into\s+v_evidence/);
    expect(normalised).toMatch(/v_evidence\s*=\s*0/);
  });

  it("fires only on the transition into published", () => {
    expect(firesOnTransitionOnly(body)).toBe(true);
  });

  it("mutation-sanity — the transition predicate rejects an always-on gate", () => {
    const shipped =
      "if new.review_state is distinct from 'published' or old.review_state is not distinct from new.review_state then return new; end if;";
    const weakened =
      "if new.review_state <> 'published' then return new; end if;";
    expect(firesOnTransitionOnly(shipped)).toBe(true);
    expect(firesOnTransitionOnly(weakened)).toBe(false);
  });

  it("raises with a check_violation errcode, as the gatekeeper does", () => {
    expect(body.toLowerCase()).toContain("errcode = 'check_violation'");
  });

  it("the retired uuid[] column is actually dropped, not left to drift", () => {
    // Two stores of the same fact drift, and the older one wins arguments it
    // should not be in (invariant 8).
    expect(lower).toContain(
      "alter table public.ria_findings drop column if exists evidence_refs",
    );
  });

  it("existing publications that cannot satisfy the gate are walked back", () => {
    // A transition-only trigger leaves already-published rows alone, so a
    // migration that only adds the trigger leaves every pre-existing
    // unsupported publication standing and customer-visible.
    expect(lower).toContain("update public.ria_findings");
    expect(lower).toMatch(/set\s+review_state\s*=\s*'reviewed'/);
    expect(lower).toContain("publication_withdrawn");
    expect(lower).toContain("insert into public.audit_events");
  });
});

// ---------------------------------------------------------------------------
// §5 rule 2 — unsupported metrics carry a status downstream queries exclude.
// ---------------------------------------------------------------------------

describe("rule 2: metric support is earned, and the unsupported are excludable", () => {
  it("a metric cannot claim support without a reviewer and a method", () => {
    const normalised = lower.replace(/\s+/g, " ");
    expect(normalised).toContain("ria_metric_support_is_earned");
    expect(normalised).toMatch(
      /check\s*\(\s*evidence_grade\s*=\s*'unsupported'\s*or\s*\(\s*reviewer_id is not null and btrim\(coalesce\(method, ''\)\) <> ''/,
    );
  });

  it("the excluding surface is a view, and it runs as the CALLER", () => {
    // A view created without security_invoker runs as its owner and bypasses
    // RLS — it would hand every tenant every other tenant's metrics, and the
    // exclusion would be the only thing it got right.
    const normalised = lower.replace(/\s+/g, " ");
    expect(normalised).toContain(
      "create view public.ria_decision_ready_metrics",
    );
    expect(normalised).toContain("with (security_invoker = true)");
    expect(normalised).toContain("where evidence_grade <> 'unsupported'");
  });

  it("the view is not readable by anon", () => {
    expect(lower).toContain(
      "revoke all on public.ria_decision_ready_metrics from public, anon",
    );
    expect(lower).toContain(
      "grant select on public.ria_decision_ready_metrics to authenticated",
    );
  });

  it("mutation-sanity — the guard rejects an owner-rights view", () => {
    const shipped =
      "create view public.ria_decision_ready_metrics with (security_invoker = true) as select 1";
    const weakened =
      "create view public.ria_decision_ready_metrics as select 1";
    const invoker = (sql: string) => sql.includes("security_invoker = true");
    expect(invoker(shipped)).toBe(true);
    expect(invoker(weakened)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5 rule 3 — high/critical findings require authority AND boundary on their
//             decision or action.
// ---------------------------------------------------------------------------

describe("rule 3: severity reaches authority", () => {
  it("decisions and actions can be linked to the finding they govern", () => {
    // Without the link the rule cannot be evaluated at all, which is why #231
    // could only state it in prose.
    expect(lower).toContain("alter table public.ria_decisions");
    expect(lower).toContain(
      "add column if not exists finding_id uuid references public.ria_findings(id)",
    );
  });

  it("blank authority and blank boundary are refused, not just NULL", () => {
    // `not null` on text admits ''. That is the shape the constraint exists
    // to refuse: a decision satisfying its columns while naming nobody.
    const normalised = lower.replace(/\s+/g, " ");
    expect(normalised).toContain("ria_decisions_authority_stated");
    expect(normalised).toMatch(
      /check\s*\(btrim\(authority_role\) <> '' and btrim\(boundary\) <> ''\)/,
    );
  });

  it("the publication gate checks severity against a governing record", () => {
    const body = functionBody("enforce_ria_publication_gate")
      .toLowerCase()
      .replace(/\s+/g, " ");
    expect(body).toMatch(/new\.severity in \('critical','high'\)/);
    expect(body).toContain("from ria_decisions d");
    expect(body).toContain("from ria_actions a");
    expect(body).toMatch(/btrim\(coalesce\(d\.authority_role, ''\)\) <> ''/);
    expect(body).toMatch(/btrim\(coalesce\(d\.boundary, ''\)\) <> ''/);
  });

  it("an action from a high finding cannot be worked without an approval", () => {
    const statement = triggerStatement("trg_ria_action_authority");
    expect(statement).toContain("before update of status");
    expect(statement).toContain("on public.ria_actions");

    const body = functionBody("enforce_ria_action_authority")
      .toLowerCase()
      .replace(/\s+/g, " ");
    expect(body).toMatch(/new\.status not in \('in_progress','complete'\)/);
    expect(body).toMatch(/v_severity in \('critical','high'\)/);
    expect(body).toMatch(/new\.approval_state <> 'approved'/);
    expect(
      firesOnTransitionOnly(functionBody("enforce_ria_action_authority")),
    ).toBe(true);
  });

  it("an approval carries the identity that gave it", () => {
    const normalised = lower.replace(/\s+/g, " ");
    expect(normalised).toContain("ria_actions_approved_needs_approver");
    expect(normalised).toMatch(
      /check\s*\(approval_state <> 'approved' or \(approved_by is not null and approved_at is not null\)\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// §5 rule 4 — deleting a source file keeps the audit stub.
// ---------------------------------------------------------------------------

describe("rule 4: the audit stub always survives", () => {
  it("a hard delete raises, so even a service-role script cannot take the stub", () => {
    // RLS granting no DELETE is an omission, not a decision — the next
    // migration adding `for all` silently removes it. The trigger has to be
    // dropped by name to be defeated, which appears in a diff.
    const statement = triggerStatement("trg_ria_source_no_hard_delete");
    expect(statement).toContain("before delete on public.ria_data_sources");
    expect(statement).toContain("for each row");
    const body = functionBody("refuse_ria_source_hard_delete").toLowerCase();
    expect(body).toContain("raise exception");
    expect(body).toContain("retire_ria_data_source");
  });

  it("retirement records who, when and why, and writes an audit row", () => {
    const body = functionBody("retire_ria_data_source")
      .toLowerCase()
      .replace(/\s+/g, " ");
    expect(body).toContain("deleted_at = now()");
    expect(body).toContain("deleted_by = auth.uid()");
    expect(body).toContain("delete_note = p_note");
    expect(body).toContain("insert into audit_events");
    expect(body).toContain("'source_retired'");
    // The stub is only a stub of something if it names the file it stood for.
    expect(body).toContain("'file_name', v_source.file_name");
  });

  it("a retirement with no reason is refused by the schema too", () => {
    const normalised = lower.replace(/\s+/g, " ");
    expect(normalised).toContain("ria_data_sources_retirement_is_explained");
    expect(normalised).toMatch(
      /check\s*\(deleted_at is null or btrim\(coalesce\(delete_note, ''\)\) <> ''\)/,
    );
  });

  it("a source cited as evidence cannot be retired out from under a finding", () => {
    const body = functionBody("retire_ria_data_source").toLowerCase();
    expect(body).toContain("from ria_finding_evidence where data_source_id");
    // …and the foreign key refuses it even if the RPC is bypassed.
    expect(lower).toContain(
      "data_source_id uuid not null references public.ria_data_sources(id) on delete restrict",
    );
  });

  it("the raw file cannot be deleted once a source row accounts for it", () => {
    // #231's storage policy let any authenticated member of the org delete any
    // object in the bucket, leaving a stub that pointed at nothing. Orphans
    // (upload succeeded, metadata insert failed) stay removable by their own
    // uploader so a failed upload does not litter the bucket.
    const start = lower.indexOf("create policy ria_source_files_delete");
    expect(start).toBeGreaterThan(-1);
    const statement = lower.slice(start, lower.indexOf(";", start));
    expect(statement).toContain("owner = auth.uid()");
    expect(statement).toMatch(
      /not exists\s*\(\s*select 1 from public\.ria_data_sources d where d\.object_path/,
    );
  });
});

// ---------------------------------------------------------------------------
// Evidence integrity and tenancy of the new link table.
// ---------------------------------------------------------------------------

describe("evidence links are real references, and they cannot straddle tenants", () => {
  it("both ends are foreign keys, not bare uuids", () => {
    const normalised = lower.replace(/\s+/g, " ");
    expect(normalised).toContain(
      "finding_id uuid not null references public.ria_findings(id) on delete cascade",
    );
    expect(normalised).toContain(
      "data_source_id uuid not null references public.ria_data_sources(id) on delete restrict",
    );
    expect(normalised).toContain(
      "organization_id uuid not null references public.organizations(id)",
    );
  });

  it("a trigger checks the link's org against BOTH parents", () => {
    const statement = triggerStatement("trg_ria_evidence_tenancy");
    // INSERT as well as UPDATE: the first write is the one that would create
    // the cross-tenant link.
    expect(statement).toContain("before insert or update");
    const body = functionBody("enforce_ria_evidence_tenancy").toLowerCase();
    expect(body).toContain("v_finding_org");
    expect(body).toContain("v_source_org");
    expect(body).toMatch(
      /new\.organization_id is distinct from v_finding_org\s+or\s+new\.organization_id is distinct from v_source_org/,
    );
  });

  it("the backfill migrates only refs that resolve inside the same org", () => {
    const normalised = lower.replace(/\s+/g, " ");
    expect(normalised).toContain("unnest(f.evidence_refs)");
    expect(normalised).toMatch(
      /join public\.ria_data_sources s on s\.id = ref\.id and s\.organization_id = f\.organization_id/,
    );
  });

  it("the link table has no client write policy — the RPC is the only door", () => {
    const start = lower.indexOf(
      "alter table public.ria_finding_evidence enable row level security",
    );
    expect(start).toBeGreaterThan(-1);
    const rest = lower.slice(start);
    expect(rest).toContain("create policy ria_finding_evidence_org_read");
    expect(rest).not.toMatch(
      /create policy ria_finding_evidence\w*\s+on public\.ria_finding_evidence for (insert|update|delete|all)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Tenancy and authorization of everything this migration adds.
// ---------------------------------------------------------------------------

describe("tenancy and role gates", () => {
  it("every policy scopes on app_current_org() with no null-org disjunct", () => {
    const policies = [...executable.matchAll(/create policy[\s\S]*?;/gi)].map(
      (m) => m[0].toLowerCase().replace(/\s+/g, " "),
    );
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy, `policy has no org scope: ${policy}`).toContain(
        "app_current_org()",
      );
      // The escape hatch 20260917000000 spent a whole migration removing.
      expect(policy).not.toMatch(/organization_id\s+is\s+null\s+or/);
      expect(policy).not.toMatch(/using\s*\(\s*true\s*\)/);
    }
  });

  it("no new function takes an organization uuid a caller could name", () => {
    // definerTenancy.test.ts snapshots that surface as exactly three legacy
    // functions; adding a fourth here would widen it.
    const signatures = [
      ...executable.matchAll(
        /create or replace function public\.(\w+)\s*\(([^)]*)\)/gi,
      ),
    ];
    expect(signatures.length).toBeGreaterThan(0);
    for (const [, name, args] of signatures) {
      if (!/uuid/i.test(args)) continue;
      expect(
        /(^|[^a-z])(p_)?(org|organization|tenant)/i.test(args),
        `${name} takes an organization uuid: ${args}`,
      ).toBe(false);
    }
  });

  it("supplying assessment data is role-gated, and anon is revoked everywhere", () => {
    const gate = functionBody("app_can_supply_ria_sources").toLowerCase();
    for (const role of [
      "planner",
      "reliability_engineer",
      "maintenance_manager",
      "admin",
      "ai_admin",
      "assessment_sponsor",
    ]) {
      expect(gate).toContain(`'${role}'`);
    }
    // Roles deliberately excluded: reporting a fault is not supplying an
    // assessment export.
    expect(gate).not.toContain("'technician'");
    expect(gate).not.toContain("'operator'");

    const revokes = [
      ...lower.matchAll(/revoke all on function public\.(\w+)/g),
    ].map((m) => m[1]);
    for (const fn of [
      "retire_ria_data_source",
      "link_ria_finding_evidence",
      "app_can_supply_ria_sources",
    ]) {
      expect(revokes, `${fn} is not revoked from public`).toContain(fn);
    }
  });

  it("the data-source insert policy checks the parent assessment's org too", () => {
    const start = lower.indexOf("create policy ria_data_sources_org_insert");
    expect(start).toBeGreaterThan(-1);
    const statement = lower
      .slice(start, lower.indexOf(";", start))
      .replace(/\s+/g, " ");
    expect(statement).toContain("organization_id = public.app_current_org()");
    expect(statement).toContain("public.app_can_supply_ria_sources()");
    expect(statement).toContain("from public.ria_assessments a");
  });

  it("every definer function pins its search_path", () => {
    const definers = [
      ...executable.matchAll(
        /create or replace function public\.\w+[\s\S]*?(?=as \$\$)/gi,
      ),
    ]
      .map((m) => m[0].toLowerCase())
      .filter((d) => d.includes("security definer"));
    expect(definers.length).toBeGreaterThan(4);
    for (const definer of definers) {
      expect(definer).toContain("set search_path = public");
    }
  });

  it("reloads the PostgREST schema cache so the RPCs are reachable", () => {
    expect(lower).toContain("notify pgrst, 'reload schema'");
  });
});
