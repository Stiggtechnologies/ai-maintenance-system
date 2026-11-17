import { describe, expect, it } from "vitest";
import {
  buildMqttReadConnectOptions,
  canonicalMqttBatch,
  collectMqttReadWindow,
  createMqttJsReadSession,
  encodeMqttPayload,
  normalizeMqttPullRequest,
  parseMqttTopicFilters,
  topicMatchesFilter,
  validateMqttBrokerUrl,
  type MqttInbound,
  type MqttJsLikeClient,
  type MqttReadSession,
} from "../../supabase/functions/_shared/mqtt-read";

const allow = ["broker.example.com"];

class MockMqttBroker {
  readonly subscriptions: string[][] = [];
  readonly qos: number[] = [];
  disconnects = 0;
  publishAttempts = 0;
  connected = false;
  private opened = false;

  constructor(
    private readonly clock: { now: number },
    private readonly deliveries: Array<MqttInbound & { atMs: number }>,
  ) {}

  session(): MqttReadSession {
    return {
      connect: async () => {
        this.connected = true;
        this.opened = true;
      },
      subscribe: async (filters, qos) => {
        if (!this.opened) throw new Error("not connected");
        this.subscriptions.push([...filters]);
        this.qos.push(qos);
      },
      nextMessage: async (timeoutMs) => {
        const until = this.clock.now + timeoutMs;
        const index = this.deliveries.findIndex((item) => item.atMs <= until);
        if (index === -1) {
          this.clock.now = until;
          return null;
        }
        const [item] = this.deliveries.splice(index, 1);
        this.clock.now = Math.max(this.clock.now, item.atMs);
        const subscribed = this.subscriptions.flat();
        if (
          !subscribed.some((filter) => topicMatchesFilter(item.topic, filter))
        ) {
          return {
            topic: item.topic,
            payload: item.payload,
            qos: item.qos,
            retain: item.retain,
          };
        }
        return {
          topic: item.topic,
          payload: item.payload,
          qos: item.qos,
          retain: item.retain,
        };
      },
      disconnect: async () => {
        this.disconnects += 1;
        this.connected = false;
      },
    };
  }

  publish(): never {
    this.publishAttempts += 1;
    throw new Error("read-only MQTT session cannot publish");
  }
}

