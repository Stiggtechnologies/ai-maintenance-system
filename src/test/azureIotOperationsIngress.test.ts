import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  azureIotIngressStatus,
  parseAzureIotIngressBindings,
  parseAzureIotIngressEnvelope,
  sha256Hex,
  verifyAzureIotIngressSignature,
} from "../../supabase/functions/_shared/azure-iot-operations-ingress";

const secret = "a-32-character-minimum-ingress-secret-value";
const nowMs = 1_800_000_000_000;
const timestamp = String(Math.floor(nowMs / 1000));
const body = JSON.stringify({
  delivery_id: "0:1234:1234:1",
  points: [
    {
      external_id: "0:1234:temperature",
      tag: "mine-a/crusher-01/temperature",
      value: 71.4,
      source_timestamp: "2026-10-03T18:00:00Z",
      quality: "good",
      partition_id: "0",
      offset: "1234",
      sequence_number: 98,
    },
  ],
});

describe("Azure IoT Operations signed ingress core", () => {
  it("binds every key ID to one tenant, connector and sufficiently strong secret", () => {
    const bindings = parseAzureIotIngressBindings(
      JSON.stringify({
        "mine-a-key": {
          organization_id: "11111111-1111-4111-8111-111111111111",
          connector_key: "mine-a-aio",
          secret,
        },
      }),
    );
    expect(bindings["mine-a-key"]).toEqual({
      organizationId: "11111111-1111-4111-8111-111111111111",
      connectorKey: "mine-a-aio",
      secret,
    });
    expect(() =>
      parseAzureIotIngressBindings(
        JSON.stringify({
          "mine-a-key": {
            organization_id: "11111111-1111-4111-8111-111111111111",
            connector_key: "mine-a-aio",
            secret: "short",
          },
        }),
      ),
    ).toThrow(/invalid/);
  });

  it("verifies the exact timestamped body and returns its provenance digest", async () => {
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    await expect(
      verifyAzureIotIngressSignature({
        body,
        timestamp,
        signature: `sha256=${signature}`,
        secret,
        nowMs,
      }),
    ).resolves.toEqual({
      bodySha256: await sha256Hex(body),
      receivedAt: new Date(nowMs).toISOString(),
    });
    await expect(
      verifyAzureIotIngressSignature({
        body: `${body} `,
        timestamp,
        signature,
        secret,
        nowMs,
      }),
    ).rejects.toThrow("invalid_signature");
  });

  it("refuses stale requests and every control-shaped payload", async () => {
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    await expect(
      verifyAzureIotIngressSignature({
        body,
        timestamp,
        signature,
        secret,
        nowMs: nowMs + 301_000,
      }),
    ).rejects.toThrow("outside_window");
    expect(() =>
      parseAzureIotIngressEnvelope(
        JSON.stringify({
          delivery_id: "0:1234:1234:1",
          command: { node: "ns=2;s=Valve", value: 1 },
          points: [],
        }),
      ),
    ).toThrow("control_payload_refused");
    expect(() =>
      parseAzureIotIngressEnvelope(
        JSON.stringify({
          delivery_id: "0:1234:1234:1",
          points: [
            {
              external_id: "0:1234:x",
              tag: "asset/x",
              value: 1,
              source_timestamp: "2026-10-03T18:00:00Z",
              method_call: "OpenValve",
            },
          ],
        }),
      ),
    ).toThrow("control_payload_refused");
  });

  it("normalizes quality and preserves replay identities", () => {
    const parsed = parseAzureIotIngressEnvelope(body);
    expect(parsed.deliveryId).toBe("0:1234:1234:1");
    expect(parsed.deadLetter).toBeUndefined();
    expect(parsed.points[0]).toMatchObject({
      external_id: "0:1234:temperature",
      tag: "mine-a/crusher-01/temperature",
      quality: "good",
      sequence_number: "98",
    });
  });

  it("classifies database failures as retryable and refusals as permanent", () => {
    expect(azureIotIngressStatus({ phase: "rpc_transport" })).toBe(503);
    expect(
      azureIotIngressStatus({
        phase: "rpc_result",
        message: "enabled Azure IoT Operations connector not found",
      }),
    ).toBe(422);
    expect(
      azureIotIngressStatus({
        phase: "signature",
        message: "invalid_signature",
      }),
    ).toBe(401);
    expect(
      azureIotIngressStatus({ phase: "parse", message: "invalid_json" }),
    ).toBe(400);
    const deadLetter = parseAzureIotIngressEnvelope(
      JSON.stringify({
        delivery_id: "3:4401:4401:1:dead-letter",
        dead_letter_reason: "undecodable",
        dead_letter_detail: "Event 1 is not valid JSON",
        checkpoint_lag_seconds: 1200,
        messages: [{ encoding: "base64", data: "AQI=" }],
      }),
    );
    expect(deadLetter.points).toEqual([]);
    expect(deadLetter.deadLetter).toEqual({
      reason: "undecodable",
      detail: "Event 1 is not valid JSON",
      lagSeconds: 1200,
      points: [],
      messages: [{ encoding: "base64", data: "AQI=" }],
    });
    expect(() =>
      parseAzureIotIngressEnvelope(
        JSON.stringify({
          delivery_id: "3:4401:4401:1:dead-letter",
          dead_letter_reason: "permanent_refusal",
          dead_letter_detail: "ingress refused this batch",
        }),
      ),
    ).toThrow("dead_letter_payload_required");
  });
});
