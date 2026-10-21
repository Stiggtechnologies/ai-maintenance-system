import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

const deliveryModulePath =
  "../../infra/azure/iot-operations-relay/src/delivery.ts";

interface DeadLetterRecord {
  reason: string;
  detail: string;
  deliveryId: string;
  status: number | null;
  points?: Array<{ value?: number }>;
  messages?: unknown[];
}

interface RelayInvocation {
  triggerMetadata?: Record<string, unknown> | null;
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  errors: string[];
}

interface DeliveryModule {
  UndeliveredRelayError: new (...args: never[]) => Error;
  PermanentRelayError: new (...args: never[]) => Error;
  CHECKPOINT_LAG_ALERT_MS: number;
  CONSECUTIVE_FAILURE_ALERT_COUNT: number;
  PERMANENT_INGRESS_STATUSES: readonly number[];
  checkpointLagMs: (
    metadata: Record<string, unknown> | null | undefined,
    nowMs: number,
  ) => number | null;
  deadLetterBlobUrl: (containerUrl: string, name: string) => string;
  deliverEventHubBatch: (
    messages: unknown[],
    context: RelayInvocation,
    options?: {
      env?: NodeJS.ProcessEnv;
      fetch?: typeof fetch;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
      chunkSize?: number;
      attempt?: number;
      deadLetter?: (record: DeadLetterRecord) => Promise<void>;
    },
  ) => Promise<void>;
  failureAdvancesCheckpoint: (
    policy: { maxRetryCount: number } | undefined,
    failuresSoFar: number,
  ) => boolean;
  relayFailureStreak: () => number;
  relayRetryPolicy: {
    strategy: string;
    maxRetryCount: number;
    minimumInterval: { seconds: number };
    maximumInterval: { minutes: number };
  };
  resetRelayFailureStreak: () => void;
}

const delivery = (await import(deliveryModulePath)) as DeliveryModule;

