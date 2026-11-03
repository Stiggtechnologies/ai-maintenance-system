import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271106170000_document_revision_control.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/documentRevisionService.ts", "utf8");
const component = readFileSync(
  "src/components/DocumentRevisionControl.tsx",
  "utf8",
);
const host = readFileSync("src/components/DataGovernance.tsx", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);
const row = register.split("\n").find((line) => line.startsWith("| E12.10 |"));

describe("E12.10 document revision control", () => {
  it("extends the canonical upload register instead of creating a parallel repository", () => {
    expect(migration).toContain("alter table public.kb_intake_documents");
    expect(migration).not.toMatch(
      /create table if not exists public\.(document_revisions|controlled_documents|document_revision_records)/,
    );
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("'document_revision'");
  });

  it("admits the governed classes and keeps engineering families on their own door", () => {
    for (const kind of [
      "'policy'",
      "'data_standard'",
      "'form'",
      "'specification'",
      "'work_instruction'",
    ])
      expect(migration).toContain(kind);
    expect(migration).toContain(
      "engineering document families stay on the technical-document door",
    );
    expect(migration).toContain(
      "this door approves governed document revisions only",
    );
    expect(migration).toContain(
      "and d.controlled_kind in (\n        'drawing','pid','manual','procedure','inspection_record','engineering_standard'\n      )",
    );
  });

  it("requires a named same-tenant human, separation of duties and AAL2 approval", () => {
    expect(migration).toContain("app_current_org()");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("the ai operator is refused");
    expect(migration).toContain("v_doc.controlled_by=v_actor");
    expect(migration).toContain("app_actor_has_verified_mfa");
    expect(migration).toContain("app_current_aal()<>'aal2'");
    expect(migration).toContain(
      "the document controller cannot approve their own revision",
    );
  });

  it("locks exact revisions, supersedes atomically and revokes direct writes", () => {
    expect(migration).toContain("control_status='superseded'");
    expect(migration).toContain("superseded_by_document_id=v_doc.id");
    expect(migration).toContain("for update");
    expect(migration).toContain("app.controlled_document_writer");
    expect(migration).toContain(
      "another revision of this document number is already effective",
    );
    expect(migration).toContain(
      "revoke insert,update,delete,truncate on public.kb_intake_documents",
    );
    expect(migration).toContain(
      "revoke all on function public.submit_document_revision(uuid,jsonb)",
    );
    expect(migration).toContain(
      "revoke all on function public.decide_document_revision(uuid,text,text)",
    );
    expect(migration).toContain(
      "revoke all on function public.get_document_revision_register()",
    );
    expect(migration).toContain("from public,anon,service_role");
    expect(migration).not.toContain(
      "grant execute on function public.submit_document_revision(uuid,jsonb)\n  to service_role",
    );
  });

  it("is reachable from Data Governance and grants no operational authority", () => {
    expect(service).toContain('"submit_document_revision"');
    expect(service).toContain('"decide_document_revision"');
    expect(service).toContain('"get_document_revision_register"');
    expect(component).toContain("Document revision control");
    expect(component).toContain("operationalAuthorization !== false");
    expect(component).toContain("Approve revision");
    expect(host).toContain("<DocumentRevisionControl />");
    const wrapper =
      host
        .split("export function DataGovernance() {")[1]
        ?.split("function DataGovernanceReadout()")[0] ?? "";
    expect(wrapper).toContain("<DocumentRevisionControl />");
    expect(row).toContain("✅");
    expect(row).toContain("`submit_document_revision`");
    expect(row).toContain("`decide_document_revision`");
    expect(row).toContain("`DocumentRevisionControl`");
    expect(row).toContain("`20271106170000_document_revision_control.sql`");
  });
});
