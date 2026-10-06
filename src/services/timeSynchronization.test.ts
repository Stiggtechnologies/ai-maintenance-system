import { beforeEach, describe, expect, it, vi } from "vitest";
import { timeSynchronizationActions } from "./timeSynchronization";

const transport = vi.hoisted(() => ({
  body: null as unknown,
  fail: false,
  requests: [] as Record<string, unknown>[],
}));

vi.mock("../lib/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient(
      "https://clock-fixture.invalid",
      "synthetic-public-key",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: async (_url, init) => {
            transport.requests.push(JSON.parse(String(init?.body)));
            if (transport.fail) throw new TypeError("Synthetic lost response");
            return new Response(JSON.stringify(transport.body), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          },
        },
      },
    ),
  };
});

const connectorId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";
const auditId = "44444444-4444-4444-8444-444444444444";
const eventTime = "2026-10-03T14:05:12.000001Z";
const args = {
  connectorId,
  idempotencyKey: key,
  protocol: "ntp" as const,
  referenceAuthority: "Synthetic reference",
  toleranceMs: 20,
  maxObservationAgeMinutes: 5,
  evidenceReference: "OPAQUE-CLOCK-REF",
  basis:
    "Synthetic fixture only; no operational or engineering approval is claimed.",
};
const acknowledgement = {
  ok: true,
  connector_id: connectorId,
  idempotency_key: key,
  audit_id: auditId,
  configuration_revision: 1,
  current_configuration_revision: 2,
  replay: true,
  state: "unproven",
  operational_authority: false,
  configuration_evidence_verified: false,
  eligible_for_time_sensitive_evidence: false,
  note: "Historical configuration receipt only; approval remains unverified.",
};
const connector = {
  connectorId,
  connectorKey: "synthetic-clock",
  name: "Synthetic clock",
  enabled: true,
  protocol: "ntp",
  referenceAuthority: "Synthetic reference",
  toleranceMs: 20,
  maxObservationAgeMinutes: 5,
  configurationRevision: 1,
  configurationEvidenceReference: "OPAQUE-CLOCK-REF",
  configuredAt: eventTime,
  state: "unproven",
  withinClockContract: false,
  configurationEvidenceVerified: false,
  eligibleForTimeSensitiveEvidence: false,
  reason: "No matching observation.",
  observationId: null,
  sourceClockAt: null,
  referenceClockAt: null,
  receivedAt: null,
  offsetMs: null,
  measurementUncertaintyMs: null,
  worstCaseOffsetMs: null,
  observationEvidenceReference: null,
};
const workspace = {
  generatedAt: eventTime,
  operationalAuthority: false,
  setsSourceClocks: false,
  connectors: [connector],
};
const assessment = {
  connector_id: connectorId,
  event_time: eventTime,
  state: "unproven",
  within_clock_contract: false,
  contract_scope: "recorded_contract_at_event",
  history_integrity: "verified_recorded_chain",
  history_reason: null,
  configuration_audit_id: auditId,
  configuration_revision: 1,
  configuration_recorded_at: eventTime,
  observation_id: null,
  worst_case_offset_ms: null,
  tolerance_ms: 20,
  max_observation_age_minutes: 5,
  configuration_evidence_verified: false,
  eligible_for_time_sensitive_evidence: false,
  operational_authority: false,
  note: "Numerical assessment only; no evidence approval.",
};

beforeEach(() => {
  transport.body = null;
  transport.fail = false;
  transport.requests = [];
});

