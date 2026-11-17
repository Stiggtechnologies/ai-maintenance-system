import test from "node:test";
import assert from "node:assert/strict";
import { SyncAIAdvisoryAgent, startRegisteredAgent } from "./sdk-adapter.mjs";
import { Activity } from "@microsoft/agents-activity";
import { BaseAdapter, TurnContext } from "@microsoft/agents-hosting";
import { validateMicrosoftManifest } from "./schema-validation.mjs";
import { canonicalAdapters } from "./canonical-adapters.mjs";
class CaptureAdapter extends BaseAdapter {
  activities = [];
  async sendActivities(_context, activities) {
    this.activities.push(...activities);
    return activities.map((_, i) => ({ id: String(i) }));
  }
}
const identity = {
  verified: true,
  tenantId: "t",
  organizationId: "o",
  subject: "u",
};
const dependencies = {
  verifyIdentity: async () => identity,
  readEntitlement: async () => ({
    status: "active",
    expiresAt: "2099-01-01",
    tenantId: "t",
    organizationId: "o",
    subscriptionId: "s",
    planId: "p",
    quantity: 1,
    userIds: ["u"],
    agentIds: ["reliability"],
  }),
  readTenantAgents: async () => [
    {
      organization_id: "o",
      key: "reliability_engineering",
      name: "Reliability Engineer",
      status: "active",
    },
  ],
};
test("actual SDK TurnContext emits read advisory", async () => {
  const app = new SyncAIAdvisoryAgent({ agentId: "reliability", dependencies });
  app.getAuthorizedUserToken = async () => ({ token: "fixture-token" });
  const adapter = new CaptureAdapter();
  const context = new TurnContext(
    adapter,
    Activity.fromObject({
      type: "message",
      text: "read",
      channelId: "msteams",
      conversation: { id: "c" },
      from: { id: "u" },
      recipient: { id: "bot" },
    }),
  );
  await app.handleAdvisory(context);
  assert.match(adapter.activities[0].text, /Reliability Engineer/);
  assert.doesNotMatch(adapter.activities[0].text, /fixture-token/);
});
test("SDK auth failure graceful and redacted", async () => {
  const app = new SyncAIAdvisoryAgent({ agentId: "reliability", dependencies });
  app.getAuthorizedUserToken = async () => {
    throw new Error("secret backend detail");
  };
  const adapter = new CaptureAdapter();
  await app.handleAdvisory(
    new TurnContext(
      adapter,
      Activity.fromObject({
        type: "message",
        channelId: "msteams",
        conversation: { id: "c" },
        from: { id: "u" },
        recipient: { id: "bot" },
      }),
    ),
  );
  assert.match(adapter.activities[0].text, /Unable to verify/);
  assert.doesNotMatch(adapter.activities[0].text, /secret/);
});
test("native server refuses absent registration", () =>
  assert.throws(() => startRegisteredAgent({}, {}), /approved/));
test("official schema rejects skeletal package", () =>
  assert.equal(validateMicrosoftManifest({}).valid, false));
test("official schema enforces singleton custom engine", () =>
  assert.equal(
    validateMicrosoftManifest({
      copilotAgents: { customEngineAgents: [{}, {}] },
    }).valid,
    false,
  ));
test("schema-only pass is never publication approval", () =>
  assert.equal(validateMicrosoftManifest({}).submissionReady, false));
const tenant = "12345678-1234-4234-8234-123456789abc";
function canonicalFixture() {
  const calls = [];
  const adapter = canonicalAdapters({
    supabaseUrl: "https://fixture.invalid",
    publishableKey: "fixture-key",
    exchangeUserToken: async () => "fixture-session",
    resolveApprovedEntitlement: async () => null,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        json: async () =>
          String(url).includes("/auth/")
            ? { id: "user", app_metadata: { provider: "azure", tid: tenant } }
            : String(url).includes("user_profiles")
              ? [{ organization_id: "org", role: "user" }]
              : [
                  {
                    organization_id: "org",
                    key: "reliability_engineering",
                    name: "Reliability Engineer",
                    status: "active",
                  },
                ],
      };
    },
  });
  return { adapter, calls };
}
test("canonical Auth server user plus RLS read contract", async () => {
  const { adapter, calls } = canonicalFixture();
  const id = await adapter.verifyIdentity("fixture-microsoft-token");
  assert.equal(id.tenantId, tenant);
  assert.equal(id.organizationId, "org");
  const agents = await adapter.readTenantAgents(id);
  assert.equal(agents.length, 1);
  assert.ok(calls[2].url.includes("organization_id=eq.org"));
  assert.equal(
    calls[2].options.headers.Authorization,
    "Bearer fixture-session",
  );
  assert.equal(calls[2].options.redirect, "error");
});
test("canonical entitlement refuses until owner mapping supplied", async () => {
  const { adapter } = canonicalFixture();
  assert.equal(await adapter.readEntitlement(identity), null);
});
