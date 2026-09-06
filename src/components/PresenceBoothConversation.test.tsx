import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOOTH_UNAVAILABLE_REPLY } from "../lib/presence/booth";
import {
  BOOTH_UTTERANCE_SILENCE_MS,
  MIC_BLOCKED_COPY,
  PRESENCE_HOLD_TO_TALK_KEY,
} from "../lib/presence/boothListen";
import { PRESENCE_MEMORY_KEY_PREFIX } from "../lib/presence/memory";
import { PresenceBoothConversation } from "./PresenceBoothConversation";

const speak = vi.fn();
const stopSpeech = vi.fn();
const askBooth = vi.fn();
const startDictation = vi.fn();
const stopDictation = vi.fn();
const retryPermission = vi.fn();
const persistVault = vi.fn();
const loadVault = vi.fn();
const onPresenceSignals = vi.fn();
let onTranscript: ((text: string) => void) | null = null;
let onSpeech: (() => void) | undefined;
let onInterim: ((text: string) => void) | undefined;

const dictation = {
  supported: true,
  listening: false,
  error: null as string | null,
  permission: "unknown" as "unknown" | "granted" | "denied" | "unsupported",
  start: startDictation,
  stop: stopDictation,
  retryPermission,
  clearError: vi.fn(),
};

vi.mock("../lib/presence/askBooth", () => ({
  askBoothConversation: (...args: unknown[]) => askBooth(...args),
}));

vi.mock("../lib/presence/vaultClient", () => ({
  persistPresenceVault: (...args: unknown[]) => persistVault(...args),
  loadPresenceVaultSession: (...args: unknown[]) => loadVault(...args),
}));

vi.mock("../hooks/useDictation", () => ({
  useDictation: (
    callback: (text: string) => void,
    options?: { onSpeech?: () => void; onInterim?: (text: string) => void },
  ) => {
    onTranscript = callback;
    onSpeech = options?.onSpeech;
    onInterim = options?.onInterim;
    return dictation;
  },
}));

beforeEach(() => {
  speak.mockReset();
  stopSpeech.mockReset();
  askBooth.mockReset();
  startDictation.mockReset();
  stopDictation.mockReset();
  retryPermission.mockReset();
  persistVault.mockReset();
  loadVault.mockReset();
  onPresenceSignals.mockReset();
  onTranscript = null;
  onSpeech = undefined;
  onInterim = undefined;
  dictation.supported = true;
  dictation.listening = false;
  dictation.error = null;
  dictation.permission = "unknown";
  persistVault.mockResolvedValue(true);
  loadVault.mockResolvedValue(null);
  window.sessionStorage.clear();
  window.localStorage.clear();
  askBooth.mockResolvedValue({
    status: "ok",
    response:
      "No sourced backlog figure is in this snapshot. I recommend, I do not authorize.",
  });
});

function renderBooth(
  overrides: Partial<ComponentProps<typeof PresenceBoothConversation>> = {},
) {
  return render(
    <PresenceBoothConversation
      signedIn
      userId="user-orville"
      muted={false}
      voiceOutputEnabled
      givenName="Orville"
      briefLines={["No sourced KPI values are available yet."]}
      caseContextLines={[
        "No decision case is selected.",
        "Stay general. Do not assume a demo, reference, or seed case.",
      ]}
      caseBound={false}
      speak={speak}
      stopSpeech={stopSpeech}
      onPresenceSignals={onPresenceSignals}
      {...overrides}
    />,
  );
}

