/**
 * The import door, the route, and the one thing that must never drift.
 *
 * THE DEFECT THESE PROTECT. begin_manual_import named three entity types and
 * four more were validated and unreachable — two of them in a second function,
 * ingest_context_batch, which had never had a caller. The reason the door was
 * left narrow is written into 20260907090000: naming a type the caller's chosen
 * RPC does not handle "would let a caller open a run that ingest_batch then
 * rejects row by row, which reads as a data problem when it is a configuration
 * one."
 *
 * So the door and the router must agree, always, and the agreement cannot be
 * two lists maintained by two people. There is one route table in SQL, and
 * these tests assert that the TypeScript descriptor table the SURFACE is built
 * from names exactly the same types with exactly the same handlers. A future
 * entity type added to one and not the other fails here, on the day it lands,
 * instead of in a customer's reject list. (schedule_activity, 20261112090000,
 * is the first type to land under that regime: route row, third validator,
 * descriptor — one change.)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrationFiles, stripComments } from "./support/migrationPolicies";
import {
  INGEST_ENTITIES,
  INGEST_ENTITY_ORDER,
  type IngestEntityKey,
} from "../lib/ingest-entities";

const DIR = "supabase/migrations";
const ROUTER = "20261004090000_route_the_import_door.sql";
const ORIGINAL_DOOR = "20260907090000_manual_import.sql";

const CONTEXT_FIX =
  "20261004090200_operating_context_rows_survive_a_bad_cell.sql";
const SCHEDULE_IMPORT = "20261112090000_p6_schedule_import.sql";
/**
 * Where the schedule validator's CURRENT body lives.
 *
 * Slice 4A re-created `ingest_schedule_batch` (20261130090100) to add one
 * line: the door names itself to the new P6-provenance wall before inserting,
 * so an imported activity is born through the door and not by a stray write.
 * The body is otherwise spliced unchanged, and the assertions below run
 * against `defs`, which resolves the LATEST definition — so they keep holding
 * the live function to the Slice 1 contract wherever it lives. This constant
 * is the deliberate half of that move: a body that migrates without anyone
 * noticing is exactly what the mutation-sanity case exists to catch.
 */
const SCHEDULE_VALIDATOR_HOME =
  "20261130090100_develop_schedule_activity_object.sql";

const routerSql = stripComments(readFileSync(`${DIR}/${ROUTER}`, "utf8"));

/** Every migration's SQL, comments stripped, in timestamp order. */
const allSql = migrationFiles(DIR).map((file) => ({
  file,
  sql: stripComments(readFileSync(`${DIR}/${file}`, "utf8")),
}));

/**
 * The enumerated CHECK constraints on a table, read out of its CREATE TABLE.
 * Rediscovered rather than listed, so a constraint added later is picked up
 * without anyone remembering to come back here.
 */
function enumeratedChecks(table: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const open = new RegExp(
    "create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?" +
      table +
      "\\s*\\(",
    "i",
  );
  for (const { sql } of allSql) {
    const m = open.exec(sql);
    if (!m) continue;
    const body = sql.slice(m.index + m[0].length);
    const end = body.indexOf("\n);");
    const block = end === -1 ? body : body.slice(0, end);
    for (const c of block.matchAll(/check\s*\(\s*(\w+)\s+in\s*\(([^)]*)\)/gi)) {
      out[c[1]] = [...c[2].matchAll(/'([^']*)'/g)].map((v) => v[1]);
    }
  }
  return out;
}

/** The last definition of each function in filename order — `create or replace`. */
function liveDefinitions(): Map<string, { file: string; body: string }> {
  const defs = new Map<string, { file: string; body: string }>();
  for (const file of migrationFiles(DIR)) {
    const sql = stripComments(readFileSync(`${DIR}/${file}`, "utf8"));
    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(([\s\S]*?)\)\s*returns([\s\S]*?)(\$\w*\$)([\s\S]*?)\4\s*;/gi,
    )) {
      defs.set(m[1].replace(/^public\./i, "").toLowerCase(), {
        file,
        body: m[5],
      });
    }
  }
  return defs;
}

