import { describe, expect, it } from "vitest";
import {
  classifyLandmarks,
  mapHandGestureToBoothAction,
  pinchDistance,
  readHandsPreference,
  writeHandsPreference,
} from "./hands";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
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

describe("presence hands policy", () => {
  it("only sends on pinch when there is text, and never while busy", () => {
    expect(
      mapHandGestureToBoothAction({
        gesture: "pinch",
        hasInput: true,
        busy: false,
        muted: false,
      }),
    ).toBe("send");
    expect(
      mapHandGestureToBoothAction({
        gesture: "pinch",
        hasInput: false,
        busy: false,
        muted: false,
      }),
    ).toBe("none");
    expect(
      mapHandGestureToBoothAction({
        gesture: "pinch",
        hasInput: true,
        busy: true,
        muted: false,
      }),
    ).toBe("none");
  });

  it("maps open palm to pause listen and point to mute", () => {
    expect(
      mapHandGestureToBoothAction({
        gesture: "open",
        hasInput: false,
        busy: false,
        muted: false,
      }),
    ).toBe("pause-listen");
    expect(
      mapHandGestureToBoothAction({
        gesture: "point",
        hasInput: false,
        busy: false,
        muted: false,
      }),
    ).toBe("mute");
    expect(
      mapHandGestureToBoothAction({
        gesture: "point",
        hasInput: false,
        busy: false,
        muted: true,
      }),
    ).toBe("none");
  });

  it("classifies pinch from landmark distance", () => {
    expect(
      pinchDistance({ x: 0.1, y: 0.1 }, { x: 0.12, y: 0.11 }),
    ).toBeLessThan(0.055);
    expect(classifyLandmarks({ pinch: 0.03, fingersExtended: 2 })).toBe(
      "pinch",
    );
    expect(classifyLandmarks({ pinch: 0.2, fingersExtended: 5 })).toBe("open");
    expect(classifyLandmarks({ pinch: 0.2, fingersExtended: 1 })).toBe("point");
  });

  it("persists the optional hands overlay off by default", () => {
    const storage = memoryStorage();
    expect(readHandsPreference(storage)).toBe(false);
    writeHandsPreference(storage, true);
    expect(readHandsPreference(storage)).toBe(true);
    writeHandsPreference(storage, false);
    expect(readHandsPreference(storage)).toBe(false);
  });
});
