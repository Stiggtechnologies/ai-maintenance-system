/**
 * Sync-branded Meet Sync face — idle / listening / thinking / speaking.
 *
 * Canvas envelope and waveform from the AGPL ai-visualizer core port
 * (`visualizerCore.ts`). Colors are Sync cyan/slate, name SYNC, not JARVIS.
 * Driven only by derivePresencePhase() from real conversation signals.
 */
import { useEffect, useRef } from "react";
import { presencePhaseLabel, type PresencePhase } from "../lib/presence/state";
import { createVisualizerCore } from "../lib/presence/visualizerCore";

interface PresenceFaceProps {
  phase: PresencePhase;
  size?: "sm" | "md";
}

export function PresenceFace({ phase, size = "sm" }: PresenceFaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const dimension = size === "md" ? "h-16 w-16" : "h-10 w-10";
  const px = size === "md" ? 64 : 40;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const core = createVisualizerCore();
    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      const frame = core.tick(dt, { phase: phaseRef.current });
      paintSyncFace(ctx, px, frame.state, frame.env, frame.samples);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [px]);

  return (
    <div
      data-testid="presence-face"
      data-presence-phase={phase}
      data-visualizer-name="SYNC"
      role="img"
      aria-label={`Sync presence ${presencePhaseLabel(phase).toLowerCase()}`}
      className={`presence-face presence-face--${phase} ${dimension} relative shrink-0 overflow-hidden`}
    >
      <canvas
        ref={canvasRef}
        width={px}
        height={px}
        className="h-full w-full"
        aria-hidden="true"
      />
    </div>
  );
}

function paintSyncFace(
  ctx: CanvasRenderingContext2D,
  size: number,
  phase: PresencePhase,
  env: number,
  samples: Float32Array,
): void {
  const mid = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgba(8, 26, 44, 0.96)";
  ctx.beginPath();
  ctx.arc(mid, mid, mid - 0.5, 0, Math.PI * 2);
  ctx.fill();

  const listening = phase === "listening";
  const thinking = phase === "thinking";
  const speaking = phase === "speaking";
  const ring = listening
    ? "rgba(214, 168, 79, 0.85)"
    : speaking
      ? "rgba(56, 200, 244, 0.95)"
      : thinking
        ? "rgba(134, 233, 255, 0.7)"
        : "rgba(56, 200, 244, 0.45)";

  ctx.strokeStyle = ring;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(mid, mid, mid * (0.78 + env * 0.12), 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(134, 233, 255, 0.4)";
  ctx.beginPath();
  ctx.arc(mid, mid, mid * 0.52, 0, Math.PI * 2);
  ctx.stroke();

  if (speaking || listening) {
    ctx.strokeStyle = speaking
      ? "rgba(56, 200, 244, 0.9)"
      : "rgba(214, 168, 79, 0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 32; i += 1) {
      const a = (i / 32) * Math.PI * 2 - Math.PI / 2;
      const amp = 0.18 + (samples[i * 2] ?? 0) * 0.28;
      const x = mid + Math.cos(a) * mid * amp * 1.6;
      const y = mid + Math.sin(a) * mid * amp * 1.6;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  ctx.fillStyle = listening ? "rgb(214, 168, 79)" : "rgb(56, 200, 244)";
  ctx.beginPath();
  ctx.arc(mid, mid, mid * (0.12 + env * 0.06), 0, Math.PI * 2);
  ctx.fill();
}
