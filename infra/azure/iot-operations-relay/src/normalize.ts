import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

type Quality = "good" | "bad" | "uncertain" | "unknown";
const MAX_DECODED_EVENT_BYTES = 4 * 1024 * 1024;

interface NativePoint {
  SourceTimestamp?: unknown;
  ServerTimestamp?: unknown;
  Value?: unknown;
  Status?: unknown;
  StatusCode?: unknown;
}

export interface NormalizedPoint {
  external_id: string;
  tag: string;
  value: number | string;
  source_timestamp: string;
  quality: Quality;
  partition_id: string;
  offset: string;
  sequence_number: string;
  source_format: "azure-iot-operations-flat" | "opc-publisher-pubsub-json";
  network_message_id?: string;
  publisher_id?: string;
  writer_group?: string;
  dataset_writer_id?: string;
  dataset_writer_name?: string;
  metadata_major_version?: string;
  metadata_minor_version?: string;
  dataset_message_type?: string;
  dataset_sequence_number?: string;
  server_timestamp?: string;
  status_code_symbol?: string;
  status_code_code?: string;
}

export interface TransportMetadata {
  partition: string;
  offsets: string[];
  sequences: string[];
}

export interface NormalizedBatch {
  deliveryBase: string;
  points: NormalizedPoint[];
  skipped: {
    metadata: number;
    keepalive: number;
    eventOrCondition: number;
    unusableFields: number;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function shortFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function parseTransportBody(value: unknown, eventNumber: number): unknown {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_DECODED_EVENT_BYTES)
      throw new Error(`Event ${eventNumber} exceeds the 4 MiB decoded limit`);
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new Error(`Event ${eventNumber} is not valid JSON`);
    }
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    let bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b)
      bytes = gunzipSync(bytes, { maxOutputLength: MAX_DECODED_EVENT_BYTES });
    if (bytes.byteLength > MAX_DECODED_EVENT_BYTES)
      throw new Error(`Event ${eventNumber} exceeds the 4 MiB decoded limit`);
    const text = bytes.toString("utf8").trim();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(
        `Event ${eventNumber} is not OPC Publisher JSON; configure Json or JsonGzip rather than UADP`,
      );
    }
  }
  return value;
}

function quality(status: unknown): Quality {
  const statusObject = record(status);
  const symbol = optionalText(statusObject?.Symbol);
  if (symbol) return quality(symbol);
  const code = statusObject?.Code ?? status;
  if (typeof code === "number" && Number.isFinite(code)) {
    const unsigned = code >>> 0;
    if ((unsigned & 0x80000000) !== 0) return "bad";
    if ((unsigned & 0x40000000) !== 0) return "uncertain";
    return "good";
  }
  if (typeof code === "string" && /^\d+$/.test(code.trim()))
    return quality(Number(code));
  const text = String(code ?? "").toLowerCase();
  if (!text) return "unknown";
  if (text.includes("good")) return "good";
  if (text.includes("bad")) return "bad";
  if (text.includes("uncertain")) return "uncertain";
  return "unknown";
}

function scalarValue(value: unknown): number | string | undefined {
  const reversible = record(value);
  const candidate =
    reversible && "Body" in reversible ? reversible.Body : value;
  if (typeof candidate === "number" && Number.isFinite(candidate))
    return candidate;
  if (
    typeof candidate === "string" &&
    candidate.trim() &&
    Number.isFinite(Number(candidate))
  )
    return candidate.trim();
  return undefined;
}

function validTimestamp(value: unknown, label: string): string {
  const parsed = new Date(String(value ?? ""));
  if (Number.isNaN(parsed.valueOf()))
    throw new Error(`${label} has no valid source time`);
  return parsed.toISOString();
}

function stableExternalId(input: {
  partition: string;
  offset: string;
  networkIndex: number;
  datasetIndex: number;
  source: string;
  field: string;
}): string {
  const fingerprint = createHash("sha256")
    .update(`${input.source}\u0000${input.field}`)
    .digest("hex")
    .slice(0, 20);
  return [
    "opc",
    input.partition,
    input.offset,
    input.networkIndex,
    input.datasetIndex,
    fingerprint,
  ].join(":");
}

