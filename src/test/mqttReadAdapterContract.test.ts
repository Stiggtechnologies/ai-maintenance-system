import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectMqttReadWindow,
  type MqttReadSession,
} from "../../supabase/functions/_shared/mqtt-read";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read(
  "supabase/migrations/20271103140000_mqtt_read_adapter.sql",
);
const edge = read("supabase/functions/mqtt-read-pull/index.ts");
const shared = read("supabase/functions/_shared/mqtt-read.ts");
const page = read("src/pages/IntegrationsPage.tsx");
const service = read("src/services/mqttRead.ts");
const boundary = read("config/edge-function-boundary.json");

class ContractMockBroker {
  disconnects = 0;
  publishAttempts = 0;
  constructor(private readonly payload: string) {}

  session(): MqttReadSession {
    let sent = false;
    return {
      connect: async () => undefined,
      subscribe: async () => undefined,
      nextMessage: async (timeoutMs) => {
        if (!sent) {
          sent = true;
          return {
            topic: "plant/pump/temp",
            payload: new TextEncoder().encode(this.payload),
            qos: 0,
            retain: false,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, timeoutMs));
        return null;
      },
      disconnect: async () => {
        this.disconnects += 1;
      },
    };
  }

  publish(): void {
    this.publishAttempts += 1;
  }
}

describe("C2.21 MQTT read contract", () => {
  it("reuses the canonical connector, run, staging and watermark planes", () => {
    for (const token of [
      "public.connectors",
      "public.connector_runs",
      "public.ingest_staging",
      "public.ingest_watermarks",
      "public.audit_events",
      "public.decisions",
    ]) {
      expect(migration).toContain(token);
    }
    expect(migration).not.toMatch(/create table/i);
    expect(migration).not.toContain("condition_readings");
    expect(migration).toContain("connector_type='mqtt_read'");
    expect(migration).toContain("register_ref='C2.21'");
    expect(migration).toContain("entity_type='mqtt_message'");
  });

  it("is service-attested, tenant-bound and permanently read-only", () => {
    expect(migration).toContain("coalesce(auth.role(),'')<>'service_role'");
    expect(migration).toContain(
      "a named human administrator must configure or enable",
    );
    expect(migration).toContain("direction='read_only'");
    expect(migration).toContain("not write_enabled");
    expect(migration).toContain("'sourceWriteBack',false");
    expect(migration).toContain("'publish',false");
    expect(migration).toContain("app_current_org()");
    expect(migration).toContain("c.organization_id=r.organization_id");
    expect(migration).toContain("from public,anon,authenticated");
    expect(edge).not.toMatch(/\.publish\s*\(/);
    expect(shared).not.toMatch(/\.publish\s*\(/);
    expect(edge).not.toMatch(/\bwill\s*:/);
    expect(shared).not.toContain("will:");
    expect(edge).toContain('from "npm:mqtt@5.16.1"');
    expect(shared).toContain('protocol: "wss"');
    expect(shared).toContain("protocolVersion: 4");
  });

  it("keeps messages as staged evidence inside a bounded listen", () => {
    expect(shared).toContain(
      "MQTT payload exceeds the approved message byte limit",
    );
    expect(edge).toContain("MAX_TOTAL_BYTES");
    expect(edge).toContain("normalizeMqttPullRequest(body)");
    expect(migration).toContain("mqtt_window_seconds between 1 and 30");
    expect(migration).toContain("mqtt_max_messages between 1 and 200");
    expect(migration).toContain("topic is outside the approved MQTT filters");
    expect(migration).toContain("promotedToConditionReadings");
    expect(migration).toContain("Silence is not a process state");
  });

  it("wires the Integrations MQTT entry to the setup screen", () => {
    expect(page).toContain("MqttReadConnectorSetup");
    expect(page).toContain('href="#mqtt-read-setup"');
    expect(service).toContain('"configure_mqtt_read_source"');
    expect(service).toContain('"mqtt-read-pull"');
    const component = read("src/components/MqttReadConnectorSetup.tsx");
    expect(component).toContain('id="mqtt-read-setup"');
    expect(component).toContain("Dry-run listen");
    expect(component).toContain("Retain listen evidence");
    expect(component).toContain("never publishes");
  });

  it("is not on the deployment allowlist", () => {
    expect(boundary).not.toContain("mqtt-read-pull");
  });

  it("collects one mock-broker message and does not publish", async () => {
    const broker = new ContractMockBroker("72");
    const window = await collectMqttReadWindow(broker.session(), {
      topicFilters: ["plant/+/temp"],
      qos: 0,
      windowMs: 1_000,
      maxMessages: 5,
      maxMessageBytes: 32,
      maxTotalBytes: 64,
    });
    expect(window.messages).toEqual([
      expect.objectContaining({
        topic: "plant/pump/temp",
        payloadText: "72",
        payloadEncoding: "utf8",
        qos: 0,
      }),
    ]);
    expect(broker.disconnects).toBe(1);
    expect(broker.publishAttempts).toBe(0);
    expect("publish" in broker.session()).toBe(false);
  });
});
