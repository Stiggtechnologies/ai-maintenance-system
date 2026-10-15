import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRESENCE_MUTE_STORAGE_KEY } from "../../lib/presence/welcome";

const flag = vi.hoisted(() => ({
  enabled: false,
  loading: false,
}));

const probe = vi.hoisted(() => vi.fn());
const requestAudio = vi.hoisted(() => vi.fn());

vi.mock("../../hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({
    enabled: flag.enabled,
    loading: flag.loading,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../../lib/speech/syncTtsClient", () => ({
  probeSyncTtsConfigured: (...args: unknown[]) => probe(...args),
  requestSyncTtsAudio: (...args: unknown[]) => requestAudio(...args),
}));

import { SelfServeNarration } from "./SelfServeNarration";

function installSpeechSynthesis() {
  const speak = vi.fn();
  const cancel = vi.fn();
  class FakeUtterance {
    text: string;
    lang = "";
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: { speak, cancel, pending: false, speaking: false, paused: false },
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    value: FakeUtterance,
  });
  return { speak, cancel };
}

beforeEach(() => {
  flag.enabled = false;
  flag.loading = false;
  probe.mockReset();
  requestAudio.mockReset();
  probe.mockResolvedValue(false);
  requestAudio.mockRejectedValue(new Error("cloud_tts_unconfigured"));
  window.localStorage.removeItem(PRESENCE_MUTE_STORAGE_KEY);
  installSpeechSynthesis();
});

describe("SelfServeNarration", () => {
  it("makes no cloud TTS request when sync_voice_output is off", () => {
    render(
      <SelfServeNarration script="Write the engineering decision in your own words." />,
    );
    const toggle = screen.getByRole("button", { name: "Talk me through it" });
    expect(toggle).toBeDisabled();
    expect(screen.getByTestId("self-serve-narration")).toHaveAttribute(
      "data-voice-allowed",
      "false",
    );
    expect(screen.getByTestId("self-serve-narration-off").textContent).toMatch(
      /no speech request is made/i,
    );
    fireEvent.click(toggle);
    expect(probe).not.toHaveBeenCalled();
    expect(requestAudio).not.toHaveBeenCalled();
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it("makes no cloud TTS request while the flag is still loading", () => {
    flag.loading = true;
    flag.enabled = true;
    render(<SelfServeNarration script="Write the engineering decision." />);
    expect(
      screen.getByRole("button", { name: "Talk me through it" }),
    ).toBeDisabled();
    expect(probe).not.toHaveBeenCalled();
    expect(requestAudio).not.toHaveBeenCalled();
  });

  it("makes no cloud TTS request when the user voice setting is muted", () => {
    flag.enabled = true;
    window.localStorage.setItem(PRESENCE_MUTE_STORAGE_KEY, "1");
    render(<SelfServeNarration script="Write the engineering decision." />);
    expect(
      screen.getByRole("button", { name: "Talk me through it" }),
    ).toBeDisabled();
    expect(probe).not.toHaveBeenCalled();
    expect(requestAudio).not.toHaveBeenCalled();
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it("stays off until asked when voice output is enabled, then mute stops speech", async () => {
    flag.enabled = true;
    render(
      <SelfServeNarration script="Write the engineering decision in your own words." />,
    );
    const toggle = screen.getByRole("button", { name: "Talk me through it" });
    const mute = screen.getByRole("button", { name: "Stop narration" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(mute).toBeDisabled();
    await waitFor(() => expect(probe).toHaveBeenCalled());
    expect(requestAudio).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() =>
      expect(requestAudio).toHaveBeenCalledWith(
        "Write the engineering decision in your own words.",
        expect.any(AbortSignal),
      ),
    );

    fireEvent.click(mute);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("reuses useSpeechOutput, the voice flag, and sync-tts-core", () => {
    const src = readFileSync(
      "src/components/onboarding/SelfServeNarration.tsx",
      "utf8",
    );
    expect(src).toContain("useSpeechOutput");
    expect(src).toContain('useFeatureFlag("sync_voice_output")');
    expect(src).toContain("readMutePreference");
    expect(src).toContain(
      'from "../../../supabase/functions/_shared/sync-tts-core"',
    );
    expect(src).toContain("stripForSpeech");
    expect(src).toContain("useState(false)");
  });
});
