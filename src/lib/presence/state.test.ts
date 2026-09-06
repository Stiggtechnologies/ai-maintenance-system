import { describe, expect, it } from "vitest";
import {
  presencePhaseLabel,
  reducePresencePhase,
  resolvePresencePhase,
  type PresencePhase,
} from "./state";

describe("resolvePresencePhase", () => {
  it("uses real listen / think / speak flags in that priority", () => {
    expect(
      resolvePresencePhase({
        listening: false,
        thinking: false,
        speaking: false,
      }),
    ).toBe("idle");
    expect(
      resolvePresencePhase({
        listening: true,
        thinking: false,
        speaking: true,
      }),
    ).toBe("listening");
    expect(
      resolvePresencePhase({
        listening: false,
        thinking: true,
        speaking: false,
      }),
    ).toBe("thinking");
    expect(
      resolvePresencePhase({
        listening: false,
        thinking: false,
        speaking: true,
      }),
    ).toBe("speaking");
  });

  it("does not stay speaking after thinking when speech is off", () => {
    expect(
      resolvePresencePhase({
        listening: false,
        thinking: false,
        speaking: false,
      }),
    ).toBe("idle");
  });
});

describe("reducePresencePhase", () => {
  const walk = (
    start: PresencePhase,
    events: Parameters<typeof reducePresencePhase>[1][],
  ) =>
    events.reduce((phase, event) => reducePresencePhase(phase, event), start);

  it("walks idle → listening → thinking → speaking → idle", () => {
    expect(
      walk("idle", [
        { type: "listen_start" },
        { type: "ask_start" },
        { type: "reply_ready", speak: true },
        { type: "speech_end" },
      ]),
    ).toBe("idle");
  });

  it("returns to idle when the reply must not be spoken", () => {
    expect(
      walk("idle", [
        { type: "listen_start" },
        { type: "ask_start" },
        { type: "reply_ready", speak: false },
      ]),
    ).toBe("idle");
  });

  it("cancels listen without inventing a thinking or speaking phase", () => {
    expect(
      walk("idle", [{ type: "listen_start" }, { type: "listen_cancel" }]),
    ).toBe("idle");
    expect(reducePresencePhase("thinking", { type: "listen_cancel" })).toBe(
      "thinking",
    );
    expect(reducePresencePhase("speaking", { type: "speech_end" })).toBe(
      "idle",
    );
    expect(reducePresencePhase("idle", { type: "speech_end" })).toBe("idle");
    expect(reducePresencePhase("listening", { type: "reset" })).toBe("idle");
  });

  it("labels phases without claiming plant control", () => {
    expect(presencePhaseLabel("idle")).toBe("Ready");
    expect(presencePhaseLabel("listening")).toBe("Listening");
    expect(presencePhaseLabel("thinking")).toBe("Thinking");
    expect(presencePhaseLabel("speaking")).toBe("Speaking");
    expect(presencePhaseLabel("speaking")).not.toMatch(/authoriz|execute/i);
  });
});
