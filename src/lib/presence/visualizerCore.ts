/**
 * Meet Sync face engine — envelope and waveform tick.
 *
 * Ported from third_party/jaredrhod/ai-visualizer/core.js
 * Copyright (C) 2026 Jared Rhodenizer
 *
 * This file is a modified version of that AGPL-3.0-or-later work:
 * - Driven by Sync PresencePhase instead of the desktop /state bus
 * - Display name is SYNC, not JARVIS
 * - No thinking.wav player, no demo JARVIS label
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { PresencePhase } from "./state";

export const VISUALIZER_DISPLAY_NAME = "SYNC";
export const VISUALIZER_LABEL = "S.Y.N.C.";

export interface VisualizerFrame {
  state: PresencePhase;
  level: number;
  env: number;
  samples: Float32Array;
  name: string;
  label: string;
}

export interface VisualizerCore {
  frame: VisualizerFrame;
  tick: (dtMs: number, input: VisualizerTickInput) => VisualizerFrame;
}

export interface VisualizerTickInput {
  phase: PresencePhase;
  level?: number;
  samples?: ArrayLike<number> | null;
}

export function createVisualizerCore(): VisualizerCore {
  const samples = new Float32Array(64);
  const frame: VisualizerFrame = {
    state: "idle",
    level: 0,
    env: 0,
    samples,
    name: VISUALIZER_DISPLAY_NAME,
    label: VISUALIZER_LABEL,
  };
  let peak = 0.05;
  let sPeak = 200;

  const tick = (dtMs: number, input: VisualizerTickInput): VisualizerFrame => {
    const dts = dtMs / 1000;
    frame.state = input.phase;
    frame.level = input.level ?? defaultLevel(input.phase);
    peak = Math.max(frame.level, 0.05, peak - 0.5 * peak * dts);
    const target = Math.min(1, frame.level / peak);
    const tau = target > frame.env ? 50 : 350;
    frame.env += (target - frame.env) * Math.min(1, dtMs / tau);

    const incoming = input.samples;
    if (incoming && incoming.length) {
      let mx = 0;
      for (let i = 0; i < incoming.length; i += 1) {
        mx = Math.max(mx, Math.abs(incoming[i] ?? 0));
      }
      sPeak = Math.max(mx, 200, sPeak * 0.98);
      const n = incoming.length;
      for (let i = 0; i < 64; i += 1) {
        const src =
          incoming[Math.min(n - 1, Math.round((i * (n - 1)) / 63))] ?? 0;
        const v = Math.abs(src) / sPeak;
        samples[i] = samples[i] * 0.45 + Math.min(1, v) * 0.55;
      }
    } else {
      synthesizePhaseSamples(samples, input.phase, frame.env, dts);
    }
    if (input.phase !== "speaking" && !incoming) {
      for (let i = 0; i < 64; i += 1) {
        samples[i] *= Math.max(0, 1 - dts * 2.2);
      }
    }
    return frame;
  };

  return { frame, tick };
}

export function defaultLevel(phase: PresencePhase): number {
  switch (phase) {
    case "speaking":
      return 0.72;
    case "listening":
      return 0.38;
    case "thinking":
      return 0.22;
    default:
      return 0.08;
  }
}

function synthesizePhaseSamples(
  samples: Float32Array,
  phase: PresencePhase,
  env: number,
  dts: number,
): void {
  const now = performanceNow() / 1000;
  for (let i = 0; i < 64; i += 1) {
    if (phase === "speaking") {
      const cadence =
        Math.max(0, Math.sin(now * 2.1) * 0.6 + Math.sin(now * 0.9) * 0.5) *
        env;
      const m =
        0.3 +
        0.7 *
          Math.abs(Math.sin(i * 0.23 + now * 1.7)) *
          Math.abs(Math.sin(now * 2.9 + i * 0.05));
      samples[i] =
        (Math.sin(i * 0.55 + now * 9) * 0.6 +
          Math.sin(i * 1.7 - now * 13) * 0.4) *
        (0.15 + 0.85 * cadence) *
        m;
    } else if (phase === "listening") {
      samples[i] = 0.12 + 0.28 * Math.abs(Math.sin(now * 2.7 + i * 0.11)) * env;
    } else if (phase === "thinking") {
      samples[i] = 0.08 + 0.1 * Math.abs(Math.sin(now * 1.1 + i * 0.2));
    } else {
      samples[i] *= Math.max(0, 1 - dts * 4);
    }
  }
}

function performanceNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