describe("MQTT read collector", () => {
  it("normalizes a bounded request and defaults to dry-run", () => {
    expect(
      normalizeMqttPullRequest({ connector_key: " north ", dry_run: false }),
    ).toEqual({ connectorKey: "north", dryRun: false });
    expect(normalizeMqttPullRequest({ connector_key: "north" })).toEqual({
      connectorKey: "north",
      dryRun: true,
    });
    expect(() => normalizeMqttPullRequest(null)).toThrow(/JSON object/);
    expect(() =>
      normalizeMqttPullRequest({ connector_key: "north", dry_run: "false" }),
    ).toThrow(/true or false/);
    expect(() =>
      normalizeMqttPullRequest({ connector_key: "x".repeat(161) }),
    ).toThrow(/160-character/);
  });

  it("accepts only a credential-free public wss URL on the allowlist", () => {
    const url = validateMqttBrokerUrl("wss://broker.example.com/mqtt", allow);
    expect(url.protocol).toBe("wss:");
    expect(url.hostname).toBe("broker.example.com");
    for (const refused of [
      "mqtts://broker.example.com:8883",
      "mqtt://broker.example.com",
      "ws://broker.example.com/mqtt",
      "wss://user:secret@broker.example.com/mqtt",
      "wss://broker.example.com/mqtt?token=1",
      "wss://localhost/mqtt",
      "wss://10.1.2.3/mqtt",
      "wss://other.example.com/mqtt",
    ]) {
      expect(() => validateMqttBrokerUrl(refused, allow)).toThrow(/MQTT/);
    }
    expect(() =>
      validateMqttBrokerUrl("wss://broker.example.com/mqtt", []),
    ).toThrow(/allowlist/);
  });

  it("rejects publish-shaped connection options", () => {
    const options = buildMqttReadConnectOptions({
      username: "reader",
      password: "not-a-real-secret",
      clientId: "syncai-ro-0123456789ab",
    });
    expect(options.protocol).toBe("wss");
    expect(options.protocolVersion).toBe(4);
    expect(options.clean).toBe(true);
    expect(options.reconnectPeriod).toBe(0);
    expect(options.resubscribe).toBe(false);
    expect("will" in options).toBe(false);
    expect("publish" in options).toBe(false);
    expect(() =>
      buildMqttReadConnectOptions({
        username: "reader",
        password: "secret",
        clientId: "custom-client",
      }),
    ).toThrow(/syncai-ro-/);
  });

  it("enforces MQTT wildcard structure", () => {
    expect(parseMqttTopicFilters(["plant/#", "plant/+/status"])).toEqual([
      "plant/#",
      "plant/+/status",
    ]);
    expect(topicMatchesFilter("plant/line1/pump", "plant/#")).toBe(true);
    expect(topicMatchesFilter("plant", "plant/#")).toBe(true);
    expect(topicMatchesFilter("plant/line1", "plant/+")).toBe(true);
    expect(topicMatchesFilter("plant/line1/pump", "plant/+")).toBe(false);
    expect(topicMatchesFilter("$SYS/broker", "#")).toBe(false);
    for (const filter of [
      "#/plant",
      "plant/#/extra",
      "pla+nt",
      "a//b",
      "$SYS/#",
    ]) {
      expect(() => parseMqttTopicFilters([filter])).toThrow(/MQTT/);
    }
    expect(() => parseMqttTopicFilters(["plant/#", "plant/#"])).toThrow(
      /unique/,
    );
  });

  it("collects matching messages from a mock broker and then disconnects", async () => {
    const clock = { now: 1_000_000 };
    const broker = new MockMqttBroker(clock, [
      {
        atMs: 1_001_000,
        topic: "plant/line1/temp",
        payload: new TextEncoder().encode("42.0"),
        qos: 0,
        retain: false,
      },
      {
        atMs: 1_002_000,
        topic: "other/line",
        payload: new TextEncoder().encode("nope"),
        qos: 0,
        retain: false,
      },
      {
        atMs: 1_003_000,
        topic: "plant/line1/vib",
        payload: Uint8Array.from([0xff, 0x00, 0x01]),
        qos: 1,
        retain: true,
      },
      {
        atMs: 1_009_000,
        topic: "plant/line1/late",
        payload: new TextEncoder().encode("late"),
        qos: 0,
        retain: false,
      },
    ]);
    const session = broker.session();
    expect("publish" in session).toBe(false);
    expect(() => broker.publish()).toThrow(/cannot publish/);

    const window = await collectMqttReadWindow(
      session,
      {
        topicFilters: ["plant/#"],
        qos: 1,
        windowMs: 5_000,
        maxMessages: 10,
        maxMessageBytes: 64,
        maxTotalBytes: 256,
      },
      () => clock.now,
    );

    expect(broker.subscriptions).toEqual([["plant/#"]]);
    expect(broker.qos).toEqual([1]);
    expect(broker.disconnects).toBe(1);
    expect(broker.connected).toBe(false);
    expect(broker.publishAttempts).toBe(1);
    expect(window.truncated).toBe(false);
    expect(window.messages.map((message) => message.topic)).toEqual([
      "plant/line1/temp",
      "plant/line1/vib",
    ]);
    expect(window.messages[0]).toMatchObject({
      payloadText: "42.0",
      payloadEncoding: "utf8",
      qos: 0,
      retain: false,
    });
    expect(window.messages[1]).toMatchObject({
      payloadEncoding: "base64",
      qos: 1,
      retain: true,
    });
    expect(window.bytes).toBe(4 + 3);
    expect(canonicalMqttBatch(window.messages)).toContain("plant/line1/temp");
    expect(clock.now).toBeGreaterThanOrEqual(1_005_000);
  });

  it("stops at the message cap, still disconnects, and never publishes", async () => {
    const clock = { now: 0 };
    const broker = new MockMqttBroker(clock, [
      {
        atMs: 10,
        topic: "plant/a",
        payload: new TextEncoder().encode("one"),
        qos: 2,
        retain: false,
      },
      {
        atMs: 20,
        topic: "plant/b",
        payload: new TextEncoder().encode("two"),
        qos: 0,
        retain: false,
      },
    ]);
    const window = await collectMqttReadWindow(
      broker.session(),
      {
        topicFilters: ["plant/#"],
        qos: 0,
        windowMs: 5_000,
        maxMessages: 1,
        maxMessageBytes: 64,
        maxTotalBytes: 256,
      },
      () => clock.now,
    );
    expect(window.messages).toHaveLength(1);
    expect(window.truncated).toBe(true);
    expect(window.messages[0].qos).toBe(2);
    expect(broker.disconnects).toBe(1);
    expect(broker.publishAttempts).toBe(0);
  });

  it("disconnects when the mock broker refuses the subscription", async () => {
    const session: MqttReadSession = {
      connect: async () => undefined,
      subscribe: async () => {
        throw new Error("subscribe refused");
      },
      nextMessage: async () => null,
      disconnect: async () => {
        disconnected = true;
      },
    };
    let disconnected = false;
    await expect(
      collectMqttReadWindow(session, {
        topicFilters: ["plant/#"],
        qos: 0,
        windowMs: 1_000,
        maxMessages: 1,
        maxMessageBytes: 8,
        maxTotalBytes: 8,
      }),
    ).rejects.toThrow(/subscribe refused/);
    expect(disconnected).toBe(true);
  });

  it("encodes UTF-8 and opaque payloads without treating bytes as engineering values", () => {
    expect(encodeMqttPayload(new TextEncoder().encode("ok"), 8)).toEqual({
      text: "ok",
      encoding: "utf8",
    });
    expect(encodeMqttPayload(Uint8Array.from([0xff]), 8).encoding).toBe(
      "base64",
    );
    expect(() => encodeMqttPayload(Uint8Array.from([1, 2, 3]), 2)).toThrow(
      /byte limit/,
    );
  });
});