describe("time assurance actual SDK qualification", () => {
  it("submits a stable intent UUID and accepts a qualified historical replay", async () => {
    transport.body = acknowledgement;
    expect(await timeSynchronizationActions.configure(args)).toEqual(
      acknowledgement,
    );
    expect(transport.requests[0].p_idempotency_key).toBe(key);
  });

  it.each([
    null,
    {},
    { error: "" },
    { error: "   " },
    { ...acknowledgement, ok: false },
    { ...acknowledgement, connector_id: otherId },
    { ...acknowledgement, idempotency_key: otherId },
    { ...acknowledgement, audit_id: "not-a-uuid" },
    { ...acknowledgement, configuration_revision: 0 },
    { ...acknowledgement, configuration_revision: "1" },
    { ...acknowledgement, configuration_revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...acknowledgement, current_configuration_revision: 0 },
    { ...acknowledgement, current_configuration_revision: 0.5 },
    { ...acknowledgement, current_configuration_revision: "2" },
    { ...acknowledgement, replay: "true" },
    { ...acknowledgement, replay: false },
    { ...acknowledgement, state: "synchronized" },
    { ...acknowledgement, operational_authority: true },
    { ...acknowledgement, configuration_evidence_verified: true },
    { ...acknowledgement, eligible_for_time_sensitive_evidence: true },
    { ...acknowledgement, note: "" },
    { ...acknowledgement, error: "contradictory acknowledgement" },
  ])(
    "refuses an unqualified configuration acknowledgement %#",
    async (body) => {
      transport.body = body;
      await expect(
        timeSynchronizationActions.configure(args),
      ).rejects.toMatchObject({
        name: "TimeAssuranceUnknownOutcomeError",
      });
    },
  );

  it("rejects a current revision older than its original receipt", async () => {
    transport.body = { ...acknowledgement, configuration_revision: 3 };
    await expect(
      timeSynchronizationActions.configure(args),
    ).rejects.toMatchObject({
      name: "TimeAssuranceUnknownOutcomeError",
    });
  });

  it("distinguishes a canonical refusal from a lost response", async () => {
    transport.body = { error: "Configuration intent collision refused" };
    await expect(
      timeSynchronizationActions.configure(args),
    ).rejects.toMatchObject({
      name: "TimeAssuranceRefusalError",
    });
    transport.fail = true;
    await expect(
      timeSynchronizationActions.configure(args),
    ).rejects.toMatchObject({
      name: "TimeAssuranceUnknownOutcomeError",
    });
  });

  it("qualifies a canonical workspace without inventing missing connectors", async () => {
    transport.body = workspace;
    expect(await timeSynchronizationActions.status()).toEqual(workspace);
    transport.body = { ...workspace, connectors: [] };
    expect((await timeSynchronizationActions.status()).connectors).toEqual([]);
  });

  it.each([
    null,
    {},
    { error: "" },
    { ...workspace, generatedAt: "yesterday" },
    { ...workspace, operationalAuthority: true },
    { ...workspace, setsSourceClocks: true },
    { ...workspace, connectors: null },
    ...[
      { connectorId: "foreign" },
      { state: "approved" },
      { enabled: "true" },
      { eligibleForTimeSensitiveEvidence: true },
      { configurationEvidenceVerified: true },
      { withinClockContract: true },
      { configurationRevision: "1" },
      { toleranceMs: null },
      { maxObservationAgeMinutes: -1 },
      { observationId: "bad" },
      { measurementUncertaintyMs: -1 },
      { sourceClockAt: "not-an-instant" },
      { reason: "" },
    ].map((change) => ({
      ...workspace,
      connectors: [{ ...connector, ...change }],
    })),
  ])("refuses malformed or authority-bearing workspace %#", async (body) => {
    transport.body = body;
    await expect(timeSynchronizationActions.status()).rejects.toThrow();
  });

  it("matches equivalent timezone representations without dropping microseconds", async () => {
    transport.body = {
      ...assessment,
      event_time: "2026-10-03T08:05:12.000001-06:00",
    };
    expect(
      await timeSynchronizationActions.evaluateEventTime(
        connectorId,
        eventTime,
      ),
    ).toMatchObject({ connector_id: connectorId });
  });

  it("does not coerce a history-state array into a qualified enum", async () => {
    transport.body = {
      ...assessment,
      history_integrity: ["unproven"],
      configuration_revision: null,
      configuration_audit_id: null,
      configuration_recorded_at: null,
      tolerance_ms: null,
      max_observation_age_minutes: null,
    };
    await expect(
      timeSynchronizationActions.evaluateEventTime(connectorId, eventTime),
    ).rejects.toThrow();
  });

  it.each([
    null,
    {},
    { error: "" },
    { ...assessment, connector_id: otherId },
    { ...assessment, event_time: "2026-10-03T14:05:12.000002Z" },
    { ...assessment, event_time: "2026-10-03T14:05:12" },
    { ...assessment, event_time: "2026-02-30T14:05:12Z" },
    { ...assessment, state: "approved" },
    { ...assessment, within_clock_contract: true },
    { ...assessment, contract_scope: "current_contract_only" },
    { ...assessment, history_integrity: "verified" },
    { ...assessment, configuration_revision: "1" },
    { ...assessment, configuration_audit_id: "receipt" },
    { ...assessment, tolerance_ms: -1 },
    { ...assessment, configuration_evidence_verified: true },
    { ...assessment, eligible_for_time_sensitive_evidence: true },
    { ...assessment, operational_authority: true },
    { ...assessment, note: "" },
  ])("refuses malformed or mismatched event assessment %#", async (body) => {
    transport.body = body;
    await expect(
      timeSynchronizationActions.evaluateEventTime(connectorId, eventTime),
    ).rejects.toThrow();
  });
});
