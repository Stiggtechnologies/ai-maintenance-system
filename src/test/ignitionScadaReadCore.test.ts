// @vitest-environment node
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { describe, expect, it } from "vitest";
import {
  ignitionTagReadUrl,
  mapIgnitionTagReads,
  normalizeIgnitionPullRequest,
  parseIgnitionQualifiedValue,
  readIgnitionTagSnapshot,
} from "../../supabase/functions/_shared/ignition-scada-read";

const PATHS = ["[default]Plant/Temperature", "[default]Plant/Running"];
const SECRET = "Basic dXNlcjpzdXBlcnNlY3JldHBhc3N3b3Jk";

function qualified(
  path: string,
  value: string | number | boolean | null,
  quality = "Good",
) {
  return {
    path,
    value,
    quality,
    timestamp: "2020-01-15T12:00:00Z",
  };
}

async function withMock(
  onRequest: (request: IncomingMessage, response: ServerResponse) => void,
  run: (
    port: number,
    seen: { methods: string[]; urls: string[]; authorization: string[] },
  ) => Promise<void>,
) {
  const seen = {
    methods: [] as string[],
    urls: [] as string[],
    authorization: [] as string[],
  };
  const server = createServer((request, response) => {
    seen.methods.push(request.method ?? "");
    seen.urls.push(request.url ?? "");
    seen.authorization.push(request.headers.authorization ?? "");
    onRequest(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("mock port missing");
  try {
    await run(address.port, seen);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  const raw = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(raw),
  });
  response.end(raw);
}

describe("Ignition SCADA tag reader", () => {
  it("normalizes a bounded pull and defaults to dry run", () => {
    expect(
      normalizeIgnitionPullRequest({
        connector_key: " north-ignition ",
        dry_run: false,
      }),
    ).toEqual({ connectorKey: "north-ignition", dryRun: false });
    expect(
      normalizeIgnitionPullRequest({ connector_key: "north-ignition" }),
    ).toEqual({
      connectorKey: "north-ignition",
      dryRun: true,
    });
    expect(() => normalizeIgnitionPullRequest(null)).toThrow(/JSON object/);
    expect(() =>
      normalizeIgnitionPullRequest({
        connector_key: "north-ignition",
        dry_run: "false",
      }),
    ).toThrow(/true or false/);
  });

  it("builds one GET query for the approved tag and nothing else", () => {
    const resource = new URL(
      "https://gateway.example.com/system/webdev/Plant/tags/read",
    );
    const url = ignitionTagReadUrl(resource, PATHS[0]);
    expect(url.pathname).toBe("/system/webdev/Plant/tags/read");
    expect(url.searchParams.get("tagPath")).toBe(PATHS[0]);
    expect([...url.searchParams.keys()]).toEqual(["tagPath"]);
    expect(() =>
      ignitionTagReadUrl(
        new URL("https://gateway.example.com/system/webdev/Plant/writeTags"),
        PATHS[0],
      ),
    ).toThrow(/write/);
  });

  it("reads path, value, quality and timestamp from a mock Ignition server", async () => {
    await withMock(
      (request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const tagPath = url.searchParams.get("tagPath");
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "method" });
          return;
        }
        if (tagPath === PATHS[0]) {
          sendJson(response, 200, qualified(PATHS[0], 72.5));
          return;
        }
        if (tagPath === PATHS[1]) {
          sendJson(response, 200, qualified(PATHS[1], false, "Bad"));
          return;
        }
        sendJson(response, 404, { error: "missing" });
      },
      async (port, seen) => {
        const result = await readIgnitionTagSnapshot({
          resource: `http://127.0.0.1:${port}/system/webdev/Plant/tags/read`,
          tagPaths: PATHS,
          authorization: SECRET,
          direction: "read_only",
          writeEnabled: false,
          allowLoopback: true,
        });
        expect(seen.methods).toEqual(["GET", "GET"]);
        expect(seen.authorization).toEqual([SECRET, SECRET]);
        expect(mapIgnitionTagReads(result.readings, PATHS)).toEqual([
          {
            external_id: PATHS[0],
            path: PATHS[0],
            value: 72.5,
            quality: "Good",
            timestamp: "2020-01-15T12:00:00Z",
          },
          {
            external_id: PATHS[1],
            path: PATHS[1],
            value: false,
            quality: "Bad",
            timestamp: "2020-01-15T12:00:00Z",
          },
        ]);
        expect(result.manifest).toHaveLength(2);
        expect(result.manifest[0]).toMatchObject({
          transport: "ignition_webdev_get",
          resource: "system.tag.readBlocking",
          tag_path: PATHS[0],
        });
      },
    );
  });

  it("refuses a write-enabled source before any request reaches the mock", async () => {
    await withMock(
      (_request, response) => {
        sendJson(response, 200, qualified(PATHS[0], 1));
      },
      async (port, seen) => {
        await expect(
          readIgnitionTagSnapshot({
            resource: `http://127.0.0.1:${port}/system/webdev/Plant/tags/read`,
            tagPaths: [PATHS[0]],
            authorization: SECRET,
            direction: "read_only",
            writeEnabled: true,
            allowLoopback: true,
          }),
        ).rejects.toThrow(/read-only/);
        expect(seen.methods).toEqual([]);
      },
    );
  });

  it("refuses loopback unless the test explicitly allows the mock", async () => {
    await withMock(
      (_request, response) => {
        sendJson(response, 200, qualified(PATHS[0], 1));
      },
      async (port, seen) => {
        await expect(
          readIgnitionTagSnapshot({
            resource: `http://127.0.0.1:${port}/system/webdev/Plant/tags/read`,
            tagPaths: [PATHS[0]],
            authorization: SECRET,
            direction: "read_only",
            writeEnabled: false,
          }),
        ).rejects.toThrow(/public HTTPS/);
        expect(seen.methods).toEqual([]);
      },
    );
  });

  it("refuses a path escape, a write acknowledgement and a secret in the error", async () => {
    await withMock(
      (request, response) => {
        const tagPath = new URL(
          request.url ?? "/",
          "http://127.0.0.1",
        ).searchParams.get("tagPath");
        if (tagPath === PATHS[0]) {
          sendJson(response, 200, { ...qualified(PATHS[0], 1), written: true });
          return;
        }
        response.writeHead(401, { "content-type": "text/plain" });
        response.end("supersecretpassword");
      },
      async (port) => {
        await expect(
          readIgnitionTagSnapshot({
            resource: `http://127.0.0.1:${port}/system/webdev/Plant/tags/read`,
            tagPaths: [PATHS[0]],
            authorization: SECRET,
            direction: "read_only",
            writeEnabled: false,
            allowLoopback: true,
          }),
        ).rejects.toThrow(/outside path, value, quality and timestamp/);
        await expect(
          readIgnitionTagSnapshot({
            resource: `http://127.0.0.1:${port}/system/webdev/Plant/tags/read`,
            tagPaths: [PATHS[1]],
            authorization: SECRET,
            direction: "read_only",
            writeEnabled: false,
            allowLoopback: true,
          }),
        ).rejects.toThrow(/application\/json/);
        await expect(
          readIgnitionTagSnapshot({
            resource: `http://127.0.0.1:${port}/system/webdev/Plant/tags/read`,
            tagPaths: [PATHS[1]],
            authorization: SECRET,
            direction: "read_only",
            writeEnabled: false,
            allowLoopback: true,
          }),
        ).rejects.toThrow(/^(?!.*supersecretpassword)/);
      },
    );
  });

  it("refuses a qualified value that leaves the approved tag or is not scalar", () => {
    expect(() =>
      parseIgnitionQualifiedValue(
        { ...qualified("[default]Other/Tag", 1) },
        PATHS[0],
      ),
    ).toThrow(/escaped/);
    expect(() =>
      parseIgnitionQualifiedValue(
        {
          path: PATHS[0],
          value: { setpoint: 1 },
          quality: "Good",
          timestamp: "2020-01-15T12:00:00Z",
        },
        PATHS[0],
      ),
    ).toThrow(/string, number, boolean or null/);
    expect(
      parseIgnitionQualifiedValue(
        {
          path: PATHS[0],
          value: null,
          quality: "Bad",
          timestamp: "2020-01-15T12:00:00Z",
        },
        PATHS[0],
      ).value,
    ).toBeNull();
  });
});
