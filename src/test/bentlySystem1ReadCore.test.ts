import { describe, expect, it } from "vitest";
import {
  mapSystem1Readings,
  readSystem1GatewayPage,
  system1GatewayUrl,
} from "../../supabase/functions/_shared/bently-system1-condition-read";
import { parseSystem1NodeBindings } from "../services/bentlySystem1Read";

const sensorId = "11111111-1111-4111-8111-111111111111";

describe("Bently System 1 bounded gateway core", () => {
  it("builds only the fixed read endpoint and bounded cursor query", () => {
    const url = system1GatewayUrl(
      new URL("https://gateway.example.com/syncai/v1/system1/readings"),
      "2026-10-03T12:00:00Z",
      500,
      "opaque-cursor",
    );
    expect(url.pathname).toBe("/syncai/v1/system1/readings");
    expect(url.searchParams.get("limit")).toBe("500");
    expect(url.searchParams.get("after")).toBe("2026-10-03T12:00:00.000Z");
    expect(url.searchParams.get("cursor")).toBe("opaque-cursor");
    expect(() =>
      system1GatewayUrl(
        new URL("http://gateway.example.com/syncai/v1/system1/readings"),
        null,
        10,
        null,
      ),
    ).toThrow(/HTTPS/i);
  });

  it("requires a coherent bounded page envelope", () => {
    expect(
      readSystem1GatewayPage(
        { items: [{ sampleId: "1" }], nextCursor: "next", complete: false },
        10,
      ),
    ).toEqual({
      items: [{ sampleId: "1" }],
      nextCursor: "next",
      complete: false,
    });
    expect(() =>
      readSystem1GatewayPage(
        { items: [], nextCursor: "next", complete: true },
        10,
      ),
    ).toThrow(/cursor only for an incomplete page/i);
    expect(() =>
      readSystem1GatewayPage(
        { items: [], nextCursor: null, complete: false },
        10,
      ),
    ).toThrow(/cursor only for an incomplete page/i);
  });

  it("maps only approved nodes, units, quality and exact values", () => {
    const result = mapSystem1Readings(
      [
        {
          sampleId: "sample-1",
          nodeId: "ns=2;s=P101/DE/Vibration",
          value: "4.125",
          timestamp: "2026-10-03T12:05:00Z",
          quality: "Good",
          unit: "mm/s",
        },
        {
          sampleId: "sample-2",
          nodeId: "ns=2;s=P101/DE/Vibration",
          value: "4.500",
          timestamp: "2026-10-03T12:06:00Z",
          quality: "Uncertain",
          unit: "mm/s",
        },
      ],
      {
        bindings: [
          {
            nodeId: "ns=2;s=P101/DE/Vibration",
            sensorId,
            unit: "mm/s",
          },
        ],
        watermarkFrom: "2026-10-03T12:00:00Z",
        fetchedAt: "2026-10-03T12:07:00Z",
        maxRows: 10,
      },
    );
    expect(result.rows).toEqual([
      {
        external_id: "system1:sample-1",
        sensor_id: sensorId,
        value: "4.125",
        taken_at: "2026-10-03T12:05:00.000Z",
        quality: "good",
      },
      {
        external_id: "system1:sample-2",
        sensor_id: sensorId,
        value: "4.500",
        taken_at: "2026-10-03T12:06:00.000Z",
        quality: "suspect",
      },
    ]);
    expect(result.maxTakenAt).toBe("2026-10-03T12:06:00.000Z");
  });

  it("fails closed on scope, unit, replay-window and precision escapes", () => {
    const scope = {
      bindings: [
        {
          nodeId: "ns=2;s=P101/DE/Vibration",
          sensorId,
          unit: "mm/s",
        },
      ],
      watermarkFrom: "2026-10-03T12:00:00Z",
      fetchedAt: "2026-10-03T12:07:00Z",
      maxRows: 10,
    };
    const sample = {
      sampleId: "sample-1",
      nodeId: "ns=2;s=P101/DE/Vibration",
      value: "4.125",
      timestamp: "2026-10-03T12:05:00Z",
      quality: "Good",
      unit: "mm/s",
    };
    expect(() =>
      mapSystem1Readings([{ ...sample, nodeId: "ns=2;s=unapproved" }], scope),
    ).toThrow(/not administrator-approved/i);
    expect(() =>
      mapSystem1Readings([{ ...sample, unit: "in/s" }], scope),
    ).toThrow(/does not match canonical/i);
    expect(() =>
      mapSystem1Readings(
        [{ ...sample, timestamp: "2026-10-03T12:00:00Z" }],
        scope,
      ),
    ).toThrow(/does not advance/i);
    expect(() => mapSystem1Readings([{ ...sample, value: 4.125 }], scope)).toThrow(
      /exact decimal string/i,
    );
    expect(() => mapSystem1Readings([], scope)).toThrow(/empty complete snapshot/i);
  });

  it("parses the human-visible binding format without guessing", () => {
    expect(
      parseSystem1NodeBindings(
        `ns=2;s=P101/DE/Vibration | ${sensorId} | mm/s`,
      ),
    ).toEqual([
      { nodeId: "ns=2;s=P101/DE/Vibration", sensorId, unit: "mm/s" },
    ]);
    expect(() => parseSystem1NodeBindings("node|sensor")).toThrow(/must be/i);
    expect(() =>
      parseSystem1NodeBindings(`node-a|${sensorId}|mm/s\nnode-b|${sensorId}|mm/s`),
    ).toThrow(/more than once/i);
  });
});
