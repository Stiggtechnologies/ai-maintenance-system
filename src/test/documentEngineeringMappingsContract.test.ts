import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  documentMappingEntityTypes,
  documentMappingRelationships,
} from "../lib/engineering-knowledge/document-mappings";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20271020100100_document_engineering_mappings.sql",
  ),
  "utf8",
);
const humanAuthority = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20271020100700_mapping_review_human_authority.sql",
  ),
  "utf8",
);
const ci = fs.readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8");

describe("document engineering mapping persistence", () => {
  it("extends the existing mapping table and does not create a second corpus", () => {
    expect(migration).toContain("engineering_knowledge_mappings");
    expect(migration).not.toMatch(/create table[^;]*reliability_kb/i);
    expect(migration).not.toMatch(/create table[^;]*vector/i);
    expect(migration).not.toMatch(/embedding\s+vector/i);
    for (const entityType of documentMappingEntityTypes) {
      expect(migration).toContain(`'${entityType}'`);
    }
    for (const relationship of documentMappingRelationships) {
      expect(migration).toContain(`'${relationship}'`);
    }
  });

  it("keeps writes steward-only, tenant-scoped, and non-authorizing", () => {
    expect(migration).toContain("app_current_org()");
    expect(migration).toContain("app_is_knowledge_steward()");
    expect(migration).toContain("Source not found in current organization");
    expect(migration).toContain(
      "Mapping provenance references a chunk outside the governed source",
    );
    expect(migration).toContain(
      "AI-generated material cannot be approved as an authoritative mapping",
    );
    expect(migration).toContain("'grantsAuthority', false");
    expect(migration).toContain("'grantsWorkRelease', false");
    expect(migration).toContain("'grantsApproval', false");
    expect(migration).not.toMatch(
      /insert\s+into\s+(public\.)?(approval_workflows|autonomous_actions|autonomous_decisions|work_orders)\b/i,
    );
    expect(migration).toContain(
      "revoke all on function public.persist_document_engineering_mappings(uuid, jsonb) from public, anon",
    );
    expect(migration).toContain("set search_path = public");
  });

  it("refuses ai_admin approval and unreasoned changes to an approved mapping", () => {
    for (const sql of [migration, humanAuthority]) {
      expect(sql).toContain(
        "ai_admin cannot set a mapping review state other than draft",
      );
      expect(sql).toContain(
        "Changing an approved mapping requires an explicit reason",
      );
      expect(sql).toContain("review_change_reason");
      expect(sql).toContain("app_current_role() = 'ai_admin'");
    }
    expect(humanAuthority).toContain(
      "drop function if exists public.upsert_engineering_knowledge_mapping(uuid, text, text, text, numeric, text, uuid[])",
    );
    expect(humanAuthority).toContain(
      "revoke all on function public.upsert_engineering_knowledge_mapping(uuid, text, text, text, numeric, text, uuid[], text) from public, anon",
    );
    expect(humanAuthority).toContain("set search_path = public");
    expect(humanAuthority).not.toMatch(
      /upsert_engineering_knowledge_mapping\s*\([^)]*organization/i,
    );
  });

  it("keeps organization-scoped read RLS and wires the slice smoke", () => {
    expect(migration).toContain("engineering_knowledge_mappings_target_idx");
    expect(ci).toContain("scripts/ci-ekg-slice-*.sh");
    expect(fs.existsSync("scripts/ci-ekg-slice-1-document-mappings.sh")).toBe(
      true,
    );
  });
});