describe("mqtt.js session against a mock client", () => {
  it("subscribes and reads queued messages without calling publish", async () => {
    const handlers: Record<string, (...args: never[]) => void> = {};
    const calls = { publish: 0, subscribe: 0, end: 0 };
    const client = {
      on(event: string, handler: (...args: never[]) => void) {
        handlers[event] = handler;
      },
      subscribe(
        filters: string[],
        options: { qos: number },
        callback: (error: Error | null) => void,
      ) {
        calls.subscribe += 1;
        expect(filters).toEqual(["plant/#"]);
        expect(options.qos).toBe(0);
        callback(null);
        (
          handlers.message as (
            topic: string,
            payload: Uint8Array,
            packet: { qos?: number; retain?: boolean },
          ) => void
        )("plant/pump", new TextEncoder().encode("12"), {
          qos: 1,
          retain: false,
        });
      },
      end(_force?: boolean, callback?: () => void) {
        calls.end += 1;
        callback?.();
      },
      publish() {
        calls.publish += 1;
      },
    };
    const session = createMqttJsReadSession(
      client as unknown as MqttJsLikeClient,
      50,
    );
    queueMicrotask(() => handlers.connect());
    const window = await collectMqttReadWindow(session, {
      topicFilters: ["plant/#"],
      qos: 0,
      windowMs: 1_000,
      maxMessages: 5,
      maxMessageBytes: 32,
      maxTotalBytes: 64,
    });
    expect(window.messages.map((message) => message.payloadText)).toEqual([
      "12",
    ]);
    expect(window.messages[0].qos).toBe(1);
    expect(calls).toEqual({ publish: 0, subscribe: 1, end: 1 });
  });
});
