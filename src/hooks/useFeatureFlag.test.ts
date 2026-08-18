/**
 * useFeatureFlag — the property under test is FAIL CLOSED: only a successful
 * read returning enabled = true may enable a capability. Absence, error, and
 * enabled = false must all read as disabled.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const maybeSingle = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: (...args: unknown[]) => maybeSingle(...args),
    }),
  },
}));

import {
  SYNC_FEATURE_FLAGS,
  fetchFeatureFlag,
  useFeatureFlag,
} from "./useFeatureFlag";

beforeEach(() => {
  maybeSingle.mockReset();
});

describe("useFeatureFlag", () => {
  it("enables only when a row exists with enabled = true", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true }, error: null });
    const { result } = renderHook(() => useFeatureFlag("sync_global_shell"));
    expect(result.current.loading).toBe(true);
    expect(result.current.enabled).toBe(false); // never on while loading
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("reads a missing row as disabled (default-off for new organizations)", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useFeatureFlag("sync_voice_input"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reads an explicit enabled = false row as disabled", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: false }, error: null });
    const { result } = renderHook(() => useFeatureFlag("sync_tools"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it("fails closed on a query error and surfaces the error", async () => {
    maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    const { result } = renderHook(() => useFeatureFlag("sync_agent_routing"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(result.current.error).toContain("permission denied");
  });

  it("fails closed when the client throws (network / timeout)", async () => {
    maybeSingle.mockRejectedValue(new Error("AbortError"));
    const { result } = renderHook(() => useFeatureFlag("sync_field_mode"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it("fails closed when a successful read is followed by a failed refetch", async () => {
    // useAsyncData keeps the stale datum and sets error on a failed reload,
    // so `data` is still true while `error` is set — the one path where the
    // hook's `error === null` guard is load-bearing. A flag must not stay on
    // over a read the server just refused.
    maybeSingle.mockResolvedValue({ data: { enabled: true }, error: null });
    const { result } = renderHook(() => useFeatureFlag("sync_global_shell"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(true);

    maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.enabled).toBe(false);
  });
});

describe("fetchFeatureFlag", () => {
  it("returns true only for an affirmative row", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true }, error: null });
    await expect(fetchFeatureFlag("sync_meeting_mode")).resolves.toBe(true);
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(fetchFeatureFlag("sync_meeting_mode")).resolves.toBe(false);
  });

  it("throws on error so the hook can surface it", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(fetchFeatureFlag("sync_voice_output")).rejects.toThrow("boom");
  });
});

describe("flag catalogue", () => {
  it("matches the seven §39 sync_* flags seeded by 20260912110000, exactly", () => {
    expect([...SYNC_FEATURE_FLAGS].sort()).toEqual(
      [
        "sync_global_shell",
        "sync_voice_input",
        "sync_voice_output",
        "sync_agent_routing",
        "sync_tools",
        "sync_meeting_mode",
        "sync_field_mode",
      ].sort(),
    );
  });

  it("stays in lockstep with the migration seed list", async () => {
    // Read the migration as text (the same technique roleNavigation.test.ts
    // uses on AppShell/App): every typed key must be seeded, every seeded
    // sync_* key must be typed — so the union and the catalogue cannot drift.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const sql = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../supabase/migrations/20260912110000_sync_feature_flags.sql",
      ),
      "utf8",
    );
    const seeded = [...sql.matchAll(/\('(sync_[a-z_]+)'/g)].map((m) => m[1]);
    expect(seeded.sort()).toEqual([...SYNC_FEATURE_FLAGS].sort());
  });
});
