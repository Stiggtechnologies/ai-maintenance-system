import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Actual migration source guards, not SQL execution or cryptographic/runtime
// qualification. Native content/threshold changes, timezone equivalence and
// incomplete-binding privacy still require the coordinated rollback transcript.
// document_id is a canonical anchor only: claim-purpose, quarantine and source
// eligibility remain #569 dependencies, not facts this digest can manufacture.
const migration = readFileSync(
  "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
  "utf8",
);

function definition(name: string): string {
  return (
    migration.match(
      new RegExp(`create or replace function public\\.${name}\\([^]*?\\$\\$;`),
    )?.[0] ?? ""
  );
}

function rawBody(name: string): string {
  return definition(name).match(/as\s+\$\$([^]*?)\$\$;/)?.[1] ?? "";
}

function body(name: string): string {
  return rawBody(name)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const snapshot = body("risk_uncertainty_input_binding_snapshot");
const evidenceProjection = body("risk_uncertainty_evidence_digest_projection");
const projectedEvidence = evidenceProjection || snapshot;
const payload = body("risk_uncertainty_v2_digest_payload");
const digest = body("risk_uncertainty_analysis_digest");
const submit = body("submit_risk_uncertainty_analysis_internal");
const trigger = body("enforce_risk_uncertainty_analysis_write");
const compact = migration.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
const legacyBodySha256 =
  "81e83896d6af8e47f8072351d94de572e918edc8a323e25810f1117021d08409";

const evidenceCoverage = [
  ["identity/scope", ["id", "organization_id", "risk_id"]],
  ["content", ["description", "source_system", "evidence_type", "signal_kind"]],
  ["provenance", ["source_reference", "provenance", "document_id"]],
  ["classification", ["evidence_class"]],
  ["verification", ["verification_status", "verified_by", "verified_at"]],
  ["verification basis", ["verification_method", "verification_note"]],
  [
    "quality/applicability",
    ["quality_grade", "applicability_grade", "applicability"],
  ],
  ["revision", ["revision"]],
  [
    "asset/operational anchors",
    ["asset_id", "recommendation_id", "development_case_id"],
  ],
  [
    "measurement qualification",
    ["ts", "data_quality", "confidence_contribution"],
  ],
] as const;
const packetFields = [
  "id",
  "organization_id",
  "risk_id",
  "version",
  "author_id",
  "created_at",
  "method",
  "basis",
  "probability_lower",
  "probability_central",
  "probability_upper",
  "confidence_level",
  "confidence_interval_lower",
  "confidence_interval_upper",
  "best_case_loss",
  "expected_case_loss",
  "worst_case_loss",
  "currency",
  "sensitivity_inputs",
  "sensitivity_results",
  "threshold_profile_id",
  "decision_thresholds",
  "reassessment_triggers",
  "review_due_at",
  "voi_action",
  "voi_information_cost",
  "voi_decision_cost_if_wrong",
  "voi_uncertainty_reduction",
  "voi_probability_decision_changes",
  "voi_expected_value",
  "voi_net_value",
  "voi_recommendation",
] as const;

describe("U18 v2 content and threshold digest source contract", () => {
  it("identifies legacy coverage and requires a server snapshot for v2, without today's historical backfill", () => {
    expect(compact).toMatch(
      /digest_version\s+(?:integer|int)\s+not null\s+default 1/,
    );
    expect(compact).toMatch(/digest_version\s+in\s*\(1,2\)/);
    expect(compact).toContain("input_binding_snapshot jsonb");
    expect(compact).toContain(
      "digest_version=1 and input_binding_snapshot is null",
    );
    expect(compact).toContain("digest_version=2");
    expect(compact).toContain("jsonb_typeof(input_binding_snapshot)='object'");
    expect(compact).not.toMatch(
      /update public\.risk_uncertainty_analyses set (?:digest_version|input_binding_snapshot)\s*=/,
    );
  });

  it("preserves the v1 digest byte body and dispatches explicitly by stored version", () => {
    const legacy = rawBody("risk_uncertainty_analysis_digest_v1");
    expect(legacy, "identifiable owner-only original v1 algorithm").not.toBe(
      "",
    );
    expect(createHash("sha256").update(legacy).digest("hex")).toBe(
      legacyBodySha256,
    );
    expect(digest).toContain("a.digest_version=1");
    expect(digest).toContain("public.risk_uncertainty_analysis_digest_v1(");
    expect(digest).toContain("a.digest_version=2");
    expect(digest).toContain("public.risk_uncertainty_v2_digest_payload(");
    expect(digest).toContain("public.risk_uncertainty_input_binding_snapshot(");
    expect(digest).toContain("return null");
  });

  it("uses one exact pure packet-plus-binding projection for stored and live v2 hashes", () => {
    expect(definition("risk_uncertainty_v2_digest_payload")).toContain(
      "public.risk_uncertainty_analyses",
    );
    expect(payload).toContain("'digestVersion',2");
    expect(payload).toContain("p_input_binding_snapshot");
    for (const field of packetFields)
      expect(payload, `immutable packet ${field} is hashed`).toMatch(
        new RegExp(`\\b(?:a|p_analysis)\\.${field}\\b`),
      );
    expect(payload).not.toMatch(/\b(?:from|join) public\./i);
    expect(payload).not.toMatch(/to_jsonb\(\s*(?:a|p_analysis)\s*\)/i);
    expect(submit).toContain("public.risk_uncertainty_v2_digest_payload(");
    expect(submit).toContain("extensions.digest(");
    expect(digest).toContain("public.risk_uncertainty_v2_digest_payload(");
    expect(digest).toContain("extensions.digest(");
  });

  it.each(evidenceCoverage)(
    "hashes canonical evidence %s, not just verification metadata",
    (_group, fields) => {
      expect(
        projectedEvidence,
        "actual v2 evidence projection exists",
      ).not.toBe("");
      for (const field of fields)
        expect(projectedEvidence).toMatch(new RegExp(`\\be\\.${field}\\b`));
    },
  );

  it.each([
    "related_asset",
    "created_at",
    "edge_node_id",
    "edge_sensor_id",
    "edge_model_register_id",
    "edge_observation_id",
    "edge_sequence",
    "edge_payload_sha256",
    "edge_signature_key_id",
    "edge_signature_verified_at",
    "edge_observation",
  ])(
    "commits canonical evidence field %s, including signed observations",
    (field) => {
      expect(projectedEvidence).toMatch(new RegExp(`\\be\\.${field}\\b`));
    },
  );

  it("captures the same pure private UTC evidence projection used by native signed-field controls", () => {
    expect(evidenceProjection).not.toBe("");
    expect(snapshot).toContain(
      "public.risk_uncertainty_evidence_digest_projection(e)",
    );
    expect(evidenceProjection).not.toMatch(/\b(?:from|join) public\./i);
    expect(evidenceProjection).not.toMatch(/to_jsonb\(\s*e\s*\)/i);
    expect(definition("risk_uncertainty_evidence_digest_projection")).toMatch(
      /set\s+(?:timezone|time zone)\s*=\s*'UTC'/i,
    );
    expect(compact).toContain(
      "revoke all on function public.risk_uncertainty_evidence_digest_projection(public.evidence_items) from public,anon,authenticated,service_role",
    );
  });

  it("binds the current risk criteria pointer, actual same-org profile version, adoption and thresholds", () => {
    expect(snapshot).toContain("r.criteria_profile_id");
    expect(snapshot).toContain("c.id=r.criteria_profile_id");
    expect(snapshot).toContain("r.organization_id=p_organization_id");
    expect(snapshot).toContain("c.organization_id=p_organization_id");
    for (const field of [
      "id",
      "organization_id",
      "version",
      "status",
      "adopted_by",
      "adopted_at",
      "superseded_by",
      "decision_thresholds",
    ])
      expect(snapshot).toMatch(new RegExp(`\\bc\\.${field}\\b`));
    // Historical reads must hash revoked/draft/superseded standing, not silently
    // omit it. Adoption is still an independent submit/review eligibility gate.
    expect(snapshot).not.toContain("and c.status='adopted'");
    expect(snapshot).not.toContain("where c.status='adopted'");
    expect(submit).toContain("c.status<>'adopted'");
  });

  it("produces sorted exact expected IDs and counts plus explicit privacy-safe incompleteness", () => {
    expect(snapshot).toContain("array_agg(distinct x order by x)");
    expect(snapshot).toContain("p_evidence_item_ids");
    expect(snapshot).toContain("cardinality(");
    expect(snapshot).toContain("order by e.id");
    expect(snapshot).toContain("e.organization_id=p_organization_id");
    expect(snapshot).toContain("e.risk_id=p_risk_id");
    for (const key of [
      "digestVersion",
      "expectedEvidenceIds",
      "expectedEvidenceCount",
      "foundEvidenceCount",
      "bindingComplete",
    ])
      expect(snapshot).toContain(`'${key}'`);
    expect(snapshot).toMatch(/between 1 and 20/);
    expect(snapshot).toMatch(/count\(\*\)/);
    expect(snapshot).not.toContain("return null");
    expect(snapshot).not.toMatch(
      /e\.id\s*=\s*any\([^]*?\)\s+or\s+e\.organization_id/,
    );
  });

  it("captures one complete server binding snapshot only after all explicit waits and before packet insertion", () => {
    const profile = submit.indexOf("where id=v_user for share");
    const capture = submit.indexOf(
      "public.risk_uncertainty_input_binding_snapshot(",
    );
    const insert = submit.indexOf(
      "insert into public.risk_uncertainty_analyses",
    );
    expect(profile).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(profile);
    expect(insert).toBeGreaterThan(capture);
    expect(submit.slice(capture, insert)).toContain("'bindingComplete'");
    expect(submit.slice(capture, insert)).toContain(
      "return jsonb_build_object('error'",
    );
    expect(submit.slice(insert)).toContain(
      "digest_version,input_binding_snapshot",
    );
    expect(submit.slice(insert)).toMatch(/2,v_input_binding_snapshot/);
    expect(submit).not.toMatch(
      /p_analysis\s*->>?\s*'(?:digest_version|input_binding_snapshot)'/,
    );
  });

  it("pins only v2 timestamp projections to UTC without changing the legacy algorithm", () => {
    for (const name of [
      "risk_uncertainty_input_binding_snapshot",
      "risk_uncertainty_v2_digest_payload",
    ])
      expect(definition(name)).toMatch(
        /set\s+(?:timezone|time zone)\s*=\s*'UTC'/i,
      );
    expect(definition("risk_uncertainty_analysis_digest_v1")).not.toMatch(
      /set\s+(?:timezone|time zone)/i,
    );
    expect(snapshot).not.toMatch(
      /\b(now|clock_timestamp|statement_timestamp)\s*\(/i,
    );
    expect(payload).not.toMatch(
      /\b(now|clock_timestamp|statement_timestamp)\s*\(/i,
    );
  });

  it("does not hash review, supersession, derived evidence, audit or mutable risk VOI artifacts", () => {
    expect(payload).not.toBe("");
    for (const field of [
      "status",
      "reviewer_id",
      "reviewed_at",
      "review_note",
      "approval_id",
      "derived_evidence_item_id",
      "analysis_digest",
      "input_binding_snapshot",
      "superseded_by_analysis_id",
      "superseded_at",
      "superseded_by_user_id",
      "supersession_reason",
      "value_of_information",
    ])
      expect(payload).not.toMatch(
        new RegExp(`\\b(?:a|p_analysis)\\.${field}\\b`),
      );
    for (const text of [payload, snapshot]) {
      expect(text).not.toMatch(
        /\b(?:from|join) public\.(?:approvals|audit_events|decisions|work_orders)\b/,
      );
      expect(text).not.toContain("r.value_of_information");
    }
  });

  it("uses only the existing typed document anchor and makes no source-standing or approved-claim inference", () => {
    expect(snapshot).not.toBe("");
    expect(projectedEvidence).toContain("e.document_id");
    for (const name of [
      "kb_intake_documents",
      "reliability_kb_chunks",
      "engineering_knowledge_sources",
    ])
      expect(snapshot).not.toContain(`public.${name}`);
    expect(snapshot).not.toMatch(
      /(?:source_id|source_reference|source_key)\s*::\s*uuid/i,
    );
    expect(snapshot).not.toMatch(
      /'(?:sourceApproved|claimApproved|sourceEligible|claimPurpose)'/,
    );
  });

  it("keeps all new digest and binding helpers inaccessible to every client role", () => {
    for (const signature of [
      "risk_uncertainty_analysis_digest_v1(uuid,uuid)",
      "risk_uncertainty_evidence_digest_projection(public.evidence_items)",
      "risk_uncertainty_input_binding_snapshot(uuid,uuid,uuid[])",
      "risk_uncertainty_v2_digest_payload(public.risk_uncertainty_analyses,jsonb)",
    ]) {
      expect(compact).toContain(
        `revoke all on function public.${signature} from public,anon,authenticated,service_role`,
      );
      expect(compact).not.toContain(
        `grant execute on function public.${signature}`,
      );
    }
  });

  it("retains the whole-row submitted-history freeze and exact canonical public visibility doors", () => {
    expect(trigger).toContain("to_jsonb(new) - array[");
    expect(trigger).not.toMatch(
      /array\[[^\]]*'(?:digest_version|input_binding_snapshot)'/,
    );
    for (const name of [
      "submit_risk_uncertainty_analysis_internal",
      "review_risk_uncertainty_analysis",
      "get_risk_uncertainty_workspace",
    ])
      expect(body(name)).toContain("public.can_read_risk(");
    expect(compact).toContain(
      "organization_id=public.app_current_org() and public.can_read_risk(risk_id)",
    );
  });

  it("binds v2 initializer to both stored snapshot and live inputs, and refuses null or string coverage tags", () => {
    expect(trigger).toContain("old.digest_version=2");
    expect(trigger).toContain("public.risk_uncertainty_v2_digest_payload(");
    expect(trigger).toContain("old,old.input_binding_snapshot");
    expect(trigger).toContain("extensions.digest(");
    expect(trigger).toContain(
      "public.risk_uncertainty_analysis_digest(old.organization_id,old.id)",
    );
    expect(compact).toContain(
      "input_binding_snapshot->'digestVersion' is not distinct from '2'::jsonb",
    );
    expect(compact).toContain(
      "input_binding_snapshot->'bindingComplete' is not distinct from 'true'::jsonb",
    );
  });

  it("specifies additive native drift, privacy, exact tag and full-rollback controls without claiming execution", () => {
    const sql = readFileSync(
      "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
      "utf8",
    );
    const control = sql
      .split("-- U18 V2 DIGEST CONTROLS BEGIN")[1]
      ?.split("-- U18 V2 DIGEST CONTROLS END")[0];
    expect(control).toBeDefined();
    for (const witness of [
      "v2 stored/live digest changed across session timezones",
      "incomplete v2 projection leaked foreign-tenant evidence or criteria",
      "content-only evidence change did not stale the v2 digest",
      "current criteria drift did not stale the v2 digest",
      "missing current criteria must yield an explicit incomplete stale hex digest",
      "rebound evidence must yield incomplete stale digest without foreign content",
      "corrupted stored snapshot finalized or left refusal artifacts",
      "legacy v1 dispatch changed or falsely claimed v2 snapshot coverage",
      "risk_uncertainty_binding_snapshot_check",
      "get diagnostics affected=row_count",
      "pg_temp.u18_state() is distinct from baseline",
    ])
      expect(control).toContain(witness);
    expect(control).not.toMatch(/disable trigger|session_replication_role/i);
    expect(control).toContain("attempts<>13");
    expect(control).toContain("attempts<>5");
    expect(control).toContain("invalid_tags<>5");
    expect(sql).toContain("'criteria',(select jsonb_agg(to_jsonb(c)");
    expect(sql).toContain("'securityEvents',(select jsonb_agg(to_jsonb(s)");
  });

  it("specifies actual private evidence projection and payload SHA variants without mutating signed rows", () => {
    const sql = readFileSync(
      "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
      "utf8",
    );
    const control = sql
      .split("-- U18 V2 SIGNED-FIELD PROJECTION CONTROLS BEGIN")[1]
      ?.split("-- U18 V2 SIGNED-FIELD PROJECTION CONTROLS END")[0];
    expect(control).toBeDefined();
    for (const witness of [
      "public.risk_uncertainty_evidence_digest_projection(e)",
      "select * into e from public.evidence_items where id=f.verified",
      "jsonb_populate_record(null::public.evidence_items",
      "jsonb_set(a.input_binding_snapshot,'{evidence,0}'",
      "public.risk_uncertainty_v2_digest_payload(a,snapshot)",
      "extensions.digest(",
      "edge_attempts<>9",
      "9007199254740993::bigint",
      "pg_temp.u18_state() is distinct from baseline",
      "information_schema.columns",
      "jsonb_object_keys(evidence_projection)",
    ])
      expect(control).toContain(witness);
    for (const field of [
      "edge_node_id",
      "edge_sensor_id",
      "edge_model_register_id",
      "edge_observation_id",
      "edge_sequence",
      "edge_payload_sha256",
      "edge_signature_key_id",
      "edge_signature_verified_at",
      "edge_observation",
    ])
      expect(control).toContain(`'${field}'`);
    expect(control).not.toMatch(
      /\b(?:insert into|update|delete from|truncate|disable trigger)\s+public\./i,
    );
    for (const signature of [
      "risk_uncertainty_analysis_digest_v1(uuid,uuid)",
      "risk_uncertainty_evidence_digest_projection(public.evidence_items)",
      "risk_uncertainty_input_binding_snapshot(uuid,uuid,uuid[])",
      "risk_uncertainty_v2_digest_payload(public.risk_uncertainty_analyses,jsonb)",
    ])
      expect(sql).toContain(`public.${signature}`);
    expect(sql).toContain("('anon'),('authenticated'),('service_role')");
  });

  it("uses the canonical BIGINT edge model identity in unpersisted native variants, never a UUID cast", () => {
    const schema = readFileSync(
      "supabase/migrations/20261226100000_edge_evidence_contract.sql",
      "utf8",
    );
    const sql = readFileSync(
      "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
      "utf8",
    );
    expect(schema).toMatch(
      /edge_model_register_id bigint references public\.model_register\(id\)/,
    );
    expect(sql).toContain(
      "('edge_model_register_id','edgeModelRegisterId',to_jsonb(9007199254740993::bigint))",
    );
    expect(sql).not.toContain(
      "('edge_model_register_id','edgeModelRegisterId',to_jsonb(gen_random_uuid()))",
    );
  });

  it("preserves advisory human-review semantics and creates no parallel source, approval or audit store", () => {
    expect(body("review_risk_uncertainty_analysis")).toContain(
      "insert into public.approvals",
    );
    expect(body("review_risk_uncertainty_analysis")).toContain(
      "insert into public.evidence_items",
    );
    expect(submit).toContain("insert into public.audit_events");
    expect(submit).toContain("'operationalAuthorization',false");
    expect(compact).not.toMatch(
      /create table(?: if not exists)? public\.risk_uncertainty_(?:sources|approvals|audit)/,
    );
  });
});
