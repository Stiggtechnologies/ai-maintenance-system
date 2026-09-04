import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOOTH_UNAVAILABLE_REPLY } from "../lib/presence/booth";
import { PresenceBoothConversation } from "./PresenceBoothConversation";

const speak = vi.fn();
const stopSpeech = vi.fn();
const askBooth = vi.fn();
const startDictation = vi.fn();
const stopDictation = vi.fn();
let onTranscript: ((text: string) => void) | null = null;

vi.mock("../lib/presence/askBooth", () => ({
  askBoothConversation: (...args: unknown[]) => askBooth(...args),
}));

vi.mock("../hooks/useDictation", () => ({
  useDictation: (callback: (text: string) => void) => {
    onTranscript = callback;
    return {
      supported: true,
      listening: false,
      error: null,
      start: startDictation,
      stop: stopDictation,
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
      signedIn
      muted={false}
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
    expect(query).not.toMatch(/plant is healthy/i);

    expect(
      await screen.findByText("No sourced backlog figure is in this snapshot."),
    ).toBeInTheDocument();
    expect(speak).toHaveBeenCalledWith(
      "No sourced backlog figure is in this snapshot.",
    );
  });

  it("push-to-talk sends the transcript after release", async () => {
    renderBooth();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: /hold to talk/i }),
    );
    expect(startDictation).toHaveBeenCalled();
    onTranscript?.("How is emergency work trending?");
    fireEvent.pointerUp(screen.getByRole("button", { name: /hold to talk/i }));

    await waitFor(() => {
      expect(askBooth).toHaveBeenCalledTimes(1);
    });
    expect(askBooth.mock.calls[0][0]).toContain(
      "QUESTION: How is emergency work trending?",
    );
    expect(stopDictation).toHaveBeenCalled();
  });

  it("does not speak replies when muted", async () => {
    renderBooth({ muted: true });
    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "Any plant claims?" },
    });
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

  it("does not ask when signed out", async () => {
    renderBooth({ signedIn: false });
    fireEvent.change(screen.getByPlaceholderText(/Ask about maintenance/i), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send question/i }));
    expect(askBooth).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });
});
