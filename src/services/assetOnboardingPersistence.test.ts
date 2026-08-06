import { describe, expect, it } from "vitest";
import {
  applyAssetOnboardingAnswer,
  createAssetOnboardingSession,
  getOnboardingSampleAnswer,
} from "../lib/asset-onboarding";
import {
  clearAssetOnboardingSessionsLocal,
  listAssetOnboardingSessionsLocal,
  loadAssetOnboardingSessionLocal,
  saveAssetOnboardingSessionLocal,
} from "./assetOnboardingPersistence";

function memoryStorage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("asset onboarding persistence", () => {
  it("saves, lists, loads, and clears local resumable onboarding sessions", () => {
    const storage = memoryStorage();
    const session = createAssetOnboardingSession({
      commandText: "/onboard pump P-101",
      now: new Date("2026-05-20T00:00:00.000Z"),
    });
    const advanced = applyAssetOnboardingAnswer({
      session,
      answer: getOnboardingSampleAnswer(session),
      now: new Date("2026-05-20T00:05:00.000Z"),
    });

    const saveResult = saveAssetOnboardingSessionLocal(
      advanced,
      undefined,
      storage,
    );

    expect(saveResult).toMatchObject({
      mode: "local",
      sessionId: advanced.sessionId,
    });
    expect(listAssetOnboardingSessionsLocal(storage)).toEqual([
      expect.objectContaining({
        assetId: "P-101",
        completionScore: advanced.completionScore,
        source: "local",
      }),
    ]);
    expect(
      loadAssetOnboardingSessionLocal(advanced.sessionId, storage)?.currentStep,
    ).toBe("hierarchy");

    clearAssetOnboardingSessionsLocal(storage);
    expect(listAssetOnboardingSessionsLocal(storage)).toEqual([]);
  });
});
