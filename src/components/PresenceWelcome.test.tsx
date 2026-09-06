import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KpiDashboard, KpiRow } from "../services/kpiService";
import {
  HONEST_EMPTY_BRIEF,
  PRESENCE_MUTE_STORAGE_KEY,
  buildSpokenWelcome,
} from "../lib/presence/welcome";
import { PresenceWelcome } from "./PresenceWelcome";

const speak = vi.fn();
const stop = vi.fn();
const loadDashboard = vi.fn();
const useAuth = vi.fn();
const voiceOutput = {
  enabled: true,
  loading: false,
  error: null as string | null,
  refetch: vi.fn(),
};

const speech = {
  supported: true,
  speaking: false,
  engine: "browser" as "unknown" | "cloud" | "browser",
  speak,
  stop,
};

vi.mock("../hooks/useSpeechOutput", () => ({
  useSpeechOutput: () => speech,
}));

vi.mock("../hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => {
    if (flag !== "sync_voice_output") {
      throw new Error(`unexpected flag ${flag}`);
    }
    return voiceOutput;
  },
}));

vi.mock("./AuthProvider", () => ({
  useAuth: () => useAuth(),
}));

vi.mock("../services/kpiService", async () => {
  const actual = await vi.importActual<typeof import("../services/kpiService")>(
    "../services/kpiService",
  );
  return { ...actual, getKpiDashboard: () => loadDashboard() };
});

function signedInAuth(fullName: string | null = "Orville Davis") {
  return {
    user: { id: "user-orville", user_metadata: {} },
    profile: {
      id: "user-orville",
      email: "orville@syncai.ca",
      full_name: fullName,
      role: "admin",
      preferences: {},
    },
    session: {},
    loading: false,
  };
}

function kpiRow(
  overrides: Partial<KpiRow> & Pick<KpiRow, "kpi_key" | "name">,
): KpiRow {
  return {
    page: "executive",
    formula: "catalog",
    target_label: "per catalog",
    direction: "up",
    unit: "%",
    accountable: "Asset Management Director",
    responsible: "Reliability Manager",
    consulted: null,
    informed: null,
    accountability_tier: "executive",
    agent_owner: null,
    computable: true,
    source_note: null,
    value: null,
    status: null,
    variance_pct: null,
    confidence: null,
    computed_from: null,
    computed_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  speak.mockReset();
  stop.mockReset();
  loadDashboard.mockReset();
  speech.engine = "browser";
  voiceOutput.enabled = true;
  voiceOutput.loading = false;
  voiceOutput.error = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  useAuth.mockReturnValue(signedInAuth());
  loadDashboard.mockResolvedValue({
    role: "admin",
    kpis: [],
  } satisfies KpiDashboard);
});

