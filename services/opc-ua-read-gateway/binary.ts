// Bounded OPC UA Binary codec (OPC 10000-6) for the read-only gateway.
//
// Supported services, using the OPC UA binary encoding node ids:
// Hello, Acknowledge, OpenSecureChannel (446/449), CreateSession (461/464),
// ActivateSession (467/470), Read (631/634), CloseSession (473/476),
// ServiceFault (397). Anonymous (321) and UserName (324) identity tokens.
// Write (673), Call (712) and every other service are refused.
//
// SecurityPolicy#None and MessageSecurityMode None only. Sign and
// SignAndEncrypt are not implemented here and must not be downgraded.

import type { ParsedOpcUaNodeId } from "../../supabase/functions/_shared/opc-ua-read.ts";

export const OPCUA_EPOCH_MS = 11_644_473_600_000n;
export const SECURITY_POLICY_NONE =
  "http://opcfoundation.org/UA/SecurityPolicy#None";

export const ServiceId = {
  AnonymousIdentityToken: 321,
  UserNameIdentityToken: 324,
  ServiceFault: 397,
  OpenSecureChannelRequest: 446,
  OpenSecureChannelResponse: 449,
  CreateSessionRequest: 461,
  CreateSessionResponse: 464,
  ActivateSessionRequest: 467,
  ActivateSessionResponse: 470,
  CloseSessionRequest: 473,
  CloseSessionResponse: 476,
  ReadRequest: 631,
  ReadResponse: 634,
  WriteRequest: 673,
  CallRequest: 712,
} as const;

export const StatusCode = {
  Good: 0x00000000,
  BadServiceUnsupported: 0x800b0000,
  BadIdentityTokenRejected: 0x80210000,
  BadSessionIdInvalid: 0x80250000,
  BadNodeIdUnknown: 0x80340000,
  BadAttributeIdInvalid: 0x80350000,
  BadSecurityModeInsufficient: 0x80e60000,
} as const;

export const AttributeIdValue = 13;
export const SecurityModeNone = 1;

const STATUS_NAMES: Record<number, string> = {
  [StatusCode.Good]: "Good",
  [StatusCode.BadServiceUnsupported]: "BadServiceUnsupported",
  [StatusCode.BadIdentityTokenRejected]: "BadIdentityTokenRejected",
  [StatusCode.BadSessionIdInvalid]: "BadSessionIdInvalid",
  [StatusCode.BadNodeIdUnknown]: "BadNodeIdUnknown",
  [StatusCode.BadAttributeIdInvalid]: "BadAttributeIdInvalid",
  [StatusCode.BadSecurityModeInsufficient]: "BadSecurityModeInsufficient",
};

export function statusHex(code: number): string {
  return `0x${(code >>> 0).toString(16).padStart(8, "0")}`;
}

export function statusName(code: number): string {
  return STATUS_NAMES[code >>> 0] ?? statusHex(code);
}

export class BinaryWriter {
  private readonly chunks: Buffer[] = [];

  u8(value: number): this {
    const buffer = Buffer.allocUnsafe(1);
    buffer.writeUInt8(value & 0xff);
    this.chunks.push(buffer);
    return this;
  }

  u16(value: number): this {
    const buffer = Buffer.allocUnsafe(2);
    buffer.writeUInt16LE(value);
    this.chunks.push(buffer);
    return this;
  }

  u32(value: number): this {
    const buffer = Buffer.allocUnsafe(4);
    buffer.writeUInt32LE(value >>> 0);
    this.chunks.push(buffer);
    return this;
  }

  i32(value: number): this {
    const buffer = Buffer.allocUnsafe(4);
    buffer.writeInt32LE(value);
    this.chunks.push(buffer);
    return this;
  }

  i64(value: bigint): this {
    const buffer = Buffer.allocUnsafe(8);
    buffer.writeBigInt64LE(value);
    this.chunks.push(buffer);
    return this;
  }

  f64(value: number): this {
    const buffer = Buffer.allocUnsafe(8);
    buffer.writeDoubleLE(value);
    this.chunks.push(buffer);
    return this;
  }

