import { useId, useRef } from "react";
import type { OperatingSpatialObject } from "../../lib/sync-context/operating-picture";
import {
  canvasShape,
  fitCanvas,
  validCanvasView,
  WORLD_CANVAS,
  type CanvasView,
} from "../../lib/sync-context/coordinate-canvas";

export function ContextCoordinateCanvas({
  objects,
  selectedId,
  onSelect,
  viewport,
  onViewport,
}: {
  objects: OperatingSpatialObject[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  viewport: CanvasView | null;
  onViewport: (v: CanvasView) => void;
}) {
  const shapes = objects.map((object) => ({
    object,
    shape: canvasShape(object.geometry),
  }));
  const view =
    viewport && validCanvasView(viewport)
      ? viewport
      : fitCanvas(shapes.map((s) => s.shape));
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    view: CanvasView;
    moved: boolean;
  } | null>(null);
  const descriptionId = useId();
  const suppressClick = useRef(false);
  const change = (next: CanvasView) => {
    if (validCanvasView(next)) onViewport(next);
  };
  const zoom = (factor: number) =>
    change({
      x: view.x + (view.width * (1 - factor)) / 2,
      y: view.y + (view.height * (1 - factor)) / 2,
      width: view.width * factor,
      height: view.height * factor,
    });
  const pan = (x: number, y: number) =>
    change({
      ...view,
      x: view.x + x * view.width,
      y: view.y + y * view.height,
    });
  return (
    <section
      className="context-canvas-panel"
      aria-label="Geographic coordinate canvas"
    >
      <div className="context-canvas-tools">
        <span>EPSG:4326 · north ↑</span>
        <div>
          <button onClick={() => zoom(0.5)} aria-label="Zoom in">
            +
          </button>
          <button onClick={() => zoom(2)} aria-label="Zoom out">
            −
          </button>
          <button
            onClick={() => onViewport(fitCanvas(shapes.map((s) => s.shape)))}
          >
            Fit returned shapes
          </button>
          <button onClick={() => onViewport({ ...WORLD_CANVAS })}>World</button>
        </div>
      </div>
      <svg
        ref={svg}
        role="group"
        aria-label="Authorized source geometry"
        aria-describedby={descriptionId}
        tabIndex={0}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        preserveAspectRatio="xMidYMid meet"
        onKeyDown={(event) => {
          if (event.target !== svg.current) return;
          const moves: Record<string, [number, number]> = {
            ArrowLeft: [-0.1, 0],
            ArrowRight: [0.1, 0],
            ArrowUp: [0, -0.1],
            ArrowDown: [0, 0.1],
          };
          if (moves[event.key]) {
            event.preventDefault();
            pan(...moves[event.key]);
          }
          if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            zoom(0.5);
          }
          if (event.key === "-") {
            event.preventDefault();
            zoom(2);
          }
        }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          suppressClick.current = false;
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            view,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current,
            rect = svg.current?.getBoundingClientRect();
          if (
            !start ||
            start.id !== event.pointerId ||
            !rect?.width ||
            !rect.height
          )
            return;
          // A short tap on geometry selects it. A drag pans without selecting.
          if (
            !start.moved &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4
          )
            return;
          if (!start.moved) {
            start.moved = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          const scale = Math.min(
            rect.width / start.view.width,
            rect.height / start.view.height,
          );
          change({
            ...start.view,
            x: start.view.x - (event.clientX - start.x) / scale,
            y: start.view.y - (event.clientY - start.y) / scale,
          });
        }}
        onPointerUp={() => {
          suppressClick.current = !!drag.current?.moved;
          drag.current = null;
        }}
        onPointerCancel={() => {
          suppressClick.current = false;
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <g
          className="context-graticule"
          aria-hidden="true"
          pointerEvents="none"
        >
          {[-180, -120, -60, 0, 60, 120, 180].map((lon) => (
            <line
              key={`lon${lon}`}
              x1={((lon + 180) / 360) * 1000}
              x2={((lon + 180) / 360) * 1000}
              y1={0}
              y2={500}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {[-90, -60, -30, 0, 30, 60, 90].map((lat) => (
            <line
              key={`lat${lat}`}
              x1={0}
              x2={1000}
              y1={((90 - lat) / 180) * 500}
              y2={((90 - lat) / 180) * 500}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        {shapes
          .filter((s) => !s.shape.issue)
          .map(({ object, shape }) => (
            <g
              key={object.id}
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${object.name}`}
              aria-pressed={selectedId === object.id}
              className={`context-shape ${object.layerId === "hazards_geofences" ? "context-hazard" : ""} ${object.display.demoOnly ? "context-demo" : ""} ${object.display.degraded ? "context-degraded" : ""} ${selectedId === object.id ? "is-selected" : ""}`}
              onClick={() => onSelect(object.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(object.id);
                }
              }}
            >
              <title>
                {object.name} · {object.source.class.replaceAll("_", " ")} ·{" "}
                {object.source.healthState}
              </title>
              {shape.paths.map((p, i) => (
                <path
                  key={i}
                  d={p.d}
                  fillRule="evenodd"
                  fill={p.closed ? undefined : "none"}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {shape.points.map(([x, y], i) => (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={view.width / 100}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          ))}
      </svg>
      <p role="status">
        {shapes.filter((s) => !s.shape.issue).length} drawn shapes ·{" "}
        {shapes.filter((s) => s.shape.issue).length} refused shapes. All
        matching objects remain in the list.
      </p>
      <p id={descriptionId}>
        EPSG:4326 coordinate canvas — no basemap or survey certification. Drag
        to pan; keyboard arrows and +/− zoom. Shape size/padding is visual, not
        accuracy. Altitude, distances and safe routes are not inferred.
      </p>
      {shapes
        .filter((s) => s.shape.issue)
        .map((s) => (
          <p className="context-warning" key={s.object.id}>
            {s.object.name}: {s.shape.issue} Object remains available in the
            list.
          </p>
        ))}
    </section>
  );
}
