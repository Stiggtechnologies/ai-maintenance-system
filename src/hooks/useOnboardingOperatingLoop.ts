/**
 * React hook exposing onboarding-derived operating-loop data to pages.
 *
 * Loads persisted onboarding sessions once, then returns memoized view-models
 * for each surface (Asset Intelligence, Reliability, Work Action Board, Decision
 * Governance, Mission Control, Value Realization, Cowork Studio) plus the
 * learning-loop event feed and the last persistence result.
 */
import { useEffect, useMemo } from "react";
import { useOnboardingStore } from "../store/onboardingStore";
import {
  deriveOperatingLoop,
  type OnboardingDerivedBundle,
  type OnboardingLearningEvent,
} from "../services/onboardingOperatingLoop";
import type { AssetOnboardingSaveResult } from "../services/assetOnboardingPersistence";

export interface OnboardingOperatingLoop extends OnboardingDerivedBundle {
  sessionCount: number;
  learningEvents: OnboardingLearningEvent[];
  lastSaveResult: AssetOnboardingSaveResult | null;
  loaded: boolean;
}

export function useOnboardingOperatingLoop(): OnboardingOperatingLoop {
  const sessions = useOnboardingStore((state) => state.sessions);
  const decisions = useOnboardingStore((state) => state.decisions);
  const learningEvents = useOnboardingStore((state) => state.learningEvents);
  const lastSaveResult = useOnboardingStore((state) => state.lastSaveResult);
  const loaded = useOnboardingStore((state) => state.loaded);
  const loadAll = useOnboardingStore((state) => state.loadAll);

  useEffect(() => {
    if (!loaded) {
      void loadAll();
    }
  }, [loaded, loadAll]);

  const bundle = useMemo(
    () => deriveOperatingLoop(sessions, decisions),
    [sessions, decisions],
  );

  return {
    ...bundle,
    sessionCount: sessions.length,
    learningEvents,
    lastSaveResult,
    loaded,
  };
}
