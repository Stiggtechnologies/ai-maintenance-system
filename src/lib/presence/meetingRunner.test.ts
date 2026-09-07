import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyRoomUtterance,
  decideRoomTurn,
  isSyncDirectedUtterance,
  ROOM_FACILITATION,
  ROOM_HOLD_COPY,
  roomSessionLineLimit,
  shouldSpeakRoomTurn,
} from "./meetingRunner";

describe("classifyRoomUtterance", () => {
  it("treats Sync being named or invited as a speak turn", () => {
    expect(classifyRoomUtterance("Sync, what should we look at first?")).toBe(
      "addressed",
    );
    expect(classifyRoomUtterance("Hey Sync, jump in when you can.")).toBe(
      "addressed",
    );
    expect(classifyRoomUtterance("What do you think about the crusher?")).toBe(
      "invited",
    );
    expect(classifyRoomUtterance("Can you weigh in on the backlog?")).toBe(
      "invited",
    );
  });

  it("treats wrap and stuck asks as speak intents", () => {
    expect(classifyRoomUtterance("Can we recap decisions so far?")).toBe(
      "wrap",
    );
    expect(classifyRoomUtterance("What are the action items?")).toBe("wrap");
    expect(classifyRoomUtterance("We don't have the data.")).toBe("asked");
    expect(classifyRoomUtterance("What are we missing?")).toBe("asked");
  });

  it("holds acknowledgements and room chatter that is not for Sync", () => {
    expect(classifyRoomUtterance("Yeah I agree")).toBe("hold");
    expect(classifyRoomUtterance("Got it.")).toBe("hold");
    expect(classifyRoomUtterance("mm-hmm")).toBe("hold");
    expect(classifyRoomUtterance("The vibration started after the shutdown.")).toBe(
      "hold",
    );
    expect(classifyRoomUtterance("I'll take that action.")).toBe("hold");
    expect(classifyRoomUtterance("huh?")).toBe("hold");
  });

  it("treats 1:1 audio and presence checks as asked, not room chatter", () => {
    expect(isSyncDirectedUtterance("Can you hear me")).toBe(true);
    expect(isSyncDirectedUtterance("I can't hear you")).toBe(true);
    expect(isSyncDirectedUtterance("I cannot hear you")).toBe(true);
    expect(isSyncDirectedUtterance("Are you there")).toBe(true);
    expect(classifyRoomUtterance("Can you hear me")).toBe("asked");
    expect(classifyRoomUtterance("I can't hear you")).toBe("asked");
    expect(classifyRoomUtterance("Are you listening?")).toBe("asked");
    expect(
      decideRoomTurn({
        text: "Can you hear me",
        channel: "continuous",
      }).action,
    ).toBe("speak");
    expect(
      decideRoomTurn({
        text: "I can't hear you",
        channel: "continuous",
      }).action,
    ).toBe("speak");
    expect(isSyncDirectedUtterance("The vibration started after the shutdown.")).toBe(
      false,
    );
  });

  it("treats a real reliability question as asked", () => {
    expect(classifyRoomUtterance("How is emergency work trending?")).toBe(
      "asked",
    );
    expect(
      classifyRoomUtterance("Should we inspect the crusher bearing next?"),
    ).toBe("asked");
    expect(
      classifyRoomUtterance("What should we look at first on availability?"),
    ).toBe("asked");
  });
});

describe("decideRoomTurn", () => {
  it("always speaks an explicit typed or hold-to-talk ask", () => {
    const typed = decideRoomTurn({
      text: "Yeah I agree",
      channel: "typed",
    });
    expect(typed.action).toBe("speak");
    expect(typed.reason).toBe("explicit_ask");
    expect(shouldSpeakRoomTurn(typed)).toBe(true);

    const held = decideRoomTurn({
      text: "Got it",
      channel: "hold-to-talk",
    });
    expect(held.action).toBe("speak");
    expect(held.intent).toBe("asked");
  });

  it("holds continuous room chatter and speaks when asked", () => {
    expect(
      decideRoomTurn({
        text: "Yeah I agree",
        channel: "continuous",
      }),
    ).toEqual({
      action: "hold",
      intent: "hold",
      reason: "room_continues",
    });
    const asked = decideRoomTurn({
      text: "How is emergency work trending?",
      channel: "continuous",
    });
    expect(asked.action).toBe("speak");
    expect(asked.intent).toBe("asked");
    const addressed = decideRoomTurn({
      text: "Sync, recap the open evidence gaps.",
      channel: "continuous",
    });
    expect(addressed.action).toBe("speak");
    expect(addressed.intent).toBe("addressed");
  });

  it("does not treat TTS, settle, or self-echo as a room turn", () => {
    const spoken =
      "No sourced backlog figure is in this snapshot. I recommend, I do not authorize.";
    expect(
      decideRoomTurn({
        text: "How is emergency work trending?",
        channel: "continuous",
        speaking: true,
      }).action,
    ).toBe("hold");
    expect(
      decideRoomTurn({
        text: spoken,
        channel: "continuous",
        lastSpokenText: spoken,
      }).reason,
    ).toBe("tts_or_echo");
    expect(
      decideRoomTurn({
        text: "  ",
        channel: "continuous",
      }).reason,
    ).toBe("empty");
  });

  it("does not infer speaker identity or treat silence as consensus", () => {
    expect(ROOM_FACILITATION).toMatch(/Do not infer speaker identity/i);
    expect(ROOM_FACILITATION).toMatch(/silence or lack of objection as consensus/i);
    expect(ROOM_FACILITATION).toMatch(/never as the meeting's authority/i);
    expect(ROOM_FACILITATION).not.toMatch(/jarvis|javis|cheeky|lol/i);
    expect(ROOM_HOLD_COPY).toMatch(/did not interrupt/i);
    expect(ROOM_HOLD_COPY).not.toMatch(/authorized|plant execute/i);
    expect(roomSessionLineLimit()).toBe(8);
  });
});

describe("meeting runner honesty", () => {
  it("stays Sync-native and does not vendor a conversation stack", () => {
    const src = readFileSync("src/lib/presence/meetingRunner.ts", "utf8");
    expect(src).toContain("ReliabilityAgent");
    expect(src).toContain("askBooth");
    expect(src).not.toMatch(/openclaw|javis|jarvis|backtalk|barehands|kokoro/i);
    expect(src).toMatch(/Recommend ≠ authorize|recommend ≠ authorize/i);
    const imports = src
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line))
      .join("\n");
    expect(imports).not.toMatch(/sync-runtime|ai-agent-processor/i);
  });
});
