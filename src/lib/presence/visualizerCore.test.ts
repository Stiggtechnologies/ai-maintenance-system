import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  VISUALIZER_DISPLAY_NAME,
  VISUALIZER_LABEL,
  createVisualizerCore,
  defaultLevel,
} from "./visualizerCore";

describe("visualizer core", () => {
  it("keeps Sync branding and raises the envelope while speaking", () => {
    const core = createVisualizerCore();
    expect(core.frame.name).toBe(VISUALIZER_DISPLAY_NAME);
    expect(core.frame.label).toBe(VISUALIZER_LABEL);
    expect(VISUALIZER_DISPLAY_NAME).toBe("SYNC");
    expect(core.frame.name).not.toMatch(/jarvis/i);

    let last = core.frame.env;
    for (let i = 0; i < 12; i += 1) {
      last = core.tick(16, { phase: "speaking", level: 0.9 }).env;
    }
    expect(last).toBeGreaterThan(0.2);
    expect(defaultLevel("speaking")).toBeGreaterThan(defaultLevel("idle"));
  });

  it("decays toward idle without inventing plant state", () => {
    const core = createVisualizerCore();
    core.tick(16, { phase: "speaking", level: 1 });
    const idle = core.tick(200, { phase: "idle", level: 0 });
    expect(idle.state).toBe("idle");
    expect(idle.name).toBe("SYNC");
  });

  it("attributes the AGPL visualizer port and does not import the cheeky Jarvis boot", () => {
    const src = readFileSync("src/lib/presence/visualizerCore.ts", "utf8");
    expect(src).toContain("AGPL-3.0-or-later");
    expect(src).toContain("ai-visualizer/core.js");
    expect(src).toContain("Jared Rhodenizer");
    expect(src).not.toMatch(/curse freely|guy friend at a bar/i);
  });
});
