import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DECISION_CASE_STORAGE_KEY } from "../lib/decision-case";
import { createHonestEmptyDecisionCase } from "../lib/decision-case-honesty";
import { BOOTH_UNAVAILABLE_REPLY } from "../lib/presence/booth";
import { PRESENCE_MEMORY_KEY_PREFIX } from "../lib/presence/memory";
import { PresenceBoothConversation } from "./PresenceBoothConversation";

const speak = vi.fn();
const stopSpeech = vi.fn();
const askBooth = vi.fn();
const startDictation = vi.fn();
const stopDictation = vi.fn();
let onTranscript: ((text: string) => void) | null = null;
const dictation = {
  supported: true,
  listening: false,
  error: null as string | null,
};

vi.mock("../lib/presence/askBooth", () => ({
  askBoothConversation: (...args: unknown[]) => askBooth(...args),
}));

vi.mock("../hooks/useDictation", () => ({
  useDictation: (callback: (text: string) => void) => {
    onTranscript = callback;
    return {
      get supported() {
        return dictation.supported;
      },
      get listening() {
        return dictation.listening;
      },
      get error() {
        return dictation.error;
      },
      start: () => {
        dictation.listening = true;
        startDictation();
      },
      stop: () => {
        dictation.listening = false;
        stopDictation();
      },
      clearError: vi.fn(),
    };
  },
}));

beforeEach(() => {
  speak.mockReset();
  stopSpeech.mockReset();
  askBooth.mockReset();
  startDictation.mockReset();
  stopDictation.mockReset();
  onTranscript = null;
  dictation.supported = true;
  dictation.listening = false;
  dictation.error = null;
  window.sessionStorage.clear();
  window.localStorage.clear();
  askBooth.mockResolvedValue({
    status: "ok",
    response: "No sourced backlog figure is in this snapshot.",
  });
});

function renderBooth(
  overrides: Partial<ComponentProps<typeof PresenceBoothConversation>> = {},
) {
  return render(
    <PresenceBoothConversation
      userId="user-orville"
      signedIn
      muted={false}
      voiceOutputEnabled
      speaking={false}
      givenName="Orville"
      briefLines={["No sourced KPI values are available yet."]}
      speak={speak}
      stopSpeech={stopSpeech}
      {...overrides}
    />,
  );
}

