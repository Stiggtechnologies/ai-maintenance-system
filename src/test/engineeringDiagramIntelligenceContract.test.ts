import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102090000_engineering_diagram_intelligence.sql",
  "utf8",
).toLowerCase();
const edge = readFileSync(
  "supabase/functions/engineering-diagram-inference/index.ts",
  "utf8",
);
const service = readFileSync(
  "src/services/engineeringDiagramIntelligence.ts",
  "utf8",
);
const component = readFileSync(
  "src/components/EngineeringDiagramIntelligence.tsx",
  "utf8",
);
const parent = readFileSync("src/pages/KnowledgeBasePage.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-engineering-diagram-intelligence-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const deployment = readFileSync(
  ".github/workflows/deploy-migrations.yml",
  "utf8",
);
const notice = readFileSync("NOTICE", "utf8");

describe("C2.09 governed Engineering Diagram Intelligence", () => {
  it("reuses the controlled document, canonical asset and dependency contracts", () => {
    expect(migration).toContain("references public.kb_intake_documents");
    expect(migration).toContain("references public.assets");
    expect(migration).toContain("insert into public.dependency_candidates");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(
      /create table if not exists public\.(drawings|technical_documents|asset_graph|diagram_dependency_queue)/,
    );
    expect(migration).not.toContain("insert into public.asset_dependencies");
  });

  it("binds immutable bytes to an exact effective, security-cleared P&ID revision", () => {
    expect(migration).toContain("'engineering-diagrams'");
    expect(migration).toContain("public=false");
    expect(migration).toContain("storage.foldername(name)");
    expect(migration).toContain("controlled_kind in ('pid','drawing')");
    expect(migration).toContain("control_status='effective'");
    expect(migration).toContain("security_status in ('cleared','released')");
    expect(migration).toContain("from storage.objects");
    expect(migration).toContain("input_sha256");
    expect(migration).toContain("source_object_path");
    expect(migration).toContain(
      "engineering diagram source objects are immutable",
    );
  });

  it("pins provider provenance and prevents upstream pid_id overwrite collisions", () => {
    expect(migration).toContain(
      "https://github.com/stiggtechnologies/digitization-of-piping-and-instrument-diagrams",
    );
    expect(migration).toContain("c51302e3ec34147c676ef6eedbdd7551ea908b05");
    expect(migration).toContain("provider_pid_id");
    expect(migration).toContain("id::text");
    expect(migration).toContain("idempotency_key");
    expect(migration).toContain("raw_result_sha256");
    expect(migration).toContain("schema_version");
  });

  it("accepts bounded service-only inference with normalized geometry", () => {
    expect(migration).toContain("record_engineering_diagram_inference");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("jsonb_array_length(p_nodes)");
    expect(migration).toContain("jsonb_array_length(p_edges)");
    expect(migration).toContain("dependency_candidates_diagram_source_unique");
    expect(migration).toContain("exception when sqlstate '22023'");
    expect(migration).toContain("unaudited partial publication");
    expect(migration).toContain("engineering_diagram_valid_bbox");
    expect(migration).toContain("confidence between 0 and 1");
    expect(migration).toContain("source_node_id");
    expect(migration).toContain("target_node_id");
    expect(migration).toContain("malformed or unbounded provider output");
  });

  it("requires independent AAL2 human asset mapping review", () => {
    expect(migration).toContain("propose_engineering_diagram_asset_mapping");
    expect(migration).toContain("review_engineering_diagram_asset_mapping");
    expect(migration).toContain("v_mapping.proposed_by=v_actor");
    expect(migration).toContain("app_actor_has_verified_mfa");
    expect(migration).toContain("app_current_aal()<>'aal2'");
    expect(migration).toContain("organization_id=v_org");
  });

  it("publishes reviewed orientations only into the existing human candidate queue", () => {
    expect(migration).toContain(
      "publish_engineering_diagram_dependency_candidates",
    );
    expect(migration).toContain("accepted endpoint mappings");
    expect(migration).toContain("dependency_kind");
    expect(migration).toContain("source_kind");
    expect(migration).toContain("engineering_diagram");
    expect(migration).toContain("proposed_by");
    expect(migration).toContain("diagram candidate proposer cannot review");
    expect(migration).toContain(
      "diagram candidate source revision is no longer effective",
    );
    expect(migration).toContain("operationalauthorization',false");
  });

  it("adapts the upstream API without calling its overwrite-style graph persistence", () => {
    expect(edge).toContain("AZURE_PID_DIGITIZATION_BASE_URL");
    expect(edge).toContain("AZURE_PID_DIGITIZATION_API_KEY");
    expect(edge).toContain("/api/pid-digitization/symbol-detection/");
    expect(edge).toContain("/api/pid-digitization/text-detection/");
    expect(edge).toContain("/api/pid-digitization/graph-construction/");
    expect(edge).toContain("record_engineering_diagram_inference");
    expect(edge).toContain("if (claimedRun)");
    expect(edge).toContain('action === "poll"');
    expect(edge).toContain("https:");
    expect(edge).not.toContain("/graph-persistence/");
  });

  it("is reachable in the knowledge workspace and states the decision boundary", () => {
    expect(service).toContain('from("engineering_diagram_runs")');
    expect(service).toContain('from("engineering-diagrams")');
    expect(service).toContain('.eq("status", "indexed")');
    expect(service).toContain('"create_engineering_diagram_run"');
    expect(service).toContain(
      '"publish_engineering_diagram_dependency_candidates"',
    );
    expect(component).toContain("Diagram Intelligence");
    expect(component).toContain("machine-generated candidates");
    expect(component).toMatch(/does not\s+authorize plant work/);
    expect(component).toContain("canControl");
    expect(component).toContain("canReview");
    expect(parent).toContain("<EngineeringDiagramIntelligence");
  });

  it("retains upstream attribution and a fresh-chain runtime proof", () => {
    expect(notice).toContain(
      "Azure-Samples/digitization-of-piping-and-instrument-diagrams",
    );
    for (const proof of [
      "canonical_document=true",
      "private_source_object=true",
      "tenant_wall=true",
      "service_only_inference=true",
      "bounded_geometry=true",
      "independent_mapping_review=true",
      "atomic_candidate_publication=true",
      "effective_revision_rechecked=true",
      "candidate_only_publication=true",
      "independent_graph_review=true",
      "direct_graph_write=false",
      "operational_authority=false",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-engineering-diagram-intelligence-smoke.sh",
    );
    expect(deployment).toContain(
      "supabase functions deploy engineering-diagram-inference",
    );
  });
});
