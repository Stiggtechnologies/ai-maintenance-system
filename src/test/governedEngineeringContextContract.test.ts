import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20271020100600_governed_engineering_context.sql",
  ),
  "utf8",
);

describe("governed engineering context contract", () => {
  it("reuses the canonical corpus and evidence table", () => {
    expect(migration).toContain("public.retrieve_kb_context");
    expect(migration).toContain("public.kb_untrusted_evidence_envelope");
    expect(migration).toContain("public.evidence_items");
    expect(migration).toContain("public.engineering_knowledge_mappings");
    expect(migration).toContain("public.engineering_knowledge_sources");
    expect(migration).not.toMatch(/create\s+table/i);
    expect(migration).not.toMatch(/embedding\s+vector/i);
    expect(migration).not.toMatch(/\bcontent\s+text\b/i);
    expect(migration).not.toMatch(
      /insert\s+into\s+(public\.)?(reliability_kb_chunks|evidence_items|approval_workflows|work_orders)\b/i,
    );
  });

  it("keeps retrieval inside the caller organization and withholds authority", () => {
    expect(migration).toContain("c.organization_id = public.app_current_org()");
    expect(migration).toContain("e.organization_id = v_org");
    expect(migration).toContain("s.organization_id = v_org");
    expect(migration).toContain("'humanApprovalRequired', true");
    expect(migration).toContain("'autonomousOperationalActionAllowed', false");
    expect(migration).toContain("'grantsWorkRelease', false");
    expect(migration).toContain("'grantsApprovalAuthority', false");
    expect(migration).toContain(
      "Physics results must reference a stored result, not carry a calculated value",
    );
    expect(migration).toContain(
      "revoke all on function public.engineering_context_visible_chunk(text, text)",
    );
    expect(migration).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.engineering_context_visible_chunk/i,
    );
    expect(migration).not.toMatch(/p_organization_id|p_org\b/i);
  });

  it("wires the slice smoke", () => {
    const ci = fs.readFileSync(
      path.resolve(".github/workflows/ci.yml"),
      "utf8",
    );
    expect(ci).toContain("scripts/ci-ekg-slice-*.sh");
    expect(fs.existsSync("scripts/ci-ekg-slice-6-context-package.sh")).toBe(
      true,
    );
  });
});
