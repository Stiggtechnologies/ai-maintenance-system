import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseAzureIotIngressEnvelope } from "../../supabase/functions/_shared/azure-iot-operations-ingress";

interface TestNormalizedPoint extends Record<string, unknown> {
  external_id: string;
}

interface TestNormalizedBatch {
  points: TestNormalizedPoint[];
  skipped: {
    metadata: number;
    keepalive: number;
    eventOrCondition: number;
    unusableFields: number;
  };
}

type TestNormalizer = (
  messages: unknown[],
  metadata: { partition: string; offsets: string[]; sequences: string[] },
) => TestNormalizedBatch;

// Keep the Azure Functions package as an independently compiled deployable.
// A runtime import exercises its source without pulling it into tsconfig.app.
const normalizerModulePath =
  "../../infra/azure/iot-operations-relay/src/normalize.ts";
const { normalizeEventHubMessages } = (await import(normalizerModulePath)) as {
  normalizeEventHubMessages: TestNormalizer;
};

const metadata = {
  partition: "3",
  offsets: ["4401"],
  sequences: ["81"],
};

const nativeNetwork = {
  MessageId: "27",
  MessageType: "ua-data",
  PublisherId: "opc.tcp://edge-source:50000",
  DataSetWriterGroup: "mine-a",
  Messages: [
    {
      DataSetWriterId: 7,
      DataSetWriterName: "crusher-01",
      SequenceNumber: 12,
      MetaDataVersion: { MajorVersion: 3, MinorVersion: 1 },
      MessageType: "ua-deltaframe",
      Payload: {
        DriveTemperature: {
          Value: 71.4,
          SourceTimestamp: "2026-10-03T18:00:00Z",
          ServerTimestamp: "2026-10-03T18:00:00.050Z",
          StatusCode: { Symbol: "Good", Code: 0 },
        },
      },
    },
  ],
};

