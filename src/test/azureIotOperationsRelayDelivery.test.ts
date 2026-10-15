import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  UndeliveredRelayError,
  deliverEventHubBatch,
  failureAdvancesCheckpoint,
  relayRetryPolicy,
  type RelayInvocation,
} from "../../infra/azure/iot-operations-relay/src/delivery";

const env = {
  SYNCAI_INGRESS_URL: "https://ingress.example/azure-iot-operations-ingest",
  SYNCAI_INGRESS_KEY_ID: "mine-a-key",
  SYNCAI_INGRESS_SECRET: "0123456789abcdef0123456789abcdef",
};

const reading = {
  _syncai_source: "mine-a/crusher-01",
  Pressure: {
    Value: 4.2,
    SourceTimestamp: "2026-10-03T18:00:00Z",
    StatusCode: "Good",
  },
  Temperature: {
    Value: 71.4,
    SourceTimestamp: "2026-10-03T18:00:01Z",
    StatusCode: "Good",
  },
};

function invocation(): RelayInvocation & { errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    triggerMetadata: {
      partitionContext: { partitionId: "3" },
      offsetArray: ["4401"],
      sequenceNumberArray: ["81"],
    },
    log: () => undefined,
    error: (message) => {
      errors.push(String(message));
    },
  };
}

function response(status: number): Response {
  return new Response(status >= 400 ? "no" : "{}", {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function runHost(
  invoke: () => Promise<void>,
  endOffset: string,
  attempts = 4,
) {
  let checkpoint: string | null = null;
  let failures = 0;
  while (failures < attempts) {
    try {
      await invoke();
      checkpoint = endOffset;
      return { checkpoint, failures };
    } catch {
      failures += 1;
      if (failureAdvancesCheckpoint(relayRetryPolicy, failures)) {
        checkpoint = endOffset;
        return { checkpoint, failures, exhausted: true };
      }
    }
  }
  return { checkpoint, failures };
}

describe("Azure IoT Operations relay checkpoint", () => {
  it("registers an indefinite host retry so a failed delivery does not finish the checkpoint policy", () => {
    const relay = readFileSync(
      "infra/azure/iot-operations-relay/src/functions/relay.ts",
      "utf8",
    );
    const readme = readFileSync(
      "infra/azure/iot-operations-relay/README.md",
      "utf8",
    );
    expect(relay).toContain("retry: relayRetryPolicy");
    expect(relayRetryPolicy).toEqual({
      strategy: "exponentialBackoff",
      maxRetryCount: -1,
      minimumInterval: { seconds: 10 },
      maximumInterval: { minutes: 5 },
    });
    expect(failureAdvancesCheckpoint(undefined, 1)).toBe(true);
    expect(failureAdvancesCheckpoint({ maxRetryCount: 3 }, 3)).toBe(false);
    expect(failureAdvancesCheckpoint({ maxRetryCount: 3 }, 4)).toBe(true);
    expect(failureAdvancesCheckpoint(relayRetryPolicy, 4)).toBe(false);
    expect(readme).not.toMatch(/does not checkpoint that Event Hubs batch/i);
    expect(readme).toContain("maxRetryCount: -1");
  });

  it("does not advance the checkpoint while ingress keeps failing", async () => {
    let calls = 0;
    const seen: string[] = [];
    const result = await runHost(async () => {
      await deliverEventHubBatch([reading], invocation(), {
        env,
        chunkSize: 1,
        sleep: async () => undefined,
        now: () => Date.parse("2026-10-03T18:00:05Z"),
        fetch: async (_url, init) => {
          calls += 1;
          const body = JSON.parse(String(init?.body)) as {
            delivery_id: string;
          };
          seen.push(body.delivery_id);
          if (body.delivery_id.endsWith("chunk-2-of-2")) return response(503);
          return response(202);
        },
      });
    }, "4401");
    expect(result.checkpoint).toBeNull();
    expect(result.failures).toBe(4);
    expect(calls).toBe(4 * (1 + 3));
    expect(new Set(seen.filter((id) => id.endsWith("chunk-1-of-2")))).toEqual(
      new Set(["3:4401:4401:1:chunk-1-of-2"]),
    );
    expect(seen.filter((id) => id.endsWith("chunk-2-of-2")).length).toBe(12);
  });

  it("checkpoints only after every chunk is accepted, and replays the accepted chunk", async () => {
    const bodies: string[] = [];
    let rejectSecond = true;
    const context = invocation();
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body);
      bodies.push(body);
      const headers = new Headers(init?.headers);
      expect(headers.get("x-syncai-signature")).toMatch(
        /^sha256=[0-9a-f]{64}$/,
      );
      const parsed = JSON.parse(body) as { delivery_id: string };
      if (rejectSecond && parsed.delivery_id.endsWith("chunk-2-of-2"))
        return response(503);
      return response(202);
    };
    await expect(
      deliverEventHubBatch([reading], context, {
        env,
        chunkSize: 1,
        sleep: async () => undefined,
        now: () => Date.parse("2026-10-03T18:00:05Z"),
        fetch: fetchImpl,
      }),
    ).rejects.toBeInstanceOf(UndeliveredRelayError);
    expect(context.errors).toEqual(["SyncAI relay delivery failed"]);
    rejectSecond = false;
    const hosted = await runHost(
      () =>
        deliverEventHubBatch([reading], invocation(), {
          env,
          chunkSize: 1,
          sleep: async () => undefined,
          now: () => Date.parse("2026-10-03T18:00:30Z"),
          fetch: fetchImpl,
        }),
      "4401",
    );
    expect(hosted).toEqual({ checkpoint: "4401", failures: 0 });
    const ids = bodies.map(
      (body) => (JSON.parse(body) as { delivery_id: string }).delivery_id,
    );
    expect(ids[0]).toBe("3:4401:4401:1:chunk-1-of-2");
    expect(ids.at(-2)).toBe(ids[0]);
    expect(ids.at(-1)).toBe("3:4401:4401:1:chunk-2-of-2");
  });

  it("holds the checkpoint for an unpersisted 4xx and for an undecodable payload", async () => {
    let calls = 0;
    const refused = await runHost(async () => {
      await deliverEventHubBatch([reading], invocation(), {
        env,
        sleep: async () => undefined,
        fetch: async () => {
          calls += 1;
          return response(422);
        },
      });
    }, "4401");
    expect(refused.checkpoint).toBeNull();
    expect(calls).toBe(4);

    const undecodable = await runHost(
      () =>
        deliverEventHubBatch([Buffer.from([0x01, 0x02])], invocation(), {
          env,
          fetch: async () => {
            throw new Error("fetch must not run");
          },
        }),
      "4401",
    );
    expect(undecodable.checkpoint).toBeNull();
  });

  it("returns a metadata-only batch without posting it", async () => {
    let calls = 0;
    const hosted = await runHost(
      () =>
        deliverEventHubBatch(
          [{ MessageType: "ua-metadata", MetaData: { Fields: [] } }],
          invocation(),
          {
            env,
            fetch: async () => {
              calls += 1;
              return response(202);
            },
          },
        ),
      "4401",
    );
    expect(hosted).toEqual({ checkpoint: "4401", failures: 0 });
    expect(calls).toBe(0);
  });
});
