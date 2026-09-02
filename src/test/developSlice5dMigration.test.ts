/**
 * Sync Develop Slice 5D — migration contract (static, no database).
 *
 * Every sibling slice ships one of these and 5D did not. That mattered: the
 * adversarial review of this slice found six defects in the migration text
 * that the live transcript did not reach — a definer read granted to
 * `authenticated` with NO organization filter at all, an emitter still
 * executable by `service_role` (the identity every edge function in this
 * repository holds), a collapse key that discarded a CRITICAL threshold
 * crossing arriving after a WARNING in the same transaction, two emitters
 * missing the operation that dodges them, and a lineage row certifying
 * caller-supplied arithmetic under the server's own kernel version.
 *
 * So this file pins the CONTRACT in the migration text. Each clause below
 * exists because a defect got past everything else, and every one of them was
 * reproduced live against a real database before it was closed. A later edit
 * that drops an org filter, re-opens a door to service_role, keys the collapse
 * without the consequence class, narrows an emitter's trigger coverage, or
 * lets a profile the server cannot tie to its own scope reach
 * `record_calculation_run`, fails here before it reaches a database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import { RAM_KERNEL_VERSION } from "../lib/develop/ram";
import { DEVELOP_EVENT_NAMES } from "../lib/develop/events";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const BUS_FILE = "20261207090000_develop_event_bus.sql";
const IMPACT_FILE = "20261207090100_develop_change_impact_agent.sql";
const RAM_FILE = "20261207090200_develop_ram_agent_case_scope.sql";
const ENGINE_FILE = "20261207090300_develop_information_engine.sql";
const SLICE_FILES = [BUS_FILE, IMPACT_FILE, RAM_FILE, ENGINE_FILE];

const bus = read(BUS_FILE);
const impact = read(IMPACT_FILE);
const ram = read(RAM_FILE);
const engine = read(ENGINE_FILE);
const joined = [bus, impact, ram, engine].join("\n");
const rawJoined = SLICE_FILES.map(raw).join("\n");

function body(source: string, fn: string): string {
  const at = source.lastIndexOf(`create or replace function public.${fn}(`);
  expect(at, `${fn} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("\n$$;", at);
  return source.slice(at, end === -1 ? undefined : end);
}

function table(source: string, name: string): string {
  const at = source.indexOf(`create table if not exists public.${name} (`);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("\n);", at);
  return source.slice(at, end === -1 ? undefined : end);
}

/** The `create trigger` statement bound to a named trigger. */
function trigger(source: string, name: string): string {
  const at = source.indexOf(`create trigger ${name}`);
  expect(at, `trigger ${name} not found`).toBeGreaterThan(-1);
  const end = source.indexOf(";", at);
  return source.slice(at, end === -1 ? undefined : end);
}

describe("Slice 5D — the event bus is org-scoped everywhere it is read", () => {
  // THE DEFECT: case_event_consequence_obligations is SECURITY DEFINER,
  // granted to `authenticated`, takes a caller-supplied case uuid, and its
  // entire `where` was `d.development_case_id = p_case_id`. A signed-in member
  // of any tenant could read any other tenant's unanswered blocking
  // obligations — the verbatim gate criterion text, the source table and row
  // id, the timestamps — by uuid. Reproduced live. definerTenancy's scan
  // cannot see it: that scan filters to functions whose ARGUMENT LIST names an
  // organization, and this one takes (uuid, bigint).
  const obligations = body(bus, "case_event_consequence_obligations");

  it("resolves the case and compares it to the caller's organization", () => {
    expect(obligations).toContain("app_current_org()");
    expect(obligations).toMatch(/from development_cases where id = p_case_id/);
    expect(obligations).toMatch(/v_case_org <> v_caller_org/);
  });

  it("admits the caller with no auth.uid(), so the wall is not switched off", () => {
    // The persistence wall runs this predicate from a trigger, where there is
    // no session org. Refusing that caller would make
    // enforce_gate_review_outstanding_obligations return nothing for exactly
    // the service-key writers it exists to catch — a fail-open dressed as a
    // tenancy fix. The sibling predicate's own shape is copied verbatim.
    expect(obligations).toMatch(
      /if auth\.uid\(\) is not null and v_caller_org is null then/,
    );
  });

  it("never casts a payload gateId that is not an integer", () => {
    // A forged or malformed gateId turned every gate read on the case into a
    // hard error, permanently: the event body is append-only, so the row could
    // not be removed and enforce_gate_review_outstanding_obligations went down
    // with it. Both the projection and the 5D-R18 filter are guarded.
    const casts =
      obligations.match(/\(e\.payload ->> 'gateId'\)::bigint/g) ?? [];
    expect(casts.length).toBeGreaterThan(0);
    for (const _ of casts) void _;
    expect(obligations.match(/~ '\^-\?\[0-9\]\+\$'/g)?.length ?? 0).toBe(
      casts.length,
    );
  });

  it("still returns ONLY blocking, unanswered consequences", () => {
    expect(obligations).toContain("d.answered_at is null");
    expect(obligations).toContain("d.consequence = 'blocking'");
  });

  it("returns the gate each consequence concerns, so a screen can say which", () => {
    // Ruling 5D-R18 scopes a GateRequirementChanged consequence to its own
    // gate in SQL. The panel called the predicate without a gate and then told
    // the user a review was stopped at EVERY gate — the reverse of the
    // divergence this slice claims to have closed. The predicate hands back
    // the gate so the screen states the scope instead of implying it.
    expect(obligations).toContain("'gateName'");
    expect(obligations).toContain("'gateId'");
  });
});

