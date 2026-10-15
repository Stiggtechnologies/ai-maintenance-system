import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const speech = vi.hoisted(() => ({
  speak: vi.fn(),
  stop: vi.fn(),
  speaking: false,
}));

vi.mock("../../hooks/useSpeechOutput", () => ({
  useSpeechOutput: () => speech,
}));

import { SelfServeNarration } from "./SelfServeNarration";

describe("SelfServeNarration", () => {
  it("stays off until asked, then mute stops speech", () => {
    speech.speak.mockClear();
    speech.stop.mockClear();
    render(
      <SelfServeNarration script="Write the engineering decision in your own words." />,
    );
    const toggle = screen.getByRole("button", { name: "Talk me through it" });
    const mute = screen.getByRole("button", { name: "Stop narration" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(mute).toBeDisabled();
    expect(speech.speak).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(speech.speak).toHaveBeenCalledWith(
      "Write the engineering decision in your own words.",
    );

    fireEvent.click(mute);
    expect(speech.stop).toHaveBeenCalled();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("reuses useSpeechOutput and sync-tts-core", () => {
    const src = readFileSync(
      "src/components/onboarding/SelfServeNarration.tsx",
      "utf8",
    );
    expect(src).toContain("useSpeechOutput");
    expect(src).toContain(
      'from "../../../supabase/functions/_shared/sync-tts-core"',
    );
    expect(src).toContain("stripForSpeech");
    expect(src).toContain("useState(false)");
  });
});
