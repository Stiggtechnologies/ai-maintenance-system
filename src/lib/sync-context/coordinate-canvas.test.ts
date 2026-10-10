import { describe, expect, it } from "vitest";
import { canvasShape, fitCanvas, validCanvasView } from "./coordinate-canvas";
import { parseContextGeometry } from "./geometry";
const coordinate = {
  referenceSystem: "EPSG:4326",
  axisOrder: "longitude_latitude",
  basis: "Explicit synthetic WGS84 test coordinates.",
  horizontalAccuracyM: null,
};
function shape(type: string, coordinates: unknown) {
  return canvasShape(
    parseContextGeometry({ type, coordinates }, type, coordinate).geometry,
  );
}
describe("source-only geographic coordinate canvas", () => {
  it.each([
    ["Point", [0, 0], 1, 0],
    [
      "MultiPoint",
      [
        [0, 0],
        [1, 1],
      ],
      2,
      0,
    ],
    [
      "LineString",
      [
        [0, 0],
        [1, 1],
      ],
      0,
      1,
    ],
    [
      "MultiLineString",
      [
        [
          [0, 0],
          [1, 1],
        ],
        [
          [2, 2],
          [3, 3],
        ],
      ],
      0,
      2,
    ],
    [
      "Polygon",
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
      0,
      1,
    ],
    [
      "MultiPolygon",
      [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
        [
          [
            [2, 2],
            [3, 2],
            [3, 3],
            [2, 2],
          ],
        ],
      ],
      0,
      2,
    ],
  ])(
    "renders %s without centroid substitution",
    (type, coordinates, points, paths) => {
      const result = shape(type as string, coordinates);
      expect(result.points).toHaveLength(points as number);
      expect(result.paths).toHaveLength(paths as number);
      expect(result.issue).toBeNull();
    },
  );
  it("retains polygon holes as separate closed subpaths for even-odd fill", () => {
    const result = shape("Polygon", [
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 0],
      ],
      [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 1],
      ],
    ]);
    expect(result.paths[0].d.match(/M/g)).toHaveLength(2);
    expect(result.paths[0].d.match(/Z/g)).toHaveLength(2);
    expect(result.paths[0].closed).toBe(true);
  });
  it("discloses uncut antimeridian lines and refuses misleading trans-world paths", () => {
    const result = shape("LineString", [
      [179, 50],
      [-179, 50],
    ]);
    expect(result.paths).toEqual([]);
    expect(result.issue).toMatch(/antimeridian/i);
    expect(
      shape("MultiPoint", [
        [179, 50],
        [-179, 50],
      ]).points,
    ).toHaveLength(2);
  });
  it("fits finite degenerate points and poles without fake accuracy or distances", () => {
    expect(shape("Point", [0, 0]).points).toEqual([[500, 250]]);
    expect(shape("Point", [180, 90]).points).toEqual([[1000, 0]]);
    expect(validCanvasView(fitCanvas([shape("Point", [180, 90])]))).toBe(true);
    expect(fitCanvas([])).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
    expect(validCanvasView({ x: 0, y: 0, width: Infinity, height: 500 })).toBe(
      false,
    );
    expect(validCanvasView({ x: 0, y: 0, width: 0, height: 0 })).toBe(false);
  });
});
