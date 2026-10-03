export interface AzureIotIngressBinding {
  organizationId: string;
  connectorKey: string;
  secret: string;
}

export interface AzureIotPoint {
  external_id: string;
  tag: string;
  value: number | string;
  source_timestamp: string;
  quality: "good" | "bad" | "uncertain" | "unknown";
  partition_id?: string;
  offset?: string;
  sequence_number?: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/;
const CONNECTOR_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;
const FORBIDDEN_CONTROL_KEYS = new Set([
  "command",
  "commands",
  "write",
  "writes",
  "method",
  "method_call",
  "methodcall",
  "control",
  "setpoint",
  "target_node",
  "targetnode",
]);

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseAzureIotIngressBindings(
  raw: string,
): Record<string, AzureIotIngressBinding> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AZURE_IOT_OPERATIONS_INGRESS_KEYS_JSON is invalid JSON");
  }
  const root = object(parsed);
  if (!root) throw new Error("ingress key registry must be a JSON object");
  const result: Record<string, AzureIotIngressBinding> = {};
  for (const [keyId, rawBinding] of Object.entries(root)) {
    const binding = object(rawBinding);
    if (
      !KEY_ID.test(keyId) ||
      typeof binding?.organization_id !== "string" ||
      !UUID.test(binding.organization_id) ||
      typeof binding.connector_key !== "string" ||
      !CONNECTOR_KEY.test(binding.connector_key) ||
      typeof binding.secret !== "string" ||
      binding.secret.length < 32 ||
      binding.secret.length > 512
    ) {
      throw new Error(`ingress binding ${keyId || "(empty)"} is invalid`);
    }
    result[keyId] = {
      organizationId: binding.organization_id,
      connectorKey: binding.connector_key,
      secret: binding.secret,
    };
  }
  if (Object.keys(result).length === 0)
    throw new Error("ingress key registry is empty");
  return result;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1)
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export async function sha256Hex(body: string): Promise<string> {
  return hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  );
}

export async function verifyAzureIotIngressSignature(input: {
  body: string;
  timestamp: string;
  signature: string;
  secret: string;
  nowMs?: number;
  maxSkewSeconds?: number;
}): Promise<{ bodySha256: string; receivedAt: string }> {
  if (!/^\d{10}$/.test(input.timestamp))
    throw new Error("invalid_signature_timestamp");
  const seconds = Number(input.timestamp);
  const nowMs = input.nowMs ?? Date.now();
  const maxSkew = (input.maxSkewSeconds ?? 300) * 1000;
  if (Math.abs(nowMs - seconds * 1000) > maxSkew)
    throw new Error("signature_timestamp_outside_window");
  const supplied = input.signature.toLowerCase().replace(/^sha256=/, "");
  if (!/^[0-9a-f]{64}$/.test(supplied))
    throw new Error("invalid_signature_format");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${input.timestamp}.${input.body}`),
    ),
  );
  if (!constantTimeEqual(supplied, expected))
    throw new Error("invalid_signature");
  return {
    bodySha256: await sha256Hex(input.body),
    receivedAt: new Date(nowMs).toISOString(),
  };
}

function assertReadOnlyShape(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_CONTROL_KEYS.has(key.toLowerCase()))
      throw new Error("control_payload_refused");
  }
}

export function parseAzureIotIngressEnvelope(body: string): {
  deliveryId: string;
  points: AzureIotPoint[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("invalid_json");
  }
  const envelope = object(parsed);
  if (!envelope) throw new Error("invalid_envelope");
  assertReadOnlyShape(envelope);
  const deliveryId =
    typeof envelope.delivery_id === "string" ? envelope.delivery_id.trim() : "";
  if (deliveryId.length < 8 || deliveryId.length > 200)
    throw new Error("invalid_delivery_id");
  if (!Array.isArray(envelope.points) || envelope.points.length < 1)
    throw new Error("points_required");
  if (envelope.points.length > 500) throw new Error("too_many_points");
  const points = envelope.points.map((raw, index): AzureIotPoint => {
    const point = object(raw);
    if (!point) throw new Error(`point_${index + 1}_invalid`);
    assertReadOnlyShape(point);
    const externalId =
      typeof point.external_id === "string" ? point.external_id.trim() : "";
    const tag = typeof point.tag === "string" ? point.tag.trim() : "";
    const sourceTimestamp =
      typeof point.source_timestamp === "string"
        ? point.source_timestamp.trim()
        : "";
    const value = point.value;
    if (externalId.length < 8 || externalId.length > 300)
      throw new Error(`point_${index + 1}_external_id_invalid`);
    if (tag.length < 2 || tag.length > 500)
      throw new Error(`point_${index + 1}_tag_invalid`);
    if (!sourceTimestamp || Number.isNaN(Date.parse(sourceTimestamp)))
      throw new Error(`point_${index + 1}_timestamp_invalid`);
    if (
      (typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "number" && !Number.isFinite(value)) ||
      (typeof value === "string" &&
        (!value.trim() || !Number.isFinite(Number(value))))
    )
      throw new Error(`point_${index + 1}_value_invalid`);
    const rawQuality =
      typeof point.quality === "string"
        ? point.quality.toLowerCase()
        : "unknown";
    const quality = (["good", "bad", "uncertain", "unknown"] as const).includes(
      rawQuality as "good" | "bad" | "uncertain" | "unknown",
    )
      ? (rawQuality as AzureIotPoint["quality"])
      : "unknown";
    return {
      external_id: externalId,
      tag,
      value: typeof value === "string" ? value.trim() : value,
      source_timestamp: new Date(sourceTimestamp).toISOString(),
      quality,
      partition_id:
        typeof point.partition_id === "string" ? point.partition_id : undefined,
      offset: typeof point.offset === "string" ? point.offset : undefined,
      sequence_number:
        typeof point.sequence_number === "string"
          ? point.sequence_number
          : typeof point.sequence_number === "number"
            ? String(point.sequence_number)
            : undefined,
    };
  });
  return { deliveryId, points };
}
