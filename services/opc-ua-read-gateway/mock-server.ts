// In-process OPC UA Binary server for contract tests. It speaks the same
// read-only subset as the gateway client and never applies a Write or Call.

import { createServer, type Server, type Socket } from "node:net";
import { timingSafeEqual } from "node:crypto";
import type { ParsedOpcUaNodeId } from "../../supabase/functions/_shared/opc-ua-read.ts";
import {
  FrameBuffer,
  ServiceId,
  StatusCode,
  decodeActivateIdentity,
  decodeOpenSecureChannel,
  decodeReadNodes,
  decodeTypeAndHeader,
  encodeAcknowledge,
  encodeActivateSessionResponse,
  encodeCreateSessionResponse,
  encodeError,
  encodeOpenSecureChannelResponse,
  encodeReadResponse,
  encodeServiceFault,
  encodeSymmetric,
  messageType,
} from "./binary.ts";

export interface MockOpcUaNode {
  value: string | number | boolean | null;
  statusCode?: number;
  sourceTimestamp: string;
}

export interface MockOpcUaServer {
  url: string;
  connections: () => number;
  writesRefused: () => number;
  close: () => Promise<void>;
}

const SESSION: ParsedOpcUaNodeId = {
  canonical: "i=10",
  namespace: 0,
  identifierType: "numeric",
  numericId: 10,
};
const TOKEN: ParsedOpcUaNodeId = {
  canonical: "i=11",
  namespace: 0,
  identifierType: "numeric",
  numericId: 11,
};