  bytes(value: Buffer): this {
    this.chunks.push(Buffer.from(value));
    return this;
  }

  string(value: string | null): this {
    if (value === null) return this.i32(-1);
    const encoded = Buffer.from(value, "utf8");
    if (encoded.length > 4096) {
      throw new Error("OPC-UA string exceeds the 4096-byte bound.");
    }
    return this.i32(encoded.length).bytes(encoded);
  }

  byteString(value: Buffer | null): this {
    if (value === null) return this.i32(-1);
    if (value.length > 8192) {
      throw new Error("OPC-UA byte string exceeds the 8192-byte bound.");
    }
    return this.i32(value.length).bytes(value);
  }

  nodeId(node: ParsedOpcUaNodeId): this {
    if (node.identifierType === "numeric" && node.numericId !== undefined) {
      if (node.namespace === 0 && node.numericId <= 255) {
        return this.u8(0x00).u8(node.numericId);
      }
      if (node.namespace <= 255 && node.numericId <= 65535) {
        return this.u8(0x01).u8(node.namespace).u16(node.numericId);
      }
      return this.u8(0x02).u16(node.namespace).u32(node.numericId);
    }
    return this.u8(0x03)
      .u16(node.namespace)
      .string(node.stringId ?? "");
  }

  nullNodeId(): this {
    return this.u8(0x00).u8(0x00);
  }

  typeId(id: number): this {
    return this.nodeId({
      canonical: `i=${id}`,
      namespace: 0,
      identifierType: "numeric",
      numericId: id,
    });
  }

  nullExtensionObject(): this {
    return this.nullNodeId().u8(0x00);
  }