describe("Slice 5D — the bus ledger has exactly one door", () => {
  // THE DEFECT: Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on every
  // new function to anon, authenticated AND service_role. Revoking three of
  // four left emit_develop_event open to every edge function in this
  // repository. It is the ONLY way a non-superuser can write develop_events
  // (the append-only guard demands a GUC only it sets), so the grant IS the
  // door: one POST manufactured a permanent, undeletable, gate-blocking
  // consequence naming a source row that does not exist. Reproduced live.
  const doors = [
    "emit_develop_event(uuid, uuid, text, text, text, jsonb, jsonb, jsonb)",
    "dispatch_develop_event(bigint)",
    "sync_develop_event_consequence(text, uuid, jsonb)",
  ];

  for (const door of doors) {
    it(`revokes ${door.split("(")[0]} from service_role as well`, () => {
      const at = bus.indexOf(`revoke all on function public.${door}`);
      expect(at, `${door} revoke not found`).toBeGreaterThan(-1);
      const stmt = bus.slice(at, bus.indexOf(";", at));
      for (const role of ["public", "anon", "authenticated", "service_role"]) {
        expect(stmt, `${door} still reachable by ${role}`).toContain(role);
      }
    });

    it(`never grants ${door.split("(")[0]} back to a client role`, () => {
      expect(bus).not.toContain(`grant execute on function public.${door}`);
    });
  }

  it("refuses an event whose organization does not own its development case", () => {
    // The readers scope on organization_id alone, so a mismatched pair is a
    // row one tenant files against another tenant's case and then reads,
    // answers and CLEARS as its own — proven end to end before this closed.
    // Enforced at the wall, not in the emitter, so it holds for every writer.
    const guard = body(bus, "enforce_develop_event_append_only");
    expect(guard).toMatch(
      /from development_cases c\s*\n\s*where c\.id = new\.development_case_id\s*\n\s*and c\.organization_id = new\.organization_id/,
    );
    expect(guard).toContain("does not belong to that organization");
  });

  it("keeps the direct-insert guard on the append-only wall", () => {
    const guard = body(bus, "enforce_develop_event_append_only");
    expect(guard).toContain("app.develop_event_write");
  });
});

