/**
 * Onboarding operating-loop store.
 *
 * Central client-side sink that makes a completed onboarding session
 * operational across SyncAI. It loads persisted sessions (Supabase + local
 * fallback via {@link assetOnboardingPersistence}), tracks learning-loop events
 * and governance decisions, and surfaces the last persistence result so callers
 * can warn the user when a save only reached browser storage.
 */
import { create } from "zustand";
import type { AssetOnboardingSession } from "../lib/asset-onboarding";
import {
  listAssetOnboardingSessions,
  loadAssetOnboardingSession,
  loadAssetOnboardingSessionLocal,
  type AssetOnboardingSaveResult,
} from "../services/assetOnboardingPersistence";
import type {
  DerivedGovernanceStatus,
  OnboardingLearningEvent,
  OnboardingLearningEventType,
} from "../services/onboardingOperatingLoop";

const LEARNING_EVENTS_KEY = "syncai.onboarding.learningEvents.v1";
const DECISIONS_KEY = "syncai.onboarding.decisions.v1";
const MAX_LEARNING_EVENTS = 100;

interface OnboardingState {
  sessions: AssetOnboardingSession[];
  learningEvents: OnboardingLearningEvent[];
  decisions: Record<string, DerivedGovernanceStatus>;
  lastSaveResult: AssetOnboardingSaveResult | null;
  loading: boolean;
  loaded: boolean;
  loadAll: () => Promise<void>;
  registerSession: (
    session: AssetOnboardingSession,
    saveResult?: AssetOnboardingSaveResult | null,
  ) => void;
  recordStepCompleted: (
    session: AssetOnboardingSession,
    stepName: string,
  ) => void;
  recordExport: (session: AssetOnboardingSession, formats: number) => void;
  recordRecommendationDecision: (
    recordId: string,
    session: AssetOnboardingSession,
    decision: "approved" | "rejected",
    approvalLabel: string,
  ) => void;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadPersistedEvents(): OnboardingLearningEvent[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(LEARNING_EVENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OnboardingLearningEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadPersistedDecisions(): Record<string, DerivedGovernanceStatus> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(DECISIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, DerivedGovernanceStatus>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistEvents(events: OnboardingLearningEvent[]) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(
      LEARNING_EVENTS_KEY,
      JSON.stringify(events.slice(0, MAX_LEARNING_EVENTS)),
    );
  } catch {
    /* best-effort */
  }
}

function persistDecisions(decisions: Record<string, DerivedGovernanceStatus>) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(DECISIONS_KEY, JSON.stringify(decisions));
  } catch {
    /* best-effort */
  }
}

let eventCounter = 0;
function makeEvent(
  type: OnboardingLearningEventType,
  session: AssetOnboardingSession,
  partial: Pick<OnboardingLearningEvent, "title" | "detail"> &
    Partial<Pick<OnboardingLearningEvent, "agent" | "confidence">>,
): OnboardingLearningEvent {
  eventCounter += 1;
  return {
    id: `${session.sessionId}-${type}-${eventCounter}`,
    type,
    sessionId: session.sessionId,
    assetId: session.assetId,
    title: partial.title,
    detail: partial.detail,
    agent: partial.agent ?? "Asset Onboarding",
    confidence: partial.confidence ?? Math.max(40, session.completionScore),
    createdAt: session.updatedAt,
  };
}

function upsertSession(
  sessions: AssetOnboardingSession[],
  session: AssetOnboardingSession,
): AssetOnboardingSession[] {
  const filtered = sessions.filter(
    (existing) => existing.sessionId !== session.sessionId,
  );
  return [session, ...filtered];
}

