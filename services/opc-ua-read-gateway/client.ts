// Read-only OPC UA Binary client. It opens one SecurityPolicy#None session,
// issues a single Read of the Value attribute, and closes the session.
// It has no Write or Call method. Sign and SignAndEncrypt fail before the
// socket opens so a configured secure endpoint is never downgraded.

import { connect, type Socket } from "node:net";
import {
  assertOpcTcpEndpoint,
  assertOpcUaSecuritySelection,
  parseOpcUaNodeId,
  type OpcUaReading,
  type OpcUaSecurityMode,
  type OpcUaSecurityPolicy,
  type OpcUaUserIdentity,
} from "../../supabase/functions/_shared/opc-ua-read.ts";
import {
  FrameBuffer,
  ServiceId,
  StatusCode,
  decodeActivateResponse,
  decodeCreateSessionToken,
  decodeOpenSecureChannelResponse,
  decodeReadResponse,
  encodeActivateSessionRequest,
  encodeCloseSessionRequest,
  encodeCreateSessionRequest,
  encodeHello,
  encodeOpenSecureChannel,
  encodeReadRequest,
  encodeSymmetric,
  messageType,
  statusHex,
  statusName,
} from "./binary.ts";

export interface OpcUaReadInput {
  endpointUrl: string;
  allowedHosts: readonly string[];
  securityMode: OpcUaSecurityMode;
  securityPolicy: OpcUaSecurityPolicy;
  userIdentity: OpcUaUserIdentity;
  nodeIds: readonly string[];
  timeoutMs: number;
}

export async function readOpcUaNodeValues(
  input: OpcUaReadInput,
): Promise<OpcUaReading[]> {
  assertOpcUaSecuritySelection(input.securityMode, input.securityPolicy);
  const endpoint = assertOpcTcpEndpoint(input.endpointUrl, input.allowedHosts);
  if (input.nodeIds.length < 1 || input.nodeIds.length > 50) {
    throw new Error("OPC-UA node list must contain between 1 and 50 node ids.");
  }
  const nodes = input.nodeIds.map((nodeId) => parseOpcUaNodeId(nodeId));
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1000 ||
    input.timeoutMs > 20000
  ) {
    throw new Error("OPC-UA read timeout must be between 1 and 20 seconds.");
  }

  const socket = connect({ host: endpoint.hostname, port: endpoint.port });
  const frames = new FrameBuffer();
  const queue: Buffer[] = [];
  let waiter: ((frame: Buffer) => void) | null = null;
  let failure: Error | null = null;
  const fail = (error: Error) => {
    failure = error;
    waiter?.(Buffer.alloc(0));
    waiter = null;
  };
  socket.on("data", (chunk: Buffer) => {
    try {
      const decoded = frames.push(chunk);
      queue.push(...decoded);
      if (waiter && queue.length > 0) {
        const resolve = waiter;
        waiter = null;
        resolve(queue.shift() as Buffer);
      }
    } catch (error) {
      fail(
        error instanceof Error ? error : new Error("OPC-UA framing failed."),
      );
    }
  });
  socket.on("error", (error) => fail(error));
  socket.on("close", () => {
    if (!failure && queue.length === 0 && waiter) {
      fail(new Error("OPC-UA server closed the connection."));
    }
  });

  const nextFrame = () =>
    new Promise<Buffer>((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const existing = queue.shift();
      if (existing) {
        resolve(existing);
        return;
      }
      const timer = setTimeout(() => {
        waiter = null;
        reject(new Error("OPC-UA response timed out."));
      }, input.timeoutMs);
      waiter = (frame) => {
        clearTimeout(timer);
        if (failure && frame.length === 0) reject(failure);
        else resolve(frame);
      };
    });

  const send = (payload: Buffer) => {
    socket.write(payload);
  };

  try {
    await waitForConnect(socket, input.timeoutMs);
    send(encodeHello(endpoint.href));
    const ack = await nextFrame();
    if (messageType(ack) !== "ACK") {
      throw new Error("OPC-UA server did not acknowledge the Hello.");
    }

    send(encodeOpenSecureChannel({ sequenceNumber: 1, requestId: 1 }));
    const opened = decodeOpenSecureChannelResponse(await nextFrame());
    let sequence = 2;
    let request = 2;
    const exchange = async (body: Buffer) => {
      const requestId = request;
      request += 1;
      sequence += 1;
      send(
        encodeSymmetric({
          type: "MSG",
          channelId: opened.channelId,
          tokenId: opened.tokenId,
          sequenceNumber: sequence,
          requestId,
          body,
        }),
      );
      const message = await nextFrame();
      if (messageType(message) === "ERR") {
        throw new Error("OPC-UA server returned a transport error.");
      }
      const reader = message.subarray(8);
      const channelId = reader.readUInt32LE(0);
      const tokenId = reader.readUInt32LE(4);
      if (channelId !== opened.channelId || tokenId !== opened.tokenId) {
        throw new Error(
          "OPC-UA response used a different secure-channel token.",
        );
      }
      return reader.subarray(16);
    };

    const token = decodeCreateSessionToken(
      await exchange(
        encodeCreateSessionRequest({
          endpointUrl: endpoint.href,
          requestHandle: 2,
        }),
      ),
    );
    const activated = decodeActivateResponse(
      await exchange(
        encodeActivateSessionRequest({
          authToken: token,
          requestHandle: 3,
          identity: input.userIdentity,
        }),
      ),
    );
    if (activated !== StatusCode.Good) {
      throw new Error(
        `OPC-UA ActivateSession was refused (${statusName(activated)}).`,
      );
    }
    const results = decodeReadResponse(
      await exchange(
        encodeReadRequest({
          authToken: token,
          requestHandle: 4,
          nodes,
        }),
      ),
    );
    if (results.length !== nodes.length) {
      throw new Error(
        "OPC-UA Read did not return one value per requested node.",
      );
    }
    try {
      send(
        encodeSymmetric({
          type: "MSG",
          channelId: opened.channelId,
          tokenId: opened.tokenId,
          sequenceNumber: sequence + 1,
          requestId: request,
          body: encodeCloseSessionRequest({
            authToken: token,
            requestHandle: 5,
          }),
        }),
      );
      send(
        encodeSymmetric({
          type: "CLO",
          channelId: opened.channelId,
          sequenceNumber: sequence + 2,
          requestId: request + 1,
        }),
      );
    } catch {
      // The values are already decoded. Closing is best-effort.
    }
    return results.map((result, index) => {
      if (!result.sourceTimestamp) {
        throw new Error(
          `OPC-UA node ${nodes[index].canonical} omitted its source timestamp.`,
        );
      }
      return {
        nodeId: nodes[index].canonical,
        value: result.value,
        statusCode: statusHex(result.statusCode),
        sourceTimestamp: result.sourceTimestamp,
      };
    });
  } finally {
    socket.destroy();
  }
}

function waitForConnect(socket: Socket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeListener("error", onError);
      reject(new Error("OPC-UA connect timed out."));
    }, timeoutMs);
    const onError = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeListener("error", onError);
      resolve();
    });
  });
}

export const readOnlyServiceAllowlist = [
  ServiceId.ReadRequest,
  ServiceId.CreateSessionRequest,
  ServiceId.ActivateSessionRequest,
  ServiceId.CloseSessionRequest,
  ServiceId.OpenSecureChannelRequest,
] as const;