  dateTime(epochMs: number): this {
    if (!Number.isFinite(epochMs)) {
      throw new Error("OPC-UA DateTime is not finite.");
    }
    return this.i64((BigInt(Math.trunc(epochMs)) + OPCUA_EPOCH_MS) * 10000n);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

export class BinaryReader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  remaining(): number {
    return this.buffer.length - this.offset;
  }

  private need(bytes: number): void {
    if (this.remaining() < bytes) {
      throw new Error("OPC-UA message ended before a complete field.");
    }
  }

  u8(): number {
    this.need(1);
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  u16(): number {
    this.need(2);
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.need(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  i32(): number {
    this.need(4);
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  i64(): bigint {
    this.need(8);
    const value = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  f64(): number {
    this.need(8);
    const value = this.buffer.readDoubleLE(this.offset);
    this.offset += 8;
    return value;
  }

  bytes(length: number): Buffer {
    if (length < 0) throw new Error("OPC-UA byte length is negative.");
    this.need(length);
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return Buffer.from(value);
  }

  string(): string | null {
    const length = this.i32();
    if (length === -1) return null;
    return this.bytes(length).toString("utf8");
  }

  byteString(): Buffer | null {
    const length = this.i32();
    if (length === -1) return null;
    return this.bytes(length);
  }

  nodeId(): ParsedOpcUaNodeId {
    const encoding = this.u8();
    if (encoding === 0x00) {
      const numericId = this.u8();
      return {
        canonical: numericId === 0 ? "i=0" : `i=${numericId}`,
        namespace: 0,
        identifierType: "numeric",
        numericId,
      };
    }
    if (encoding === 0x01) {
      const namespace = this.u8();
      const numericId = this.u16();
      return numericNode(namespace, numericId);
    }
    if (encoding === 0x02) {
      return numericNode(this.u16(), this.u32());
    }
    if (encoding === 0x03) {
      const namespace = this.u16();
      const stringId = this.string();
      if (!stringId) throw new Error("OPC-UA string node id is null.");
      return {
        canonical:
          namespace === 0 ? `s=${stringId}` : `ns=${namespace};s=${stringId}`,
        namespace,
        identifierType: "string",
        stringId,
      };
    }
    throw new Error("OPC-UA node id encoding is outside the read-only subset.");
  }

  dateTime(): string {
    const ticks = this.i64();
    const epochMs = Number(ticks / 10000n - OPCUA_EPOCH_MS);
    if (!Number.isFinite(epochMs)) {
      throw new Error("OPC-UA DateTime could not be decoded.");
    }
    return new Date(epochMs).toISOString();
  }

  expectExhausted(): void {
    if (this.remaining() !== 0) {
      throw new Error("OPC-UA message contained unexpected trailing bytes.");
    }
  }
}

function numericNode(namespace: number, numericId: number): ParsedOpcUaNodeId {
  return {
    canonical:
      namespace === 0 ? `i=${numericId}` : `ns=${namespace};i=${numericId}`,
    namespace,
    identifierType: "numeric",
    numericId,
  };
}

export function frameMessage(type: string, payload: Buffer): Buffer {
  if (!/^[A-Z]{3}$/.test(type)) {
    throw new Error("OPC-UA message type is invalid.");
  }
  const header = Buffer.alloc(8);
  header.write(type, 0, "ascii");
  header.write("F", 3, "ascii");
  header.writeUInt32LE(8 + payload.length, 4);
  return Buffer.concat([header, payload]);
}

export function encodeHello(endpointUrl: string): Buffer {
  const writer = new BinaryWriter()
    .u32(0)
    .u32(65535)
    .u32(65535)
    .u32(0)
    .u32(0)
    .string(endpointUrl);
  return frameMessage("HEL", writer.toBuffer());
}

export function encodeAcknowledge(): Buffer {
  const writer = new BinaryWriter().u32(0).u32(65535).u32(65535).u32(0).u32(0);
  return frameMessage("ACK", writer.toBuffer());
}

export function encodeError(code: number, reason: string): Buffer {
  return frameMessage(
    "ERR",
    new BinaryWriter().u32(code).string(reason).toBuffer(),
  );
}

function requestHeader(
  writer: BinaryWriter,
  authToken: ParsedOpcUaNodeId | null,
  requestHandle: number,
): void {
  if (authToken) writer.nodeId(authToken);
  else writer.nullNodeId();
  writer
    .dateTime(Date.now())
    .u32(requestHandle)
    .u32(0)
    .string(null)
    .u32(5000)
    .nullExtensionObject();
}

function responseHeader(
  writer: BinaryWriter,
  requestHandle: number,
  serviceResult: number,
): void {
  writer
    .dateTime(Date.now())
    .u32(requestHandle)
    .u32(serviceResult)
    .u8(0)
    .i32(0)
    .nullExtensionObject();
}

export function encodeOpenSecureChannel(input: {
  securityMode?: number;
  sequenceNumber: number;
  requestId: number;
}): Buffer {
  const body = new BinaryWriter();
  body.typeId(ServiceId.OpenSecureChannelRequest);
  requestHeader(body, null, input.requestId);
  body
    .u32(0)
    .u32(0)
    .u32(input.securityMode ?? SecurityModeNone)
    .byteString(Buffer.alloc(32, 1))
    .u32(60_000);
  const payload = new BinaryWriter()
    .u32(0)
    .string(SECURITY_POLICY_NONE)
    .byteString(null)
    .byteString(null)
    .u32(input.sequenceNumber)
    .u32(input.requestId)
    .bytes(body.toBuffer());
  return frameMessage("OPN", payload.toBuffer());
}

export function encodeOpenSecureChannelResponse(input: {
  requestId: number;
  requestHandle: number;
  channelId: number;
  tokenId: number;
}): Buffer {
  const body = new BinaryWriter();
  body.typeId(ServiceId.OpenSecureChannelResponse);
  responseHeader(body, input.requestHandle, StatusCode.Good);
  body
    .u32(0)
    .u32(input.channelId)
    .u32(input.tokenId)
    .dateTime(Date.now())
    .u32(60_000)
    .byteString(Buffer.alloc(32, 2));
  const payload = new BinaryWriter()
    .u32(input.channelId)
    .string(SECURITY_POLICY_NONE)
    .byteString(null)
    .byteString(null)
    .u32(1)
    .u32(input.requestId)
    .bytes(body.toBuffer());
  return frameMessage("OPN", payload.toBuffer());
}

export function encodeSymmetric(input: {
  type: "MSG" | "CLO";
  channelId: number;
  tokenId?: number;
  sequenceNumber: number;
  requestId: number;
  body?: Buffer;
}): Buffer {
  if (input.type === "CLO") {
    return frameMessage(
      "CLO",
      new BinaryWriter().u32(input.channelId).toBuffer(),
    );
  }
  const payload = new BinaryWriter()
    .u32(input.channelId)
    .u32(input.tokenId ?? 0)
    .u32(input.sequenceNumber)
    .u32(input.requestId)
    .bytes(input.body ?? Buffer.alloc(0));
  return frameMessage("MSG", payload.toBuffer());
}

export function encodeCreateSessionRequest(input: {
  endpointUrl: string;
  requestHandle: number;
}): Buffer {
  const body = new BinaryWriter();
  body.typeId(ServiceId.CreateSessionRequest);
  requestHeader(body, null, input.requestHandle);
  body
    .string("urn:syncai:opcua-read-gateway")
    .string("urn:syncai:opcua-read-gateway")
    .u8(0x02)
    .string("SyncAI OPC-UA read gateway")
    .u32(1)
    .string(null)
    .string(null)
    .i32(0)
    .string(null)
    .string(input.endpointUrl)
    .string("syncai-read")
    .byteString(Buffer.alloc(32, 3))
    .byteString(null)
    .f64(60_000)
    .u32(1_048_576);
  return body.toBuffer();
}

export function encodeCreateSessionResponse(input: {
  requestHandle: number;
  session: ParsedOpcUaNodeId;
  token: ParsedOpcUaNodeId;
}): Buffer {
  const body = new BinaryWriter();
  body.typeId(ServiceId.CreateSessionResponse);
  responseHeader(body, input.requestHandle, StatusCode.Good);
  body
    .nodeId(input.session)
    .nodeId(input.token)
    .f64(60_000)
    .byteString(Buffer.alloc(32, 4))
    .byteString(null)
    .i32(0)
    .i32(0)
    .string(null)
    .byteString(null)
    .u32(1_048_576);
  return body.toBuffer();
}

export function encodeNonePassword(password: string): Buffer {
  const secret = Buffer.from(password, "utf8");
  const blob = Buffer.alloc(4 + secret.length);
  blob.writeUInt32LE(secret.length, 0);
  secret.copy(blob, 4);
  return blob;
}

export function decodeNonePassword(blob: Buffer): string {
  if (blob.length < 4) {
    throw new Error("OPC-UA password blob is truncated.");
  }
  const length = blob.readUInt32LE(0);
  if (length !== blob.length - 4) {
    throw new Error(
      "OPC-UA password blob does not match the SecurityPolicy None length prefix.",
    );
  }
  return blob.subarray(4).toString("utf8");
}

export function encodeActivateSessionRequest(input: {
  authToken: ParsedOpcUaNodeId;
  requestHandle: number;
  identity:
    | { type: "anonymous" }
    | { type: "username"; username: string; password: string };
}): Buffer {
  const body = new BinaryWriter();
  body.typeId(ServiceId.ActivateSessionRequest);
  requestHeader(body, input.authToken, input.requestHandle);
  body.string(null).byteString(null).i32(0).i32(1).string("en");
  if (input.identity.type === "anonymous") {
    const token = new BinaryWriter().string("anonymous").toBuffer();
    body
      .typeId(ServiceId.AnonymousIdentityToken)
      .u8(0x01)
      .i32(token.length)
      .bytes(token);
  } else {
    const token = new BinaryWriter()
      .string("username")
      .string(input.identity.username)
      .byteString(encodeNonePassword(input.identity.password))
      .string(null)
      .toBuffer();
    body
      .typeId(ServiceId.UserNameIdentityToken)
      .u8(0x01)
      .i32(token.length)
      .bytes(token);
  }
  body.string(null).byteString(null);
  return body.toBuffer();
}

export function encodeActivateSessionResponse(input: {
  requestHandle: number;
  serviceResult: number;
}): Buffer {
  const body = new BinaryWriter();
  body.typeId(ServiceId.ActivateSessionResponse);
  responseHeader(body, input.requestHandle, input.serviceResult);
  body.byteString(Buffer.alloc(32, 5)).i32(0).i32(0);
  return body.toBuffer();
}

export function encodeReadRequest(input: {
  authToken: ParsedOpcUaNodeId;
  requestHandle: number;
  nodes: ParsedOpcUaNodeId[];
}): Buffer {
  const body = new BinaryWriter();
  body.typeId(ServiceId.ReadRequest);
  requestHeader(body, input.authToken, input.requestHandle);
  body.f64(0).i32(0).i32(input.nodes.length);
  for (const node of input.nodes) {
    body.nodeId(node).u32(AttributeIdValue).string(null).u16(0).string(null);
  }
  return body.toBuffer();
}

export interface DecodedDataValue {
  value: string | number | boolean | null;
  statusCode: number;
  sourceTimestamp: string | null;
}

export function encodeDataValue(input: {
  value: string | number | boolean | null;
  statusCode: number;
  sourceTimestamp: string;
}): Buffer {
  const writer = new BinaryWriter();
  const hasValue = input.value !== null;
  writer.u8((hasValue ? 0x01 : 0) | 0x02 | 0x04);
  if (hasValue) encodeVariant(writer, input.value as string | number | boolean);
  writer.u32(input.statusCode).dateTime(Date.parse(input.sourceTimestamp));
  return writer.toBuffer();
}

function encodeVariant(
  writer: BinaryWriter,
  value: string | number | boolean,
): void {
  if (typeof value === "boolean") {
    writer.u8(1).u8(value ? 1 : 0);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("OPC-UA value is not finite.");
    if (
      Number.isInteger(value) &&
      value >= -0x80000000 &&
      value <= 0x7fffffff
    ) {
      writer.u8(6).i32(value);
      return;
    }
    writer.u8(11).f64(value);
    return;
  }
  writer.u8(12).string(value);
}

export function encodeReadResponse(input: {
  requestHandle: number;
  results: Array<{
    value: string | number | boolean | null;
    statusCode: number;
    sourceTimestamp: string;
  }>;
}): Buffer {
  const body = new BinaryWriter();
  body.typeId(ServiceId.ReadResponse);
  responseHeader(body, input.requestHandle, StatusCode.Good);
  body.i32(input.results.length);
  for (const result of input.results) body.bytes(encodeDataValue(result));
  body.i32(0);
  return body.toBuffer();
}

export function encodeServiceFault(
  requestHandle: number,
  serviceResult: number,
): Buffer {
  const body = new BinaryWriter();
  body.typeId(ServiceId.ServiceFault);
  responseHeader(body, requestHandle, serviceResult);
  return body.toBuffer();
}

export function encodeCloseSessionRequest(input: {
  authToken: ParsedOpcUaNodeId;
  requestHandle: number;
}): Buffer {
  const body = new BinaryWriter();
  body.typeId(ServiceId.CloseSessionRequest);
  requestHeader(body, input.authToken, input.requestHandle);
  body.u8(1);
  return body.toBuffer();
}

export interface OpenChannelRequest {
  securityMode: number;
  requestHandle: number;
  requestId: number;
}

export function decodeOpenSecureChannel(message: Buffer): OpenChannelRequest {
  const reader = messageReader(message, "OPN");
  const channelId = reader.u32();
  if (channelId !== 0) {
    throw new Error("OPC-UA OpenSecureChannel must use channel id 0.");
  }
  const policy = reader.string();
  reader.byteString();
  reader.byteString();
  reader.u32();
  const requestId = reader.u32();
  const type = reader.nodeId();
  if (type.numericId !== ServiceId.OpenSecureChannelRequest) {
    throw new Error(
      "OPC-UA secure channel did not carry OpenSecureChannelRequest.",
    );
  }
  if (policy !== SECURITY_POLICY_NONE) {
    throw new Error("OPC-UA security policy is not None.");
  }
  const header = readRequestHeader(reader);
  reader.u32();
  reader.u32();
  const securityMode = reader.u32();
  reader.byteString();
  reader.u32();
  reader.expectExhausted();
  return { securityMode, requestHandle: header.requestHandle, requestId };
}

export function decodeOpenSecureChannelResponse(message: Buffer): {
  channelId: number;
  tokenId: number;
} {
  const reader = messageReader(message, "OPN");
  const secureChannelId = reader.u32();
  const policy = reader.string();
  reader.byteString();
  reader.byteString();
  reader.u32();
  reader.u32();
  const type = reader.nodeId();
  if (
    policy !== SECURITY_POLICY_NONE ||
    type.numericId !== ServiceId.OpenSecureChannelResponse
  ) {
    throw new Error(
      "OPC-UA secure-channel response is not SecurityPolicy None.",
    );
  }
  const header = readResponseHeader(reader);
  if (header.serviceResult !== StatusCode.Good) {
    throw new Error("OPC-UA secure channel was refused.");
  }
  reader.u32();
  const channelId = reader.u32();
  const tokenId = reader.u32();
  reader.dateTime();
  reader.u32();
  reader.byteString();
  reader.expectExhausted();
  if (channelId !== secureChannelId || tokenId === 0) {
    throw new Error("OPC-UA secure-channel token is invalid.");
  }
  return { channelId, tokenId };
}

export function encodeForbiddenService(input: {
  typeId: number;
  authToken: ParsedOpcUaNodeId | null;
  requestHandle: number;
}): Buffer {
  const body = new BinaryWriter();
  body.typeId(input.typeId);
  requestHeader(body, input.authToken, input.requestHandle);
  return body.toBuffer();
}

export class FrameBuffer {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const frames: Buffer[] = [];
    while (this.pending.length >= 8) {
      const size = this.pending.readUInt32LE(4);
      if (size < 8 || size > 1_048_576) {
        throw new Error("OPC-UA message size is outside the 1 MB bound.");
      }
      if (this.pending.length < size) break;
      frames.push(Buffer.from(this.pending.subarray(0, size)));
      this.pending = this.pending.subarray(size);
    }
    return frames;
  }
}

export interface SymmetricMessage {
  channelId: number;
  tokenId: number;
  requestId: number;
  body: Buffer;
}

export function decodeSymmetric(message: Buffer): SymmetricMessage {
  const reader = messageReader(message, "MSG");
  const channelId = reader.u32();
  const tokenId = reader.u32();
  reader.u32();
  const requestId = reader.u32();
  const body = reader.bytes(reader.remaining());
  return { channelId, tokenId, requestId, body };
}

export function decodeTypeAndHeader(body: Buffer): {
  typeId: number;
  requestHandle: number;
  reader: BinaryReader;
} {
  const reader = new BinaryReader(body);
  const type = reader.nodeId();
  if (type.identifierType !== "numeric" || type.numericId === undefined) {
    throw new Error("OPC-UA service type id is not numeric.");
  }
  const header = readRequestHeader(reader);
  return {
    typeId: type.numericId,
    requestHandle: header.requestHandle,
    reader,
  };
}

export function readRequestHeader(reader: BinaryReader): {
  requestHandle: number;
} {
  reader.nodeId();
  reader.dateTime();
  const requestHandle = reader.u32();
  reader.u32();
  reader.string();
  reader.u32();
  expectNullExtension(reader);
  return { requestHandle };
}

export interface DecodedIdentity {
  type: "anonymous" | "username";
  username?: string;
  password?: string;
}

export function decodeActivateIdentity(reader: BinaryReader): DecodedIdentity {
  reader.string();
  reader.byteString();
  const certificates = reader.i32();
  if (certificates !== 0) {
    throw new Error(
      "OPC-UA software certificates are outside the read-only subset.",
    );
  }
  const locales = reader.i32();
  if (locales < 0 || locales > 8) {
    throw new Error("OPC-UA locale list is outside the read-only subset.");
  }
  for (let index = 0; index < locales; index += 1) reader.string();
  const tokenType = reader.nodeId();
  const encoding = reader.u8();
  const length = reader.i32();
  if (encoding !== 0x01 || length < 0) {
    throw new Error("OPC-UA identity token is not a binary extension object.");
  }
  const token = new BinaryReader(reader.bytes(length));
  let identity: DecodedIdentity;
  if (tokenType.numericId === ServiceId.AnonymousIdentityToken) {
    token.string();
    identity = { type: "anonymous" };
  } else if (tokenType.numericId === ServiceId.UserNameIdentityToken) {
    token.string();
    const username = token.string();
    const password = token.byteString();
    token.string();
    if (!username || !password) {
      throw new Error("OPC-UA username token is incomplete.");
    }
    identity = {
      type: "username",
      username,
      password: decodeNonePassword(password),
    };
  } else {
    throw new Error("OPC-UA identity token type is not anonymous or username.");
  }
  token.expectExhausted();
  reader.string();
  reader.byteString();
  reader.expectExhausted();
  return identity;
}

export function decodeReadNodes(reader: BinaryReader): ParsedOpcUaNodeId[] {
  reader.f64();
  reader.i32();
  const count = reader.i32();
  if (count < 1 || count > 50) {
    throw new Error("OPC-UA Read node count is outside 1 to 50.");
  }
  const nodes: ParsedOpcUaNodeId[] = [];
  for (let index = 0; index < count; index += 1) {
    const node = reader.nodeId();
    const attributeId = reader.u32();
    reader.string();
    reader.u16();
    reader.string();
    if (attributeId !== AttributeIdValue) {
      throw new Error("OPC-UA Read requested an attribute other than Value.");
    }
    nodes.push(node);
  }
  reader.expectExhausted();
  return nodes;
}

export function decodeDataValue(reader: BinaryReader): DecodedDataValue {
  const mask = reader.u8();
  let value: string | number | boolean | null = null;
  if (mask & 0x01) value = decodeVariant(reader);
  const code = mask & 0x02 ? reader.u32() : StatusCode.Good;
  const sourceTimestamp = mask & 0x04 ? reader.dateTime() : null;
  if (mask & 0x08) reader.dateTime();
  if (mask & 0x10) reader.u16();
  if (mask & 0x20) reader.u16();
  return { value, statusCode: code, sourceTimestamp };
}

function decodeVariant(reader: BinaryReader): string | number | boolean | null {
  const encoding = reader.u8();
  if (encoding & 0xc0) {
    throw new Error("OPC-UA variant arrays are outside the read-only subset.");
  }
  if (encoding === 1) return reader.u8() === 1;
  if (encoding === 6) return reader.i32();
  if (encoding === 11) {
    const value = reader.f64();
    if (!Number.isFinite(value))
      throw new Error("OPC-UA double is not finite.");
    return value;
  }
  if (encoding === 12) {
    const value = reader.string();
    if (value === null) throw new Error("OPC-UA string value is null.");
    return value;
  }
  throw new Error("OPC-UA variant type is outside the read-only subset.");
}

export function decodeReadResponse(body: Buffer): DecodedDataValue[] {
  const reader = new BinaryReader(body);
  const type = reader.nodeId();
  if (type.numericId === ServiceId.ServiceFault) {
    const fault = readResponseHeader(reader);
    throw new Error(`OPC-UA service fault ${statusName(fault.serviceResult)}.`);
  }
  if (type.numericId !== ServiceId.ReadResponse) {
    throw new Error("OPC-UA response was not ReadResponse.");
  }
  const header = readResponseHeader(reader);
  if (header.serviceResult !== StatusCode.Good) {
    throw new Error(
      `OPC-UA Read failed with ${statusName(header.serviceResult)}.`,
    );
  }
  const count = reader.i32();
  if (count < 1 || count > 50) {
    throw new Error("OPC-UA Read response count is outside 1 to 50.");
  }
  const results: DecodedDataValue[] = [];
  for (let index = 0; index < count; index += 1)
    results.push(decodeDataValue(reader));
  const diagnostics = reader.i32();
  if (diagnostics !== 0) {
    throw new Error("OPC-UA diagnostic info is outside the read-only subset.");
  }
  reader.expectExhausted();
  return results;
}

export function decodeActivateResponse(body: Buffer): number {
  const reader = new BinaryReader(body);
  const type = reader.nodeId();
  if (type.numericId === ServiceId.ServiceFault) {
    const header = readResponseHeader(reader);
    return header.serviceResult;
  }
  if (type.numericId !== ServiceId.ActivateSessionResponse) {
    throw new Error("OPC-UA response was not ActivateSessionResponse.");
  }
  const header = readResponseHeader(reader);
  reader.byteString();
  reader.i32();
  reader.i32();
  reader.expectExhausted();
  return header.serviceResult;
}

export function decodeCreateSessionToken(body: Buffer): ParsedOpcUaNodeId {
  const reader = new BinaryReader(body);
  const type = reader.nodeId();
  if (type.numericId !== ServiceId.CreateSessionResponse) {
    throw new Error("OPC-UA response was not CreateSessionResponse.");
  }
  const header = readResponseHeader(reader);
  if (header.serviceResult !== StatusCode.Good) {
    throw new Error("OPC-UA CreateSession was refused.");
  }
  reader.nodeId();
  const token = reader.nodeId();
  reader.f64();
  reader.byteString();
  reader.byteString();
  const endpoints = reader.i32();
  const certificates = reader.i32();
  if (endpoints !== 0 || certificates !== 0) {
    throw new Error(
      "OPC-UA CreateSession endpoint expansion is outside this shim. The mock returns an empty endpoint list.",
    );
  }
  reader.string();
  reader.byteString();
  reader.u32();
  reader.expectExhausted();
  if (token.numericId === 0 && token.namespace === 0) {
    throw new Error("OPC-UA authentication token is null.");
  }
  return token;
}

function expectNullExtension(reader: BinaryReader): void {
  const typeId = reader.nodeId();
  const encoding = reader.u8();
  if (typeId.namespace !== 0 || typeId.numericId !== 0 || encoding !== 0x00) {
    throw new Error(
      "OPC-UA additional header is outside the read-only subset.",
    );
  }
}

function readResponseHeader(reader: BinaryReader): { serviceResult: number } {
  reader.dateTime();
  reader.u32();
  const serviceResult = reader.u32();
  const diagnostic = reader.u8();
  if (diagnostic !== 0) {
    throw new Error("OPC-UA diagnostic info is outside the read-only subset.");
  }
  const strings = reader.i32();
  if (strings !== 0) {
    throw new Error(
      "OPC-UA diagnostic string table is outside the read-only subset.",
    );
  }
  expectNullExtension(reader);
  return { serviceResult };
}

function messageReader(message: Buffer, expected: string): BinaryReader {
  if (message.length < 8 || message.length > 1_048_576) {
    throw new Error("OPC-UA message is outside the 1 MB bound.");
  }
  const type = message.toString("ascii", 0, 3);
  const chunk = message.toString("ascii", 3, 4);
  const size = message.readUInt32LE(4);
  if (type !== expected || chunk !== "F" || size !== message.length) {
    throw new Error(`OPC-UA ${expected} message header is invalid.`);
  }
  return new BinaryReader(message.subarray(8));
}

export function messageType(message: Buffer): string {
  if (message.length < 8) throw new Error("OPC-UA message is truncated.");
  const size = message.readUInt32LE(4);
  if (size !== message.length || message.toString("ascii", 3, 4) !== "F") {
    throw new Error("OPC-UA message framing is invalid.");
  }
  return message.toString("ascii", 0, 3);
}