function sourceIdentity(
  network: Record<string, unknown>,
  dataset: Record<string, unknown>,
): string {
  const explicit = optionalText(
    dataset._syncai_source ?? network._syncai_source,
  );
  if (explicit && explicit.length >= 2) return explicit;
  const writerGroup = optionalText(
    network.DataSetWriterGroup ??
      network.WriterGroupName ??
      network.WriterGroupId,
  );
  const writerName = optionalText(dataset.DataSetWriterName);
  const writerId = optionalText(dataset.DataSetWriterId);
  const writer = writerName ?? (writerId ? `writer-${writerId}` : undefined);
  if (writer) {
    const publisher = optionalText(network.PublisherId);
    const publisherIdentity = publisher
      ? `publisher-${shortFingerprint(publisher)}`
      : undefined;
    return ["opc", publisherIdentity, writerGroup, writer]
      .filter(Boolean)
      .join("/");
  }
  throw new Error(
    "OPC Publisher data lacks a stable DataSetWriter identity; provide DataSetWriterName/Id or _syncai_source",
  );
}

function provenance(
  network: Record<string, unknown>,
  dataset: Record<string, unknown>,
  point: NativePoint,
): Partial<NormalizedPoint> {
  const metadata = record(dataset.MetaDataVersion);
  const rawStatus = point.Status ?? point.StatusCode;
  const status = record(rawStatus);
  const serverTimestamp = optionalText(point.ServerTimestamp);
  return {
    network_message_id: optionalText(network.MessageId),
    publisher_id: optionalText(network.PublisherId),
    writer_group: optionalText(
      network.DataSetWriterGroup ??
        network.WriterGroupName ??
        network.WriterGroupId,
    ),
    dataset_writer_id: optionalText(dataset.DataSetWriterId),
    dataset_writer_name: optionalText(dataset.DataSetWriterName),
    metadata_major_version: optionalText(metadata?.MajorVersion),
    metadata_minor_version: optionalText(metadata?.MinorVersion),
    dataset_message_type: optionalText(dataset.MessageType),
    dataset_sequence_number: optionalText(dataset.SequenceNumber),
    server_timestamp:
      serverTimestamp && !Number.isNaN(Date.parse(serverTimestamp))
        ? new Date(serverTimestamp).toISOString()
        : undefined,
    status_code_symbol: optionalText(status?.Symbol),
    status_code_code: optionalText(status?.Code ?? rawStatus),
  };
}

function assertTransportMetadata(
  messages: unknown[],
  metadata: TransportMetadata,
): void {
  if (!metadata.partition || metadata.offsets.length !== messages.length)
    throw new Error(
      "Event Hubs partition and one offset per event are required for replay-safe identity",
    );
  if (metadata.offsets.some((offset) => !offset))
    throw new Error(
      "Event Hubs partition and one offset per event are required for replay-safe identity",
    );
}