describe("PresenceWelcome", () => {
  it("speaks the named Reliability Engineer welcome once per session", async () => {
    const expected = buildSpokenWelcome("Orville");
    const { unmount } = render(<PresenceWelcome />);

    await waitFor(() => {
      expect(speak).toHaveBeenCalledTimes(1);
    });
    expect(speak).toHaveBeenCalledWith(expected);
    expect(expected).toMatch(/Reliability Engineer/);
    expect(expected).toMatch(/I recommend, I do not authorize/);
    expect(screen.getByTestId("presence-face")).toHaveAttribute(
      "data-presence-phase",
      "idle",
    );

    unmount();
    render(<PresenceWelcome />);

    await waitFor(() => {
      expect(screen.getByTestId("presence-welcome")).toBeInTheDocument();
    });
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("does not welcome a signed-out visitor", async () => {
    useAuth.mockReturnValue({
      user: null,
      profile: null,
      session: null,
      loading: false,
    });

    const { container } = render(<PresenceWelcome />);
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
    expect(speak).not.toHaveBeenCalled();
    expect(loadDashboard).not.toHaveBeenCalled();
  });

  it("remembers mute and does not speak when the preference is set", async () => {
    window.localStorage.setItem(PRESENCE_MUTE_STORAGE_KEY, "1");
    render(<PresenceWelcome />);

    await waitFor(() => {
      expect(screen.getByTestId("presence-welcome")).toHaveAttribute(
        "data-presence-muted",
        "true",
      );
    });
    expect(speak).not.toHaveBeenCalled();
    expect(screen.getByText(/Presence audio muted/i)).toBeInTheDocument();
  });

  it("persists mute from the banner control", async () => {
    render(<PresenceWelcome />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /mute welcome/i }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /mute welcome/i }));

    expect(window.localStorage.getItem(PRESENCE_MUTE_STORAGE_KEY)).toBe("1");
    expect(stop).toHaveBeenCalled();
    expect(screen.getByTestId("presence-welcome")).toHaveAttribute(
      "data-presence-muted",
      "true",
    );
  });

  it("shows honest empty brief lines when KPIs are unavailable", async () => {
    loadDashboard.mockRejectedValue(new Error("kpi rpc unavailable"));
    render(<PresenceWelcome />);

    for (const line of HONEST_EMPTY_BRIEF) {
      expect(await screen.findByText(line)).toBeInTheDocument();
    }
    expect(screen.queryByText(/plant is healthy/i)).toBeNull();
    expect(screen.queryByText(/87%/)).toBeNull();
    expect(screen.getByTestId("presence-honesty")).toHaveTextContent(
      /Recommend is not authorize/i,
    );
  });

  it("renders live KPI lines without fabricating extra plant claims", async () => {
    loadDashboard.mockResolvedValue({
      role: "admin",
      kpis: [kpiRow({ kpi_key: "oee", name: "OEE", value: 62, unit: "%" })],
    } satisfies KpiDashboard);

    render(<PresenceWelcome />);
    expect(await screen.findByText("OEE: 62%")).toBeInTheDocument();
    expect(screen.queryByText(/Should not appear/)).toBeNull();
    expect(screen.queryByText(/autonomous control of the plant/i)).toBeNull();
  });

  it("opens Meet Sync from the signed-in welcome strip", async () => {
    render(<PresenceWelcome />);
    fireEvent.click(screen.getByRole("button", { name: "Meet Sync" }));
    expect(await screen.findByTestId("presence-booth")).toBeInTheDocument();
    expect(screen.getByText(/booth/i)).toBeInTheDocument();
    expect(screen.getByTestId("presence-booth")).toHaveAttribute(
      "data-booth-voice-mode",
      "continuous",
    );
    expect(
      screen.getByRole("checkbox", { name: /hold to talk/i }),
    ).not.toBeChecked();
  });

  it("hides the KPI brief while Meet Sync is open", async () => {
    loadDashboard.mockResolvedValue({
      role: "admin",
      kpis: [kpiRow({ kpi_key: "oee", name: "OEE", value: 62, unit: "%" })],
    } satisfies KpiDashboard);
    render(<PresenceWelcome />);
    expect(await screen.findByTestId("presence-brief")).toBeInTheDocument();
    expect(screen.getByText("OEE: 62%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Meet Sync" }));
    expect(await screen.findByTestId("presence-booth")).toBeInTheDocument();
    expect(screen.queryByTestId("presence-brief")).toBeNull();
    expect(screen.queryByText("OEE: 62%")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close Meet Sync" }));
    expect(screen.getByTestId("presence-brief")).toBeInTheDocument();
    expect(screen.getByText("OEE: 62%")).toBeInTheDocument();
  });

  it("gives Meet Sync a stronger rest state than Play and Mute", () => {
    render(<PresenceWelcome />);
    const meet = screen.getByRole("button", { name: "Meet Sync" });
    const play = screen.getByRole("button", { name: /play welcome/i });
    const mute = screen.getByRole("button", { name: /mute welcome/i });
    expect(meet.className).toMatch(/border-signal-cyan/);
    expect(meet.className).toMatch(/bg-signal-cyan/);
    expect(play.className).not.toMatch(/bg-signal-cyan/);
    expect(mute.className).not.toMatch(/bg-signal-cyan/);
    expect(screen.getByTestId("presence-honesty").className).toMatch(
      /\bmt-1\b/,
    );
  });

  it("keeps Meet Sync available when welcome audio is muted", async () => {
    window.localStorage.setItem(PRESENCE_MUTE_STORAGE_KEY, "1");
    render(<PresenceWelcome />);
    fireEvent.click(screen.getByRole("button", { name: "Meet Sync" }));
    expect(await screen.findByTestId("presence-booth")).toBeInTheDocument();
    expect(speak).not.toHaveBeenCalled();
  });

  it("still speaks Meet Sync when tenant sync_voice_output is off", async () => {
    voiceOutput.enabled = false;
    render(<PresenceWelcome />);

    await waitFor(() => {
      expect(speak).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("presence-welcome")).toHaveAttribute(
      "data-presence-voice",
      "off",
    );
    expect(
      screen.getByRole("button", { name: /play welcome/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/still gates CopilotDock/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Meet Sync" }));
    expect(await screen.findByTestId("presence-booth")).toBeInTheDocument();
  });

  it("does not wait on the tenant flag before the first greeting", async () => {
    voiceOutput.loading = true;
    voiceOutput.enabled = false;
    render(<PresenceWelcome />);

    await waitFor(() => {
      expect(speak).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("presence-welcome")).toHaveAttribute(
      "data-presence-voice",
      "loading",
    );
    expect(
      screen.getByRole("button", { name: /play welcome/i }),
    ).toBeInTheDocument();
  });

  it("does not claim premium quality when the speech engine is browser fallback", async () => {
    speech.engine = "browser";
    render(<PresenceWelcome />);
    const honesty = await screen.findByTestId("presence-honesty");
    expect(honesty).toHaveTextContent(/browser TTS/i);
    expect(honesty).not.toHaveTextContent(/premium/i);
    expect(honesty).not.toHaveTextContent(/cloud voice/i);
  });

  it("names a configured cloud voice without calling it premium", async () => {
    speech.engine = "cloud";
    render(<PresenceWelcome />);
    const honesty = await screen.findByTestId("presence-honesty");
    expect(honesty).toHaveTextContent(/configured cloud voice/i);
    expect(honesty).not.toHaveTextContent(/premium/i);
    expect(honesty).not.toHaveTextContent(/browser TTS/i);
  });

  it("falls back to an unnamed spoken welcome without guessing Orville", async () => {
    useAuth.mockReturnValue(signedInAuth(null));
    render(<PresenceWelcome />);

    await waitFor(() => {
      expect(speak).toHaveBeenCalledWith(buildSpokenWelcome(null));
    });
    expect(speak.mock.calls[0][0]).not.toMatch(/Orville/);
    expect(speak.mock.calls[0][0]).toMatch(/Reliability Engineer/);
    expect(screen.getByText(buildSpokenWelcome(null))).toBeInTheDocument();
  });
});
