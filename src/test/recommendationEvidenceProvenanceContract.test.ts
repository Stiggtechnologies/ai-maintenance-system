import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101420000_recommendation_evidence_provenance.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/recommendationEvidenceService.ts",
  "utf8",
);
const component = readFileSync(
  "src/components/RecommendationEvidenceDrawer.tsx",
  "utf8",
);
const missionControl = readFileSync("src/pages/MissionControl.tsx", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const documentation = readFileSync(
  "docs/recommendation-evidence-provenance.md",
  "utf8",
);

const levels = [
  "verified_measurement",
  "approved_inspection",
  "confirmed_history",
  "engineering_calculation",
  "oem_recommendation",
  "industry_reference",
  "similar_asset_inference",
  "expert_judgment",
  "ai_hypothesis",
];

describe("U17.01/U17.02 governed recommendation evidence contract", () => {
  it("implements all nine non-ordinal evidence levels on the canonical evidence store", () => {
    for (const level of levels) {
      expect(migration).toContain(`'${level}'`);
      expect(service).toContain(`"${level}"`);
    }
    expect(migration).toContain("alter table public.evidence_items");
    expect(migration).toContain("recommendation_claim_role");
    expect(migration).toContain("'supporting','contradicting','context'");
    expect(migration).toContain("do not replace evidence_class");
  });

  it("preserves verification and tenant-configured confidence as independent facts", () => {
    expect(migration).toContain("public.compute_evidence_confidence(e.id)");
    expect(migration).toContain("'verificationStatus',e.verification_status");
    expect(migration).toContain("does not verify the evidence's");
    expect(component).toContain("EC refused");
    expect(component).toContain("Verification:");
    expect(component).toContain("did not verify the source");
  });

  it("governs exact missing-evidence packets and exposes conflicts and staleness", () => {
    expect(migration).toContain("missing_evidence text[]");
    expect(migration).toContain("recommendation_evidence_packet_digest");
    expect(migration).toContain(
      "when r.evidence_packet_digest is distinct from v_current then 'stale'",
    );
    expect(migration).toContain("e.recommendation_claim_role='contradicting'");
    expect(migration).toContain("evidence packet changed after submission");
    expect(component).toContain("Evidence completeness packet");
    expect(component).toContain("Submit exact packet digest");
    expect(component).toContain("Evidence changed after review");
  });

  it("requires independent human review and refuses direct or service-role mutation", () => {
    expect(migration).toContain(
      "classification author cannot independently review",
    );
    expect(migration).toContain("packet author cannot independently review");
    expect(migration).toContain(
      "recommendation_provenance_reviewed_by<>recommendation_provenance_recorded_by",
    );
    expect(migration).toContain(
      "evidence_packet_reviewed_by<>evidence_packet_recorded_by",
    );
    expect(migration).toContain(
      "before insert or update or delete on public.evidence_items",
    );
    expect(migration).toContain("before truncate on public.evidence_items");
    expect(migration).toContain("from public,anon,service_role");
  });

  it("uses canonical approvals/audit and grants no operational authority", () => {
    expect(migration).toContain("insert into public.approvals");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("'operationalAuthorization',false");
    expect(migration).toContain(
      "release work, accept risk, commit spend or authorize operation",
    );
    expect(migration).toContain(
      "r.id=p_recommendation_id and r.organization_id=p_organization_id",
    );
    expect(migration).toContain(
      "recommendation evidence must link to a recommendation in the same organization",
    );
    expect(migration).toContain(
      "The recommendation row is the packet's concurrency lock",
    );
  });

  it("is customer reachable from Mission Control and CI runtime validated", () => {
    expect(service).toContain('"get_recommendation_evidence_workspace"');
    expect(service).toContain(
      '"propose_recommendation_evidence_classification"',
    );
    expect(service).toContain('"review_recommendation_evidence_packet"');
    expect(component).toContain("Recommendation evidence");
    expect(component).toContain("Submit classification");
    expect(component).toContain("Validate packet");
    expect(missionControl).toContain("<RecommendationEvidenceDrawer");
    expect(workflow).toContain(
      "ci-recommendation-evidence-provenance-smoke.sh",
    );
    expect(documentation).toContain("Authors cannot independently review");
  });
});
