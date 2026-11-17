import { describe, expect, it } from "vitest";
import { parseContextGeometry } from "./geometry";

const coordinate = {
  referenceSystem: "EPSG:4326",
  axisOrder: "longitude_latitude",
  basis: "Customer GIS export with independently reviewed survey provenance.",
  horizontalAccuracyM: null,
};
const p = [-111.38, 56.73];
const q = [-111.37, 56.73];
const r = [-111.37, 56.74];
const ring = [p, q, r, p];

function parse(
  type: string,
  coordinates: unknown,
  reference: unknown = coordinate,
) {
  return parseContextGeometry({ type, coordinates }, type, reference);
}

describe("SC-02 explicit source-coordinate rendering contract", () => {
  it.each([
    ["Point", p],
    ["MultiPoint", [p, q]],
    ["LineString", [p, q]],
    [
      "MultiLineString",
      [
        [p, q],
        [q, r],
      ],
    ],
    ["Polygon", [ring]],
    ["MultiPolygon", [[ring], [ring]]],
  ])(
    "accepts source-supplied %s without changing coordinates",
    (type, coordinates) => {
      const result = parse(type as string, coordinates);
      expect(result.geometry).toEqual({ type, coordinates });
      expect(result.coordinate).toEqual(coordinate);
      expect(result.coordinate.horizontalAccuracyM).toBeNull();
    },
  );

  it("copies validated coordinates so caller mutation cannot change the rendered proof", () => {
    const input = [...p];
    const reference = { ...coordinate, horizontalAccuracyM: 2.5 };
    const result = parse("Point", input, reference);
    input[0] = 0;
    reference.horizontalAccuracyM = 0;
    expect(result.geometry.coordinates).toEqual(p);
    expect(result.coordinate.horizontalAccuracyM).toBe(2.5);
  });

  it("retains optional source-supplied altitude without fabricating one", () => {
    expect(parse("Point", [...p, 301.2]).geometry.coordinates).toEqual([
      ...p,
      301.2,
    ]);
    expect(parse("Point", p).geometry.coordinates).toHaveLength(2);
  });

  it.each([
    null,
    undefined,
    {},
    { ...coordinate, referenceSystem: "EPSG:3857" },
    { ...coordinate, referenceSystem: "unknown" },
    { ...coordinate, axisOrder: "latitude_longitude" },
    { ...coordinate, axisOrder: undefined },
    { ...coordinate, basis: "" },
    { ...coordinate, basis: "assumed" },
    { ...coordinate, horizontalAccuracyM: undefined },
    { ...coordinate, horizontalAccuracyM: "2.5" },
    { ...coordinate, horizontalAccuracyM: 0 },
    { ...coordinate, horizontalAccuracyM: -1 },
    { ...coordinate, horizontalAccuracyM: Number.NaN },
    { ...coordinate, horizontalAccuracyM: Number.POSITIVE_INFINITY },
  ])(
    "refuses missing, assumed or malformed coordinate provenance (%j)",
    (reference) => {
      expect(() =>
        parseContextGeometry(
          { type: "Point", coordinates: p },
          "Point",
          reference,
        ),
      ).toThrow();
    },
  );

  it.each([
    ["Point", []],
    ["Point", [1]],
    ["Point", ["-111.38", 56.73]],
    ["Point", [Number.NaN, 56]],
    ["Point", [Number.POSITIVE_INFINITY, 56]],
    ["Point", [-181, 56]],
    ["Point", [181, 56]],
    ["Point", [-111, -91]],
    ["Point", [-111, 91]],
    ["Point", [-111, 56, Number.NEGATIVE_INFINITY]],
    ["Point", [-111, 56, 1, 2]],
    ["Point", [p]],
    ["MultiPoint", []],
    ["MultiPoint", [p, []]],
    ["LineString", [p]],
    ["MultiLineString", []],
    ["MultiLineString", [[p, q], []]],
    ["Polygon", []],
    ["Polygon", [[p, q, p]]],
    ["Polygon", [[p, q, r, q]]],
    ["Polygon", [ring, [p, q, r, q]]],
    ["MultiPolygon", []],
    ["MultiPolygon", [[ring], []]],
    ["GeometryCollection", [p]],
    ["invented", p],
  ])(
    "refuses malformed %s without substituting a marker",
    (type, coordinates) => {
      expect(() => parse(type as string, coordinates)).toThrow();
    },
  );

  it("requires a closed ring to agree in every supplied dimension", () => {
    expect(() =>
      parse("Polygon", [
        [
          [...p, 1],
          [...q, 1],
          [...r, 1],
          [...p, 2],
        ],
      ]),
    ).toThrow(/closed/i);
  });

  it("accepts boundary coordinates as supplied, without clamping or swapping", () => {
    expect(
      parse("MultiPoint", [
        [-180, -90],
        [180, 90],
      ]).geometry.coordinates,
    ).toEqual([
      [-180, -90],
      [180, 90],
    ]);
  });

  it.each([
    null,
    [],
    { type: "LineString", coordinates: [p, q] },
    { type: "Point", coordinates: p, crs: { name: "EPSG:3857" } },
  ])(
    "refuses malformed geometry, type mismatch and conflicting legacy CRS (%j)",
    (geometry) => {
      expect(() =>
        parseContextGeometry(geometry, "Point", coordinate),
      ).toThrow();
    },
  );

  it("bounds total positions before rendering large source payloads", () => {
    expect(() =>
      parse(
        "MultiPoint",
        Array.from({ length: 10_001 }, () => p),
      ),
    ).toThrow(/limit/i);
  });

  it.each([
    ["Point", new Array(2)],
    ["MultiPoint", new Array(10_000)],
    ["LineString", [p, ...new Array(1)]],
    ["Polygon", [new Array(4)]],
  ])("rejects sparse %s coordinate arrays", (type, coordinates) => {
    expect(() => parse(type as string, coordinates)).toThrow();
  });

  it("bounds cumulative positions across individually bounded containers", () => {
    const line = Array.from({ length: 5000 }, () => p);
    expect(
      parse("MultiLineString", [line, line]).geometry.coordinates,
    ).toHaveLength(2);
    expect(() => parse("MultiLineString", [line, line, [p, q]])).toThrow(
      /limit/i,
    );
  });

  it("keeps the validated output immutable as well as independent of the input", () => {
    const result = parse("Polygon", [ring]);
    const coordinates = result.geometry.coordinates as unknown as unknown[][][];
    expect(Reflect.set(coordinates[0][0], 0, 999)).toBe(false);
    expect(Reflect.set(coordinates[0], 0, [999, 2])).toBe(false);
    expect(Reflect.set(coordinates, 0, [[999, 2]])).toBe(false);
    expect(Reflect.set(result.coordinate, "basis", "invented")).toBe(false);
    expect(Reflect.set(result.geometry, "type", "Point")).toBe(false);
  });

  it("bounds a source's asserted coordinate-basis description", () => {
    expect(() =>
      parse("Point", p, { ...coordinate, basis: "x".repeat(4001) }),
    ).toThrow();
  });
});