describe("Slice 5D — the collapse never swallows an escalation (5D-R19)", () => {
  // THE DEFECT: keyed on (case, dedupe_key, txid) alone, the first crossing in
  // a transaction took the key and every later one on the same indicator was
  // discarded by `on conflict do nothing`. A CRITICAL arriving after a WARNING
  // was dropped: the indicator was critical, the bus said warning, the
  // consequence was `attention`, no gate was blocked, and — because the audit
  // insert sits after the collapse — audit_events had no record either.
  it("carries the consequence class in the unique key", () => {
    const t = table(bus, "develop_events");
    expect(t).toContain(
      "unique (development_case_id, dedupe_key, consequence_class, emitted_tx)",
    );
    expect(t).toMatch(
      /consequence_class text not null check \(consequence_class in \('blocking', 'attention'\)\)/,
    );
  });

  it("emits on the same key so a batch of one class is still one event", () => {
    const emit = body(bus, "emit_develop_event");
    expect(emit).toContain(
      "on conflict (development_case_id, dedupe_key, consequence_class, emitted_tx) do nothing",
    );
  });

  it("classifies through ONE function, read by both the emitter and the consumer", () => {
    const emit = body(bus, "emit_develop_event");
    const dispatch = body(bus, "dispatch_develop_event");
    expect(emit).toContain("sync_develop_event_consequence(");
    expect(dispatch).toContain("sync_develop_event_consequence(");
    // And the consumer does not re-derive the rule itself: the payload-state
    // and prior-review branches live in the classifier and nowhere else.
    expect(dispatch).not.toContain("by_payload_state");
    expect(dispatch).not.toContain("by_prior_review");
    const classifier = body(bus, "sync_develop_event_consequence");
    expect(classifier).toContain("by_payload_state");
    expect(classifier).toContain("by_prior_review");
  });

  it("RAISES rather than proceeding if the two ever disagree", () => {
    const dispatch = body(bus, "dispatch_develop_event");
    expect(dispatch).toMatch(
      /v_consequence is distinct from e\.consequence_class/,
    );
    expect(dispatch).toContain("raise exception");
  });

  it("guards the classifier's own gateId cast", () => {
    const classifier = body(bus, "sync_develop_event_consequence");
    expect(classifier).toMatch(/v_gate !~ '\^-\?\[0-9\]\+\$'/);
  });
});

describe("Slice 5D — every emitter covers the act that dodges it", () => {
  // Two of the five were narrower than the act. RiskThresholdExceeded was
  // INSERT-only while risk_indicator_observations carries no append-only
  // guard, so an observation EDITED into critical moved the indicator and
  // emitted nothing. ScheduleUpdated did not cover DELETE, so removing a
  // scheduled activity — which restates every forecast exactly as moving one
  // does, in that rule's own words — was invisible. Both reproduced live.
  const expected: Record<string, string[]> = {
    trg_emit_gate_requirement_changed: ["insert", "update", "delete"],
    trg_emit_risk_threshold_exceeded: ["insert", "update"],
    trg_emit_schedule_updated: ["insert", "update", "delete"],
    trg_emit_work_package_blocked: ["insert", "update"],
    trg_emit_commissioning_test_failed: ["insert", "update"],
  };

  for (const [name, ops] of Object.entries(expected)) {
    it(`${name} fires on ${ops.join("/")}`, () => {
      const stmt = trigger(bus, name).toLowerCase();
      for (const op of ops) expect(stmt).toContain(op);
      // and it is an AFTER trigger — the act has happened.
      expect(stmt).toContain("after ");
    });
  }

  it("suppresses a repeat WorkPackageBlocked only when the first pass could emit", () => {
    // THE DEFECT: the guard tested `old.status = 'blocked'` alone and so fired
    // on a row whose first pass emitted NOTHING because its scope was
    // unresolvable. A work order created already blocked with no asset, then
    // linked to one — an ordinary sequence — never emitted at all, and nothing
    // anywhere recorded the miss.
    const emit = body(bus, "emit_work_package_blocked");
    expect(emit).toMatch(/old\.asset_id is not null/);
    expect(emit).toMatch(/old\.asset_id is not distinct from new\.asset_id/);
  });

  it("resolves the schedule row from OLD on a delete", () => {
    const emit = body(bus, "emit_schedule_updated");
    expect(emit).toMatch(/case when tg_op = 'DELETE' then old else new end/);
  });
});

