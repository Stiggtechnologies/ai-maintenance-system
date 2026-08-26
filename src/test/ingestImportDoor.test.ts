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
 * from names exactly the same seven types with exactly the same handlers. A
 * future entity type added to one and not the other fails here, on the day it
 * lands, instead of in a customer's reject list.
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

const routerSql = stripComments(readFileSync(`${DIR}/${ROUTER}`, "utf8"));

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
    expect(Object.keys(routes).length).toBe(7);
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

  it("the two validators own disjoint sets — nothing is handled twice", () => {
    const batch = defs.get("ingest_batch")?.body ?? "";
    const context = defs.get("ingest_context_batch")?.body ?? "";
    for (const [key, handler] of Object.entries(routes)) {
      const other = handler === "ingest_batch" ? context : batch;
      expect(other, `${key} has a branch in both validators`).not.toContain(
        `r.entity_type = '${key}'`,
      );
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
      /select\s+entity_type\s+into\s+v_entity\s+from\s+connector_runs/i,
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
  ];

  it("the five types that SKIP a re-upload say so, and the two that UPDATE say so", () => {
    // The shipped importer told every user "a re-upload updates rather than
    // duplicates". That is true of maintenance_plan and material_stock and
    // false of the other five, which take the `v_dup := v_dup + 1; continue;`
    // path. A single sentence was a false statement on five of seven types.
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

  it("operating_state warns about the overlap a re-upload cannot detect", () => {
    // Manual uploads dedupe on (organization, source_system, external_id) with
    // source_system = 'manual-upload-operating_state'. States loaded by a
    // fleet-history import carry that import's own source name, so a manual
    // reload of the same period inserts a SECOND overlapping copy and nothing
    // in the schema prevents it.
    const caution = INGEST_ENTITIES.operating_state.caution ?? "";
    expect(caution).toContain("PREVIOUS UPLOADS");
    expect(caution).toContain("overlapping");
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
