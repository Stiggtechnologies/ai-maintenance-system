import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildAssetAwareRetrievalPlan, type RetrievalCandidate, type RetrievalPolicy } from "./asset-aware-retrieval";
import type {
  EngineeringContextPackage,
  EngineeringKnowledgeDocumentMetadata,
} from "./ontology";

// Synthetic identities only. These are metadata-filter tests, not proof of RLS,
// OEM validation, source permissions, historical snapshots, or live deployment.
const context: EngineeringContextPackage = {
  tenantId: "FIXTURE-TENANT-A",
  assetTwinId: "FIXTURE-TWIN-A",
  assetClassCode: "FIXTURE-CLASS",
  siteId: "FIXTURE-SITE-A",
  functionalLocationId: "FIXTURE-LOCATION-A",
  engineeringDnaCode: "FIXTURE-DNA-A",
  manufacturer: "Fixture OEM",
  model: "Fixture Model A",
  serialNumber: "FIXTURE-SERIAL-A",
  sharedComponentDnaCodes: ["FIXTURE-SHARED-GEARBOX"],
  componentCodes: ["FIXTURE-GEARBOX"],
  candidateFailureModeCodes: ["FIXTURE-WEAR"],
  physicsCapabilityCodes: ["FIXTURE-PHYSICS"],
  evidenceIds: [],
  sourceIds: [],
  sourceConflictIds: [],
  missingEvidence: [],
  humanApprovalRequired: true,
  autonomousOperationalActionAllowed: false,
};
const policy: RetrievalPolicy = {
  minimumSemanticScore: 0.5,
  maximumResults: 5,
  requireApprovedSources: true,
  now: "2026-09-15T12:00:00.000Z",
};
const candidate = (
  overrides: Partial<EngineeringKnowledgeDocumentMetadata> = {},
): RetrievalCandidate => ({
  metadata: {
    sourceId: "FIXTURE-SOURCE-A",
    title: "Synthetic engineering source",
    documentType: "manual",
    tenantId: context.tenantId,
    assetTwinId: context.assetTwinId,
    assetClassCode: context.assetClassCode,
    componentCodes: [...context.componentCodes],
    sharedComponentDnaCodes: [],
    failureModeCodes: [],
    physicsCapabilityCodes: [],
    authorityLevel: "oem_authorized",
    reviewState: "approved",
    confidentiality: "customer_confidential",
    effectiveDate: "2026-01-01",
    ...overrides,
  },
  semanticScore: 0.9,
  chunkIds: ["FIXTURE-CHUNK-A"],
});
const plan = (items: RetrievalCandidate[], scope = context, rules = policy) =>
  buildAssetAwareRetrievalPlan(scope, items, rules);
const refused = (item: RetrievalCandidate, scope = context) => {
  const result = plan([item], scope);
  assert.equal(result.included.length, 0);
  assert.equal(result.excluded.length, 1);
  assert.ok(result.excluded[0].reasons.length > 0);
};

