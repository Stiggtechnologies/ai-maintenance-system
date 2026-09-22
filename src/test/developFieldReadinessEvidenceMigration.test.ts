/**
 * D7.12 — the final three field-readiness elements become evidence-derived.
 * Static contract; the database transcript exercises the behaviour.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIELD_READY_ELEMENTS,
  fieldReadyCoverage,
} from "../lib/develop/fieldReadiness";
import { stripComments } from "./support/migrationPolicies";

const FILE = "20261220140000_develop_field_readiness_evidence.sql";
const raw = readFileSync(`supabase/migrations/${FILE}`, "utf8");
const sql = stripComments(raw);
const historicalRecord = readFileSync(
  "supabase/migrations/20261211090100_develop_field_readiness_record.sql",
  "utf8",
);

function body(name: string): string {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", at);
  expect(end, `${name} terminator not found`).toBeGreaterThan(at);
  return sql.slice(at, end);
}

describe("D7.12 canonical field-readiness evidence", () => {
  it("extends the work identity without inventing another verdict or release door", () => {
    for (const forbidden of [
      "field_readiness_verdicts",
      "readiness_approvals",
      "readiness_queue",
      "readiness_calculations",
    ]) {
      expect(sql).not.toMatch(
        new RegExp(`create table if not exists public\\.${forbidden}\\b`),
      );
    }
    expect(sql).not.toContain(
      "create or replace function public.sync_work_package_release_verdict(",
    );
    expect(sql).not.toContain(
      "create or replace function public.release_work_package(",
    );
  });

  it("adds exactly the three missing organization-scoped evidence stores", () => {
    const tables = [
      ...sql.matchAll(/create table if not exists public\.(\w+)/g),
    ].map((m) => m[1]);
    expect(tables.sort()).toEqual([
      "work_face_access_evidence",
      "work_order_crew_assignments",
      "work_order_predecessor_evidence",
    ]);
    for (const table of tables) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toMatch(
        new RegExp(
          `create policy ${table.replace(/work_order_crew_assignments/, "work_order_crew_assignments").replace(/work_face_access_evidence/, "work_face_access_evidence").replace(/work_order_predecessor_evidence/, "work_order_predecessor_evidence")}_read[\\s\\S]*organization_id = public\\.app_current_org\\(\\)`,
        ),
      );
    }
    expect(sql).toContain("revoke insert, update, delete, truncate");
    expect(sql).toContain("from public, anon, authenticated, service_role");
  });

  it("keeps evidence writes human-authored and incapable of releasing work", () => {
    expect(body("enforce_field_readiness_evidence_integrity")).toContain(
      "coalesce(v_actor_role,'')='ai_admin'",
    );
    for (const fn of [
      "assign_work_order_crew",
      "record_work_face_access",
      "record_work_order_predecessor",
    ]) {
      const fnBody = body(fn);
      expect(fnBody).toContain("v_role text:=public.app_current_role()");
      expect(fnBody).not.toContain("ai_admin");
      expect(fnBody).not.toContain("release_work_package");
      expect(fnBody).not.toMatch(/update\s+public\.work_packages/i);
    }
  });

  it("requires verified same-tenant provenance for access and sequencing", () => {
    const wall = body("enforce_field_readiness_evidence_integrity");
    expect(wall).toContain("e.organization_id=new.organization_id");
    expect(wall).toContain("e.verification_status='verified'");
    expect(wall).toContain("a.assessment_type='access_route'");
    expect(wall).toContain("a.status='verified'");
    expect(wall).toContain(
      "predecessor and successor work orders must belong to the same organization",
    );
  });

  it("models predecessor absence explicitly and refuses cycles", () => {
    expect(sql).toContain("dependency_kind in ('finish_to_start', 'explicit_none')");
    expect(sql).toContain("work_order_predecessor_not_self");
    expect(sql).toContain("with recursive walk(id)");
    expect(sql).toContain("would create a cycle");
    expect(sql).toContain(
      "explicit-none predecessor evidence cannot coexist with active predecessor edges",
    );
    expect(body("sync_field_readiness_predecessor_element")).toContain(
      "absence of an edge is not evidence that none exists",
    );
  });

  it("derives crew from assignment, roster and competency through the work window", () => {
    const crew = body("sync_field_readiness_crew_element");
    for (const source of [
      "work_order_crew_assignments",
      "workforce_members",
      "shift_assignments",
      "competency_requirements",
      "member_competencies",
    ]) {
      expect(crew).toContain(source);
    }
    expect(crew).toContain("s.starts_at<=a.starts_at");
    expect(crew).toContain("s.ends_at>=a.ends_at");
    expect(crew).toContain("mc.expires_on>=a.ends_at::date");
  });

  it("makes all ten client vocabulary elements derived from canonical stores", () => {
    expect(FIELD_READY_ELEMENTS).toHaveLength(10);
    expect(fieldReadyCoverage()).toEqual({ total: 10, derived: 10, declared: 0 });
    expect(FIELD_READY_ELEMENTS.every((e) => e.source.length > 3)).toBe(true);
    expect(raw).toContain("sync_field_readiness_crew_element(w.id)");
    expect(raw).toContain("sync_field_readiness_access_element(w.id)");
    expect(raw).toContain("sync_field_readiness_predecessor_element(w.id)");
  });

  it("traceably replaces legacy machine questions during reassessment", () => {
    expect(raw).toContain(
      "source_ref similar to 'awp-field-ready:declared:(crew|access|predecessor):%'",
    );
    expect(historicalRecord).toContain(
      "returning id, source_ref, state, verified_by",
    );
    expect(raw).toContain("neither legacy nor canonical replacement anchor found");
    expect(raw).toContain("v_unverifiable := v_unverifiable + 1;");
    expect(raw).toContain(
      "refusing D7.12 unverifiable counter patch: derived-question counter anchor not found",
    );
  });

  it("distinguishes a clean computed assessment from an untouched package", () => {
    expect(raw).toContain("if v_total = 0 and not exists (");
    expect(raw).toContain("assessed.calculation_key = 'package_field_readiness'");
    expect(raw).toContain("assessed.status = 'computed'");
    expect(raw).toContain(
      "refusing D7.12 release-verdict patch: unassessed anchor not found",
    );
  });

  it("closes the downstream workface caveat and Sync Field open-parts list", () => {
    expect(raw).toContain(
      "required canonical evidence is missing, expired or insufficient",
    );
    expect(raw).toContain("'openParts', '[]'::jsonb");
    expect(raw).toContain("D7.06, D7.07 and D7.12 are closed");
    expect(raw).toContain("public.get_sync_field_module(uuid,integer)");
  });
});
