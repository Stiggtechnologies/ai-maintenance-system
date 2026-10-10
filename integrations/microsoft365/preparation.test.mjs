import test from "node:test";
import assert from "node:assert/strict";
import { portfolio } from "./portfolio.mjs";
import { validatePackage } from "./validate.mjs";
import { readAdvisory } from "./advisory-pilot.mjs";
test("all 16 requested identities are unique and unlisted", () => {
  assert.equal(portfolio.length, 16);
  assert.equal(new Set(portfolio.map((x) => x.id)).size, 16);
  assert.ok(
    portfolio.every(
      (x) => !x.listingReady && x.microsoftStatus === "not-integrated",
    ),
  );
});
test("placeholder package cannot pass", () =>
  assert.equal(
    validatePackage(portfolio[0], { id: "placeholder" }).preflightPassed,
    false,
  ));
test("registered id alone cannot claim readiness", () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  assert.equal(
    validatePackage(
      portfolio[0],
      { id, copilotAgents: { customEngineAgents: [{}] } },
      { registeredAppIds: [id] },
    ).preflightPassed,
    false,
  );
});
test("16 agents in one package refused", () =>
  assert.ok(
    validatePackage(portfolio[0], {
      copilotAgents: { customEngineAgents: portfolio },
    }).errors.includes("exactly one supported agent per package required"),
  ));
const identity = {
  verified: true,
  tenantId: "tenant-a",
  organizationId: "org-a",
  subject: "human",
};
const entitlement = {
  expiresAt: "2099-01-01T00:00:00Z",
  status: "active",
  tenantId: "tenant-a",
  organizationId: "org-a",
  subscriptionId: "subscription-a",
  planId: "plan-a",
  quantity: 1,
  userIds: ["human"],
  agentIds: ["reliability"],
};
const deps = {
  readEntitlement: async () => entitlement,
  verifyIdentity: async () => identity,
  readTenantAgents: async () => [
    {
      organization_id: "org-a",
      key: "reliability_engineering",
      name: "Reliability Engineer",
      status: "active",
    },
  ],
};
test("read pilot returns canonical candidates and limitations", async () => {
  const r = await readAdvisory({ agentId: "reliability" }, deps);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.readOnly, true);
  assert.equal(r.sourceStatus, "partial");
});
test("request tenant cannot override identity", async () =>
  assert.rejects(
    readAdvisory({ agentId: "reliability", organizationId: "org-b" }, deps),
    /cross-tenant request/,
  ));
test("cross-tenant backend rows fail closed", async () =>
  assert.rejects(
    readAdvisory(
      { agentId: "reliability" },
      { ...deps, readTenantAgents: async () => [{ organization_id: "org-b" }] },
    ),
    /cross-tenant response/,
  ));
test("unverified identity refused before data read", async () =>
  assert.rejects(
    readAdvisory(
      { agentId: "reliability" },
      {
        ...deps,
        verifyIdentity: async () => ({ ...identity, verified: false }),
        readTenantAgents: async () => assert.fail("must not read"),
      },
    ),
    /verified tenant/,
  ));
test("unknown identity cannot fall through to generic agent", async () =>
  assert.rejects(
    readAdvisory({ agentId: "made-up" }, deps),
    /unknown requested/,
  ));

test("preflight never represents submission approval", () =>
  assert.equal(validatePackage(portfolio[0], {}).submissionReady, false));

for (const patch of [
  { expiresAt: "2000-01-01T00:00:00Z" },
  { expiresAt: "invalid" },
  { status: "suspended" },
  { status: "cancelled" },
  { status: "expired" },
  { tenantId: "tenant-b" },
  { organizationId: "org-b" },
  { agentIds: [] },
  { userIds: [] },
  { quantity: 0 },
  { userIds: ["human", "other"] },
  { planId: null },
]) {
  test(`entitlement refusal ${JSON.stringify(patch)}`, async () =>
    assert.rejects(
      readAdvisory(
        { agentId: "reliability" },
        {
          ...deps,
          readEntitlement: async () => ({ ...entitlement, ...patch }),
          readTenantAgents: async () => assert.fail("must not read"),
        },
      ),
      /entitlement/,
    ));
}
test("unsupported capability cannot become generic dispatch", async () =>
  assert.rejects(
    readAdvisory(
      { agentId: "energy-efficiency" },
      {
        ...deps,
        readEntitlement: async () => ({
          ...entitlement,
          agentIds: ["energy-efficiency"],
        }),
      },
    ),
    /unimplemented/,
  ));

test("full platform retained alongside agents without invented commercial policy", async () => {
  const { listingScope } = await import("./portfolio.mjs");
  assert.equal(listingScope.platform.scope, "complete-platform");
  assert.equal(listingScope.agents.requestedCount, 16);
  assert.equal(listingScope.commercialPolicy.approved, false);
  assert.equal(listingScope.commercialPolicy.pricingModel, null);
  assert.equal(listingScope.marketplaceSearchResultCount, null);
});
