/**
 * OperationsLattice — the live "operations field" backdrop.
 *
 * A canvas rendering of what the platform actually is: a lattice of assets
 * (nodes) connected by dependency edges, with telemetry pulses travelling the
 * network and the occasional node escalating to a gold alert state. It is the
 * investor-deck wireframe-over-night-operations image, alive.
 *
 * Deliberate constraints — this is a backdrop, not a toy:
 *  - Devicepixel-aware, capped at 2x, and sized to its container.
 *  - Fully pauses when the tab is hidden (no background CPU burn).
 *  - Honors prefers-reduced-motion: renders one static frame, no animation.
 *  - Node count scales down on small viewports.
 */
import { useEffect, useRef } from "react";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alert: number; // 0 = nominal (cyan), 1 = escalated (gold)
  phase: number;
}

interface Pulse {
  from: number;
  to: number;
  t: number;
  speed: number;
}

interface OperationsLatticeProps {
  /** Visual density. "field" for hero backdrops, "panel" for smaller inlays. */
  density?: "field" | "panel";
  className?: string;
}

export function OperationsLattice({
  density = "field",
  className = "",
}: OperationsLatticeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let width = 0;
    let height = 0;
    let nodes: Node[] = [];
    let pulses: Pulse[] = [];
    let raf = 0;
    let running = true;

    const LINK_DISTANCE = density === "field" ? 190 : 140;

    const seed = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const areaPer = density === "field" ? 26000 : 18000;
      const count = Math.max(
        10,
        Math.min(48, Math.round((width * height) / areaPer)),
      );
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        r: 1.1 + Math.random() * 1.9,
        alert: Math.random() < 0.12 ? 1 : 0,
        phase: Math.random() * Math.PI * 2,
      }));
      pulses = [];
    };

    const spawnPulse = () => {
      if (nodes.length < 2 || pulses.length > 14) return;
      const from = Math.floor(Math.random() * nodes.length);
      // Prefer a genuine neighbour so pulses travel drawn edges.
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        if (i === from) continue;
        const d = Math.hypot(
          nodes[i].x - nodes[from].x,
          nodes[i].y - nodes[from].y,
        );
        if (d < LINK_DISTANCE && d < bestD && Math.random() < 0.6) {
          bestD = d;
          best = i;
        }
      }
      if (best === -1) return;
      pulses.push({
        from,
        to: best,
        t: 0,
        speed: 0.006 + Math.random() * 0.012,
      });
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);

      // Edges — dependency lattice; opacity falls off with distance.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const d = Math.hypot(dx, dy);
          if (d > LINK_DISTANCE) continue;
          const a = (1 - d / LINK_DISTANCE) * 0.3;
          const hot = nodes[i].alert || nodes[j].alert;
          ctx.strokeStyle = hot
            ? `rgba(214, 168, 79, ${a * 0.85})`
            : `rgba(56, 200, 244, ${a})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }

      // Telemetry pulses travelling the edges.
      for (const p of pulses) {
        const a = nodes[p.from];
        const b = nodes[p.to];
        if (!a || !b) continue;
        const x = a.x + (b.x - a.x) * p.t;
        const y = a.y + (b.y - a.y) * p.t;
        const fade = Math.sin(p.t * Math.PI); // fade in and out along the run
        const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
        g.addColorStop(0, `rgba(134, 233, 255, ${0.9 * fade})`);
        g.addColorStop(1, "rgba(134, 233, 255, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
      }

      // Nodes — nominal cyan, escalated gold with a slow breathing halo.
      for (const n of nodes) {
        const breathe = reduced
          ? 0.6
          : 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(time * 0.0013 + n.phase));
        const color = n.alert ? "214, 168, 79" : "56, 200, 244";
        const halo = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 7);
        halo.addColorStop(0, `rgba(${color}, ${0.32 * breathe})`);
        halo.addColorStop(1, `rgba(${color}, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${color}, ${0.55 + 0.4 * breathe})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const step = (time: number) => {
      if (!running) return;
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;
        n.x = Math.max(0, Math.min(width, n.x));
        n.y = Math.max(0, Math.min(height, n.y));
      }
      for (const p of pulses) p.t += p.speed;
      pulses = pulses.filter((p) => p.t < 1);
      if (Math.random() < 0.045) spawnPulse();
      draw(time);
      raf = requestAnimationFrame(step);
    };

    seed();
    if (reduced) {
      draw(0); // one composed static frame — the lattice still reads
    } else {
      raf = requestAnimationFrame(step);
    }

    const onResize = () => {
      seed();
      if (reduced) draw(0);
    };
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduced && !running) {
        running = true;
        raf = requestAnimationFrame(step);
      }
    };

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
