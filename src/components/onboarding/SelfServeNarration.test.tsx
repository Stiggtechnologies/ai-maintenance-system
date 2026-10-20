import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRESENCE_MUTE_STORAGE_KEY,
  readMutePreference,
} from "../../lib/presence/welcome";

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
  it("hides Talk me through it and makes no speech request when sync_voice_output is off", () => {
    render(
      <SelfServeNarration script="Write the engineering decision in your own words." />,
    );
    expect(
      screen.queryByRole("button", { name: "Talk me through it" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unmute" })).toBeNull();
    expect(screen.queryByTestId("self-serve-narration-off")).toBeNull();
    expect(screen.getByTestId("self-serve-narration")).toHaveAttribute(
      "data-voice-allowed",
      "false",
    );
    expect(screen.getByTestId("self-serve-narration")).not.toBeVisible();
    expect(probe).not.toHaveBeenCalled();
    expect(requestAudio).not.toHaveBeenCalled();
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it("hides Talk me through it and makes no speech request while the flag is still loading", () => {
    flag.loading = true;
    flag.enabled = true;
    render(<SelfServeNarration script="Write the engineering decision." />);
    expect(
      screen.queryByRole("button", { name: "Talk me through it" }),
    ).toBeNull();
    expect(screen.queryByTestId("self-serve-narration-off")).toBeNull();
    expect(screen.getByTestId("self-serve-narration")).not.toBeVisible();
    expect(probe).not.toHaveBeenCalled();
    expect(requestAudio).not.toHaveBeenCalled();
  });

  it("hides Talk me through it and makes no speech request when the browser is muted", () => {
    flag.enabled = true;
    window.localStorage.setItem(PRESENCE_MUTE_STORAGE_KEY, "1");
    render(<SelfServeNarration script="Write the engineering decision." />);
    expect(
      screen.queryByRole("button", { name: "Talk me through it" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Unmute" })).toBeEnabled();
    expect(screen.getByTestId("self-serve-narration-off").textContent).toMatch(
      /muted in this browser/i,
    );
    expect(screen.getByTestId("self-serve-narration-off").textContent).toMatch(
      /no speech request is made/i,
    );
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
    const mute = screen.getByRole("button", { name: "Mute" });
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
    expect(readMutePreference(window.localStorage)).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Talk me through it" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Unmute" })).toBeEnabled();
    expect(requestAudio).toHaveBeenCalledTimes(1);
  });

  it("saves Mute through writeMutePreference and restores it on reload", async () => {
    flag.enabled = true;
    const view = render(
      <SelfServeNarration script="Write the engineering decision in your own words." />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Talk me through it" }));
    await waitFor(() => expect(requestAudio).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));

    expect(window.localStorage.getItem(PRESENCE_MUTE_STORAGE_KEY)).toBe("1");
    expect(readMutePreference(window.localStorage)).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Talk me through it" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Unmute" })).toBeEnabled();
    expect(screen.getByTestId("self-serve-narration")).toHaveAttribute(
      "data-voice-allowed",
      "false",
    );

    view.unmount();
    probe.mockClear();
    requestAudio.mockClear();
    vi.mocked(window.speechSynthesis.speak).mockClear();
    render(
      <SelfServeNarration script="Write the engineering decision in your own words." />,
    );
    expect(
      screen.queryByRole("button", { name: "Talk me through it" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Unmute" })).toBeEnabled();
    expect(screen.getByTestId("self-serve-narration-off").textContent).toMatch(
      /muted in this browser/i,
    );
    expect(probe).not.toHaveBeenCalled();
    expect(requestAudio).not.toHaveBeenCalled();
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it("reuses useSpeechOutput, the voice flag, and sync-tts-core", () => {
    const src = readFileSync(
      "src/components/onboarding/SelfServeNarration.tsx",
      "utf8",
    );
    expect(src).toContain("useSpeechOutput");
    expect(src).toContain('useFeatureFlag("sync_voice_output")');
    expect(src).toContain("readMutePreference");
    expect(src).toContain("writeMutePreference");
    expect(src).toContain(
      'from "../../../supabase/functions/_shared/sync-tts-core"',
    );
    expect(src).toContain("stripForSpeech");
    expect(src).toContain("useState(false)");
  });

  it("turns narration back on when Unmute clears the saved preference", async () => {
    flag.enabled = true;
    window.localStorage.setItem(PRESENCE_MUTE_STORAGE_KEY, "1");
    render(
      <SelfServeNarration script="Write the engineering decision in your own words." />,
    );
    expect(
      screen.queryByRole("button", { name: "Talk me through it" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    expect(readMutePreference(window.localStorage)).toBe(false);
    expect(
      screen.getByRole("button", { name: "Talk me through it" }),
    ).toBeEnabled();
    await waitFor(() => expect(probe).toHaveBeenCalled());
    expect(requestAudio).not.toHaveBeenCalled();
  });

  it("keeps narration hidden when the workspace has no voice, including a saved mute preference", () => {
    window.localStorage.setItem(PRESENCE_MUTE_STORAGE_KEY, "1");
    render(<SelfServeNarration script="Write the engineering decision." />);
    expect(
      screen.queryByRole("button", { name: "Talk me through it" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Unmute" })).toBeNull();
    expect(screen.queryByTestId("self-serve-narration-off")).toBeNull();
    expect(readMutePreference(window.localStorage)).toBe(true);
    expect(screen.getByTestId("self-serve-narration")).not.toBeVisible();
    expect(probe).not.toHaveBeenCalled();
    expect(requestAudio).not.toHaveBeenCalled();
  });
});
