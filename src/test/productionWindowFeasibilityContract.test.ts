import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./support/migrationPolicies";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20270105165300_schedule_production_window_feasibility.sql",
  ),
  "utf8",
);

describe("C8.08 production-window schedule feasibility contract", () => {
  it("extends the one schedule door over the canonical operating-context feed", () => {
    expect(migration).toContain(
      "create or replace function public.evaluate_schedule_feasibility",
    );
    expect(migration).toMatch(/join public\.operational_constraint_signals s/);
    expect(migration).toContain("s.signal_kind = 'production'");
    expect(migration).toContain("from public.work_orders w");
    expect(migration).not.toMatch(
      /create table(?: if not exists)? public\.(?:production_window|schedule_constraint)/i,
    );
  });

  it("preserves tenant and exact scheduled-work boundaries", () => {
    expect(migration).toContain("v_org uuid := public.app_current_org()");
    expect(migration).toContain("w.organization_id = v_org");
    expect(migration).toContain("s.organization_id = v_org");
    expect(migration).toContain("o.organization_id = v_org");
    expect(migration).toContain("w.id = any");
  });

  it("uses asset then site then organization evidence specificity", () => {
    expect(migration).toContain("s.asset_id = sw.asset_id then 2");
    expect(migration).toContain("s.site_id = sw.site_id then 1");
    expect(migration).toContain(
      "order by c.scope_rank desc, c.observed_at desc, c.signal_id desc",
    );
    expect(migration).toContain("partition by c.work_order_id, c.signal_key");
  });

  it("never promotes missing, unknown, stale or partial evidence to a pass", () => {
    expect(migration).toContain(
      "x.observed_at <= v_window_start and x.valid_until >= v_window_end",
    );
    expect(migration).toContain(
      "s.signal_state = 'unavailable' and s.overlaps_week",
    );
    expect(migration).toContain(
      "when count(s.signal_id) = 0 then 'not_assessable'",
    );
    expect(migration).toContain(
      "when bool_and(s.signal_state = 'available' and s.covers_week)",
    );
    expect(migration).toContain(
      "Missing, unknown, stale and partial-window evidence are neither a conflict nor a clearance.",
    );
  });

  it("keeps the production decision advisory and human-acknowledged", () => {
    expect(migration).toContain("'mayReleaseSchedule', false");
    expect(migration).toContain("'mayApproveProductionInterruption', false");
    expect(migration).toContain("'requiresHumanWarningAcknowledgement', true");
    expect(migration).toContain("and not p_acknowledge_warnings");
    expect(migration).toContain(
      "grant execute on function public.release_schedule_option(uuid, boolean)",
    );
    expect(migration).toMatch(
      /revoke all on function public\.release_schedule_option\(uuid\)[\s\S]*?authenticated, service_role/,
    );
  });

  it("refuses ai_admin by name before any human release role is considered", () => {
    const start = migration.indexOf(
      "create or replace function public.release_schedule_option(",
    );
    const end = migration.indexOf(
      "revoke all on function public.release_schedule_option(uuid, boolean)",
    );
    const body = migration.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    expect(body).toMatch(/coalesce\(v_role,\s*''\)\s*=\s*'ai_admin'/);
    expect(body).toContain("§70 human act");
    expect(body).toContain(
      "The AI-operator identity may prepare a schedule option; it may not freeze the week or authorize a production interruption.",
    );
    expect(body).not.toContain(
      "'planner', 'maintenance_manager', 'admin', 'ai_admin'",
    );
    expect(body).toContain(
      "coalesce(v_role, '') not in ('planner', 'maintenance_manager', 'admin')",
    );

    const refusal = body.indexOf("= 'ai_admin'");
    const allow = body.indexOf(
      "not in ('planner', 'maintenance_manager', 'admin')",
    );
    expect(refusal).toBeGreaterThan(-1);
    expect(allow).toBeGreaterThan(refusal);

    const panel = fs.readFileSync(
      path.join(root, "src/components/SchedulerPanel.tsx"),
      "utf8",
    );
    const roles = panel.slice(
      panel.indexOf("const RELEASE_ROLES"),
      panel.indexOf("const DAYS"),
    );
    expect(roles).toContain('"planner"');
    expect(roles).toContain('"maintenance_manager"');
    expect(roles).toContain('"admin"');
    expect(roles).not.toContain("ai_admin");
  });

  it("prevents callers from bypassing the composed production arm", () => {
    expect(migration).toContain(
      "rename to evaluate_schedule_feasibility_core_20261212",
    );
    expect(migration).toMatch(
      /revoke all on function public\.evaluate_schedule_feasibility_core_20261212\(uuid\)[\s\S]*?authenticated, service_role/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.schedule_production_window_check\(uuid\[\], date\)[\s\S]*?authenticated, service_role/,
    );
    expect(migration).toContain(
      "where c.value->>'constraint' <> 'Production window'",
    );
  });
});