describe("PresenceBoothConversation", () => {
  it("sends typed questions through the existing ReliabilityAgent ask", async () => {
    renderBooth();
    fireEvent.change(
      screen.getByPlaceholderText(/Ask about a Decision Case/i),
      {
        target: { value: "What should I look at first?" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    await waitFor(() => {
      expect(askBooth).toHaveBeenCalledTimes(1);
    });
    const query = askBooth.mock.calls[0][0] as string;
    expect(query).toContain("QUESTION: What should I look at first?");
    expect(query).toMatch(/Recommend is not authorize/i);
    expect(query).toContain("No sourced KPI values are available yet.");
    expect(query).toMatch(/No decision case is selected/i);
    expect(query).not.toMatch(/plant is healthy/i);

    expect(
      await screen.findByText("No sourced backlog figure is in this snapshot."),
    ).toBeInTheDocument();
    expect(speak).toHaveBeenCalledWith(
      "No sourced backlog figure is in this snapshot. Recommend is not authorize.",
    );
    expect(screen.getByTestId("presence-booth")).toHaveAttribute(
      "data-presence-phase",
      "idle",
    );
  });

  it("push-to-talk sends the transcript after release", async () => {
    renderBooth();
    const talk = screen.getByRole("button", {
      name: /click or hold to talk/i,
    });
    fireEvent.pointerDown(talk);
    expect(startDictation).toHaveBeenCalled();
    onTranscript?.("How is emergency work trending?");
    fireEvent.pointerUp(talk);

    await waitFor(() => {
      expect(askBooth).toHaveBeenCalledTimes(1);
    });
    expect(askBooth.mock.calls[0][0]).toContain(
      "QUESTION: How is emergency work trending?",
    );
    expect(stopDictation).toHaveBeenCalled();
  });

  it("click-to-talk stays listening until the second click", async () => {
    renderBooth();
    const talk = () =>
      screen.getByRole("button", {
        name: /click or hold to talk|click to send|release to send/i,
      });
    fireEvent.pointerDown(talk());
    fireEvent.pointerUp(talk());
    expect(askBooth).not.toHaveBeenCalled();
    onTranscript?.("HMER haul truck availability");
    fireEvent.pointerDown(talk());

    await waitFor(() => {
      expect(askBooth).toHaveBeenCalledTimes(1);
    });
    expect(askBooth.mock.calls[0][0]).toContain(
      "QUESTION: HMER haul truck availability",
    );
  });

  it("does not speak replies when muted", async () => {
    renderBooth({ muted: true });
    fireEvent.change(
      screen.getByPlaceholderText(/Ask about a Decision Case/i),
      {
        target: { value: "Any plant claims?" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    expect(
      await screen.findByText("No sourced backlog figure is in this snapshot."),
    ).toBeInTheDocument();
    expect(speak).not.toHaveBeenCalled();
  });

  it("does not speak replies when sync_voice_output is off", async () => {
    renderBooth({ voiceOutputEnabled: false });
    fireEvent.change(
      screen.getByPlaceholderText(/Ask about a Decision Case/i),
      {
        target: { value: "Any plant claims?" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    expect(
      await screen.findByText("No sourced backlog figure is in this snapshot."),
    ).toBeInTheDocument();
    expect(speak).not.toHaveBeenCalled();
  });

  it("shows the honest unavailable reply and does not invent plant state", async () => {
    askBooth.mockResolvedValue({
      status: "unavailable",
      response: BOOTH_UNAVAILABLE_REPLY,
    });
    renderBooth();
    fireEvent.change(
      screen.getByPlaceholderText(/Ask about a Decision Case/i),
      {
        target: { value: "Give me OEE" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));

    expect(
      await screen.findByText(BOOTH_UNAVAILABLE_REPLY),
    ).toBeInTheDocument();
    expect(screen.queryByText(/87%/)).toBeNull();
    expect(screen.queryByText(/plant is healthy/i)).toBeNull();
  });

  it("does not ask when signed out", async () => {
    renderBooth({ signedIn: false });
    fireEvent.change(
      screen.getByPlaceholderText(/Ask about a Decision Case/i),
      {
        target: { value: "Hello" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));
    expect(askBooth).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("restores session transcript and continues a named subject", async () => {
    window.sessionStorage.setItem(
      `${PRESENCE_MEMORY_KEY_PREFIX}user-orville`,
      JSON.stringify({
        messages: [
          { id: "u1", role: "user", text: "HMER haul truck availability" },
          {
            id: "s1",
            role: "sync",
            text: "Provisional. Recommend is not authorize.",
          },
        ],
        subject: "HMER haul truck availability",
        caseId: null,
      }),
    );
    renderBooth();
    expect(
      screen.getByText("HMER haul truck availability"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("presence-continuity")).toHaveTextContent(
      /Continuing: HMER haul truck availability/,
    );

    fireEvent.change(
      screen.getByPlaceholderText(/Ask about a Decision Case/i),
      {
        target: { value: "What evidence is still missing?" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));
    await waitFor(() => {
      expect(askBooth).toHaveBeenCalledTimes(1);
    });
    expect(askBooth.mock.calls[0][0]).toContain(
      "Named subject (session): HMER haul truck availability",
    );
    expect(askBooth.mock.calls[0][0]).toContain(
      "Visitor: HMER haul truck availability",
    );
  });

  it("includes a bound Decision Case from the Sync store", async () => {
    const draft = createHonestEmptyDecisionCase("Reliability Engineer");
    const bound = {
      ...draft,
      asset: "CV-204 conveyor",
      stage: "evidence" as const,
      evidence: [
        {
          id: "ev-1",
          title: "Delay log",
          summary: "Named delay records",
          quality: "medium" as const,
          state: "Governed",
          record: "DL-1",
          finding: "Start-up delays after changeover.",
          lineage: "Site log",
          sourceSystem: "CMMS",
        },
      ],
    };
    window.localStorage.setItem(
      DECISION_CASE_STORAGE_KEY,
      JSON.stringify([bound]),
    );
    renderBooth();
    fireEvent.change(
      screen.getByPlaceholderText(/Ask about a Decision Case/i),
      {
        target: { value: "What should we examine next?" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));
    await waitFor(() => {
      expect(askBooth).toHaveBeenCalledTimes(1);
    });
    expect(askBooth.mock.calls[0][0]).toContain("Decision Case");
    expect(askBooth.mock.calls[0][0]).toContain("CV-204 conveyor");
    expect(askBooth.mock.calls[0][0]).not.toMatch(/P-101|Fort McMurray/i);
  });

  it("reports thinking while the ReliabilityAgent answer is in flight", async () => {
    let finish!: (value: { status: string; response: string }) => void;
    askBooth.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderBooth();
    fireEvent.change(
      screen.getByPlaceholderText(/Ask about a Decision Case/i),
      {
        target: { value: "How should we frame the Decision Case?" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));
    expect(await screen.findByTestId("presence-booth")).toHaveAttribute(
      "data-presence-phase",
      "thinking",
    );
    finish({
      status: "ok",
      response: "Name the asset and the decision. Recommend is not authorize.",
    });
    await waitFor(() => {
      expect(screen.getByTestId("presence-booth")).toHaveAttribute(
        "data-presence-phase",
        "idle",
      );
    });
  });
});