export async function startMockOpcUaServer(options: {
  nodes: Record<string, MockOpcUaNode>;
  users?: Record<string, string>;
  anonymous?: boolean;
}): Promise<MockOpcUaServer> {
  let connections = 0;
  let writesRefused = 0;
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    void serve(socket, options, () => {
      writesRefused += 1;
    }).catch(() => socket.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mock OPC-UA server did not bind a TCP port.");
  }
  return {
    url: `opc.tcp://127.0.0.1:${address.port}`,
    connections: () => connections,
    writesRefused: () => writesRefused,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

async function serve(
  socket: Socket,
  options: {
    nodes: Record<string, MockOpcUaNode>;
    users?: Record<string, string>;
    anonymous?: boolean;
  },
  refuseWrite: () => void,
): Promise<void> {
  const frames = new FrameBuffer();
  const queue: Buffer[] = [];
  let waiter: ((frame: Buffer) => void) | null = null;
  socket.on("data", (chunk: Buffer) => {
    try {
      queue.push(...frames.push(chunk));
      if (waiter && queue.length > 0) {
        const resolve = waiter;
        waiter = null;
        resolve(queue.shift() as Buffer);
      }
    } catch {
      socket.destroy();
    }
  });
  const next = () =>
    new Promise<Buffer>((resolve, reject) => {
      const existing = queue.shift();
      if (existing) {
        resolve(existing);
        return;
      }
      const timer = setTimeout(() => reject(new Error("idle")), 5000);
      waiter = (frame) => {
        clearTimeout(timer);
        resolve(frame);
      };
      socket.once("close", () => {
        clearTimeout(timer);
        reject(new Error("closed"));
      });
    });

  const hello = await next();
  if (messageType(hello) !== "HEL") throw new Error("expected Hello");
  socket.write(encodeAcknowledge());
  const open = decodeOpenSecureChannel(await next());
  if (open.securityMode !== 1) {
    socket.write(
      encodeError(
        StatusCode.BadSecurityModeInsufficient,
        "Security mode is not None. This shim will not open a signed channel.",
      ),
    );
    socket.end();
    return;
  }
  socket.write(
    encodeOpenSecureChannelResponse({
      requestId: open.requestId,
      requestHandle: open.requestHandle,
      channelId: 1,
      tokenId: 1,
    }),
  );

  let active = false;
  let sequence = 10;
  const reply = (body: Buffer, requestId: number) => {
    sequence += 1;
    socket.write(
      encodeSymmetric({
        type: "MSG",
        channelId: 1,
        tokenId: 1,
        sequenceNumber: sequence,
        requestId,
        body,
      }),
    );
  };

  while (socket.writable) {
    const message = await next();
    const type = messageType(message);
    if (type === "CLO") {
      socket.end();
      return;
    }
    if (type !== "MSG") throw new Error("unexpected OPC-UA message");
    const channel = message.readUInt32LE(8);
    const token = message.readUInt32LE(12);
    const requestId = message.readUInt32LE(20);
    const body = message.subarray(24);
    if (channel !== 1 || token !== 1) {
      reply(encodeServiceFault(0, StatusCode.BadSessionIdInvalid), requestId);
      continue;
    }
    let decoded: ReturnType<typeof decodeTypeAndHeader>;
    try {
      decoded = decodeTypeAndHeader(body);
    } catch {
      reply(encodeServiceFault(0, StatusCode.BadServiceUnsupported), requestId);
      continue;
    }
    if (
      decoded.typeId === ServiceId.WriteRequest ||
      decoded.typeId === ServiceId.CallRequest
    ) {
      refuseWrite();
      reply(
        encodeServiceFault(
          decoded.requestHandle,
          StatusCode.BadServiceUnsupported,
        ),
        requestId,
      );
      continue;
    }
    if (decoded.typeId === ServiceId.CreateSessionRequest) {
      reply(
        encodeCreateSessionResponse({
          requestHandle: decoded.requestHandle,
          session: SESSION,
          token: TOKEN,
        }),
        requestId,
      );
      continue;
    }
    if (decoded.typeId === ServiceId.ActivateSessionRequest) {
      let result: number;
      try {
        const identity = decodeActivateIdentity(decoded.reader);
        result = authenticate(identity, options);
        active = result === StatusCode.Good;
      } catch {
        result = StatusCode.BadIdentityTokenRejected;
        active = false;
      }
      reply(
        encodeActivateSessionResponse({
          requestHandle: decoded.requestHandle,
          serviceResult: result,
        }),
        requestId,
      );
      continue;
    }
    if (decoded.typeId === ServiceId.ReadRequest) {
      if (!active) {
        reply(
          encodeServiceFault(
            decoded.requestHandle,
            StatusCode.BadSessionIdInvalid,
          ),
          requestId,
        );
        continue;
      }
      let nodes: ParsedOpcUaNodeId[];
      try {
        nodes = decodeReadNodes(decoded.reader);
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "OPC-UA Read was refused.";
        if (messageText.includes("attribute other than Value")) {
          reply(
            encodeServiceFault(
              decoded.requestHandle,
              StatusCode.BadAttributeIdInvalid,
            ),
            requestId,
          );
          continue;
        }
        throw error;
      }
      reply(
        encodeReadResponse({
          requestHandle: decoded.requestHandle,
          results: nodes.map((node) => {
            const stored = options.nodes[node.canonical];
            if (!stored) {
              return {
                value: null,
                statusCode: StatusCode.BadNodeIdUnknown,
                sourceTimestamp: new Date(0).toISOString(),
              };
            }
            return {
              value: stored.value,
              statusCode: stored.statusCode ?? StatusCode.Good,
              sourceTimestamp: stored.sourceTimestamp,
            };
          }),
        }),
        requestId,
      );
      continue;
    }
    if (decoded.typeId === ServiceId.CloseSessionRequest) {
      reply(
        encodeServiceFault(decoded.requestHandle, StatusCode.Good),
        requestId,
      );
      socket.end();
      return;
    }
    reply(
      encodeServiceFault(
        decoded.requestHandle,
        StatusCode.BadServiceUnsupported,
      ),
      requestId,
    );
  }
}

function authenticate(
  identity: {
    type: "anonymous" | "username";
    username?: string;
    password?: string;
  },
  options: { users?: Record<string, string>; anonymous?: boolean },
): number {
  if (identity.type === "anonymous") {
    return options.anonymous === false
      ? StatusCode.BadIdentityTokenRejected
      : StatusCode.Good;
  }
  const expected = options.users?.[identity.username ?? ""];
  if (
    !expected ||
    !identity.password ||
    !sameSecret(expected, identity.password)
  ) {
    return StatusCode.BadIdentityTokenRejected;
  }
  return StatusCode.Good;
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
