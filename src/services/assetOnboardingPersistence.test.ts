import { describe, it, expect } from "vitest";
import { createAssetOnboardingSession } from "../lib/asset-onboarding";
import {
  saveAssetOnboardingSession,
  saveAssetOnboardingSessionLocal,
  listAssetOnboardingSessionsLocal,
  loadAssetOnboardingSessionLocal,
} from "./assetOnboardingPersistence";

/**
 * In-memory storage shim. The local persistence helpers accept an injectable
 * storage so tests don't depend on the host's localStorage implementation.
 */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

function makeSession() {
  return createAssetOnboardingSession({
    commandText: "/onboard used pump P-101 oil-sands deep",
  });
}

describe("assetOnboardingPersistence (local fallback)", () => {
  it("persists an onboarding session to local storage", () => {
    const storage = memoryStorage();
    const session = makeSession();
    const result = saveAssetOnboardingSessionLocal(session, undefined, storage);

    expect(result.mode).toBe("local");
    expect(result.sessionId).toBe(session.sessionId);

    const list = listAssetOnboardingSessionsLocal(storage);
    expect(list).toHaveLength(1);
    expect(list[0].assetId).toBe("P-101");
    expect(list[0].source).toBe("local");
  });

  it("loads a previously saved session by id", () => {
    const storage = memoryStorage();
    const session = makeSession();
    saveAssetOnboardingSessionLocal(session, undefined, storage);

    const loaded = loadAssetOnboardingSessionLocal(session.sessionId, storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.assetId).toBe("P-101");
    expect(loaded?.profile.failureModes.length).toBeGreaterThan(0);
  });

  it("does not silently claim a tenant save when Supabase is unavailable", async () => {
    const session = makeSession();
    const result = await saveAssetOnboardingSession(session);

    // Without a configured + authenticated Supabase tenant the save must report
    // local mode and surface a warning — never pretend it reached the database.
    expect(result.mode).toBe("local");
    expect(result.warning).toBeTruthy();
  });
});
