import test from "node:test";
import assert from "node:assert/strict";
import { measureAdvisory, measurementPolicy } from "./measurement.mjs";
test("fixed event excludes input PII/token/prompt and binds full platform", async () => {
  let captured;
  await measureAdvisory(
    {
      agentId: "reliability",
      channelId: "teams",
      outcome: "advisory-returned",
      durationMs: 1234,
      tenantId: "private",
      token: "secret",
      prompt: "private",
    },
    (e) => {
      captured = e;
    },
  );
  assert.equal(captured.productId, "syncai-platform");
  assert.equal(captured.durationBucketMs, 2000);
  assert.equal(captured.agentId, "reliability");
  assert.doesNotMatch(
    JSON.stringify(captured),
    /private|secret|token|tenantId|prompt/,
  );
});
test("no collector configured by default", async () => {
  await measureAdvisory({});
  assert.equal(measurementPolicy.thirdPartyTransmissionEnabled, false);
  assert.equal(measurementPolicy.collectorConfigured, false);
});
test("untrusted channel normalizes without propagating data", async () => {
  let event;
  await measureAdvisory(
    {
      agentId: "reliability",
      channelId: "tenant-secret",
      outcome: "access-or-read-refused",
      durationMs: NaN,
    },
    (e) => {
      event = e;
    },
  );
  assert.equal(event.channelId, "other");
  assert.equal(event.durationBucketMs, null);
});
test("unknown agent is not an inflated product count", async () =>
  assert.rejects(
    measureAdvisory(
      { agentId: "fiction", outcome: "advisory-returned" },
      () => {},
    ),
    /unknown/,
  ));
test("collector failure adds no queue and does not alter authorized outcome", async () => {
  await measureAdvisory(
    { agentId: "reliability", outcome: "advisory-returned" },
    () => {
      throw new Error("collector unavailable");
    },
  );
  assert.equal(measurementPolicy.persistenceAdded, false);
});
test("portfolio expansion and retirement remain separate owner decisions", () => {
  assert.equal(measurementPolicy.portfolioIsClosed, false);
  assert.equal(measurementPolicy.retirementAuthorized, false);
});
