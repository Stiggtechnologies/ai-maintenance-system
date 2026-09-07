import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOOTH_UTTERANCE_SILENCE_MS } from "./boothListen";
import {
  BOOTH_SHORT_UTTERANCE_SILENCE_MS,
  FAST_GREETING_REPLY,
  FAST_PRESENCE_CANT_HEAR_REPLY,
  FAST_PRESENCE_HEAR_REPLY,
  FAST_PRESENCE_HERE_REPLY,
  FAST_SOCIAL_REPLY,
  FAST_THANKS_REPLY,
  boothCommitSilenceMs,
  isCompleteTrivialPresenceTurn,
  resolveBoothFastPath,
  utteranceHasReliabilityPayload,
} from "./boothFastPath";

describe("Meet Sync spoken fast path", () => {
  it("answers 3-word presence checks locally without the heavy Ask stack", () => {
    const hear = resolveBoothFastPath("Can you hear me");
    expect(hear).toEqual({
      kind: "presence",
      reply: FAST_PRESENCE_HEAR_REPLY,
      persistDurable: false,
    });
    expect(hear?.reply.split(/\s+/).length).toBeLessThanOrEqual(6);
    expect(resolveBoothFastPath("I can't hear you")?.reply).toBe(
      FAST_PRESENCE_CANT_HEAR_REPLY,
    );
    expect(resolveBoothFastPath("Are you there")?.reply).toBe(
      FAST_PRESENCE_HERE_REPLY,
    );
    expect(resolveBoothFastPath("Are you listening")?.kind).toBe("presence");
  });

  it("answers greetings locally and may use the given name", () => {
    expect(resolveBoothFastPath("Hello")).toEqual({
      kind: "greeting",
      reply: FAST_GREETING_REPLY,
      persistDurable: false,
    });
    expect(resolveBoothFastPath("Hi Sync")?.reply).toBe(FAST_GREETING_REPLY);
    expect(resolveBoothFastPath("hey", "Orville")?.reply).toBe(
      "Hello Orville. I'm listening.",
    );
    expect(resolveBoothFastPath("Thanks")?.reply).toBe(FAST_THANKS_REPLY);
    expect(resolveBoothFastPath("Yeah I agree")?.reply).toBe(FAST_SOCIAL_REPLY);
  });

  it("keeps real reliability questions on the industrial Ask path", () => {
    expect(resolveBoothFastPath("How is emergency work trending?")).toBeNull();
    expect(
      resolveBoothFastPath("Sync, what should we look at first?"),
    ).toBeNull();
    expect(
      resolveBoothFastPath("Can you hear me about the crusher vibration?"),
    ).toBeNull();
    expect(resolveBoothFastPath("What do you think about the backlog?")).toBeNull();
    expect(utteranceHasReliabilityPayload("Can we recap decisions so far?")).toBe(
      true,
    );
    expect(isCompleteTrivialPresenceTurn("How is emergency work trending?")).toBe(
      false,
    );
  });

  it("never invents plant state on the fast path", () => {
    const replies = [
      resolveBoothFastPath("Can you hear me")?.reply,
      resolveBoothFastPath("Hello")?.reply,
      resolveBoothFastPath("Thanks")?.reply,
      FAST_PRESENCE_CANT_HEAR_REPLY,
    ];
    for (const reply of replies) {
      expect(reply).toBeTruthy();
      expect(reply).not.toMatch(/87%|OEE|plant is healthy|authorized|execute/i);
    }
  });

  it("tightens silence only for a complete trivial turn", () => {
    expect(boothCommitSilenceMs("Can you hear me", BOOTH_UTTERANCE_SILENCE_MS)).toBe(
      BOOTH_SHORT_UTTERANCE_SILENCE_MS,
    );
    expect(boothCommitSilenceMs("Hello", BOOTH_UTTERANCE_SILENCE_MS)).toBe(
      BOOTH_SHORT_UTTERANCE_SILENCE_MS,
    );
    expect(
      boothCommitSilenceMs(
        "How is emergency work trending?",
        BOOTH_UTTERANCE_SILENCE_MS,
      ),
    ).toBe(BOOTH_UTTERANCE_SILENCE_MS);
    expect(
      boothCommitSilenceMs("can you", BOOTH_UTTERANCE_SILENCE_MS),
    ).toBe(BOOTH_UTTERANCE_SILENCE_MS);
    expect(BOOTH_SHORT_UTTERANCE_SILENCE_MS).toBeLessThan(
      BOOTH_UTTERANCE_SILENCE_MS,
    );
    expect(BOOTH_SHORT_UTTERANCE_SILENCE_MS).toBeGreaterThanOrEqual(300);
  });

  it("stays Sync-native and does not add a parallel orchestrator", () => {
    const src = readFileSync("src/lib/presence/boothFastPath.ts", "utf8");
    expect(src).toMatch(/askBooth → ReliabilityAgent|ReliabilityAgent/);
    expect(src).not.toMatch(/openclaw|javis|jarvis|backtalk|barehands|kokoro/i);
    const imports = src
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line))
      .join("\n");
    expect(imports).not.toMatch(/ai-agent-processor|sync-runtime/i);
  });
});
