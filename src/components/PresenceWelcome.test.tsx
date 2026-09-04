import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KpiDashboard, KpiRow } from "../services/kpiService";
import {
  HONEST_EMPTY_BRIEF,
  PRESENCE_MUTE_STORAGE_KEY,
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

vi.mock("../hooks/useSpeechOutput", () => ({
  useSpeechOutput: () => ({
    supported: true,
    speaking: false,
    speak,
    stop,
  }),
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
  it("speaks the named welcome once per session when enabled", async () => {
    const { unmount } = render(<PresenceWelcome />);

    await waitFor(() => {
      expect(speak).toHaveBeenCalledTimes(1);
    });
    expect(speak).toHaveBeenCalledWith(
      "Welcome Orville, how are you doing today?",
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
    expect(screen.getByText(/Not autonomous control/i)).toBeInTheDocument();
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
    expect(screen.getByText(/booth conversation/i)).toBeInTheDocument();
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

  it("does not speak or show Play when sync_voice_output is off", async () => {
    voiceOutput.enabled = false;
    render(<PresenceWelcome />);

    await waitFor(() => {
      expect(screen.getByTestId("presence-welcome")).toHaveAttribute(
        "data-presence-voice",
        "off",
      );
    });
    expect(speak).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /play welcome/i })).toBeNull();
    expect(
      screen.getByText(/Voice output is off for this tenant/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Meet Sync" }));
    expect(await screen.findByTestId("presence-booth")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /mute welcome/i }),
    ).toBeInTheDocument();
  });

  it("does not auto-speak while sync_voice_output is still loading", async () => {
    voiceOutput.loading = true;
    voiceOutput.enabled = false;
    render(<PresenceWelcome />);

    await waitFor(() => {
      expect(screen.getByTestId("presence-welcome")).toHaveAttribute(
        "data-presence-voice",
        "loading",
      );
    });
    expect(speak).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /play welcome/i })).toBeNull();
    expect(
      screen.queryByText(/Voice output is off for this tenant/i),
    ).toBeNull();
  });

  it("falls back to an unnamed spoken welcome without guessing Orville", async () => {
    useAuth.mockReturnValue(signedInAuth(null));
    render(<PresenceWelcome />);

    await waitFor(() => {
      expect(speak).toHaveBeenCalledWith("Welcome, how are you doing today?");
    });
    expect(speak.mock.calls[0][0]).not.toMatch(/Orville/);
    expect(
      screen.getByText("Welcome, how are you doing today?"),
    ).toBeInTheDocument();
  });
});
