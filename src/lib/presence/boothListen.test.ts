import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOOTH_UTTERANCE_SILENCE_MS,
  MIC_BLOCKED_COPY,
  boothVoiceMode,
  defaultBoothVoiceMode,
  isMicBlockedError,
  readHoldToTalkPreference,
  shouldAutoListen,
  shouldCommitContinuousUtterance,
  writeHoldToTalkPreference,
} from "./boothListen";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe("booth listen mode", () => {
  it("does not default to hold-to-talk", () => {
    expect(defaultBoothVoiceMode()).toBe("continuous");
    expect(boothVoiceMode(false)).toBe("continuous");
    expect(readHoldToTalkPreference(memoryStorage())).toBe(false);
  });

  it("persists hold-to-talk only when the optional toggle is on", () => {
    const storage = memoryStorage();
    writeHoldToTalkPreference(storage, true);
    expect(readHoldToTalkPreference(storage)).toBe(true);
    expect(boothVoiceMode(true)).toBe("hold-to-talk");
    writeHoldToTalkPreference(storage, false);
    expect(readHoldToTalkPreference(storage)).toBe(false);
  });

  it("auto-listens only when the booth is unmuted, permitted, and not holding", () => {
    const ready = {
      muted: false,
      holdToTalk: false,
      supported: true,
      busy: false,
      micPermission: "unknown" as const,
    };
    expect(shouldAutoListen(ready)).toBe(true);
    expect(shouldAutoListen({ ...ready, muted: true })).toBe(false);
    expect(shouldAutoListen({ ...ready, holdToTalk: true })).toBe(false);
    expect(shouldAutoListen({ ...ready, busy: true })).toBe(false);
    expect(shouldAutoListen({ ...ready, supported: false })).toBe(false);
    expect(
      shouldAutoListen({ ...ready, micPermission: "denied" }),
    ).toBe(false);
  });

  it("commits a continuous utterance after silence, not while Sync is speaking", () => {
    const ready = {
      transcript: "How is emergency work trending?",
      silenceMs: BOOTH_UTTERANCE_SILENCE_MS,
      speaking: false,
      busy: false,
      holdToTalk: false,
    };
    expect(shouldCommitContinuousUtterance(ready)).toBe(true);
    expect(
      shouldCommitContinuousUtterance({
        ...ready,
        silenceMs: BOOTH_UTTERANCE_SILENCE_MS - 1,
      }),
    ).toBe(false);
    expect(shouldCommitContinuousUtterance({ ...ready, speaking: true })).toBe(
      false,
    );
    expect(shouldCommitContinuousUtterance({ ...ready, busy: true })).toBe(
      false,
    );
    expect(shouldCommitContinuousUtterance({ ...ready, holdToTalk: true })).toBe(
      false,
    );
    expect(shouldCommitContinuousUtterance({ ...ready, transcript: "  " })).toBe(
      false,
    );
  });

  it("stays Sync-native and does not vendor AGPL conversation stacks", () => {
    const files = [
      "src/lib/presence/boothListen.ts",
      "src/hooks/useDictation.ts",
      "src/components/PresenceBoothConversation.tsx",
    ];
    for (const path of files) {
      const src = readFileSync(path, "utf8");
      expect(src, path).not.toMatch(/backtalk|barehands|kokoro|agpl/i);
    }
  });

  it("names a blocked microphone honestly", () => {
    expect(isMicBlockedError(MIC_BLOCKED_COPY)).toBe(true);
    expect(
      isMicBlockedError(
        "Microphone access was blocked. Allow it in your browser's site settings.",
      ),
    ).toBe(true);
    expect(isMicBlockedError("Dictation stopped unexpectedly.")).toBe(false);
    expect(MIC_BLOCKED_COPY).toMatch(/type your question/i);
    expect(MIC_BLOCKED_COPY).not.toMatch(/plant execute|authorize/i);
  });
});
