/**
 * Optional Meet Sync hands overlay.
 *
 * Informed by third_party/jaredrhod/barehands (AGPL-3.0-or-later,
 * Copyright 2026 Jared Rhodenizer). Gestures may only steer the booth
 * conversation. They never authorize plant execute, raise work, or bypass
 * recommend ≠ authorize.
 */

export const PRESENCE_HANDS_KEY = "syncai.presence.hands";

export type HandGesture = "none" | "pinch" | "open" | "point";

export type BoothHandAction = "none" | "send" | "pause-listen" | "mute";

export function readHandsPreference(
  storage: Pick<Storage, "getItem">,
): boolean {
  return storage.getItem(PRESENCE_HANDS_KEY) === "1";
}

export function writeHandsPreference(
  storage: Pick<Storage, "setItem" | "removeItem">,
  enabled: boolean,
): void {
  if (enabled) storage.setItem(PRESENCE_HANDS_KEY, "1");
  else storage.removeItem(PRESENCE_HANDS_KEY);
}

export function mapHandGestureToBoothAction(input: {
  gesture: HandGesture;
  hasInput: boolean;
  busy: boolean;
  muted: boolean;
}): BoothHandAction {
  if (input.busy) return "none";
  if (input.gesture === "pinch" && input.hasInput) return "send";
  if (input.gesture === "open") return "pause-listen";
  if (input.gesture === "point" && !input.muted) return "mute";
  return "none";
}

export function pinchDistance(
  thumb: { x: number; y: number } | null,
  index: { x: number; y: number } | null,
): number | null {
  if (!thumb || !index) return null;
  const dx = thumb.x - index.x;
  const dy = thumb.y - index.y;
  return Math.hypot(dx, dy);
}

export function classifyLandmarks(input: {
  pinch: number | null;
  fingersExtended: number;
}): HandGesture {
  if (input.pinch != null && input.pinch < 0.055) return "pinch";
  if (input.fingersExtended >= 4) return "open";
  if (input.fingersExtended === 1) return "point";
  return "none";
}