function addEvents(
  current: OnboardingLearningEvent[],
  next: OnboardingLearningEvent[],
): OnboardingLearningEvent[] {
  const merged = [...next, ...current].slice(0, MAX_LEARNING_EVENTS);
  persistEvents(merged);
  return merged;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  sessions: [],
  learningEvents: [],
  decisions: {},
  lastSaveResult: null,
  loading: false,
  loaded: false,

  loadAll: async () => {
    if (get().loading) return;
    set({ loading: true });

    const learningEvents = loadPersistedEvents();
    const decisions = loadPersistedDecisions();

    try {
      const summaries = await listAssetOnboardingSessions();
      const loaded = await Promise.all(
        summaries.map(async (summary) => {
          try {
            return (
              (await loadAssetOnboardingSession(summary.sessionId)) ??
              loadAssetOnboardingSessionLocal(summary.sessionId)
            );
          } catch {
            return loadAssetOnboardingSessionLocal(summary.sessionId);
          }
        }),
      );

      const sessions = loaded.filter(
        (session): session is AssetOnboardingSession => session !== null,
      );

      // Preserve any in-memory sessions registered this turn that aren't
      // persisted yet (e.g. an unauthenticated demo run).
      const existing = get().sessions.filter(
        (session) =>
          !sessions.some(
            (loadedSession) => loadedSession.sessionId === session.sessionId,
          ),
      );

      set({
        sessions: [...sessions, ...existing],
        learningEvents,
        decisions,
        loading: false,
        loaded: true,
      });
    } catch {
      set({ learningEvents, decisions, loading: false, loaded: true });
    }
  },

  registerSession: (session, saveResult = null) => {
    set((state) => {
      const isNew = !state.sessions.some(
        (existing) => existing.sessionId === session.sessionId,
      );
      const workActionCount = session.profile.recommendedStrategy.length;
      const newEvents: OnboardingLearningEvent[] = [];

      if (isNew) {
        newEvents.push(
          makeEvent("onboarding_started", session, {
            title: `Onboarding started for ${session.assetId}`,
            detail: `${session.profile.criticality.criticalityClass} criticality · ${session.reliabilityReadiness} reliability readiness.`,
          }),
        );
        if (workActionCount > 0) {
          newEvents.push(
            makeEvent("work_action_created", session, {
              title: `${workActionCount} draft work action${workActionCount === 1 ? "" : "s"} created for ${session.assetId}`,
              detail:
                "Maintenance strategy recommendations queued to the Work Action Board (approval gates respected).",
              agent: "Work Order Management",
            }),
          );
        }
      }

      return {
        sessions: upsertSession(state.sessions, session),
        lastSaveResult: saveResult ?? state.lastSaveResult,
        learningEvents: newEvents.length
          ? addEvents(state.learningEvents, newEvents)
          : state.learningEvents,
      };
    });
  },

  recordStepCompleted: (session, stepName) => {
    set((state) => ({
      sessions: upsertSession(state.sessions, session),
      learningEvents: addEvents(state.learningEvents, [
        makeEvent("step_completed", session, {
          title: `Onboarding step completed — ${stepName}`,
          detail: `${session.assetId} is now ${session.completionScore}% onboarded.`,
        }),
      ]),
    }));
  },

  recordExport: (session, formats) => {
    set((state) => ({
      learningEvents: addEvents(state.learningEvents, [
        makeEvent("package_exported", session, {
          title: `Onboarding package exported for ${session.assetId}`,
          detail: `${formats} export format${formats === 1 ? "" : "s"} generated from the onboarding package.`,
          agent: "Data Analytics",
        }),
      ]),
    }));
  },

  recordRecommendationDecision: (
    recordId,
    session,
    decision,
    approvalLabel,
  ) => {
    set((state) => {
      const decisions = {
        ...state.decisions,
        [recordId]: decision as DerivedGovernanceStatus,
      };
      persistDecisions(decisions);
      const type: OnboardingLearningEventType =
        decision === "approved"
          ? "recommendation_approved"
          : "recommendation_rejected";
      return {
        decisions,
        learningEvents: addEvents(state.learningEvents, [
          makeEvent(type, session, {
            title: `Approval gate ${decision} — ${session.assetId}`,
            detail: approvalLabel,
            agent: "Decision Governance",
          }),
        ]),
      };
    });
  },
}));
