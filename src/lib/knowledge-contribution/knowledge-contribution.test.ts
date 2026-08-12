import { describe, expect, it } from "vitest";
import {
  assessContributionPosture,
  recommendLane,
  screenPayload,
  type ContributionPosture,
} from "./index";

describe("screenPayload — what stops a contribution leaving", () => {
  it("passes a genuinely derived artefact", () => {
    const r = screenPayload({ beta: 1.82, eta: 3140, failures: 214 }, 22);
    expect(r.safe).toBe(true);
    expect(r.findings).toHaveLength(0);
  });

  it("blocks a direct identifier however deeply nested", () => {
    const r = screenPayload(
      { fit: { beta: 1.8, provenance: { asset_name: "Dozer 5390" } } },
      22,
    );
    expect(r.safe).toBe(false);
    expect(r.findings[0].kind).toBe("direct_identifier");
    expect(r.findings[0].path).toBe("fit.provenance.asset_name");
  });

  it("blocks a quasi-identifier that carries no name at all", () => {
    // No customer is named. A commissioning date this precise still pins the
    // machine, which is the whole reason quasi-identifiers are screened.
    const r = screenPayload({ beta: 1.8, commissioned_at: "2011-04-17" }, 30);
    expect(r.safe).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain("quasi_identifier");
  });

  it("finds an equipment number hiding in free text", () => {
    const r = screenPayload(
      { beta: 1.8, note: "Derived after the Support Dozer 5391 rebuild." },
      40,
    );
    expect(r.safe).toBe(false);
    const finding = r.findings.find((f) => f.kind === "free_text")!;
    expect(finding.detail).toMatch(/Support Dozer 5391/);
  });

  it("does not fire on ordinary prose without an identifier", () => {
    const r = screenPayload(
      { beta: 1.8, note: "Fitted from corrective events only." },
      40,
    );
    expect(r.safe).toBe(true);
  });

  it("refuses a statistic over a single asset", () => {
    const r = screenPayload({ beta: 1.8 }, 1);
    expect(r.safe).toBe(false);
    expect(r.findings[0].kind).toBe("singleton_sample");
    expect(r.findings[0].detail).toMatch(
      /that asset's data with an average sign in front of it/,
    );
  });

  it("warns about a thin sample without blocking it", () => {
    const r = screenPayload({ beta: 1.8 }, 3);
    expect(r.safe).toBe(true);
    expect(r.findings[0].severity).toBe("advisory");
  });

  it("says why screening happens before contribution rather than after", () => {
    const r = screenPayload({ tag: "6801" }, 10);
    expect(r.reason).toMatch(
      /cannot be recalled from anyone who has already read it/,
    );
  });
});

describe("recommendLane", () => {
  it("routes structural knowledge away from k-anonymity", () => {
    const r = recommendLane("component_breakdown");
    expect(r.lane).toBe("structural");
    expect(r.requiresKAnonymity).toBe(false);
    expect(r.requiresEngineerReview).toBe(true);
    // The reason matters: k-anonymity is not skipped for convenience, it has
    // nothing to protect when the fact is true whoever owns the machine.
    expect(r.reason).toMatch(/k-anonymity has nothing to protect/);
  });

  it("routes a fitted measurement into the statistical lane", () => {
    const r = recommendLane("weibull_beta");
    expect(r.lane).toBe("statistical");
    expect(r.requiresKAnonymity).toBe(true);
    expect(r.requiresEngineerReview).toBe(false);
    expect(r.reason).toMatch(/measurement of a particular fleet/);
  });
});

describe("assessContributionPosture", () => {
  const base: ContributionPosture = {
    structuralConsent: false,
    statisticalConsent: false,
    termsVersion: null,
    policyTermsVersion: "v1-draft",
    consentIsCurrent: false,
    ownContributions: 0,
    ownWithdrawn: 0,
    freshBenchmarks: 0,
    staleBenchmarks: 0,
    mayReadBenchmarks: false,
    accessBasis:
      "No access. Shared benchmarks are reciprocal: contributing to the pool is what grants the right to read it. A pilot override can be granted instead.",
  };

  it("states plainly that a non-consenting tenant contributes nothing", () => {
    const r = assessContributionPosture(base);
    expect(r.contributing).toBe(false);
    expect(r.reason).toMatch(
      /contributes nothing to the shared knowledge base/,
    );
    expect(r.reason).toMatch(
      /never been asked and a tenant that declined are treated identically/,
    );
  });

  it("tells a non-contributor they also cannot read the pool", () => {
    // Under the reciprocal model these are two separate facts and a customer
    // weighing the opt-in needs both: what they give AND what they forgo.
    const r = assessContributionPosture({ ...base, freshBenchmarks: 4 });
    expect(r.contributing).toBe(false);
    expect(r.mayRead).toBe(false);
    expect(r.reason).toMatch(
      /contributes nothing to the shared knowledge base/,
    );
    expect(r.reason).toMatch(
      /contributing to the pool is what grants the right to read it/,
    );
  });

  it("reports a pilot override as read access without contribution", () => {
    const r = assessContributionPosture({
      ...base,
      freshBenchmarks: 4,
      mayReadBenchmarks: true,
      accessBasis: "Read access granted without contributing: 90-day pilot",
    });
    expect(r.contributing).toBe(false);
    expect(r.mayRead).toBe(true);
    expect(r.reason).toMatch(/90-day pilot/);
  });

  it("treats consent under superseded terms as not contributing", () => {
    const r = assessContributionPosture({
      ...base,
      statisticalConsent: true,
      termsVersion: "v0",
      policyTermsVersion: "v1",
      consentIsCurrent: false,
    });
    // The dangerous default would be to keep contributing under old terms.
    expect(r.contributing).toBe(false);
    expect(r.consentNeedsRenewal).toBe(true);
    expect(r.reason).toMatch(/does not carry forward/);
  });

  it("reports a contributing tenant and any withheld benchmarks", () => {
    const r = assessContributionPosture({
      ...base,
      structuralConsent: true,
      statisticalConsent: true,
      termsVersion: "v1",
      policyTermsVersion: "v1",
      consentIsCurrent: true,
      ownContributions: 3,
      ownWithdrawn: 1,
      staleBenchmarks: 2,
      mayReadBenchmarks: true,
      accessBasis:
        "Reciprocal — this organization contributes and may therefore read",
    });
    expect(r.contributing).toBe(true);
    expect(r.reason).toMatch(/structural and statistical/);
    expect(r.reason).toMatch(/3 active contribution\(s\), 1 withdrawn/);
    expect(r.reason).toMatch(/2 published benchmark\(s\) are withheld/);
  });

  it("reads a missing policy as off, not as permitted", () => {
    const r = assessContributionPosture(null);
    expect(r.contributing).toBe(false);
    expect(r.reason).toMatch(/default state and it is the safe one/);
  });
});
