// HTTPS-facing read shim. The Deno edge function calls POST /v1/read.
// This handler is the only gateway route. Write and Call fields are refused
// before a socket is opened.

import { timingSafeEqual } from "node:crypto";
import {
  assertReadOnlyEnvelope,
  type OpcUaSecurityMode,
  type OpcUaSecurityPolicy,
  type OpcUaUserIdentity,
} from "../../supabase/functions/_shared/opc-ua-read.ts";
import { readOpcUaNodeValues, type OpcUaReadInput } from "./client.ts";

const ALLOWED_KEYS = new Set([
  "endpointUrl",
  "securityMode",
  "securityPolicy",
  "userIdentity",
  "nodeIds",
  "timeoutMs",
]);

export interface GatewayHttpRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

export async function handleOpcUaReadGatewayRequest(
  request: GatewayHttpRequest,
  options: { token: string; allowedServerHosts: readonly string[] },
): Promise<{ status: number; body: unknown }> {
  if (request.path !== "/v1/read") {
    return {
      status: 404,
      body: { error: "OPC-UA gateway only exposes /v1/read." },
    };
  }
  if (request.method !== "POST") {
    return {
      status: 405,
      body: { error: "OPC-UA gateway reads are POST /v1/read only." },
    };
  }
  if (!bearerMatches(request.authorization, options.token)) {
    return {
      status: 401,
      body: { error: "OPC-UA gateway token was rejected." },
    };
  }
  try {
    assertReadOnlyEnvelope(request.body);
    if (
      !request.body ||
      typeof request.body !== "object" ||
      Array.isArray(request.body)
    ) {
      throw new Error("OPC-UA gateway body must be a JSON object.");
    }
    const record = request.body as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!ALLOWED_KEYS.has(key)) {
        throw new Error("OPC-UA gateway body contains an unapproved field.");
      }
    }
    const identity = record.userIdentity;
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
      throw new Error("OPC-UA user identity is required.");
    }
    const kind = (identity as { type?: unknown }).type;
    let userIdentity: OpcUaUserIdentity;
    if (kind === "anonymous") userIdentity = { type: "anonymous" };
    else if (kind === "username") {
      const username = (identity as { username?: unknown }).username;
      const password = (identity as { password?: unknown }).password;
      if (typeof username !== "string" || typeof password !== "string") {
        throw new Error("OPC-UA username identity is incomplete.");
      }
      userIdentity = { type: "username", username, password };
    } else {
      throw new Error("OPC-UA user identity must be anonymous or username.");
    }
    if (
      !Array.isArray(record.nodeIds) ||
      record.nodeIds.some((node) => typeof node !== "string")
    ) {
      throw new Error("OPC-UA nodeIds must be an array of strings.");
    }
    const input: OpcUaReadInput = {
      endpointUrl: String(record.endpointUrl ?? ""),
      allowedHosts: options.allowedServerHosts,
      securityMode: record.securityMode as OpcUaSecurityMode,
      securityPolicy: record.securityPolicy as OpcUaSecurityPolicy,
      userIdentity,
      nodeIds: record.nodeIds as string[],
      timeoutMs: Number(record.timeoutMs),
    };
    const readings = await readOpcUaNodeValues(input);
    return { status: 200, body: { readings } };
  } catch (error) {
    return {
      status: 400,
      body: {
        error:
          error instanceof Error ? error.message : "OPC-UA read was refused.",
      },
    };
  }
}

function bearerMatches(header: string | null, expected: string): boolean {
  if (!header?.startsWith("Bearer ") || expected.length < 32) return false;
  const presented = Buffer.from(header.slice("Bearer ".length));
  const required = Buffer.from(expected);
  if (presented.length !== required.length) return false;
  return timingSafeEqual(presented, required);
}
