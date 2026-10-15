/**
 * SC-02 renderer input boundary, not a coordinate survey or authorization gate.
 * GeoJSON position/line/ring structure follows RFC 7946 sections 3.1 and 4.
 * Source geometry must explicitly declare WGS84 and GeoJSON longitude/latitude
 * order; legacy rows are not assigned a CRS, accuracy or location by inference.
 * The operating-picture RPC must independently enforce the same contract plus
 * tenant, source rights/health, evidence, validity and canonical-link gates.
 * A source's descriptive basis is asserted metadata, not authenticated proof.
 * This structural check does not certify polygon topology, survey suitability,
 * non-degeneracy, winding or containment for engineering/safety calculations.
 */
export const CONTEXT_GEOMETRY_POSITION_LIMIT = 10_000;

export interface ContextCoordinateReference {
  readonly referenceSystem: "EPSG:4326";
  readonly axisOrder: "longitude_latitude";
  readonly basis: string;
  readonly horizontalAccuracyM: number | null;
}

export type ContextPosition =
  readonly [number, number] | readonly [number, number, number];
export type ContextGeometry =
  | { readonly type: "Point"; readonly coordinates: ContextPosition }
  | {
      readonly type: "MultiPoint" | "LineString";
      readonly coordinates: readonly ContextPosition[];
    }
  | {
      readonly type: "MultiLineString" | "Polygon";
      readonly coordinates: readonly (readonly ContextPosition[])[];
    }
  | {
      readonly type: "MultiPolygon";
      readonly coordinates: readonly (readonly (readonly ContextPosition[])[])[];
    };

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Missing or malformed Context ${label}.`);
  }
  return value as Record<string, unknown>;
}

function coordinateReference(value: unknown): ContextCoordinateReference {
  const reference = object(value, "coordinate provenance");
  if (
    reference.referenceSystem !== "EPSG:4326" ||
    reference.axisOrder !== "longitude_latitude"
  ) {
    throw new Error(
      "Context geometry requires explicit WGS84 longitude/latitude provenance; no coordinate conversion was assumed.",
    );
  }
  if (
    typeof reference.basis !== "string" ||
    reference.basis.trim().length < 20 ||
    reference.basis.length > 4000
  ) {
    throw new Error(
      "Context geometry requires a source-coordinate basis description of 20–4000 characters.",
    );
  }
  const accuracy = reference.horizontalAccuracyM;
  if (
    accuracy !== null &&
    (typeof accuracy !== "number" ||
      !Number.isFinite(accuracy) ||
      accuracy <= 0)
  ) {
    throw new Error(
      "Coordinate accuracy must be supplied as positive finite metres or explicitly unknown (null).",
    );
  }
  return Object.freeze({
    referenceSystem: "EPSG:4326",
    axisOrder: "longitude_latitude",
    basis: reference.basis,
    horizontalAccuracyM: accuracy,
  });
}

export function parseContextGeometry(
  value: unknown,
  declaredType: string,
  coordinate: unknown,
): { geometry: ContextGeometry; coordinate: ContextCoordinateReference } {
  const reference = coordinateReference(coordinate);
  const raw = object(value, "geometry");
  if (raw.type !== declaredType || "crs" in raw) {
    throw new Error(
      "Context geometry type or legacy CRS conflicts with the explicit coordinate contract.",
    );
  }
  let positions = 0;
  function position(value: unknown): ContextPosition {
    if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) {
      throw new Error(
        "Context geometry requires finite numeric two- or three-dimensional positions.",
      );
    }
    for (let index = 0; index < value.length; index++) {
      if (
        !Object.hasOwn(value, index) ||
        typeof value[index] !== "number" ||
        !Number.isFinite(value[index])
      ) {
        throw new Error(
          "Context positions must contain only finite numeric own elements; sparse arrays are refused.",
        );
      }
    }
    if (value[0] < -180 || value[0] > 180 || value[1] < -90 || value[1] > 90) {
      throw new Error(
        "Context longitude/latitude lies outside WGS84 bounds; no clamping or swapping was performed.",
      );
    }
    if (++positions > CONTEXT_GEOMETRY_POSITION_LIMIT) {
      throw new Error("Context geometry exceeds the renderer position limit.");
    }
    return value.length === 2
      ? Object.freeze([value[0], value[1]] as const)
      : Object.freeze([value[0], value[1], value[2]] as const);
  }
  function sequence<T>(
    value: unknown,
    minimum: number,
    parse: (value: unknown) => T,
  ): readonly T[] {
    if (
      !Array.isArray(value) ||
      value.length < minimum ||
      value.length > CONTEXT_GEOMETRY_POSITION_LIMIT
    ) {
      throw new Error(
        "Context geometry has an empty, undersized or over-limit coordinate structure.",
      );
    }
    const result: T[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index))
        throw new Error("Sparse Context coordinate structures are refused.");
      result.push(parse(value[index]));
    }
    return Object.freeze(result);
  }
  const line = (value: unknown) => sequence(value, 2, position);
  function ring(value: unknown): readonly ContextPosition[] {
    const result = sequence(value, 4, position);
    const first = result[0];
    const last = result[result.length - 1];
    if (
      first.length !== last.length ||
      first.some((component, index) => component !== last[index])
    ) {
      throw new Error(
        "Context polygon rings must be closed in all supplied dimensions.",
      );
    }
    return result;
  }
  const polygon = (value: unknown) => sequence(value, 1, ring);
  let geometry: ContextGeometry;
  switch (raw.type) {
    case "Point":
      geometry = { type: raw.type, coordinates: position(raw.coordinates) };
      break;
    case "MultiPoint":
      geometry = {
        type: raw.type,
        coordinates: sequence(raw.coordinates, 1, position),
      };
      break;
    case "LineString":
      geometry = { type: raw.type, coordinates: line(raw.coordinates) };
      break;
    case "MultiLineString":
      geometry = {
        type: raw.type,
        coordinates: sequence(raw.coordinates, 1, line),
      };
      break;
    case "Polygon":
      geometry = { type: raw.type, coordinates: polygon(raw.coordinates) };
      break;
    case "MultiPolygon":
      geometry = {
        type: raw.type,
        coordinates: sequence(raw.coordinates, 1, polygon),
      };
      break;
    default:
      throw new Error(
        "Unsupported Context geometry; no default marker was substituted.",
      );
  }
  return Object.freeze({
    geometry: Object.freeze(geometry),
    coordinate: reference,
  });
}