const defs = liveDefinitions();

/** The (entity_type, handler) pairs the SQL route table declares. */
function sqlRoutes(): Record<string, string> {
  const fn = defs.get("ingest_entity_routes");
  expect(fn, "ingest_entity_routes is not defined in the chain").toBeDefined();
  const out: Record<string, string> = {};
  for (const m of (fn as { body: string }).body.matchAll(
    /\(\s*'([a-z_]+)'\s*,\s*'(ingest_[a-z_]+)'\s*\)/g,
  )) {
    out[m[1]] = m[2];
  }
  return out;
}

describe("the route table is the single source of truth", () => {
  const routes = sqlRoutes();

  it("the parser actually found the table", () => {
    // Without this, every comparison below passes vacuously the day the regex
    // stops matching.
    expect(Object.keys(routes).length).toBe(8);
  });

  it("the route table's live definition is the schedule-import migration", () => {
    // create-or-replace resolves to the LAST file; if a later migration
    // redefines the table without carrying schedule_activity, this names it.
    expect(defs.get("ingest_entity_routes")?.file).toBe(
      "20261112090000_p6_schedule_import.sql",
    );
  });

  it("SQL and the surface descriptor table name the same entity types", () => {
    expect(Object.keys(routes).sort()).toEqual(
      Object.keys(INGEST_ENTITIES).sort(),
    );
  });

  it("SQL and the surface descriptor table agree on which validator owns each type", () => {
    for (const [key, entity] of Object.entries(INGEST_ENTITIES)) {
      expect(routes[key], `no SQL route for ${key}`).toBe(entity.handler);
    }
  });

  it("every entity type is offered by the surface, in a stated order", () => {
    expect([...INGEST_ENTITY_ORDER].sort()).toEqual(
      Object.keys(INGEST_ENTITIES).sort(),
    );
    expect(new Set(INGEST_ENTITY_ORDER).size).toBe(INGEST_ENTITY_ORDER.length);
  });

  it("the handler each route names really does have a branch for that type", () => {
    // The route table could name a function that does not handle the type. That
    // is the original defect wearing a different hat, so it is asserted against
    // the LIVE body of each validator rather than assumed.
    for (const [key, handler] of Object.entries(routes)) {
      const fn = defs.get(handler);
      expect(fn, `${handler} is not defined in the chain`).toBeDefined();
      expect(
        (fn as { body: string }).body,
        `${handler} has no branch for ${key}`,
      ).toContain(`r.entity_type = '${key}'`);
    }
  });

  it("the validators own disjoint sets — nothing is handled twice", () => {
    const validators = [...new Set(Object.values(routes))];
    expect(validators.length).toBeGreaterThanOrEqual(3);
    for (const [key, handler] of Object.entries(routes)) {
      for (const other of validators) {
        if (other === handler) continue;
        expect(
          defs.get(other)?.body ?? "",
          `${key} has a branch in ${other} as well as ${handler}`,
        ).not.toContain(`r.entity_type = '${key}'`);
      }
    }
  });
});

