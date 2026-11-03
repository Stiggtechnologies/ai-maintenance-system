// @vitest-environment node
import { connect } from "node:net";
import { describe, expect, it } from "vitest";
import { encodeHello } from "../../services/opc-ua-read-gateway/binary";
import { readOpcUaNodeValues } from "../../services/opc-ua-read-gateway/client";
import { handleOpcUaReadGatewayRequest } from "../../services/opc-ua-read-gateway/http";
import { startMockOpcUaServer } from "../../services/opc-ua-read-gateway/mock-server";
import {
  encodeForbiddenService,
  encodeOpenSecureChannel,
  encodeSymmetric,
  ServiceId,
} from "../../services/opc-ua-read-gateway/binary";

const STAMP = "2026-11-03T12:00:00.000Z";

describe("OPC-UA read-only client against the mock server", () => {
  it("pins the Hello message to the OPC UA binary header layout", () => {
    const endpoint = "opc.tcp://127.0.0.1:4840";
    const hello = encodeHello(endpoint);
    expect(hello.subarray(0, 8).toString("hex")).toBe("48454c4638000000");
    expect(hello.subarray(8, 28).toString("hex")).toBe(
      "00000000ffff0000ffff00000000000000000000",
    );
    expect(hello.readInt32LE(28)).toBe(endpoint.length);
    expect(hello.subarray(32).toString("utf8")).toBe(endpoint);
  });

  it("reads nodeId, value, statusCode and sourceTimestamp and never writes", async () => {
    const server = await startMockOpcUaServer({
      nodes: {
        "ns=2;s=Pump.Speed": { value: 1480.5, sourceTimestamp: STAMP },
        "i=2258": { value: true, sourceTimestamp: STAMP },
        "ns=2;i=1001": { value: "running", sourceTimestamp: STAMP },
        "ns=2;s=Pump.Missing": {
          value: null,
          statusCode: 0x80340000,
          sourceTimestamp: STAMP,
        },
      },
    });
    try {
      const readings = await readOpcUaNodeValues({
        endpointUrl: server.url,
        allowedHosts: ["127.0.0.1"],
        securityMode: "None",
        securityPolicy: "None",
        userIdentity: { type: "anonymous" },
        nodeIds: [
          "ns=2;s=Pump.Speed",
          "i=2258",
          "ns=2;i=1001",
          "ns=2;s=Pump.Missing",
        ],
        timeoutMs: 5000,
      });
      expect(readings).toEqual([
        {
          nodeId: "ns=2;s=Pump.Speed",
          value: 1480.5,
          statusCode: "0x00000000",
          sourceTimestamp: STAMP,
        },
        {
          nodeId: "i=2258",
          value: true,
          statusCode: "0x00000000",
          sourceTimestamp: STAMP,
        },
        {
          nodeId: "ns=2;i=1001",
          value: "running",
          statusCode: "0x00000000",
          sourceTimestamp: STAMP,
        },
        {
          nodeId: "ns=2;s=Pump.Missing",
          value: null,
          statusCode: "0x80340000",
          sourceTimestamp: STAMP,
        },
      ]);
      expect(server.writesRefused()).toBe(0);
      expect(server.connections()).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("refuses a username mismatch and does not return node values", async () => {
    const server = await startMockOpcUaServer({
      anonymous: false,
      users: { reader: "reader-secret" },
      nodes: {
        "ns=2;s=Pump.Speed": { value: 1, sourceTimestamp: STAMP },
      },
    });
    try {
      await expect(
        readOpcUaNodeValues({
          endpointUrl: server.url,
          allowedHosts: ["127.0.0.1"],
          securityMode: "None",
          securityPolicy: "None",
          userIdentity: {
            type: "username",
            username: "reader",
            password: "wrong-secret",
          },
          nodeIds: ["ns=2;s=Pump.Speed"],
          timeoutMs: 5000,
        }),
      ).rejects.toThrow(/ActivateSession was refused/i);
      const readings = await readOpcUaNodeValues({
        endpointUrl: server.url,
        allowedHosts: ["127.0.0.1"],
        securityMode: "None",
        securityPolicy: "None",
        userIdentity: {
          type: "username",
          username: "reader",
          password: "reader-secret",
        },
        nodeIds: ["ns=2;s=Pump.Speed"],
        timeoutMs: 5000,
      });
      expect(readings[0]?.value).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("does not open a socket when security would have to be downgraded", async () => {
    const server = await startMockOpcUaServer({
      nodes: { "i=1": { value: 1, sourceTimestamp: STAMP } },
    });
    try {
      await expect(
        readOpcUaNodeValues({
          endpointUrl: server.url,
          allowedHosts: ["127.0.0.1"],
          securityMode: "SignAndEncrypt",
          securityPolicy: "Basic256Sha256",
          userIdentity: { type: "anonymous" },
          nodeIds: ["i=1"],
          timeoutMs: 5000,
        }),
      ).rejects.toThrow(/will not downgrade/i);
      expect(server.connections()).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("refuses Write and Call on the mock server", async () => {
    const server = await startMockOpcUaServer({
      nodes: { "i=1": { value: 4, sourceTimestamp: STAMP } },
    });
    try {
      await probeForbidden(server.url, ServiceId.WriteRequest);
      await probeForbidden(server.url, ServiceId.CallRequest);
      expect(server.writesRefused()).toBe(2);
      const readings = await readOpcUaNodeValues({
        endpointUrl: server.url,
        allowedHosts: ["127.0.0.1"],
        securityMode: "None",
        securityPolicy: "None",
        userIdentity: { type: "anonymous" },
        nodeIds: ["i=1"],
        timeoutMs: 5000,
      });
      expect(readings[0]?.value).toBe(4);
    } finally {
      await server.close();
    }
  });

  it("serves the gateway shim only as a read", async () => {
    const server = await startMockOpcUaServer({
      nodes: {
        "ns=2;s=Pump.Speed": { value: 12, sourceTimestamp: STAMP },
      },
    });
    const token = "g".repeat(32);
    try {
      const denied = await handleOpcUaReadGatewayRequest(
        {
          method: "POST",
          path: "/v1/write",
          authorization: `Bearer ${token}`,
          body: {},
        },
        { token, allowedServerHosts: ["127.0.0.1"] },
      );
      expect(denied.status).toBe(404);
      const method = await handleOpcUaReadGatewayRequest(
        {
          method: "POST",
          path: "/v1/read",
          authorization: `Bearer ${token}`,
          body: { methodId: "ns=2;s=Pump.Start" },
        },
        { token, allowedServerHosts: ["127.0.0.1"] },
      );
      expect(method.status).toBe(400);
      const ok = await handleOpcUaReadGatewayRequest(
        {
          method: "POST",
          path: "/v1/read",
          authorization: `Bearer ${token}`,
          body: {
            endpointUrl: server.url,
            securityMode: "None",
            securityPolicy: "None",
            userIdentity: { type: "anonymous" },
            nodeIds: ["ns=2;s=Pump.Speed"],
            timeoutMs: 5000,
          },
        },
        { token, allowedServerHosts: ["127.0.0.1"] },
      );
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({
        readings: [
          {
            nodeId: "ns=2;s=Pump.Speed",
            value: 12,
            statusCode: "0x00000000",
            sourceTimestamp: STAMP,
          },
        ],
      });
    } finally {
      await server.close();
    }
  });
});

function probeForbidden(url: string, typeId: number): Promise<void> {
  const endpoint = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: endpoint.hostname,
      port: Number(endpoint.port),
    });
    socket.on("error", reject);
    socket.on("connect", () => {
      socket.write(encodeHello(url));
      socket.write(
        encodeOpenSecureChannel({ sequenceNumber: 1, requestId: 1 }),
      );
      socket.write(
        encodeSymmetric({
          type: "MSG",
          channelId: 1,
          tokenId: 1,
          sequenceNumber: 2,
          requestId: 2,
          body: encodeForbiddenService({
            typeId,
            authToken: null,
            requestHandle: 1,
          }),
        }),
      );
      setTimeout(() => {
        socket.end();
        resolve();
      }, 50);
    });
  });
}