describe("PresenceBoothConversation", () => {
  it("does not default to hold-to-talk", () => {
    renderBooth();
    expect(screen.getByTestId("presence-booth")).toHaveAttribute(
      "data-booth-voice-mode",
      "continuous",
    );
    expect(
      screen.getByRole("checkbox", { name: /hold to talk/i }),
    ).not.toBeChecked();
    expect(screen.queryByRole("button", { name: /hold to talk/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /start listening|pause listening/i }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/just speak/i)).toBeInTheDocument();
    expect(startDictation).toHaveBeenCalled();
  });

  it("starts continuous listen when the booth is open, unmuted, and permitted", () => {
    renderBooth();
    expect(startDictation).toHaveBeenCalled();
    expect(
      screen.getByText(
        /Listening — speak when you want Sync|Continuous listen/i,
      ),
    ).toBeInTheDocument();
  });

  it("does not auto-listen when muted", () => {
    renderBooth({ muted: true });
    expect(startDictation).not.toHaveBeenCalled();
    expect(
      screen.getByText(/continuous listen is paused/i),
    ).toBeInTheDocument();
  });

  it("sends a continuous utterance after silence", async () => {
    renderBooth();
    act(() => {
      onTranscript?.("How is emergency work trending?");
    });
    expect(askBooth).not.toHaveBeenCalled();
    await waitFor(
      () => {
        expect(askBooth).toHaveBeenCalledTimes(1);
      },
      { timeout: BOOTH_UTTERANCE_SILENCE_MS + 400 },
    );
    expect(askBooth.mock.calls[0][0]).toContain(
      "QUESTION: How is emergency work trending?",
    );
  });

  it("stops TTS when the user speaks in continuous mode", () => {
    renderBooth({ speaking: true });
    act(() => {
      onSpeech?.();
    });
    expect(stopSpeech).toHaveBeenCalled();
    act(() => {
      onInterim?.("how is");
    });
    expect(stopSpeech).toHaveBeenCalled();
  });

  it("toggles optional hold-to-talk and keeps press-and-hold there", async () => {
    renderBooth();
    fireEvent.click(screen.getByRole("checkbox", { name: /hold to talk/i }));
    expect(screen.getByTestId("presence-booth")).toHaveAttribute(
      "data-booth-voice-mode",
      "hold-to-talk",
    );
    expect(window.localStorage.getItem(PRESENCE_HOLD_TO_TALK_KEY)).toBe("1");
    expect(
      screen.getByRole("button", { name: /hold to talk/i }),
    ).toBeInTheDocument();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: /hold to talk/i }),
    );
    expect(startDictation).toHaveBeenCalled();
    act(() => {
      onTranscript?.("How is emergency work trending?");
    });
    fireEvent.pointerUp(screen.getByRole("button", { name: /hold to talk/i }));

    await waitFor(() => {
      expect(askBooth).toHaveBeenCalledTimes(1);
    });
    expect(askBooth.mock.calls[0][0]).toContain(
      "QUESTION: How is emergency work trending?",
    );
    expect(stopDictation).toHaveBeenCalled();
  });

  it("shows an enable-microphone CTA and keeps typed Ask when the mic is blocked", async () => {
    dictation.permission = "denied";
    dictation.error =
      "Microphone access was blocked. Allow it in your browser's site settings.";
    renderBooth();
    expect(screen.getByText(MIC_BLOCKED_COPY)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /enable microphone/i }));
    expect(retryPermission).toHaveBeenCalled();
    expect(startDictation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "Type instead" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));
    await waitFor(() => {
      expect(askBooth).toHaveBeenCalledTimes(1);
    });
    expect(askBooth.mock.calls[0][0]).toContain("QUESTION: Type instead");
  });

  it("sends typed questions through the existing ReliabilityAgent ask", async () => {
    renderBooth();
    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "What should I look at first?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    await waitFor(() => {
      expect(askBooth).toHaveBeenCalledTimes(1);
    });
    const query = askBooth.mock.calls[0][0] as string;
    expect(query).toContain("QUESTION: What should I look at first?");
    expect(query).toMatch(/Recommend is not authorize/i);
    expect(query).toContain("No sourced KPI values are available yet.");
    expect(query).toContain("No decision case is selected.");
    expect(query).not.toMatch(/plant is healthy/i);

    expect(
      await screen.findByText(
        "No sourced backlog figure is in this snapshot. I recommend, I do not authorize.",
      ),
    ).toBeInTheDocument();
    expect(speak).toHaveBeenCalledWith(
      "No sourced backlog figure is in this snapshot. I recommend, I do not authorize.",
    );
  });

  it("does not speak replies when muted", async () => {
    renderBooth({ muted: true });
    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "Any plant claims?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    expect(
      await screen.findByText(
        "No sourced backlog figure is in this snapshot. I recommend, I do not authorize.",
      ),
    ).toBeInTheDocument();
    expect(speak).not.toHaveBeenCalled();
  });

  it("still speaks Meet Sync replies when tenant voice output is off", async () => {
    renderBooth({ voiceOutputEnabled: false });
    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "Any plant claims?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    expect(
      await screen.findByText(
        "No sourced backlog figure is in this snapshot. I recommend, I do not authorize.",
      ),
    ).toBeInTheDocument();
    expect(speak).toHaveBeenCalled();
  });

  it("shows the honest unavailable reply and does not invent plant state", async () => {
    askBooth.mockResolvedValue({
      status: "unavailable",
      response: BOOTH_UNAVAILABLE_REPLY,
    });
    renderBooth();
    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "Give me OEE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    expect(
      await screen.findByText(BOOTH_UNAVAILABLE_REPLY),
    ).toBeInTheDocument();
    expect(screen.queryByText(/87%/)).toBeNull();
    expect(screen.queryByText(/plant is healthy/i)).toBeNull();
  });

  it("shows a Sync unavailable reply when the ask invoke throws", async () => {
    askBooth.mockRejectedValue(
      new Error("Failed to send a request to the Edge Function"),
    );
    renderBooth();
    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "What should I look at first?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    expect(
      await screen.findByText("What should I look at first?"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(BOOTH_UNAVAILABLE_REPLY),
    ).toBeInTheDocument();
    expect(screen.getByText("Sync")).toBeInTheDocument();
    expect(screen.queryByText(/plant is healthy/i)).toBeNull();
    expect(speak).toHaveBeenCalledWith(BOOTH_UNAVAILABLE_REPLY);
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/Ask about maintenance/i),
      ).not.toBeDisabled();
    });
  });

  it("still shows the unavailable Sync reply when muted after an invoke throw", async () => {
    askBooth.mockRejectedValue(new Error("FunctionsFetchError"));
    renderBooth({ muted: true });
    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "How is backlog?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    expect(
      await screen.findByText(BOOTH_UNAVAILABLE_REPLY),
    ).toBeInTheDocument();
    expect(speak).not.toHaveBeenCalled();
  });

  it("does not ask when signed out", async () => {
    renderBooth({ signedIn: false });
    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));
    expect(askBooth).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("continues a named subject in this-tab memory and keeps it provisional", async () => {
    renderBooth();
    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "HMER haul truck availability optimization" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    await waitFor(() => {
      expect(askBooth).toHaveBeenCalledTimes(1);
    });
    expect(askBooth.mock.calls[0][0]).toContain(
      "QUESTION: New subject. HMER haul truck availability optimization",
    );
    expect(askBooth.mock.calls[0][0]).toMatch(/provisional/i);

    const stored = window.sessionStorage.getItem(
      `${PRESENCE_MEMORY_KEY_PREFIX}user-orville`,
    );
    expect(stored).toContain("HMER haul truck availability optimization");
    expect(onPresenceSignals).toHaveBeenCalledWith(
      expect.objectContaining({ thinking: true }),
    );
  });

  it("keeps a bound Decision Case in the ask without transferring seed facts", async () => {
    renderBooth({
      caseBound: true,
      caseContextLines: ["Decision Case DC-2201 v1", "Asset: Crusher 2201"],
    });
    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "What should I look at first?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    await waitFor(() => {
      expect(askBooth).toHaveBeenCalledTimes(1);
    });
    const query = askBooth.mock.calls[0][0] as string;
    expect(query).toContain("QUESTION: What should I look at first?");
    expect(query).not.toContain("New subject.");
    expect(query).toContain("Decision Case DC-2201 v1");
    expect(query).not.toMatch(/P-101|Fort McMurray/i);
  });

  it("does not write the durable vault when no organization session exists", async () => {
    renderBooth();
    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "What should I look at first?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));
    await waitFor(() => {
      expect(askBooth).toHaveBeenCalled();
    });
    expect(persistVault).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Notes stay in this tab until you sign in/i),
    ).toBeInTheDocument();
  });

  it("persists signed-in notes to the Sync vault and hydrates a new tab", async () => {
    loadVault.mockResolvedValue({
      lastSubject: "HMER haul truck availability optimization",
      messages: [
        {
          id: "prior",
          role: "user",
          text: "HMER haul truck availability optimization",
        },
      ],
    });
    renderBooth({
      organizationId: "org-1",
      caseId: "case-1",
      caseNumber: "DC-2201",
      asset: "Crusher 2201",
    });
    expect(
      await screen.findByText("HMER haul truck availability optimization"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Signed-in notes persist beyond this tab/i),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "What next?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));
    await waitFor(() => {
      expect(persistVault).toHaveBeenCalled();
    });
    const payload = persistVault.mock.calls.at(-1)?.[0] as {
      organizationId: string;
      userId: string;
      caseNumber: string;
      memory: { lastSubject: string | null };
    };
    expect(payload.organizationId).toBe("org-1");
    expect(payload.userId).toBe("user-orville");
    expect(payload.caseNumber).toBe("DC-2201");
    expect(payload.memory.lastSubject).toMatch(/HMER haul truck/i);
  });
});