export function normalizeEventHubMessages(
  messages: unknown[],
  metadata: TransportMetadata,
): NormalizedBatch {
  assertTransportMetadata(messages, metadata);
  const points: NormalizedPoint[] = [];
  const skipped = {
    metadata: 0,
    keepalive: 0,
    eventOrCondition: 0,
    unusableFields: 0,
  };

  const appendPoint = (input: {
    eventIndex: number;
    networkIndex: number;
    datasetIndex: number;
    source: string;
    field: string;
    point: NativePoint;
    sourceFormat: NormalizedPoint["source_format"];
    network?: Record<string, unknown>;
    dataset?: Record<string, unknown>;
  }) => {
    const value = scalarValue(input.point.Value);
    if (value === undefined) {
      skipped.unusableFields += 1;
      return;
    }
    const tag = `${input.source}/${input.field}`;
    if (tag.length > 500)
      throw new Error(
        `Telemetry tag exceeds 500 characters: ${tag.slice(0, 80)}`,
      );
    const sourceTimestamp = validTimestamp(
      input.point.SourceTimestamp,
      `Telemetry ${tag}`,
    );
    const offset = metadata.offsets[input.eventIndex];
    points.push({
      external_id: stableExternalId({
        partition: metadata.partition,
        offset,
        networkIndex: input.networkIndex,
        datasetIndex: input.datasetIndex,
        source: input.source,
        field: input.field,
      }),
      tag,
      value,
      source_timestamp: sourceTimestamp,
      quality: quality(input.point.Status ?? input.point.StatusCode),
      partition_id: metadata.partition,
      offset,
      sequence_number: metadata.sequences[input.eventIndex] || "unknown",
      source_format: input.sourceFormat,
      ...(input.network && input.dataset
        ? provenance(input.network, input.dataset, input.point)
        : {}),
    });
  };

  const processDataset = (
    network: Record<string, unknown>,
    dataset: Record<string, unknown>,
    eventIndex: number,
    networkIndex: number,
    datasetIndex: number,
  ) => {
    const messageType = optionalText(dataset.MessageType)?.toLowerCase() ?? "";
    if (messageType === "ua-keepalive") {
      skipped.keepalive += 1;
      return;
    }
    if (messageType === "ua-event" || messageType === "ua-condition") {
      skipped.eventOrCondition += 1;
      return;
    }
    const payload = record(dataset.Payload);
    if (!payload) {
      skipped.unusableFields += 1;
      return;
    }
    const source = sourceIdentity(network, dataset);
    for (const [field, rawPoint] of Object.entries(payload)) {
      const point = record(rawPoint) as NativePoint | null;
      if (!point) {
        skipped.unusableFields += 1;
        continue;
      }
      appendPoint({
        eventIndex,
        networkIndex,
        datasetIndex,
        source,
        field,
        point,
        sourceFormat: "opc-publisher-pubsub-json",
        network,
        dataset,
      });
    }
  };

  const processNative = (
    value: unknown,
    eventIndex: number,
    networkIndex: number,
  ) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => processNative(entry, eventIndex, index));
      return;
    }
    const network = record(value);
    if (!network)
      throw new Error(`Event ${eventIndex + 1} is not a JSON object or array`);
    const networkType = optionalText(network.MessageType)?.toLowerCase() ?? "";
    if (networkType === "ua-metadata") {
      skipped.metadata += 1;
      return;
    }
    if (Array.isArray(network.Messages)) {
      network.Messages.forEach((rawDataset, datasetIndex) => {
        const dataset = record(rawDataset);
        if (!dataset)
          throw new Error(
            `Event ${eventIndex + 1} dataset ${datasetIndex + 1} is not JSON`,
          );
        processDataset(
          network,
          dataset,
          eventIndex,
          networkIndex,
          datasetIndex,
        );
      });
      return;
    }
    if (network.Payload) {
      processDataset(network, network, eventIndex, networkIndex, 0);
      return;
    }
    throw new Error(
      `Event ${eventIndex + 1} is neither flattened Azure IoT Operations telemetry nor OPC Publisher PubSub JSON`,
    );
  };

  messages.forEach((rawEvent, eventIndex) => {
    let value = parseTransportBody(rawEvent, eventIndex + 1);
    const wrapper = record(value);
    if (
      wrapper &&
      "body" in wrapper &&
      !("MessageType" in wrapper) &&
      !("_syncai_source" in wrapper)
    )
      value = parseTransportBody(wrapper.body, eventIndex + 1);

    const flattened = record(value);
    const explicitSource = optionalText(flattened?._syncai_source);
    if (flattened && explicitSource) {
      if (explicitSource.length < 2)
        throw new Error(
          `Event ${eventIndex + 1} has an invalid _syncai_source`,
        );
      let fieldIndex = 0;
      for (const [field, rawPoint] of Object.entries(flattened)) {
        if (field.startsWith("_")) continue;
        const point = record(rawPoint) as NativePoint | null;
        if (!point) {
          skipped.unusableFields += 1;
          continue;
        }
        appendPoint({
          eventIndex,
          networkIndex: 0,
          datasetIndex: fieldIndex,
          source: explicitSource,
          field,
          point,
          sourceFormat: "azure-iot-operations-flat",
        });
        fieldIndex += 1;
      }
      return;
    }
    processNative(value, eventIndex, 0);
  });

  if (points.length === 0)
    throw new Error(
      `Batch contains no usable OPC UA data points (metadata=${skipped.metadata}, keepalive=${skipped.keepalive}, events_or_conditions=${skipped.eventOrCondition}, unusable_fields=${skipped.unusableFields})`,
    );
  return {
    deliveryBase: `${metadata.partition}:${metadata.offsets[0]}:${metadata.offsets.at(-1)}:${messages.length}`,
    points,
    skipped,
  };
}
