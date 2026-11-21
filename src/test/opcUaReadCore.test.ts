import { describe, expect, it } from "vitest";
import {
  assertOpcUaSecuritySelection,
  assertHttpsReadGateway,
  buildOpcUaReadGatewayCall,
  mapOpcUaReadings,
  normalizeOpcUaPullRequest,
  parseOpcUaNodeId,
  resolveOpcUaCredential,
} from "../../supabase/functions/_shared/opc-ua-read";

const gateway = "https://gateway.example.com/opc/v1/read";
const hosts = ["gateway.example.com"];
const servers = ["plant.example.com"];

describe("OPC-UA read contract", () => {
  it("normalizes only a bounded object request and refuses write fields", () => {
    expect(
      normalizeOpcUaPullRequest({
        connector_key: " north-opc ",
        dry_run: false,
      }),
    ).toEqual({ connectorKey: "north-opc", dryRun: false });
    expect(normalizeOpcUaPullRequest({ connector_key: "north-opc" })).toEqual({
      connectorKey: "north-opc",
      dryRun: true,
    });
    expect(() => normalizeOpcUaPullRequest(null)).toThrow(/JSON object/);
    expect(() =>
      normalizeOpcUaPullRequest({ connector_key: "north", dry_run: "false" }),
    ).toThrow(/true or false/);
    expect(() =>
      normalizeOpcUaPullRequest({
        connector_key: "north",
        methodId: "ns=2;s=Start",
      }),
    ).toThrow(/write, call and method/i);
  });

  it("canonicalizes numeric and string node ids and rejects duplicates", () => {
    expect(parseOpcUaNodeId("ns=0;i=2258").canonical).toBe("i=2258");
    expect(parseOpcUaNodeId(" ns=2;s=Pump.Speed ").canonical).toBe(
      "ns=2;s=Pump.Speed",
    );
    expect(() => parseOpcUaNodeId("ns=2;g=not-a-guid")).toThrow(/nodeId/);
    const call = buildOpcUaReadGatewayCall({
      gatewayUrl: gateway,
      allowedGatewayHosts: hosts,
      endpointUrl: "opc.tcp://plant.example.com:4840/line",
      allowedServerHosts: servers,
      securityMode: "None",
      securityPolicy: "None",
      userIdentity: { type: "anonymous" },
      nodeIds: ["ns=2;s=Pump.Speed"],
      timeoutMs: 5000,
    });
    expect(call.url).toBe(gateway);
    expect(call.body.nodeIds).toEqual(["ns=2;s=Pump.Speed"]);
    expect(call.body).not.toHaveProperty("write");
    expect(() =>
      buildOpcUaReadGatewayCall({
        ...call.body,
        gatewayUrl: gateway,
        allowedGatewayHosts: hosts,
        allowedServerHosts: servers,
        endpointUrl: "opc.tcp://other.example.com:4840",
        userIdentity: { type: "anonymous" },
        timeoutMs: 5000,
      }),
    ).toThrow(/allowlist/);
  });

  it("refuses to downgrade Sign or SignAndEncrypt and refuses private gateways", () => {
    expect(() =>
      assertOpcUaSecuritySelection("Sign", "Basic256Sha256"),
    ).toThrow(/will not downgrade/i);
    expect(() =>
      assertHttpsReadGateway("http://gateway.example.com/v1/read", hosts),
    ).toThrow(/HTTPS/);
    expect(() =>
      assertHttpsReadGateway("https://10.1.1.5/v1/read", ["10.1.1.5"]),
    ).toThrow(/public HTTPS/);
    expect(() =>
      buildOpcUaReadGatewayCall({
        gatewayUrl: gateway,
        allowedGatewayHosts: hosts,
        endpointUrl: "opc.tcp://plant.example.com:4840",
        allowedServerHosts: servers,
        securityMode: "SignAndEncrypt",
        securityPolicy: "Aes256_Sha256_RsaPss",
        userIdentity: { type: "anonymous" },
        nodeIds: ["i=1"],
        timeoutMs: 5000,
      }),
    ).toThrow(/will not downgrade/i);
  });

  it("resolves anonymous and username credentials without accepting a mismatched secret", () => {
    const registry = JSON.stringify({
      "vault://north/opc-ua": { type: "anonymous" },
      "vault://north/opc-user": {
        type: "username",
        username: "reader",
        password: "reader-secret",
      },
    });
    expect(
      resolveOpcUaCredential(registry, "vault://north/opc-ua", "anonymous"),
    ).toEqual({ type: "anonymous" });
    expect(
      resolveOpcUaCredential(registry, "vault://north/opc-user", "username"),
    ).toEqual({
      type: "username",
      username: "reader",
      password: "reader-secret",
    });
    expect(() =>
      resolveOpcUaCredential(registry, "vault://north/opc-ua", "username"),
    ).toThrow(/authentication mode/);
    expect(() =>
      resolveOpcUaCredential(
        JSON.stringify({
          "vault://north/opc-ua": { type: "anonymous", password: "nope" },
        }),
        "vault://north/opc-ua",
        "anonymous",
      ),
    ).toThrow(/must not carry a password/);
  });

  it("maps exact node values and refuses a good reading with no value", () => {
    expect(
      mapOpcUaReadings(
        {
          readings: [
            {
              nodeId: "ns=2;s=Pump.Speed",
              value: 1480.5,
              statusCode: "0x00000000",
              sourceTimestamp: "2026-11-03T12:00:00.000Z",
            },
            {
              nodeId: "i=2258",
              value: null,
              statusCode: "0x80340000",
              sourceTimestamp: "2026-11-03T12:00:01Z",
            },
          ],
        },
        { nodeIds: ["ns=2;s=Pump.Speed", "i=2258"], maxNodes: 50 },
      ),
    ).toEqual([
      {
        nodeId: "ns=2;s=Pump.Speed",
        value: 1480.5,
        statusCode: "0x00000000",
        sourceTimestamp: "2026-11-03T12:00:00.000Z",
      },
      {
        nodeId: "i=2258",
        value: null,
        statusCode: "0x80340000",
        sourceTimestamp: "2026-11-03T12:00:01.000Z",
      },
    ]);
    expect(() =>
      mapOpcUaReadings(
        {
          readings: [
            {
              nodeId: "i=1",
              value: null,
              statusCode: "0x00000000",
              sourceTimestamp: "2026-11-03T12:00:00Z",
            },
          ],
        },
        { nodeIds: ["i=1"], maxNodes: 50 },
      ),
    ).toThrow(/omitted its value/i);
    expect(() =>
      mapOpcUaReadings(
        {
          readings: [
            {
              nodeId: "i=9",
              value: 1,
              statusCode: "0x00000000",
              sourceTimestamp: "2026-11-03T12:00:00Z",
            },
          ],
        },
        { nodeIds: ["i=1"], maxNodes: 50 },
      ),
    ).toThrow(/not an approved/i);
  });
});
