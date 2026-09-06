import { describe, expect, it } from "vitest";
import {
  PRESENCE_PHASES,
  derivePresencePhase,
  presencePhaseLabel,
} from "./state";

describe("presence state machine", () => {
  it("is idle when nothing is happening", () => {
    expect(
      derivePresencePhase({
        listening: false,
        thinking: false,
        speaking: false,
      }),
    ).toBe("idle");
  });

  it("moves to listening when the user holds to talk", () => {
    expect(
      derivePresencePhase({
        listening: true,
        thinking: false,
        speaking: false,
      }),
    ).toBe("listening");
  });

  it("moves to thinking while the Reliability Engineer ask is in flight", () => {
    expect(
      derivePresencePhase({
        listening: false,
        thinking: true,
        speaking: false,
      }),
    ).toBe("thinking");
  });

  it("moves to speaking when browser TTS is playing", () => {
    expect(
      derivePresencePhase({
        listening: false,
        thinking: false,
        speaking: true,
      }),
    ).toBe("speaking");
  });

  it("lets hold-to-talk barge in on speaking", () => {
    expect(
      derivePresencePhase({
        listening: true,
        thinking: false,
        speaking: true,
      }),
    ).toBe("listening");
  });

  it("stays on thinking rather than a stale speaking flag while busy", () => {
    expect(
      derivePresencePhase({
        listening: false,
        thinking: true,
        speaking: true,
      }),
    ).toBe("thinking");
  });

  it("never invents a fifth phase or a plant-execute state", () => {
    expect(PRESENCE_PHASES).toEqual([
      "idle",
      "listening",
      "thinking",
      "speaking",
    ]);
    expect(PRESENCE_PHASES.join(" ")).not.toMatch(
      /execute|authorize|autonomous/i,
    );
    expect(presencePhaseLabel("idle")).toBe("Idle");
    expect(presencePhaseLabel("listening")).toBe("Listening");
    expect(presencePhaseLabel("thinking")).toBe("Thinking");
    expect(presencePhaseLabel("speaking")).toBe("Speaking");
  });
});