const DROP_MIGRATION = "20271020101000_drop_legacy_release_schedule_option.sql";
const LEGACY_DROP =
  "DROP FUNCTION IF EXISTS public.release_schedule_option(uuid);";

type ReleaseSignature = "uuid" | "uuid_boolean";

function classifyReleaseSignature(args: string): ReleaseSignature {
  const normalized = args.replace(/\s+/g, " ").trim().toLowerCase();
  const uuidCount = normalized.match(/\buuid\b/g)?.length ?? 0;
  const hasBoolean = /\bboolean\b/.test(normalized);
  if (uuidCount === 1 && hasBoolean) return "uuid_boolean";
  if (uuidCount === 1 && !hasBoolean) return "uuid";
  throw new Error(`Unrecognized release_schedule_option signature: ${args}`);
}

/**
 * Replay create/drop of release_schedule_option in filename order. Later
 * statements win, which is the chain a fresh database actually applies.
 */
function replayReleaseOverloads(): Record<ReleaseSignature, boolean> {
  const dir = path.join(root, "supabase/migrations");
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const live: Record<ReleaseSignature, boolean> = {
    uuid: false,
    uuid_boolean: false,
  };
  const pattern =
    /\b(?:create\s+(?:or\s+replace\s+)?function|drop\s+function(?:\s+if\s+exists)?)\s+(?:public\.)?release_schedule_option\s*\(([\s\S]*?)\)/gi;

  for (const file of files) {
    const sql = stripComments(fs.readFileSync(path.join(dir, file), "utf8"));
    const events = [...sql.matchAll(pattern)]
      .map((match) => ({
        index: match.index ?? 0,
        kind: /^create/i.test(match[0])
          ? ("create" as const)
          : ("drop" as const),
        signature: classifyReleaseSignature(match[1] ?? ""),
      }))
      .sort((a, b) => a.index - b.index);
    for (const event of events) {
      live[event.signature] = event.kind === "create";
    }
  }
  return live;
}

describe("legacy release_schedule_option(uuid) overload", () => {
  const dropSql = fs.readFileSync(
    path.join(root, "supabase/migrations", DROP_MIGRATION),
    "utf8",
  );

  it("is removed by a migration that sorts after the pending knowledge-graph head", () => {
    expect(DROP_MIGRATION.startsWith("20271020101000")).toBe(true);
    expect("20271020101000" > "20271020100800").toBe(true);
    expect(dropSql).toContain(LEGACY_DROP);
    expect(
      dropSql.match(
        /DROP FUNCTION IF EXISTS public\.release_schedule_option\(uuid\);/g,
      ),
    ).toEqual([LEGACY_DROP]);
  });

  it("does not replace, drop, or regrant the governed two-argument door", () => {
    const executable = stripComments(dropSql);
    expect(executable).not.toMatch(
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?release_schedule_option/i,
    );
    expect(executable).not.toMatch(
      /release_schedule_option\s*\(\s*uuid\s*,\s*boolean\s*\)/i,
    );
    expect(executable).not.toMatch(/\b(?:grant|revoke)\b/i);
    expect(migration).toMatch(/coalesce\(v_role,\s*''\)\s*=\s*'ai_admin'/);
    expect(migration).toContain(
      "coalesce(v_role, '') not in ('planner', 'maintenance_manager', 'admin')",
    );
  });

  it("leaves only release_schedule_option(uuid, boolean) in the migration chain", () => {
    expect(replayReleaseOverloads()).toEqual({
      uuid: false,
      uuid_boolean: true,
    });
  });
});
