import { describe, it, expect, beforeEach } from "vitest";
import {
  createAssetOnboardingSession,
  type AssetOnboardingSession,
} from "../lib/asset-onboarding";
import { useOnboardingStore } from "./onboardingStore";

function makeSession(): AssetOnboardingSession {
  return createAssetOnboardingSession({
    commandText: "/onboard used pump P-101 oil-sands deep",
  });
}

describe("onboardingStore", () => {
  beforeEach(() => {
    // localStorage persistence is best-effort and host-dependent; the store
    // keeps authoritative state in memory, which we reset between tests.
    useOnboardingStore.setState({
      sessions: [],
      learningEvents: [],
      decisions: {},
      lastSaveResult: null,
      loading: false,
      loaded: false,
    });
  });

  it("registers a session and emits onboarding + work-action learning events", () => {
    const session = makeSession();
    useOnboardingStore
      .getState()
      .registerSession(session, {
        mode: "local",
        sessionId: session.sessionId,
      });

    const state = useOnboardingStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.lastSaveResult?.mode).toBe("local");

    const types = state.learningEvents.map((event) => event.type);
    expect(types).toContain("onboarding_started");
    expect(types).toContain("work_action_created");
  });

  it("does not duplicate the started event when re-registering the same session", () => {
    const session = makeSession();
    const register = useOnboardingStore.getState().registerSession;
    register(session);
    register(session);

    const started = useOnboardingStore
      .getState()
      .learningEvents.filter((event) => event.type === "onboarding_started");
    expect(started).toHaveLength(1);
  });

  it("records a step completion event", () => {
    const session = makeSession();
    useOnboardingStore
      .getState()
      .recordStepCompleted(session, "Asset identity");

    const events = useOnboardingStore.getState().learningEvents;
    expect(events.some((event) => event.type === "step_completed")).toBe(true);
  });

  it("records a governance decision and a learning event", () => {
    const session = makeSession();
    useOnboardingStore
      .getState()
      .recordRecommendationDecision(
        "gov-1",
        session,
        "approved",
        "OEM limit change",
      );

    const state = useOnboardingStore.getState();
    expect(state.decisions["gov-1"]).toBe("approved");
    expect(
      state.learningEvents.some(
        (event) => event.type === "recommendation_approved",
      ),
    ).toBe(true);
  });
});