describe("OPC Publisher 2.9/3.0 compatibility boundary", () => {
  it("decodes a native PubSub network message and retains source provenance", () => {
    const normalized = normalizeEventHubMessages(
      [
        {
          body: nativeNetwork,
          properties: { contentType: "application/json" },
        },
      ],
      metadata,
    );
    expect(normalized.points).toHaveLength(1);
    expect(normalized.points[0]).toMatchObject({
      value: 71.4,
      source_timestamp: "2026-10-03T18:00:00.000Z",
      server_timestamp: "2026-10-03T18:00:00.050Z",
      quality: "good",
      source_format: "opc-publisher-pubsub-json",
      network_message_id: "27",
      publisher_id: "opc.tcp://edge-source:50000",
      writer_group: "mine-a",
      dataset_writer_id: "7",
      dataset_writer_name: "crusher-01",
      metadata_major_version: "3",
      metadata_minor_version: "1",
      dataset_message_type: "ua-deltaframe",
      dataset_sequence_number: "12",
      status_code_symbol: "Good",
      status_code_code: "0",
    });
    expect(normalized.points[0].tag).toMatch(
      /^opc\/publisher-[0-9a-f]{12}\/mine-a\/crusher-01\/DriveTemperature$/,
    );
    expect(normalized.points[0].external_id).toMatch(/^opc:3:4401:0:0:/);
  });

  it("supports JSON+gzip, reversible scalar bodies and OPC severity bits", () => {
    const message = structuredClone(nativeNetwork);
    const dataset = message.Messages[0];
    dataset.MessageType = "ua-keyframe";
    dataset.Payload.DriveTemperature.Value = {
      Type: "Double",
      Body: "68.2",
    } as never;
    dataset.Payload.DriveTemperature.StatusCode = {
      Symbol: "UncertainLastUsableValue",
      Code: 0x40900000,
    };
    const normalized = normalizeEventHubMessages(
      [gzipSync(Buffer.from(JSON.stringify(message)))],
      metadata,
    );
    expect(normalized.points[0]).toMatchObject({
      value: "68.2",
      quality: "uncertain",
      dataset_message_type: "ua-keyframe",
    });
  });

  it("skips metadata, keepalives and events instead of treating them as telemetry", () => {
    const data = structuredClone(nativeNetwork);
    data.Messages.unshift(
      {
        DataSetWriterId: 7,
        DataSetWriterName: "crusher-01",
        SequenceNumber: 10,
        MetaDataVersion: { MajorVersion: 3, MinorVersion: 1 },
        MessageType: "ua-event",
        Payload: { EventId: "not-a-condition-reading" },
      } as never,
      {
        DataSetWriterId: 7,
        DataSetWriterName: "crusher-01",
        SequenceNumber: 11,
        MetaDataVersion: { MajorVersion: 3, MinorVersion: 1 },
        MessageType: "ua-keepalive",
      } as never,
    );
    const normalized = normalizeEventHubMessages(
      [
        {
          body: [
            { MessageType: "ua-metadata", MetaData: { Fields: [] } },
            data,
          ],
        },
      ],
      metadata,
    );
    expect(normalized.points).toHaveLength(1);
    expect(normalized.skipped).toEqual({
      metadata: 1,
      keepalive: 1,
      eventOrCondition: 1,
      unusableFields: 0,
    });
  });

  it("keeps replay identities distinct across data sets sharing a field name", () => {
    const message = structuredClone(nativeNetwork);
    message.Messages.push({
      ...structuredClone(message.Messages[0]),
      DataSetWriterId: 8,
      DataSetWriterName: "crusher-02",
    });
    const normalized = normalizeEventHubMessages([message], metadata);
    expect(normalized.points).toHaveLength(2);
    expect(normalized.points[0].external_id).not.toBe(
      normalized.points[1].external_id,
    );
  });

  it("cannot collapse identical writer names from different publishers", () => {
    const otherPublisher = structuredClone(nativeNetwork);
    otherPublisher.PublisherId = "opc.tcp://other-edge-source:50000";
    const first = normalizeEventHubMessages([nativeNetwork], metadata)
      .points[0];
    const second = normalizeEventHubMessages([otherPublisher], metadata)
      .points[0];
    expect(first.tag).not.toBe(second.tag);
    expect(first.external_id).not.toBe(second.external_id);
  });

  it("keeps a point identity stable when Event Hubs changes batch composition", () => {
    const byItself = normalizeEventHubMessages([nativeNetwork], metadata);
    const withEarlierEvent = normalizeEventHubMessages(
      [
        {
          _syncai_source: "mine-a/other",
          Pressure: {
            Value: 3.1,
            SourceTimestamp: "2026-10-03T17:59:00Z",
          },
        },
        nativeNetwork,
      ],
      {
        partition: "3",
        offsets: ["4400", "4401"],
        sequences: ["80", "81"],
      },
    );
    expect(withEarlierEvent.points[1].external_id).toBe(
      byItself.points[0].external_id,
    );
  });

  it("preserves the existing flattened Azure IoT Operations contract", () => {
    const normalized = normalizeEventHubMessages(
      [
        {
          _syncai_source: "mine-a/crusher-01",
          Pressure: {
            Value: 4.2,
            SourceTimestamp: "2026-10-03T18:00:00Z",
            StatusCode: "Good",
          },
        },
      ],
      metadata,
    );
    expect(normalized.points[0]).toMatchObject({
      tag: "mine-a/crusher-01/Pressure",
      source_format: "azure-iot-operations-flat",
      quality: "good",
    });
  });

  it("refuses identity-free, timestamp-free and binary UADP inputs", () => {
    const noWriter = structuredClone(nativeNetwork);
    delete (noWriter as Partial<typeof nativeNetwork>).DataSetWriterGroup;
    delete (noWriter.Messages[0] as Partial<(typeof noWriter.Messages)[number]>)
      .DataSetWriterId;
    delete (noWriter.Messages[0] as Partial<(typeof noWriter.Messages)[number]>)
      .DataSetWriterName;
    expect(() => normalizeEventHubMessages([noWriter], metadata)).toThrow(
      /stable DataSetWriter identity/,
    );

    const noTime = structuredClone(nativeNetwork);
    delete (
      noTime.Messages[0].Payload.DriveTemperature as Partial<{
        SourceTimestamp: string;
      }>
    ).SourceTimestamp;
    expect(() => normalizeEventHubMessages([noTime], metadata)).toThrow(
      /valid source time/,
    );

    expect(() =>
      normalizeEventHubMessages([Buffer.from([0x01, 0x02, 0x03])], metadata),
    ).toThrow(/configure Json or JsonGzip rather than UADP/);
  });

  it("passes only bounded, whitelisted OPC provenance through signed ingress", () => {
    const point = normalizeEventHubMessages([nativeNetwork], metadata)
      .points[0];
    const parsed = parseAzureIotIngressEnvelope(
      JSON.stringify({ delivery_id: "3:4401:4401:1", points: [point] }),
    );
    expect(parsed.points[0]).toMatchObject({
      source_format: "opc-publisher-pubsub-json",
      network_message_id: "27",
      dataset_writer_name: "crusher-01",
      status_code_code: "0",
    });
    expect(() =>
      parseAzureIotIngressEnvelope(
        JSON.stringify({
          delivery_id: "3:4401:4401:1",
          points: [{ ...point, source_format: "unreviewed-format" }],
        }),
      ),
    ).toThrow(/source_format_invalid/);
  });
});