const env = {
  SYNCAI_INGRESS_URL: "https://ingress.example/azure-iot-operations-ingest",
  SYNCAI_INGRESS_KEY_ID: "mine-a-key",
  // Letters and hyphens only, and at least 32 characters. Delivery uses this
  // as an HMAC key; a 32-character hex string matches gitleaks generic-api-key.
  SYNCAI_INGRESS_SECRET: "syncai-ingress-test-fixture-placeholder",
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

function invocation(metadata: Record<string, unknown> = {}): RelayInvocation {
  const errors: string[] = [];
  return {
    errors,
    triggerMetadata: {
      partitionContext: { partitionId: "3" },
      offsetArray: ["4401"],
      sequenceNumberArray: ["81"],
      ...metadata,
    },
    log: () => undefined,
    error: (message) => {
      errors.push(String(message));
    },
  };
}

function response(
  status: number,
  body = status >= 400 ? "no" : "{}",
): Response {
  return new Response(body, {
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
      if (
        delivery.failureAdvancesCheckpoint(delivery.relayRetryPolicy, failures)
      ) {
        checkpoint = endOffset;
        return { checkpoint, failures, exhausted: true };
      }
    }
  }
  return { checkpoint, failures };
}

beforeEach(() => {
  delivery.resetRelayFailureStreak();
});

describe("Azure IoT Operations relay checkpoint", () => {
  it("keeps a thrown delivery from finishing the checkpoint policy", () => {
    const relay = readFileSync(
      "infra/azure/iot-operations-relay/src/functions/relay.ts",
      "utf8",
    );
    const readme = readFileSync(
      "infra/azure/iot-operations-relay/README.md",
      "utf8",
    );
    expect(relay).toContain("retry: relayRetryPolicy");
    expect(delivery.relayRetryPolicy).toEqual({
      strategy: "exponentialBackoff",
      maxRetryCount: -1,
      minimumInterval: { seconds: 10 },
      maximumInterval: { minutes: 5 },
    });
    expect(delivery.failureAdvancesCheckpoint(undefined, 1)).toBe(true);
    expect(delivery.failureAdvancesCheckpoint({ maxRetryCount: 3 }, 3)).toBe(
      false,
    );
    expect(delivery.failureAdvancesCheckpoint({ maxRetryCount: 3 }, 4)).toBe(
      true,
    );
    expect(
      delivery.failureAdvancesCheckpoint(delivery.relayRetryPolicy, 4),
    ).toBe(false);
    expect(readme).not.toMatch(/does not checkpoint that Event Hubs batch/i);
    expect(readme).toContain("maxRetryCount: -1");
    expect(readme).toContain("dead-letter");
  });

  it("does not advance the checkpoint while a transient failure is still inside the attempt budget", async () => {
    let calls = 0;
    const seen: string[] = [];
    const deadLetters: DeadLetterRecord[] = [];
    const result = await runHost(async () => {
      await delivery.deliverEventHubBatch([reading], invocation(), {
        env,
        chunkSize: 1,
        attempt: 0,
        sleep: async () => undefined,
        now: () => Date.parse("2026-10-03T18:00:05Z"),
        deadLetter: async (record) => {
          deadLetters.push(record);
        },
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
    expect(deadLetters).toEqual([]);
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
      delivery.deliverEventHubBatch([reading], context, {
        env,
        chunkSize: 1,
        attempt: 0,
        sleep: async () => undefined,
        now: () => Date.parse("2026-10-03T18:00:05Z"),
        fetch: fetchImpl,
      }),
    ).rejects.toBeInstanceOf(delivery.UndeliveredRelayError);
    expect(context.errors).toContain("SyncAI relay delivery failed");
    rejectSecond = false;
    const hosted = await runHost(
      () =>
        delivery.deliverEventHubBatch([reading], invocation(), {
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

  it("dead-letters a permanent refusal and an undecodable payload, then advances", async () => {
    const deadLetters: DeadLetterRecord[] = [];
    let calls = 0;
    const refused = await runHost(async () => {
      await delivery.deliverEventHubBatch([reading], invocation(), {
        env,
        sleep: async () => undefined,
        deadLetter: async (record) => {
          deadLetters.push(record);
        },
        fetch: async () => {
          calls += 1;
          return response(
            422,
            JSON.stringify({ error: "no", dead_lettered: false }),
          );
        },
      });
    }, "4401");
    expect(refused).toEqual({ checkpoint: "4401", failures: 0 });
    expect(calls).toBe(1);
    expect(deadLetters.map((entry) => entry.reason)).toEqual([
      "permanent_refusal",
    ]);
    expect(deadLetters[0]?.points?.map((point) => point.value)).toEqual([
      4.2, 71.4,
    ]);

    const stored = await runHost(async () => {
      await delivery.deliverEventHubBatch([reading], invocation(), {
        env,
        deadLetter: async () => {
          throw new Error("ingress already stored this refusal");
        },
        fetch: async () =>
          response(
            422,
            JSON.stringify({ error: "refused", dead_lettered: true }),
          ),
      });
    }, "4401");
    expect(stored).toEqual({ checkpoint: "4401", failures: 0 });

    let fetched = 0;
    const undecodable = await runHost(
      () =>
        delivery.deliverEventHubBatch(
          [Buffer.from([0x01, 0x02])],
          invocation(),
          {
            env,
            deadLetter: async (record) => {
              deadLetters.push(record);
            },
            fetch: async () => {
              fetched += 1;
              return response(202);
            },
          },
        ),
      "4401",
    );
    expect(undecodable).toEqual({ checkpoint: "4401", failures: 0 });
    expect(fetched).toBe(0);
    expect(deadLetters.at(-1)?.reason).toBe("undecodable");
    expect(deadLetters.at(-1)?.messages).toEqual([
      {
        encoding: "base64",
        data: Buffer.from([0x01, 0x02]).toString("base64"),
      },
    ]);
  });

  it("dead-letters only 400, 413 and 422, and retries every other 4xx", async () => {
    expect(delivery.PERMANENT_INGRESS_STATUSES).toEqual([400, 413, 422]);
    for (const status of [400, 413]) {
      const deadLetters: DeadLetterRecord[] = [];
      let calls = 0;
      const hosted = await runHost(async () => {
        await delivery.deliverEventHubBatch([reading], invocation(), {
          env,
          sleep: async () => undefined,
          deadLetter: async (record) => {
            deadLetters.push(record);
          },
          fetch: async () => {
            calls += 1;
            return response(status, JSON.stringify({ error: "no" }));
          },
        });
      }, "4401");
      expect(hosted).toEqual({ checkpoint: "4401", failures: 0 });
      expect(calls).toBe(1);
      expect(deadLetters).toHaveLength(1);
      expect(deadLetters[0]?.points?.length).toBe(2);
    }

    for (const status of [401, 404, 408, 409, 429]) {
      const deadLetters: DeadLetterRecord[] = [];
      let calls = 0;
      const hosted = await runHost(async () => {
        await delivery.deliverEventHubBatch([reading], invocation(), {
          env,
          sleep: async () => undefined,
          deadLetter: async (record) => {
            deadLetters.push(record);
          },
          fetch: async () => {
            calls += 1;
            return response(
              status,
              JSON.stringify({
                error: "signature_timestamp_outside_window",
              }),
            );
          },
        });
      }, "4401");
      expect(hosted.checkpoint).toBeNull();
      expect(hosted.failures).toBeGreaterThan(0);
      expect(deadLetters).toEqual([]);
      expect(calls).toBeGreaterThan(1);
    }
  });

  it("keeps retrying a transient failure instead of dead-lettering it", async () => {
    const deadLetters: DeadLetterRecord[] = [];
    const outage = await runHost(async () => {
      await delivery.deliverEventHubBatch([reading], invocation(), {
        env,
        attempt: 100,
        sleep: async () => undefined,
        deadLetter: async (record) => {
          deadLetters.push(record);
        },
        fetch: async () => response(503),
      });
    }, "4401");
    expect(outage).toEqual({ checkpoint: null, failures: 4 });
    expect(deadLetters).toEqual([]);
  });

  it("alerts on a consecutive failure streak and on checkpoint lag", async () => {
    const context = invocation();
    for (
      let count = 0;
      count < delivery.CONSECUTIVE_FAILURE_ALERT_COUNT;
      count += 1
    ) {
      await expect(
        delivery.deliverEventHubBatch([reading], context, {
          env,
          attempt: 0,
          sleep: async () => undefined,
          fetch: async () => response(503),
        }),
      ).rejects.toBeInstanceOf(delivery.UndeliveredRelayError);
    }
    expect(delivery.relayFailureStreak()).toBe(
      delivery.CONSECUTIVE_FAILURE_ALERT_COUNT,
    );
    expect(context.errors).toContain("SyncAI relay consecutive failures");

    const now = Date.parse("2026-10-03T18:20:00Z");
    const lagging = invocation({
      enqueuedTimeUtcArray: [
        new Date(now - delivery.CHECKPOINT_LAG_ALERT_MS).toISOString(),
      ],
    });
    expect(delivery.checkpointLagMs(lagging.triggerMetadata, now)).toBe(
      delivery.CHECKPOINT_LAG_ALERT_MS,
    );
    await delivery.deliverEventHubBatch(
      [{ MessageType: "ua-metadata", MetaData: { Fields: [] } }],
      lagging,
      { env, now: () => now, fetch: async () => response(202) },
    );
    expect(lagging.errors).toContain("SyncAI relay checkpoint lag");
  });

  it("returns a metadata-only batch without posting it", async () => {
    let calls = 0;
    const hosted = await runHost(
      () =>
        delivery.deliverEventHubBatch(
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

  it("keeps a blob SAS query string on the dead-letter object URL", () => {
    expect(
      delivery.deadLetterBlobUrl(
        "https://storage.example/dead-letter?sig=abc",
        "batch.json",
      ),
    ).toBe("https://storage.example/dead-letter/batch.json?sig=abc");
  });
});
