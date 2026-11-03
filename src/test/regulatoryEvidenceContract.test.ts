import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271105150000_regulatory_evidence_dossiers.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/regulatoryEvidenceService.ts",
  "utf8",
);
const component = readFileSync(
  "src/components/RegulatoryEvidencePacks.tsx",
  "utf8",
);
const page = readFileSync("src/pages/DecisionGovernance.tsx", "utf8");

describe("E4.09 regulatory evidence", () => {
  it("reuses evidence, the adopted jurisdiction layer and the audit ledger", () => {
    expect(migration).toContain("references public.evidence_items(id)");
    expect(migration).toContain("references public.capability_pack_layers(id)");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("organizations o where o.id = v_org");
    expect(migration).not.toMatch(
      /insert\s+into\s+public\.capability_pack_layers/i,
    );
    expect(migration).not.toMatch(/\b(OSHA|ABSA|API\s*510|ISO\s*55001)\b/);
  });

  it("binds the exact adopted regulatory or statutory requirement", () => {
    expect(migration).toContain("layer_kind = 'jurisdiction'");
    expect(migration).toContain("status = 'adopted'");
    expect(migration).toContain(
      "req->>'requirement_class' not in ('regulatory', 'statutory')",
    );
    expect(migration).toContain("req->>'applicability' <> 'applicable'");
    expect(migration).toContain("l.version <> v_expected");
    expect(migration).toContain("for update");
    expect(migration).toContain("capability_pack_layer_version");
  });

  it("requires a named AAL2 human and independently verified evidence", () => {
    expect(migration).toContain("assert_regulatory_evidence_actor");
    expect(migration).toContain("AI cannot %");
    expect(migration).toContain("app_actor_has_verified_mfa");
    expect(migration).toContain("app_current_aal() <> 'aal2'");
    expect(migration).toContain("e.verification_status = 'verified'");
    expect(migration).toContain("e.verified_by <> v_actor");
    expect(migration).toContain("e.organization_id = v_org");
    expect(migration).toContain("verifier.role is distinct from 'ai_admin'");
    expect(migration).toContain(
      "A different named human must release this dossier",
    );
    expect(migration).toContain("released_by <> assembled_by");
  });

  it("keeps gaps explicit and refuses a legal or operational outcome", () => {
    expect(migration).toContain(
      "when p.requirement->>'obligation' = 'mandatory' then 'gap'",
    );
    expect(migration).toContain("'applicability_undetermined'");
    expect(migration).toContain("'legalComplianceDetermined', false");
    expect(migration).toContain("'workAuthorized', false");
    expect(migration).toContain("'riskAccepted', false");
    expect(migration).toContain("'operatingLimitChanged', false");
    expect(migration).toContain("'returnToServiceAuthorized', false");
    expect(migration).toContain("does not decide a legal outcome");
    expect(migration).toContain(
      "Cite at most 40 evidence items per dossier request",
    );
  });

  it("locks direct mutation, including truncate, to the governed writer", () => {
    expect(migration).toContain("app.regulatory_evidence_writer");
    expect(migration).toContain(
      "revoke all on table public.regulatory_evidence_dossiers",
    );
    expect(migration).toContain(
      "revoke all on table public.regulatory_evidence_items",
    );
    expect(migration).toContain(
      "before truncate on public.regulatory_evidence_dossiers",
    );
    expect(migration).toContain(
      "before truncate on public.regulatory_evidence_items",
    );
    expect(migration).toContain("organization_id = public.app_current_org()");
    for (const name of [
      "assert_regulatory_evidence_actor(text)",
      "guard_regulatory_evidence_dossier_write()",
      "guard_regulatory_evidence_item_write()",
      "assemble_regulatory_evidence_pack(jsonb)",
      "release_regulatory_evidence_pack(jsonb)",
      "withdraw_regulatory_evidence_pack(jsonb)",
      "get_regulatory_evidence_workspace()",
    ]) {
      expect(migration).toContain(`revoke all on function public.${name}`);
    }
  });

  it("is customer reachable from Decision Governance", () => {
    expect(service).toContain('"get_regulatory_evidence_workspace"');
    expect(service).toContain('"assemble_regulatory_evidence_pack"');
    expect(service).toContain('"release_regulatory_evidence_pack"');
    expect(service).toContain('"withdraw_regulatory_evidence_pack"');
    expect(component).toContain("assembleRegulatoryEvidencePack");
    expect(component).toContain("releaseRegulatoryEvidencePack");
    expect(component).toContain("withdrawRegulatoryEvidencePack");
    expect(page).toContain("<RegulatoryEvidencePacks />");
  });
});
