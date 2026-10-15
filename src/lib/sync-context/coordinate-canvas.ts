import type { ContextGeometry, ContextPosition } from "./geometry";
export interface CanvasView {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CanvasShape {
  points: [number, number][];
  paths: { d: string; closed: boolean }[];
  bounds: [number, number, number, number] | null;
  issue: string | null;
}
export const WORLD_CANVAS: CanvasView = {
  x: 0,
  y: 0,
  width: 1000,
  height: 500,
};
export function validCanvasView(v: CanvasView): boolean {
  return (
    Object.values(v).every(Number.isFinite) &&
    v.width >= 0.001 &&
    v.width <= 2000 &&
    v.height >= 0.0005 &&
    v.height <= 1000 &&
    Math.abs(v.x) <= 2000 &&
    Math.abs(v.y) <= 1000 &&
    Math.abs(v.width / v.height - 2) < 0.001
  );
}
/** Equirectangular DISPLAY only. Never an area, distance or safety calculation. */
export function canvasShape(geometry: ContextGeometry): CanvasShape {
  const result: CanvasShape = {
    points: [],
    paths: [],
    bounds: null,
    issue: null,
  };
  const positions: [number, number][] = [];
  const project = (p: ContextPosition): [number, number] => {
    const xy: [number, number] = [
      ((p[0] + 180) / 360) * 1000,
      ((90 - p[1]) / 180) * 500,
    ];
    positions.push(xy);
    return xy;
  };
  const path = (
    parts: readonly (readonly ContextPosition[])[],
    closed: boolean,
  ) => {
    if (
      parts.some((line) =>
        line.some((p, i) => i > 0 && Math.abs(p[0] - line[i - 1][0]) > 180),
      )
    ) {
      result.issue =
        "Uncut antimeridian geometry is not drawn. Review/split canonical source geometry; no wrap or route was inferred.";
      return;
    }
    result.paths.push({
      closed,
      d: parts
        .map(
          (line) =>
            line
              .map((p, i) => `${i === 0 ? "M" : "L"}${project(p).join(",")}`)
              .join(" ") + (closed ? " Z" : ""),
        )
        .join(" "),
    });
  };
  switch (geometry.type) {
    case "Point":
      result.points.push(project(geometry.coordinates));
      break;
    case "MultiPoint":
      result.points.push(...geometry.coordinates.map(project));
      break;
    case "LineString":
      path([geometry.coordinates], false);
      break;
    case "MultiLineString":
      geometry.coordinates.forEach((line) => path([line], false));
      break;
    case "Polygon":
      path(geometry.coordinates, true);
      break;
    case "MultiPolygon":
      geometry.coordinates.forEach((polygon) => path(polygon, true));
      break;
  }
  // Refuse the WHOLE ambiguous shape rather than quietly drawing safe pieces.
  if (result.issue) {
    result.paths = [];
    result.points = [];
    return result;
  }
  if (positions.length)
    result.bounds = [
      Math.min(...positions.map((p) => p[0])),
      Math.min(...positions.map((p) => p[1])),
      Math.max(...positions.map((p) => p[0])),
      Math.max(...positions.map((p) => p[1])),
    ];
  return result;
}
export function fitCanvas(shapes: CanvasShape[]): CanvasView {
  const bounds = shapes.flatMap((s) => (s.bounds ? [s.bounds] : []));
  if (!bounds.length) return { ...WORLD_CANVAS };
  const left = Math.min(...bounds.map((b) => b[0])),
    top = Math.min(...bounds.map((b) => b[1]));
  const right = Math.max(...bounds.map((b) => b[2])),
    bottom = Math.max(...bounds.map((b) => b[3]));
  // Padding/minimum extent are display units, NOT accuracy or engineering range.
  const width = Math.min(
    2000,
    Math.max(0.01, (right - left) * 1.2, (bottom - top) * 2.4),
  );
  return {
    x: (left + right - width) / 2,
    y: (top + bottom - width / 2) / 2,
    width,
    height: width / 2,
  };
}
