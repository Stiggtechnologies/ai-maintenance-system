import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101530000_controlled_engineering_documents.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/controlledDocumentsService.ts",
  "utf8",
);
const component = readFileSync(
  "src/components/ControlledTechnicalDocuments.tsx",
  "utf8",
);
const parent = readFileSync("src/pages/KnowledgeBasePage.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-controlled-technical-documents-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("C2.09 controlled technical-document register", () => {
  it("extends the canonical upload register instead of creating a parallel repository", () => {
    expect(migration).toContain("alter table public.kb_intake_documents");
    expect(migration).not.toMatch(
      /create table if not exists public\.(drawings|manuals|technical_documents|inspection_records)/,
    );
    expect(migration).toContain("references public.standard_work(id)");
    expect(migration).toContain("references public.governance_standards(id)");
    expect(migration).toContain("references public.evidence_items(id)");
    expect(migration).toContain("references public.inspection_plans(id)");
  });

  it("covers every requested document family and exposes missing effective coverage", () => {
    for (const kind of [
      "'drawing'",
      "'pid'",
      "'manual'",
      "'procedure'",
      "'inspection_record'",
      "'engineering_standard'",
    ])
      expect(migration).toContain(kind);
    expect(migration).toContain("missingeffectivekinds");
    expect(component).toContain("No effective revision");
  });

  it("requires tenant-scoped named humans, separation of duties and AAL2 effectivity", () => {
    expect(migration).toContain("controlled_document_human_role_allowed");
    expect(migration).toContain("the ai operator is refused");
    expect(migration).toContain("v_doc.controlled_by=v_actor");
    expect(migration).toContain("app_actor_has_verified_mfa");
    expect(migration).toContain("app_current_aal()<>'aal2'");
    expect(migration).toContain("organization_id=v_org");
  });

  it("rechecks canonical procedure, standard and inspection evidence at decision time", () => {
    expect(migration).toContain("translation_status='human_verified'");
    expect(migration).toContain("t.verified_by is not null");
    expect(migration).toContain("s.status='adopted'");
    expect(migration).toContain("s.adopted_by is not null");
    expect(migration).toContain("e.verification_status='verified'");
    expect(migration).toContain("e.document_id=v_doc.id");
  });

  it("locks exact revisions, enforces one effective revision and retains supersession history", () => {
    expect(migration).toContain("kb_controlled_document_revision_unique");
    expect(migration).toContain("kb_controlled_document_one_effective");
    expect(migration).toContain("superseded_by_document_id");
    expect(migration).toContain("cannot be deleted or re-uploaded");
    expect(migration).toContain(
      "new.organization_id is distinct from old.organization_id",
    );
    expect(migration).toContain(
      "revoke insert,update,delete,truncate on public.kb_intake_documents",
    );
  });

  it("is operable from the knowledge workspace without granting operational authority", () => {
    expect(service).toContain('"register_controlled_technical_document"');
    expect(service).toContain('"review_controlled_technical_document"');
    expect(component).toContain("Controlled technical documents");
    expect(component).toContain("operationalAuthorization !== false");
    expect(parent).toContain("<ControlledTechnicalDocuments");
  });

  it("has a full-chain runtime contract in CI", () => {
    for (const proof of [
      "canonical_upload_register=true",
      "six_document_families=true",
      "named_human_only=true",
      "ai_operator_refused=true",
      "tenant_wall=true",
      "independent_aal2_effectivity=true",
      "canonical_procedure_gate=true",
      "canonical_standard_gate=true",
      "canonical_inspection_gate=true",
      "one_effective_revision=true",
      "atomic_supersession=true",
      "direct_write_locked=true",
      "reupload_locked=true",
      "audit_history=true",
      "operational_authority=false",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-controlled-technical-documents-smoke.sh",
    );
  });
});