describe("engineering retrieval applicability safety", () => {
  it("admits a valid source without changing its canonical identity", () => {
    const result = plan([candidate()]);
    assert.equal(result.included[0].metadata.sourceId, "FIXTURE-SOURCE-A");
    assert.equal(result.context.autonomousOperationalActionAllowed, false);
  });

  for (const key of [
    "tenantId", "assetTwinId", "assetClassCode", "siteId",
    "functionalLocationId", "engineeringDnaCode", "manufacturer", "model", "serialNumber",
  ] as const) {
    it(`refuses mismatching ${key}`, () => refused(candidate({ [key]: "OTHER" })));
  }

  for (const key of [
    "siteId", "functionalLocationId", "engineeringDnaCode", "manufacturer", "model", "serialNumber",
  ] as const) {
    it(`does not treat unknown ${key} as matching scoped evidence`, () => {
      refused(candidate({ [key]: context[key] }), { ...context, [key]: undefined });
    });
  }

  for (const key of [
    "componentCodes", "sharedComponentDnaCodes", "failureModeCodes", "physicsCapabilityCodes",
  ] as const) {
    it(`refuses mismatching ${key}`, () => refused(candidate({ [key]: ["OTHER"] })));
    it(`refuses blank ${key}`, () => refused(candidate({ [key]: [" "] })));
  }

  it("admits all matching optional scope fields together", () => {
    const result = plan([candidate({
      siteId: context.siteId,
      functionalLocationId: context.functionalLocationId,
      engineeringDnaCode: context.engineeringDnaCode,
      manufacturer: context.manufacturer,
      model: context.model,
      serialNumber: context.serialNumber,
      sharedComponentDnaCodes: [...context.sharedComponentDnaCodes!],
    })]);
    assert.equal(result.included.length, 1);
  });

  it("refuses scoped shared-component evidence when that context is unknown", () => {
    refused(candidate({ sharedComponentDnaCodes: ["FIXTURE-SHARED-GEARBOX"] }), {
      ...context, sharedComponentDnaCodes: undefined,
    });
  });

  it("does not normalize two different model identifiers into one", () => {
    refused(candidate({ model: "fixture model a" }));
  });

  for (const key of ["tenantId", "assetTwinId", "assetClassCode"] as const) {
    it(`refuses blank required context ${key}`, () => {
      refused(candidate({ assetTwinId: undefined, assetClassCode: undefined }), {
        ...context, [key]: " ",
      });
    });
  }

  it("refuses a blank declared source scope instead of treating it as absent", () => {
    refused(candidate({ model: " " }));
  });

  it("refuses non-public metadata without a tenant", () => {
    refused(candidate({ tenantId: undefined, assetTwinId: undefined }));
  });

  it("retains unscoped public background material without granting action authority", () => {
    assert.equal(plan([candidate({
      tenantId: undefined, assetTwinId: undefined, confidentiality: "public",
    })]).included.length, 1);
  });

  for (const overrides of [
    { effectiveDate: "2027-01-01" },
    { effectiveDate: "not-a-date" },
    { effectiveDate: "2026-02-30" },
    { effectiveDate: "2026-09-15T10:00:00" },
    { supersededDate: "2026-09-15T12:00:00.000Z" },
    { supersededDate: "not-a-date" },
    { effectiveDate: "2026-02-01", supersededDate: "2026-01-01" },
  ]) {
    it(`refuses invalid or inapplicable source dates ${JSON.stringify(overrides)}`, () => {
      refused(candidate(overrides));
    });
  }

  it("admits a source exactly at its effective instant and before its end", () => {
    assert.equal(plan([candidate({
      effectiveDate: policy.now, supersededDate: "2026-09-16",
    })]).included.length, 1);
  });

  it("supports explicit timezone offsets in source dates", () => {
    assert.equal(plan([candidate({ effectiveDate: "2026-09-15T08:00:00-04:00" })]).included.length, 1);
  });

  it("does not resurrect a currently superseded source for a historical date", () => {
    assert.equal(plan([candidate({
      reviewState: "superseded", supersededDate: "2026-09-01",
    })], context, { ...policy, now: "2026-08-01T00:00:00Z" }).included.length, 0);
  });

  it("rejects forged approval of AI-generated authority", () => {
    refused(candidate({ authorityLevel: "ai_generated", reviewState: "approved" }));
  });

  for (const key of ["sourceId", "title"] as const) {
    it(`refuses blank source ${key}`, () => refused(candidate({ [key]: " " })));
  }

  for (const score of [NaN, Infinity, -Infinity, -0.1, 1.1]) {
    it(`refuses invalid semantic score ${score}`, () => {
      refused({ ...candidate(), semanticScore: score });
    });
  }

  for (const chunkIds of [[], [" "], ["VALID", ""]]) {
    it(`refuses absent or blank provenance ${JSON.stringify(chunkIds)}`, () => {
      refused({ ...candidate(), chunkIds });
    });
  }

  it("rejects NaN policy thresholds", () => {
    assert.throws(() => plan([], context, { ...policy, minimumSemanticScore: NaN }), /minimumSemanticScore/);
  });

  it("rejects invalid evaluation time even with no candidates", () => {
    assert.throws(() => plan([], context, { ...policy, now: "invalid" }), /now/);
  });

  it("excludes foreign sources before conflict scoring", () => {
    const own = candidate({ revision: "A" });
    const foreign = candidate({ sourceId: "FOREIGN", tenantId: "OTHER", revision: "B" });
    const alone = plan([own]);
    const mixed = plan([own, foreign]);
    assert.deepEqual(mixed.included, alone.included);
    assert.deepEqual(mixed.sourceConflictIds, []);
  });

  it("excludes draft revisions before conflict scoring", () => {
    const own = candidate({ revision: "A" });
    const draft = candidate({ sourceId: "DRAFT", reviewState: "draft", revision: "B" });
    assert.deepEqual(plan([own, draft]).included, plan([own]).included);
  });

  it("still flags candidate conflicts between two eligible sources", () => {
    const result = plan([
      candidate({ sourceId: "A", revision: "A" }),
      candidate({ sourceId: "B", revision: "B" }),
    ]);
    assert.deepEqual([...result.sourceConflictIds].sort(), ["A", "B"]);
  });

  it("uses canonical source IDs to break ranking ties reproducibly", () => {
    const a = candidate({ sourceId: "A" });
    const b = candidate({ sourceId: "B" });
    assert.deepEqual(plan([a, b]).included, plan([b, a]).included);
  });

  it("does not mutate candidates or context", () => {
    const items = [candidate()];
    const before = structuredClone({ items, context });
    plan(items);
    assert.deepEqual({ items, context }, before);
  });
});