describe("Slice 5D — §70 on the answer, unchanged", () => {
  it("binds the human-judgement wall to answered_by on INSERT and UPDATE", () => {
    const stmt = trigger(bus, "trg_develop_event_answerer_is_human");
    expect(stmt).toContain("before insert or update");
    expect(stmt).toContain("enforce_frontline_judgement_is_human");
    expect(stmt).toContain("'answered_by'");
  });

  it("refuses the AI-operator identity by name at the door", () => {
    const answer = body(bus, "answer_develop_event_consequence");
    expect(answer).toContain("'ai_admin'");
    expect(answer).toContain("spec §70");
  });

  it("uses auth.uid() for the caller gate, never a current_user role list", () => {
    expect(joined).not.toMatch(/current_user in \('authenticated'/);
    expect(joined).toContain("auth.uid()");
  });
});

describe("Slice 5D — the five names come from one place", () => {
  it("matches the TypeScript vocabulary exactly", () => {
    const at = bus.indexOf(
      "create or replace function public.sync_develop_event_names()",
    );
    const decl = bus.slice(at, bus.indexOf("$$;", at));
    for (const name of DEVELOP_EVENT_NAMES) expect(decl).toContain(`'${name}'`);
    expect(DEVELOP_EVENT_NAMES).toHaveLength(5);
  });

  it("has the event-name CHECK read that function rather than a second list", () => {
    expect(table(bus, "develop_events")).toContain(
      "check (event_name = any (sync_develop_event_names()))",
    );
  });
});

describe("Slice 5D — the Change Impact Agent stores 5C's traversal", () => {
  const record = body(impact, "record_change_impact_report");

  it("CALLS get_case_thread_impact and builds no traversal of its own", () => {
    expect(record).toContain("get_case_thread_impact(c.id, o.id)");
    expect(impact).not.toContain("thread_links");
    expect(impact).not.toMatch(/with recursive/i);
  });

  it("drops the narrative and the model when the traversal refused", () => {
    // The consequence path was guarded and the prose beside it was not: the
    // RPC took p_narrative and p_model unconditionally, so a direct caller
    // holding the ai_admin role this door admits could record `refused = true`
    // next to a paragraph describing the floor as the answer, permanently.
    expect(record).toMatch(
      /if v_refused and \(v_narrative is not null or v_model is not null\) then/,
    );
    expect(record).toContain("v_narrative := null;");
    expect(record).toContain("v_model := null;");
  });

  it("keeps source and severity as SQL literals", () => {
    expect(record).toContain("'source', 'ai_suggestion'");
    expect(record).toContain("'severity', 'attention'");
  });

  it("bounds the model label on the table and at the door", () => {
    expect(table(impact, "change_impact_reports")).toMatch(
      /model text check \(model is null or length\(model\) <= 200\)/,
    );
    expect(record).toContain("longer than 200 characters");
  });

  it("has no column that can hold a disposition", () => {
    const t = table(impact, "change_impact_reports");
    for (const col of [
      "status",
      "outcome",
      "disposition",
      "approval",
      "acknowledged",
      "decision",
    ]) {
      expect(t).not.toContain(`${col} `);
    }
    expect(t).toContain(
      "constraint change_impact_report_is_advisory check (advisory)",
    );
  });

  it("keeps a refusal countless", () => {
    expect(table(impact, "change_impact_reports")).toContain(
      "check ((downstream_count is null) = refused)",
    );
  });
});

describe("Slice 5D — the RAM report cannot certify arithmetic the server did not see", () => {
  // THE DEFECT: 5D-R14 re-read the INPUTS, merged the REFUSALS and pinned the
  // kernel version — and none of that constrained the NUMBERS. `p_profile`
  // went into ram_agent_reports.profile AND into record_calculation_run's
  // `outputs` verbatim, stamped code_version = sync_ram_kernel_version() under
  // a method string reading "from the shipped reliability kernel". A caller
  // with any project role posted a 0.9999 availability against an asset tag
  // that does not exist and a target id never allocated, and the immutable
  // lineage row certified it. That is the D11.29 failure this row claims to
  // close, arriving by the one route nothing checked.
  const record = body(ram, "record_ram_agent_report");

  it("re-reads the scope rather than accepting it", () => {
    expect(record).toContain("v_scope := get_case_ram_scope(c.id);");
  });

  it("refuses a profile naming a target the scope does not hold", () => {
    expect(record).toContain("v_scope_targets");
    expect(record).toContain("not a target on this case");
  });

  it("refuses a profile naming an asset the scope does not hold", () => {
    expect(record).toContain("v_scope_assets");
    expect(record).toContain("not bound to this development case");
  });

  it("refuses a profile over PART of the population rather than trimming it", () => {
    expect(record).toMatch(
      /array_length\(v_claim_targets, 1\) is distinct from array_length\(v_scope_targets, 1\)/,
    );
    expect(record).toContain("refused rather than trimmed");
  });

  it("still pins the kernel identity server-side", () => {
    expect(record).toContain("sync_ram_kernel_version()");
    expect(record).toContain("the server pins");
    expect(ram).toContain(`'${RAM_KERNEL_VERSION}'::text`);
  });

  it("merges the server's refusals OVER the caller's", () => {
    expect(record).toMatch(
      /v_refusals := coalesce\(v_scope -> 'refusals', '\[\]'::jsonb\);/,
    );
  });

  it("keeps the mixed-configuration refusal on the SERVER", () => {
    // It lived only in src/lib/develop/ram.ts and reached the server as
    // p_refusals, which the merge APPENDS rather than requires — so a caller
    // that simply omitted it recorded an immutable lineage row with nothing
    // saying the kernel had no model for the system. A refusal a caller can
    // drop is not a refusal.
    const scope = body(ram, "get_case_ram_scope");
    expect(scope).toContain("'configuration' = 'mixed'");
    expect(scope).toContain("MIXED configuration");
  });

  it("bounds the model label on the table and at the door", () => {
    expect(table(ram, "ram_agent_reports")).toMatch(
      /model text check \(model is null or length\(model\) <= 200\)/,
    );
    expect(record).toContain("longer than 200 characters");
  });

  it("has no column that can hold a target or an acceptance", () => {
    const t = table(ram, "ram_agent_reports");
    for (const col of [
      "target_availability",
      "accepted",
      "approval",
      "decision",
    ]) {
      expect(t).not.toContain(`${col} `);
    }
    expect(t).toContain(
      "constraint ram_agent_report_is_advisory check (advisory)",
    );
  });
});

describe("Slice 5D — §34 and the composed engine state counts, never spell them", () => {
  it("does not hard-code a spelled edge count beside a computed one", () => {
    // THE DEFECT: the refusal was parameterised on v_absent_edges and then
    // hard-coded "The five are named" beside it, so the shipped payload read
    // "4 of ... The five are named" — a self-contradiction on screen, in the
    // file whose own thesis is that unchecked prose survives a slice.
    const engineBody = body(engine, "get_case_information_engine");
    expect(engineBody).toContain("v_absent_edges");
    expect(engineBody.toLowerCase()).not.toContain("the five are named");
  });

  it("asks the catalogue as ONE role, not as the caller", () => {
    // information_schema filters by the CALLING role's privileges, so the same
    // question asked directly by `authenticated` and asked inside the definer
    // engine could answer differently — two answers to one question, in the
    // machinery built to stop exactly that.
    const at = engine.indexOf(
      "create or replace function public.sync_spec34_absent_edge_audit()",
    );
    const decl = engine.slice(at, engine.indexOf("as $$", at));
    expect(decl).toContain("security definer");
    expect(decl).toContain("set search_path = public");
  });

  it("produces NO composite score for the composed module", () => {
    const engineBody = body(engine, "get_case_information_engine");
    expect(engineBody).not.toMatch(/'score'/);
    expect(engineBody).toContain("'complete', false");
  });
});

describe("Slice 5D — migration hygiene", () => {
  it("orders strictly after Slice 5C", () => {
    for (const f of SLICE_FILES) {
      expect(f.slice(0, 14) > "20261206090300").toBe(true);
    }
  });

  it("enables RLS with an org policy on every new table", () => {
    const tables = [
      ["develop_events", bus],
      ["develop_event_deliveries", bus],
      ["change_impact_reports", impact],
      ["ram_agent_reports", ram],
    ] as const;
    for (const [name, source] of tables) {
      expect(source).toContain(
        `alter table public.${name} enable row level security`,
      );
      expect(source).toMatch(
        new RegExp(
          `create policy ${name}_read on public\\.${name}[\\s\\S]{0,200}organization_id = app_current_org\\(\\)`,
        ),
      );
    }
  });

  it("revokes truncate on every new ledger", () => {
    for (const name of [
      "develop_events",
      "develop_event_deliveries",
      "ram_agent_reports",
    ]) {
      expect(joined).toContain(
        `revoke truncate on table public.${name} from anon, authenticated, service_role`,
      );
    }
    expect(impact).toContain(
      "revoke truncate on table public.change_impact_reports",
    );
  });

  it("sets search_path on every definer function it declares", () => {
    const declared =
      rawJoined.match(
        /create or replace function public\.\w+\([\s\S]*?as \$\$/g,
      ) ?? [];
    const definers = declared.filter((d) => /security definer/.test(d));
    expect(definers.length).toBeGreaterThan(8);
    for (const d of definers) {
      expect(d, d.slice(0, 90)).toContain("set search_path = public");
    }
  });

  it("writes previous_state/new_state to the ONE audit ledger on every mutation", () => {
    for (const fn of [
      body(bus, "emit_develop_event"),
      body(bus, "answer_develop_event_consequence"),
      body(impact, "record_change_impact_report"),
      body(ram, "record_ram_agent_report"),
    ]) {
      expect(fn).toContain("insert into audit_events");
      expect(fn).toContain("new_state");
    }
  });
});