describe("the door refuses from the route table, not from a literal", () => {
  it("begin_manual_import asks the route table whether it carries a type", () => {
    const body = defs.get("begin_manual_import")?.body ?? "";
    expect(defs.get("begin_manual_import")?.file).toBe(ROUTER);
    expect(body).toMatch(
      /ingest_handler_for\s*\(\s*p_entity_type\s*\)\s+is\s+null/i,
    );
  });

  it("and no longer carries a hand-typed allowlist that could fall behind", () => {
    const body = defs.get("begin_manual_import")?.body ?? "";
    expect(body).not.toMatch(
      /p_entity_type\s+not\s+in\s*\(\s*'maintenance_plan'/i,
    );
  });

  it("the refusal still names what IS supported, derived rather than retyped", () => {
    const body = defs.get("begin_manual_import")?.body ?? "";
    expect(body).toContain("manual upload does not carry");
    expect(body).toContain("ingest_supported_entity_types()");
    const supported = defs.get("ingest_supported_entity_types")?.body ?? "";
    expect(supported).toContain("ingest_entity_routes()");
  });

  it("WHO may import is unchanged, character for character", () => {
    // Widening WHAT is carried must not widen WHO carries it. Compared against
    // the original door rather than against a copy of the list in this file.
    const gate =
      /not\s+in\s*\n?\s*\('planner','reliability_engineer','maintenance_manager','admin','ai_admin'\)/;
    const original = stripComments(
      readFileSync(`${DIR}/${ORIGINAL_DOOR}`, "utf8"),
    );
    expect(original).toMatch(gate);
    expect(defs.get("begin_manual_import")?.body ?? "").toMatch(gate);
    expect(defs.get("begin_manual_import")?.body ?? "").toContain(
      "importing master data requires a planning, engineering or administrator role",
    );
  });
});

describe("there is one door, and the misroute is unreachable", () => {
  it("ingest_rows resolves the handler from the RUN, not from its caller", () => {
    const body = defs.get("ingest_rows")?.body ?? "";
    expect(body).toMatch(
      /select\s+cr\.entity_type\s+into\s+v_entity[\s\S]{0,80}?from\s+connector_runs/i,
    );
    expect(body).toMatch(/ingest_handler_for\s*\(\s*v_entity\s*\)/i);
  });

  it("it dispatches to both validators, by explicit branch and not dynamic SQL", () => {
    const body = defs.get("ingest_rows")?.body ?? "";
    expect(body).toContain("return public.ingest_batch(p_run_id, p_rows)");
    expect(body).toContain(
      "return public.ingest_context_batch(p_run_id, p_rows)",
    );
    expect(body).not.toMatch(/execute\s+format/i);
  });

  it("it fails fast on an unroutable run instead of refusing every row", () => {
    const body = defs.get("ingest_rows")?.body ?? "";
    expect(body).toContain("no ingest handler for entity type");
    expect(body).toContain("ingest_supported_entity_types()");
  });

  it("it re-states the tenant filter, because SECURITY DEFINER turns RLS off", () => {
    const body = defs.get("ingest_rows")?.body ?? "";
    expect(body).toMatch(/v_org\s+uuid\s*:=\s*app_current_org\(\)/i);
    expect(body).toMatch(/organization_id\s*=\s*v_org/i);
    expect(body).toContain("no organization in session");
  });

  it("the validators are no longer callable by authenticated at all", () => {
    // While they were, a caller could open an operating_state run and hand it
    // to ingest_batch, which rejects every row with a message blaming the
    // customer's data. Closing the grant is what makes that impossible rather
    // than merely unlikely.
    for (const fn of ["ingest_batch", "ingest_context_batch"]) {
      expect(routerSql).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}\\s*\\(uuid,\\s*jsonb\\)\\s+from\\s+public,\\s*anon,\\s*authenticated;`,
          "i",
        ),
      );
    }
    expect(routerSql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.ingest_rows\(uuid,\s*jsonb\)\s+to\s+authenticated;/i,
    );
  });

  it("mutation-sanity — the revoke assertion does not match a grant", () => {
    expect(
      /revoke\s+all\s+on\s+function\s+public\.ingest_batch\s*\(uuid,\s*jsonb\)\s+from\s+public,\s*anon,\s*authenticated;/i.test(
        "grant execute on function public.ingest_batch(uuid, jsonb) to authenticated;",
      ),
    ).toBe(false);
  });

  it("Recovery's signal ingest is deliberately NOT routed here", () => {
    // ingest_recovery_signal_batch (20261002100000) also consumes connector
    // runs, but demands connector_type = 'recovery_signal' and carries a
    // different authority gate. Routing it through the manual door would open a
    // run that function refuses.
    const routes = sqlRoutes();
    expect(routes.operational_constraint_signal).toBeUndefined();
    expect(routerSql).not.toContain("ingest_recovery_signal_batch");
  });
});

describe("condition readings are written exactly once", () => {
  it("ingest_batch no longer inserts a reading itself", () => {
    // It inserted the row AND called record_condition_reading, which inserts
    // too: every ingested reading was stored twice, and the second copy carried
    // no external_id so it sat outside the idempotency index entirely.
    const body = defs.get("ingest_batch")?.body ?? "";
    expect(defs.get("ingest_batch")?.file).toBe(
      "20261004090100_condition_reading_written_once.sql",
    );
    expect(body).not.toContain("insert into condition_readings");
    expect(body).toMatch(
      /perform\s+record_condition_reading\([\s\S]{0,200}?v_source,\s*v_ext\)/,
    );
  });

  it("and the one writer carries the external id", () => {
    const body = defs.get("record_condition_reading")?.body ?? "";
    expect(body).toContain("source_system, external_id");
    expect(body).toContain("p_source_system, p_external_id);");
  });

  it("the other validator never inserted a reading, and still does not", () => {
    expect(defs.get("ingest_context_batch")?.body ?? "").not.toContain(
      "insert into condition_readings",
    );
  });
});

describe("what the surface promises matches what the contract does", () => {
  const dedupeByExternalId: IngestEntityKey[] = [
    "work_order",
    "condition_reading",
    "operating_state",
    "production_record",
    "schedule_activity",
  ];

  it("the five types that SKIP a re-upload say so, and the three that UPDATE say so", () => {
    // The shipped importer told every user "a re-upload updates rather than
    // duplicates". That is true of the three whose branch ends in `on conflict
    // ... do update` — maintenance_plan, maintenance_notification and
    // material_stock — and false of the other FOUR, which take the
    // `v_dup := v_dup + 1; continue;` path. A single sentence was a false
    // statement on four of seven types. The counts here are asserted below
    // against the SQL branches, not against this comment.
    for (const key of dedupeByExternalId) {
      expect(INGEST_ENTITIES[key].reupload, key).toBe("skips");
      expect(INGEST_ENTITIES[key].reuploadSentence).toContain("DUPLICATE");
    }
    expect(INGEST_ENTITIES.maintenance_notification.reupload).toBe("updates");
    expect(INGEST_ENTITIES.maintenance_plan.reupload).toBe("updates");
    expect(INGEST_ENTITIES.material_stock.reupload).toBe("updates");
    for (const key of [
      "maintenance_plan",
      "material_stock",
      "maintenance_notification",
    ] as const) {
      expect(INGEST_ENTITIES[key].reuploadSentence).toContain("UPDATES");
    }
  });

  it("the skip-on-re-upload types are exactly the ones whose SQL branch increments v_dup", () => {
    for (const [key, entity] of Object.entries(INGEST_ENTITIES)) {
      const body = defs.get(entity.handler)?.body ?? "";
      const branch = body.slice(body.indexOf(`r.entity_type = '${key}'`));
      const next = branch.search(
        /elsif\s+v_reason\s+is\s+null\s+and\s+r\.entity_type/,
      );
      const own = next === -1 ? branch : branch.slice(0, next);
      const skips = /v_dup\s*:=\s*v_dup\s*\+\s*1/.test(own);
      expect(
        skips,
        `${key}: SQL ${skips ? "skips" : "does not skip"} but the surface says ${entity.reupload}`,
      ).toBe(entity.reupload === "skips");
    }
  });

  it("the two types with no customer-reachable prerequisite loader say so before upload", () => {
    // Nothing in src/ inserts a sensor or a material — they arrive by seed or
    // by service-role provisioning only. Widening the door for these two
    // without saying it produces a screen that refuses every row of a new
    // tenant's first file.
    expect(INGEST_ENTITIES.condition_reading.prerequisite).toContain("sensors");
    expect(INGEST_ENTITIES.material_stock.prerequisite).toContain("catalogue");
    for (const key of [
      "maintenance_plan",
      "work_order",
      "operating_state",
      "production_record",
    ] as const) {
      expect(INGEST_ENTITIES[key].prerequisite, key).toBeUndefined();
    }
  });

  it("operating_state says an overlapping period is refused, because it is", () => {
    // The external_id de-duplication only compares an upload against previous
    // UPLOADS: states loaded by a fleet-history import carry that import's own
    // source name and are invisible to it. Until 20261004090200 nothing else
    // stopped two simultaneous states on one machine, and three rows covering
    // one 24-hour day were all accepted — 60 state-hours in a 24-hour day. The
    // sentence and the validator have to say the same thing.
    const caution = INGEST_ENTITIES.operating_state.caution ?? "";
    expect(caution).toContain("ONE state at a time");
    expect(caution).toContain("REFUSED");
    const body = defs.get("ingest_context_batch")?.body ?? "";
    expect(body).toContain("overlaps a state already recorded for this asset");
    expect(body).toMatch(/tstzrange\([\s\S]{0,120}?&&\s*tstzrange/);
  });

  it("production_record warns that mixed units disable cost per unit entirely", () => {
    expect(INGEST_ENTITIES.production_record.caution ?? "").toContain(
      "ONE unit of measure",
    );
  });

  it("only maintenance_plan synthesises an identity, and admits what that costs", () => {
    for (const [key, entity] of Object.entries(INGEST_ENTITIES)) {
      expect(Boolean(entity.synthesiseExternalId), key).toBe(
        key === "maintenance_plan",
      );
    }
    expect(INGEST_ENTITIES.maintenance_plan.caution ?? "").toContain(
      "positional id",
    );
  });
});

/**
 * The write path, not just the door.
 *
 * 20260907090000 put the role gate on run CREATION only, and connector_runs'
 * RLS policy (20260917000000:372) is org-wide rather than actor-scoped — so any
 * member of the tenant can read a run id opened for someone else. Measured on a
 * full schema before this was closed: a technician the door had just refused
 * read a planner's run id and pushed two 0.2 readings through it, taking
 * `Vibration — Drive End` from 12.4 / alarm to 0.2 / normal. The door said no
 * and the write said yes.
 */
describe("the gate is on the write, not only on the door", () => {
  const GATE =
    /select\s+role\s+into\s+v_role\s+from\s+user_profiles\s+where\s+id\s*=\s*auth\.uid\(\);\s*if\s+coalesce\(v_role,\s*''\)\s+not\s+in\s*\(\s*'planner','reliability_engineer','maintenance_manager','admin','ai_admin'\s*\)\s+then/i;

  it("ingest_rows applies the SAME five-role gate as begin_manual_import", () => {
    const router = defs.get("ingest_rows")?.body ?? "";
    const door = defs.get("begin_manual_import")?.body ?? "";
    expect(door.replace(/\s+/g, " ")).toMatch(GATE);
    expect(router.replace(/\s+/g, " ")).toMatch(GATE);
    expect(router).toContain(
      "importing master data requires a planning, engineering or administrator role",
    );
  });

  it("mutation-sanity — the gate pattern does not match a four-role list", () => {
    expect(
      GATE.test(
        "select role into v_role from user_profiles where id = auth.uid(); " +
          "if coalesce(v_role, '') not in ('planner','reliability_engineer','admin','ai_admin') then",
      ),
    ).toBe(false);
  });

  it("ingest_rows only accepts a run this door opened", () => {
    // Rows are stamped with the run's connector_key as source_system, so
    // accepting any run in the tenant let a caller write work orders that read
    // as SAP history — and four seeded connectors have a NULL connector_key,
    // which defeats the `source_system = v_source` dedupe predicate outright
    // (three identical uploads landed three rows). ingest_recovery_signal_batch
    // makes exactly this check at 20261002100000; it is copied, not invented.
    const body = (defs.get("ingest_rows")?.body ?? "").replace(/\s+/g, " ");
    expect(body).toMatch(
      /join\s+connectors\s+c\s+on\s+c\.id\s*=\s*cr\.connector_id/i,
    );
    expect(body).toMatch(/c\.connector_type\s*=\s*'manual_upload'/i);
    expect(body).toMatch(/c\.connector_key\s+is\s+not\s+null/i);
  });

  it("the door only ever builds manual_upload connectors, so the two agree", () => {
    expect(defs.get("begin_manual_import")?.body ?? "").toContain(
      "'manual_upload'",
    );
  });
});

/**
 * One bad cell must not take the file with it.
 *
 * Measured before this landed: a notification_type of "malfunction" left 0 rows
 * written, 0 rejects RETAINED, counters 0/0/0 and the run stuck `running`; a
 * load_pct of -5 — a perfectly castable number that violates a CHECK — did the
 * same to an operating-state file. "Every refused row is kept with its reason"
 * was false for the most common spreadsheet defect there is.
 */
describe("a row the database refuses is a reject, not a lost batch", () => {
  for (const fn of [
    "ingest_batch",
    "ingest_context_batch",
    "ingest_schedule_batch",
  ] as const) {
    it(`${fn} wraps every per-row write in a subtransaction`, () => {
      const body = defs.get(fn)?.body ?? "";
      expect(body).toMatch(/exception\s+when\s+unique_violation\s+then/i);
      expect(body).toContain("the database refused this row: %s");
      // The retained-reject insert must sit OUTSIDE the handler, or the
      // rollback that saves the batch would take the explanation with it.
      const handler = body.indexOf("when others then");
      const retained = body.indexOf("'rejected', v_reason)");
      expect(handler).toBeGreaterThan(-1);
      expect(retained).toBeGreaterThan(handler);
    });
  }

  it("a concurrent run's duplicate is named as one, not as an index", () => {
    // The unique index is the real idempotency guarantee; the `exists` check is
    // an optimisation, and two overlapping runs can land between the two.
    for (const fn of [
      "ingest_batch",
      "ingest_context_batch",
      "ingest_schedule_batch",
    ] as const) {
      expect(defs.get(fn)?.body ?? "").toContain(
        "already loaded — another run wrote this external_id while this one was in flight",
      );
    }
  });

  it("mutation-sanity — the assertion is about the CURRENT bodies", () => {
    expect(defs.get("ingest_batch")?.file).toBe(
      "20261004090100_condition_reading_written_once.sql",
    );
    expect(defs.get("ingest_context_batch")?.file).toBe(CONTEXT_FIX);
    expect(defs.get("ingest_schedule_batch")?.file).toBe(
      SCHEDULE_VALIDATOR_HOME,
    );
  });
});

/**
 * A column with a CHECK and no client allowlist is a value the operator can
 * only learn about from a Postgres error. This is the rediscovering guard:
 * it reads the CHECK lists out of the CREATE TABLE statements rather than
 * restating them, so a constraint added later fails here.
 */
describe("every enumerated CHECK the surface exposes is in the descriptor", () => {
  const TABLE_FOR: Record<IngestEntityKey, string> = {
    maintenance_plan: "maintenance_plans",
    maintenance_notification: "maintenance_notifications",
    work_order: "work_orders",
    condition_reading: "condition_readings",
    material_stock: "material_stock",
    operating_state: "operating_states",
    production_record: "production_records",
    schedule_activity: "shutdown_tasks",
  };

  it("the entity-to-table map matches what the validator actually inserts into", () => {
    for (const [key, table] of Object.entries(TABLE_FOR)) {
      const entity = INGEST_ENTITIES[key as IngestEntityKey];
      const body = defs.get(entity.handler)?.body ?? "";
      const branch = body.slice(body.indexOf(`r.entity_type = '${key}'`));
      const next = branch.search(
        /elsif\s+v_reason\s+is\s+null\s+and\s+r\.entity_type/,
      );
      const own = next === -1 ? branch : branch.slice(0, next);
      const writes =
        own.includes(`insert into ${table} `) ||
        own.includes(`insert into ${table}(`) ||
        own.includes(`insert into ${table}\n`) ||
        // condition_reading is written by record_condition_reading, on purpose.
        (key === "condition_reading" &&
          own.includes("perform record_condition_reading"));
      expect(writes, `${key} does not write ${table}`).toBe(true);
    }
  });

  it("mutation-sanity — the CHECK reader finds the constraints it should", () => {
    expect(
      enumeratedChecks("maintenance_notifications").notification_type,
    ).toEqual(["fault", "observation", "request", "safety"]);
    expect(enumeratedChecks("operating_states").state).toContain(
      "down_unplanned",
    );
    expect(enumeratedChecks("work_orders")).toEqual({});
  });

  for (const key of INGEST_ENTITY_ORDER) {
    it(`${key} declares oneOf for every CHECK-constrained column it exposes`, () => {
      const entity = INGEST_ENTITIES[key];
      const checks = enumeratedChecks(TABLE_FOR[key]);
      for (const col of entity.columns) {
        const allowed = checks[col.name];
        if (!allowed) continue;
        expect(
          col.oneOf,
          `${key}.${col.name} has a CHECK in the database and no oneOf here: ` +
            `"${allowed[0]}" is enforceable but a plausible neighbour is not, ` +
            `and the operator would see a raw constraint name instead of a row`,
        ).toBeDefined();
        expect([...(col.oneOf ?? [])].sort()).toEqual([...allowed].sort());
      }
    });
  }
});

/**
 * Grants, in both directions. A grant that exists only because of a Supabase
 * platform default is a grant nobody can read in the migration — a review of
 * this branch read exactly that wrong and reported service_role as locked out.
 */
describe("who may call what is stated, not inherited", () => {
  it("service_role keeps the whole contract, explicitly", () => {
    for (const sig of [
      "ingest_batch\\(uuid, jsonb\\)",
      "ingest_context_batch\\(uuid, jsonb\\)",
      "ingest_rows\\(uuid, jsonb\\)",
    ]) {
      expect(routerSql).toMatch(
        new RegExp(
          `grant execute on function public\\.${sig} to service_role;`,
          "i",
        ),
      );
    }
  });

  it("the two functions anon could call are revoked from public and anon", () => {
    // 20260907090000:125 and 20260810160000:487 granted to `authenticated`
    // without the `revoke ... from public, anon` this repository uses
    // everywhere else, so both were executable by PUBLIC.
    for (const sig of [
      "get_import_rejects\\(uuid, int\\)",
      "finish_connector_run\\(uuid, text, text\\)",
    ]) {
      expect(routerSql).toMatch(
        new RegExp(
          `revoke all on function public\\.${sig} from public, anon;`,
          "i",
        ),
      );
      expect(routerSql).toMatch(
        new RegExp(
          `grant execute on function public\\.${sig} to authenticated;`,
          "i",
        ),
      );
    }
  });

  it("the context validator's own file revokes it too, after the replace", () => {
    // 20261004090200 does a create-or-replace, which PRESERVES the ACL — but a
    // future drop-and-recreate would not, so the revoke is restated there.
    const sql = stripComments(readFileSync(`${DIR}/${CONTEXT_FIX}`, "utf8"));
    expect(sql).toMatch(
      /revoke all on function public\.ingest_context_batch\(uuid, jsonb\) from public, anon, authenticated;/i,
    );
  });

  it("the schedule validator ships closed on day one: router-only, service explicit", () => {
    // Its two peers were opened to `authenticated` first and closed later
    // (20261004090000); this one is born under the final regime.
    const sql = stripComments(
      readFileSync(`${DIR}/${SCHEDULE_IMPORT}`, "utf8"),
    );
    expect(sql).toMatch(
      /revoke all on function public\.ingest_schedule_batch\(uuid, jsonb\) from public, anon, authenticated;/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.ingest_schedule_batch\(uuid, jsonb\) to service_role;/i,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.ingest_schedule_batch\(uuid, jsonb\) to authenticated/i,
    );
    // And the router it is reached through keeps its own ACL restated there.
    expect(sql).toMatch(
      /grant execute on function public\.ingest_rows\(uuid, jsonb\) to authenticated;/i,
    );

    // The re-creation carries the same regime. `create or replace` preserves
    // an ACL, so a file that re-created the body and stayed silent about the
    // grants would leave the closed posture resting on a migration nobody
    // reads any more — and a later drop-and-recreate would open it.
    const home = stripComments(
      readFileSync(`${DIR}/${SCHEDULE_VALIDATOR_HOME}`, "utf8"),
    );
    expect(home).toMatch(
      /revoke all on function public\.ingest_schedule_batch\(uuid, jsonb\) from public, anon, authenticated;/i,
    );
    expect(home).toMatch(
      /grant execute on function public\.ingest_schedule_batch\(uuid, jsonb\) to service_role;/i,
    );
    expect(home).not.toMatch(
      /grant execute on function public\.ingest_schedule_batch\(uuid, jsonb\) to authenticated/i,
    );
  });

  it("non-finite numerics and dates are refused twice: validator by name, table by check", () => {
    // Postgres parses 'NaN' and '±Infinity' as VALID numeric (and 'infinity'
    // as a valid timestamptz), and NaN sorts above every number — so a
    // cast-inside-exception plus a sign check accepts all of them as clean
    // data. Found live by the data-integrity pass: NaN durations and
    // infinite windows landed as `accepted` and were watermark-eligible.
    // The refusal must exist in BOTH layers, because the validator only
    // binds door traffic while the check binds every writer.
    const body = (defs.get("ingest_schedule_batch")?.body ?? "").replace(
      /\s+/g,
      " ",
    );
    expect(body).toMatch(/v_dur = 'NaN'::numeric/i);
    expect(body).toMatch(/v_dur = 'Infinity'::numeric/i);
    expect(body).toMatch(/v_dur = '-Infinity'::numeric/i);
    expect(body).toMatch(/must be a finite number of hours/i);
    expect(body).toMatch(/not isfinite\(v_start\)/i);
    expect(body).toMatch(/not isfinite\(v_finish\)/i);
    const sql = stripComments(
      readFileSync(`${DIR}/${SCHEDULE_IMPORT}`, "utf8"),
    ).replace(/\s+/g, " ");
    // The duration check is REPLACED strictly tighter, same name — and the
    // window check requires finite-or-null per column, not just ordering.
    expect(sql).toMatch(
      /add constraint shutdown_tasks_duration_hours_check\s+check \(duration_hours >= 0 and duration_hours < 'Infinity'::numeric\)/i,
    );
    expect(sql).toMatch(/isfinite\(planned_start\)/i);
    expect(sql).toMatch(/isfinite\(planned_finish\)/i);
  });
});

/**
 * The watermark rule was stated as a property and enforced by one call site.
 */
describe("the watermark advances only on a genuinely clean run", () => {
  it("finish_connector_run consults records_rejected, not just the status argument", () => {
    const body = (defs.get("finish_connector_run")?.body ?? "").replace(
      /\s+/g,
      " ",
    );
    expect(body).toMatch(
      /if p_status = 'success' and r\.records_rejected = 0 and r\.watermark_to is not null then/i,
    );
    expect(body).toMatch(
      /'watermark_advanced', p_status = 'success' and r\.records_rejected = 0/i,
    );
  });

  it("and the browser still sends partial, so the two agree rather than one covering for the other", () => {
    const tsx = readFileSync("src/components/ContractImport.tsx", "utf8");
    expect(tsx).toContain('totals.rejected > 0 ? "partial" : "success"');
  });
});

/**
 * History is not state. record_condition_reading was written for keyed-in
 * readings, where every reading is by definition current.
 */
describe("a historian backfill does not rewrite the live condition picture", () => {
  it("only a reading at or after the series head touches sensors or alerts", () => {
    const body = defs.get("record_condition_reading")?.body ?? "";
    expect(body).toMatch(
      /select\s+value,\s*taken_at\s+into\s+v_prev,\s*v_prev_at\s+from\s+condition_readings/i,
    );
    expect(body).toMatch(
      /if\s+v_prev_at\s+is\s+not\s+null\s+and\s+p_taken_at\s*<\s*v_prev_at\s+then/i,
    );
    // The guard must sit between the INSERT and the alert/limit evaluation:
    // the reading is stored either way, and only the present is protected.
    const insert = body.indexOf("insert into condition_readings");
    const guard = body.indexOf("'historical', true");
    const sensorUpdate = body.indexOf("update sensors");
    expect(insert).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(insert);
    expect(sensorUpdate).toBeGreaterThan(guard);
  });

  it("the surface says what loading history does, before the upload", () => {
    const caution = INGEST_ENTITIES.condition_reading.caution ?? "";
    expect(caution).toContain("ONLY THE NEWEST READING");
  });
});
